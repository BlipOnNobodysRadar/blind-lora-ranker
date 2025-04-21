let currentPair = [];
let subset = '';
let subsetType = 'normal'; // 'ai' or 'normal'
let uninitializedImages = []; // Store list of images needing seeding

document.addEventListener('DOMContentLoaded', () => {
  const scalingToggle = document.getElementById('scalingToggle');
  if (scalingToggle) {
    // Set initial state based on whether it's checked
    handleScalingToggle();

    // Listen for user changes
    scalingToggle.addEventListener('change', handleScalingToggle);
  }

  // Call initialization logic
  initializeSubset();

   // Add event listeners for the Draw button
   document.querySelector('#head-to-head-ui button[onclick="voteDraw()"]')
    .addEventListener('click', voteDraw);
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
 * Fetches all normal subsets and initializes the UI based on subset initialization status.
 */
function initializeSubset() {
  fetch('/api/normal-subsets')
    .then(response => response.json())
    .then(data => {
      const subsetSelect = document.getElementById('normal-subset-select');
      subsetSelect.innerHTML = '';
      if (data.length === 0) {
          // Handle no subsets case
           document.querySelector('#head-to-head-ui .image-container').innerHTML = '<p>No normal image subsets found. Add subdirectories to /normal_images.</p>';
           document.getElementById('image-count-status').textContent = '';
           document.getElementById('seeding-gallery').style.display = 'none';
           document.getElementById('head-to-head-ui').style.display = 'none';
          return;
      }
      data.forEach(s => {
        const option = document.createElement('option');
        option.value = s;
        option.textContent = s;
        subsetSelect.appendChild(option);
      });

      // Set subset based on query params or default to first
      const params = new URLSearchParams(window.location.search);
      subset = params.get('subset') || data[0];
      subsetSelect.value = subset;

      // Now check initialization status for the selected subset
      checkInitializationStatus(subset);

    })
    .catch(err => {
        console.error('Error fetching normal subsets:', err);
         document.querySelector('#head-to-head-ui .image-container').innerHTML = `<p>Error loading subsets: ${err.message}</p>`;
         document.getElementById('image-count-status').textContent = '';
         document.getElementById('seeding-gallery').style.display = 'none';
         document.getElementById('head-to-head-ui').style.display = 'none';
    });
}

/**
 * Checks if the current subset has uninitialized images and switches UI mode.
 * @param {string} subsetName - The name of the current subset.
 */
function checkInitializationStatus(subsetName) {
     fetch(`/api/normal-match/${subsetName}`) // Use the normal-match endpoint
       .then(response => response.json())
       .then(data => {
           if (data.error) {
               console.error(data.error);
                document.querySelector('#head-to-head-ui .image-container').innerHTML = `<p>Error loading normal subset data: ${data.error}</p>`;
                document.getElementById('image-count-status').textContent = '';
                document.getElementById('seeding-gallery').style.display = 'none';
                document.getElementById('head-to-head-ui').style.display = 'none';
               return;
           }

           if (data.requiresSeeding) {
               // Need to seed images
               uninitializedImages = data.uninitializedImages;
               showSeedingUI();
               renderSeedingGallery(uninitializedImages);
               fetchProgress(); // Fetch progress to update image count status
           } else {
               // All images are initialized, proceed with head-to-head
               uninitializedImages = []; // Clear the list
               showHeadToHeadUI();
               // Data already contains the first match pair, so use it
               currentPair = [data.image1, data.image2];
               displayMatch();
               fetchProgress(); // Fetch progress for the bar
           }
       })
       .catch(err => {
           console.error('Error checking normal initialization status:', err);
            document.querySelector('#head-to-head-ui .image-container').innerHTML = `<p>Error checking subset status: ${err.message}</p>`;
            document.getElementById('image-count-status').textContent = '';
            document.getElementById('seeding-gallery').style.display = 'none';
            document.getElementById('head-to-head-ui').style.display = 'none';
       });
}

/**
 * Shows the seeding gallery UI and hides the head-to-head UI.
 */
function showSeedingUI() {
    document.getElementById('head-to-head-ui').style.display = 'none';
    document.getElementById('seeding-gallery').style.display = 'block';
}

/**
 * Shows the head-to-head UI and hides the seeding gallery UI.
 */
function showHeadToHeadUI() {
    document.getElementById('seeding-gallery').style.display = 'none';
    document.getElementById('head-to-head-ui').style.display = 'block';
}

/**
 * Renders the gallery of uninitialized images for seeding.
 * @param {string[]} images - Array of image filenames to seed.
 */
function renderSeedingGallery(images) {
  const galleryDiv = document.getElementById('image-seeding-cards');
  galleryDiv.innerHTML = ''; // Clear previous images
  const confirmButton = document.getElementById('confirm-seeding');
  confirmButton.disabled = true; // Disable button until all ratings are selected

  if (images.length === 0) {
       galleryDiv.innerHTML = '<p>No uninitialized images found in this subset.</p>';
       confirmButton.style.display = 'none'; // Hide button if no images
       return;
  } else {
       confirmButton.style.display = 'block';
  }


  images.forEach(image => {
      const imageWrapper = document.createElement('div');
      imageWrapper.className = 'image-wrapper seeding-card'; // Added 'seeding-card' class for potential specific styling
      imageWrapper.dataset.imageName = image; // Store image name

      const imgElement = document.createElement('img');
      imgElement.src = `normal-images/${subset}/${image}`; // Corrected for Normal images
      imgElement.alt = image;
      imgElement.loading = 'lazy'; // Add lazy loading
      // imgElement.style.maxWidth = '200px'; // REMOVE THIS LINE, CSS handles sizing now


      const nameElement = document.createElement('p');
      nameElement.textContent = image;
       nameElement.style.wordBreak = 'break-all'; // Prevent long names overflowing
       nameElement.style.overflowWrap = 'break-word'; // Alias for word-break


      const ratingDiv = document.createElement('div');
      ratingDiv.className = 'star-rating';
      ratingDiv.dataset.imageName = image; // Link rating group to image

      // Create 10 stars (radio buttons)
      for (let i = 10; i >= 1; i--) {
          const input = document.createElement('input');
          input.type = 'radio';
          input.id = `star${i}-${image}`;
          input.name = `rating-${image}`; // Unique name for the group per image
          input.value = i;
          input.addEventListener('change', checkAllRatingsSelected); // Add listener

          const label = document.createElement('label');
          label.htmlFor = `star${i}-${image}`;
          label.textContent = '★';

          ratingDiv.appendChild(input);
          ratingDiv.appendChild(label);
      }

      imageWrapper.appendChild(imgElement);
      imageWrapper.appendChild(nameElement);
      imageWrapper.appendChild(ratingDiv);

      // Add event listeners for zoom effect to the wrapper
      imageWrapper.addEventListener('mouseenter', handleImageZoomEnter);
      imageWrapper.addEventListener('mouseleave', handleImageZoomLeave);
      imgElement.addEventListener('mousemove', handleImageZoomMove);


      // Hide delete button in seeding view
       const deleteButton = document.createElement('button');
       deleteButton.textContent = 'Delete';
       deleteButton.style.display = 'none';
       imageWrapper.appendChild(deleteButton);


      galleryDiv.appendChild(imageWrapper);
  });

  // Initial check to potentially enable the confirm button
  checkAllRatingsSelected();
}


// --- New Zoom Effect Functions ---

function handleImageZoomEnter(event) {
  const img = event.target.querySelector('img');
  if (img) {
      // The CSS :hover rule handles the initial transform scale
      // We only need mousemove for origin
  }
}

function handleImageZoomLeave(event) {
  const img = event.target.querySelector('img');
  if (img) {
      // Reset transform-origin when leaving the wrapper
      img.style.transformOrigin = 'center center';
      // The CSS :hover rule will handle the transform scale resetting
  }
}

function handleImageZoomMove(event) {
  const img = event.target;
  if (img.tagName === 'IMG') {
      // Get the bounding rectangle of the image relative to the viewport
      const rect = img.getBoundingClientRect();

      // Calculate mouse position relative to the image
      const x = event.clientX - rect.left; // x position within the element.
      const y = event.clientY - rect.top;  // y position within the element.

      // Calculate the transform origin as percentages
      const xPercent = (x / rect.width) * 100;
      const yPercent = (y / rect.height) * 100;

      // Set the transform origin
      img.style.transformOrigin = `${xPercent}% ${yPercent}%`;
  }
}

/**
 * Checks if all images in the seeding gallery have been rated.
 * Enables/disables the confirm button.
 */
function checkAllRatingsSelected() {
    const totalImages = uninitializedImages.length;
    let ratedCount = 0;
    uninitializedImages.forEach(image => {
        const ratingInputs = document.querySelectorAll(`input[name="rating-${image}"]:checked`);
        if (ratingInputs.length > 0) {
            ratedCount++;
        }
    });

    const confirmButton = document.getElementById('confirm-seeding');
    const seedingMessage = document.getElementById('seeding-message');

    if (ratedCount === totalImages) {
        confirmButton.disabled = false;
         seedingMessage.textContent = 'All images rated!';
         seedingMessage.style.color = 'green';
    } else {
        confirmButton.disabled = true;
         seedingMessage.textContent = `Rated ${ratedCount} of ${totalImages} images`;
         seedingMessage.style.color = 'orange';
    }
}


/**
 * Collects seed ratings and sends them to the backend.
 */
function confirmSeedRatings() {
    const ratings = {};
    let allRated = true;

    uninitializedImages.forEach(image => {
        const selectedStar = document.querySelector(`input[name="rating-${image}"]:checked`);
        if (selectedStar) {
            ratings[image] = parseInt(selectedStar.value, 10);
        } else {
            allRated = false; // Should not happen if button is enabled, but defensive
        }
    });

    if (!allRated) {
        alert('Please rate all images before confirming.');
        return;
    }

    const confirmButton = document.getElementById('confirm-seeding');
    confirmButton.disabled = true; // Disable during processing
    const seedingMessage = document.getElementById('seeding-message');
    seedingMessage.textContent = 'Saving ratings...';
    seedingMessage.style.color = 'blue';


    fetch(`/api/seed-ratings/${subsetType}/${subset}`, { // Use correct endpoint
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ratings: ratings })
    })
    .then(res => {
         if (!res.ok) {
             return res.json().then(err => Promise.reject(err));
         }
         return res.json();
     })
    .then(data => {
        console.log('Seed ratings saved:', data.message);
        // After saving, re-initialize the subset to switch back to head-to-head
        initializeSubset();
         seedingMessage.textContent = data.message;
         seedingMessage.style.color = 'green';
    })
    .catch(err => {
        console.error('Error saving seed ratings:', err);
         seedingMessage.textContent = `Error: ${err.message || err.error || 'Unknown error'}`;
         seedingMessage.style.color = 'red';
         confirmButton.disabled = false; // Re-enable button on error
    });
}


/**
 * Displays the current match pair in the head-to-head UI.
 */
function displayMatch() {
   if (currentPair.length < 2) {
        document.querySelector('#head-to-head-ui .image-container').innerHTML = '<p>Not enough images to form a pair.</p>';
        // Optionally hide vote buttons, etc.
         document.querySelectorAll('#head-to-head-ui .image-wrapper button').forEach(btn => btn.style.display = 'none');
         document.querySelector('#head-to-head-ui button[onclick="voteDraw()"]').style.display = 'none';

        return;
   }
  document.getElementById('image1').src = `normal-images/${subset}/${currentPair[0]}`; // Correct path
  document.getElementById('image2').src = `normal-images/${subset}/${currentPair[1]}`; // Correct path
   document.querySelector('#head-to-head-ui .image-container').style.display = 'flex'; // Ensure container is visible
    // Optionally show vote buttons if they were hidden
    document.querySelectorAll('#head-to-head-ui .image-wrapper button').forEach(btn => btn.style.display = 'block');
    document.querySelector('#head-to-head-ui button[onclick="voteDraw()"]').style.display = 'block';
}


/**
 * Fetches the progress data and updates the progress bar.
 * Now also updates the image count status.
 */
function fetchProgress() {
  fetch(`/api/normal-progress/${subset}`) // Use normal progress endpoint
    .then(response => response.json())
    .then(data => {
      const { minimalMatches, totalImages, initializedImagesCount } = data;
      updateProgressBar(minimalMatches);

       // Update image count status
       const statusSpan = document.getElementById('image-count-status');
       if (totalImages > 0) {
            statusSpan.textContent = `(${initializedImagesCount}/${totalImages} initialized)`;
             // Add color based on initialization progress
             if (initializedImagesCount === totalImages) {
                 statusSpan.style.color = 'green';
             } else if (initializedImagesCount > 0) {
                 statusSpan.style.color = 'orange';
             } else {
                 statusSpan.style.color = 'red';
             }

       } else {
            statusSpan.textContent = '(No images)';
            statusSpan.style.color = '';
       }

    })
    .catch(err => {
         console.error('Error fetching normal progress:', err);
          document.getElementById('image-count-status').textContent = '(Error loading status)';
           document.getElementById('image-count-status').style.color = 'red';
    });
}

/**
 * Updates the visual progress bar based on minimal matches.
 * @param {number} minimalMatches - The minimal number of matches across all *initialized* images.
 */
function updateProgressBar(minimalMatches) {
  const max = 20;
  const bar = document.getElementById('overall-progress-bar');
  const label = document.getElementById('progress-label');

  let displayValue = minimalMatches;
  let percentage = (displayValue / max) * 100;

  if (displayValue > max) {
    percentage = 100; // Cap bar at 100%
  }

  bar.style.width = percentage + '%';
  label.textContent = displayValue + (displayValue >= max ? '+' : '') + '/' + max; // Use >= max for plus sign


  // Base color based on progress thresholds
  let baseColor;
  if (minimalMatches < 5) {
    baseColor = 'rgba(204, 41, 41, 0.7)'; // Darker semi-transparent red
  } else if (minimalMatches < 10) {
    baseColor = 'rgba(204, 97, 0, 0.7)'; // Darker semi-transparent orange
  } else if (minimalMatches < 20) {
    baseColor = 'rgba(204, 165, 0, 0.7)'; // Darker semi-transparent yellow
  } else {
    baseColor = 'rgba(61, 140, 64, 0.7)'; // Darker semi-transparent green
  }

  // Set the background with both the base color and the purple edge gradient
  bar.style.backgroundImage = `linear-gradient(to right,
    ${baseColor},
    ${baseColor} 96%,
    rgba(128, 0, 128, 1) 96%,
    rgba(128, 0, 128, 1) 100%)`;

  // Show/hide the "Good" section based on progress
  const goodSection = document.querySelector('.section-good');
  if (goodSection) {
    // Note: The CSS displays these labels based on percentage width.
    // We don't strictly need to hide/show the .section-good label here
    // based on minimalMatches, as the CSS widths handle the colored background.
    // But if you want the text label itself to only appear at >= 20, you could do:
    // if (displayValue >= max) { goodSection.style.display = 'flex'; } else { goodSection.style.display = 'none'; }
    // For now, let's rely on CSS widths.
  }
}


/**
 * Records a vote with the specified result type.
 * @param {number} winnerIndex - The index (1 or 2) of the winning image.
 */
function vote(winnerIndex) { // Removed resultType
  if (currentPair.length < 2) {
    console.error('Not enough images to vote');
    return;
  }
   // Disable voting temporarily
   document.getElementById('image1').style.pointerEvents = 'none';
   document.getElementById('image2').style.pointerEvents = 'none';

  const winner = currentPair[winnerIndex - 1];
  const loser = currentPair[winnerIndex === 1 ? 1 : 0];
  fetch(`/api/normal-vote/${subset}`, { // Use normal vote endpoint
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ winner, loser }) // Can re-add result if backend uses it
  })
    .then(res => {
       // Re-enable voting regardless of success/failure
       document.getElementById('image1').style.pointerEvents = 'auto';
       document.getElementById('image2').style.pointerEvents = 'auto';

       if (!res.ok) {
            return res.json().then(err => Promise.reject(err));
        }
        return res.json();
    })
    .then(() => {
      fetchMatch(); // Fetches next match or signals seeding
      fetchProgress();
    })
    .catch(err => {
        console.error('Error recording normal vote:', err);
         alert(`Error recording vote: ${err.message || err.error || 'Unknown error'}`); // Provide user feedback
         fetchMatch(); // Try fetching next match anyway
         fetchProgress();
    });
}


/**
 * Records a draw vote.
 */
function voteDraw() {
  if (currentPair.length < 2) {
    console.error('Not enough images to vote draw');
    return;
  }
    // Disable voting temporarily
   document.getElementById('image1').style.pointerEvents = 'none';
   document.getElementById('image2').style.pointerEvents = 'none';

  const [image1, image2] = currentPair;
   // Modified frontend voteDraw assumes backend endpoint handles 'draw'
   fetch(`/api/normal-vote/${subset}`, { // Use normal vote endpoint
     method: 'POST',
     headers: { 'Content-Type': 'application/json' },
     body: JSON.stringify({ winner: image1, loser: image2, result: 'draw' }) // Pass 'draw' result
   })
     .then(res => {
         // Re-enable voting regardless of success/failure
         document.getElementById('image1').style.pointerEvents = 'auto';
         document.getElementById('image2').style.pointerEvents = 'auto';

         if (!res.ok) {
              return res.json().then(err => Promise.reject(err));
         }
         return res.json();
     })
     .then(() => {
       fetchMatch(); // Fetches next match or signals seeding
       fetchProgress();
     })
     .catch(err => {
        console.error('Error recording draw:', err);
        alert(`Error recording draw: ${err.message || err.error || 'Unknown error'}`); // Provide user feedback
        fetchMatch(); // Try fetching next match anyway
        fetchProgress();
     });
}

/**
 * Fetches a pair of images to be rated OR signals seeding is needed.
 */
function fetchMatch() {
   // We already check initialization status in initializeSubset/checkInitializationStatus
   // If we are in the head-to-head UI, we can assume fetchMatch will return a pair or an error about not enough images.
    fetch(`/api/normal-match/${subset}`)
    .then(response => response.json())
    .then(data => {
      if (data.error) {
        console.error(data.error);
        document.querySelector('#head-to-head-ui .image-container').innerHTML = `<p>${data.error}</p>`;
        // Hide delete buttons if there are no images to display
        document.querySelectorAll('#head-to-head-ui .image-wrapper button').forEach(btn => btn.style.display = 'none');
         document.querySelector('#head-to-head-ui button[onclick="voteDraw()"]').style.display = 'none';
        return;
      }
      // If we get here, it means requiresSeeding was false, and we got a pair
      currentPair = [data.image1, data.image2];
      displayMatch();
    })
    .catch(err => {
        console.error('Error fetching match:', err);
         document.querySelector('#head-to-head-ui .image-container').innerHTML = `<p>Error fetching match: ${err.message}</p>`;
         document.querySelectorAll('#head-to-head-ui .image-wrapper button').forEach(btn => btn.style.display = 'none');
         document.querySelector('#head-to-head-ui button[onclick="voteDraw()"]').style.display = 'none';
    });
}


/**
 * Handles the subset change event.
 */
function changeSubset() {
  const sel = document.getElementById('normal-subset-select');
  subset = sel.value;
  // Use checkInitializationStatus for the new subset
  checkInitializationStatus(subset);
}

/**
 * Confirms and deletes an image.
 * @param {number} imageIndex - The index (1 or 2) of the image to delete.
 */
function confirmDelete(imageIndex) {
  const image = currentPair[imageIndex - 1];
  if (confirm(`Are you sure you want to delete "${image}" from subset "${subset}"? This cannot be undone.`)) {
    deleteImage(image);
  }
}

/**
 * Deletes an image from the subset.
 * @param {string} image - The image filename to delete.
 */
function deleteImage(image) {
  fetch(`/api/normal-image/${subset}/${image}`, { // Use normal image delete endpoint
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' }
  })
    .then(res => {
         if (!res.ok) {
             return res.json().then(err => Promise.reject(err));
         }
         return res.json();
     })
    .then(() => {
        alert(`Image "${image}" deleted.`);
        fetchMatch(); // Fetch next match or signal seeding
        fetchProgress(); // Update progress/image counts
    })
    .catch(err => {
        console.error('Error deleting normal image:', err);
        alert(`Error deleting image: ${err.message || err.error || 'Unknown error'}`);
        // Even on error, try refreshing the state just in case
        fetchMatch();
        fetchProgress();
    });
}