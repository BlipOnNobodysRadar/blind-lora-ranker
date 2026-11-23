'use strict';

const byId = id => document.getElementById(id);
const PAGE_SIZE = 8;
let batch = null;
let selected = 0;
let pending = [];
let busy = false;
let renderedPage = '';
let lastExport = '';

async function api(url, options) {
    const response = await fetch('/api/dpo/batches' + url, options);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Request failed.');
    return data;
}

function json(method, body) {
    return { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

function setControls() {
    byId('batch').disabled = busy;
    byId('import-fields').disabled = busy;
    byId('start').disabled = busy || pending.length === 0 || !byId('prompt').value.trim();
    const image = batch?.images[selected];
    byId('rating-controls').disabled = busy || !image;
    byId('clear').disabled = !image || image.score === null;
    byId('previous').disabled = busy || selected <= 0;
    byId('next').disabled = busy || !image || selected >= batch.images.length - 1;
    byId('zoom').disabled = busy || !image;
    const scores = new Set(batch?.images.filter(i => i.score !== null).map(i => i.score));
    byId('export').disabled = busy || scores.size < 2;
}

async function action(fn) {
    if (busy) return;
    busy = true;
    byId('status').textContent = '';
    setControls();
    try {
        await fn();
    } catch (error) {
        byId('status').textContent = error.message;
    } finally {
        busy = false;
        setControls();
    }
}

function urlForImage(image) {
    return '/api/dpo/batches/' + batch.id + '/images/' + image.id;
}

function render() {
    byId('rating').hidden = !batch?.images.length;
    byId('import-title').textContent = batch ? 'Add PNGs to this batch' : 'Import a prompt batch';
    byId('start').textContent = batch ? 'Add images' : 'Start batch';
    byId('prompt').readOnly = Boolean(batch);
    byId('prompt-caption').textContent = batch?.prompt || '';
    byId('export-result').textContent = lastExport;
    if (!batch?.images.length) {
        renderedPage = '';
        byId('grid').replaceChildren();
        setControls();
        return;
    }
    const images = batch.images;
    const start = Math.floor(selected / PAGE_SIZE) * PAGE_SIZE;
    const page = images.slice(start, start + PAGE_SIZE);
    // Keep decoded image elements on screen when a score advances within a page.
    const key = batch.id + ':' + page.map(image => image.id).join(',');
    if (key !== renderedPage) {
        renderedPage = key;
        byId('grid').replaceChildren(...page.map((image, offset) => {
            const index = start + offset;
            const card = document.createElement('button');
            card.type = 'button';
            card.className = 'card';
            const img = document.createElement('img');
            img.alt = 'Generation ' + (index + 1);
            img.src = urlForImage(image);
            card.append(img, document.createElement('span'));
            card.addEventListener('click', () => select(index));
            card.addEventListener('dblclick', () => { if (!busy) enlarge(); });
            return card;
        }));
    }
    page.forEach((image, offset) => {
        const index = start + offset;
        const card = byId('grid').children[offset];
        card.setAttribute('aria-pressed', String(index === selected));
        card.lastChild.textContent = '#' + (index + 1) + ' · ' + (image.score === null ? 'Unrated' : image.score + '/10');
    });
    const rated = images.filter(i => i.score !== null).length;
    byId('progress').textContent = rated + ' of ' + images.length + ' rated';
    byId('score-label').textContent = 'Score image #' + (selected + 1);
    for (const button of byId('scale').children) {
        button.setAttribute('aria-pressed', String(Number(button.value) === images[selected].score));
    }
    setControls();
}

function select(index) {
    if (busy || !batch || index < 0 || index >= batch.images.length) return;
    selected = index;
    render();
}

function setPending(files, folder = false) {
    if (busy) return;
    const picked = Array.from(files);
    const chosen = picked.filter(file => /\.png$/i.test(file.name)
        && (!folder || file.webkitRelativePath.split('/').length <= 2));
    pending = chosen;
    const ignored = picked.length - chosen.length;
    byId('selection').textContent = chosen.length + ' PNGs selected' + (ignored ? ' · ' + ignored + ' skipped' : '');
    setControls();
}

async function listBatches() {
    const all = await api('');
    byId('batch').replaceChildren(new Option('New batch…', ''), ...all.map(item => {
        const prompt = item.prompt.replace(/\s+/g, ' ').trim();
        return new Option(prompt.slice(0, 65) + (prompt.length > 65 ? '…' : '') + ' · ' + item.id.slice(0, 6), item.id);
    }));
}

async function openBatch(id) {
    // Keep the old session intact if fetching the new one fails.
    let next;
    try {
        next = id ? await api('/' + id) : null;
    } catch (error) {
        byId('batch').value = batch?.id || '';
        throw error;
    }
    batch = next;
    byId('batch').value = id;
    pending = [];
    byId('selection').textContent = 'Each folder selection imports its top-level PNGs.';
    lastExport = '';
    selected = Math.max(0, batch?.images.findIndex(i => i.score === null) ?? 0);
    byId('prompt').value = batch?.prompt || '';
    byId('importer').open = !batch?.images.length;
    const url = new URL(location.href);
    if (id) url.searchParams.set('batch', id);
    else url.searchParams.delete('batch');
    history.replaceState(null, '', url);
    render();
}

async function importFiles() {
    const files = pending;
    const failed = [];
    let firstError = '';
    let added = 0;
    if (!batch) {
        batch = await api('', json('POST', { prompt: byId('prompt').value }));
        // Include the new batch in navigation even if a file upload fails.
        byId('batch').add(new Option(batch.prompt.slice(0, 65) + ' · ' + batch.id.slice(0, 6), batch.id), 1);
        byId('batch').value = batch.id;
        const url = new URL(location.href);
        url.searchParams.set('batch', batch.id);
        history.replaceState(null, '', url);
    }
    for (const [index, file] of files.entries()) {
        byId('status').textContent = 'Importing ' + (index + 1) + ' of ' + files.length + '…';
        try {
            const result = await api('/' + batch.id + '/images', {
                method: 'POST',
                headers: { 'Content-Type': 'image/png', 'X-Image-Name': encodeURIComponent(file.name) },
                body: file
            });
            if (result.added) added++;
        } catch (error) {
            failed.push(file);
            firstError ||= error.message;
        }
    }
    pending = failed;
    await openBatch(batch.id);
    pending = failed;
    const duplicates = files.length - added - failed.length;
    let message = 'Added ' + added + ' PNGs.';
    if (duplicates) message += ' Already imported: ' + duplicates + '.';
    if (failed.length) {
        message += ' Failed: ' + failed.length + '. ' + firstError;
        byId('selection').textContent = failed.length + ' files ready to retry.';
        byId('importer').open = true;
    }
    byId('status').textContent = message;
}

function rate(score) {
    if (!batch?.images.length) return;
    action(async () => {
        const image = batch.images[selected];
        await api('/' + batch.id + '/scores/' + image.id, json('PUT', { score }));
        image.score = score;
        lastExport = '';
        if (score !== null) {
            let next = batch.images.findIndex((item, i) => i > selected && item.score === null);
            if (next < 0) next = batch.images.findIndex(item => item.score === null);
            if (next >= 0) selected = next;
        }
        render();
    });
}

function enlarge() {
    if (!batch?.images[selected]) return;
    byId('preview-image').src = urlForImage(batch.images[selected]);
    byId('preview').showModal();
}

for (let score = 1; score <= 10; score++) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = score;
    button.value = score;
    button.addEventListener('click', () => rate(score));
    byId('scale').append(button);
}

byId('batch').addEventListener('change', event => action(() => openBatch(event.target.value)));
byId('prompt').addEventListener('input', setControls);
for (const [buttonId, inputId] of [['pick-files', 'files'], ['pick-folder', 'folder']]) {
    byId(buttonId).addEventListener('click', () => byId(inputId).click());
    byId(inputId).addEventListener('change', event => {
        setPending(event.target.files, inputId === 'folder');
        event.target.value = '';
    });
}
byId('drop').addEventListener('dragover', event => {
    event.preventDefault();
    if (!busy) byId('drop').classList.add('over');
});
byId('drop').addEventListener('dragleave', () => byId('drop').classList.remove('over'));
byId('drop').addEventListener('drop', event => {
    event.preventDefault();
    byId('drop').classList.remove('over');
    setPending(event.dataTransfer.files);
});
byId('start').addEventListener('click', () => action(importFiles));
byId('previous').addEventListener('click', () => select(selected - 1));
byId('next').addEventListener('click', () => select(selected + 1));
byId('clear').addEventListener('click', () => rate(null));
byId('zoom').addEventListener('click', enlarge);
byId('close-preview').addEventListener('click', () => byId('preview').close());
byId('export').addEventListener('click', () => action(async () => {
    lastExport = '';
    byId('export-result').textContent = 'Building dataset…';
    try {
        const result = await api('/' + batch.id + '/export', { method: 'POST' });
        lastExport = 'Exported ' + result.pairs + ' pairs using ' + result.used + ' of ' + result.rated + ' rated images.\n' + result.directory;
    } finally {
        byId('export-result').textContent = lastExport;
    }
}));

document.addEventListener('keydown', event => {
    if (busy || !batch?.images.length || event.repeat || event.isComposing
        || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey
        || event.target.closest('textarea, input, select') || byId('preview').open) return;
    if (/^[0-9]$/.test(event.key)) {
        event.preventDefault();
        rate(Number(event.key) || 10);
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        select(selected + (event.key === 'ArrowRight' ? 1 : -1));
    }
});

action(async () => {
    await listBatches();
    const id = new URL(location.href).searchParams.get('batch') || '';
    await openBatch(Array.from(byId('batch').options).some(option => option.value === id) ? id : '');
});
