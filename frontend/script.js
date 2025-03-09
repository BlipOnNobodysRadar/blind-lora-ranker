let currentPair = [];
let subset = '';

document.addEventListener('DOMContentLoaded', () => {
  fetchSubsets();
});
document.addEventListener('DOMContentLoaded', () => {
  const scalingToggle = document.getElementById('scalingToggle');
  if (scalingToggle) {
    // Set initial state based on whether it’s checked
    handleScalingToggle();
    
    // Listen for user changes
    scalingToggle.addEventListener('change', handleScalingToggle);
  }
});

function handleScalingToggle() {
  const scalingToggle = document.getElementById('scalingToggle');
  if (!scalingToggle) return;

  if (scalingToggle.checked) {
    document.body.classList.add('scale-images');
  } else {
    document.body.classList.remove('scale-images');
  }
}

/**
 * Fetches all subsets and initializes the UI.
 */
function fetchSubsets() {
  fetch('/api/subsets')
    .then(response => response.json())
    .then(data => {
      const subsetSelect = document.getElementById('subset-select');
      subsetSelect.innerHTML = '';
      data.forEach(s => {
        const option = document.createElement('option');
        option.value = s;
        option.textContent = s;
        subsetSelect.appendChild(option);
      });
      subset = data[0]; // Default to first subset
      updateUIForSubset();
    })
    .catch(err => console.error('Error fetching subsets:', err));
}

/**
 * Updates the UI based on the selected subset.
 */
function updateUIForSubset() {
  fetchMatch();
  fetchProgress();
}

/**
 * Fetches a pair of images to be rated.
 */
function fetchMatch() {
  fetch(`/api/match/${subset}`)
    .then(response => response.json())
    .then(data => {
      if (data.error) {
        console.error(data.error);
        // Optionally, display a message to the user
        document.querySelector('.image-container').innerHTML = `<p>${data.error}</p>`;
        return;
      }
      currentPair = [data.image1, data.image2];
      document.getElementById('image1').src = `images/${subset}/${currentPair[0]}`;
      document.getElementById('image2').src = `images/${subset}/${currentPair[1]}`;
    })
    .catch(err => console.error('Error fetching match:', err));
}

/**
 * Fetches the progress data and updates the progress bar.
 */
function fetchProgress() {
  fetch(`/api/progress/${subset}`)
    .then(response => response.json())
    .then(data => {
      const { minimalMatches } = data;
      updateProgressBar(minimalMatches);
    })
    .catch(err => console.error('Error fetching progress:', err));
}

/**
 * Updates the visual progress bar based on minimal matches.
 * @param {number} minimalMatches - The minimal number of matches across all images.
 */
function updateProgressBar(minimalMatches) {
  const max = 20;
  const bar = document.getElementById('overall-progress-bar');
  const label = document.getElementById('progress-label');

  let displayValue = minimalMatches;
  let percentage = (displayValue / max) * 100;
  
  if (displayValue > max) {
    percentage = 100;
  }

  bar.style.width = percentage + '%';
  label.textContent = displayValue + (displayValue > max ? '+' : '') + '/20';
}

/**
 * Records a vote with the specified result type.
 * @param {number} winnerIndex - The index (1 or 2) of the winning image.
 * @param {string} resultType - The type of result: 'win' or 'strongWin'.
 */
function vote(winnerIndex, resultType) {
  if (currentPair.length < 2) {
    console.error('Not enough images to vote');
    return;
  }
  const winner = currentPair[winnerIndex - 1];
  const loser = currentPair[winnerIndex === 1 ? 1 : 0];
  fetch(`/api/vote/${subset}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ winner, loser, result: resultType })
  })
    .then(res => res.json())
    .then(() => { 
      fetchMatch();
      fetchProgress(); 
    })
    .catch(err => console.error('Error recording vote:', err));
}

/**
 * Records a draw vote.
 */
function voteDraw() {
  if (currentPair.length < 2) {
    console.error('Not enough images to vote');
    return;
  }
  const [image1, image2] = currentPair;
  fetch(`/api/vote/${subset}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ winner: image1, loser: image2, result: 'draw' })
  })
    .then(res => res.json())
    .then(() => { 
      fetchMatch();
      fetchProgress(); 
    })
    .catch(err => console.error('Error recording draw:', err));
}

/**
 * Handles the subset change event.
 */
function changeSubset() {
  const sel = document.getElementById('subset-select');
  subset = sel.value;
  updateUIForSubset();
}

/**
 * Confirms and deletes an image.
 * @param {number} imageIndex - The index (1 or 2) of the image to delete.
 */
function confirmDelete(imageIndex) {
  const image = currentPair[imageIndex - 1];
  if (confirm(`Are you sure you want to delete ${image}?`)) {
    deleteImage(image);
  }
}

/**
 * Deletes an image from the subset.
 * @param {string} image - The image filename to delete.
 */
function deleteImage(image) {
  fetch(`/api/image/${subset}/${image}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' }
  })
    .then(res => res.json())
    .then(() => {
      fetchMatch();
      fetchProgress();
    })
    .catch(err => console.error('Error deleting image:', err));
}
