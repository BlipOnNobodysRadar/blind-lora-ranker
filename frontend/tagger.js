// frontend/tagger.js

document.addEventListener('DOMContentLoaded', () => {
    // --- Element References ---
    const subsetSelect = document.getElementById('subset-select');
    const applyBtn = document.getElementById('apply-tags-btn');
    const resultsArea = document.getElementById('results-area');
    const tagPrefixInput = document.getElementById('tag-prefix');
    const tagNamesInput = document.getElementById('tag-names');
    const strategyRadios = document.querySelectorAll('input[name="strategy"]');
    const numBinsContainer = document.getElementById('num-bins-container');
    const numBinsInput = document.getElementById('num-bins');

    // --- Functions ---

    function fetchNormalSubsets() {
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
        if (!selectedStrategyRadio) return; // Exit if no radio is checked yet

        const strategy = selectedStrategyRadio.value;

        // Show/hide num bins input
        numBinsContainer.style.display = (strategy === 'equalQuantile') ? 'inline-block' : 'none';

        // Set default tags/prefix based on presets in data attributes
        const defaultTags = selectedStrategyRadio.dataset.tags;
        const defaultPrefix = selectedStrategyRadio.dataset.prefix;

        if (defaultTags) {
            tagNamesInput.value = defaultTags;
        }
        // Only update prefix if a preset provides one, otherwise keep user value
        if (defaultPrefix !== undefined) { // Check if attribute exists
             tagPrefixInput.value = defaultPrefix;
        }

        // Optional: Update placeholder/requirement text
        // let requiredTagsMsg = "";
        // if(strategy === 'customQuantile') requiredTagsMsg = "(Requires 5 tags)";
        // else if(strategy === 'ponyQuantile') requiredTagsMsg = "(Uses 7 fixed tags: score_3..9)";
        // else if(strategy === 'equalQuantile') requiredTagsMsg = `(Requires ${numBinsInput.value} tags)`;
        // else if(strategy === 'stdDev') requiredTagsMsg = "(Requires 5 or 7 tags)";
        // You could add a small element like <span id="tag-req-msg"></span> and update its textContent
        // document.getElementById('tag-req-msg').textContent = requiredTagsMsg;
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
        const binTags = tagNamesInput.value.split(',').map(t => t.trim()).filter(t => t);
        const numBins = (strategy === 'equalQuantile') ? parseInt(numBinsInput.value, 10) : undefined;

        // --- Input Validation ---
        let validationError = null;
        if (!subset) validationError = 'Please select a subset.';
        else if (!tagPrefix) validationError = 'Please enter a tag prefix.';
        else if (binTags.length === 0) validationError = 'Please enter at least one tag name.';
        else if (strategy === 'customQuantile' && binTags.length !== 5) validationError = 'Custom Quantile strategy requires exactly 5 tag names.';
        else if (strategy === 'equalQuantile' && (!numBins || numBins < 2)) validationError = 'Number of bins must be at least 2 for Equal Quantiles.';
        else if (strategy === 'equalQuantile' && binTags.length !== numBins) validationError = `Number of tag names (${binTags.length}) must match the number of bins (${numBins}).`;
         else if (strategy === 'stdDev' && binTags.length !== 5 && binTags.length !== 7) validationError = 'Standard Deviation strategy requires exactly 5 or 7 tag names.';
         // Pony strategy uses fixed tags internally, validation happens backend mainly

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
            binTags: binTags, // Send the user-provided tags
            numBins: numBins // Send numBins if applicable
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
    if (subsetSelect && applyBtn && resultsArea && tagPrefixInput && tagNamesInput && strategyRadios.length > 0 && numBinsContainer && numBinsInput) {
        fetchNormalSubsets();
        applyBtn.addEventListener('click', applyTags);
        strategyRadios.forEach(radio => radio.addEventListener('change', updateTagInputs));
        numBinsInput.addEventListener('change', updateTagInputs); // Update requirements text if num bins changes
        updateTagInputs(); // Initial setup based on default checked radio
    } else {
        console.error("One or more required elements for tagger page not found!");
        if(resultsArea) {
            resultsArea.textContent = "Error: UI elements missing. Check console.";
            resultsArea.className = "error";
        }
    }
});