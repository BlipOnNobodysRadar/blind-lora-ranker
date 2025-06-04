const assert = require('assert');
const { kmeans1D } = require('../backend/server');

describe('kmeans1D', function() {
  it('clusters simple array into two centroids', function() {
    const data = [1,2,10,11];
    const { centroids } = kmeans1D(data, 2);
    assert.strictEqual(centroids.length, 2);
    assert.notStrictEqual(centroids[0], centroids[1]);
    // Sort for deterministic assertions
    const sorted = centroids.slice().sort((a,b) => a-b);
    assert.ok(Math.abs(sorted[0] - 1.5) < 0.6);
    assert.ok(Math.abs(sorted[1] - 10.5) < 0.6);
  });
});
