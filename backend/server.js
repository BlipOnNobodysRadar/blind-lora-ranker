const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const pngMetadata = require('png-metadata');

const app = express();
app.use(bodyParser.json());

// Directories
const IMAGES_DIR = path.join(__dirname, '../images');
const FRONTEND_DIR = path.join(__dirname, '../frontend');
const DATA_DIR = path.join(__dirname, '../data');

// In-memory subsets structure:
// subsets = {
//   subsetName: {
//     images: {
//       imageName: { rating: Number, matches: Number, lora: String }
//     },
//     loraModels: {
//       loraName: { rating: Number, matches: Number }
//     }
//   }
// }
let subsets = {};

// Ensure required directories exist
if (!fs.existsSync(IMAGES_DIR)) {
  fs.mkdirSync(IMAGES_DIR);
  console.log('Created images directory. Add subdirectories with PNGs to rate.');
}

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR);
  console.log('Created data directory for ratings storage.');
}

// Load subsets at startup
loadAllSubsets();

// Serve frontend files
app.use(express.static(FRONTEND_DIR));
app.use('/images', express.static(IMAGES_DIR));

/**
 * Loads all subsets from the /images directory.
 */
function loadAllSubsets() {
  if (!fs.existsSync(IMAGES_DIR)) {
    console.log('Images directory not found. Creating empty directory.');
    fs.mkdirSync(IMAGES_DIR);
    return;
  }

  const allSubsets = fs.readdirSync(IMAGES_DIR)
    .filter(dir => {
      const dirPath = path.join(IMAGES_DIR, dir);
      return fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory();
    });

  if (allSubsets.length === 0) {
    console.log('\nNo image subdirectories found. Instructions:\n');
    console.log('1. Create subdirectories in the "images" folder.');
    console.log('2. Add PNG images with LoRA metadata into those subdirectories.');
    console.log('Example:');
    console.log('images/');
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
 * Loads a single subset and its ratings from disk, if available.
 * @param {string} subset - The subset name
 */
function loadSubset(subset) {
  const subsetPath = path.join(IMAGES_DIR, subset);
  const files = fs.readdirSync(subsetPath).filter(file => file.toLowerCase().endsWith('.png'));

  // Load saved ratings if available
  let savedData = { ratings: {}, matchCount: {}, loraModelRatings: {} };
  const ratingFile = path.join(DATA_DIR, `ratings-${subset}.json`);
  if (fs.existsSync(ratingFile)) {
    savedData = JSON.parse(fs.readFileSync(ratingFile, 'utf8'));
  }

  let images = {};
  let loraModels = {};

  for (const file of files) {
    const metadata = getPngMetadata(path.join(subsetPath, file));
    const loraMatch = metadata.match(/<lora:([^:]+):/);

    // If no LoRA metadata found, we skip to avoid polluting results.
    if (!loraMatch) continue;

    const loraModel = loraMatch[1];
    const imageRating = savedData.ratings[file] !== undefined ? savedData.ratings[file] : 1000;
    const imageMatches = savedData.matchCount[file] || 0;

    images[file] = {
      rating: imageRating,
      matches: imageMatches,
      lora: loraModel
    };

    if (!loraModels[loraModel]) {
      const loraRating = savedData.loraModelRatings[loraModel]?.rating || 1000;
      const loraMatches = savedData.loraModelRatings[loraModel]?.count || 0;
      loraModels[loraModel] = { rating: loraRating, matches: loraMatches };
    }
  }

  subsets[subset] = { images, loraModels };
}

/**
 * Extracts PNG metadata as a string.
 * @param {string} imagePath - Path to the PNG image
 * @returns {string} - Extracted parameters or empty string if not found
 */
function getPngMetadata(imagePath) {
  try {
    const buffer = pngMetadata.readFileSync(imagePath);
    const chunks = pngMetadata.splitChunk(buffer);
    const textChunks = chunks.filter(c => c.type === 'tEXt');
    const parametersChunk = textChunks.find(c => c.data.includes('parameters'));
    return parametersChunk ? parametersChunk.data : '';
  } catch {
    return '';
  }
}

/**
 * Updates Elo ratings for two entities (images or LoRAs).
 * @param {object} winner - Object with {rating, matches}
 * @param {object} loser - Object with {rating, matches}
 */
function updateRatings(winner, loser) {
  const getKFactor = (matches) => {
    // Dynamic K-factor: Higher for fewer matches, stabilizes with more matches
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
 * Selects an optimal pair of images to rate based on their match counts and rating differences.
 * Tries to avoid selecting images from the same LoRA model.
 * @param {object} images - Map of image filenames to their data
 * @returns {string[]} - An array containing two image filenames to compare
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

    // Apply a penalty if both images are from the same LoRA
    if (images[img1].lora === images[img2].lora) {
      score *= 0.9; // reduce the score by 10%, adjust this factor as needed
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
 * Saves the updated ratings and matches for a subset to disk.
 * @param {string} subset - The subset name
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

// Routes
app.get('/api/subsets', (req, res) => {
  res.json(Object.keys(subsets));
});

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

  // Update LoRA model ratings if we have distinct LoRAs
  if (winnerLora && loserLora && winnerLora !== loserLora) {
    updateRatings(loraModels[winnerLora], loraModels[loserLora]);
  }

  saveSubsetRatings(subset);
  res.json({ message: 'Vote recorded successfully.' });
});

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

app.delete('/api/image/:subset/:image', (req, res) => {
  const { subset, image } = req.params;
  if (!subsets[subset]) return res.status(404).json({ error: 'Subset not found' });

  const { images } = subsets[subset];
  if (!images[image]) return res.status(400).json({ error: 'Image not found in this subset.' });

  const imagePath = path.join(IMAGES_DIR, subset, image);
  if (fs.existsSync(imagePath)) {
    fs.unlinkSync(imagePath);
  }

  delete images[image];
  saveSubsetRatings(subset);

  res.json({ message: 'Image deleted successfully.' });
});

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

// CSV Export for Images
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

  const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename=${subset}-images.csv`);
  res.send(csv);
});

// CSV Export for LoRA Models
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

  const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename=${subset}-lora.csv`);
  res.send(csv);
});

// Summary Statistics for Images
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

// Summary Statistics for LoRAs
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

app.listen(3000, () => {
  console.log('Server running on port 3000. Open http://localhost:3000 in your browser.');
});
