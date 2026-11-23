const assert = require('assert').strict;
const express = require('express');
const fs = require('fs').promises;
const os = require('os');
const path = require('path');
const { createDpoRouter } = require('../backend/dpo-batches');

describe('Blind DPO batch API', function () {
    let directory, server, base;
    const red = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAIAAAASFvFNAAAAEElEQVR4nGP8zwAFTDAGAwATKQED8NgHhAAAAABJRU5ErkJggg==', 'base64');
    const green = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAIAAAASFvFNAAAAEUlEQVR4nGNkaGCAACYGGAAACTwAhPqAFNAAAAAASUVORK5CYII=', 'base64');

    async function start() {
        const app = express();
        app.use(express.json());
        app.use(createDpoRouter(directory));
        await new Promise(resolve => { server = app.listen(0, '127.0.0.1', resolve); });
        base = 'http://127.0.0.1:' + server.address().port + '/batches';
    }
    function stop() {
        return new Promise(resolve => {
            server.close(resolve);
            server.closeIdleConnections?.();
        });
    }
    beforeEach(async function () {
        directory = await fs.mkdtemp(path.join(os.tmpdir(), 'blind-dpo-'));
        await start();
    });
    afterEach(async function () {
        await stop();
        await fs.rm(directory, { recursive: true, force: true });
    });

    function json(method, body) {
        return { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
    }
    it('resumes blind scores, deduplicates uploads, and exports only this prompt', async function () {
        const prompt = '夜景\nwith neon signs';
        const session = await (await fetch(base, json('POST', { prompt }))).json();
        const url = base + '/' + session.id;
        function upload(bytes) {
            return fetch(url + '/images', {
                method: 'POST', headers: { 'Content-Type': 'image/png', 'X-Image-Name': 'seed-model.png' }, body: bytes
            });
        }
        const uploads = await Promise.all([upload(red), upload(green)]);
        assert.deepEqual(uploads.map(r => r.status), [201, 201]);
        assert.deepEqual(await (await upload(red)).json(), { added: false });
        assert.equal((await upload(red.subarray(0, 33))).status, 400);
        const { images } = await (await fetch(url)).json();
        assert.equal(images.length, 2);
        for (const image of images) {
            assert.deepEqual(Object.keys(image).sort(), ['id', 'score']);
            assert.match(image.id, /^[a-f0-9]{64}$/);
            assert.equal(image.score, null);
        }
        const image = await fetch(url + '/images/' + images[0].id);
        assert.equal(image.headers.get('content-type'), 'image/png');
        assert.ok(Buffer.from(await image.arrayBuffer()).length > 33);
        const scoreUrl = index => url + '/scores/' + images[index].id;
        assert.equal((await fetch(scoreUrl(0), json('PUT', { score: 2.5 }))).status, 400);
        const saved = await Promise.all([fetch(scoreUrl(0), json('PUT', { score: 7 })), fetch(scoreUrl(1), json('PUT', { score: 8 }))]);
        assert.deepEqual(saved.map(r => r.status), [200, 200]);

        await stop();
        await start(); // A new process/router reads the same batch from disk.
        const resumed = await (await fetch(base + '/' + session.id)).json();
        assert.deepEqual(resumed.images.map(i => i.id), images.map(i => i.id));
        assert.deepEqual(resumed.images.map(i => i.score), [7, 8]);
        assert.equal(resumed.prompt, prompt);

        const second = await (await fetch(base, json('POST', { prompt: 'other prompt' }))).json();
        assert.equal((await fetch(base + '/' + second.id + '/scores/' + images[0].id, json('PUT', { score: 10 }))).status, 404);
        const result = await (await fetch(base + '/' + session.id + '/export', { method: 'POST' })).json();
        assert.equal(result.pairs, 1);
        const manifest = JSON.parse(await fs.readFile(path.join(result.directory, 'ratings.json')));
        const stem = manifest.pairs[0].stem;
        assert.equal(await fs.readFile(path.join(result.directory, 'chosen', stem + '.txt'), 'utf8'), prompt);
        const sidecar = JSON.parse(await fs.readFile(path.join(result.directory, 'chosen', stem + '.dpo.json')));
        assert.equal(sidecar.preference_probability, 0.5 + 1 / 18);
        assert.equal((await fetch(base + '/' + session.id + '/scores/' + images[0].id, json('PUT', { score: null }))).status, 200);
        assert.equal((await fetch(base + '/' + session.id + '/export', { method: 'POST' })).status, 400);
    });
});
