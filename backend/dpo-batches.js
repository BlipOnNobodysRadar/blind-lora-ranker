const express = require('express');
const fs = require('fs');
const path = require('path');
const { createHash, randomUUID } = require('crypto');
const { exportDpoBatch, pngDimensions } = require('./dpo-export');

const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const IMAGE_ID = /^[0-9a-f]{64}$/;

function createDpoRouter(dataDir) {
    const router = express.Router();
    const batchesDir = path.join(dataDir, 'dpo-batches');
    const exportDir = path.join(dataDir, 'dpo-exports');
    const batchDir = id => path.join(batchesDir, id);
    const metadata = id => path.join(batchDir(id), 'batch.json');
    const imagePath = (id, imageId) => path.join(batchDir(id), imageId + '.png');

    function readBatch(id) {
        return JSON.parse(fs.readFileSync(metadata(id), 'utf8'));
    }

    // Keep read/modify/rename synchronous in this single-process server. A failed
    // write leaves the last complete snapshot in place; concurrent tabs can't
    // clobber each other's scores with old copies of the whole batch.
    function saveBatch(batch) {
        const temp = metadata(batch.id) + '.tmp';
        fs.writeFileSync(temp, JSON.stringify(batch));
        fs.renameSync(temp, metadata(batch.id));
    }

    function blindSummary(batch) {
        // A content hash gives each generation a stable, shuffled position,
        // independent of the original filename, seed or drop order.
        return {
            id: batch.id,
            prompt: batch.prompt,
            images: Object.keys(batch.images).sort().map(id => ({ id, score: batch.images[id].score }))
        };
    }

    router.param('batch', (req, res, next, id) => {
        if (!UUID.test(id) || !fs.existsSync(metadata(id))) {
            return res.status(404).json({ error: 'Batch not found.' });
        }
        next();
    });

    router.param('image', (req, res, next, id) => {
        if (!IMAGE_ID.test(id)) return res.status(404).json({ error: 'Image not found.' });
        next();
    });

    router.get('/batches', (req, res) => {
        if (!fs.existsSync(batchesDir)) return res.json([]);
        const batches = fs.readdirSync(batchesDir, { withFileTypes: true })
            .filter(entry => entry.isDirectory() && UUID.test(entry.name) && fs.existsSync(metadata(entry.name)))
            .map(entry => {
                const { id, prompt, created } = readBatch(entry.name);
                return { id, prompt, created };
            });
        res.json(batches.sort((a, b) => b.created.localeCompare(a.created)));
    });

    router.post('/batches', (req, res) => {
        const prompt = req.body && req.body.prompt;
        if (typeof prompt !== 'string' || !prompt.trim()) {
            return res.status(400).json({ error: 'Enter the positive prompt shared by these images.' });
        }
        const batch = { id: randomUUID(), prompt, created: new Date().toISOString(), images: {} };
        fs.mkdirSync(batchDir(batch.id), { recursive: true });
        saveBatch(batch);
        res.status(201).json(blindSummary(batch));
    });

    router.get('/batches/:batch', (req, res) => {
        res.json(blindSummary(readBatch(req.params.batch)));
    });

    router.post('/batches/:batch/images', express.raw({ type: 'image/png', limit: '128mb' }), async (req, res, next) => {
        const bytes = req.body;
        if (!Buffer.isBuffer(bytes)) return res.status(400).json({ error: 'Expected a PNG image.' });
        try {
            pngDimensions(bytes);
        } catch (error) {
            return next(error);
        }
        let name;
        try {
            name = path.posix.basename(path.win32.basename(decodeURIComponent(req.get('X-Image-Name') || 'image.png')));
        } catch {
            return res.status(400).json({ error: 'Invalid image name.' });
        }

        const id = createHash('sha256').update(bytes).digest('hex');
        const target = imagePath(req.params.batch, id);
        const temp = target + '.' + randomUUID() + '.tmp';
        try {
            if (!fs.existsSync(target)) {
                await fs.promises.writeFile(temp, bytes);
                await fs.promises.rename(temp, target);
            }
            // Re-read after async file IO in case a second request added a score.
            const batch = readBatch(req.params.batch);
            if (batch.images[id]) return res.json({ added: false });
            batch.images[id] = { name: name || 'image.png', score: null };
            saveBatch(batch);
            res.status(201).json({ added: true });
        } catch (error) {
            await fs.promises.rm(temp, { force: true }).catch(() => {});
            next(error);
        }
    });

    router.get('/batches/:batch/images/:image', (req, res, next) => {
        res.type('png').sendFile(imagePath(req.params.batch, req.params.image), error => {
            if (error) next(error);
        });
    });

    router.put('/batches/:batch/scores/:image', (req, res) => {
        const { score } = req.body || {};
        if (score !== null && (!Number.isInteger(score) || score < 1 || score > 10)) {
            return res.status(400).json({ error: 'Score must be an integer from 1 to 10, or null to clear it.' });
        }
        const batch = readBatch(req.params.batch);
        const image = batch.images[req.params.image];
        if (!image) return res.status(404).json({ error: 'Image not found in this batch.' });
        image.score = score;
        saveBatch(batch);
        res.json({ score });
    });

    router.post('/batches/:batch/export', async (req, res, next) => {
        try {
            const batch = readBatch(req.params.batch);
            const images = Object.entries(batch.images).map(([id, image]) => ({
                ...image, id, path: imagePath(batch.id, id)
            }));
            res.status(201).json(await exportDpoBatch({ prompt: batch.prompt, images, outputRoot: exportDir }));
        } catch (error) {
            next(error);
        }
    });

    router.use((error, req, res, next) => {
        if (res.headersSent) return next(error);
        res.status(error.status || 500).json({ error: error.message });
    });
    return router;
}

module.exports = { createDpoRouter };
