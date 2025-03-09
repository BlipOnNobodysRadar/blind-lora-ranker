# Blind LoRA Elo Ranker

## What is this?

A simple web app that helps you rank AI-generated images using blind comparisons. It removes the bias that comes from knowing which model created an image by:

- Having you compare images without seeing their metadata
- Using an Elo rating system (like in chess) to rank both images and models
- Extracting LoRA model information from image metadata for automated analysis

Works with both AI-generated images containing LoRA metadata and regular images.

## How it helps

When comparing images generated with different LoRA models (low-rank adaptation models for Stable Diffusion), it's easy to be influenced by knowing which model made which image. This tool addresses that problem through blind testing.

After enough comparisons, the system will show you:

- Which LoRAs produced images you consistently preferred
- The relative difference in performance between models (as Elo points)
- Which specific images scored highest in your rankings

## Practical uses

This tool is particularly useful if you're:

- **Training your own LoRAs** and need to compare different checkpoints or hyperparameter settings
- **Testing multiple LoRAs** on the same prompt to see which performs best
- **Evaluating different models** for specific use cases without name bias
- **Organizing image collections** by subjective quality with a consistent system

## Key Features

- **Blind Comparison**: Compare pairs of images without seeing what model produced them
- **Elo Rating System**: Uses chess-style Elo ratings that adjust based on win/loss patterns
- **LoRA Metadata Extraction**: Automatically pulls model information from image metadata
- **Subset Organization**: Group related images for more meaningful comparisons (How you decide to categorize subsets is up to you. My preference is for each category to represent images with the same or similar prompts from multiple lora models.)
- **Progress Tracking**: Shows when you've made enough comparisons for reliable rankings
- **Export Options**: Download results as CSV files for further analysis (possibly currently bugged)
- **Cross-Subset Analysis**: Compare how models perform across different prompts or scenarios (extremely useful for multi-concept multi-style loras, or to test the generalization capabilities of a lora on multiple prompts)
- **Overperformance Metric (OPM)**: Tracks how often a LoRA model exceeds the average rating across different subsets, helping identify consistently strong performers rather than models that just excel in one specific scenario

## Status

> **Note**: This is a personal side project with a minimal UI. The core functions (blind rating, Elo calculation, and LoRA analysis) work reliably, but some features like CSV export and correlation analysis may have minor bugs.

Use at your own risk and feel free to contribute or adapt it for your needs.

## Prerequisites

- **Node.js (LTS)**: Install from [nodejs.org](https://nodejs.org/) or via your system's package manager:
  - **Ubuntu/Debian**: `sudo apt install nodejs npm`
  - **macOS (Homebrew)**: `brew install node`
  - **Windows**: `winget install OpenJS.NodeJS.LTS`

## Installation

1. **Get the repository**:
   - **Git Clone**:
     ```bash
     git clone https://github.com/BlipOnNobodysRadar/blind-lora-ranker
     cd blind-lora-ranker
     ```
   - **Zip Download**: Download the ZIP from GitHub and extract it, then navigate into the project folder.

2. **Install Dependencies**:
   ```bash
   npm install
   ```

## Organize Images

Currently you need to do some manual movement of image files and folder-making to get started. Making this process doable in the UI is on the todo list, but for now:

1. Inside `ai_images` or `normal_images`, create subdirectories for each subset you want. The name doesn't matter, pick what makes sense to you.
2. For `ai_images` place PNG files (with LoRA metadata) in these subdirectories.
3. For `normal_images` place images of any common filetype in these subdirectories

Example structure:
```
/ai_images
    /heterochromia_prompt
        image1.png
        image2.png
        ...
    /brown_hair_prompt
        image3.png
        image4.png
        ...
```

## Usage

1. **Start the Server**:
   ```bash
   npm start
   ```
   The server runs by default on http://localhost:3000.

2. **Open in Browser**: Go to http://localhost:3000. Select a subset, then start ranking images by clicking on the image you prefer.

3. **Navigation**:
   - Rate AI Images: `index.html`
   - View Image Rankings: `rankings.html`
   - View LoRA Rankings: `lora-rankings.html`
   - Compare LoRAs Across Subsets: `compare-loras.html`
## Image Requirements for Normal ratings

- None really, can be any common image type. 
- You can include AI generated images with metadata here if you want, but the lora/metadata won't be tracked. This is purely for rating the images themselves.


## Image Requirements for LoRA ratings

- **PNG Format**: Images must be PNG files.
- **LoRA Metadata**: The PNG files should contain LoRA model metadata in their parameters for automatic extraction and tracking.

## Tips for Reliable Results

- Aim for at least 5 matches per image to get a minimally reliable rating. More matches = more accuracy.
- Keep subsets focused so you can do apples to apples comparisons. For example each subset could represent multiple model outputs on a shared prompt or concept.
- Compare multiple subsets containing the same LoRAs to get a correlation overview. Ex. produce 5 images on a shared prompt of your choice from 5 different loras, then put them in a single subset.
- The LoRA comparison page helps identify not just which models are "best" overall, but how they perform on specific subsets. 
- "OPC" (OverPerformance Count) metric is especially useful for identify the most consistently good performers.

## Data Storage

- Elo ratings and results are stored in `ratings-<subset>.json` files.
- No external database is required, simplifying setup and portability. Just npm install, npm start, slap images into folders, and you're good to go.

## License

This project is available under the MIT License.