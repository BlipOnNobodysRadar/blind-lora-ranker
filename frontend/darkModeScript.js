// Calls our new /api/refresh endpoint and reloads the page
function refreshDirectories() {
    fetch('/api/refresh', { method: 'POST' })
      .then(res => res.json())
      .then(data => {
        alert(data.message || 'Directories refreshed.');
        // Optionally re-fetch subsets instead of full page reload:
        window.location.reload();
      })
      .catch(err => console.error('Error refreshing directories:', err));
  }
  
  document.addEventListener('DOMContentLoaded', () => {
    const toggle = document.getElementById('darkModeToggle');
    
    // Check localStorage for a saved preference
    const storedPreference = localStorage.getItem('darkMode');
    if (storedPreference === 'off') {
      // If user previously turned dark mode off
      document.body.classList.remove('dark-mode');
      toggle.checked = false;
    } else if (storedPreference === 'on') {
      // If user previously turned dark mode on
      document.body.classList.add('dark-mode');
      toggle.checked = true;
    } else {
      // No preference stored, default to ON
      document.body.classList.add('dark-mode');
      toggle.checked = true;
      localStorage.setItem('darkMode', 'on');
    }
  
    // Listen for user toggling
    toggle.addEventListener('change', () => {
      if (toggle.checked) {
        document.body.classList.add('dark-mode');
        localStorage.setItem('darkMode', 'on');
      } else {
        document.body.classList.remove('dark-mode');
        localStorage.setItem('darkMode', 'off');
      }
    });
  });
  