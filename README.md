# Blind LoRA Elo Ranker

## What is this?

A simple web app that helps you rank AI-generated images using blind comparisons. It removes the bias that comes from knowing which model created an image by:

-   Having you compare images without seeing their metadata
-   Using an Elo rating system (like in chess) to rank both images and models
-   Extracting LoRA model information from image metadata for automated analysis

Works with both AI-generated images containing LoRA metadata and regular images (in separate rating tracks).

## How it helps

When comparing images generated with different LoRA models (low-rank adaptation models for Stable Diffusion), it's easy to be influenced by knowing which model made which image. This tool addresses that problem through blind testing.

After enough comparisons, the system will show you:

-   Which LoRAs produced images you consistently preferred
-   The relative difference in performance between models (as Elo points)
-   Which specific images scored highest in your rankings

## Practical uses

This tool is particularly useful if you're:

-   **Training your own LoRAs** and need to compare different checkpoints or hyperparameter settings
-   **Testing multiple LoRAs** on the same prompt to see which performs best
-   **Evaluating different models** for specific use cases without name bias
-   **Organizing image collections** by subjective quality with a consistent system

## Key Features

-   **Initial Seeding via Star Ratings**: Quickly set initial Elo scores for new images using a 1-10 star rating system before head-to-head comparisons begin.
-   **Blind Comparison**: Compare pairs of images without seeing what model produced them (for AI images).
-   **Elo Rating System**: Uses chess-style Elo ratings that adjust based on win/loss patterns.
-   **LoRA Metadata Extraction**: Automatically pulls model information from AI-generated PNG image metadata.
-   **Separate Rating Tracks**: Maintain distinct rankings for AI images (with LoRA tracking) and normal images (without metadata tracking).
-   **Subset Organization**: Group related images for more meaningful comparisons (e.g., same prompt across different LoRAs, different checkpoints of the same LoRA).
-   **Progress Tracking**: Shows how many matches each image/LoRA has participated in, indicating ranking reliability.
-   **Image Zoom**: Zoom in on images during the rating process for detailed inspection.
-   **Directory Refresh**: Update available image subsets without restarting the server using the "Refresh Directories" button.
-   **Dark Mode**: Toggle between light and dark themes for comfortable viewing.
-   **Export Options**: Download image and LoRA ranking results as CSV files for further analysis (Note: CSV export may still have minor bugs).
-   **Cross-Subset Analysis**: Compare how LoRA models perform across different prompts or scenarios.
-   **Overperformance Count (OPC)**: Tracks how often a LoRA model exceeds the average rating across different subsets, helping identify consistently strong performers rather than models that just excel in one specific scenario.

## Status

> **Note**: This is a personal side project with a minimal UI. The core functions (image organization, initial seeding, blind rating, Elo calculation, and LoRA analysis) work reliably. However, some secondary features like CSV export and the correlation table on the comparison page may have minor bugs or limitations.

Use at your own risk and feel free to contribute or adapt it for your needs.

## Prerequisites

-   **Node.js (LTS)**: Install from [nodejs.org](https://nodejs.org/) or via your system's package manager:
    -   **Ubuntu/Debian**: `sudo apt install nodejs npm`
    -   **macOS (Homebrew)**: `brew install node`
    -   **Windows**: `winget install OpenJS.NodeJS.LTS`

## Installation

1.  **Get the repository**:
    -   **Git Clone**:
        ```bash
        git clone https://github.com/BlipOnNobodysRadar/blind-lora-ranker
        cd blind-lora-ranker
        ```
    -   **Zip Download**: Download the ZIP from GitHub and extract it, then navigate into the project folder.

2.  **Install Dependencies**:
    ```bash
    npm install
    ```

## Organize Images

Currently you need to do some manual movement of image files and folder-making to get started. Making this process doable in the UI is on the todo list, but for now:

1.  Inside `AI_images` (for LoRA tracking) or `normal_images` (for general image rating), create subdirectories for each subset you want. The name doesn't matter, pick what makes sense to you.
2.  For `AI_images` place PNG files (with LoRA metadata if available) in these subdirectories.
3.  For `normal_images` place images of any common filetype (`.png`, `.jpg`, `.jpeg`, `.webp`, etc.) in these subdirectories.

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

1.  **Start the Server**:
    ```bash
    npm start
    ```
    The server runs by default on http://localhost:3000.

2.  **Open in Browser**: Go to http://localhost:3000.
    -   Navigate to either "Rate AI Images" or "Rate Normal Images".
    -   Select a subset from the dropdown.
    -   **Seeding:** If the subset contains new, unrated images, you'll be prompted to give each a 1-10 star rating to establish its initial Elo score. You can rate all images or rate some and use the "Confirm Remaining as 5 Stars" option.
    -   **Head-to-Head:** Once images are seeded, you'll be presented with pairs. Click on the image you prefer to record your vote and update ratings.

3.  **Navigation**: Use the top navigation bar to switch between modes:
    -   Rate AI Images: `index.html`
    -   Rate Normal Images: `index-normal.html`
    -   View AI Image Rankings: `rankings.html`
    -   View Normal Image Rankings: `rankings-normal.html`
    -   View LoRA Rankings (from AI Images): `lora-rankings.html`
    -   Compare LoRAs Across Subsets: `compare-loras.html`

## Image Requirements for Normal ratings

-   Can be any common image type (`.png`, `.jpg`, `.jpeg`, `.webp`, `.bmp`, `.gif`).
-   Metadata (like LoRA info) is ignored in this mode; it's purely for rating the visual quality of images against each other.

## Image Requirements for LoRA ratings

-   **PNG Format**: Images must be PNG files.
-   **LoRA Metadata**: To automatically track LoRA performance, the PNG files should contain standard LoRA metadata (compatible with formats used by Automatic1111 or ComfyUI). Images without detectable LoRA metadata will still be ranked but won't contribute to specific LoRA scores unless they were previously rated and saved with LoRA info.

## Tips for Reliable Results

-   Aim for at least 5 matches per image/LoRA to get a minimally reliable rating. More matches (10-20+) lead to greater accuracy. The progress bar indicates the minimum matches achieved within the subset.
-   Keep subsets focused for meaningful comparisons (e.g., same prompt/concept across different LoRAs).
-   Use the "Compare LoRAs" page after rating multiple subsets containing the same LoRAs to understand their consistency and performance across different scenarios.
-   The "OPC" (OverPerformance Count) metric on the comparison page is useful for identifying LoRAs that consistently perform above the average for the subsets they appear in.

## Data Storage

-   Elo ratings and match counts are stored in JSON files within the `data/` directory.
    -   AI image/LoRA ratings: `data/ratings-<subset_name>.json`
    -   Normal image ratings: `data/ratings-normal-<subset_name>.json`
-   No external database is required, simplifying setup and portability. Just `npm install`, `npm start`, add images to the correct folders, and you're ready to rate.