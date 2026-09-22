// plugin/bin/lib/gif/palette.js — median-cut color quantization for the walkthrough GIF codec
// (#2758). One global palette over the union of every frame (never per-frame — per-frame
// palettes cause cross-frame flicker on identical backgrounds and cost 768 bytes per frame,
// per the record's own Gotchas). Deterministic: median-cut on a fixed color-collection order,
// no randomness, so the same input always produces the same palette and indices.
'use strict';

// Collects every RGB triplet across all frames, in frame/pixel order (alpha ignored — GIF has
// no alpha channel; this module never sees per-pixel transparency).
function collectColors(rgbaFrames) {
  const colors = [];
  for (const frame of rgbaFrames) {
    for (let p = 0; p < frame.length; p += 4) colors.push([frame[p], frame[p + 1], frame[p + 2]]);
  }
  return colors;
}

// Median-cut: recursively split the widest-range color bucket at its channel median until
// `maxColors` buckets exist (or every bucket has one color left). Each bucket's representative
// is its own average — deterministic given a deterministic split order (always split the
// currently-widest bucket by its own widest channel, ties broken by bucket index).
function medianCut(colors, maxColors) {
  if (colors.length === 0) return [[0, 0, 0]];
  let buckets = [colors];
  while (buckets.length < maxColors) {
    let widestIdx = -1, widestRange = -1, widestChannel = 0;
    for (let b = 0; b < buckets.length; b++) {
      if (buckets[b].length <= 1) continue;
      for (let ch = 0; ch < 3; ch++) {
        let min = 255, max = 0;
        for (const c of buckets[b]) { if (c[ch] < min) min = c[ch]; if (c[ch] > max) max = c[ch]; }
        const range = max - min;
        if (range > widestRange) { widestRange = range; widestIdx = b; widestChannel = ch; }
      }
    }
    if (widestIdx === -1 || widestRange === 0) break; // nothing left worth splitting
    const bucket = buckets[widestIdx];
    const sorted = [...bucket].sort((a, b) => a[widestChannel] - b[widestChannel]);
    const mid = Math.floor(sorted.length / 2);
    const left = sorted.slice(0, mid);
    const right = sorted.slice(mid);
    buckets.splice(widestIdx, 1, left, right);
  }
  return buckets.map((bucket) => {
    let r = 0, g = 0, b = 0;
    for (const c of bucket) { r += c[0]; g += c[1]; b += c[2]; }
    const n = bucket.length;
    return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
  });
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
  const colors = collectColors(rgbaFrames);
  const paletteTriplets = medianCut(colors, maxColors);
  const palette = new Uint8Array(paletteTriplets.length * 3);
  paletteTriplets.forEach(([r, g, b], i) => { palette[i * 3] = r; palette[i * 3 + 1] = g; palette[i * 3 + 2] = b; });

  const index = (frameRgba) => {
    const out = new Uint8Array(frameRgba.length / 4);
    for (let p = 0; p < out.length; p++) {
      out[p] = nearestIndex(paletteTriplets, frameRgba[p * 4], frameRgba[p * 4 + 1], frameRgba[p * 4 + 2]);
    }
    return out;
  };

  return { palette, index };
}

module.exports = { quantize };
