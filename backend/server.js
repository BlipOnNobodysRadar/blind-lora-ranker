// backend/server.js
const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const fsPromises = require('fs').promises;
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

// --- Fisher-Yates shuffle function ---
function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]]; // Swap elements
  }
}


/**
 * Determines the aesthetic tag based on Elo score using custom quantiles.
 * @param {number} score - The Elo score of the image.
 * @param {number[]} sortedScores - Array of all Elo scores in the subset, sorted ascending.
 * @param {string[]} tags - Array of tag names (e.g., ['terrible', 'bad', ...]).
 * @param {number[]} quantiles - Array of cumulative quantile boundaries (e.g., [0.1, 0.3, 0.7, 0.9, 1.0]).
 * @returns {string} The determined tag name.
 */
function getTagFromQuantiles(score, sortedScores, tags, quantiles) {
  const totalImages = sortedScores.length;
  if (totalImages === 0) return tags[Math.floor(tags.length / 2)]; // Default to middle tag if no scores

  // Find the rank (position) of the score in the sorted list
  // Handle potential duplicate scores by finding the last occurrence's rank
  let rank = -1;
  for(let i = sortedScores.length - 1; i >= 0; i--) {
      if (sortedScores[i] <= score) {
           // Rank is position + 1, percentile is rank / total
           // Use index directly for boundary checks for simplicity here
          rank = i;
          break;
      }
  }
   // If score is lower than the lowest, rank is effectively -1, handle below

  const percentile = (rank + 1) / totalImages; // Calculate percentile (0 to 1)

  // Determine the bin based on quantile boundaries
  for (let i = 0; i < quantiles.length; i++) {
      if (percentile <= quantiles[i]) {
          return tags[i];
      }
  }

  // Should not be reached if quantiles[last] === 1.0, but return last tag as fallback
  return tags[tags.length - 1];
}

/**
* Applies aesthetic tags to TXT files based on Elo ratings for a normal subset.
*/
app.post('/api/apply-tags/normal/:subset', async (req, res) => {
  const subset = req.params.subset;
  const {
      // Allow passing config in the future, default to user's request for now
      tagPrefix = 'aesthetic_rating_',
      strategy = 'customQuantile', // Example strategies: 'customQuantile', 'equalQuantile', 'stdDev'
      // Define user's custom quantile setup
      binTags = ['terrible', 'bad', 'average', 'good', 'excellent'],
      binQuantiles = [0.1, 0.3, 0.7, 0.9, 1.0] // Cumulative: 10%, next 20% (->30%), next 40% (->70%), next 20% (->90%), top 10% (->100%)
  } = req.body; // Get config from request body

  console.log(`Received request to apply tags for normal subset: ${subset} using strategy: ${strategy}`);

  if (!normalSubsets[subset]) {
      return res.status(404).json({ error: 'Normal subset not found' });
  }

  const { images } = normalSubsets[subset];
  const ratedImages = Object.entries(images)
                            .filter(([_, data]) => data.rating !== null)
                            .map(([name, data]) => ({ name, rating: data.rating }));

  if (ratedImages.length < binTags.length) { // Need at least as many images as bins for quantiles
      return res.status(400).json({ error: `Not enough rated images (${ratedImages.length}) in subset to apply ${binTags.length} tags.` });
  }

  // --- Apply Binning Strategy ---
  let imageTags = {}; // { imageName: 'tag_name', ... }

  if (strategy === 'customQuantile' || strategy === 'equalQuantile') { // Handle both quantile types
      ratedImages.sort((a, b) => a.rating - b.rating); // Sort by Elo ascending
      const sortedScores = ratedImages.map(img => img.rating);
      let currentQuantiles = binQuantiles; // Default to custom

      if(strategy === 'equalQuantile') {
          // Calculate equal quantile boundaries
          const numBins = binTags.length;
          currentQuantiles = [];
          for (let i = 1; i <= numBins; i++) {
               currentQuantiles.push(i / numBins);
          }
          console.log(`Using equal quantiles: ${currentQuantiles}`);
      } else {
           console.log(`Using custom quantiles: ${currentQuantiles}`);
      }


      ratedImages.forEach(img => {
          imageTags[img.name] = getTagFromQuantiles(img.rating, sortedScores, binTags, currentQuantiles);
      });

  } else if (strategy === 'stdDev') {
      // TODO: Implement Standard Deviation binning if needed
      return res.status(501).json({ error: 'Standard Deviation tagging not implemented yet.' });
  } else {
      return res.status(400).json({ error: `Unknown tagging strategy: ${strategy}` });
  }

  // --- Process Files ---
  let processedCount = 0;
  let errorCount = 0;
  const tagCounts = binTags.reduce((acc, tag) => ({ ...acc, [tag]: 0 }), {}); // Initialize counts

  const subsetPath = path.join(NORMAL_IMAGES_DIR, subset);

  // Process files sequentially to avoid overwhelming the system
  for (const img of ratedImages) {
      const imageName = img.name;
      const assignedTag = imageTags[imageName]; // e.g., 'average'
      const fullTag = tagPrefix + assignedTag; // e.g., 'aesthetic_rating_average'

      if (!assignedTag) {
          console.warn(`No tag assigned for image ${imageName}, skipping.`);
          continue;
      }

      tagCounts[assignedTag]++; // Count the assigned tag type

      const baseName = path.parse(imageName).name;
      const txtFilePath = path.join(subsetPath, `${baseName}.txt`);

      try {
          let currentContent = '';
          try {
              currentContent = await fsPromises.readFile(txtFilePath, 'utf8');
          } catch (readError) {
              if (readError.code === 'ENOENT') {
                  console.log(`Creating new caption file: ${txtFilePath}`);
                  currentContent = ''; // File doesn't exist, start fresh
              } else {
                  throw readError; // Rethrow other read errors
              }
          }

          // Split into tags, trim whitespace, filter out old tags and empty strings
          let tags = currentContent.split(',')
                                .map(t => t.trim())
                                .filter(t => t && !t.startsWith(tagPrefix));

          // Add the new tag
          tags.push(fullTag);

          // Join back together
          const newContent = tags.join(', ');

          // Write the updated content back
          await fsPromises.writeFile(txtFilePath, newContent, 'utf8');
          processedCount++;

      } catch (err) {
          console.error(`Error processing file for ${imageName} (${txtFilePath}):`, err);
          errorCount++;
      }
  }

  // --- Send Response ---
  const message = `Tagging complete for subset "${subset}". Processed: ${processedCount}, Errors: ${errorCount}.`;
  console.log(message, "Tag counts:", tagCounts);
  res.json({
      message: message,
      processed: processedCount,
      errors: errorCount,
      tagCounts: tagCounts
  });
});


/**
 * Loads all AI subsets by checking both the AI_images directory AND existing data files.
 */
function loadAllSubsets() {
  const discoveredSubsets = new Set();

  // 1. Discover from AI_images directory
  if (fs.existsSync(AI_IMAGES_DIR)) {
      try {
          fs.readdirSync(AI_IMAGES_DIR)
            .filter(dir => {
                const dirPath = path.join(AI_IMAGES_DIR, dir);
                // Ensure it's actually a directory
                try {
                    return fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory();
                } catch (statErr) {
                    console.warn(`Error stating directory ${dirPath}: ${statErr.message}. Skipping.`);
                    return false;
                }
            })
            .forEach(subset => discoveredSubsets.add(subset));
            console.log(`Discovered subsets from AI_images directory: ${[...discoveredSubsets].join(', ')}`);
      } catch (err) {
          console.error(`Error reading AI_images directory: ${err.message}`);
      }
  } else {
      console.log('AI_images directory not found. Trying to load from data files only.');
      // Optional: Create AI_images directory if it doesn't exist
      // fs.mkdirSync(AI_IMAGES_DIR);
  }

  // 2. Discover from data directory
  if (fs.existsSync(DATA_DIR)) {
       try {
          fs.readdirSync(DATA_DIR)
            // Match ratings-<subset>.json but NOT ratings-normal-<subset>.json
            .filter(file => /^ratings-(?!normal-).+\.json$/.test(file))
            .forEach(file => {
                const match = file.match(/^ratings-(.+)\.json$/);
                if (match && match[1]) {
                    if (!discoveredSubsets.has(match[1])) {
                       console.log(`Discovered subset "${match[1]}" from data file: ${file}`);
                    }
                    discoveredSubsets.add(match[1]);
                }
            });
      } catch(err) {
           console.error(`Error reading data directory: ${err.message}`);
      }
  } else {
      console.log('Data directory not found. Cannot discover subsets from data files.');
       // Optional: Create data directory if it doesn't exist
       // fs.mkdirSync(DATA_DIR);
  }


  const allSubsetNames = Array.from(discoveredSubsets);

  if (allSubsetNames.length === 0) {
      console.log('\nNo AI image subsets found either in "AI_images" directory or as "data/ratings-*.json" files.');
      console.log('To get started:');
      console.log('1. Create subdirectories in the "AI_images" folder.');
      console.log('2. Add PNG images with LoRA metadata into those subdirectories.');
      console.log('3. Run the rating process to generate data files.');
      console.log('OR, if you only have data files, ensure they are in the "data" directory.');
      return;
  }

  console.log(`Attempting to load data for subsets: ${allSubsetNames.join(', ')}`);
  allSubsetNames.forEach(subset => {
      loadSubset(subset); // Call the modified loadSubset
  });
}

/**
* Loads a single LoRA-based subset, prioritizing data file and optionally reading image files if directory exists.
*/
function loadSubset(subset) {
  console.log(`Loading AI subset "${subset}"...`);
  const subsetPath = path.join(AI_IMAGES_DIR, subset);
  const ratingFile = path.join(DATA_DIR, `ratings-${subset}.json`);

  let savedData = { ratings: {}, matchCount: {}, loraModelRatings: {} };
  let directoryExists = false;
  let files = [];

  // 1. Load saved ratings data FIRST (this is the source of truth for "offline" mode)
  if (fs.existsSync(ratingFile)) {
      try {
          savedData = JSON.parse(fs.readFileSync(ratingFile, 'utf8'));
          console.log(`Successfully loaded data file ${ratingFile} for subset "${subset}".`);
      } catch (e) {
          console.error(`Error parsing rating file ${ratingFile} for subset "${subset}":`, e.message, "- Resetting saved data.");
          // Reset saved data if parsing fails, but continue loading if possible
          savedData = { ratings: {}, matchCount: {}, loraModelRatings: {} };
      }
  } else {
       console.log(`No data file found for subset "${subset}" at ${ratingFile}. Will initialize from images if directory exists.`);
  }

  // 2. Check if image directory exists and read files IF it does
  try {
      if (fs.existsSync(subsetPath) && fs.statSync(subsetPath).isDirectory()) {
          directoryExists = true;
          files = fs.readdirSync(subsetPath).filter(file => file.toLowerCase().endsWith('.png'));
          console.log(`Image directory found for subset "${subset}". Found ${files.length} PNG files.`);
      } else {
           console.log(`Image directory NOT found for subset "${subset}" at ${subsetPath}. Loading in "offline" mode from data only.`);
      }
  } catch (dirErr) {
      console.warn(`Error accessing image directory for subset "${subset}" at ${subsetPath}: ${dirErr.message}. Loading in "offline" mode.`);
      directoryExists = false;
  }


  let images = {}; // Store image-specific data (rating, matches, associated LoRA)
  let loraModels = {}; // Store aggregated LoRA data (rating, matches)

  // 3. Initialize LoRA models from saved data FIRST
  if (savedData.loraModelRatings) {
      for (const loraName in savedData.loraModelRatings) {
          if (!loraModels[loraName]) { // Avoid overwriting if somehow already initialized
               loraModels[loraName] = {
                  rating: savedData.loraModelRatings[loraName]?.rating ?? 1000, // Default if property missing
                  matches: savedData.loraModelRatings[loraName]?.count ?? 0     // Default if property missing
              };
          }
      }
      console.log(`Initialized ${Object.keys(loraModels).length} LoRA models from saved data for subset "${subset}".`);
  }

  // 4. Process image files ONLY if the directory exists
  if (directoryExists) {
      for (const file of files) {
          const imagePath = path.join(subsetPath, file);
          const loraModelFromFile = getPngMetadata(imagePath); // Can return '', 'NONE', or 'LoraName:Strength'

          // Determine if image existed in saved data
          const ratingExistsInSaved = savedData.ratings && savedData.ratings.hasOwnProperty(file);
          const savedRating = ratingExistsInSaved ? savedData.ratings[file] : null;
          const savedMatches = ratingExistsInSaved ? (savedData.matchCount[file] ?? 0) : null; // Use saved matches if rating exists

          // Skip PNGs with no metadata *if* they weren't already rated/saved
          // Allow 'NONE' only if previously rated
          if (!loraModelFromFile && !ratingExistsInSaved) {
              // console.log(`Skipping new image "${file}" with no metadata.`);
              continue;
          }

          // Initialize image data: Use saved rating/matches if available, otherwise null (requires seeding)
          images[file] = {
              rating: savedRating,
              matches: savedMatches,
              lora: loraModelFromFile || (ratingExistsInSaved ? (savedData.images?.[file]?.lora ?? '') : '') // Use LoRA from file if possible, fallback to saved LoRA if file has none/error but was saved
          };

           // Update/Initialize LoRA model data based on the file's metadata
           // Only add/update if a valid LoRA name was extracted from the file
          if (loraModelFromFile && loraModelFromFile !== 'NONE' && loraModelFromFile !== '') {
              if (!loraModels[loraModelFromFile]) {
                   // If this LoRA wasn't in the saved JSON, initialize it now
                  loraModels[loraModelFromFile] = {
                      rating: 1000, // New LoRA discovered from PNG
                      matches: 0
                  };
                   console.log(`Discovered new LoRA "${loraModelFromFile}" from image "${file}".`);
              }
               // We don't update rating/matches here; that happens during voting or loading from JSON.
               // We just ensure the LoRA model entry exists.
          }
      }
  }

  // 5. Populate image data for images ONLY present in saved data (directory/file missing)
  // This isn't strictly necessary for LoRA comparison but maintains consistency if needed elsewhere
  if (savedData.ratings) {
      for (const savedFile in savedData.ratings) {
          if (!images[savedFile]) { // If not already processed from an existing file
               console.log(`Adding image "${savedFile}" from saved data (file missing).`);
               images[savedFile] = {
                  rating: savedData.ratings[savedFile],
                  matches: savedData.matchCount[savedFile] ?? 0,
                  lora: savedData.images?.[savedFile]?.lora ?? '' // Try to get LoRA from old format if exists
               };
          }
      }
  }


  // Final assignment to the global structure
  subsets[subset] = { images, loraModels };
  console.log(`Finished loading AI subset "${subset}". Images tracked: ${Object.keys(images).length}, LoRAs tracked: ${Object.keys(loraModels).length}. Mode: ${directoryExists ? 'Online' : 'Offline'}`);
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
 * Loads a single subset of normal images (from NORMAL_IMAGES_DIR).
 * - Accepts common file types
 * - No metadata extraction
 * - Builds normalSubsets data
 * - Initializes ratings to null if not found in saved data
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
    try {
      savedData = JSON.parse(fs.readFileSync(ratingFile, 'utf8'));
    } catch (e) {
      console.error(`Error parsing rating file ${ratingFile}:`, e);
      // Reset saved data if parsing fails
      savedData = { ratings: {}, matchCount: {} };
    }
  }

  let images = {};

  for (const file of files) {
    // Check if rating exists in savedData.ratings
    const isInitialized = savedData.ratings.hasOwnProperty(file);

    images[file] = {
      // If not in saved data, rating is null (needs seeding)
      rating: isInitialized ? savedData.ratings[file] : null,
      // If not in saved data, matches is null (needs seeding)
      matches: isInitialized ? savedData.matchCount[file] ?? 0 : null, // Default matches to 0 if rating exists but matches doesn't
      lora: '' // not applicable, but keep same structure
    };
  }

  normalSubsets[subset] = { images };
  console.log(`Loaded Normal subset "${subset}". Images: ${Object.keys(images).length}`);
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
      // Updated regex to capture both name and strength
      const loraMatch = parametersChunk.text.match(/<lora:([^:]+):([^>]+)>/);
      if (loraMatch && loraMatch[1]) {
        const loraName = loraMatch[1].trim();
        const loraStrength = loraMatch[2] || ""; // Get the strength value
        return loraName + (loraStrength ? `:${loraStrength}` : ""); // Return name:strength format
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

    // Fallback if no standard metadata chunk found
    return '';
  } catch (err) {
    console.error(`Error parsing PNG metadata for ${imagePath}:`, err.message);
    return ''; // Return empty string on error or if no metadata found
  }
}

function parseTextChunk(dataBuffer) {
  const rawStr = dataBuffer.toString('utf8');
  const nullIndex = rawStr.indexOf('\0');
  if (nullIndex === -1) {
    return { keyword: '', text: rawStr }; // Handle cases without null separator
  }
  const keyword = rawStr.slice(0, nullIndex);
  const text = rawStr.slice(nullIndex + 1);
  return { keyword, text };
}

function extractLoraFromComfyUI(jsonData) {
  // Check if jsonData is an object and has properties
  if (typeof jsonData !== 'object' || jsonData === null || Object.keys(jsonData).length === 0) {
    return '';
  }
  for (const key in jsonData) {
    const node = jsonData[key];
    // Check if node is valid and has class_type
    if (node && typeof node === 'object' && node.class_type === 'LoraLoader') {
      const name = extractNameFromLoraNode(node);
      if (name) return name;
    }
  }
  return '';
}

function extractLoraFromWorkflow(jsonData) {
   // Check if jsonData is an object and has a nodes array
   if (typeof jsonData !== 'object' || jsonData === null || !Array.isArray(jsonData.nodes)) {
    return '';
  }
  if (jsonData && Array.isArray(jsonData.nodes)) {
    for (const node of jsonData.nodes) {
      // Check if node is valid and has class_type
      if (node && typeof node === 'object' && node.class_type === 'LoraLoader') {
        const name = extractNameFromLoraNode(node);
        if (name) return name;
      }
    }
  }
  return '';
}

function extractNameFromLoraNode(node) {
  // Check for inputs property
  if (node.inputs && typeof node.inputs === 'object' && node.inputs.lora_name) {
    // Check if lora_name is a string
    if (typeof node.inputs.lora_name === 'string') {
       return extractLoraNameFromPath(node.inputs.lora_name);
    } else if (Array.isArray(node.inputs.lora_name) && typeof node.inputs.lora_name[0] === 'string') {
       // Handle cases like ["lora_name", 0]
       return extractLoraNameFromPath(node.inputs.lora_name[0]);
    }
  }
  // Check for widgets_values property
  if (Array.isArray(node.widgets_values) && node.widgets_values.length > 0) {
    const val = node.widgets_values[0];
    if (typeof val === 'string') {
      return extractLoraNameFromPath(val);
    }
  }
  return '';
}

function extractLoraNameFromPath(loraPath) {
  if (typeof loraPath !== 'string') return '';
  let name = loraPath.split('/').pop();
  name = name.replace(/\.(safetensors|ckpt|pt|bin)$/i, '');
  return name.trim();
}


/**
 * Converts a star rating (1-10) to an initial Elo rating (700-1600).
 * @param {number} starRating - The star rating (1 to 10).
 * @returns {number} - The corresponding Elo rating.
 */
function starToElo(starRating) {
  // Ensure rating is within the valid range
  starRating = Math.max(1, Math.min(10, starRating));
  // Formula: 1000 as average rating at 5 stars. 1 star 600 rating, 10 star 1500.
  return 1000 + (starRating - 5) * 100;
}


/**
 * Updates Elo ratings for two entities.
 * Accounts for potential null ratings during initial seeding phase, though this function
 * is primarily used for head-to-head AFTER seeding.
 */
function updateRatings(winner, loser) {
  // Ensure entities have valid ratings before calculating Elo
  const winnerRating = winner.rating === null ? 1000 : winner.rating; // Use 1000 for calculation if not yet seeded
  const loserRating = loser.rating === null ? 1000 : loser.rating; // Use 1000 for calculation if not yet seeded

  const getKFactor = (matches) => {
    // If matches is null (unseeded), use a high K-factor
    if (matches === null || matches < 10) return 64;
    if (matches < 20) return 48;
    if (matches < 30) return 32;
    return 24;
  };

  const kWinner = getKFactor(winner.matches);
  const kLoser = getKFactor(loser.matches);

  const expectedWinner = 1 / (1 + Math.pow(10, (loserRating - winnerRating) / 400));

  // Update ratings ONLY if they were already initialized (not null) OR set them to 1000 if they were null
  // This function should ideally only be called for images already initialized (rating !== null)
  // The seeding process happens separately.
  // Reverting to the original check here, as updateRatings is for POST /vote
  winner.rating = (winner.rating || 1000) + kWinner * (1 - expectedWinner);
  loser.rating = (loser.rating || 1000) + kLoser * (0 - expectedWinner);

  // Matches should never be null if this function is called, but handle defensively
  winner.matches = (winner.matches || 0) + 1;
  loser.matches = (loser.matches || 0) + 1;
}


/**
 * Selects an optimal pair among a set of images.
 * This function should only be called when all images are initialized (rating !== null).
 */
function selectPair(images) {
  const keys = Object.keys(images).filter(img => images[img].rating !== null); // Only consider initialized images
  if (keys.length < 2) return [];

  const getPriority = (img1, img2) => {
    const img1Matches = images[img1].matches || 0;
    const img2Matches = images[img2].matches || 0;
    const ratingDiff = Math.abs((images[img1].rating || 1000) - (images[img2].rating || 1000)); // Use 1000 if somehow still null
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
  const subsetData = subsets[subset];
  if (!subsetData) return; // Ensure subset exists

  const { images, loraModels } = subsetData;
  const ratings = {};
  const matchCount = {};
  const loraModelRatings = {};

  for (const img in images) {
    // Only save ratings/matchCount if the image has been initialized (rating is not null)
    if (images[img].rating !== null) {
      ratings[img] = images[img].rating;
      matchCount[img] = images[img].matches;
    }
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
  const subsetData = normalSubsets[subset];
  if (!subsetData) return; // Ensure subset exists

  const { images } = subsetData;
  const ratings = {};
  const matchCount = {};

  for (const img in images) {
     // Only save ratings/matchCount if the image has been initialized (rating is not null)
    if (images[img].rating !== null) {
      ratings[img] = images[img].rating;
      matchCount[img] = images[img].matches;
    }
  }

  const ratingFile = path.join(DATA_DIR, `ratings-normal-${subset}.json`);
  fs.writeFileSync(ratingFile, JSON.stringify({
    ratings,
    matchCount
  }, null, 2));
}

/**
 * Checks if a subset requires initial seeding.
 * Returns an object indicating status and a list of uninitialized images.
 */
function checkForUninitialized(subsetType, subsetName) {
    const subsetCollection = subsetType === 'ai' ? subsets : normalSubsets;
    const subsetData = subsetCollection[subsetName];

    if (!subsetData) {
        // Subset not found, handle as an error
        return { error: `${subsetType === 'ai' ? 'AI' : 'Normal'} subset not found` };
    }

    const uninitializedImages = Object.keys(subsetData.images)
        .filter(imageName => subsetData.images[imageName].rating === null);

    return {
        requiresSeeding: uninitializedImages.length > 0,
        uninitializedImages: uninitializedImages
    };
}


// ------------- AI (LoRA) routes -------------

/** List AI subsets */
// GET /api/subsets - List available AI subsets (now includes offline ones)
app.get('/api/subsets', (req, res) => {
  // Sort subset names alphabetically for consistent UI
  const sortedSubsetNames = Object.keys(subsets).sort((a, b) => a.localeCompare(b));
  res.json(sortedSubsetNames);
});

/** Get a match pair or signal seeding needed from an AI subset */
app.get('/api/match/:subset', (req, res) => {
  const subset = req.params.subset;
  const subsetData = subsets[subset];

  if (!subsetData) {
    return res.status(404).json({ error: 'AI subset not found' });
  }

  const check = checkForUninitialized('ai', subset);

  if (check.error) {
       return res.status(404).json({ error: check.error });
  }

  if (check.requiresSeeding) {
      if (check.uninitializedImages.length === 0) {
           // Should not happen if requiresSeeding is true, but defensive check
           return res.status(400).json({ error: 'No uninitialized images found, but seeding required flag is true.' });
      }
      return res.json({ requiresSeeding: true, uninitializedImages: check.uninitializedImages });
  }

  // No seeding needed, proceed with matchmaking
  const pair = selectPair(subsetData.images);
  if (pair.length < 2) {
    return res.status(400).json({ error: 'Not enough initialized images to form a pair. Seed images first or add more images.' });
  }

  res.json({ image1: pair[0], image2: pair[1] });
});

/** Record a vote for an AI subset */
app.post('/api/vote/:subset', (req, res) => {
  const subset = req.params.subset;
  const { winner, loser } = req.body; // Note: Result type ('draw' etc.) is in frontend script.js but not used in backend updateRatings - can be added if needed later for score adjustments.

  if (!subsets[subset]) return res.status(404).json({ error: 'Subset not found' });
  const { images, loraModels } = subsets[subset];

   // Check if images are actually initialized before voting
  if (images[winner]?.rating === null || images[loser]?.rating === null) {
       return res.status(400).json({ error: 'Cannot vote on unseeded images. Please seed first.' });
  }

  if (!images[winner] || !images[loser]) {
    return res.status(400).json({ error: 'Invalid winner/loser image provided.' });
  }

  // Update image ratings
  updateRatings(images[winner], images[loser]);

  const winnerLora = images[winner].lora;
  const loserLora = images[loser].lora;

  // Update LoRA model ratings if they differ AND both LoRAs are tracked
  // Ensure loraModels[winnerLora] and loraModels[loserLora] exist
  if (winnerLora && loserLora && winnerLora !== loserLora && loraModels[winnerLora] && loraModels[loserLora]) {
    updateRatings(loraModels[winnerLora], loraModels[loserLora]);
  } else if (winnerLora && !loraModels[winnerLora]) {
     console.warn(`LoRA model ${winnerLora} not found for image ${winner}. Skipping LoRA rating update.`);
  } else if (loserLora && !loraModels[loserLora]) {
     console.warn(`LoRA model ${loserLora} not found for image ${loser}. Skipping LoRA rating update.`);
  }


  saveSubsetRatings(subset);
  res.json({ message: 'Vote recorded successfully.' });
});

/** Seed ratings for an AI subset */
app.post('/api/seed-ratings/ai/:subset', (req, res) => {
    const subset = req.params.subset;
    const { ratings } = req.body; // { imageName: starRating, ... }

    if (!subsets[subset]) {
        return res.status(404).json({ error: 'AI subset not found' });
    }

    const subsetImages = subsets[subset].images;
    let imagesSeededCount = 0;

    for (const imageName in ratings) {
        const starRating = ratings[imageName];

        // Validate image exists and is currently uninitialized
        if (subsetImages[imageName] && subsetImages[imageName].rating === null) {
            if (typeof starRating === 'number' && starRating >= 1 && starRating <= 10) {
                subsetImages[imageName].rating = starToElo(starRating);
                subsetImages[imageName].matches = 0; // Seeded images start with 0 matches
                imagesSeededCount++;
            } else {
                 console.warn(`Invalid star rating ${starRating} for image ${imageName} in subset ${subset}. Skipping.`);
            }
        } else if (subsetImages[imageName] && subsetImages[imageName].rating !== null) {
             console.warn(`Image ${imageName} in subset ${subset} is already seeded. Skipping.`);
        } else {
             console.warn(`Image ${imageName} not found in subset ${subset}. Skipping.`);
        }
    }

    if (imagesSeededCount > 0) {
        saveSubsetRatings(subset);
        res.json({ message: `Seeded ${imagesSeededCount} images in subset "${subset}".` });
    } else {
        res.status(400).json({ message: 'No valid uninitialized images with ratings provided.' });
    }
});


/** Get image-level Elo ranking for an AI subset */
app.get('/api/elo-rankings/:subset', (req, res) => {
  const subset = req.params.subset;
  if (!subsets[subset]) return res.status(404).json({ error: 'Subset not found' });

  const { images } = subsets[subset];
  const ranked = Object.keys(images)
    .filter(img => images[img].rating !== null) // Only include initialized images in rankings
    .sort((a, b) => images[b].rating - images[a].rating)
    .map(img => ({
      image: img,
      rating: images[img].rating,
      matches: images[img].matches,
      lora: images[img].lora
    }));

  res.json(ranked);
});

// GET /api/lora-rankings/:subset - Get LoRA rankings for a subset
app.get('/api/lora-rankings/:subset', (req, res) => {
  const subset = req.params.subset;
  if (!subsets[subset]) {
    // Check if it exists in normalSubsets as a fallback? No, stick to AI subsets.
    console.warn(`Request for LoRA rankings for unknown or unloaded AI subset: ${subset}`);
    return res.status(404).json({ error: `AI Subset '${subset}' not found or failed to load.` });
  }

  const { loraModels } = subsets[subset]; // Should be populated correctly by modified loadSubset

  if (!loraModels || Object.keys(loraModels).length === 0) {
     console.log(`No LoRA models found or loaded for subset ${subset}.`);
     // Return empty array instead of error, means no LoRAs to rank
     return res.json([]);
  }


  const ranked = Object.keys(loraModels)
    .sort((a, b) => (loraModels[b]?.rating ?? 0) - (loraModels[a]?.rating ?? 0)) // Handle potentially null/undefined rating defensively
    .map(lm => ({
      lora: lm,
      rating: loraModels[lm]?.rating ?? 1000, // Default to 1000 if rating somehow missing
      matches: loraModels[lm]?.matches ?? 0   // Default to 0 if matches somehow missing
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
  // Use async unlink for better performance, but sync is fine for this app's scale
  fs.unlink(imagePath, (err) => {
      if (err) {
          console.error(`Error deleting file ${imagePath}:`, err);
          // Decide if you want to return an error or just remove from tracking
          // Let's remove from tracking even if file delete fails for consistency
      }

      // If the image had a LoRA and was initialized, might need to adjust LoRA stats?
      // For simplicity, just remove the image entry and save.
      delete images[image];
      saveSubsetRatings(subset); // Save *after* deleting the image from memory

      res.json({ message: 'Image deleted successfully.', deletedFile: !err });
  });
});

/** Get minimal matches across an AI subset (only initialized images) */
app.get('/api/progress/:subset', (req, res) => {
  const subset = req.params.subset;
  if (!subsets[subset]) return res.status(404).json({ error: 'Subset not found' });

  const { images } = subsets[subset];
  const initializedImages = Object.values(images).filter(img => img.rating !== null);

  if (initializedImages.length === 0) {
    // If no initialized images, minimal matches is effectively 0 for progress tracking
    return res.json({ minimalMatches: 0, totalImages: Object.keys(images).length, initializedImagesCount: 0 });
  }

  const minimalMatches = initializedImages.reduce((minVal, img) => Math.min(minVal, img.matches || 0), Infinity);
  const totalImages = Object.keys(images).length; // Total images including uninitialized
  const initializedImagesCount = initializedImages.length;

  res.json({ minimalMatches, totalImages, initializedImagesCount });
});

// ------------- Normal (non-LoRA) routes -------------

/** List subsets for normal images */
app.get('/api/normal-subsets', (req, res) => {
  res.json(Object.keys(normalSubsets));
});

/** Get a match pair or signal seeding needed from a normal subset */
app.get('/api/normal-match/:subset', (req, res) => {
  const subset = req.params.subset;
  const subsetData = normalSubsets[subset];

  if (!subsetData) {
    return res.status(404).json({ error: 'Normal subset not found' });
  }

  const check = checkForUninitialized('normal', subset);

  if (check.error) {
      return res.status(404).json({ error: check.error });
  }

  if (check.requiresSeeding) {
       if (check.uninitializedImages.length === 0) {
           return res.status(400).json({ error: 'No uninitialized images found, but seeding required flag is true.' });
       }
      // *** SHUFFLE the list before sending ***
      shuffleArray(check.uninitializedImages);
      // ***************************************
      return res.json({ requiresSeeding: true, uninitializedImages: check.uninitializedImages });
  }

  // No seeding needed, proceed with matchmaking
  const pair = selectPair(subsetData.images);
   if (pair.length < 2) {
    return res.status(400).json({ error: 'Not enough initialized images to form a pair. Seed images first or add more images.' });
  }

  res.json({ image1: pair[0], image2: pair[1] });
});

/** Record a vote for a normal subset */
app.post('/api/normal-vote/:subset', (req, res) => {
  const subset = req.params.subset;
  const { winner, loser } = req.body;

  if (!normalSubsets[subset]) return res.status(404).json({ error: 'Normal subset not found' });
  const { images } = normalSubsets[subset];

   // Check if images are actually initialized before voting
  if (images[winner]?.rating === null || images[loser]?.rating === null) {
       return res.status(400).json({ error: 'Cannot vote on unseeded images. Please seed first.' });
  }

  if (!images[winner] || !images[loser]) {
    return res.status(400).json({ error: 'Invalid winner/loser image.' });
  }

  // Update image ratings
  updateRatings(images[winner], images[loser]);

  // No LoRA to update here
  saveNormalSubsetRatings(subset);
  res.json({ message: 'Vote recorded for normal images.' });
});

/** Seed ratings for a normal subset */
app.post('/api/seed-ratings/normal/:subset', (req, res) => {
    const subset = req.params.subset;
    const { ratings } = req.body; // { imageName: starRating, ... }

    if (!normalSubsets[subset]) {
        return res.status(404).json({ error: 'Normal subset not found' });
    }

    const subsetImages = normalSubsets[subset].images;
    let imagesSeededCount = 0;

    for (const imageName in ratings) {
        const starRating = ratings[imageName];

        // Validate image exists and is currently uninitialized
        if (subsetImages[imageName] && subsetImages[imageName].rating === null) {
            if (typeof starRating === 'number' && starRating >= 1 && starRating <= 10) {
                subsetImages[imageName].rating = starToElo(starRating);
                subsetImages[imageName].matches = 0; // Seeded images start with 0 matches
                 imagesSeededCount++;
            } else {
                console.warn(`Invalid star rating ${starRating} for image ${imageName} in subset ${subset}. Skipping.`);
           }
        } else if (subsetImages[imageName] && subsetImages[imageName].rating !== null) {
            console.warn(`Image ${imageName} in subset ${subset} is already seeded. Skipping.`);
       } else {
            console.warn(`Image ${imageName} not found in subset ${subset}. Skipping.`);
       }
    }

     if (imagesSeededCount > 0) {
        saveNormalSubsetRatings(subset);
        res.json({ message: `Seeded ${imagesSeededCount} images in subset "${subset}".` });
    } else {
        res.status(400).json({ message: 'No valid uninitialized images with ratings provided.' });
    }
});


/** Get image-level Elo ranking for a normal subset (only initialized images) */
app.get('/api/normal-elo-rankings/:subset', (req, res) => {
  const subset = req.params.subset;
  if (!normalSubsets[subset]) return res.status(404).json({ error: 'Normal subset not found' });

  const { images } = normalSubsets[subset];
   const ranked = Object.keys(images)
    .filter(img => images[img].rating !== null) // Only include initialized images in rankings
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
  // Use async unlink
  fs.unlink(imagePath, (err) => {
      if (err) {
          console.error(`Error deleting file ${imagePath}:`, err);
      }

      delete images[image];
      saveNormalSubsetRatings(subset); // Save *after* deleting the image from memory
      res.json({ message: 'Normal image deleted successfully.', deletedFile: !err });
  });
});

/** Get minimal matches across a normal subset (only initialized images) */
app.get('/api/normal-progress/:subset', (req, res) => {
  const subset = req.params.subset;
  if (!normalSubsets[subset]) return res.status(404).json({ error: 'Normal subset not found' });

  const { images } = normalSubsets[subset];
  const initializedImages = Object.values(images).filter(img => img.rating !== null);

  if (initializedImages.length === 0) {
    // If no initialized images, minimal matches is effectively 0 for progress tracking
    return res.json({ minimalMatches: 0, totalImages: Object.keys(images).length, initializedImagesCount: 0 });
  }

  const minimalMatches = initializedImages.reduce((minVal, img) => Math.min(minVal, img.matches || 0), Infinity);
  const totalImages = Object.keys(images).length; // Total images including uninitialized
  const initializedImagesCount = initializedImages.length;

  res.json({ minimalMatches, totalImages, initializedImagesCount });
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

// Export images from AI subsets (only initialized images)
app.get('/api/export/:subset/images/csv', (req, res) => {
  const subset = req.params.subset;
  if (!subsets[subset]) return res.status(404).json({ error: 'Subset not found' });

  const { images } = subsets[subset];
  const headers = ['image', 'lora', 'rating', 'matches'];
  const rows = Object.keys(images)
    .filter(img => images[img].rating !== null) // Only export initialized images
    .map(img => [
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

// Summary Stats for AI images (only initialized images)
app.get('/api/summary/:subset/images', (req, res) => {
  const subset = req.params.subset;
  if (!subsets[subset]) return res.status(404).json({ error: 'Subset not found' });

  const { images } = subsets[subset];
  const initializedImages = Object.values(images).filter(img => img.rating !== null);

  if (initializedImages.length === 0) {
    return res.json({ count: 0, averageRating: 0, averageMatches: 0 });
  }
  const count = initializedImages.length;
  const averageRating = initializedImages.reduce((acc, i) => acc + i.rating, 0) / count;
  const averageMatches = initializedImages.reduce((acc, i) => acc + i.matches, 0) / count;
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

/** Export normal images as CSV (only initialized images) */
app.get('/api/export-normal/:subset/csv', (req, res) => {
  const subset = req.params.subset;
  if (!normalSubsets[subset]) return res.status(404).json({ error: 'Normal subset not found' });

  const { images } = normalSubsets[subset];
  const headers = ['image', 'rating', 'matches'];
  const rows = Object.keys(images)
     .filter(img => images[img].rating !== null) // Only export initialized images
     .map(img => [
      img,
      images[img].rating,
      images[img].matches
    ]);

  const csv = [headers.join(','), ...rows.map(r => r.map(escapeCSV).join(','))].join('\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename=normal-${subset}.csv`);
  res.send(csv);
});

/** Summary stats for normal images (only initialized images) */
app.get('/api/summary-normal/:subset', (req, res) => {
  const subset = req.params.subset;
  if (!normalSubsets[subset]) return res.status(404).json({ error: 'Normal subset not found' });

  const { images } = normalSubsets[subset];
  const initializedImages = Object.values(images).filter(img => img.rating !== null);

  if (initializedImages.length === 0) {
    return res.json({ count: 0, averageRating: 0, averageMatches: 0 });
  }
  const count = initializedImages.length;
  const averageRating = initializedImages.reduce((acc, i) => acc + i.rating, 0) / count;
  const averageMatches = initializedImages.reduce((acc, i) => acc + i.matches, 0) / count;
  res.json({ count, averageRating, averageMatches });
});

// Refresh without restarting server
app.post('/api/refresh', (req, res) => {
  try {
    console.log('Refreshing directories...');
    // Clear existing subsets
    subsets = {};
    normalSubsets = {};

    // Reload all subsets from the directories
    loadAllSubsets();
    loadAllNormalSubsets();

    console.log('Directories refreshed.');
    res.json({ message: 'Directories refreshed successfully.' });
  } catch (err) {
    console.error('Error refreshing directories:', err);
    res.status(500).json({ error: 'Failed to refresh directories.' });
  }
});


app.listen(3000, () => {
  console.log('Server running on port 3000. Open http://localhost:3000 in your browser.');
});