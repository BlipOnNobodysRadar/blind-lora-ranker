// frontend/script.js (Combined & Corrected)

// --- Global Variables ---
let currentPair = [];
let subset = '';
let subsetType = 'ai'; // Default, will be determined dynamically
let subsetSelectElementId = 'subset-select'; // Default
let uninitializedImages = []; // Store list of images needing seeding
let currentZoomTargets = new Map(); // Stores { imgElement: { scale: 1, originX: 50, originY: 50 } }

// --- Function Definitions (Moved Before DOMContentLoaded) ---

/**
 * Attaches zoom event listeners to an image element.
 * @param {HTMLImageElement} img - The image element to attach listeners to.
 */
function attachZoomListeners(img) {
    if (!img) return;
    // Initialize state for this image if not already present
    if (!currentZoomTargets.has(img)) {
        currentZoomTargets.set(img, { scale: 1, originX: 50, originY: 50 });
    }

    img.addEventListener('wheel', handleWheelZoom, { passive: false }); // Prevent default scroll
    img.addEventListener('mousemove', handleMouseMoveForZoom);
    img.addEventListener('mouseenter', handleMouseEnterForZoom);
    img.addEventListener('mouseleave', handleMouseLeaveForZoom);
    // Add touch events later if needed
}

/**
 * Detaches zoom event listeners from an image element.
 * @param {HTMLImageElement} img - The image element to detach listeners from.
 */
function detachZoomListeners(img) {
    if (!img) return;
    img.removeEventListener('wheel', handleWheelZoom);
    img.removeEventListener('mousemove', handleMouseMoveForZoom);
    img.removeEventListener('mouseenter', handleMouseEnterForZoom);
    img.removeEventListener('mouseleave', handleMouseLeaveForZoom);
    // Remove state for this image
    currentZoomTargets.delete(img);
}

function handleWheelZoom(event) {
    event.preventDefault(); // Prevent page scroll
    const img = event.target;
    if (!img || img.tagName !== 'IMG' || !currentZoomTargets.has(img)) return;

    const zoomIntensity = 0.15; // Adjust sensitivity
    const minScale = 1.0;
    const maxScale = 5.0; // Adjust max zoom level

    let zoomData = currentZoomTargets.get(img);
    let scale = zoomData.scale;

    // Determine zoom direction
    const delta = Math.sign(event.deltaY); // -1 for up (zoom in), 1 for down (zoom out)

    if (delta < 0) { // Zoom in
        scale = Math.min(maxScale, scale * (1 + zoomIntensity));
    } else { // Zoom out
        scale = Math.max(minScale, scale / (1 + zoomIntensity));
    }

    // Update scale immediately if close to minScale to avoid getting stuck
    if (Math.abs(scale - minScale) < 0.01) {
        scale = minScale;
    }

    zoomData.scale = scale;
    img.style.transformOrigin = `${zoomData.originX}% ${zoomData.originY}%`;
    img.style.transform = `scale(${scale})`;

    // Update map (though modifying object reference works too)
    // currentZoomTargets.set(img, zoomData); // Optional: explicitly set if needed
}

function handleMouseMoveForZoom(event) {
    const img = event.target;
     if (!img || img.tagName !== 'IMG' || !currentZoomTargets.has(img)) return;

    const rect = img.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    const xPercent = Math.max(0, Math.min(100, (x / rect.width) * 100));
    const yPercent = Math.max(0, Math.min(100, (y / rect.height) * 100));

    let zoomData = currentZoomTargets.get(img);
    zoomData.originX = xPercent;
    zoomData.originY = yPercent;

    // Only update transformOrigin if already zoomed, otherwise it jumps on hover
    if (zoomData.scale > 1) {
         img.style.transformOrigin = `${xPercent}% ${yPercent}%`;
    }
    // Update map
    // currentZoomTargets.set(img, zoomData); // Optional
}

function handleMouseEnterForZoom(event) {
    const img = event.target;
    if (!img || img.tagName !== 'IMG') return;
     // Ensure state is initialized on enter
     if (!currentZoomTargets.has(img)) {
        currentZoomTargets.set(img, { scale: 1, originX: 50, originY: 50 });
     }
    img.classList.add('zooming'); // Add class if needed for CSS
}

function handleMouseLeaveForZoom(event) {
    const img = event.target;
    if (!img || img.tagName !== 'IMG' || !currentZoomTargets.has(img)) return;

    // Reset zoom smoothly
    let zoomData = currentZoomTargets.get(img);
    zoomData.scale = 1;
    zoomData.originX = 50;
    zoomData.originY = 50;

    img.style.transformOrigin = `50% 50%`;
    img.style.transform = `scale(1)`;
    img.classList.remove('zooming');

    // Optionally remove from map if not needed until next enter
    // currentZoomTargets.delete(img);
}

/**
 * Dynamically constructs API URLs based on subsetType.
 */
function getApiUrl(baseEndpoint, subsetName = null, imageName = null) {
  let prefix = subsetType === 'ai' ? '' : 'normal-';
  let url = '/api/';

  switch (baseEndpoint) {
    case 'subsets':
      url += `${prefix}subsets`;
      break;
    case 'match':
    case 'vote':
    case 'progress':
      if (!subsetName) throw new Error(`Subset name required for endpoint: ${baseEndpoint}`);
      url += `${prefix}${baseEndpoint}/${subsetName}`;
      break;
    case 'seed':
       if (!subsetName) throw new Error(`Subset name required for endpoint: ${baseEndpoint}`);
       url += `seed-ratings/${subsetType}/${subsetName}`; // Special structure
       break;
    case 'image':
      if (!subsetName || !imageName) throw new Error(`Subset and image name required for endpoint: ${baseEndpoint}`);
      url += `${subsetType === 'ai' ? 'image' : 'normal-image'}/${subsetName}/${imageName}`;
      break;
    default:
      throw new Error(`Unknown base endpoint: ${baseEndpoint}`);
  }
  return url;
}

/**
 * Dynamically constructs image source URLs.
 */
function getImageUrl(subsetName, imageName) {
  const baseDir = subsetType === 'ai' ? 'images' : 'normal-images';
  // Add cache-busting query parameter
  return `${baseDir}/${subsetName}/${imageName}?t=${new Date().getTime()}`;
}

/**
 * Fetches all subsets for the current type and initializes the UI.
 */
function initializeSubset() {
  fetch(getApiUrl('subsets'))
    .then(response => response.json())
    .then(data => {
      const subsetSelect = document.getElementById(subsetSelectElementId);
      if (!subsetSelect) {
        console.error(`Subset select element #${subsetSelectElementId} not found!`);
        return;
      }
      subsetSelect.innerHTML = ''; // Clear existing options

      if (!data || data.length === 0) {
        // Handle no subsets case
        const message = subsetType === 'ai'
          ? 'No AI image subsets found. Add subdirectories with PNGs (and LoRA metadata if desired) to /AI_images.'
          : 'No normal image subsets found. Add subdirectories with images to /normal_images.';

        const headToHeadContainer = document.querySelector('#head-to-head-ui .image-container');
        if (headToHeadContainer) headToHeadContainer.innerHTML = `<p>${message}</p>`;

        const statusSpan = document.getElementById('image-count-status');
        if (statusSpan) statusSpan.textContent = '';

        const seedingGallery = document.getElementById('seeding-gallery');
        if (seedingGallery) seedingGallery.style.display = 'none';

        const headToHeadUI = document.getElementById('head-to-head-ui');
        if (headToHeadUI) headToHeadUI.style.display = 'none';

        // Add default option to select dropdown
        const defaultOption = document.createElement('option');
        defaultOption.textContent = `--- No ${subsetType.toUpperCase()} Subsets Found ---`;
        defaultOption.disabled = true;
        subsetSelect.appendChild(defaultOption);

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
      const requestedSubset = params.get('subset');
      if (requestedSubset && data.includes(requestedSubset)) {
          subset = requestedSubset;
      } else {
          subset = data[0];
      }
      subsetSelect.value = subset;

      checkInitializationStatus(subset);
    })
    .catch(err => {
        console.error(`Error fetching ${subsetType} subsets:`, err);
        const errorMsg = `<p>Error loading subsets: ${err.message}. Ensure the backend server is running and accessible.</p>`;
        const headToHeadContainer = document.querySelector('#head-to-head-ui .image-container');
         if (headToHeadContainer) headToHeadContainer.innerHTML = errorMsg;
         const statusSpan = document.getElementById('image-count-status');
         if(statusSpan) statusSpan.textContent = '';
         const seedingGallery = document.getElementById('seeding-gallery');
         if(seedingGallery) seedingGallery.style.display = 'none';
         const headToHeadUI = document.getElementById('head-to-head-ui');
         if(headToHeadUI) headToHeadUI.style.display = 'none';
         const subsetSelect = document.getElementById(subsetSelectElementId);
         if (subsetSelect) {
            subsetSelect.innerHTML = '';
            const errorOption = document.createElement('option');
            errorOption.textContent = `--- Error Loading ${subsetType.toUpperCase()} Subsets ---`;
            errorOption.disabled = true;
            subsetSelect.appendChild(errorOption);
         }
    });
}

/**
 * Checks if the current subset has uninitialized images and switches UI mode.
 */
function checkInitializationStatus(subsetName) {
     const statusSpan = document.getElementById('image-count-status');
     if (statusSpan) {
          statusSpan.textContent = '(Loading...)';
          statusSpan.style.color = ''; // Reset color
     }

     fetch(getApiUrl('match', subsetName)) // Use the match endpoint
       .then(response => response.json())
       .then(data => {
           const headToHeadUI = document.getElementById('head-to-head-ui');
           const seedingGallery = document.getElementById('seeding-gallery');
           const headToHeadContainer = headToHeadUI ? headToHeadUI.querySelector('.image-container') : null;

           if (data.error) {
               console.error(data.error);
               if (headToHeadContainer) headToHeadContainer.innerHTML = `<p>Error loading subset data: ${data.error}</p>`;
               if (statusSpan) statusSpan.textContent = '(Error)';
               if (seedingGallery) seedingGallery.style.display = 'none';
               if (headToHeadUI) headToHeadUI.style.display = 'none';
               return;
           }

           if (data.requiresSeeding) {
               uninitializedImages = data.uninitializedImages;
               showSeedingUI();
               renderSeedingGallery(uninitializedImages);
               fetchProgress(); // Fetch progress to update image count status
           } else {
               uninitializedImages = []; // Clear the list
               showHeadToHeadUI();
               if (data.image1 && data.image2) {
                   currentPair = [data.image1, data.image2];
                   displayMatch();
               } else {
                   if (headToHeadContainer) headToHeadContainer.innerHTML = '<p>Not enough initialized images remaining to form a pair. Add more images or check rankings.</p>';
                   headToHeadUI.querySelectorAll('button').forEach(btn => btn.style.display = 'none');
               }
               fetchProgress(); // Fetch progress for the bar
           }
       })
       .catch(err => {
           console.error(`Error checking ${subsetType} initialization status:`, err);
           const headToHeadUI = document.getElementById('head-to-head-ui');
           const seedingGallery = document.getElementById('seeding-gallery');
           const headToHeadContainer = headToHeadUI ? headToHeadUI.querySelector('.image-container') : null;

            if (headToHeadContainer) headToHeadContainer.innerHTML = `<p>Error checking subset status: ${err.message}</p>`;
            if (statusSpan) statusSpan.textContent = '(Error)';
            if (seedingGallery) seedingGallery.style.display = 'none';
            if (headToHeadUI) headToHeadUI.style.display = 'none';
       });
}

/**
 * Shows the seeding gallery UI and hides the head-to-head UI.
 */
function showSeedingUI() {
    const headToHeadUI = document.getElementById('head-to-head-ui');
    const seedingGallery = document.getElementById('seeding-gallery');
    if (headToHeadUI) headToHeadUI.style.display = 'none';
    if (seedingGallery) seedingGallery.style.display = 'block';
}

/**
 * Shows the head-to-head UI and hides the seeding gallery UI.
 */
function showHeadToHeadUI() {
    const headToHeadUI = document.getElementById('head-to-head-ui');
    const seedingGallery = document.getElementById('seeding-gallery');
    if (seedingGallery) seedingGallery.style.display = 'none';
    if (headToHeadUI) headToHeadUI.style.display = 'block';
}

/**
 * Renders the gallery of uninitialized images for seeding.
 */
function renderSeedingGallery(images) {
  const galleryDiv = document.getElementById('image-seeding-cards');
  const confirmButtons = document.querySelectorAll('.confirm-seeding-button'); // Use class selector
  const seedingMessage = document.getElementById('seeding-message');

  if (!galleryDiv || confirmButtons.length === 0 || !seedingMessage) {
      console.error("Seeding UI elements (gallery, buttons, or message area) not found!");
       const seedingGalleryContainer = document.getElementById('seeding-gallery');
       if (seedingGalleryContainer) seedingGalleryContainer.style.display = 'none';
      return;
  }

  // Detach listeners from OLD images before clearing
  galleryDiv.querySelectorAll('img').forEach(oldImg => detachZoomListeners(oldImg));

  galleryDiv.innerHTML = ''; // Clear previous images

  // Handle confirm buttons
  confirmButtons.forEach(button => {
      button.disabled = true;
      button.style.display = 'none'; // Hide initially
  });
  seedingMessage.textContent = ''; // Clear previous message

  if (images.length === 0) {
       galleryDiv.innerHTML = '<p>No uninitialized images found in this subset.</p>';
       return;
  } else {
       confirmButtons.forEach(button => button.style.display = 'inline-block'); // Show if images exist
  }

  // Remove previous "Confirm Remaining" button if it exists
  const oldConfirmRemaining = document.getElementById('confirm-remaining-button');
  if (oldConfirmRemaining) oldConfirmRemaining.remove();

  // Add the new "Confirm Remaining" button logic
  const confirmRemainingButton = document.createElement('button');
  confirmRemainingButton.textContent = 'Confirm Remaining as 5 Stars';
  confirmRemainingButton.id = 'confirm-remaining-button'; // Give it an ID
  confirmRemainingButton.style.marginLeft = '15px';
  confirmRemainingButton.style.backgroundColor = '#ff9800'; // Orange color
  confirmRemainingButton.style.display = 'none'; // Hide initially
  confirmRemainingButton.disabled = true; // Disable initially
  confirmRemainingButton.addEventListener('click', confirmRemainingAsDefault);

  const topConfirmContainer = document.getElementById('confirm-container-top');
  if (topConfirmContainer && topConfirmContainer.querySelector('.confirm-seeding-button')) {
      topConfirmContainer.querySelector('.confirm-seeding-button').insertAdjacentElement('afterend', confirmRemainingButton);
  } else {
       galleryDiv.insertAdjacentElement('beforebegin', confirmRemainingButton);
  }

  images.forEach(image => {
      const imageWrapper = document.createElement('div');
      imageWrapper.className = 'image-wrapper seeding-card';
      imageWrapper.dataset.imageName = image;

      const imgElement = document.createElement('img');
      imgElement.src = getImageUrl(subset, image); // Use cache-busting URL
      imgElement.alt = image;
      imgElement.loading = 'lazy';

      const ratingDiv = document.createElement('div');
      ratingDiv.className = 'star-rating';
      ratingDiv.dataset.imageName = image;

      for (let i = 10; i >= 1; i--) {
          const input = document.createElement('input');
          input.type = 'radio';
          input.id = `star${i}-${image}`;
          input.name = `rating-${image}`;
          input.value = i;
          input.addEventListener('change', checkAllRatingsSelected); // Add listener

          const label = document.createElement('label');
          label.htmlFor = `star${i}-${image}`;
          label.textContent = '★';

          ratingDiv.appendChild(input);
          ratingDiv.appendChild(label);
      }

      imageWrapper.appendChild(imgElement);
      imageWrapper.appendChild(ratingDiv);

      // Attach Zoom listeners DIRECTLY to the image
      attachZoomListeners(imgElement);

      galleryDiv.appendChild(imageWrapper);
  });

  checkAllRatingsSelected();
}

/**
 * Checks if all images in the seeding gallery have been rated.
 * Enables/disables the confirm buttons.
 */
function checkAllRatingsSelected() {
  if (uninitializedImages.length === 0) return;

  const totalImages = uninitializedImages.length;
  let ratedCount = 0;
  uninitializedImages.forEach(image => {
      const ratingGroup = document.querySelector(`.star-rating[data-image-name="${image}"]`);
      if (ratingGroup && ratingGroup.querySelector(`input[name="rating-${image}"]:checked`)) {
          ratedCount++;
      }
  });

  const mainConfirmButtons = document.querySelectorAll('.confirm-seeding-button');
  const confirmRemainingButton = document.getElementById('confirm-remaining-button');
  const seedingMessage = document.getElementById('seeding-message');

  if (mainConfirmButtons.length === 0 || !seedingMessage || !confirmRemainingButton) return;

  const allRated = ratedCount === totalImages;
  const someRated = ratedCount > 0 && ratedCount < totalImages;

  // Enable/disable MAIN confirm buttons
  mainConfirmButtons.forEach(button => button.disabled = !allRated);

  // Enable/disable "Confirm Remaining" button
  confirmRemainingButton.disabled = !someRated;
  confirmRemainingButton.style.display = someRated ? 'inline-block' : 'none';

  // Update message
  if (allRated) {
       seedingMessage.textContent = 'All images rated!';
       seedingMessage.style.color = 'green';
  } else if (someRated) {
      seedingMessage.textContent = `Rated ${ratedCount} of ${totalImages}. You can rate the rest or confirm remaining as 5 stars.`;
      seedingMessage.style.color = 'orange';
  } else {
       seedingMessage.textContent = `Please rate ${totalImages} images.`;
       seedingMessage.style.color = 'orange';
  }
}


/**
 * Collects seed ratings FOR MANUALLY RATED IMAGES and sends them to the backend.
 */
function confirmSeedRatings() {
    const ratings = {};
    let imagesToConfirm = []; // Only collect images that are actually rated in the current view

    // Find images currently displayed in the seeding gallery
    const displayedImageWrappers = document.querySelectorAll('#image-seeding-cards .image-wrapper');
    displayedImageWrappers.forEach(wrapper => {
        const imageName = wrapper.dataset.imageName;
        const selectedStar = wrapper.querySelector(`input[name="rating-${imageName}"]:checked`);
        if (selectedStar) {
            ratings[imageName] = parseInt(selectedStar.value, 10);
            imagesToConfirm.push(imageName);
        }
    });

    if (imagesToConfirm.length === 0) {
        alert('Please rate at least one image before confirming.');
        return;
    }

    // Select ALL confirm buttons
    const confirmButtons = document.querySelectorAll('.confirm-seeding-button');
    const confirmRemainingButton = document.getElementById('confirm-remaining-button');
    const seedingMessage = document.getElementById('seeding-message');

    // Disable ALL buttons during processing
    confirmButtons.forEach(button => button.disabled = true);
     if (confirmRemainingButton) confirmRemainingButton.disabled = true;

    if (seedingMessage) {
        seedingMessage.textContent = 'Saving ratings...';
        seedingMessage.style.color = 'blue';
    }

    fetch(getApiUrl('seed', subset), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ratings: ratings }) // Send only the manually rated images
    })
    .then(res => {
         if (!res.ok) {
             return res.json().then(err => Promise.reject(err));
         }
         return res.json();
     })
    .then(data => {
        console.log('Seed ratings saved:', data.message);
        if (seedingMessage) {
            seedingMessage.textContent = data.message || "Ratings saved successfully!";
            seedingMessage.style.color = 'green';
        }

        // --- CORRECTED LOGIC ---
        // Instead of initializeSubset, directly try to fetch the next match
        // and switch UI. Assume seeding worked and backend is updated.
        setTimeout(() => {
            uninitializedImages = uninitializedImages.filter(img => !imagesToConfirm.includes(img)); // Update local state
            showHeadToHeadUI();
            fetchMatch(); // Fetch the next pair for head-to-head
            fetchProgress(); // Update progress bar/counts
        }, 1000); // Short delay for user feedback
    })
    .catch(err => {
      console.error('Error saving seed ratings:', err);
       if (seedingMessage) {
          seedingMessage.textContent = `Error: ${err.message || err.error || 'Unknown error'}`;
          seedingMessage.style.color = 'red';
       }
       // Re-enable buttons on error
       checkAllRatingsSelected(); // Let this function reset button states based on current ratings
    });
}

/**
 * Handles the confirmation and seeding of remaining unrated images with a default 5-star rating.
 */
function confirmRemainingAsDefault() {
    const remainingImagesToSeed = [];
    uninitializedImages.forEach(image => {
        const selectedStar = document.querySelector(`input[name="rating-${image}"]:checked`);
        if (!selectedStar) {
            remainingImagesToSeed.push(image);
        }
    });

    if (remainingImagesToSeed.length === 0) {
        alert("No images left to seed with default rating.");
        return;
    }

    const confirmationMessage = `Are you sure you want to seed the remaining ${remainingImagesToSeed.length} image(s) with a default 5-star rating (Elo 1000)?`;

    if (confirm(confirmationMessage)) {
        const defaultRatings = {};
        remainingImagesToSeed.forEach(img => {
            defaultRatings[img] = 5; // Default to 5 stars
        });

        const confirmButtons = document.querySelectorAll('.confirm-seeding-button');
        const confirmRemainingButton = document.getElementById('confirm-remaining-button');
        const seedingMessage = document.getElementById('seeding-message');

        // Disable ALL buttons during processing
        confirmButtons.forEach(button => button.disabled = true);
        if (confirmRemainingButton) confirmRemainingButton.disabled = true;

        if (seedingMessage) {
            seedingMessage.textContent = `Seeding ${remainingImagesToSeed.length} images with 5 stars...`;
            seedingMessage.style.color = 'blue';
        }

        fetch(getApiUrl('seed', subset), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ratings: defaultRatings })
        })
        .then(res => {
             if (!res.ok) {
                 return res.json().then(err => Promise.reject(err));
             }
             return res.json();
         })
        .then(data => {
            console.log('Default seed ratings saved:', data.message);
            if (seedingMessage) {
                seedingMessage.textContent = data.message || `Seeded ${remainingImagesToSeed.length} images successfully!`;
                seedingMessage.style.color = 'green';
            }
             // --- CORRECTED LOGIC ---
             // Directly switch to head-to-head after success
            setTimeout(() => {
                 uninitializedImages = uninitializedImages.filter(img => !remainingImagesToSeed.includes(img)); // Update local state
                 showHeadToHeadUI();
                 fetchMatch(); // Fetch the next pair for head-to-head
                 fetchProgress(); // Update progress bar/counts
            }, 1000); // Short delay for user feedback
        })
        .catch(err => {
          console.error('Error saving default seed ratings:', err);
           if (seedingMessage) {
              seedingMessage.textContent = `Error: ${err.message || err.error || 'Unknown error'}`;
              seedingMessage.style.color = 'red';
           }
           // Re-enable buttons on error
           checkAllRatingsSelected(); // Let this function reset button states
        });
    }
}


/**
 * Displays the current match pair in the head-to-head UI.
 */
function displayMatch() {
   const headToHeadContainer = document.querySelector('#head-to-head-ui .image-container');
   const voteButtons = document.querySelectorAll('#head-to-head-ui button'); // Select all buttons

   if (!headToHeadContainer) {
       console.error("Head-to-head UI container missing!");
       return;
   }

   // Detach listeners from OLD images before clearing
   const oldImg1 = document.getElementById('image1');
   const oldImg2 = document.getElementById('image2');
   if (oldImg1) detachZoomListeners(oldImg1);
   if (oldImg2) detachZoomListeners(oldImg2);

   if (currentPair.length < 2) {
        headToHeadContainer.innerHTML = '<p>Not enough images to form a pair.</p>';
        voteButtons.forEach(btn => btn.style.display = 'none');
        return;
   }

   // Re-create the HTML structure
   headToHeadContainer.innerHTML = `
       <div class="image-wrapper">
         <img id="image1" src="" alt="Image 1">
         <button onclick="confirmDelete(1)">Delete Image 1</button>
       </div>
       <div class="image-wrapper">
         <img id="image2" src="" alt="Image 2">
         <button onclick="confirmDelete(2)">Delete Image 2</button>
       </div>
   `;

   const newImg1 = document.getElementById('image1');
   const newImg2 = document.getElementById('image2');

   if (!newImg1 || !newImg2) {
       console.error("Failed to find images after recreating head-to-head UI.");
       return;
   }

   newImg1.src = getImageUrl(subset, currentPair[0]); // Use cache-busting URL
   newImg2.src = getImageUrl(subset, currentPair[1]); // Use cache-busting URL

   // Re-attach VOTE event listeners
   newImg1.addEventListener('click', () => vote(1));
   newImg2.addEventListener('click', () => vote(2));
   // Delete buttons use inline onclick

   // Attach ZOOM listeners to NEW head-to-head images
   attachZoomListeners(newImg1);
   attachZoomListeners(newImg2);

   headToHeadContainer.style.display = 'flex'; // Ensure container is visible
   document.querySelectorAll('#head-to-head-ui button').forEach(btn => {
       btn.style.display = 'inline-block';
   });
}


/**
 * Fetches the progress data and updates the progress bar and image count status.
 */
function fetchProgress() {
    if (!subset) {
         const statusSpan = document.getElementById('image-count-status');
         if(statusSpan) statusSpan.textContent = '(Select Subset)';
        return;
    }

  fetch(getApiUrl('progress', subset))
    .then(response => response.json())
    .then(data => {
        if (data.error) {
            console.error("Error fetching progress:", data.error);
            const statusSpan = document.getElementById('image-count-status');
            if (statusSpan) {
                statusSpan.textContent = `(Error: ${data.error})`;
                statusSpan.style.color = 'red';
            }
             updateProgressBar(0); // Reset progress bar on error
            return;
        }

      const { minimalMatches, totalImages, initializedImagesCount } = data;
      updateProgressBar(minimalMatches);

       const statusSpan = document.getElementById('image-count-status');
       if (statusSpan) {
           if (totalImages > 0) {
                statusSpan.textContent = `(${initializedImagesCount}/${totalImages} initialized)`;
                 if (initializedImagesCount === totalImages) {
                     statusSpan.style.color = 'green';
                 } else if (initializedImagesCount > 0) {
                     statusSpan.style.color = 'orange';
                 } else {
                     statusSpan.style.color = 'red';
                 }
           } else {
                statusSpan.textContent = '(0 images)';
                statusSpan.style.color = '';
           }
       }
    })
    .catch(err => {
         console.error(`Error fetching ${subsetType} progress:`, err);
         const statusSpan = document.getElementById('image-count-status');
          if (statusSpan) {
            statusSpan.textContent = '(Error loading status)';
            statusSpan.style.color = 'red';
          }
         updateProgressBar(0); // Reset progress bar on network error
    });
}

/**
 * Updates the visual progress bar based on minimal matches.
 */
function updateProgressBar(minimalMatches) {
  const max = 20; // Target for "good" reliability
  const bar = document.getElementById('overall-progress-bar');
  const label = document.getElementById('progress-label');
  const container = document.querySelector('.progress-container'); // Get the container

  if (!bar || !label || !container) {
      return;
  }

  const validMatches = typeof minimalMatches === 'number' && minimalMatches >= 0 ? minimalMatches : 0;
  let displayValue = validMatches;
  let percentage = Math.min((displayValue / max) * 100, 100);

  bar.style.width = percentage + '%';
  label.textContent = displayValue + (displayValue >= max ? '+' : '') + '/' + max;

  container.classList.remove('progress-state-not-reliable', 'progress-state-minimum', 'progress-state-decent', 'progress-state-good');
  let baseColor;
  if (displayValue < 5) {
      container.classList.add('progress-state-not-reliable');
      baseColor = 'rgba(204, 41, 41, 0.7)'; // Semi-transparent red
  } else if (displayValue < 10) {
      container.classList.add('progress-state-minimum');
      baseColor = 'rgba(204, 97, 0, 0.7)'; // Semi-transparent orange
  } else if (displayValue < max) {
      container.classList.add('progress-state-decent');
      baseColor = 'rgba(204, 165, 0, 0.7)'; // Semi-transparent yellow
  } else {
      container.classList.add('progress-state-good');
      baseColor = 'rgba(61, 140, 64, 0.7)'; // Semi-transparent green
  }

   if (percentage > 0) {
       bar.style.backgroundImage = `linear-gradient(to right,
           ${baseColor},
           ${baseColor} 96%,
           rgba(128, 0, 128, 1) 96%,
           rgba(128, 0, 128, 1) 100%)`;
   } else {
       bar.style.backgroundImage = 'none';
       bar.style.backgroundColor = 'transparent';
   }
}


/**
 * Records a vote for a win/loss.
 */
function vote(winnerIndex) {
  if (currentPair.length < 2) return;

  const img1 = document.getElementById('image1');
  const img2 = document.getElementById('image2');
  if (img1) img1.style.pointerEvents = 'none';
  if (img2) img2.style.pointerEvents = 'none';

  const winner = currentPair[winnerIndex - 1];
  const loser = currentPair[winnerIndex === 1 ? 1 : 0];

  fetch(getApiUrl('vote', subset), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ winner, loser })
  })
    .then(res => {
       if (img1) img1.style.pointerEvents = 'auto';
       if (img2) img2.style.pointerEvents = 'auto';
       if (!res.ok) {
            return res.json().then(err => Promise.reject(err));
        }
        return res.json();
    })
    .then(() => {
      fetchMatch();
      fetchProgress();
    })
    .catch(err => {
        console.error(`Error recording ${subsetType} vote:`, err);
         alert(`Error recording vote: ${err.message || err.error || 'Unknown error'}`);
         fetchMatch();
         fetchProgress();
    });
}

/**
 * Fetches a pair of images to be rated OR handles seeding/no more pairs.
 */
function fetchMatch() {
    if (!subset) return;

    fetch(getApiUrl('match', subset))
    .then(response => response.json())
    .then(data => {
      const headToHeadContainer = document.querySelector('#head-to-head-ui .image-container');
       const voteButtons = document.querySelectorAll('#head-to-head-ui button');

      if (data.error) {
          console.error(`Error fetching match: ${data.error}`);
          if (headToHeadContainer) headToHeadContainer.innerHTML = `<p>${data.error}</p>`;
           voteButtons.forEach(btn => btn.style.display = 'none');
          return;
      }

      if (data.requiresSeeding) {
          // This *shouldn't* be the primary way to enter seeding anymore, but handle defensively
          console.warn("fetchMatch returned requiresSeeding. Switching UI.");
          uninitializedImages = data.uninitializedImages;
          showSeedingUI();
          renderSeedingGallery(uninitializedImages);
          fetchProgress();
      } else if (data.image1 && data.image2) {
          // Success: Got a pair
          currentPair = [data.image1, data.image2];
          showHeadToHeadUI(); // Ensure correct UI is shown
          displayMatch(); // Display the pair
      } else {
          // No error, not seeding, but no pair returned
          console.log("No more pairs available for matching in this subset.");
          showHeadToHeadUI(); // Still show the head-to-head area
          if (headToHeadContainer) headToHeadContainer.innerHTML = '<p>All available matches completed for this subset. Check rankings or add more images.</p>';
           voteButtons.forEach(btn => btn.style.display = 'none');
      }
    })
    .catch(err => {
        console.error('Network or JSON parsing error fetching match:', err);
        const headToHeadContainer = document.querySelector('#head-to-head-ui .image-container');
        const voteButtons = document.querySelectorAll('#head-to-head-ui button');
         if (headToHeadContainer) headToHeadContainer.innerHTML = `<p>Error fetching next match: ${err.message}</p>`;
         voteButtons.forEach(btn => btn.style.display = 'none');
    });
}


/**
 * Handles the subset change event.
 */
function changeSubset() {
  const sel = document.getElementById(subsetSelectElementId);
  if (!sel) return;

  const newSubset = sel.value;
  if (!newSubset || newSubset === subset) return;

  subset = newSubset;
  console.log(`Subset changed to: ${subset}`);

  const url = new URL(window.location);
  url.searchParams.set('subset', subset);
  window.history.pushState({ subset: subset }, '', url);

  currentPair = [];
  uninitializedImages = [];
  currentZoomTargets.clear(); // Clear zoom states for old subset images

  checkInitializationStatus(subset); // This will determine seeding vs head-to-head
}

/**
 * Confirms and initiates deletion of an image.
 */
function confirmDelete(imageIndex) {
  if (currentPair.length < imageIndex || imageIndex < 1) return;

  const image = currentPair[imageIndex - 1];
  if (confirm(`Are you sure you want to delete "${image}" from subset "${subset}"? This action cannot be undone.`)) {
    deleteImage(image);
  }
}

/**
 * Sends a request to delete an image from the current subset.
 */
function deleteImage(image) {
    if (!subset || !image) return;

  fetch(getApiUrl('image', subset, image), {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' }
  })
    .then(res => {
         if (!res.ok) {
             return res.json().then(err => Promise.reject(err));
         }
         return res.json();
     })
    .then(data => {
        alert(`Image "${image}" deleted. ${data.deletedFile ? '(File also removed)' : '(File removal failed or skipped)'}`);
        currentPair = []; // Reset pair
         // Detach listener from the image that might have been deleted if it was being displayed
        const imgElement = image === currentPair[0] ? document.getElementById('image1') : (image === currentPair[1] ? document.getElementById('image2') : null);
        if(imgElement) detachZoomListeners(imgElement);

        fetchMatch(); // Fetch next match
        fetchProgress(); // Update progress/counts
    })
    .catch(err => {
        console.error(`Error deleting ${subsetType} image:`, err);
        alert(`Error deleting image: ${err.message || err.error || 'Unknown error'}`);
        fetchMatch();
        fetchProgress();
    });
}


// --- DOMContentLoaded Listener (Initialization) ---
document.addEventListener('DOMContentLoaded', () => {
  // Determine context (AI vs Normal)
  if (document.getElementById('normal-subset-select')) {
    subsetType = 'normal';
    subsetSelectElementId = 'normal-subset-select';
  } else if (document.getElementById('subset-select')) {
    subsetType = 'ai';
    subsetSelectElementId = 'subset-select';
  } else {
    console.error("Could not determine subset type. Missing #subset-select or #normal-subset-select element.");
    document.body.innerHTML = '<h1>Configuration Error</h1><p>Could not find the necessary subset selection element.</p>';
    return;
  }
  console.log(`Script context initialized as: ${subsetType}`);

  // Call initialization logic
  initializeSubset();

  // Current structure relies on HTML onclick for Delete

  // Event listeners for the seeding confirmation buttons are added in renderSeedingGallery now.

});