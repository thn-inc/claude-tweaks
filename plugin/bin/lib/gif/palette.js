// plugin/bin/lib/gif/palette.js — median-cut color quantization for the walkthrough GIF codec
// (#2758). One global palette over the union of every frame's DISTINCT colors, weighted by
// pixel count (never per-frame palettes — per-frame palettes cause cross-frame flicker and cost
// 768 bytes per frame). Collecting distinct colors first — a real 1280x720 screenshot has ~900K
// pixels but typically a few thousand distinct colors — and caching nearest-index lookups by
// distinct color, is what makes this tractable at the resolution the skill actually ships at.
// A whole-branch review measured the original naive per-pixel version (one [r,g,b] array
// allocated per pixel, an O(256) linear nearest-color scan per pixel) at ~224s and ~900MB RSS
// for one 8-frame 1280x720 walkthrough; this rewrite replaces both hot paths.
'use strict';

function packRgb(r, g, b) {
  return (r << 16) | (g << 8) | b;
}

// rgbaFrames -> { colors: [[r,g,b],...] (unique, first-seen order), counts: [n,...] (parallel
// pixel-count per unique color) }. Alpha is ignored — GIF has no alpha channel.
function collectDistinctColors(rgbaFrames) {
  const byPacked = new Map();
  const colors = [];
  const counts = [];
  for (const frame of rgbaFrames) {
    for (let p = 0; p < frame.length; p += 4) {
      const key = packRgb(frame[p], frame[p + 1], frame[p + 2]);
      let idx = byPacked.get(key);
      if (idx === undefined) {
        idx = colors.length;
        byPacked.set(key, idx);
        colors.push([frame[p], frame[p + 1], frame[p + 2]]);
        counts.push(0);
      }
      counts[idx]++;
    }
  }
  return { colors, counts };
}

// Median-cut over DISTINCT colors, each carrying a pixel-frequency weight. Recursively split the
// widest-range bucket (range measured over member colors; bucket average weighted by pixel
// count) by its own widest channel, at the unweighted color median, until maxColors buckets
// exist or every bucket is a single distinct color. Deterministic: fixed color-collection order
// (frame order, then pixel order), fixed split-selection order (widest bucket then widest
// channel, ties broken by ascending index), no randomness.
function medianCut(colors, counts, maxColors) {
  if (colors.length === 0) return [[0, 0, 0]];
  const buckets = [colors.map((c, i) => ({ color: c, count: counts[i] }))];
  while (buckets.length < maxColors) {
    let widestIdx = -1, widestRange = -1, widestChannel = 0;
    for (let b = 0; b < buckets.length; b++) {
      if (buckets[b].length <= 1) continue;
      for (let ch = 0; ch < 3; ch++) {
        let min = 255, max = 0;
        for (const entry of buckets[b]) { const v = entry.color[ch]; if (v < min) min = v; if (v > max) max = v; }
        const range = max - min;
        if (range > widestRange) { widestRange = range; widestIdx = b; widestChannel = ch; }
      }
    }
    if (widestIdx === -1 || widestRange === 0) break; // nothing left worth splitting
    const bucket = buckets[widestIdx];
    const sorted = [...bucket].sort((a, b) => a.color[widestChannel] - b.color[widestChannel]);
    const mid = Math.floor(sorted.length / 2);
    const left = sorted.slice(0, mid);
    const right = sorted.slice(mid);
    buckets.splice(widestIdx, 1, left, right);
  }
  return buckets.map((bucket) => {
    let r = 0, g = 0, b = 0, totalWeight = 0;
    for (const entry of bucket) {
      const w = entry.count;
      r += entry.color[0] * w; g += entry.color[1] * w; b += entry.color[2] * w;
      totalWeight += w;
    }
    return [Math.round(r / totalWeight), Math.round(g / totalWeight), Math.round(b / totalWeight)];
  });
}

// medianCut's widest-bucket scan re-examines every member of every bucket on each of up to
// maxColors split iterations (O(distinctColors * maxColors)), and a split's sort/copy cost on a
// degenerate (lopsided) bucket partition can approach the same bound again — both scale with
// DISTINCT colour count, not pixel count, so an ordinary UI screenshot (low thousands to tens of
// thousands of distinct colours) stays fast but a photo-, map-, or video-heavy walkthrough frame
// can carry hundreds of thousands to low millions of distinct colours and blow past any wall-clock
// budget. Pre-bucketing coarsens the distinct-colour set into a fixed-size grid of count-weighted
// centroids before medianCut ever sees it once that count crosses PRE_BUCKET_THRESHOLD, bounding
// medianCut's own input size — and therefore its time and memory — independent of how many
// distinct colours (or pixels) the source frames actually contain. Below the threshold this is a
// no-op: medianCut still runs on the exact distinct-colour set, so real screenshots are unaffected.
const PRE_BUCKET_THRESHOLD = 150000; // distinct colours above this trigger coarsening — comfortably
// above the "low thousands to tens of thousands" real-screenshot fast band, comfortably below the
// ~260k+ adversarial range measured in #2769
const PRE_BUCKET_BITS = 5; // bits retained per channel -> 32 levels/channel -> at most 32768 buckets

function preBucketColors(colors, counts) {
  const shift = 8 - PRE_BUCKET_BITS;
  const byBucket = new Map();
  const bucketColors = [];
  const bucketCounts = [];
  const sums = []; // parallel to bucketColors/bucketCounts — [rSum, gSum, bSum], weighted by count
  for (let i = 0; i < colors.length; i++) {
    const [r, g, b] = colors[i];
    const key = ((r >> shift) << (PRE_BUCKET_BITS * 2)) | ((g >> shift) << PRE_BUCKET_BITS) | (b >> shift);
    const w = counts[i];
    let idx = byBucket.get(key);
    if (idx === undefined) {
      idx = bucketColors.length;
      byBucket.set(key, idx);
      bucketColors.push([0, 0, 0]);
      bucketCounts.push(0);
      sums.push([0, 0, 0]);
    }
    const sum = sums[idx];
    sum[0] += r * w; sum[1] += g * w; sum[2] += b * w;
    bucketCounts[idx] += w;
  }
  for (let i = 0; i < bucketColors.length; i++) {
    const w = bucketCounts[i];
    const sum = sums[i];
    const color = bucketColors[i];
    color[0] = Math.round(sum[0] / w);
    color[1] = Math.round(sum[1] / w);
    color[2] = Math.round(sum[2] / w);
  }
  return { colors: bucketColors, counts: bucketCounts };
}

function nearestIndex(palette, r, g, b) {
  let best = 0, bestDist = Infinity;
  for (let i = 0; i < palette.length; i++) {
    const [pr, pg, pb] = palette[i];
    const dr = pr - r, dg = pg - g, db = pb - b;
    const dist = dr * dr + dg * dg + db * db;
    if (dist < bestDist) { bestDist = dist; best = i; }
  }
  return best;
}

function quantize(rgbaFrames, maxColors = 256) {
  const { colors, counts } = collectDistinctColors(rgbaFrames);
  const bounded = colors.length > PRE_BUCKET_THRESHOLD ? preBucketColors(colors, counts) : { colors, counts };
  const paletteTriplets = medianCut(bounded.colors, bounded.counts, maxColors);
  const palette = new Uint8Array(paletteTriplets.length * 3);
  paletteTriplets.forEach(([r, g, b], i) => { palette[i * 3] = r; palette[i * 3 + 1] = g; palette[i * 3 + 2] = b; });

  // Cache nearestIndex per distinct input color (packed the same way collectDistinctColors
  // does) so a frame's O(pixels) mapping performs only O(distinct colors) real distance
  // computations — the same locality real screenshots exhibit that makes collection above fast.
  const nearestCache = new Map();
  const index = (frameRgba) => {
    const out = new Uint8Array(frameRgba.length / 4);
    for (let p = 0; p < out.length; p++) {
      const r = frameRgba[p * 4], g = frameRgba[p * 4 + 1], b = frameRgba[p * 4 + 2];
      const key = packRgb(r, g, b);
      let idx = nearestCache.get(key);
      if (idx === undefined) {
        idx = nearestIndex(paletteTriplets, r, g, b);
        nearestCache.set(key, idx);
      }
      out[p] = idx;
    }
    return out;
  };

  return { palette, index };
}

module.exports = { quantize };
