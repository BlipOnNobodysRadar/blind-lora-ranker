let currentPair = [];
let subset = '';

document.addEventListener('DOMContentLoaded', () => {
  fetchNormalSubsets();
});

function fetchNormalSubsets() {
  fetch('/api/normal-subsets')
    .then(res => res.json())
    .then(data => {
      const sel = document.getElementById('normal-subset-select');
      sel.innerHTML = '';
      if (data.length === 0) {
        console.log('No normal subsets found.');
        return;
      }
      data.forEach(s => {
        const opt = document.createElement('option');
        opt.value = s;
        opt.textContent = s;
        sel.appendChild(opt);
      });
      subset = data[0]; // default
      updateUIForSubset();
    })
    .catch(err => console.error('Error fetching normal subsets:', err));
}
document.addEventListener('DOMContentLoaded', () => {
  const scalingToggle = document.getElementById('scalingToggle');
  if (scalingToggle) {
    // Set initial state based on whether it's checked
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

function updateUIForSubset() {
  fetchMatch();
  fetchProgress();
}

function fetchMatch() {
  fetch(`/api/normal-match/${subset}`)
    .then(res => res.json())
    .then(data => {
      if (data.error) {
        document.querySelector('.image-container').innerHTML = `<p>${data.error}</p>`;
        return;
      }
      currentPair = [data.image1, data.image2];
      document.getElementById('image1').src = `normal-images/${subset}/${currentPair[0]}`;
      document.getElementById('image2').src = `normal-images/${subset}/${currentPair[1]}`;
    })
    .catch(err => console.error('Error fetching normal match:', err));
}

function fetchProgress() {
  fetch(`/api/normal-progress/${subset}`)
    .then(res => res.json())
    .then(data => {
      const { minimalMatches } = data;
      updateProgressBar(minimalMatches);
    })
    .catch(err => console.error('Error fetching normal progress:', err));
}

function updateProgressBar(minimalMatches) {
  const max = 20;
  const bar = document.getElementById('overall-progress-bar');
  const label = document.getElementById('progress-label');

  let displayValue = minimalMatches;
  let percentage = (displayValue / max) * 100;
  if (displayValue > max) percentage = 100;

  bar.style.width = percentage + '%';
  label.textContent = displayValue + (displayValue > max ? '+' : '') + '/20';
  
  // Set the color based on progress thresholds
  if (minimalMatches < 5) {
    // Below minimum threshold - Red
    bar.style.backgroundColor = '#ff3333';
  } else if (minimalMatches < 10) {
    // Between minimum and decent - Orange
    bar.style.backgroundColor = '#ff7700';
  } else if (minimalMatches < 20) {
    // Between decent and good - Yellow
    bar.style.backgroundColor = '#ffcc00';
  } else {
    // At or above good threshold - Green
    bar.style.backgroundColor = '#4caf50';
  }
}

function vote(winnerIndex) {
  if (currentPair.length < 2) return;
  const winner = currentPair[winnerIndex - 1];
  const loser = currentPair[winnerIndex === 1 ? 1 : 0];

  fetch(`/api/normal-vote/${subset}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ winner, loser })
  })
    .then(res => res.json())
    .then(() => {
      fetchMatch();
      fetchProgress();
    })
    .catch(err => console.error('Error recording normal vote:', err));
}

function changeSubset() {
  const sel = document.getElementById('normal-subset-select');
  subset = sel.value;
  updateUIForSubset();
}

function confirmDelete(index) {
  const image = currentPair[index - 1];
  if (confirm(`Are you sure you want to delete ${image}?`)) {
    fetch(`/api/normal-image/${subset}/${image}`, { method: 'DELETE' })
      .then(res => res.json())
      .then(() => {
        fetchMatch();
        fetchProgress();
      })
      .catch(err => console.error('Error deleting normal image:', err));
  }
}
