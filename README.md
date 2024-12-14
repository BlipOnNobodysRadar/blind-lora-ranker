# Blind LoRA Elo Ranker

A web application for blind comparison ranking of AI-generated images using an Elo rating system. This tool helps evaluate and compare images generated with different LoRA models by tracking both individual image performance and overall LoRA model effectiveness. Basically, if you're testing lora variations on the same prompt, this tool will help you rank them without bias.

> **Note**: This is a personal side project in an early state. The core functionality (image comparison, Elo ratings, and LoRA analysis) works, but some features like CSV export are buggy and the UI is basic. Use at your own risk!

## Features

- **Blind Comparison**: Rate images without knowing their LoRA models to reduce bias
- **Elo Rating System**: Uses chess-style Elo ratings for accurate ranking
- **LoRA Model Analysis**: Automatically extracts and tracks LoRA model performance
- **Multiple Image Sets**: Support for different subsets of images
- **Progress Tracking**: Visual feedback on rating progress
- **Export Options**: Download rankings as CSV files
- **Correlation Analysis**: Compare LoRA performance across different subsets

## Setup

1. Install Node.js if you haven't already
2. Get the repository:

   Either clone with git:
   ```bash
   git clone https://github.com/BlipOnNobodysRadar/blind-lora-ranker
   cd blind-lora-ranker
   ```

   Or download and extract the ZIP from the GitHub repository page

3. Install dependencies:
   ```bash
   npm install
   ```

4. Create an `images` directory in the project root
5. Create subdirectories in `images` for each set of images you want to compare
6. Place PNG images in these subdirectories

Example directory structure:
```
/images
    /set1
        image1.png
        image2.png
        ...
    /set2
        image1.png
        image2.png
        ...
```

## Usage

1. Start the server:
   ```bash
   npm start
   ```

2. Open `http://localhost:3000` in your browser

3. Use the application:
   - Select an image subset from the dropdown
   - Click on the better image in each pair
   - Track progress in the progress bar
   - View rankings in the Rankings tabs
   - Compare LoRA performance in the Compare LoRAs tab

## Image Requirements

- Images must be in PNG format
- PNGs must contain LoRA metadata in their parameters

## Features in Detail

### Rating Images
- Simple click interface
- Progress tracking for each subset
- Minimum match thresholds for reliable rankings

### Viewing Rankings
- Sort by rating, matches, or filename
- Search functionality
- Export to CSV
- Visual progress indicators

### LoRA Analysis
- Automatic LoRA model extraction
- Cross-subset performance comparison
- Correlation analysis between different subsets
- Detailed statistics and visualizations

### Data Management
- Automatic saving of ratings
- Image deletion capability
- Multiple subset support
- Export functionality

## Technical Details

- Backend: Node.js with Express
- Frontend: Vanilla JavaScript
- Rating System: Modified Elo with dynamic K-factor
- Data Storage: JSON files
- Image Metadata: PNG metadata parsing

## Tips for Best Results

1. Meaningful elo ratings can occur with as few as 5 matches, but the more matches the more reliable the ratings.
2. Create focused subsets for meaningful comparisons
3. Use consistent prompts within subsets
4. If testing multiple subsets on the same loras, you can use the compare LoRAs page to see the average performance of the loras across multiple subsets.
5. The "OPC" metric within the compare LoRAs page is overperformance count. It represents the number of subsets in which the LoRA's rating exceeds that subset's average rating. This helps identify overperformers relative to the group.

## License

MIT License
