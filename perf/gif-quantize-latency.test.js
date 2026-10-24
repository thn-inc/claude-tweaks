// GIF quantize latency budget (#2758) — deliberately NOT part of `npm test`.
//
// Run with: npm run test:perf
//
// quantize() builds a median-cut palette over a union of frames. A 400x300 continuous-gradient
// frame (~120K pixels, many distinct colors) must quantize and index under a generous 5 s, proving
// the histogram+cache approach scales with pixel count. Lives outside tests/ because a wall-clock
// assertion flakes under sibling-suite load; the functional half (palette size and index length)
// stays in tests/bin-lib/gif/palette.test.js.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { quantize } = require('../plugin/bin/lib/gif/palette');

test('quantize: a large, high-color-count frame (mimicking a real screenshot) completes quickly', () => {
  const w = 400, h = 300; // smaller than a real 1280x720 frame but still ~120K pixels / continuous-gradient distinct colors, enough to prove the histogram+cache approach scales
  const frame = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    frame[i] = (x * 3) % 256; frame[i + 1] = (y * 5) % 256; frame[i + 2] = (x + y) % 256; frame[i + 3] = 255;
  }
  const start = Date.now();
  const { palette, index } = quantize([frame], 256);
  const elapsedMs = Date.now() - start;
  const idx = index(frame);
  assert.ok(palette.length / 3 <= 256);
  assert.equal(idx.length, w * h);
  assert.ok(elapsedMs < 5000, `expected quantize+index on a ${w}x${h} frame to complete in under 5s, took ${elapsedMs}ms`);
});
