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

1. Create an `images` directory at the project root.
2. Inside `images`, create subdirectories (one per subset).
3. Place PNG files (with LoRA metadata) in these subdirectories.

Example structure:
```
/images
    /set1
        image1.png
        image2.png
        ...
    /set2
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
   - Rate Images: `index.html`
   - View Image Rankings: `rankings.html`
   - View LoRA Rankings: `lora-rankings.html`
   - Compare LoRAs Across Subsets: `compare-loras.html`

## Image Requirements

- **PNG Format**: Images must be PNG files.
- **LoRA Metadata**: The PNG files should contain LoRA model metadata in their parameters for automatic extraction and tracking.

## Tips for Reliable Results

- Aim for at least 5 matches per image to get a minimally reliable rating. More matches = more accuracy.
- Keep subsets focused on a single prompt or scenario.
- Compare multiple subsets containing the same LoRAs to get a correlation overview.
- The "OPC" (OverPerformance Count) metric in the LoRA comparison page helps identify models that outperform subsets' averages.

## Data Storage

- Elo ratings and results are stored in `ratings-<subset>.json` files.
- No external database is required, simplifying setup and portability.

## License

This project is available under the MIT License. See the LICENSE file for details.