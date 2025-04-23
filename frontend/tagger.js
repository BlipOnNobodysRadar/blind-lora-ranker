// frontend/tagger.js

document.addEventListener('DOMContentLoaded', () => {
    // --- Element References ---
    const subsetSelect = document.getElementById('subset-select');
    const applyBtn = document.getElementById('apply-tags-btn');
    const resultsArea = document.getElementById('results-area');
    const tagPrefixInput = document.getElementById('tag-prefix');
    const tagNamesInput = document.getElementById('tag-names');
    const strategyRadios = document.querySelectorAll('input[name="strategy"]');
    // Parameter Containers
    const numBinsContainer = document.getElementById('num-bins-container');
    const numClustersContainer = document.getElementById('num-clusters-container');
    const rangeThresholdsContainer = document.getElementById('range-thresholds-container');
    // Parameter Inputs
    const numBinsInput = document.getElementById('num-bins');
    const numClustersInput = document.getElementById('num-clusters');
    const rangeThresholdsInput = document.getElementById('range-thresholds');
    // Requirement message span
    const tagReqMsg = document.getElementById('tag-req-msg');


    // --- Functions ---

    function fetchNormalSubsets() {
        // (Keep existing function - unchanged)
        fetch('/api/normal-subsets')
            .then(res => res.ok ? res.json() : Promise.reject('Failed to load subsets'))
            .then(data => {
                subsetSelect.innerHTML = '<option value="">-- Select Subset --</option>'; // Reset
                if (data && data.length > 0) {
                    data.forEach(s => {
                        const option = document.createElement('option');
                        option.value = s;
                        option.textContent = s;
                        subsetSelect.appendChild(option);
                    });
                } else {
                    subsetSelect.innerHTML = '<option value="">-- No Normal Subsets Found --</option>';
                }
            })
            .catch(error => {
                console.error('Error fetching normal subsets:', error);
                subsetSelect.innerHTML = '<option value="">-- Error Loading --</option>';
                resultsArea.textContent = `Error loading subsets: ${error}`;
                resultsArea.className = 'error';
            });
    }

    function updateTagInputs() {
        const selectedStrategyRadio = document.querySelector('input[name="strategy"]:checked');
        if (!selectedStrategyRadio) return;

        const strategy = selectedStrategyRadio.value;

        // Hide all parameter containers initially
        numBinsContainer.style.display = 'none';
        numClustersContainer.style.display = 'none';
        rangeThresholdsContainer.style.display = 'none';

        // Show relevant parameter container
        if (strategy === 'equalQuantile') numBinsContainer.style.display = 'block';
        else if (strategy === 'kmeans') numClustersContainer.style.display = 'block';
        else if (strategy === 'rangeNormalization') rangeThresholdsContainer.style.display = 'block';

        // Set default tags/prefix based on presets if available
        const defaultTags = selectedStrategyRadio.dataset.tags;
        const defaultPrefix = selectedStrategyRadio.dataset.prefix;

        // Only update tag names if the preset provides them (allows user override)
        if (defaultTags !== undefined && defaultTags !== "") { // Check attribute exists and has value
            tagNamesInput.value = defaultTags;
        } else if (strategy === 'ponyQuantile') {
             // Pony score tags are fixed, disable editing? Or just inform user?
             tagNamesInput.value = "score_3,score_4,score_5,score_6,score_7,score_8,score_9"; // Display fixed tags
             tagNamesInput.disabled = true; // Disable editing for pony
        } else {
             tagNamesInput.disabled = false; // Re-enable if switching away from pony
        }


        // Only update prefix if a preset provides one
        if (defaultPrefix !== undefined) {
             tagPrefixInput.value = defaultPrefix;
        }

        // Update requirement message
        let requiredTagsMsg = "";
        const currentTags = tagNamesInput.value.split(',').map(t => t.trim()).filter(t => t);
        const currentTagCount = currentTags.length;

        switch(strategy) {
            case 'customQuantile': requiredTagsMsg = "(Requires 5 tags)"; break;
            case 'ponyQuantile':   requiredTagsMsg = "(Uses 7 fixed tags)"; break;
            case 'stdDev':         requiredTagsMsg = "(Requires 5 or 7 tags)"; break;
            case 'equalQuantile':  requiredTagsMsg = `(Requires ${numBinsInput.value || 'N/A'} tags)`; break;
            case 'kmeans':         requiredTagsMsg = `(Requires ${numClustersInput.value || 'N/A'} tags/clusters)`; break;
            case 'rangeNormalization':
                 const thresholds = rangeThresholdsInput.value.split(',').map(t => parseFloat(t.trim())).filter(n => !isNaN(n));
                 requiredTagsMsg = `(Requires ${thresholds.length + 1} tags)`; break;
            default: requiredTagsMsg = "(Required count depends on strategy)";
        }
        if (tagReqMsg) tagReqMsg.textContent = ` ${requiredTagsMsg}`; // Add space before message
    }


    function applyTags() {
        const subset = subsetSelect.value;
        const selectedStrategyRadio = document.querySelector('input[name="strategy"]:checked');
        if (!selectedStrategyRadio) {
             resultsArea.textContent = 'Please select a tagging strategy.';
             resultsArea.className = 'error';
             return;
        }
        const strategy = selectedStrategyRadio.value;
        const tagPrefix = tagPrefixInput.value.trim();
        // Read tags *unless* it's pony mode
        const binTags = (strategy === 'ponyQuantile')
            ? [] // Send empty, backend uses fixed pony tags
            : tagNamesInput.value.split(',').map(t => t.trim()).filter(t => t);

        // --- Get Strategy-Specific Parameters ---
        let numBins, numClusters, rangeThresholds;
        if (strategy === 'equalQuantile') {
            numBins = parseInt(numBinsInput.value, 10);
        } else if (strategy === 'kmeans') {
            numClusters = parseInt(numClustersInput.value, 10);
        } else if (strategy === 'rangeNormalization') {
            rangeThresholds = rangeThresholdsInput.value.split(',')
                .map(t => parseFloat(t.trim()))
                .filter(n => !isNaN(n) && n >= 0 && n <= 1); // Basic validation for thresholds
        }

        // --- Input Validation ---
        let validationError = null;
        if (!subset) validationError = 'Please select a subset.';
        else if (!tagPrefix) validationError = 'Please enter a tag prefix.';
        // Tag count validation (excluding pony)
        else if (strategy !== 'ponyQuantile' && binTags.length === 0) validationError = 'Please enter at least one tag name.';
        else if (strategy === 'customQuantile' && binTags.length !== 5) validationError = 'Custom Quantile requires exactly 5 tag names.';
        else if (strategy === 'equalQuantile' && (!numBins || numBins < 2)) validationError = 'Number of bins must be at least 2.';
        else if (strategy === 'equalQuantile' && binTags.length !== numBins) validationError = `Tag names count (${binTags.length}) must match bins (${numBins}).`;
        else if (strategy === 'kmeans' && (!numClusters || numClusters < 2)) validationError = 'Number of clusters (K) must be at least 2.';
        else if (strategy === 'kmeans' && binTags.length !== numClusters) validationError = `Tag names count (${binTags.length}) must match K (${numClusters}).`;
        else if (strategy === 'rangeNormalization' && (!rangeThresholds || rangeThresholds.length === 0)) validationError = 'Please enter valid, comma-separated thresholds (0-1).';
        else if (strategy === 'rangeNormalization' && binTags.length !== rangeThresholds.length + 1) validationError = `Need ${rangeThresholds.length + 1} tag names for ${rangeThresholds.length} thresholds.`;
        else if (strategy === 'stdDev' && binTags.length !== 5 && binTags.length !== 7) validationError = 'Standard Deviation requires exactly 5 or 7 tag names.';


        if (validationError) {
             resultsArea.textContent = `Validation Error: ${validationError}`;
             resultsArea.className = 'error';
             return;
        }

        // --- Proceed with API Call ---
        applyBtn.disabled = true;
        resultsArea.textContent = `Processing subset "${subset}"...`;
        resultsArea.className = 'processing';

        const requestBody = {
            strategy: strategy,
            tagPrefix: tagPrefix,
            binTags: binTags, // Send empty for pony
            // Include optional params only if defined
            ...(numBins && { numBins }),
            ...(numClusters && { numClusters }),
            ...(rangeThresholds && { rangeThresholds }),
        };

        fetch(`/api/apply-tags/normal/${subset}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody)
        })
        .then(res => res.json().then(data => ({ ok: res.ok, status: res.status, body: data })))
        .then(response => {
            if (response.ok) {
                resultsArea.textContent = `Success!\n${response.body.message}\n\nTag Counts:\n${JSON.stringify(response.body.tagCounts || {}, null, 2)}`;
                resultsArea.className = 'success';
            } else {
                resultsArea.textContent = `Error (${response.status}): ${response.body.error || 'Unknown processing error'}`;
                resultsArea.className = 'error';
            }
        })
        .catch(error => {
            console.error('Error applying tags:', error);
            resultsArea.textContent = `Fetch Error: ${error.message}`;
            resultsArea.className = 'error';
        })
        .finally(() => {
            applyBtn.disabled = false;
        });
    }

    // --- Initialization and Event Listeners ---
    if (subsetSelect && applyBtn && resultsArea && tagPrefixInput && tagNamesInput && strategyRadios.length > 0 && numBinsContainer && numBinsInput && numClustersContainer && numClustersInput && rangeThresholdsContainer && rangeThresholdsInput && tagReqMsg) {
        fetchNormalSubsets();
        applyBtn.addEventListener('click', applyTags);
        strategyRadios.forEach(radio => radio.addEventListener('change', updateTagInputs));
        numBinsInput.addEventListener('change', updateTagInputs); // Update req msg if bins change
        numClustersInput.addEventListener('change', updateTagInputs); // Update req msg if K changes
        rangeThresholdsInput.addEventListener('input', updateTagInputs); // Update req msg as thresholds typed
        updateTagInputs(); // Initial UI setup
    } else {
        console.error("One or more required elements for tagger page not found!");
        if(resultsArea) {
            resultsArea.textContent = "Error: UI elements missing. Check console.";
            resultsArea.className = "error";
        }
    }
});