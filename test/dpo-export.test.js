const assert = require('assert').strict;
const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const { createHash } = require('crypto');
const { exportDpoBatch, selectPairs } = require('../backend/dpo-export');

// Real decodable PNGs. Blue stores 2×3 pixels with EXIF orientation 6
// (displayed as 3×2); black is an ordinary 2×3 image.
const pngs = {
  red: 'iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAIAAAASFvFNAAAAEElEQVR4nGP8zwAFTDAGAwATKQED8NgHhAAAAABJRU5ErkJggg==',
  green: 'iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAIAAAASFvFNAAAAEUlEQVR4nGNkaGCAACYGGAAACTwAhPqAFNAAAAAASUVORK5CYII=',
  blue: 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAIAAAA2iEnWAAAAGmVYSWZNTQAqAAAACAABARIAAwAAAAEABgAAAAAAANZnS2kAAAAUSURBVHicY2Rg+M/AwMDEwMCAoAASQgEFkf1DqAAAAABJRU5ErkJggg==',
  black: 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAIAAAA2iEnWAAAAC0lEQVR4nGNgwAIAABUAAapll8QAAAAASUVORK5CYII=',
  white: 'iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAIAAAASFvFNAAAAFklEQVR4nGP8//8/AwMDAwMDEwMMAAA2BgMB1iHsRQAAAABJRU5ErkJggg=='
};

describe('DPO export', function () {
  let root, outputRoot;
  const prompt = 'A cobalt bridge\nunder a café sign.';
  beforeEach(async function () {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'dpo-export-test-'));
    outputRoot = path.join(root, 'exports');
  });
  afterEach(async function () { await fs.rm(root, { recursive: true, force: true }); });

  async function source(color, score) {
    const bytes = Buffer.from(pngs[color], 'base64');
    const file = path.join(root, color + '.png');
    await fs.writeFile(file, bytes);
    return { id: createHash('sha256').update(bytes).digest('hex'), path: file, name: 'image.png', score };
  }

  it('exports conventional PNG pairs, exact captions, graded targets and all original ratings', async function () {
    const images = await Promise.all([source('red', 1), source('green', 10), source('blue', 9),
      source('black', 2), source('white', null)]);
    const result = await exportDpoBatch({ prompt, images, outputRoot });
    assert.deepEqual([result.total, result.rated, result.used, result.pairs], [5, 4, 3, 3]);
    const manifest = JSON.parse(await fs.readFile(path.join(result.directory, 'ratings.json'), 'utf8'));
    assert.equal(manifest.prompt, prompt);
    assert.deepEqual(manifest.images.map(i => i.score), [1, 10, 9, 2, null]);
    const ratings = new Map(images.map(i => [i.id, i.score]));
    const targets = [];
    for (const { stem, chosen_id, rejected_id } of manifest.pairs) {
      for (const [arm, id] of [['chosen', chosen_id], ['rejected', rejected_id]]) {
        const bytes = await fs.readFile(path.join(result.directory, arm, stem + '.png'));
        assert.equal(createHash('sha256').update(bytes).digest('hex'), id);
      }
      assert.equal(await fs.readFile(path.join(result.directory, 'chosen', stem + '.txt'), 'utf8'), prompt);
      const target = JSON.parse(await fs.readFile(path.join(result.directory, 'chosen', stem + '.dpo.json')));
      assert.deepEqual(target, { version: 1, preference_probability: 0.5 + (ratings.get(chosen_id) - ratings.get(rejected_id)) / 18 });
      targets.push(target.preference_probability);
    }
    assert.deepEqual(targets.sort((a, b) => a - b), [0.5 + 1 / 18, 0.5 + 8 / 18, 1]);

    const again = await exportDpoBatch({ prompt, images: [...images].reverse(), outputRoot });
    assert.notEqual(again.directory, result.directory);
    const second = JSON.parse(await fs.readFile(path.join(again.directory, 'ratings.json')));
    assert.deepEqual(second.pairs, manifest.pairs);
    await fs.writeFile(images[0].path, 'new bytes');
    const redPair = manifest.pairs.find(pair => pair.rejected_id === images[0].id);
    assert.deepEqual(await fs.readFile(path.join(result.directory, 'rejected', redPair.stem + '.png')), Buffer.from(pngs.red, 'base64'));
  });

  it('bounds reuse and generates both fine and strong comparisons on a large batch', function () {
    const images = Array.from({ length: 10000 }, (_, i) => ({
      id: String(i).padStart(8, '0'), score: 1 + i % 10, width: 512, height: 512
    }));
    const pairs = selectPairs(images);
    assert.ok(pairs.length >= images.length);
    assert.ok(pairs.length <= images.length * 2);
    const seen = new Set(), uses = new Map(), gaps = new Set();
    for (const [high, low] of pairs) {
      const key = high.id + '/' + low.id;
      assert(!seen.has(key));
      seen.add(key);
      assert(high.score > low.score);
      gaps.add(high.score - low.score);
      for (const { id } of [high, low]) uses.set(id, 1 + (uses.get(id) || 0));
    }
    assert.equal(uses.size, images.length);
    assert(Math.max(...uses.values()) <= 4);
    assert(gaps.has(1) && gaps.has(9));
  });

  it('does not publish tied groups, incomplete images or stale input bytes', async function () {
    const images = await Promise.all([source('red', 5), source('green', 5)]);
    const run = () => exportDpoBatch({ prompt, images, outputRoot });
    await assert.rejects(run(), /different scores/);
    images[0].score = 1;
    await fs.writeFile(images[0].path, 'changed');
    await assert.rejects(run(), /changed on disk/);
    const truncated = Buffer.from(pngs.red, 'base64').subarray(0, 33);
    await fs.writeFile(images[0].path, truncated);
    images[0].id = createHash('sha256').update(truncated).digest('hex');
    await assert.rejects(run(), /Incomplete PNG/);
    assert.deepEqual(await fs.readdir(outputRoot), []);
  });
});
