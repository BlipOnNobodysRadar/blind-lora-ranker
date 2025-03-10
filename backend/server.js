const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const pngMetadata = require('png-metadata');

const app = express();
app.use(bodyParser.json());

// Directories for LoRA-based images (AI_images) and normal images
const AI_IMAGES_DIR = path.join(__dirname, '../AI_images');
const NORMAL_IMAGES_DIR = path.join(__dirname, '../normal_images');
const FRONTEND_DIR = path.join(__dirname, '../frontend');
const DATA_DIR = path.join(__dirname, '../data');

// We'll keep two separate in-memory structures
// "subsets" -> for AI-images (with LoRA metadata)
// "normalSubsets" -> for normal images (no LoRA metadata)
let subsets = {};
let normalSubsets = {};

// Ensure required directories exist
if (!fs.existsSync(AI_IMAGES_DIR)) {
  fs.mkdirSync(AI_IMAGES_DIR);
  console.log('Created AI_images directory. Add subdirectories with PNGs to rate.');
}
if (!fs.existsSync(NORMAL_IMAGES_DIR)) {
  fs.mkdirSync(NORMAL_IMAGES_DIR);
  console.log('Created normal_images directory. Add subdirectories with images to rate.');
}
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR);
  console.log('Created data directory for ratings storage.');
}

// Load subsets at startup
loadAllSubsets();        // For AI_images
loadAllNormalSubsets();  // For normal_images

// Serve frontend files
app.use(express.static(FRONTEND_DIR));

// Serve AI images at /images so existing front-end references do not break
app.use('/images', express.static(AI_IMAGES_DIR));

// Serve normal images at /normal-images
app.use('/normal-images', express.static(NORMAL_IMAGES_DIR));

/**
 * Loads all subsets from the AI_IMAGES_DIR (i.e. LoRA images).
 */
function loadAllSubsets() {
  if (!fs.existsSync(AI_IMAGES_DIR)) {
    console.log('AI_images directory not found. Creating empty directory.');
    fs.mkdirSync(AI_IMAGES_DIR);
    return;
  }

  const allSubsets = fs.readdirSync(AI_IMAGES_DIR)
    .filter(dir => {
      const dirPath = path.join(AI_IMAGES_DIR, dir);
      return fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory();
    });

  if (allSubsets.length === 0) {
    console.log('\nNo AI image subdirectories found. Instructions:\n');
    console.log('1. Create subdirectories in the "AI_images" folder.');
    console.log('2. Add PNG images with LoRA metadata into those subdirectories.');
    console.log('Example:');
    console.log('AI_images/');
    console.log('  ├── subset1/');
    console.log('  │   ├── image1.png');
    console.log('  │   └── image2.png');
    console.log('  └── subset2/');
    console.log('      ├── image3.png');
    console.log('      └── image4.png\n');
    console.log('After adding images, restart the server and reload http://localhost:3000.');
    return;
  }

  allSubsets.forEach(subset => {
    loadSubset(subset);
  });
}

/**
 * Loads all subsets from the NORMAL_IMAGES_DIR (i.e. normal images with no LoRA metadata).
 */
function loadAllNormalSubsets() {
  if (!fs.existsSync(NORMAL_IMAGES_DIR)) {
    console.log('normal_images directory not found. Creating empty directory.');
    fs.mkdirSync(NORMAL_IMAGES_DIR);
    return;
  }

  const allSubsets = fs.readdirSync(NORMAL_IMAGES_DIR)
    .filter(dir => {
      const dirPath = path.join(NORMAL_IMAGES_DIR, dir);
      return fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory();
    });

  if (allSubsets.length === 0) {
    console.log('\nNo normal image subdirectories found. Instructions:\n');
    console.log('1. Create subdirectories in the "normal_images" folder.');
    console.log('2. Add .png/.jpg/.jpeg (or other common format) images into those subdirectories.');
    console.log('Example:');
    console.log('normal_images/');
    console.log('  ├── subset1/');
    console.log('  │   ├── imageA.jpg');
    console.log('  │   └── imageB.png');
    console.log('  └── subset2/');
    console.log('      ├── imageC.jpeg');
    console.log('      └── imageD.png\n');
    console.log('After adding images, restart the server and reload the appropriate page.');
    return;
  }

  allSubsets.forEach(subset => {
    loadNormalSubset(subset);
  });
}

/**
 * Loads a single LoRA-based subset (from AI_IMAGES_DIR).
 * - Reads PNG files
 * - Extracts LoRA model from metadata
 * - Builds subset data for images and LoRAs
 */
function loadSubset(subset) {
  const subsetPath = path.join(AI_IMAGES_DIR, subset);
  const files = fs.readdirSync(subsetPath).filter(file => file.toLowerCase().endsWith('.png'));

  // Load previous ratings data if it exists
  let savedData = { ratings: {}, matchCount: {}, loraModelRatings: {} };
  const ratingFile = path.join(DATA_DIR, `ratings-${subset}.json`);
  if (fs.existsSync(ratingFile)) {
    savedData = JSON.parse(fs.readFileSync(ratingFile, 'utf8'));
  }

  let images = {};
  let loraModels = {};

  for (const file of files) {
    const loraModel = getPngMetadata(path.join(subsetPath, file));
    if (loraModel === '' && !savedData.ratings[file]) {
      // If there's no LoRA metadata at all, we skip if the user strictly wants only LoRA images in this folder.
      // However, if you want to allow no-metadata PNGs here, remove the `continue;`
      // For pure LoRA subsets, we keep `continue;`
      continue;
    }

    // Initialize or load image data
    images[file] = {
      rating: savedData.ratings[file] ?? 1000,
      matches: savedData.matchCount[file] ?? 0,
      lora: loraModel
    };

    // Initialize or load LoRA model data
    if (loraModel) {
      if (!loraModels[loraModel]) {
        loraModels[loraModel] = {
          rating: savedData.loraModelRatings[loraModel]?.rating ?? 1000,
          matches: savedData.loraModelRatings[loraModel]?.count ?? 0
        };
      }
    }
  }

  subsets[subset] = { images, loraModels };
}

/**
 * Loads a single subset of normal images (from NORMAL_IMAGES_DIR).
 * - Accepts common file types
 * - No metadata extraction
 * - Builds normalSubsets data
 */
function loadNormalSubset(subset) {
  const subsetPath = path.join(NORMAL_IMAGES_DIR, subset);
  // Accept any common image extension; add more if you like
  const validExtensions = ['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.gif',];
  const files = fs.readdirSync(subsetPath)
    .filter(file => validExtensions.includes(path.extname(file).toLowerCase()));

  // Load previous ratings data if it exists
  let savedData = { ratings: {}, matchCount: {} };
  const ratingFile = path.join(DATA_DIR, `ratings-normal-${subset}.json`);
  if (fs.existsSync(ratingFile)) {
    savedData = JSON.parse(fs.readFileSync(ratingFile, 'utf8'));
  }

  let images = {};

  for (const file of files) {
    images[file] = {
      rating: savedData.ratings[file] ?? 1000,
      matches: savedData.matchCount[file] ?? 0,
      lora: '' // not applicable, but keep same structure
    };
  }

  normalSubsets[subset] = { images };
}

/**
 * Extracts LoRA model name from a PNG using known text chunks.
 * Returns '' if no LoRA is found.
 */
function getPngMetadata(imagePath) {
  try {
    const buffer = pngMetadata.readFileSync(imagePath);
    const chunks = pngMetadata.splitChunk(buffer);

    // Extract all tEXt chunks
    const textChunks = chunks
      .filter(c => c.type === 'tEXt')
      .map(c => parseTextChunk(c.data));

    // 1. Auto1111 format
    const parametersChunk = textChunks.find(c => c.keyword === 'parameters');
    if (parametersChunk) {
      const loraMatch = parametersChunk.text.match(/<lora:([^:]+):/);
      if (loraMatch && loraMatch[1]) {
        return loraMatch[1].trim();
      }
      // If parameters chunk exists but no LoRA was found, explicitly return "NONE"
      return "NONE";
    }

    // 2. ComfyUI format in 'prompt'
    const promptChunk = textChunks.find(c => c.keyword === 'prompt');
    if (promptChunk) {
      try {
        const jsonData = JSON.parse(promptChunk.text);
        const loraName = extractLoraFromComfyUI(jsonData);
        if (loraName) return loraName;
        return "NONE";
      } catch {}
    }

    // 3. ComfyUI format in 'workflow'
    const workflowChunk = textChunks.find(c => c.keyword === 'workflow');
    if (workflowChunk) {
      try {
        const jsonData = JSON.parse(workflowChunk.text);
        const loraName = extractLoraFromWorkflow(jsonData);
        if (loraName) return loraName;
        return "NONE";
      } catch {}
    }

    return '';
  } catch (err) {
    console.error('Error parsing PNG metadata:', err);
    return '';
  }
}

function parseTextChunk(dataBuffer) {
  const rawStr = dataBuffer.toString('utf8');
  const nullIndex = rawStr.indexOf('\0');
  if (nullIndex === -1) {
    return { keyword: '', text: '' };
  }
  const keyword = rawStr.slice(0, nullIndex);
  const text = rawStr.slice(nullIndex + 1);
  return { keyword, text };
}

function extractLoraFromComfyUI(jsonData) {
  for (const key in jsonData) {
    const node = jsonData[key];
    if (node && node.class_type === 'LoraLoader') {
      const name = extractNameFromLoraNode(node);
      if (name) return name;
    }
  }
  return '';
}

function extractLoraFromWorkflow(jsonData) {
  if (jsonData && Array.isArray(jsonData.nodes)) {
    for (const node of jsonData.nodes) {
      if (node.class_type === 'LoraLoader') {
        const name = extractNameFromLoraNode(node);
        if (name) return name;
      }
    }
  }
  return '';
}

function extractNameFromLoraNode(node) {
  if (node.inputs && node.inputs.lora_name) {
    return extractLoraNameFromPath(node.inputs.lora_name);
  }
  if (Array.isArray(node.widgets_values) && node.widgets_values.length > 0) {
    const val = node.widgets_values[0];
    if (typeof val === 'string') {
      return extractLoraNameFromPath(val);
    }
  }
  return '';
}

function extractLoraNameFromPath(loraPath) {
  let name = loraPath.split('/').pop();
  name = name.replace(/\.(safetensors|ckpt|pt|bin)$/i, '');
  return name.trim();
}

/**
 * Updates Elo ratings for two entities.
 */
function updateRatings(winner, loser) {
  const getKFactor = (matches) => {
    if (matches < 10) return 64;
    if (matches < 20) return 48;
    if (matches < 30) return 32;
    return 24;
  };

  const kWinner = getKFactor(winner.matches || 0);
  const kLoser = getKFactor(loser.matches || 0);

  const expectedWinner = 1 / (1 + Math.pow(10, ((loser.rating || 1000) - (winner.rating || 1000)) / 400));

  winner.rating = (winner.rating || 1000) + kWinner * (1 - expectedWinner);
  loser.rating = (loser.rating || 1000) + kLoser * (0 - expectedWinner);

  winner.matches = (winner.matches || 0) + 1;
  loser.matches = (loser.matches || 0) + 1;
}

/**
 * Selects an optimal pair among a set of images.
 */
function selectPair(images) {
  const keys = Object.keys(images);
  if (keys.length < 2) return [];

  const getPriority = (img1, img2) => {
    const img1Matches = images[img1].matches || 0;
    const img2Matches = images[img2].matches || 0;
    const ratingDiff = Math.abs((images[img1].rating || 1000) - (images[img2].rating || 1000));
    const matchScore = 1 / Math.min(img1Matches + 1, img2Matches + 1);
    let score = matchScore * (1000 - ratingDiff);

    // If both images happen to have the same lora (for AI images), reduce their pairing priority
    if (images[img1].lora && images[img1].lora === images[img2].lora) {
      score *= 0.9;
    }
    return score;
  };

  let bestPair = [keys[0], keys[1]];
  let bestScore = getPriority(keys[0], keys[1]);

  for (let i = 0; i < keys.length - 1; i++) {
    for (let j = i + 1; j < keys.length; j++) {
      const score = getPriority(keys[i], keys[j]);
      if (score > bestScore) {
        bestScore = score;
        bestPair = [keys[i], keys[j]];
      }
    }
  }

  return bestPair;
}

/**
 * Saves the updated ratings for an AI (LoRA) subset.
 */
function saveSubsetRatings(subset) {
  const { images, loraModels } = subsets[subset];
  const ratings = {};
  const matchCount = {};
  const loraModelRatings = {};

  for (const img in images) {
    ratings[img] = images[img].rating;
    matchCount[img] = images[img].matches;
  }

  for (const lm in loraModels) {
    loraModelRatings[lm] = {
      rating: loraModels[lm].rating,
      count: loraModels[lm].matches
    };
  }

  const ratingFile = path.join(DATA_DIR, `ratings-${subset}.json`);
  fs.writeFileSync(ratingFile, JSON.stringify({
    ratings,
    matchCount,
    loraModelRatings
  }, null, 2));
}

/**
 * Saves the updated ratings for a normal subset.
 */
function saveNormalSubsetRatings(subset) {
  const { images } = normalSubsets[subset];
  const ratings = {};
  const matchCount = {};

  for (const img in images) {
    ratings[img] = images[img].rating;
    matchCount[img] = images[img].matches;
  }

  const ratingFile = path.join(DATA_DIR, `ratings-normal-${subset}.json`);
  fs.writeFileSync(ratingFile, JSON.stringify({
    ratings,
    matchCount
  }, null, 2));
}

// ------------- AI (LoRA) routes -------------

/** List AI subsets */
app.get('/api/subsets', (req, res) => {
  res.json(Object.keys(subsets));
});

/** Get a match pair from an AI subset */
app.get('/api/match/:subset', (req, res) => {
  const subset = req.params.subset;
  if (!subsets[subset]) {
    return res.status(404).json({ error: 'Subset not found' });
  }

  const pair = selectPair(subsets[subset].images);
  if (pair.length < 2) {
    return res.status(400).json({ error: 'Not enough images to form a pair. Add more images or try another subset.' });
  }

  res.json({ image1: pair[0], image2: pair[1] });
});

/** Record a vote for an AI subset */
app.post('/api/vote/:subset', (req, res) => {
  const subset = req.params.subset;
  const { winner, loser } = req.body;

  if (!subsets[subset]) return res.status(404).json({ error: 'Subset not found' });
  const { images, loraModels } = subsets[subset];

  if (!images[winner] || !images[loser]) {
    return res.status(400).json({ error: 'Invalid winner/loser image provided.' });
  }

  // Update image ratings
  updateRatings(images[winner], images[loser]);

  const winnerLora = images[winner].lora;
  const loserLora = images[loser].lora;

  // Update LoRA model ratings if they differ
  if (winnerLora && loserLora && winnerLora !== loserLora) {
    updateRatings(loraModels[winnerLora], loraModels[loserLora]);
  }

  saveSubsetRatings(subset);
  res.json({ message: 'Vote recorded successfully.' });
});

/** Get image-level Elo ranking for an AI subset */
app.get('/api/elo-rankings/:subset', (req, res) => {
  const subset = req.params.subset;
  if (!subsets[subset]) return res.status(404).json({ error: 'Subset not found' });

  const { images } = subsets[subset];
  const ranked = Object.keys(images)
    .sort((a, b) => images[b].rating - images[a].rating)
    .map(img => ({
      image: img,
      rating: images[img].rating,
      matches: images[img].matches,
      lora: images[img].lora
    }));

  res.json(ranked);
});

/** Get LoRA-level Elo ranking for an AI subset */
app.get('/api/lora-rankings/:subset', (req, res) => {
  const subset = req.params.subset;
  if (!subsets[subset]) return res.status(404).json({ error: 'Subset not found' });

  const { loraModels } = subsets[subset];
  const ranked = Object.keys(loraModels)
    .sort((a, b) => loraModels[b].rating - loraModels[a].rating)
    .map(lm => ({
      lora: lm,
      rating: loraModels[lm].rating,
      matches: loraModels[lm].matches
    }));

  res.json(ranked);
});

/** Delete an image from an AI subset */
app.delete('/api/image/:subset/:image', (req, res) => {
  const { subset, image } = req.params;
  if (!subsets[subset]) return res.status(404).json({ error: 'Subset not found' });

  const { images } = subsets[subset];
  if (!images[image]) return res.status(400).json({ error: 'Image not found in this subset.' });

  const imagePath = path.join(AI_IMAGES_DIR, subset, image);
  if (fs.existsSync(imagePath)) {
    fs.unlinkSync(imagePath);
  }

  delete images[image];
  saveSubsetRatings(subset);

  res.json({ message: 'Image deleted successfully.' });
});

/** Get minimal matches across an AI subset */
app.get('/api/progress/:subset', (req, res) => {
  const subset = req.params.subset;
  if (!subsets[subset]) return res.status(404).json({ error: 'Subset not found' });

  const { images } = subsets[subset];
  const imageList = Object.values(images);
  if (imageList.length === 0) {
    return res.json({ minimalMatches: 0, totalImages: 0 });
  }

  const minimalMatches = imageList.reduce((minVal, img) => Math.min(minVal, img.matches || 0), Infinity);
  const totalImages = imageList.length;
  res.json({ minimalMatches, totalImages });
});

// ------------- Normal (non-LoRA) routes -------------

/** List subsets for normal images */
app.get('/api/normal-subsets', (req, res) => {
  res.json(Object.keys(normalSubsets));
});

/** Get a match pair from a normal subset */
app.get('/api/normal-match/:subset', (req, res) => {
  const subset = req.params.subset;
  if (!normalSubsets[subset]) {
    return res.status(404).json({ error: 'Normal subset not found' });
  }

  const { images } = normalSubsets[subset];
  const pair = selectPair(images);
  if (pair.length < 2) {
    return res.status(400).json({ error: 'Not enough images to form a pair. Add more images or try another subset.' });
  }
  res.json({ image1: pair[0], image2: pair[1] });
});

/** Record a vote for a normal subset */
app.post('/api/normal-vote/:subset', (req, res) => {
  const subset = req.params.subset;
  const { winner, loser } = req.body;

  if (!normalSubsets[subset]) return res.status(404).json({ error: 'Normal subset not found' });
  const { images } = normalSubsets[subset];

  if (!images[winner] || !images[loser]) {
    return res.status(400).json({ error: 'Invalid winner/loser image.' });
  }

  // Update image ratings
  updateRatings(images[winner], images[loser]);

  // No LoRA to update here
  saveNormalSubsetRatings(subset);
  res.json({ message: 'Vote recorded for normal images.' });
});

/** Get image-level Elo ranking for a normal subset */
app.get('/api/normal-elo-rankings/:subset', (req, res) => {
  const subset = req.params.subset;
  if (!normalSubsets[subset]) return res.status(404).json({ error: 'Normal subset not found' });

  const { images } = normalSubsets[subset];
  const ranked = Object.keys(images)
    .sort((a, b) => images[b].rating - images[a].rating)
    .map(img => ({
      image: img,
      rating: images[img].rating,
      matches: images[img].matches
    }));

  res.json(ranked);
});

/** Delete an image from a normal subset */
app.delete('/api/normal-image/:subset/:image', (req, res) => {
  const { subset, image } = req.params;
  if (!normalSubsets[subset]) return res.status(404).json({ error: 'Normal subset not found' });

  const { images } = normalSubsets[subset];
  if (!images[image]) return res.status(400).json({ error: 'Image not found in this normal subset.' });

  const imagePath = path.join(NORMAL_IMAGES_DIR, subset, image);
  if (fs.existsSync(imagePath)) {
    fs.unlinkSync(imagePath);
  }

  delete images[image];
  saveNormalSubsetRatings(subset);
  res.json({ message: 'Normal image deleted successfully.' });
});

/** Get minimal matches across a normal subset */
app.get('/api/normal-progress/:subset', (req, res) => {
  const subset = req.params.subset;
  if (!normalSubsets[subset]) return res.status(404).json({ error: 'Normal subset not found' });

  const { images } = normalSubsets[subset];
  const imageList = Object.values(images);
  if (imageList.length === 0) {
    return res.json({ minimalMatches: 0, totalImages: 0 });
  }

  const minimalMatches = imageList.reduce((minVal, img) => Math.min(minVal, img.matches || 0), Infinity);
  const totalImages = imageList.length;
  res.json({ minimalMatches, totalImages });
});

// ------------- CSV Export & Summaries for AI images -------------
function escapeCSV(value) {
  if (value === null || value === undefined) {
    return '';
  }
  const strValue = String(value);
  if (strValue.includes('"') || strValue.includes(',') || strValue.includes('\n')) {
    return '"' + strValue.replace(/"/g, '""') + '"';
  }
  return strValue;
}

// Export images from AI subsets
app.get('/api/export/:subset/images/csv', (req, res) => {
  const subset = req.params.subset;
  if (!subsets[subset]) return res.status(404).json({ error: 'Subset not found' });

  const { images } = subsets[subset];
  const headers = ['image', 'lora', 'rating', 'matches'];
  const rows = Object.keys(images).map(img => [
    img,
    images[img].lora,
    images[img].rating,
    images[img].matches
  ]);

  const csv = [headers.join(','), ...rows.map(r => r.map(escapeCSV).join(','))].join('\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename=${subset}-images.csv`);
  res.send(csv);
});

// Export LoRA from AI subsets
app.get('/api/export/:subset/lora/csv', (req, res) => {
  const subset = req.params.subset;
  if (!subsets[subset]) return res.status(404).json({ error: 'Subset not found' });

  const { loraModels } = subsets[subset];
  const headers = ['lora', 'rating', 'matches'];
  const rows = Object.keys(loraModels).map(lm => [
    lm,
    loraModels[lm].rating,
    loraModels[lm].matches
  ]);

  const csv = [headers.join(','), ...rows.map(r => r.map(escapeCSV).join(','))].join('\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename=${subset}-lora.csv`);
  res.send(csv);
});

// Summary Stats for AI images
app.get('/api/summary/:subset/images', (req, res) => {
  const subset = req.params.subset;
  if (!subsets[subset]) return res.status(404).json({ error: 'Subset not found' });

  const { images } = subsets[subset];
  const imageArray = Object.values(images);
  if (imageArray.length === 0) {
    return res.json({ count: 0, averageRating: 0, averageMatches: 0 });
  }
  const count = imageArray.length;
  const averageRating = imageArray.reduce((acc, i) => acc + i.rating, 0) / count;
  const averageMatches = imageArray.reduce((acc, i) => acc + i.matches, 0) / count;
  res.json({ count, averageRating, averageMatches });
});

// Summary Stats for LoRAs
app.get('/api/summary/:subset/lora', (req, res) => {
  const subset = req.params.subset;
  if (!subsets[subset]) return res.status(404).json({ error: 'Subset not found' });

  const { loraModels } = subsets[subset];
  const loraArray = Object.values(loraModels);
  if (loraArray.length === 0) {
    return res.json({ count: 0, averageRating: 0, averageMatches: 0 });
  }
  const count = loraArray.length;
  const averageRating = loraArray.reduce((acc, i) => acc + i.rating, 0) / count;
  const averageMatches = loraArray.reduce((acc, i) => acc + i.matches, 0) / count;
  res.json({ count, averageRating, averageMatches });
});

// ------------- CSV Export & Summaries for normal images -------------

/** Export normal images as CSV */
app.get('/api/export-normal/:subset/csv', (req, res) => {
  const subset = req.params.subset;
  if (!normalSubsets[subset]) return res.status(404).json({ error: 'Normal subset not found' });

  const { images } = normalSubsets[subset];
  const headers = ['image', 'rating', 'matches'];
  const rows = Object.keys(images).map(img => [
    img,
    images[img].rating,
    images[img].matches
  ]);

  const csv = [headers.join(','), ...rows.map(r => r.map(escapeCSV).join(','))].join('\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename=normal-${subset}.csv`);
  res.send(csv);
});

/** Summary stats for normal images */
app.get('/api/summary-normal/:subset', (req, res) => {
  const subset = req.params.subset;
  if (!normalSubsets[subset]) return res.status(404).json({ error: 'Normal subset not found' });

  const { images } = normalSubsets[subset];
  const imageArray = Object.values(images);
  if (imageArray.length === 0) {
    return res.json({ count: 0, averageRating: 0, averageMatches: 0 });
  }
  const count = imageArray.length;
  const averageRating = imageArray.reduce((acc, i) => acc + i.rating, 0) / count;
  const averageMatches = imageArray.reduce((acc, i) => acc + i.matches, 0) / count;
  res.json({ count, averageRating, averageMatches });
});

// Refresh without restarting server
app.post('/api/refresh', (req, res) => {
  try {
    // Clear existing subsets
    subsets = {};
    normalSubsets = {};

    // Reload all subsets from the directories
    loadAllSubsets();
    loadAllNormalSubsets();

    res.json({ message: 'Directories refreshed successfully.' });
  } catch (err) {
    console.error('Error refreshing directories:', err);
    res.status(500).json({ error: 'Failed to refresh directories.' });
  }
});


app.listen(3000, () => {
  console.log('Server running on port 3000. Open http://localhost:3000 in your browser.');
});
