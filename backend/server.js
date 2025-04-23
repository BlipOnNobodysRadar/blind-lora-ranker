// backend/server.js

// --- Core Modules ---
const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const fsPromises = require('fs').promises;
const path = require('path');

// --- Third-party Modules ---
const pngMetadata = require('png-metadata');

// --- Application Setup ---
const app = express();
app.use(bodyParser.json());

// --- Constants & Global Variables ---
const AI_IMAGES_DIR = path.join(__dirname, '../AI_images');
const NORMAL_IMAGES_DIR = path.join(__dirname, '../normal_images');
const FRONTEND_DIR = path.join(__dirname, '../frontend');
const DATA_DIR = path.join(__dirname, '../data');

let subsets = {}; // In-memory store for AI subsets
let normalSubsets = {}; // In-memory store for Normal subsets

// --- Initial Setup ---
ensureDirectoriesExist();
loadAllSubsets(); // Load AI subsets (incl. offline)
loadAllNormalSubsets(); // Load Normal subsets

// --- Static File Serving ---
app.use(express.static(FRONTEND_DIR)); // Serve HTML, CSS, JS
app.use('/images', express.static(AI_IMAGES_DIR)); // Serve AI images (if dir exists)
app.use('/normal-images', express.static(NORMAL_IMAGES_DIR)); // Serve Normal images

// ========================================
// --- API Routes ---
// ========================================

// --- AI Subset Routes ---

// GET /api/subsets - List available AI subsets (incl. offline)
app.get('/api/subsets', (req, res) => {
    const sortedSubsetNames = Object.keys(subsets).sort((a, b) => a.localeCompare(b));
    res.json(sortedSubsetNames);
});

// GET /api/match/:subset - Get match pair or seeding info for AI subset
app.get('/api/match/:subset', (req, res) => {
    const subset = req.params.subset;
    const subsetData = subsets[subset];
    if (!subsetData) return res.status(404).json({ error: 'AI subset not found' });

    const check = checkForUninitialized('ai', subset);
    if (check.error) return res.status(404).json({ error: check.error });

    if (check.requiresSeeding) {
        if (check.uninitializedImages.length === 0) {
            return res.status(400).json({ error: 'Seeding required but no uninitialized images found.' });
        }
        shuffleArray(check.uninitializedImages); // Shuffle for seeding view
        return res.json({ requiresSeeding: true, uninitializedImages: check.uninitializedImages });
    }

    const pair = selectPair(subsetData.images);
    if (pair.length < 2) {
        return res.status(400).json({ error: 'Not enough initialized images to form a pair.' });
    }
    res.json({ image1: pair[0], image2: pair[1] });
});

// POST /api/vote/:subset - Record a vote for an AI subset match
app.post('/api/vote/:subset', (req, res) => {
    const subset = req.params.subset;
    const { winner, loser } = req.body;

    if (!subsets[subset]) return res.status(404).json({ error: 'Subset not found' });
    const { images, loraModels } = subsets[subset];

    if (!images[winner] || !images[loser]) {
        return res.status(400).json({ error: 'Invalid winner/loser image provided.' });
    }
    if (images[winner]?.rating === null || images[loser]?.rating === null) {
        return res.status(400).json({ error: 'Cannot vote on unseeded images.' });
    }

    // Update image ratings
    updateRatings(images[winner], images[loser]);

    // Update LoRA model ratings if applicable
    const winnerLora = images[winner].lora;
    const loserLora = images[loser].lora;
    if (winnerLora && loserLora && winnerLora !== loserLora && loraModels[winnerLora] && loraModels[loserLora]) {
        updateRatings(loraModels[winnerLora], loraModels[loserLora]);
    } // Add warnings for missing LoRAs if desired

    saveSubsetRatings(subset);
    res.json({ message: 'Vote recorded successfully.' });
});

// POST /api/seed-ratings/ai/:subset - Seed initial ratings for AI subset images
app.post('/api/seed-ratings/ai/:subset', (req, res) => {
    const subset = req.params.subset;
    const { ratings } = req.body; // { imageName: starRating, ... }

    if (!subsets[subset]) return res.status(404).json({ error: 'AI subset not found' });
    const subsetImages = subsets[subset].images;
    let imagesSeededCount = 0;

    for (const imageName in ratings) {
        const starRating = ratings[imageName];
        if (subsetImages[imageName] && subsetImages[imageName].rating === null) {
            if (typeof starRating === 'number' && starRating >= 1 && starRating <= 10) {
                subsetImages[imageName].rating = starToElo(starRating);
                subsetImages[imageName].matches = 0;
                imagesSeededCount++;
            } // Add warnings for invalid ratings if desired
        } // Add warnings for already seeded or non-existent images if desired
    }

    if (imagesSeededCount > 0) {
        saveSubsetRatings(subset);
        res.json({ message: `Seeded ${imagesSeededCount} images in AI subset "${subset}".` });
    } else {
        res.status(400).json({ message: 'No valid uninitialized AI images with ratings provided.' });
    }
});

// GET /api/elo-rankings/:subset - Get ranked list of AI images
app.get('/api/elo-rankings/:subset', (req, res) => {
    const subset = req.params.subset;
    if (!subsets[subset]) return res.status(404).json({ error: 'Subset not found' });

    const { images } = subsets[subset];
    const ranked = Object.keys(images)
        .filter(img => images[img].rating !== null)
        .map(img => ({
            image: img,
            rating: images[img].rating,
            matches: images[img].matches,
            lora: images[img].lora
        }))
        .sort((a, b) => b.rating - a.rating);
    res.json(ranked);
});

// GET /api/lora-rankings/:subset - Get ranked list of LoRAs within an AI subset
app.get('/api/lora-rankings/:subset', (req, res) => {
    const subset = req.params.subset;
    if (!subsets[subset]) {
        console.warn(`Request for LoRA rankings for unknown AI subset: ${subset}`);
        return res.status(404).json({ error: `AI Subset '${subset}' not found.` });
    }

    const { loraModels } = subsets[subset];
    if (!loraModels || Object.keys(loraModels).length === 0) {
        return res.json([]); // No LoRAs to rank
    }

    const ranked = Object.keys(loraModels)
        .map(lm => ({
            lora: lm,
            rating: loraModels[lm]?.rating ?? 1000,
            matches: loraModels[lm]?.matches ?? 0
        }))
        .sort((a, b) => b.rating - a.rating);
    res.json(ranked);
});

// DELETE /api/image/:subset/:image - Delete an AI image file and its data
app.delete('/api/image/:subset/:image', (req, res) => {
    const { subset, image } = req.params;
    if (!subsets[subset]) return res.status(404).json({ error: 'Subset not found' });
    if (!subsets[subset].images[image]) return res.status(400).json({ error: 'Image not found in subset data.' });

    const imagePath = path.join(AI_IMAGES_DIR, subset, image);
    fs.unlink(imagePath, (err) => { // Attempt to delete file
        if (err && err.code !== 'ENOENT') { // Log error unless file simply wasn't there
            console.error(`Error deleting file ${imagePath}:`, err);
        }
        // Always remove from internal data regardless of file deletion success
        delete subsets[subset].images[image];
        // TODO: Consider recalculating LoRA stats if needed, or just let them naturally adjust
        saveSubsetRatings(subset); // Save updated data
        res.json({ message: 'Image deleted successfully.', deletedFile: !err || err?.code === 'ENOENT' });
    });
});

// GET /api/progress/:subset - Get match progress for an AI subset
app.get('/api/progress/:subset', (req, res) => {
    const subset = req.params.subset;
    if (!subsets[subset]) return res.status(404).json({ error: 'Subset not found' });

    const { images } = subsets[subset];
    const initializedImages = Object.values(images).filter(img => img.rating !== null);
    const initializedCount = initializedImages.length;
    const totalCount = Object.keys(images).length;

    if (initializedCount === 0) {
        return res.json({ minimalMatches: 0, totalImages: totalCount, initializedImagesCount: 0 });
    }

    const minimalMatches = initializedImages.reduce((minVal, img) => Math.min(minVal, img.matches || 0), Infinity);
    res.json({ minimalMatches, totalImages: totalCount, initializedImagesCount: initializedCount });
});


// --- Normal Subset Routes ---

// GET /api/normal-subsets - List available Normal subsets
app.get('/api/normal-subsets', (req, res) => {
    res.json(Object.keys(normalSubsets).sort((a, b) => a.localeCompare(b)));
});

// GET /api/normal-match/:subset - Get match pair or seeding info for Normal subset
app.get('/api/normal-match/:subset', (req, res) => {
    const subset = req.params.subset;
    const subsetData = normalSubsets[subset];
    if (!subsetData) return res.status(404).json({ error: 'Normal subset not found' });

    const check = checkForUninitialized('normal', subset);
    if (check.error) return res.status(404).json({ error: check.error });

    if (check.requiresSeeding) {
        if (check.uninitializedImages.length === 0) {
            return res.status(400).json({ error: 'Seeding required but no uninitialized images found.' });
        }
        shuffleArray(check.uninitializedImages);
        return res.json({ requiresSeeding: true, uninitializedImages: check.uninitializedImages });
    }

    const pair = selectPair(subsetData.images);
    if (pair.length < 2) {
        return res.status(400).json({ error: 'Not enough initialized images to form a pair.' });
    }
    res.json({ image1: pair[0], image2: pair[1] });
});

// POST /api/normal-vote/:subset - Record a vote for a Normal subset match
app.post('/api/normal-vote/:subset', (req, res) => {
    const subset = req.params.subset;
    const { winner, loser } = req.body;

    if (!normalSubsets[subset]) return res.status(404).json({ error: 'Normal subset not found' });
    const { images } = normalSubsets[subset];

    if (!images[winner] || !images[loser]) {
        return res.status(400).json({ error: 'Invalid winner/loser image provided.' });
    }
    if (images[winner]?.rating === null || images[loser]?.rating === null) {
        return res.status(400).json({ error: 'Cannot vote on unseeded images.' });
    }

    updateRatings(images[winner], images[loser]);
    saveNormalSubsetRatings(subset);
    res.json({ message: 'Vote recorded for normal images.' });
});

// POST /api/seed-ratings/normal/:subset - Seed initial ratings for Normal subset images
app.post('/api/seed-ratings/normal/:subset', (req, res) => {
    const subset = req.params.subset;
    const { ratings } = req.body;

    if (!normalSubsets[subset]) return res.status(404).json({ error: 'Normal subset not found' });
    const subsetImages = normalSubsets[subset].images;
    let imagesSeededCount = 0;

    for (const imageName in ratings) {
        const starRating = ratings[imageName];
        if (subsetImages[imageName] && subsetImages[imageName].rating === null) {
            if (typeof starRating === 'number' && starRating >= 1 && starRating <= 10) {
                subsetImages[imageName].rating = starToElo(starRating);
                subsetImages[imageName].matches = 0;
                imagesSeededCount++;
            }
        }
    }

    if (imagesSeededCount > 0) {
        saveNormalSubsetRatings(subset);
        res.json({ message: `Seeded ${imagesSeededCount} images in normal subset "${subset}".` });
    } else {
        res.status(400).json({ message: 'No valid uninitialized normal images with ratings provided.' });
    }
});

// GET /api/normal-elo-rankings/:subset - Get ranked list of Normal images
app.get('/api/normal-elo-rankings/:subset', (req, res) => {
    const subset = req.params.subset;
    if (!normalSubsets[subset]) return res.status(404).json({ error: 'Normal subset not found' });

    const { images } = normalSubsets[subset];
    const ranked = Object.keys(images)
        .filter(img => images[img].rating !== null)
        .map(img => ({
            image: img,
            rating: images[img].rating,
            matches: images[img].matches
        }))
        .sort((a, b) => b.rating - a.rating);
    res.json(ranked);
});

// DELETE /api/normal-image/:subset/:image - Delete a Normal image file and its data
app.delete('/api/normal-image/:subset/:image', (req, res) => {
    const { subset, image } = req.params;
    if (!normalSubsets[subset]) return res.status(404).json({ error: 'Normal subset not found' });
    if (!normalSubsets[subset].images[image]) return res.status(400).json({ error: 'Image not found in normal subset data.' });

    const imagePath = path.join(NORMAL_IMAGES_DIR, subset, image);
    fs.unlink(imagePath, (err) => {
        if (err && err.code !== 'ENOENT') {
             console.error(`Error deleting file ${imagePath}:`, err);
        }
        delete normalSubsets[subset].images[image];
        saveNormalSubsetRatings(subset);
        res.json({ message: 'Normal image deleted successfully.', deletedFile: !err || err?.code === 'ENOENT' });
    });
});

// GET /api/normal-progress/:subset - Get match progress for a Normal subset
app.get('/api/normal-progress/:subset', (req, res) => {
    const subset = req.params.subset;
    if (!normalSubsets[subset]) return res.status(404).json({ error: 'Normal subset not found' });

    const { images } = normalSubsets[subset];
    const initializedImages = Object.values(images).filter(img => img.rating !== null);
    const initializedCount = initializedImages.length;
    const totalCount = Object.keys(images).length;

    if (initializedCount === 0) {
        return res.json({ minimalMatches: 0, totalImages: totalCount, initializedImagesCount: 0 });
    }

    const minimalMatches = initializedImages.reduce((minVal, img) => Math.min(minVal, img.matches || 0), Infinity);
    res.json({ minimalMatches, totalImages: totalCount, initializedImagesCount: initializedCount });
});

// --- Tagging Route ---

// POST /api/apply-tags/normal/:subset - Apply aesthetic tags based on Elo
app.post('/api/apply-tags/normal/:subset', async (req, res) => {
    const subset = req.params.subset;
    const {
        strategy = 'customQuantile', // customQuantile, equalQuantile, ponyQuantile, stdDev
        tagPrefix = 'aesthetic_rating_',
        binTags = ['terrible', 'bad', 'average', 'good', 'excellent'], // Default/Passed from frontend
        numBins, // Only used for 'equalQuantile' strategy
    } = req.body;

    console.log(`Request: Apply tags for normal subset: ${subset}, Strategy: ${strategy}, Prefix: ${tagPrefix}, Tags: ${binTags.join(',')}, NumBins: ${numBins || 'N/A'}`);

    if (!normalSubsets[subset]) return res.status(404).json({ error: 'Normal subset not found' });

    const { images } = normalSubsets[subset];
    const ratedImages = Object.entries(images)
                              .filter(([_, data]) => data.rating !== null && typeof data.rating === 'number')
                              .map(([name, data]) => ({ name, rating: data.rating }));

    if (ratedImages.length === 0) return res.status(400).json({ error: `No rated images found in subset "${subset}".` });

    let imageTags = {};
    let strategyUsed = strategy;

    try {
        if (strategy === 'customQuantile') {
            if (binTags.length !== 5) throw new Error('Custom Quantile strategy requires exactly 5 tag names.');
            if (ratedImages.length < 5) throw new Error(`Need at least 5 rated images for Custom Quantile.`);
            ratedImages.sort((a, b) => a.rating - b.rating);
            const sortedScores = ratedImages.map(img => img.rating);
            const customQuantiles = [0.1, 0.3, 0.7, 0.9, 1.0];
            ratedImages.forEach(img => imageTags[img.name] = getTagFromQuantiles(img.rating, sortedScores, binTags, customQuantiles));
        } else if (strategy === 'ponyQuantile') {
            strategyUsed = 'ponyQuantile (Equal 7 Bins)';
            const ponyTags = ['score_3', 'score_4', 'score_5', 'score_6', 'score_7', 'score_8', 'score_9'];
            if (ratedImages.length < 7) throw new Error(`Need at least 7 rated images for Pony scoring.`);
            ratedImages.sort((a, b) => a.rating - b.rating);
            const sortedScores = ratedImages.map(img => img.rating);
            const ponyQuantiles = Array.from({ length: 7 }, (_, i) => (i + 1) / 7);
            ratedImages.forEach(img => imageTags[img.name] = getTagFromQuantiles(img.rating, sortedScores, ponyTags, ponyQuantiles));
        } else if (strategy === 'equalQuantile') {
            const currentNumBins = parseInt(numBins, 10);
            if (!currentNumBins || currentNumBins < 2) throw new Error('Number of bins must be at least 2.');
            if (binTags.length !== currentNumBins) throw new Error(`Number of tag names (${binTags.length}) must match bins (${currentNumBins}).`);
            if (ratedImages.length < currentNumBins) throw new Error(`Need at least ${currentNumBins} rated images.`);
            ratedImages.sort((a, b) => a.rating - b.rating);
            const sortedScores = ratedImages.map(img => img.rating);
            const equalQuantiles = Array.from({ length: currentNumBins }, (_, i) => (i + 1) / currentNumBins);
            ratedImages.forEach(img => imageTags[img.name] = getTagFromQuantiles(img.rating, sortedScores, binTags, equalQuantiles));
        } else if (strategy === 'stdDev') {
            if (binTags.length !== 5 && binTags.length !== 7) throw new Error('Std Dev strategy requires 5 or 7 tags.');
            if (ratedImages.length < 2) throw new Error(`Need at least 2 rated images for Std Dev.`);
            const scores = ratedImages.map(img => img.rating);
            const { mean, stdDev } = calculateMeanStdDev(scores);
            ratedImages.forEach(img => imageTags[img.name] = getTagFromStdDev(img.rating, mean, stdDev, binTags));
        } else {
            throw new Error(`Unknown tagging strategy: ${strategy}`);
        }
    } catch (calcError) {
        return res.status(400).json({ error: `Calculation Error: ${calcError.message}` });
    }

    // Process files...
    let processedCount = 0;
    let errorCount = 0;
    const tagCounts = {};
    const subsetPath = path.join(NORMAL_IMAGES_DIR, subset);

    for (const img of ratedImages) {
        const imageName = img.name;
        const assignedTag = imageTags[imageName];
        const finalTagValue = (strategy === 'ponyQuantile') ? assignedTag : binTags.find(t => t === assignedTag);

        if (!finalTagValue) continue; // Skip if tag assignment failed

        const fullTag = tagPrefix + finalTagValue;
        tagCounts[finalTagValue] = (tagCounts[finalTagValue] || 0) + 1;
        const baseName = path.parse(imageName).name;
        const txtFilePath = path.join(subsetPath, `${baseName}.txt`);

        try {
            let currentContent = '';
            try { currentContent = await fsPromises.readFile(txtFilePath, 'utf8'); }
            catch (readError) { if (readError.code !== 'ENOENT') throw readError; }

            let tags = currentContent.split(',').map(t => t.trim()).filter(t => t && !t.startsWith(tagPrefix));
            tags.push(fullTag);
            await fsPromises.writeFile(txtFilePath, tags.join(', '), 'utf8');
            processedCount++;
        } catch (err) {
            console.error(`Error processing file for ${imageName} (${txtFilePath}):`, err);
            errorCount++;
        }
    }

    const message = `Tagging complete for subset "${subset}" using strategy "${strategyUsed}". Processed: ${processedCount}, Errors: ${errorCount}.`;
    console.log(message, "Tag counts:", tagCounts);
    res.json({ message, processed: processedCount, errors: errorCount, tagCounts });
});


// --- Export Routes ---

// GET /api/export/:subset/images/csv - Export AI Image data
app.get('/api/export/:subset/images/csv', (req, res) => {
    const subset = req.params.subset;
    if (!subsets[subset]) return res.status(404).json({ error: 'Subset not found' });
    const { images } = subsets[subset];
    const headers = ['image', 'lora', 'rating', 'matches'];
    const rows = Object.entries(images)
        .filter(([_, data]) => data.rating !== null)
        .map(([name, data]) => [name, data.lora, data.rating, data.matches]);

    const csv = [headers.join(','), ...rows.map(r => r.map(escapeCSV).join(','))].join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=${subset}-images.csv`);
    res.send(csv);
});

// GET /api/export/:subset/lora/csv - Export AI LoRA data
app.get('/api/export/:subset/lora/csv', (req, res) => {
    const subset = req.params.subset;
    if (!subsets[subset]) return res.status(404).json({ error: 'Subset not found' });
    const { loraModels } = subsets[subset];
    const headers = ['lora', 'rating', 'matches'];
    const rows = Object.entries(loraModels)
        .map(([name, data]) => [name, data.rating, data.matches]);

    const csv = [headers.join(','), ...rows.map(r => r.map(escapeCSV).join(','))].join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=${subset}-lora.csv`);
    res.send(csv);
});

// GET /api/export-normal/:subset/csv - Export Normal Image data
app.get('/api/export-normal/:subset/csv', (req, res) => {
    const subset = req.params.subset;
    if (!normalSubsets[subset]) return res.status(404).json({ error: 'Normal subset not found' });
    const { images } = normalSubsets[subset];
    const headers = ['image', 'rating', 'matches'];
    const rows = Object.entries(images)
        .filter(([_, data]) => data.rating !== null)
        .map(([name, data]) => [name, data.rating, data.matches]);

    const csv = [headers.join(','), ...rows.map(r => r.map(escapeCSV).join(','))].join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=normal-${subset}.csv`);
    res.send(csv);
});


// --- Summary Routes ---

// GET /api/summary/:subset/images - Summary stats for AI Images
app.get('/api/summary/:subset/images', (req, res) => {
    const subset = req.params.subset;
    if (!subsets[subset]) return res.status(404).json({ error: 'Subset not found' });
    const initializedImages = Object.values(subsets[subset].images).filter(img => img.rating !== null);
    const count = initializedImages.length;
    if (count === 0) return res.json({ count: 0, averageRating: 0, averageMatches: 0 });
    const averageRating = initializedImages.reduce((acc, i) => acc + i.rating, 0) / count;
    const averageMatches = initializedImages.reduce((acc, i) => acc + i.matches, 0) / count;
    res.json({ count, averageRating, averageMatches });
});

// GET /api/summary/:subset/lora - Summary stats for AI LoRAs
app.get('/api/summary/:subset/lora', (req, res) => {
    const subset = req.params.subset;
    if (!subsets[subset]) return res.status(404).json({ error: 'Subset not found' });
    const loraArray = Object.values(subsets[subset].loraModels);
    const count = loraArray.length;
    if (count === 0) return res.json({ count: 0, averageRating: 0, averageMatches: 0 });
    const averageRating = loraArray.reduce((acc, i) => acc + i.rating, 0) / count;
    const averageMatches = loraArray.reduce((acc, i) => acc + i.matches, 0) / count;
    res.json({ count, averageRating, averageMatches });
});

// GET /api/summary-normal/:subset - Summary stats for Normal Images
app.get('/api/summary-normal/:subset', (req, res) => {
    const subset = req.params.subset;
    if (!normalSubsets[subset]) return res.status(404).json({ error: 'Normal subset not found' });
    const initializedImages = Object.values(normalSubsets[subset].images).filter(img => img.rating !== null);
    const count = initializedImages.length;
    if (count === 0) return res.json({ count: 0, averageRating: 0, averageMatches: 0 });
    const averageRating = initializedImages.reduce((acc, i) => acc + i.rating, 0) / count;
    const averageMatches = initializedImages.reduce((acc, i) => acc + i.matches, 0) / count;
    res.json({ count, averageRating, averageMatches });
});


// --- Utility Routes ---

// POST /api/refresh - Reload subsets from disk
app.post('/api/refresh', (req, res) => {
    try {
        console.log('Refreshing directories and data...');
        subsets = {}; // Clear current data
        normalSubsets = {};
        loadAllSubsets(); // Reload AI
        loadAllNormalSubsets(); // Reload Normal
        console.log('Reload complete.');
        res.json({ message: 'Subsets refreshed successfully.' });
    } catch (err) {
        console.error('Error during refresh:', err);
        res.status(500).json({ error: 'Failed to refresh subsets.' });
    }
});


// ========================================
// --- Helper Functions ---
// ========================================

// --- Directory/File System Helpers ---

function ensureDirectoriesExist() {
    [AI_IMAGES_DIR, NORMAL_IMAGES_DIR, DATA_DIR].forEach(dir => {
        if (!fs.existsSync(dir)) {
            try {
                fs.mkdirSync(dir, { recursive: true });
                console.log(`Created directory: ${dir}`);
            } catch (err) {
                console.error(`Failed to create directory ${dir}:`, err);
                // Depending on severity, you might want to exit here
            }
        }
    });
}

/** Saves AI subset ratings to JSON */
function saveSubsetRatings(subset) {
    if (!subsets[subset]) return;
    const { images, loraModels } = subsets[subset];
    const ratings = {};
    const matchCount = {};
    const loraModelRatings = {};

    Object.entries(images).forEach(([name, data]) => {
        if (data.rating !== null) {
            ratings[name] = data.rating;
            matchCount[name] = data.matches;
            // Include LoRA in saved image data? Maybe not needed if loaded from file/JSON loraModels
        }
    });

    Object.entries(loraModels).forEach(([name, data]) => {
        loraModelRatings[name] = { rating: data.rating, count: data.matches };
    });

    const ratingFile = path.join(DATA_DIR, `ratings-${subset}.json`);
    try {
        fs.writeFileSync(ratingFile, JSON.stringify({ ratings, matchCount, loraModelRatings }, null, 2));
    } catch (err) {
        console.error(`Failed to save AI ratings for ${subset}:`, err);
    }
}

/** Saves Normal subset ratings to JSON */
function saveNormalSubsetRatings(subset) {
    if (!normalSubsets[subset]) return;
    const { images } = normalSubsets[subset];
    const ratings = {};
    const matchCount = {};

    Object.entries(images).forEach(([name, data]) => {
        if (data.rating !== null) {
            ratings[name] = data.rating;
            matchCount[name] = data.matches;
        }
    });

    const ratingFile = path.join(DATA_DIR, `ratings-normal-${subset}.json`);
    try {
        fs.writeFileSync(ratingFile, JSON.stringify({ ratings, matchCount }, null, 2));
    } catch (err) {
        console.error(`Failed to save Normal ratings for ${subset}:`, err);
    }
}

// --- Subset Loading Helpers ---

/** Loads all AI subsets from disk (images and/or data files) */
function loadAllSubsets() {
    const discoveredSubsets = new Set();
    // Discover from AI_images dir
    if (fs.existsSync(AI_IMAGES_DIR)) {
        try {
            fs.readdirSync(AI_IMAGES_DIR)
              .filter(dir => { try { return fs.statSync(path.join(AI_IMAGES_DIR, dir)).isDirectory(); } catch { return false; } })
              .forEach(subset => discoveredSubsets.add(subset));
        } catch (err) { console.error(`Error reading AI_images directory: ${err.message}`); }
    }
    // Discover from data dir
    if (fs.existsSync(DATA_DIR)) {
        try {
           fs.readdirSync(DATA_DIR)
             .filter(file => /^ratings-(?!normal-).+\.json$/.test(file))
             .forEach(file => {
                 const match = file.match(/^ratings-(.+)\.json$/);
                 if (match?.[1]) discoveredSubsets.add(match[1]);
             });
       } catch(err) { console.error(`Error reading data directory: ${err.message}`); }
   }

    const allSubsetNames = Array.from(discoveredSubsets);
    if (allSubsetNames.length === 0) { console.log('\nNo AI subsets found.'); return; }

    console.log(`Loading AI subsets: ${allSubsetNames.join(', ')}`);
    allSubsetNames.forEach(loadSubset);
}

/** Loads a single AI subset (images + data) */
function loadSubset(subset) {
    console.log(`Loading AI subset "${subset}"...`);
    const subsetPath = path.join(AI_IMAGES_DIR, subset);
    const ratingFile = path.join(DATA_DIR, `ratings-${subset}.json`);
    let savedData = { ratings: {}, matchCount: {}, loraModelRatings: {} };
    let directoryExists = false;
    let files = [];

    if (fs.existsSync(ratingFile)) {
        try { savedData = JSON.parse(fs.readFileSync(ratingFile, 'utf8')); }
        catch (e) { console.error(`Error parsing ${ratingFile}:`, e.message); }
    }

    try {
        if (fs.existsSync(subsetPath) && fs.statSync(subsetPath).isDirectory()) {
            directoryExists = true;
            files = fs.readdirSync(subsetPath).filter(file => file.toLowerCase().endsWith('.png'));
        }
    } catch (dirErr) { console.warn(`Error accessing ${subsetPath}: ${dirErr.message}. Loading offline.`); }

    let images = {};
    let loraModels = {};

    // Init LoRAs from saved data
    if (savedData.loraModelRatings) {
        for (const loraName in savedData.loraModelRatings) {
            loraModels[loraName] = {
                rating: savedData.loraModelRatings[loraName]?.rating ?? 1000,
                matches: savedData.loraModelRatings[loraName]?.count ?? 0
            };
        }
    }

    // Process image files if directory exists
    if (directoryExists) {
        files.forEach(file => {
            const imagePath = path.join(subsetPath, file);
            const loraFromFile = getPngMetadata(imagePath);
            const savedRating = savedData.ratings?.[file] ?? null;
            const savedMatches = savedData.matchCount?.[file] ?? null;

            // Only track image if it has metadata OR was previously saved/rated
            if (loraFromFile || savedRating !== null) {
                images[file] = {
                    rating: savedRating,
                    matches: savedRating !== null ? (savedMatches ?? 0) : null,
                    lora: loraFromFile || (savedData.images?.[file]?.lora ?? '')
                };
                // Ensure LoRA model exists if found in file
                if (loraFromFile && loraFromFile !== 'NONE' && !loraModels[loraFromFile]) {
                    loraModels[loraFromFile] = { rating: 1000, matches: 0 };
                }
            }
        });
    }

    // Add images present only in saved data
    if (savedData.ratings) {
        for (const savedFile in savedData.ratings) {
            if (!images[savedFile]) { // If not loaded from directory
                images[savedFile] = {
                    rating: savedData.ratings[savedFile],
                    matches: savedData.matchCount?.[savedFile] ?? 0,
                    lora: savedData.images?.[savedFile]?.lora ?? ''
                };
                 // Ensure LoRA model exists if mentioned in saved image data (less reliable)
                 const savedLora = savedData.images?.[savedFile]?.lora;
                 if (savedLora && savedLora !== 'NONE' && !loraModels[savedLora]) {
                     // Check if this LoRA exists in loraModelRatings first
                     if (!savedData.loraModelRatings?.[savedLora]) {
                          loraModels[savedLora] = { rating: 1000, matches: 0 }; // Initialize if completely new
                     }
                 }
            }
        }
    }

    subsets[subset] = { images, loraModels };
    console.log(`Loaded AI subset "${subset}". Images: ${Object.keys(images).length}, LoRAs: ${Object.keys(loraModels).length}. Mode: ${directoryExists ? 'Online' : 'Offline'}`);
}


/** Loads all Normal subsets from disk */
function loadAllNormalSubsets() {
    if (!fs.existsSync(NORMAL_IMAGES_DIR)) return;
    try {
        fs.readdirSync(NORMAL_IMAGES_DIR)
            .filter(dir => { try { return fs.statSync(path.join(NORMAL_IMAGES_DIR, dir)).isDirectory(); } catch { return false; } })
            .forEach(loadNormalSubset);
    } catch (err) {
        console.error(`Error reading normal_images directory: ${err.message}`);
    }
}

/** Loads a single Normal subset */
function loadNormalSubset(subset) {
    const subsetPath = path.join(NORMAL_IMAGES_DIR, subset);
    const ratingFile = path.join(DATA_DIR, `ratings-normal-${subset}.json`);
    let savedData = { ratings: {}, matchCount: {} };
    let files = [];

    try { files = fs.readdirSync(subsetPath).filter(f => /\.(png|jpg|jpeg|webp|bmp|gif)$/i.test(f)); }
    catch(err) { console.error(`Error reading normal subset directory ${subsetPath}:`, err); return; }

    if (fs.existsSync(ratingFile)) {
        try { savedData = JSON.parse(fs.readFileSync(ratingFile, 'utf8')); }
        catch (e) { console.error(`Error parsing ${ratingFile}:`, e.message); }
    }

    let images = {};
    files.forEach(file => {
        const isInitialized = savedData.ratings?.hasOwnProperty(file);
        images[file] = {
            rating: isInitialized ? savedData.ratings[file] : null,
            matches: isInitialized ? (savedData.matchCount?.[file] ?? 0) : null,
            lora: ''
        };
    });

    normalSubsets[subset] = { images };
    console.log(`Loaded Normal subset "${subset}". Images: ${Object.keys(images).length}`);
}

// --- Metadata Parsing Helpers ---

function getPngMetadata(imagePath) {
    try {
        const buffer = pngMetadata.readFileSync(imagePath);
        const chunks = pngMetadata.splitChunk(buffer);
        const textChunks = chunks.filter(c => c.type === 'tEXt').map(c => parseTextChunk(c.data));

        const parametersChunk = textChunks.find(c => c.keyword === 'parameters');
        if (parametersChunk?.text) {
            const loraMatch = parametersChunk.text.match(/<lora:([^:]+):([^>]+)>/);
            if (loraMatch?.[1]) {
                const name = loraMatch[1].trim();
                const strength = loraMatch[2] || "";
                return name + (strength ? `:${strength}` : "");
            }
            return "NONE"; // Parameters exist, but no LoRA
        }

        const promptChunk = textChunks.find(c => c.keyword === 'prompt');
        if (promptChunk?.text) {
            try {
                const name = extractLoraFromComfyUI(JSON.parse(promptChunk.text));
                if (name) return name;
            } catch {}
        }

        const workflowChunk = textChunks.find(c => c.keyword === 'workflow');
        if (workflowChunk?.text) {
            try {
                const name = extractLoraFromWorkflow(JSON.parse(workflowChunk.text));
                if (name) return name;
            } catch {}
        }

        return ''; // No known metadata found
    } catch (err) {
        // Ignore errors like file not found during parsing if dir deleted mid-op
        if (err.code !== 'ENOENT') {
           console.error(`Error parsing PNG ${imagePath}:`, err.message);
        }
        return '';
    }
}

function parseTextChunk(dataBuffer) {
    const rawStr = dataBuffer.toString('latin1'); // Use latin1 for robustness
    const nullIndex = rawStr.indexOf('\0');
    if (nullIndex === -1) return { keyword: '', text: rawStr };
    return { keyword: rawStr.slice(0, nullIndex), text: rawStr.slice(nullIndex + 1) };
}

function extractLoraFromComfyUI(jsonData) {
    if (typeof jsonData !== 'object' || jsonData === null) return '';
    for (const key in jsonData) {
        const node = jsonData[key];
        if (node?.class_type === 'LoraLoader') {
            const name = extractNameFromLoraNode(node);
            if (name) return name;
        }
    }
    return '';
}

function extractLoraFromWorkflow(jsonData) {
    if (!jsonData?.nodes || !Array.isArray(jsonData.nodes)) return '';
    for (const node of jsonData.nodes) {
        if (node?.class_type === 'LoraLoader') {
            const name = extractNameFromLoraNode(node);
            if (name) return name;
        }
    }
    return '';
}

function extractNameFromLoraNode(node) {
    if (typeof node?.inputs?.lora_name === 'string') {
        return extractLoraNameFromPath(node.inputs.lora_name);
    }
    if (Array.isArray(node?.inputs?.lora_name) && typeof node.inputs.lora_name[0] === 'string') {
        return extractLoraNameFromPath(node.inputs.lora_name[0]);
    }
    if (Array.isArray(node?.widgets_values) && typeof node.widgets_values[0] === 'string') {
        return extractLoraNameFromPath(node.widgets_values[0]);
    }
    return '';
}

function extractLoraNameFromPath(loraPath) {
    if (typeof loraPath !== 'string') return '';
    let name = path.basename(loraPath); // Use path.basename for cross-platform safety
    name = name.replace(/\.(safetensors|ckpt|pt|bin)$/i, '');
    return name.trim();
}

// --- Elo Rating Helpers ---

/** Converts 1-10 star rating to initial Elo */
function starToElo(starRating) {
    starRating = Math.max(1, Math.min(10, starRating));
    return 1000 + (starRating - 5) * 100;
}

/** Updates Elo ratings for winner and loser */
function updateRatings(winner, loser) {
    const winnerRating = winner.rating ?? 1000; // Use 1000 if null
    const loserRating = loser.rating ?? 1000;
    const getK = (m) => (m === null || m < 10) ? 64 : (m < 20 ? 48 : (m < 30 ? 32 : 24));
    const kWinner = getK(winner.matches);
    const kLoser = getK(loser.matches);
    const expectedWinner = 1 / (1 + 10 ** ((loserRating - winnerRating) / 400));

    winner.rating = winnerRating + kWinner * (1 - expectedWinner);
    loser.rating = loserRating + kLoser * (0 - (1 - expectedWinner)); // Corrected expectedLoser = 1 - expectedWinner

    winner.matches = (winner.matches ?? 0) + 1;
    loser.matches = (loser.matches ?? 0) + 1;
}

// --- Matchmaking Helper ---

/** Selects the next pair for comparison */
function selectPair(images) {
    const keys = Object.keys(images).filter(img => images[img].rating !== null);
    if (keys.length < 2) return [];

    // Simplified random pair selection (replace with priority logic if needed)
    // For now, just pick two different random images
    let idx1 = Math.floor(Math.random() * keys.length);
    let idx2 = Math.floor(Math.random() * keys.length);
    while (idx2 === idx1) {
         idx2 = Math.floor(Math.random() * keys.length);
    }
    return [keys[idx1], keys[idx2]];
    // NOTE: Keep the original priority logic if you prefer that matchmaking method
    /*
    const getPriority = (img1, img2) => { ... }; // Original priority calculation
    let bestPair = [keys[0], keys[1]];
    let bestScore = getPriority(keys[0], keys[1]);
    // ... nested loops to find best pair ...
    return bestPair;
    */
}

/** Checks if a subset needs seeding */
function checkForUninitialized(subsetType, subsetName) {
    const subsetData = subsetType === 'ai' ? subsets[subsetName] : normalSubsets[subsetName];
    if (!subsetData) return { error: `${subsetType === 'ai' ? 'AI' : 'Normal'} subset not found` };
    const uninitialized = Object.keys(subsetData.images).filter(name => subsetData.images[name].rating === null);
    return { requiresSeeding: uninitialized.length > 0, uninitializedImages: uninitialized };
}

// --- Tagging Helpers ---

/** Calculates Mean and Standard Deviation */
function calculateMeanStdDev(numbers) {
    const n = numbers.length;
    if (n === 0) return { mean: 0, stdDev: 0 };
    const mean = numbers.reduce((a, b) => a + b, 0) / n;
    if (n === 1) return { mean: mean, stdDev: 0 };
    const variance = numbers.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
    return { mean, stdDev: Math.sqrt(variance) };
}

/** Determines tag based on Standard Deviation */
function getTagFromStdDev(score, mean, stdDev, tags) {
    if (stdDev === 0) return tags[Math.floor(tags.length / 2)];
    if (tags.length === 5) { // Example thresholds
        if (score < mean - 1.5 * stdDev) return tags[0];
        if (score < mean - 0.5 * stdDev) return tags[1];
        if (score <= mean + 0.5 * stdDev) return tags[2];
        if (score <= mean + 1.5 * stdDev) return tags[3];
        return tags[4];
    } else if (tags.length === 7) { // Example thresholds
        if (score < mean - 1.75 * stdDev) return tags[0];
        if (score < mean - 1.0 * stdDev) return tags[1];
        if (score < mean - 0.25 * stdDev) return tags[2];
        if (score <= mean + 0.25 * stdDev) return tags[3];
        if (score <= mean + 1.0 * stdDev) return tags[4];
        if (score <= mean + 1.75 * stdDev) return tags[5];
        return tags[6];
    }
    console.warn(`StdDev tagging undefined for ${tags.length} bins.`);
    return tags[Math.floor(tags.length / 2)];
}

/** Determines tag based on Quantiles */
function getTagFromQuantiles(score, sortedScores, tags, quantiles) {
    const total = sortedScores.length;
    if (total === 0) return tags[Math.floor(tags.length / 2)];
    // Find rank (index) - handle edge cases and duplicates
    let rank = sortedScores.findIndex(s => s >= score); // Find first score >= current score
    if (rank === -1) rank = total - 1; // If score is highest, rank is last index

    const percentile = (rank + 1) / total;

    for (let i = 0; i < quantiles.length; i++) {
        // Use a tiny epsilon for floating point comparisons at boundaries
        if (percentile <= quantiles[i] + 1e-9) {
            return tags[i];
        }
    }
    return tags[tags.length - 1]; // Fallback
}

// --- Utility Helpers ---

/** Shuffles array in place */
function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
}

/** Escapes values for CSV export */
function escapeCSV(value) {
    if (value == null) return ''; // Handle null/undefined
    const str = String(value);
    if (/[",\n]/.test(str)) {
        return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
}

// ========================================
// --- Server Start ---
// ========================================
app.listen(3000, () => {
    console.log('-----------------------------------------------------');
    console.log(' Blind LoRA/Image Ranker Server Started');
    console.log(' Access UI at: http://localhost:3000');
    console.log('-----------------------------------------------------');
});