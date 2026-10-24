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

test('quantize: a large, high-color-count frame (mimicking a real screenshot) quantizes to a <= 256-color palette and indexes every pixel', () => {
  const w = 400, h = 300; // smaller than a real 1280x720 frame but still ~120K pixels / continuous-gradient distinct colors, enough to prove the histogram+cache approach scales
  const frame = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    frame[i] = (x * 3) % 256; frame[i + 1] = (y * 5) % 256; frame[i + 2] = (x + y) % 256; frame[i + 3] = 255;
  }
  const { palette, index } = quantize([frame], 256);
  const idx = index(frame);
  assert.ok(palette.length / 3 <= 256);
  assert.equal(idx.length, w * h);
});

// #2769: the fixture above (400x300, 65,536 distinct colours) sits entirely in the fast band —
// it can never exercise the slow-band pathology, since medianCut's cost scales with DISTINCT
// colour count, not pixel count. This fixture produces a high-entropy, high-distinct-colour-count
// 8-frame 1280x720 walkthrough (gradient + bounded per-pixel noise on two channels) — the same
// shape of adversarial input (photo/map/video-heavy content) #2769 reports (deterministic across
// runs: ~982,011 distinct colours, well above PRE_BUCKET_THRESHOLD). Proven red against the
// pre-fix quantizer (~6.2s / ~278MB RSS, over this test's budget) before the colour-count-bounded
// path (`preBucketColors`, palette.js) landed.
function gradientNoiseFrame(w, h, seed, noiseAmp) {
  const rgba = new Uint8Array(w * h * 4);
  let s = seed;
  function rnd(n) { s = (s * 1103515245 + 12345) & 0x7fffffff; return s % n; }
  function withNoise(base) { return Math.min(255, Math.max(0, base + rnd(noiseAmp) - (noiseAmp >> 1))); }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    rgba[i] = withNoise(Math.floor((x / w) * 255));
    rgba[i + 1] = withNoise(Math.floor((y / h) * 255));
    rgba[i + 2] = (x * 7 + y * 13) % 256;
    rgba[i + 3] = 255;
  }
  return rgba;
}

test('quantize: an adversarial high-distinct-colour-count 8-frame 1280x720 walkthrough stays bounded (#2769)', () => {
  const w = 1280, h = 720, frameCount = 8, noiseAmp = 4;
  const rgbaFrames = [];
  for (let f = 0; f < frameCount; f++) rgbaFrames.push(gradientNoiseFrame(w, h, f * 999331 + 1, noiseAmp));

  // Sanity-check the fixture itself actually lands in the slow band this test targets, so a
  // future change to the fixture's own generator can't silently stop exercising it.
  const collectDistinct = () => {
    const set = new Set();
    for (const frame of rgbaFrames) {
      for (let p = 0; p < frame.length; p += 4) set.add((frame[p] << 16) | (frame[p + 1] << 8) | frame[p + 2]);
    }
    return set;
  };
  const distinctCount = collectDistinct().size;
  assert.ok(distinctCount > 150000, `expected fixture to exceed the pre-bucket threshold, got ${distinctCount} distinct colours`);

  // Timing (#3246/#3176): an absolute wall-clock bound flaked at 5-8.7s under concurrent CPU load
  // (sibling `npm test` runs), so the bound is load-relative. Each attempt times quantize against a
  // same-input full-pixel distinct-colour pass (collectDistinct above) — the unavoidable
  // collectDistinctColors work — so CPU contention scales both sides alike, while a missing
  // pre-bucket step (#2769) adds an unbounded medianCut on top of that collection cost. Measured
  // quantize/baseline: ~1.3-2.2 with the fix (idle and with 16 CPU burners on 12 cores; 3.4 once
  // against a cold baseline, 9.5 once from a transient spike that the next attempt cleared),
  // 6.8-36 with pre-bucketing reverted; MAX_RATIO sits between. Load can shift between the two
  // timings, so the check passes if any of MAX_ATTEMPTS paired measurements is within the ratio —
  // a real regression is slow in every attempt, a load spike is not.
  const MAX_RATIO = 4, MAX_ATTEMPTS = 3;
  const ms = (since) => Number(process.hrtime.bigint() - since) / 1e6;
  let result, best = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    let t = process.hrtime.bigint();
    collectDistinct();
    const baselineMs = ms(t);
    t = process.hrtime.bigint();
    result = quantize(rgbaFrames, 256);
    const elapsedMs = ms(t);
    if (best === null || elapsedMs / baselineMs < best.elapsedMs / best.baselineMs) best = { baselineMs, elapsedMs };
    if (elapsedMs < MAX_RATIO * baselineMs) break;
  }
  const { palette, index } = result;
  assert.ok(palette.length / 3 <= 256);
  const idx = index(rgbaFrames[0]);
  assert.equal(idx.length, w * h);
  assert.ok(
    best.elapsedMs < MAX_RATIO * best.baselineMs,
    `expected quantize on an adversarial ${w}x${h}x${frameCount}-frame walkthrough (${distinctCount} distinct colours) to stay within ${MAX_RATIO}x the same-input distinct-colour collection pass (bounded, regardless of distinct-colour count) in at least one of ${MAX_ATTEMPTS} attempts; best attempt: ${best.elapsedMs.toFixed(0)}ms vs ${best.baselineMs.toFixed(0)}ms baseline (${(best.elapsedMs / best.baselineMs).toFixed(2)}x)`
  );
});
