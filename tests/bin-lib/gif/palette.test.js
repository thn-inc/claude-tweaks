'use strict';
// tests/bin-lib/gif/palette.test.js — #2758: median-cut quantization over a union of frames.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { quantize } = require('../../../plugin/bin/lib/gif/palette');

function gradientFrame(w, h) {
  const rgba = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    rgba[i] = Math.floor((x / w) * 255);
    rgba[i + 1] = Math.floor((y / h) * 255);
    rgba[i + 2] = (x * 7 + y * 13) % 256;
    rgba[i + 3] = 255;
  }
  return rgba;
}

test('quantize: a 32x32 gradient (1024 distinct-ish colors) yields <=256 palette entries, every index in range', () => {
  const frame = gradientFrame(32, 32);
  const { palette, index } = quantize([frame], 256);
  assert.ok(palette.length % 3 === 0);
  const n = palette.length / 3;
  assert.ok(n <= 256, `expected at most 256 palette entries, got ${n}`);
  const idx = index(frame);
  assert.equal(idx.length, 32 * 32);
  for (const v of idx) assert.ok(v >= 0 && v < n, `index ${v} out of range [0,${n})`);
});

test('quantize: deterministic — same input yields byte-identical palette and indices on a second call', () => {
  const frame = gradientFrame(16, 16);
  const a = quantize([frame], 256);
  const b = quantize([frame], 256);
  assert.deepEqual([...a.palette], [...b.palette]);
  assert.deepEqual([...a.index(frame)], [...b.index(frame)]);
});

test('quantize: a single-color frame yields a 1-entry palette and an all-zero index', () => {
  const w = 4, h = 4;
  const frame = new Uint8Array(w * h * 4);
  for (let p = 0; p < w * h; p++) { frame[p * 4] = 10; frame[p * 4 + 1] = 20; frame[p * 4 + 2] = 30; frame[p * 4 + 3] = 255; }
  const { palette, index } = quantize([frame], 256);
  assert.equal(palette.length, 3);
  assert.deepEqual([...palette], [10, 20, 30]);
  const idx = index(frame);
  assert.ok([...idx].every((v) => v === 0));
});

test('quantize: a union of two frames with disjoint colors produces one palette covering both', () => {
  const w = 2, h = 2;
  const frameA = new Uint8Array(w * h * 4);
  for (let p = 0; p < w * h; p++) { frameA[p * 4] = 255; frameA[p * 4 + 1] = 0; frameA[p * 4 + 2] = 0; frameA[p * 4 + 3] = 255; }
  const frameB = new Uint8Array(w * h * 4);
  for (let p = 0; p < w * h; p++) { frameB[p * 4] = 0; frameB[p * 4 + 1] = 0; frameB[p * 4 + 2] = 255; frameB[p * 4 + 3] = 255; }
  const { palette, index } = quantize([frameA, frameB], 256);
  const n = palette.length / 3;
  assert.ok(n >= 2, 'expected the palette to cover both distinct colors');
  const idxA = index(frameA), idxB = index(frameB);
  // The two frames' pixels must map to different palette entries (disjoint colors).
  assert.notEqual(idxA[0], idxB[0]);
});

test('quantize: maxColors below the distinct-color count still returns <= maxColors entries', () => {
  const frame = gradientFrame(20, 20);
  const { palette } = quantize([frame], 16);
  assert.ok(palette.length / 3 <= 16);
});
