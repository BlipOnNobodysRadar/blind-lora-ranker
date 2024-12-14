// File: /home/blip/Desktop/projects/do not push/AI-image-blind-elo-ranker/frontend/common.js

/**
 * Fetches all subsets from the backend.
 * @returns {Promise<string[]>} - Promise resolving to an array of subset names.
 */
function fetchSubsetsList() {
    return fetch('/api/subsets')
      .then(res => res.json())
      .catch(err => {
        console.error('Error fetching subsets:', err);
        return [];
      });
  }
  
  /**
   * Sorts an array of objects based on a specified field and direction.
   * @param {Object[]} data - Array of objects to sort.
   * @param {string} field - Field to sort by.
   * @param {string} direction - 'asc' or 'desc'.
   * @returns {Object[]} - Sorted array.
   */
  function sortData(data, field, direction) {
    return data.sort((a, b) => {
      let valA = a[field];
      let valB = b[field];
  
      // If sorting by name, compare as strings
      if (typeof valA === 'string') {
        valA = valA.toLowerCase();
        valB = valB.toLowerCase();
      }
  
      if (valA < valB) return direction === 'asc' ? -1 : 1;
      if (valA > valB) return direction === 'asc' ? 1 : -1;
      return 0;
    });
  }
  
  /**
   * Creates a CSV string from headers and rows.
   * @param {string[]} headers - Array of header strings.
   * @param {string[][]} rows - Array of row arrays.
   * @returns {string} - CSV formatted string.
   */
  function createCSV(headers, rows) {
    return [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  }
  
  /**
   * Triggers a download of the given CSV content with the specified filename.
   * @param {string} csvContent - The CSV content.
   * @param {string} filename - The desired filename.
   */
  function downloadCSVFile(csvContent, filename) {
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }
  
  /**
   * Computes the Pearson correlation coefficient between two arrays.
   * @param {number[]} x - First array of numbers.
   * @param {number[]} y - Second array of numbers.
   * @returns {number} - Pearson correlation coefficient.
   */
  function computePearsonCorrelation(x, y) {
    const length = x.length;
    const meanX = x.reduce((a, b) => a + b, 0) / length;
    const meanY = y.reduce((a, b) => a + b, 0) / length;
  
    let numerator = 0;
    let denomX = 0;
    let denomY = 0;
  
    for (let i = 0; i < length; i++) {
      const dx = x[i] - meanX;
      const dy = y[i] - meanY;
      numerator += dx * dy;
      denomX += dx * dx;
      denomY += dy * dy;
    }
  
    return numerator / Math.sqrt(denomX * denomY || 1);
  }
  