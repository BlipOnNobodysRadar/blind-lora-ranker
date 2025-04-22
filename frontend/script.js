// frontend/script.js (Combined)

let currentPair = [];
let subset = '';
let subsetType = 'ai'; // Default, will be determined dynamically
let subsetSelectElementId = 'subset-select'; // Default
let uninitializedImages = []; // Store list of images needing seeding

document.addEventListener('DOMContentLoaded', () => {
  // Determine context (AI vs Normal) based on which select element exists
  if (document.getElementById('normal-subset-select')) {
    subsetType = 'normal';
    subsetSelectElementId = 'normal-subset-select';
  } else if (document.getElementById('subset-select')) {
    subsetType = 'ai';
    subsetSelectElementId = 'subset-select';
  } else {
    console.error("Could not determine subset type. Missing #subset-select or #normal-subset-select element.");
    // Display error to user maybe?
    document.body.innerHTML = '<h1>Configuration Error</h1><p>Could not find the necessary subset selection element. Please check the HTML structure.</p>';
    return; // Stop execution if context cannot be determined
  }

  console.log(`Script context initialized as: ${subsetType}`);

  // Scaling Toggle Logic (if element exists - commented out in HTML but keep logic)
  const scalingToggle = document.getElementById('scalingToggle');
  if (scalingToggle) {
    handleScalingToggle(); // Set initial state
    scalingToggle.addEventListener('change', handleScalingToggle);
  }

  // Call initialization logic
  initializeSubset();

  // Add event listeners for the Draw button (ensure it exists)
  const drawButton = document.querySelector('#head-to-head-ui button[onclick="voteDraw()"]');
   if (drawButton) {
        drawButton.addEventListener('click', voteDraw);
   } else {
       console.warn("Draw button not found during initialization.");
   }

    // Add event listeners for image clicks/delete buttons (check if head-to-head UI exists)
    const headToHeadUI = document.getElementById('head-to-head-ui');
    if (headToHeadUI) {
        const img1 = headToHeadUI.querySelector('#image1');
        const img2 = headToHeadUI.querySelector('#image2');
        const delBtn1 = headToHeadUI.querySelector('.image-wrapper:nth-child(1) button[onclick^="confirmDelete"]');
        const delBtn2 = headToHeadUI.querySelector('.image-wrapper:nth-child(3) button[onclick^="confirmDelete"]'); // Adjust selector if layout changes

        if (img1) img1.addEventListener('click', () => vote(1));
        if (img2) img2.addEventListener('click', () => vote(2));
        if (delBtn1) delBtn1.addEventListener('click', () => confirmDelete(1));
        if (delBtn2) delBtn2.addEventListener('click', () => confirmDelete(2));

         // Add event listeners for zoom effect to the head-to-head images
        const imageWrappers = headToHeadUI.querySelectorAll('.image-wrapper');
        imageWrappers.forEach(wrapper => {
             const img = wrapper.querySelector('img');
             if (img) {
                 wrapper.addEventListener('mouseenter', handleImageZoomEnter);
                 wrapper.addEventListener('mouseleave', handleImageZoomLeave);
                 img.addEventListener('mousemove', handleImageZoomMove);
             }
        });

    } else {
        console.warn("Head-to-head UI container not found during initialization.");
    }

    const seedingGallery = document.getElementById('seeding-gallery');
    if (seedingGallery) {
        // Select ALL buttons with the class
        const confirmButtons = seedingGallery.querySelectorAll('.confirm-seeding-button');
        if (confirmButtons.length > 0) {
             // Add listener to each button found
             confirmButtons.forEach(button => {
                 button.addEventListener('click', confirmSeedRatings);
             });
        } else {
             console.warn("Confirm seeding buttons not found during initialization.");
        }
    } else {
         console.warn("Seeding gallery container not found during initialization.");
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
 * Dynamically constructs API URLs based on subsetType.
 * @param {string} baseEndpoint - The core endpoint name (e.g., 'subsets', 'match', 'vote').
 * @param {string|null} [subsetName=null] - The specific subset name, if needed.
 * @param {string|null} [imageName=null] - The specific image name, if needed.
 * @returns {string} The constructed API URL.
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
      // Note the slightly different structure for image deletion
      url += `${subsetType === 'ai' ? 'image' : 'normal-image'}/${subsetName}/${imageName}`;
      break;
    default:
      throw new Error(`Unknown base endpoint: ${baseEndpoint}`);
  }
  return url;
}

/**
 * Dynamically constructs image source URLs.
 * @param {string} subsetName - The name of the subset.
 * @param {string} imageName - The filename of the image.
 * @returns {string} The constructed image source URL.
 */
function getImageUrl(subsetName, imageName) {
  const baseDir = subsetType === 'ai' ? 'images' : 'normal-images';
  return `${baseDir}/${subsetName}/${imageName}`;
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
      // Check if the requested subset actually exists in the list
      if (requestedSubset && data.includes(requestedSubset)) {
          subset = requestedSubset;
      } else {
          subset = data[0]; // Default to the first one if requested doesn't exist or none requested
          // Optionally update URL if defaulting
          // window.history.replaceState({}, '', `?subset=${subset}`);
      }
      subsetSelect.value = subset;

      // Now check initialization status for the selected subset
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

         // Update select dropdown on error
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
 * @param {string} subsetName - The name of the current subset.
 */
function checkInitializationStatus(subsetName) {
     // Show loading state?
     const statusSpan = document.getElementById('image-count-status');
     if (statusSpan) {
          statusSpan.textContent = '(Loading...)';
          statusSpan.style.color = ''; // Reset color
     }

     fetch(getApiUrl('match', subsetName)) // Use the match endpoint, which now checks for initialization
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
               // Need to seed images
               uninitializedImages = data.uninitializedImages;
               showSeedingUI();
               renderSeedingGallery(uninitializedImages);
               fetchProgress(); // Fetch progress to update image count status
           } else {
               // All images are initialized, proceed with head-to-head
               uninitializedImages = []; // Clear the list
               showHeadToHeadUI();
               if (data.image1 && data.image2) {
                   currentPair = [data.image1, data.image2];
                   displayMatch();
               } else {
                    // Handle case where seeding is not required, but no pair could be formed
                    // (e.g., only 0 or 1 initialized images left)
                    if (headToHeadContainer) headToHeadContainer.innerHTML = '<p>Not enough initialized images remaining to form a pair. Add more images or check rankings.</p>';
                     // Hide delete/draw buttons
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
 * @param {string[]} images - Array of image filenames to seed.
 */
function renderSeedingGallery(images) {
  const galleryDiv = document.getElementById('image-seeding-cards');
  // Select ALL confirm buttons
  const confirmButtons = document.querySelectorAll('.confirm-seeding-button');
  const seedingMessage = document.getElementById('seeding-message');

  // Check if essential elements exist
  if (!galleryDiv || confirmButtons.length === 0 || !seedingMessage) {
      console.error("Seeding UI elements (gallery, buttons, or message area) not found!");
      // Hide the gallery container entirely if elements are missing
       const seedingGalleryContainer = document.getElementById('seeding-gallery');
       if (seedingGalleryContainer) seedingGalleryContainer.style.display = 'none';
      return;
  }

  galleryDiv.innerHTML = ''; // Clear previous images
  // Disable ALL buttons initially
  confirmButtons.forEach(button => {
      button.disabled = true;
      button.style.display = 'none'; // Hide initially
  });
  seedingMessage.textContent = ''; // Clear previous message

  if (images.length === 0) {
       galleryDiv.innerHTML = '<p>No uninitialized images found in this subset.</p>';
       // Keep buttons hidden if no images
       return;
  } else {
       // Show buttons if there are images
       confirmButtons.forEach(button => button.style.display = 'inline-block');
  }

  images.forEach(image => {
      const imageWrapper = document.createElement('div');
      imageWrapper.className = 'image-wrapper seeding-card';
      imageWrapper.dataset.imageName = image;

      const imgElement = document.createElement('img');
      imgElement.src = getImageUrl(subset, image);
      imgElement.alt = image;
      imgElement.loading = 'lazy'; // Add lazy loading

      // const nameElement = document.createElement('p');
      // nameElement.textContent = image;
      // nameElement.style.wordBreak = 'break-all';
      // nameElement.style.overflowWrap = 'break-word';

      const ratingDiv = document.createElement('div');
      ratingDiv.className = 'star-rating';
      ratingDiv.dataset.imageName = image;

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
      // imageWrapper.appendChild(nameElement);
      imageWrapper.appendChild(ratingDiv);

      // --- Attach Zoom listeners DIRECTLY to the image ---
      imgElement.addEventListener('mouseenter', handleImageZoomEnter); // Now on img
      imgElement.addEventListener('mouseleave', handleImageZoomLeave); // Now on img
      imgElement.addEventListener('mousemove', handleImageZoomMove);   // Still on img


      // Delete button is hidden in seeding view (kept structurally for consistency perhaps)
       const deleteButton = document.createElement('button');
       deleteButton.textContent = 'Delete';
       deleteButton.style.display = 'none'; // Explicitly hide
       imageWrapper.appendChild(deleteButton);


      galleryDiv.appendChild(imageWrapper);
  });

  // Initial check to potentially enable the confirm button
  checkAllRatingsSelected();
}


// --- Zoom Effect Functions ---

function handleImageZoomEnter(event) {
  const img = event.target; // Target is now the image itself
  if (img && img.tagName === 'IMG') {
      // CSS :hover on img handles the scaling now
      // We might not even need this listener anymore if CSS handles it all,
      // but keep it for potential future use or if CSS alone isn't enough.
  }
}

function handleImageZoomLeave(event) {
  const img = event.target; // Target is now the image itself
  if (img && img.tagName === 'IMG') {
      // Reset transform-origin when mouse leaves the image
      img.style.transformOrigin = 'center center';
      // CSS :hover ending handles the scale reset
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

      // Clamp percentages between 0 and 100
      const clampedX = Math.max(0, Math.min(100, xPercent));
      const clampedY = Math.max(0, Math.min(100, yPercent));


      // Set the transform origin
      img.style.transformOrigin = `${clampedX}% ${clampedY}%`;
  }
}

/**
 * Checks if all images in the seeding gallery have been rated.
 * Enables/disables the confirm button.
 */
function checkAllRatingsSelected() {
  if (uninitializedImages.length === 0) return; // No images to check

  const totalImages = uninitializedImages.length;
  let ratedCount = 0;
  uninitializedImages.forEach(image => {
      const ratingGroup = document.querySelector(`.star-rating[data-image-name="${image}"]`);
      if (ratingGroup && ratingGroup.querySelector(`input[name="rating-${image}"]:checked`)) {
          ratedCount++;
      }
  });

  // Select ALL confirm buttons
  const confirmButtons = document.querySelectorAll('.confirm-seeding-button');
  const seedingMessage = document.getElementById('seeding-message');

  if (confirmButtons.length === 0 || !seedingMessage) return; // Elements might not exist

  const allRated = ratedCount === totalImages;

  // Enable/disable ALL buttons
  confirmButtons.forEach(button => button.disabled = !allRated);

  if (allRated) {
       seedingMessage.textContent = 'All images rated!';
       seedingMessage.style.color = 'green';
  } else {
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

    // Select ALL confirm buttons
    const confirmButtons = document.querySelectorAll('.confirm-seeding-button');
    const seedingMessage = document.getElementById('seeding-message');

    // Disable ALL buttons during processing
    confirmButtons.forEach(button => button.disabled = true);

    if (seedingMessage) {
        seedingMessage.textContent = 'Saving ratings...';
        seedingMessage.style.color = 'blue';
    }

    fetch(getApiUrl('seed', subset), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ratings: ratings })
    })
    .then(res => {
         if (!res.ok) {
             // Try to parse error message from backend
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
        // After saving, re-initialize the subset to switch back to head-to-head
        // Add a small delay so the user can see the success message
        setTimeout(() => {
            initializeSubset();
        }, 1500);
    })
    .catch(err => {
      console.error('Error saving seed ratings:', err);
       if (seedingMessage) {
          seedingMessage.textContent = `Error: ${err.message || err.error || 'Unknown error'}`;
          seedingMessage.style.color = 'red';
       }
       // Re-enable ALL buttons on error
       confirmButtons.forEach(button => button.disabled = false);
    });
}


/**
 * Displays the current match pair in the head-to-head UI.
 */
function displayMatch() {
   const img1Element = document.getElementById('image1');
   const img2Element = document.getElementById('image2');
   const headToHeadContainer = document.querySelector('#head-to-head-ui .image-container');
   const voteButtons = document.querySelectorAll('#head-to-head-ui button'); // Select all buttons within the UI

   if (!img1Element || !img2Element || !headToHeadContainer) {
       console.error("Head-to-head UI elements missing!");
       return;
   }

   if (currentPair.length < 2) {
        headToHeadContainer.innerHTML = '<p>Not enough images to form a pair.</p>';
         // Hide vote buttons
         voteButtons.forEach(btn => btn.style.display = 'none');
        return;
   }

   // Re-create the HTML structure
   headToHeadContainer.innerHTML = `
       <div class="image-wrapper">
         <img id="image1" src="" alt="Image 1">
         <button>Delete Image 1</button> <!-- Simplified button for example -->
       </div>
       <div class="image-wrapper">
         <img id="image2" src="" alt="Image 2">
         <button>Delete Image 2</button> <!-- Simplified button for example -->
       </div>
   `;

    // Re-fetch elements after resetting innerHTML
   const newImg1 = document.getElementById('image1');
   const newImg2 = document.getElementById('image2');
   const newDelBtn1 = headToHeadContainer.querySelector('.image-wrapper:nth-child(1) button');
   const newDrawBtn = headToHeadContainer.querySelector('div:nth-child(2) button');
   const newDelBtn2 = headToHeadContainer.querySelector('.image-wrapper:nth-child(3) button');

   if (!newImg1 || !newImg2) {
       console.error("Failed to find images after recreating head-to-head UI.");
       return;
   }

  newImg1.src = getImageUrl(subset, currentPair[0]);
  newImg2.src = getImageUrl(subset, currentPair[1]);

  // Re-attach VOTE/DELETE event listeners
  newImg1.addEventListener('click', () => vote(1));
  newImg2.addEventListener('click', () => vote(2));
  if (newDelBtn1) newDelBtn1.onclick = () => confirmDelete(1);
  if (newDrawBtn) newDrawBtn.onclick = voteDraw;
  if (newDelBtn2) newDelBtn2.onclick = () => confirmDelete(2);

   // --- Attach ZOOM listeners to head-to-head images ---
   [newImg1, newImg2].forEach(img => {
       if(img) { // Check if img exists
           img.addEventListener('mouseenter', handleImageZoomEnter);
           img.addEventListener('mouseleave', handleImageZoomLeave);
           img.addEventListener('mousemove', handleImageZoomMove);
       }
   });

   headToHeadContainer.style.display = 'flex'; // Ensure container is visible
    // Ensure vote buttons are visible
   voteButtons.forEach(btn => btn.style.display = 'inline-block'); // Use inline-block or block as appropriate
}


/**
 * Fetches the progress data and updates the progress bar and image count status.
 */
function fetchProgress() {
    if (!subset) {
        console.warn("fetchProgress called without a selected subset.");
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

       // Update image count status
       const statusSpan = document.getElementById('image-count-status');
       if (statusSpan) {
           if (totalImages > 0) {
                statusSpan.textContent = `(${initializedImagesCount}/${totalImages} initialized)`;
                 // Add color based on initialization progress
                 if (initializedImagesCount === totalImages) {
                     statusSpan.style.color = 'green';
                 } else if (initializedImagesCount > 0) {
                     statusSpan.style.color = 'orange';
                 } else {
                     statusSpan.style.color = 'red'; // No images initialized yet
                 }
           } else {
                statusSpan.textContent = '(0 images)';
                statusSpan.style.color = ''; // Default color
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
 * @param {number} minimalMatches - The minimal number of matches across all *initialized* images.
 */
function updateProgressBar(minimalMatches) {
  const max = 20; // Target for "good" reliability
  const bar = document.getElementById('overall-progress-bar');
  const label = document.getElementById('progress-label');
  const container = document.querySelector('.progress-container'); // Get the container

  if (!bar || !label || !container) {
      // console.warn("Progress bar elements not found."); // Reduce console noise if elements aren't always present
      return;
  }

  // Ensure minimalMatches is a non-negative number
  const validMatches = typeof minimalMatches === 'number' && minimalMatches >= 0 ? minimalMatches : 0;

  let displayValue = validMatches;
  // Calculate percentage, ensuring it doesn't exceed 100%
  let percentage = Math.min((displayValue / max) * 100, 100);

  bar.style.width = percentage + '%';
  label.textContent = displayValue + (displayValue >= max ? '+' : '') + '/' + max;

  // Base color based on progress thresholds - using the section classes defined in CSS
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
  } else { // displayValue >= max
      container.classList.add('progress-state-good');
      baseColor = 'rgba(61, 140, 64, 0.7)'; // Semi-transparent green
  }

   // Set the background with both the base color and the purple edge gradient ONLY if percentage > 0
   if (percentage > 0) {
       bar.style.backgroundImage = `linear-gradient(to right,
           ${baseColor},
           ${baseColor} 96%,
           rgba(128, 0, 128, 1) 96%,
           rgba(128, 0, 128, 1) 100%)`;
   } else {
       bar.style.backgroundImage = 'none'; // No gradient if width is 0
       bar.style.backgroundColor = 'transparent'; // Ensure no solid color either
   }

}


/**
 * Records a vote for a win/loss.
 * @param {number} winnerIndex - The index (1 or 2) of the winning image.
 */
function vote(winnerIndex) {
  if (currentPair.length < 2) {
    console.error('Not enough images to vote');
    return;
  }
  // Disable voting temporarily to prevent double clicks
  const img1 = document.getElementById('image1');
  const img2 = document.getElementById('image2');
  if (img1) img1.style.pointerEvents = 'none';
  if (img2) img2.style.pointerEvents = 'none';

  const winner = currentPair[winnerIndex - 1];
  const loser = currentPair[winnerIndex === 1 ? 1 : 0];

  fetch(getApiUrl('vote', subset), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ winner, loser }) // Backend vote endpoint currently ignores 'result' type for win/loss
  })
    .then(res => {
       // Re-enable voting regardless of success/failure
       if (img1) img1.style.pointerEvents = 'auto';
       if (img2) img2.style.pointerEvents = 'auto';

       if (!res.ok) {
            // Try to parse error message from backend
            return res.json().then(err => Promise.reject(err));
        }
        return res.json();
    })
    .then(() => {
      fetchMatch(); // Fetches next match or signals seeding needed
      fetchProgress();
    })
    .catch(err => {
        console.error(`Error recording ${subsetType} vote:`, err);
         alert(`Error recording vote: ${err.message || err.error || 'Unknown error'}`); // Provide user feedback
         // Still try to fetch the next match even on error
         fetchMatch();
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
   const img1 = document.getElementById('image1');
   const img2 = document.getElementById('image2');
   if (img1) img1.style.pointerEvents = 'none';
   if (img2) img2.style.pointerEvents = 'none';

  const [image1, image2] = currentPair;
   // Note: The current backend '/api/vote' and '/api/normal-vote' endpoints likely DON'T
   // handle the 'result: "draw"' field. They expect a winner/loser pair for the basic Elo update.
   // Handling a draw correctly might require backend changes (e.g., adjust both ratings towards expected mean).
   // For now, sending 'draw' might be ignored or cause unexpected behavior depending on backend implementation.
   // A *simple* frontend workaround (but mathematically dubious for strict Elo) could be to just fetch the next match without saving.
   // Let's proceed assuming the backend *might* handle 'draw' or will ignore it gracefully.
   console.warn("Sending 'draw' vote. Backend support for this is not guaranteed in the current implementation.");

   fetch(getApiUrl('vote', subset), {
     method: 'POST',
     headers: { 'Content-Type': 'application/json' },
     body: JSON.stringify({ winner: image1, loser: image2, result: 'draw' }) // Pass 'draw' result
   })
     .then(res => {
         // Re-enable voting regardless of success/failure
         if (img1) img1.style.pointerEvents = 'auto';
         if (img2) img2.style.pointerEvents = 'auto';

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
        console.error(`Error recording ${subsetType} draw:`, err);
        alert(`Error recording draw: ${err.message || err.error || 'Unknown error'}`); // Provide user feedback
        // Still try to fetch the next match even on error
        fetchMatch();
        fetchProgress();
     });
}

/**
 * Fetches a pair of images to be rated OR signals seeding is needed OR handles no more pairs.
 */
function fetchMatch() {
    if (!subset) {
        console.warn("fetchMatch called without a selected subset.");
        return;
    }
    // We rely on checkInitializationStatus to handle the seeding state.
    // This function now primarily gets the next pair *if* we are in head-to-head mode.
    fetch(getApiUrl('match', subset))
    .then(response => response.json())
    .then(data => {
      const headToHeadContainer = document.querySelector('#head-to-head-ui .image-container');
       const voteButtons = document.querySelectorAll('#head-to-head-ui button');

      if (data.error) {
          console.error(`Error fetching match: ${data.error}`);
          if (headToHeadContainer) headToHeadContainer.innerHTML = `<p>${data.error}</p>`;
           // Hide vote buttons on error
           voteButtons.forEach(btn => btn.style.display = 'none');
          return;
      }

      if (data.requiresSeeding) {
          // This case should ideally be caught by checkInitializationStatus, but handle defensively
          console.warn("fetchMatch returned requiresSeeding. Switching to seeding UI.");
          uninitializedImages = data.uninitializedImages;
          showSeedingUI();
          renderSeedingGallery(uninitializedImages);
          fetchProgress();
      } else if (data.image1 && data.image2) {
          // Success: Got a pair
          currentPair = [data.image1, data.image2];
          displayMatch(); // This function now also ensures buttons are visible
      } else {
          // No error, not seeding, but no pair returned (e.g., fewer than 2 initialized images)
          console.log("No more pairs available for matching in this subset.");
          if (headToHeadContainer) headToHeadContainer.innerHTML = '<p>All available matches completed for this subset. Check rankings or add more images.</p>';
           // Hide vote buttons
           voteButtons.forEach(btn => btn.style.display = 'none');
      }
    })
    .catch(err => {
        console.error('Network or JSON parsing error fetching match:', err);
        const headToHeadContainer = document.querySelector('#head-to-head-ui .image-container');
        const voteButtons = document.querySelectorAll('#head-to-head-ui button');
         if (headToHeadContainer) headToHeadContainer.innerHTML = `<p>Error fetching next match: ${err.message}</p>`;
          // Hide vote buttons on error
         voteButtons.forEach(btn => btn.style.display = 'none');
    });
}


/**
 * Handles the subset change event.
 */
function changeSubset() {
  const sel = document.getElementById(subsetSelectElementId);
  if (!sel) {
      console.error(`Subset select element #${subsetSelectElementId} not found!`);
      return;
  }
  const newSubset = sel.value;
  if (!newSubset || newSubset === subset) {
      return; // No change or invalid selection
  }

  subset = newSubset;
  console.log(`Subset changed to: ${subset}`);

  // Update URL query parameter without full reload
  const url = new URL(window.location);
  url.searchParams.set('subset', subset);
  window.history.pushState({ subset: subset }, '', url);


  // Reset current pair and uninitialized images
  currentPair = [];
  uninitializedImages = [];

  // Use checkInitializationStatus for the new subset
  checkInitializationStatus(subset);
}

/**
 * Confirms and initiates deletion of an image.
 * @param {number} imageIndex - The index (1 or 2) of the image in the current pair to delete.
 */
function confirmDelete(imageIndex) {
  if (currentPair.length < imageIndex || imageIndex < 1) {
      console.error("Invalid image index for deletion:", imageIndex);
      return;
  }
  const image = currentPair[imageIndex - 1];
  if (confirm(`Are you sure you want to delete "${image}" from subset "${subset}"? This action cannot be undone.`)) {
    deleteImage(image);
  }
}

/**
 * Sends a request to delete an image from the current subset.
 * @param {string} image - The image filename to delete.
 */
function deleteImage(image) {
    if (!subset || !image) {
        console.error("Cannot delete image: subset or image name missing.");
        return;
    }

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
        // Reset current pair because one image is gone
        currentPair = [];
        // Fetch the next match immediately. It might return an error if <2 images remain.
        fetchMatch();
        fetchProgress(); // Update progress/image counts
    })
    .catch(err => {
        console.error(`Error deleting ${subsetType} image:`, err);
        alert(`Error deleting image: ${err.message || err.error || 'Unknown error'}`);
        // Even on error, try refreshing the state, as the image *might* be gone from the list anyway
        fetchMatch();
        fetchProgress();
    });
}