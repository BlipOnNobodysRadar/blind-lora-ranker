const fs = require('fs');
const path = require('path');

function aggregateFiles(rootDir, outputFile, excludeDirs = [], excludeFiles = [], additionalExcludeExtensions = []) {
  // Default excluded extensions
  const defaultExcludedExtensions = [
    // Images
    '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.tiff', '.webp', '.svg', '.ico',
    // Videos
    '.mp4', '.avi', '.mov', '.wmv', '.flv', '.mkv', '.webm',
    // Audio
    '.mp3', '.wav', '.ogg', '.m4a', '.flac',
    // Archives
    '.zip', '.rar', '.7z', '.tar', '.gz', '.bz2',
    // Binaries and executables
    '.exe', '.dll', '.so', '.dylib', '.bin',
    // Database files
    '.db', '.sqlite', '.sqlite3',
    // Other binary formats
    '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
    // Font files
    '.ttf', '.otf', '.woff', '.woff2',
  ];

  // Combine default and additional excluded extensions
  const excludedExtensions = new Set([
    ...defaultExcludedExtensions,
    ...additionalExcludeExtensions
  ]);

  const outStream = fs.createWriteStream(outputFile);

  function shouldProcessFile(filePath) {
    const extension = path.extname(filePath).toLowerCase();
    const fileName = path.basename(filePath);
    
    // Check if file is in exclude list
    if (excludeFiles.includes(fileName)) {
      return false;
    }

    // Check if extension is in excluded extensions
    if (excludedExtensions.has(extension)) {
      return false;
    }

    // Exclude files in 'backend' directory that start with 'ratings'
    const relativePath = path.relative(rootDir, filePath);
    const pathParts = relativePath.split(path.sep);
    if (pathParts.includes('backend') && fileName.startsWith('ratings')) {
      return false;
    }

    return true;
  }

  function traverseDirectory(currentDir) {
    try {
      fs.readdirSync(currentDir).forEach(item => {
        const itemPath = path.join(currentDir, item);
        try {
          const stat = fs.statSync(itemPath);
          
          if (stat.isDirectory()) {
            if (!excludeDirs.includes(item)) {
              traverseDirectory(itemPath);
            }
          } else if (stat.isFile()) {
            if (shouldProcessFile(itemPath)) {
              try {
                const content = fs.readFileSync(itemPath, 'utf-8');
                outStream.write(`<file_start>\n`);
                outStream.write(`File: ${itemPath}\n`);
                outStream.write(content);
                outStream.write(`\n<file_end>\n\n`);
              } catch (readError) {
                // Skip files that can't be read as UTF-8
                console.warn(`Skipping non-text file or unreadable file: ${itemPath}`);
              }
            }
          }
        } catch (err) {
          if (err.code === 'EPERM') {
            console.warn(`Skipping inaccessible path: ${itemPath}`);
          } else {
            throw err;
          }
        }
      });
    } catch (err) {
      if (err.code === 'EPERM') {
        console.warn(`Skipping inaccessible directory: ${currentDir}`);
      } else {
        throw err;
      }
    }
  }

  traverseDirectory(rootDir);
  outStream.end();
}

// Example usage
const rootDirectory = __dirname;
const outputFile = 'aggregated_code.txt';
const excludeDirectories = ['.git', 'node_modules', 'dist', 'build'];
const excludeFiles = [
  '.gitignore', 
  'README.md', 
  'aggregated_code.txt', 
  'aggregate-code.js',
  'aggregateCode.js',
  'package-lock.json', 
  'readme.md', 
  '.env', 
  'API spec.yaml',
  'LICENSE',
];
const additionalExcludeExtensions = ['.log', '.cache']; // Add any custom extensions to exclude

aggregateFiles(
  rootDirectory, 
  outputFile, 
  excludeDirectories, 
  excludeFiles,
  additionalExcludeExtensions
);