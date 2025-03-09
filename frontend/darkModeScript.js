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
  
      // Turn on dark mode by default and set up toggle
      document.addEventListener('DOMContentLoaded', () => {
        document.body.classList.add('dark-mode'); // default ON
        const toggle = document.getElementById('darkModeToggle');
        toggle.addEventListener('change', () => {
          if (toggle.checked) {
            document.body.classList.add('dark-mode');
          } else {
            document.body.classList.remove('dark-mode');
          }
        });
      });