let subsetsList = [];
let comparisonData = {}; 
// Structure: { loraName: { subsetName: {rating, matches}, ... }, ...}
let chosenSubsets = [];
let currentSort = { field: 'lora', direction: 'asc' };
let baselineSubset = null; // The subset chosen as baseline for diffs
let anonymize = false; // Whether to anonymize subset names

document.addEventListener('DOMContentLoaded', () => {
  fetchSubsets();
});

function fetchSubsets() {
  fetch('/api/subsets')
    .then(res => res.json())
    .then(data => {
      subsetsList = data;
      const sel = document.getElementById('subset-select');
      data.forEach(s => {
        const opt = document.createElement('option');
        opt.value = s;
        opt.textContent = s;
        sel.appendChild(opt);
      });
    })
    .catch(err => console.error('Error fetching subsets:', err));
}

function compare() {
  const sel = document.getElementById('subset-select');
  chosenSubsets = Array.from(sel.selectedOptions).map(o => o.value);
  if (chosenSubsets.length < 1) {
    alert('Please select at least one subset to compare.');
    return;
  }

  comparisonData = {};
  let promises = chosenSubsets.map(subset =>
    fetch(`/api/lora-rankings/${subset}`).then(r => r.json())
  );

  Promise.all(promises)
    .then(results => {
      results.forEach((arr, index) => {
        const subsetName = chosenSubsets[index];
        arr.forEach(item => {
          const { lora, rating, matches } = item;
          if (!comparisonData[lora]) comparisonData[lora] = {};
          comparisonData[lora][subsetName] = { rating, matches };
        });
      });

      // Default baseline to the first chosen subset if not set
      baselineSubset = chosenSubsets[0];
      populateBaselineSelect();
      document.getElementById('additional-controls').style.display = 'block';
      renderTable();
      showCorrelation();
    })
    .catch(err => console.error('Error comparing loras:', err));
}

function populateBaselineSelect() {
  const baselineSelect = document.getElementById('baseline-select');
  baselineSelect.innerHTML = '';
  chosenSubsets.forEach((s, i) => {
    const opt = document.createElement('option');
    opt.value = s;
    opt.textContent = getSubsetDisplayName(s, i);
    if (s === baselineSubset) opt.selected = true;
    baselineSelect.appendChild(opt);
  });
}

function changeBaseline() {
  const baselineSelect = document.getElementById('baseline-select');
  baselineSubset = baselineSelect.value;
  renderTable();
}

function toggleAnonymize() {
  anonymize = document.getElementById('anonymize-checkbox').checked;
  populateBaselineSelect();
  renderTable();
}

/**
 * Renders the comparison table with LoRAs, their ratings, matches, diffs, average, std dev and overperformance count.
 */
function renderTable() {
  if (chosenSubsets.length === 0) return;

  const searchTerm = document.getElementById('search').value.toLowerCase();
  const tableHead = document.getElementById('table-head');
  const tableBody = document.getElementById('table-body');
  tableHead.innerHTML = '';
  tableBody.innerHTML = '';

  // --- Build Headers ---
  const headRow = document.createElement('tr');

  // LoRA column
  createHeaderCell(headRow, 'LoRA', 'lora');

  // Avg Rating
  createHeaderCell(headRow, 'Avg Rating', 'avgRating');

  // Std Dev Rating
  createHeaderCell(headRow, 'Std Dev', 'stdDev');

  // Overperformance Count
  createHeaderCell(headRow, 'OPC', 'opc');

  // For each chosen subset, add rating & matches & diff (if more than one subset)
  chosenSubsets.forEach((subset, i) => {
    createHeaderCell(headRow, `${getSubsetDisplayName(subset, i)} Rating`, `rating:${subset}`);
    createHeaderCell(headRow, `${getSubsetDisplayName(subset, i)} Matches`, `matches:${subset}`);
    if (chosenSubsets.length > 1 && baselineSubset && subset !== baselineSubset) {
      createHeaderCell(headRow, `Diff vs ${getBaselineDisplayName()}`, `diff:${subset}`);
    }
  });

  tableHead.appendChild(headRow);

  // Compute subset-average ratings for OPC calculation
  const subsetAverages = computeSubsetAverages();

  // Filter & Prepare Data
  let rowsData = Object.keys(comparisonData)
    .filter(lora => lora.toLowerCase().includes(searchTerm))
    .map(lora => {
      const data = comparisonData[lora];
      const avgRating = computeAvgRating(data, chosenSubsets);
      const stdDev = computeStdDev(data, chosenSubsets, avgRating);
      const opc = computeOPC(data, chosenSubsets, subsetAverages);
      return { lora, data, avgRating, stdDev, opc };
    });

  // Sort data
  rowsData.sort((a, b) => compareSort(a, b));

  const baselineRatingMap = {};
  chosenSubsets.forEach(s => {
    baselineRatingMap[s] = comparisonData[rowsData[0]?.lora]?.[s]?.rating ?? 0;
  });

  // --- Build Rows ---
  rowsData.forEach(item => {
    const row = document.createElement('tr');

    // LoRA name
    createCell(row, item.lora);

    // Avg Rating
    createCell(row, item.avgRating.toFixed(2));

    // Std Dev Rating
    createCell(row, item.stdDev.toFixed(2));

    // OPC
    createCell(row, item.opc);

    const baselineRating = item.data[baselineSubset]?.rating ?? 0;

    chosenSubsets.forEach((subset, i) => {
      const rating = item.data[subset]?.rating ?? 0;
      const matches = item.data[subset]?.matches ?? 0;
      createCell(row, rating.toFixed(2));
      createCell(row, matches);

      if (chosenSubsets.length > 1 && subset !== baselineSubset) {
        const diff = rating - baselineRating;
        const diffTd = createCell(row, (diff >= 0 ? '+' : '') + diff.toFixed(2));
        if (diff > 0) diffTd.classList.add('highlight-diff-positive');
        else if (diff < 0) diffTd.classList.add('highlight-diff-negative');
      }
    });

    tableBody.appendChild(row);
  });

  // Add sorting handlers
  headRow.querySelectorAll('th').forEach(th => {
    th.onclick = () => {
      const field = th.dataset.field;
      if (!field) return;
      if (currentSort.field === field) {
        currentSort.direction = currentSort.direction === 'asc' ? 'desc' : 'asc';
      } else {
        currentSort.field = field;
        currentSort.direction = 'asc';
      }
      renderTable();
    };
  });

  updateSortIndicator();
}

/**
 * Returns a display name for the subset, either the actual name or a generic label.
 */
function getSubsetDisplayName(subset, index) {
  if (anonymize) {
    return `Subset ${index + 1}`;
  }
  return subset;
}

/**
 * Returns the baseline subset's display name.
 */
function getBaselineDisplayName() {
  const idx = chosenSubsets.indexOf(baselineSubset);
  return getSubsetDisplayName(baselineSubset, idx);
}

/**
 * Computes the average rating for a LoRA across all chosen subsets.
 */
function computeAvgRating(data, subsets) {
  let sum = 0;
  let count = 0;
  subsets.forEach(s => {
    if (data[s] && typeof data[s].rating === 'number') {
      sum += data[s].rating;
      count++;
    }
  });
  return count > 0 ? sum / count : 0;
}

/**
 * Computes the standard deviation of the LoRA's ratings across chosen subsets.
 */
function computeStdDev(data, subsets, mean) {
  let sumSq = 0;
  let count = 0;
  subsets.forEach(s => {
    if (data[s] && typeof data[s].rating === 'number') {
      let diff = data[s].rating - mean;
      sumSq += diff * diff;
      count++;
    }
  });
  if (count > 1) {
    return Math.sqrt(sumSq / (count));
  }
  return 0;
}

/**
 * Compute the Overperformance Count (OPC):
 * The number of subsets where the LoRA's rating is above that subset's average rating.
 */
function computeOPC(data, subsets, subsetAverages) {
  let count = 0;
  subsets.forEach(s => {
    const rating = data[s]?.rating;
    if (rating !== undefined && rating > subsetAverages[s]) {
      count++;
    }
  });
  return count;
}

/**
 * Compute the average rating per subset across all LoRAs for OPC calculation.
 */
function computeSubsetAverages() {
  const averages = {};
  chosenSubsets.forEach(s => {
    let sum = 0;
    let count = 0;
    for (let lora in comparisonData) {
      if (comparisonData[lora][s]) {
        sum += comparisonData[lora][s].rating;
        count++;
      }
    }
    averages[s] = count > 0 ? sum / count : 0;
  });
  return averages;
}

/**
 * Creates a table header cell (th) with sorting data attributes.
 */
function createHeaderCell(parentRow, text, field) {
  let th = document.createElement('th');
  th.textContent = text;
  th.dataset.field = field;
  parentRow.appendChild(th);
}

/**
 * Creates a standard table cell (td) and appends it to the given row.
 */
function createCell(row, text) {
  const td = document.createElement('td');
  td.textContent = text;
  row.appendChild(td);
  return td;
}

/**
 * Returns a value for sorting based on currentSort.field.
 */
function getSortValue(obj) {
  const f = currentSort.field;

  if (f === 'lora') {
    return obj.lora.toLowerCase();
  }
  if (f === 'avgRating') {
    return obj.avgRating;
  }
  if (f === 'stdDev') {
    return obj.stdDev;
  }
  if (f === 'opc') {
    return obj.opc;
  }

  // rating:<subset>, matches:<subset>, diff:<subset>
  const [type, subset] = f.split(':');
  const ratingVal = subset => obj.data[subset]?.rating ?? 0;
  const matchesVal = subset => obj.data[subset]?.matches ?? 0;

  if (type === 'rating') return ratingVal(subset);
  if (type === 'matches') return matchesVal(subset);
  if (type === 'diff') {
    const baselineRating = obj.data[baselineSubset]?.rating ?? 0;
    return ratingVal(subset) - baselineRating;
  }

  return 0;
}

function compareSort(a, b) {
  const valA = getSortValue(a);
  const valB = getSortValue(b);
  if (valA < valB) return currentSort.direction === 'asc' ? -1 : 1;
  if (valA > valB) return currentSort.direction === 'asc' ? 1 : -1;
  return 0;
}

function updateSortIndicator() {
  const thead = document.getElementById('table-head');
  thead.querySelectorAll('th').forEach(th => {
    th.classList.remove('sort-asc', 'sort-desc');
    if (th.dataset.field === currentSort.field) {
      th.classList.add(currentSort.direction === 'asc' ? 'sort-asc' : 'sort-desc');
    }
  });
}

function downloadCSV() {
  if (chosenSubsets.length === 0) return;

  const searchTerm = (document.getElementById('search').value || '').toLowerCase();
  const subsetAverages = computeSubsetAverages();

  let headers = ['LoRA', 'Avg_Rating', 'Std_Dev', 'OPC'];
  chosenSubsets.forEach((s, i) => {
    headers.push(`${getSubsetDisplayName(s, i)}_rating`, `${getSubsetDisplayName(s, i)}_matches`);
    if (chosenSubsets.length > 1 && s !== baselineSubset) {
      headers.push(`diff_vs_${getBaselineDisplayName()}`);
    }
  });

  let rows = Object.keys(comparisonData)
    .filter(l => l.toLowerCase().includes(searchTerm))
    .map(l => {
      const data = comparisonData[l];
      const avgRating = computeAvgRating(data, chosenSubsets);
      const stdDev = computeStdDev(data, chosenSubsets, avgRating);
      const opc = computeOPC(data, chosenSubsets, subsetAverages);
      const rowArr = [l, avgRating.toFixed(2), stdDev.toFixed(2), opc];
      const baselineRating = data[baselineSubset]?.rating ?? 0;

      chosenSubsets.forEach((s, i) => {
        const rating = data[s]?.rating ?? 0;
        const matches = data[s]?.matches ?? 0;
        rowArr.push(rating.toFixed(2), matches);
        if (chosenSubsets.length > 1 && s !== baselineSubset) {
          const diff = rating - baselineRating;
          rowArr.push(diff.toFixed(2));
        }
      });

      return rowArr;
    });

  const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  downloadBlob(csvContent, 'lora-comparison.csv');
}

/**
 * Utility function to download text content as a blob file.
 */
function downloadBlob(content, filename) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function showCorrelation() {
  const corrDiv = document.getElementById('correlation');
  corrDiv.innerHTML = '';

  if (chosenSubsets.length < 2) {
    return;
  }

  const subsetsData = chosenSubsets.map(s => getRatingsArrayForSubset(s));
  let matrix = computeCorrelationMatrix(subsetsData);

  let html = '<h3>Correlation Between Subsets (Ratings)</h3>';
  html += '<table style="margin:0 auto;border-collapse:collapse;">';
  html += '<tr><th></th>' + chosenSubsets.map((s, i) => `<th>${getSubsetDisplayName(s, i)}</th>`).join('') + '</tr>';
  for (let i = 0; i < chosenSubsets.length; i++) {
    html += `<tr><th style="text-align:left;">${getSubsetDisplayName(chosenSubsets[i], i)}</th>`;
    for (let j = 0; j < chosenSubsets.length; j++) {
      html += `<td style="border:1px solid #ddd;padding:5px;">${matrix[i][j].toFixed(2)}</td>`;
    }
    html += '</tr>';
  }
  html += '</table>';

  corrDiv.innerHTML = html;
}

function getRatingsArrayForSubset(subset) {
  return Object.keys(comparisonData).map(lora => (comparisonData[lora][subset]?.rating ?? 0));
}

function computeCorrelationMatrix(dataArrays) {
  const n = dataArrays.length;
  const matrix = Array.from({ length: n }, () => Array(n).fill(0));

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      matrix[i][j] = (i === j) ? 1 : correlationCoefficient(dataArrays[i], dataArrays[j]);
    }
  }

  return matrix;
}

function correlationCoefficient(x, y) {
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
