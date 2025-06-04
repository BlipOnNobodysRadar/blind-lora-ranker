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
        strategy = 'customQuantile', // customQuantile, equalQuantile, ponyQuantile, stdDev, kmeans, rangeNormalization
        tagPrefix = 'aesthetic_rating_',
        binTags = ['terrible', 'bad', 'average', 'good', 'excellent'],
        numBins, // For equalQuantile
        numClusters, // For kmeans
        rangeThresholds // For rangeNormalization (e.g., [0.15, 0.35, 0.65, 0.85])
    } = req.body;

    console.log(`Request: Apply tags for subset: ${subset}, Strategy: ${strategy}, Prefix: ${tagPrefix}`);

    if (!normalSubsets[subset]) return res.status(404).json({ error: 'Normal subset not found' });

    const { images } = normalSubsets[subset];
    const ratedImages = Object.entries(images)
                              .filter(([_, data]) => data.rating !== null && typeof data.rating === 'number')
                              .map(([name, data]) => ({ name, rating: data.rating }));

    if (ratedImages.length === 0) return res.status(400).json({ error: `No rated images found in subset "${subset}".` });

    let imageTags = {}; // { imageName: 'tag_name', ... }
    let effectiveBinTags = [...binTags]; // Use provided tags unless overridden by strategy
    let effectiveStrategy = strategy; // For logging

    try {
        // --- Apply Binning Strategy ---
        switch (strategy) {
            case 'customQuantile':
                if (effectiveBinTags.length !== 5) throw new Error('Custom Quantile strategy requires exactly 5 tag names.');
                if (ratedImages.length < 5) throw new Error(`Need at least 5 rated images.`);
                ratedImages.sort((a, b) => a.rating - b.rating);
                const sortedScoresCQ = ratedImages.map(img => img.rating);
                const customQuantiles = [0.1, 0.3, 0.7, 0.9, 1.0]; // 10/20/40/20/10
                ratedImages.forEach(img => imageTags[img.name] = getTagFromQuantiles(img.rating, sortedScoresCQ, effectiveBinTags, customQuantiles));
                break;

            case 'ponyQuantile':
                effectiveStrategy = 'ponyQuantile (Equal 7 Bins)';
                effectiveBinTags = ['score_3', 'score_4', 'score_5', 'score_6', 'score_7', 'score_8', 'score_9']; // Override tags
                if (ratedImages.length < 7) throw new Error(`Need at least 7 rated images.`);
                ratedImages.sort((a, b) => a.rating - b.rating);
                const sortedScoresPony = ratedImages.map(img => img.rating);
                const ponyQuantiles = Array.from({ length: 7 }, (_, i) => (i + 1) / 7);
                ratedImages.forEach(img => imageTags[img.name] = getTagFromQuantiles(img.rating, sortedScoresPony, effectiveBinTags, ponyQuantiles));
                break;

            case 'equalQuantile':
                const currentNumBinsEQ = parseInt(numBins, 10);
                if (!currentNumBinsEQ || currentNumBinsEQ < 2) throw new Error('Number of bins must be at least 2.');
                if (effectiveBinTags.length !== currentNumBinsEQ) throw new Error(`Tag names count (${effectiveBinTags.length}) must match bins (${currentNumBinsEQ}).`);
                if (ratedImages.length < currentNumBinsEQ) throw new Error(`Need at least ${currentNumBinsEQ} rated images.`);
                ratedImages.sort((a, b) => a.rating - b.rating);
                const sortedScoresEQ = ratedImages.map(img => img.rating);
                const equalQuantiles = Array.from({ length: currentNumBinsEQ }, (_, i) => (i + 1) / currentNumBinsEQ);
                ratedImages.forEach(img => imageTags[img.name] = getTagFromQuantiles(img.rating, sortedScoresEQ, effectiveBinTags, equalQuantiles));
                break;

            case 'stdDev':
                 if (effectiveBinTags.length !== 5 && effectiveBinTags.length !== 7) throw new Error('Std Dev strategy requires 5 or 7 tags.');
                 if (ratedImages.length < 2) throw new Error(`Need at least 2 rated images.`);
                 const scoresStdDev = ratedImages.map(img => img.rating);
                 const { mean, stdDev } = calculateMeanStdDev(scoresStdDev);
                 console.log(`Using Standard Deviation: Mean=${mean.toFixed(2)}, StdDev=${stdDev.toFixed(2)}`);
                 ratedImages.forEach(img => imageTags[img.name] = getTagFromStdDev(img.rating, mean, stdDev, effectiveBinTags));
                 break;

            case 'kmeans':
                const k = parseInt(numClusters, 10) || 5; // Default K = 5 if not provided/invalid
                if (k < 2) throw new Error('Number of clusters (K) must be at least 2.');
                if (effectiveBinTags.length !== k) throw new Error(`Tag names count (${effectiveBinTags.length}) must match K (${k}).`);
                if (ratedImages.length < k) throw new Error(`Need at least K (${k}) rated images.`);
                const scoresKmeans = ratedImages.map(img => img.rating);
                const { assignments, centroids } = kmeans1D(scoresKmeans, k);
                // Sort centroids to map tags correctly
                const sortedCentroids = centroids
                    .map((centroid, index) => ({ centroid, index }))
                    .sort((a, b) => a.centroid - b.centroid);
                const clusterIndexToTag = {};
                sortedCentroids.forEach((item, i) => {
                    clusterIndexToTag[item.index] = effectiveBinTags[i];
                });
                ratedImages.forEach((img, i) => {
                    const clusterIndex = assignments[i];
                    imageTags[img.name] = clusterIndexToTag[clusterIndex];
                });
                console.log(`Using K-Means: K=${k}, Final Centroids (sorted): ${sortedCentroids.map(c=>c.centroid.toFixed(2)).join(', ')}`);
                break;

            case 'rangeNormalization':
                const thresholds = (Array.isArray(rangeThresholds) && rangeThresholds.length > 0)
                    ? rangeThresholds
                    : [0.15, 0.35, 0.65, 0.85]; // Default thresholds for 5 bins
                if (effectiveBinTags.length !== thresholds.length + 1) throw new Error(`Need ${thresholds.length + 1} tags for ${thresholds.length} thresholds.`);
                if (ratedImages.length < 2) throw new Error(`Need at least 2 rated images for range normalization.`);

                const scoresRange = ratedImages.map(img => img.rating);
                const minElo = Math.min(...scoresRange);
                const maxElo = Math.max(...scoresRange);
                const range = maxElo - minElo;
                console.log(`Using Range Normalization: Min=${minElo.toFixed(2)}, Max=${maxElo.toFixed(2)}, Range=${range.toFixed(2)}`);

                ratedImages.forEach(img => {
                    if (range === 0) { // Handle all scores being identical
                        imageTags[img.name] = effectiveBinTags[Math.floor(effectiveBinTags.length / 2)]; // Middle tag
                        return;
                    }
                    const normScore = (img.rating - minElo) / range;
                    let assigned = false;
                    for(let i = 0; i < thresholds.length; i++) {
                        if (normScore <= thresholds[i] + 1e-9) { // Add epsilon
                            imageTags[img.name] = effectiveBinTags[i];
                            assigned = true;
                            break;
                        }
                    }
                    if (!assigned) {
                        imageTags[img.name] = effectiveBinTags[effectiveBinTags.length - 1]; // Assign last tag if above all thresholds
                    }
                });
                break;

            default:
                throw new Error(`Unknown tagging strategy: ${strategy}`);
        }

    } catch (calcError) {
        console.error(`Calculation error for strategy ${strategy}: ${calcError.message}`);
        return res.status(400).json({ error: `Calculation Error: ${calcError.message}` });
    }

    // --- Process Files (Update tags in .txt) ---
    let processedCount = 0;
    let errorCount = 0;
    const tagCounts = {};
    const subsetPath = path.join(NORMAL_IMAGES_DIR, subset);

    for (const img of ratedImages) {
        const imageName = img.name;
        const assignedTag = imageTags[imageName];

        if (!assignedTag) { // Should not happen if calculation succeeded, but check anyway
             console.warn(`Internal error: No tag assigned for image ${imageName}, skipping.`);
             continue;
        }

        const finalTagValue = effectiveBinTags.includes(assignedTag) ? assignedTag : null; // Verify assigned tag is valid for the *effective* list
        if (!finalTagValue) {
            console.warn(`Internal error: Assigned tag "${assignedTag}" not found in effective tags for ${imageName}, skipping.`);
            continue;
        }

        const fullTag = tagPrefix + finalTagValue;
        tagCounts[finalTagValue] = (tagCounts[finalTagValue] || 0) + 1; // Count final tag
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

    // --- Send Response ---
    const message = `Tagging complete for subset "${subset}" using strategy "${effectiveStrategy}". Processed: ${processedCount}, Errors: ${errorCount}.`;
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

    // 1. Load saved ratings data FIRST
    if (fs.existsSync(ratingFile)) {
        try { savedData = JSON.parse(fs.readFileSync(ratingFile, 'utf8')); }
        catch (e) { console.error(`Error parsing ${ratingFile}:`, e.message); }
    }

    // 2. Check if image directory exists
    try {
        if (fs.existsSync(subsetPath) && fs.statSync(subsetPath).isDirectory()) {
            directoryExists = true;
            files = fs.readdirSync(subsetPath).filter(file => file.toLowerCase().endsWith('.png'));
        }
    } catch (dirErr) { console.warn(`Error accessing ${subsetPath}: ${dirErr.message}. Loading offline.`); }

    let images = {};
    let loraModels = {}; // Will include 'NONE' if necessary

    // 3. Initialize LoRA models from saved data FIRST
    if (savedData.loraModelRatings) {
        for (const loraName in savedData.loraModelRatings) {
            // Ensure "NONE" from saved data is also added correctly
             if (!loraModels[loraName]) {
                loraModels[loraName] = {
                    rating: savedData.loraModelRatings[loraName]?.rating ?? 1000,
                    matches: savedData.loraModelRatings[loraName]?.count ?? 0
                };
             }
        }
         // Ensure the 'NONE' category exists if there are saved ratings, even if no 'NONE' LoRAs yet
         if (!loraModels['NONE'] && Object.keys(savedData.loraModelRatings).length > 0) {
            // Initialize NONE only if it wasn't explicitly saved (or provide default if loading completely fresh)
             // Check if NONE existed in the saved data specifically
             if (!savedData.loraModelRatings['NONE']) {
                 loraModels['NONE'] = { rating: 1000, matches: 0 };
                 console.log(`Initializing 'NONE' LoRA category for subset "${subset}" (not found in saved).`);
             }
         }
    }


    // 4. Process image files ONLY if the directory exists
    if (directoryExists) {
        files.forEach(file => {
            const imagePath = path.join(subsetPath, file);
            let loraFromFile = getPngMetadata(imagePath); // Returns '', 'NONE', or 'LoraName:Strength'

            // **** MODIFICATION START ****
            // Treat empty string ('') as 'NONE' for grouping purposes
            if (loraFromFile === '') {
                console.log(`Image "${file}" has no detectable LoRA metadata, assigning to 'NONE'.`);
                loraFromFile = 'NONE';
            }
            // **** MODIFICATION END ****

            const ratingExistsInSaved = savedData.ratings?.hasOwnProperty(file);
            const savedRating = ratingExistsInSaved ? savedData.ratings[file] : null;
            const savedMatches = ratingExistsInSaved ? (savedData.matchCount?.[file] ?? 0) : null;

            // We now always have a non-empty loraFromFile ('NONE' or specific LoRA)
            // Keep the image regardless of whether it was previously saved,
            // as even new 'NONE' images need to be tracked for seeding/rating.

            images[file] = {
                rating: savedRating,
                matches: savedRating !== null ? savedMatches : null, // Use null matches only if rating is null
                // Prioritize LoRA from file if available ('NONE' or specific),
                // fallback to saved LoRA only if file parsing failed AND it was saved previously.
                lora: loraFromFile // Now guaranteed to be 'NONE' or a specific LoRA name/strength
            };

            // Ensure the corresponding LoRA model entry exists (could be 'NONE')
            if (!loraModels[loraFromFile]) {
                 // If this LoRA ('NONE' or specific) wasn't in the saved JSON, initialize it now
                loraModels[loraFromFile] = { rating: 1000, matches: 0 };
                console.log(`Initializing category for LoRA "${loraFromFile}" discovered from image "${file}".`);
            }
        });
    }

    // 5. Add images present only in saved data (handle potential 'NONE' here too)
    if (savedData.ratings) {
        for (const savedFile in savedData.ratings) {
            if (!images[savedFile]) { // If not loaded from directory
                // **** MODIFICATION START ****
                // Determine LoRA, defaulting to 'NONE' if not explicitly saved
                let savedLora = savedData.images?.[savedFile]?.lora || 'NONE';
                if (savedLora === '') savedLora = 'NONE'; // Ensure empty string becomes 'NONE'
                // **** MODIFICATION END ****

                images[savedFile] = {
                    rating: savedData.ratings[savedFile],
                    matches: savedData.matchCount?.[savedFile] ?? 0,
                    lora: savedLora
                };

                // Ensure LoRA model exists from saved data
                 if (!loraModels[savedLora]) {
                    // Check if it existed in the main saved lora ratings section
                    if (savedData.loraModelRatings?.[savedLora]) {
                         loraModels[savedLora] = {
                              rating: savedData.loraModelRatings[savedLora]?.rating ?? 1000,
                              matches: savedData.loraModelRatings[savedLora]?.count ?? 0
                         };
                    } else {
                         // If truly not seen before, initialize
                         loraModels[savedLora] = { rating: 1000, matches: 0 };
                         console.log(`Initializing category for LoRA "${savedLora}" discovered from saved image data "${savedFile}".`);
                    }
                 }
            }
        }
    }

    // Ensure 'NONE' category exists if any images were assigned to it, even if no saved data
    if (Object.values(images).some(img => img.lora === 'NONE') && !loraModels['NONE']) {
         loraModels['NONE'] = { rating: 1000, matches: 0 };
         console.log(`Initializing 'NONE' LoRA category for subset "${subset}" as images were assigned to it.`);
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

/**
 * Selects an optimal pair among a set of images based on match count and Elo difference.
 * This function should only be called when all images are initialized (rating !== null).
 */
function selectPair(images) {
    const keys = Object.keys(images).filter(img => images[img].rating !== null); // Only consider initialized images
    if (keys.length < 2) return [];

    const getPriority = (img1, img2) => {
        const img1Data = images[img1];
        const img2Data = images[img2];
        const img1Matches = img1Data.matches || 0;
        const img2Matches = img2Data.matches || 0;
        // Use default Elo of 1000 if somehow null, though they should be initialized
        const ratingDiff = Math.abs((img1Data.rating ?? 1000) - (img2Data.rating ?? 1000));

        // Prioritize images with fewer matches. Higher score for lower matches.
        const matchScore = 1 / (Math.min(img1Matches, img2Matches) + 1); // Add 1 to avoid division by zero

        // Prioritize images closer in Elo rating. Higher score for smaller difference.
        // Scale difference (e.g., max diff could be ~1000?); 1000 - diff gives higher score for low diff.
        const eloScore = Math.max(0, 1000 - ratingDiff); // Ensure score isn't negative

        // Combine scores - adjust weighting if needed
        let score = matchScore * eloScore;

        // Slightly deprioritize matching images from the same LoRA (if applicable)
        if (img1Data.lora && img1Data.lora === img2Data.lora && img1Data.lora !== 'NONE' && img1Data.lora !== '') {
            score *= 0.9; // Apply a small penalty
        }
        return score;
    };

    // Find the pair with the highest priority score
    let bestPair = []; // Initialize empty
    let bestScore = -Infinity; // Start with lowest possible score

    // Iterate through all possible unique pairs
    for (let i = 0; i < keys.length; i++) {
        for (let j = i + 1; j < keys.length; j++) {
            const score = getPriority(keys[i], keys[j]);
            if (score > bestScore) {
                bestScore = score;
                bestPair = [keys[i], keys[j]];
            }
        }
    }

    // Randomize the order within the best pair to avoid bias from position
    if (bestPair.length === 2 && Math.random() > 0.5) {
        [bestPair[0], bestPair[1]] = [bestPair[1], bestPair[0]];
    }

    return bestPair;

    /* --- REMOVE OR KEEP COMMENTED OUT: Simplified random pair selection ---
    let idx1 = Math.floor(Math.random() * keys.length);
    let idx2 = Math.floor(Math.random() * keys.length);
    while (idx2 === idx1) {
         idx2 = Math.floor(Math.random() * keys.length);
    }
    return [keys[idx1], keys[idx2]];
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

/** Determines tag based on Quantiles (Improved) */
function getTagFromQuantiles(score, sortedScores, tags, quantiles) {
    const total = sortedScores.length;
    if (total === 0) return tags[Math.floor(tags.length / 2)];
    let rank = -1;
    for (let i = total - 1; i >= 0; i--) {
        if (sortedScores[i] <= score) { rank = i; break; }
    }
    const percentile = (rank + 1) / total;
    for (let i = 0; i < quantiles.length; i++) {
        if (percentile <= quantiles[i] + 1e-9) return tags[i];
    }
    return tags[tags.length - 1];
}

/**
 * Basic 1D K-Means implementation.
 * @param {number[]} data - Array of scores.
 * @param {number} k - Number of clusters.
 * @param {number} [maxIterations=100] - Max iterations to prevent infinite loops.
 * @returns {{assignments: number[], centroids: number[]}} - Cluster index for each data point and final centroid values.
 */
function kmeans1D(data, k, maxIterations = 100) {
    if (data.length < k) throw new Error("Cannot have more clusters (k) than data points.");

    // 1. Initialization (simple range spread)
    const minVal = Math.min(...data);
    const maxVal = Math.max(...data);
    let centroids = Array.from({ length: k }, (_, i) => minVal + (maxVal - minVal) * (i / (k - 1 || 1)));
    if (k === 1) centroids = [(minVal + maxVal) / 2]; // Handle k=1 case

    let assignments = new Array(data.length).fill(-1);
    let iterations = 0;
    let changed = true;

    // 2. Iteration
    while (changed && iterations < maxIterations) {
        changed = false;
        iterations++;

        // Assign points to nearest centroid
        for (let i = 0; i < data.length; i++) {
            let minDist = Infinity;
            let bestCluster = -1;
            for (let j = 0; j < k; j++) {
                const dist = Math.abs(data[i] - centroids[j]);
                if (dist < minDist) {
                    minDist = dist;
                    bestCluster = j;
                }
            }
            if (assignments[i] !== bestCluster) {
                assignments[i] = bestCluster;
                changed = true;
            }
        }

        // Recalculate centroids
        const newCentroids = new Array(k).fill(0);
        const counts = new Array(k).fill(0);
        for (let i = 0; i < data.length; i++) {
            const clusterIndex = assignments[i];
            newCentroids[clusterIndex] += data[i];
            counts[clusterIndex]++;
        }

        for (let j = 0; j < k; j++) {
            // Handle empty clusters (rare in 1D, but possible with bad init)
            // Reinitialize centroid if empty, or keep old value
            if (counts[j] > 0) {
                newCentroids[j] /= counts[j];
            } else {
                console.warn(`K-Means: Cluster ${j} became empty. Reinitializing/keeping old centroid.`);
                // Option 1: Keep old value
                newCentroids[j] = centroids[j];
                // Option 2: Reinitialize randomly (e.g., pick random data point)
                // newCentroids[j] = data[Math.floor(Math.random() * data.length)];
            }
        }
        centroids = newCentroids;
    }

    if(iterations === maxIterations) {
        console.warn("K-Means reached max iterations without full convergence.");
    }

    return { assignments, centroids };
}

/** Determines tag based on Quantiles */
/**
 * Determines the aesthetic tag based on Elo score using custom quantiles.
 * IMPROVED: Handles duplicate scores more robustly for percentile calculation.
 * @param {number} score - The Elo score of the image.
 * @param {number[]} sortedScores - Array of all Elo scores in the subset, sorted ascending.
 * @param {string[]} tags - Array of tag names (e.g., ['terrible', 'bad', ...]).
 * @param {number[]} quantiles - Array of cumulative quantile boundaries (e.g., [0.1, 0.3, 0.7, 0.9, 1.0]).
 * @returns {string} The determined tag name.
 */
function getTagFromQuantiles(score, sortedScores, tags, quantiles) {
  const total = sortedScores.length;
  if (total === 0) return tags[Math.floor(tags.length / 2)]; // Default if no scores

  // Find the rank of the LAST item with a score <= the current score.
  // This handles duplicates correctly for percentile ranking.
  let rank = -1; // Use index as 0-based rank
  for (let i = total - 1; i >= 0; i--) {
      if (sortedScores[i] <= score) {
          rank = i;
          break;
      }
  }
  // If score is lower than the lowest sorted score, rank remains -1.

  // Calculate percentile based on the 0-based rank.
  // (rank + 1) gives the count of items <= score.
  const percentile = (rank + 1) / total;

  // Determine the bin based on quantile boundaries.
  // Check if percentile falls AT or BELOW the boundary.
  for (let i = 0; i < quantiles.length; i++) {
      // Use a small epsilon for floating point comparisons
      if (percentile <= quantiles[i] + 1e-9) {
          return tags[i];
      }
  }

  // Should only be reached if something is wrong or percentile > 1.0 (unlikely)
  console.warn(`Score percentile ${percentile} exceeded max quantile for score ${score}. Assigning last tag.`);
  return tags[tags.length - 1];
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