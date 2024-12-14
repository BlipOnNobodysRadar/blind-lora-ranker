# Blind LoRA Elo Ranker

A web application that lets you rank AI-generated images blindly, reducing visual bias while testing different LoRA (LoRA: Low-Rank Adaptation) model variations on the same prompt. By employing an Elo rating system, you can objectively compare images and their underlying LoRA models.

**Why "Blind"?** Because you rate images without knowing which LoRA they came from, ensuring a fair and unbiased ranking. Over time, the Elo ratings reveal which images (and LoRAs) consistently perform better, helping you refine and select the best models.

## Key Features

- **Blind Comparison**: Compare image pairs without seeing their associated LoRA models, reducing brand/model bias.
- **Elo Rating System**: Assigns a chess-like Elo rating to each image, adapting ratings with each comparison.
- **LoRA Performance Tracking**: Automatically extracts LoRA model details from image metadata to evaluate model-level performance.
- **Multiple Image Subsets**: Organize images into subsets for focused testing scenarios.
- **Progress Tracking**: The UI shows how many matches have been made for reliability.
- **Export Options**: Download results as CSV files for further analysis.
- **Correlation & Comparison**: Compare LoRA performance across different subsets and view correlation metrics.

## Status

> **Note**: This is an early-stage personal side project. Core functionalities (blind rating, Elo calculation, and LoRA analysis) are stable, but some features, like CSV export and correlation analysis, may have minor bugs. The UI is minimal.

Use at your own risk and feel free to contribute or adapt it for your own needs.

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