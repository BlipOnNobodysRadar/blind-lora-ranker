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

// Serve frontend files
app.use(express.static(FRONTEND_DIR));
app.use('/images', express.static(IMAGES_DIR));

// subsets = {
//   subsetName: {
//     images: { imageName: { rating: Number, matches: Number, lora: String } },
//     loraModels: { loraName: { rating: Number, matches: Number } }
//   }
// }
let subsets = {};

// Load all subsets at startup
loadAllSubsets();

function loadAllSubsets() {
  const allSubsets = fs.readdirSync(IMAGES_DIR)
    .filter(dir => fs.statSync(path.join(IMAGES_DIR, dir)).isDirectory());

  allSubsets.forEach(subset => {
    loadSubset(subset);
  });
}

function loadSubset(subset) {
  const subsetPath = path.join(IMAGES_DIR, subset);
  const files = fs.readdirSync(subsetPath)
    .filter(file => file.toLowerCase().endsWith('.png'));

  // Load previous ratings if available
  let savedData = { ratings: {}, matchCount: {}, loraModelRatings: {} };
  const ratingFile = `ratings-${subset}.json`;
  if (fs.existsSync(ratingFile)) {
    savedData = JSON.parse(fs.readFileSync(ratingFile, 'utf8'));
  }

  let images = {};
  let loraModels = {};

  for (const file of files) {
    const metadata = getPngMetadata(path.join(subsetPath, file));
    const loraMatch = metadata.match(/<lora:([^:]+):/);
    if (!loraMatch) {
      // Skip images without LoRA metadata
      continue;
    }

    const loraModel = loraMatch[1];
    const imageRating = savedData.ratings[file] !== undefined 
      ? savedData.ratings[file] 
      : 1000;
    const imageMatches = savedData.matchCount[file] || 0;

    images[file] = {
      rating: imageRating,
      matches: imageMatches,
      lora: loraModel
    };

    if (!loraModels[loraModel]) {
      const loraRating = savedData.loraModelRatings[loraModel]?.rating || 1000;
      const loraMatches = savedData.loraModelRatings[loraModel]?.count || 0;
      loraModels[loraModel] = {
        rating: loraRating,
        matches: loraMatches
      };
    }
  }

  subsets[subset] = { images, loraModels };
}

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

// Elo calculation helpers
function updateRatings(winner, loser) {
  const getK = (matches) => {
    if (matches < 10) return 64;
    if (matches < 20) return 48;
    if (matches < 30) return 32;
    return 24;
  };

  const kWinner = getK(winner.matches || 0);
  const kLoser = getK(loser.matches || 0);

  const expectedWinner = 1 / (1 + Math.pow(10, ((loser.rating || 0) - (winner.rating || 0)) / 400));

  winner.rating = (winner.rating || 0) + kWinner * (1 - expectedWinner);
  loser.rating = (loser.rating || 0) + kLoser * (0 - expectedWinner);

  winner.matches = (winner.matches || 0) + 1;
  loser.matches = (loser.matches || 0) + 1;
}

function selectPair(images) {
  const keys = Object.keys(images);
  if (keys.length < 2) return [];

  const getPriority = (img1, img2) => {
    const matchScore = 1 / (Math.min(images[img1].matches || 1, images[img2].matches || 1));
    const ratingDiff = Math.abs((images[img1].rating || 0) - (images[img2].rating || 0));
    return matchScore * (1000 - ratingDiff);
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

  fs.writeFileSync(`ratings-${subset}.json`, JSON.stringify({
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
  if (!subsets[subset]) return res.status(404).json({ error: 'Subset not found' });

  const pair = selectPair(subsets[subset].images);
  if (pair.length < 2) {
    return res.status(400).json({ error: 'Not enough images to form a pair' });
  }

  res.json({ image1: pair[0], image2: pair[1] });
});

app.post('/api/vote/:subset', (req, res) => {
  const subset = req.params.subset;
  const { winner, loser } = req.body;
  if (!subsets[subset]) return res.status(404).json({ error: 'Subset not found' });

  const { images, loraModels } = subsets[subset];
  if (!images[winner] || !images[loser]) {
    return res.status(400).json({ error: 'Invalid winner/loser image' });
  }

  // Update image ratings
  updateRatings(images[winner], images[loser]);

  const winnerLora = images[winner].lora;
  const loserLora = images[loser].lora;

  // Update Lora models if different
  if (winnerLora && loserLora && winnerLora !== loserLora) {
    updateRatings(loraModels[winnerLora], loraModels[loserLora]);
  }

  saveSubsetRatings(subset);
  res.json({ message: 'Vote recorded' });
});

app.get('/api/elo-rankings/:subset', (req, res) => {
  const subset = req.params.subset;
  if (!subsets[subset]) return res.status(404).json({ error: 'Subset not found' });

  const { images } = subsets[subset];
  const ranked = Object.keys(images)
    .sort((a, b) => images[b].rating - images[a].rating)
    .map(img => ({ image: img, rating: images[img].rating, matches: images[img].matches }));

  res.json(ranked);
});

app.get('/api/lora-rankings/:subset', (req, res) => {
  const subset = req.params.subset;
  if (!subsets[subset]) return res.status(404).json({ error: 'Subset not found' });

  const { loraModels } = subsets[subset];
  const ranked = Object.keys(loraModels)
    .sort((a, b) => loraModels[b].rating - loraModels[a].rating)
    .map(lm => ({ lora: lm, rating: loraModels[lm].rating, matches: loraModels[lm].matches }));

  res.json(ranked);
});

app.delete('/api/image/:subset/:image', (req, res) => {
  const { subset, image } = req.params;
  if (!subsets[subset]) return res.status(404).json({ error: 'Subset not found' });

  const { images } = subsets[subset];
  if (!images[image]) return res.status(400).json({ error: 'Image not found in subset' });

  const imagePath = path.join(IMAGES_DIR, subset, image);
  if (fs.existsSync(imagePath)) {
    fs.unlinkSync(imagePath);
  }

  // Remove from memory and save
  delete images[image];
  saveSubsetRatings(subset);

  res.json({ message: 'Image deleted' });
});

app.get('/api/progress/:subset', (req, res) => {
  const subset = req.params.subset;
  if (!subsets[subset]) return res.status(404).json({ error: 'Subset not found' });

  const { images } = subsets[subset];
  const imageList = Object.values(images);
  if (imageList.length === 0) {
    return res.json({ minimalMatches: 0, totalImages: 0 });
  }

  // Find the minimal number of matches across all images
  const minimalMatches = imageList.reduce((minVal, img) => {
    return Math.min(minVal, img.matches || 0);
  }, Infinity);

  const totalImages = imageList.length;
  res.json({ minimalMatches, totalImages });
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

// Summary Statistics
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
  console.log('Server running on port 3000');
});
