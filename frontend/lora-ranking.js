const THRESHOLDS = [
  { label: 'Minimum', value: 5 },
  { label: 'Decent', value: 10 },
  { label: 'Good', value: 20 }
];

const MAX_MATCHES = THRESHOLDS[THRESHOLDS.length - 1].value;

document.addEventListener('DOMContentLoaded', () => {
  fetchSubsetsForLoraRankings();
});

function fetchSubsetsForLoraRankings() {
  fetch('/api/subsets')
    .then(res => res.json())
    .then(subsets => {
      const subsetSelect = document.getElementById('subset');
      subsetSelect.innerHTML = '';
      subsets.forEach(s => {
        const option = document.createElement('option');
        option.value = s;
        option.textContent = s;
        subsetSelect.appendChild(option);
      });
      const currentSubset = new URLSearchParams(window.location.search).get('subset') || subsets[0];
      subsetSelect.value = currentSubset;
      fetchRankings(currentSubset);
    })
    .catch(error => console.error('Error fetching subsets:', error));
}

function fetchRankings(subset) {
  fetch(`/api/lora-rankings/${subset}`)
    .then(response => {
      if (!response.ok) {
        return response.json().then(err => Promise.reject(err));
      }
      return response.json();
    })
    .then(data => {
      // Ensure data is an array
      if (!Array.isArray(data)) {
        console.error('Unexpected data format:', data);
        return;
      }

      const rankingContainer = document.getElementById('ranking-container');
      rankingContainer.innerHTML = '';
      let allMinimumReached = true;

      data.forEach(item => {
        const progressPercentage = Math.min((item.matches / MAX_MATCHES) * 100, 100);
        if (item.matches < THRESHOLDS[0].value) {
          allMinimumReached = false;
        }

        const rankingItem = document.createElement('div');
        rankingItem.className = 'ranking-item';
        rankingItem.innerHTML = `
          <span><strong>${item.lora}</strong></span>
          <span>Elo: ${item.rating.toFixed(2)}</span>
          <span>Matches: ${item.matches}</span>
          <div class="progress-bar-container">
            <div class="progress-bar-background"></div>
            <div class="progress-bar" style="width: ${progressPercentage}%"></div>
            ${renderTicks()}
          </div>
          <span>${getStatusMessage(item.matches)}</span>
        `;
        rankingContainer.appendChild(rankingItem);
      });

      // Handle notification
      const notification = document.getElementById('notification');
      if (allMinimumReached && data.length > 0) {
        notification.style.display = 'block';
      } else {
        notification.style.display = 'none';
      }
    })
    .catch(error => {
      console.error('Error fetching rankings:', error);
    });
}

function renderTicks() {
  return THRESHOLDS.map(threshold => {
    const leftPercent = (threshold.value / MAX_MATCHES) * 100;
    return `
      <div class="tick" style="left: ${leftPercent}%;">
        <div class="tick-label">${threshold.value}</div>
      </div>
    `;
  }).join('');
}

function getStatusMessage(matches) {
  for (let i = THRESHOLDS.length - 1; i >= 0; i--) {
    if (matches >= THRESHOLDS[i].value) {
      return `${THRESHOLDS[i].label} Threshold Reached`;
    }
  }
  return `Progress: ${matches}/${MAX_MATCHES} matches`;
}

function changeSubset() {
  const subset = document.getElementById('subset').value;
  window.location.search = `?subset=${subset}`;
}
