const fs = require('fs').promises;
const { constants } = require('fs');
const path = require('path');
const { createHash, randomUUID } = require('crypto');

const PNG_SIGNATURE = Buffer.from('89504e470d0a1a0a', 'hex');
const GAP_TARGETS = [1, 9, 3, 6];
const USE_LIMIT = GAP_TARGETS.length;

function inputError(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

// PNG's eXIf chunk contains a TIFF header. Match the trainer's oriented width
// and height, including when one generator writes portrait pixels + rotation.
function exifOrientation(exif) {
  const order = exif.toString('ascii', 0, 2);
  if (order !== 'II' && order !== 'MM') throw inputError('Invalid PNG EXIF byte order.');
  const uint16 = at => order === 'II' ? exif.readUInt16LE(at) : exif.readUInt16BE(at);
  const uint32 = at => order === 'II' ? exif.readUInt32LE(at) : exif.readUInt32BE(at);
  if (exif.length < 8 || uint16(2) !== 42) throw inputError('Invalid PNG EXIF header.');
  const start = uint32(4);
  if (start + 2 > exif.length) throw inputError('Invalid PNG EXIF directory.');
  const count = uint16(start);
  if (start + 2 + count * 12 > exif.length) throw inputError('Truncated PNG EXIF directory.');
  for (let i = 0; i < count; i++) {
    const tag = start + 2 + i * 12;
    if (uint16(tag) === 0x0112 && uint16(tag + 2) === 3 && uint32(tag + 4) === 1) {
      return uint16(tag + 8);
    }
  }
  return 1;
}

function pngDimensions(bytes) {
  if (bytes.length < 33 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE) ||
      bytes.readUInt32BE(8) !== 13 || bytes.toString('ascii', 12, 16) !== 'IHDR') {
    throw inputError('Expected a PNG image with a valid header.');
  }
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  if (!width || !height) throw inputError('PNG dimensions must be positive.');
  let orientation = 1;
  let hasPixels = false;
  for (let offset = 33; offset + 12 <= bytes.length;) {
    const length = bytes.readUInt32BE(offset);
    const end = offset + 8 + length;
    if (end + 4 > bytes.length) break;
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    if (type === 'eXIf') orientation = exifOrientation(bytes.subarray(offset + 8, end));
    if (type === 'IDAT' && length) hasPixels = true;
    if (type === 'IEND' && length === 0 && hasPixels) {
      return orientation >= 5 && orientation <= 8 ? [height, width] : [width, height];
    }
    offset = end + 4;
  }
  throw inputError('Incomplete PNG image; re-import the original generation.');
}

// One caller-supplied prompt per export. Within each resolution, try to give
// every image a partner before reusing images. Rotate target score gaps so
// close calls and decisive preferences both get examples. At most 4 uses per
// image; the score buckets avoid materializing all O(n²) possible comparisons.
function selectPairs(rated) {
  const groups = new Map();
  for (const item of [...rated].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) {
    const size = item.width + 'x' + item.height;
    if (!groups.has(size)) groups.set(size, []);
    groups.get(size).push(item);
  }

  const pairs = [];
  for (const group of groups.values()) {
    if (group.every(item => item.score === group[0].score)) continue;
    const partners = new Map(group.map(item => [item, new Set()]));
    // pools[uses][score] contains exactly the images still available at this usage.
    const pools = Array.from({ length: USE_LIMIT }, () =>
      Array.from({ length: 11 }, () => new Set()));
    for (const item of group) pools[0][item.score].add(item);

    function recordUse(item, partner) {
      const previous = partners.get(item);
      pools[previous.size][item.score].delete(item);
      previous.add(partner);
      if (previous.size < USE_LIMIT) pools[previous.size][item.score].add(item);
    }

    for (const [round, target] of GAP_TARGETS.entries()) {
      const order = Array.from({ length: 11 }, (_, score) =>
        Array.from({ length: 10 }, (_, i) => i + 1).filter(s => s !== score)
          .sort((a, b) => Math.abs(Math.abs(a - score) - target) - Math.abs(Math.abs(b - score) - target)));
      for (const item of group) {
        const previous = partners.get(item);
        if (previous.size > round) continue;
        let partner;
        search: for (const byScore of pools) {
          for (const score of order[item.score]) {
            for (const candidate of byScore[score]) {
              if (!previous.has(candidate)) {
                partner = candidate;
                break search;
              }
            }
          }
        }
        if (!partner) continue;
        recordUse(item, partner);
        recordUse(partner, item);
        pairs.push(item.score > partner.score ? [item, partner] : [partner, item]);
      }
    }
  }
  return pairs;
}

async function linkOrCopy(source, destination) {
  try {
    await fs.link(source, destination);
  } catch (error) {
    // Local Windows shares and FAT/exFAT volumes can lack hard-link support.
    if (!['EXDEV', 'EPERM', 'EACCES', 'ENOTSUP', 'EOPNOTSUPP', 'ENOSYS', 'EMLINK', 'EINVAL'].includes(error.code)) throw error;
    await fs.copyFile(source, destination, constants.COPYFILE_EXCL);
  }
}

async function exportDpoBatch({ prompt, images, outputRoot }) {
  if (typeof prompt !== 'string' || !prompt.trim()) throw inputError('Enter the generation prompt before exporting.');
  if (!Array.isArray(images)) throw inputError('Missing batch images.');
  const seen = new Set();
  const ratings = images.map(({ id, name, score }) => {
    if (!/^[a-f0-9]{64}$/.test(id) || seen.has(id)) throw inputError('Invalid or duplicate batch image ID.');
    if (score != null && (!Number.isInteger(score) || score < 1 || score > 10)) throw inputError('Scores must be integers from 1 to 10.');
    seen.add(id);
    return { id, name, score: score ?? null };
  });
  const rated = ratings.filter(item => item.score !== null);
  if (rated.length < 2) throw inputError('Rate at least two images before exporting.');

  await fs.mkdir(outputRoot, { recursive: true });
  const staging = await fs.mkdtemp(path.join(outputRoot, '.dpo-tmp-'));
  const sources = path.join(staging, 'sources');
  try {
    await fs.mkdir(sources);
    for (const [i, item] of ratings.entries()) {
      if (item.score === null) continue;
      let bytes;
      try {
        bytes = await fs.readFile(images[i].path);
      } catch (error) {
        if (error.code === 'ENOENT') throw inputError('A rated image is missing on disk. Re-import the original generation.', 409);
        throw error;
      }
      if (createHash('sha256').update(bytes).digest('hex') !== item.id) {
        throw inputError('A rated image changed on disk. Re-import and rate the changed image.', 409);
      }
      [item.width, item.height] = pngDimensions(bytes);
      await fs.writeFile(path.join(sources, item.id), bytes);
    }

    const pairs = selectPairs(rated);
    if (!pairs.length) throw inputError('Rate two same-resolution images with different scores to form a pair.');
    const chosen = path.join(staging, 'chosen');
    const rejected = path.join(staging, 'rejected');
    await fs.mkdir(chosen);
    await fs.mkdir(rejected);
    const pairIndex = [];
    const used = new Set();
    for (const [i, [better, worse]] of pairs.entries()) {
      const stem = String(i + 1).padStart(6, '0');
      const probability = 0.5 + (better.score - worse.score) / 18;
      await linkOrCopy(path.join(sources, better.id), path.join(chosen, stem + '.png'));
      await linkOrCopy(path.join(sources, worse.id), path.join(rejected, stem + '.png'));
      await fs.writeFile(path.join(chosen, stem + '.txt'), prompt);
      const sidecar = { version: 1, preference_probability: probability };
      await fs.writeFile(path.join(chosen, stem + '.dpo.json'), JSON.stringify(sidecar) + '\n');
      pairIndex.push({ stem, chosen_id: better.id, rejected_id: worse.id });
      used.add(better.id);
      used.add(worse.id);
    }

    const manifest = { version: 1, prompt, score_min: 1, score_max: 10, max_pairs_per_image: USE_LIMIT, images: ratings, pairs: pairIndex };
    await fs.writeFile(path.join(staging, 'ratings.json'), JSON.stringify(manifest, null, 2) + '\n');
    await fs.rm(sources, { recursive: true });
    const directory = path.resolve(outputRoot, 'dataset-' + randomUUID());
    await fs.rename(staging, directory);
    return { directory, pairs: pairs.length, used: used.size, rated: rated.length, total: ratings.length };
  } catch (error) {
    await fs.rm(staging, { recursive: true, force: true });
    throw error;
  }
}

module.exports = { exportDpoBatch, pngDimensions, selectPairs };
