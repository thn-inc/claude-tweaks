'use strict';
// tests/bin-lib/gif/encoder.test.js — #2758: GIF89a structure and a full round-trip through the
// same reference LZW decoder lzw.test.js ships, so this proves real frames recover, not just
// that the container bytes look right.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { encodeGif } = require('../../../plugin/bin/lib/gif/encoder');

// The identical reference LZW decoder from lzw.test.js (duplicated here deliberately — this
// file's fixture is a full GIF stream, not a bare LZW block, so it needs its own block-boundary
// walk to find each frame's image data before decoding it).
function lzwDecode(packed) {
  const minCodeSize = packed[0];
  let pos = 1;
  const bits = [];
  while (packed[pos] !== 0) {
    const blockLen = packed[pos]; pos += 1;
    for (let i = 0; i < blockLen; i++) { const byte = packed[pos + i]; for (let b = 0; b < 8; b++) bits.push((byte >> b) & 1); }
    pos += blockLen;
  }
  let bitPos = 0;
  const readCode = (size) => { let code = 0; for (let i = 0; i < size; i++) { code |= (bits[bitPos] || 0) << i; bitPos++; } return code; };
  const clearCode = 1 << minCodeSize, eoiCode = clearCode + 1;
  let codeSize = minCodeSize + 1, table, out = [], prev = null;
  const resetTable = () => { table = []; for (let i = 0; i < clearCode; i++) table[i] = [i]; table[clearCode] = null; table[eoiCode] = null; codeSize = minCodeSize + 1; prev = null; };
  resetTable();
  for (;;) {
    const code = readCode(codeSize);
    if (code === clearCode) { resetTable(); continue; }
    if (code === eoiCode) break;
    let entry = table[code] || (code === table.length && prev ? [...prev, prev[0]] : null);
    if (!entry) throw new Error(`bad LZW code ${code}`);
    out.push(...entry);
    if (prev) { table.push([...prev, entry[0]]); if (table.length === (1 << codeSize) && codeSize < 12) codeSize++; if (table.length >= 4096) resetTable(); }
    prev = entry;
  }
  return out;
}

test('encodeGif: starts with GIF89a, contains NETSCAPE2.0, one image descriptor per frame', () => {
  const width = 3, height = 2, n = width * height;
  const palette = new Uint8Array([255, 0, 0, 0, 255, 0, 0, 0, 255]); // 3 colors
  const frames = [
    { indexes: new Uint8Array(n).fill(0), delayCs: 50 },
    { indexes: new Uint8Array(n).fill(1), delayCs: 50 },
    { indexes: new Uint8Array(n).fill(2), delayCs: 200 },
  ];
  const buf = encodeGif({ width, height, frames, palette, loop: 0 });
  assert.equal(buf.subarray(0, 6).toString('ascii'), 'GIF89a');
  assert.ok(buf.includes(Buffer.from('NETSCAPE2.0', 'ascii')));
  // Scan only after the global color table: a raw whole-buffer scan for 0x2c can coincidentally
  // match an LZW payload byte, over- or under-counting image descriptors (mirrors the round-trip
  // test's own gctEnd calculation below).
  const gctEnd = 6 + 7 + palette.length;
  const tail = buf.subarray(gctEnd);
  let imageDescriptors = 0;
  for (let i = 0; i < tail.length; i++) if (tail[i] === 0x2c) imageDescriptors++;
  assert.equal(imageDescriptors, 3);
  assert.equal(buf[buf.length - 1], 0x3b); // trailer
});

test('encodeGif: each frame round-trips through the reference LZW decoder to its original indexes', () => {
  const width = 4, height = 4, n = width * height;
  const palette = new Uint8Array(256 * 3);
  for (let i = 0; i < 256; i++) { palette[i * 3] = i; palette[i * 3 + 1] = 255 - i; palette[i * 3 + 2] = (i * 3) % 256; }
  const frameAIdx = new Uint8Array(n); for (let i = 0; i < n; i++) frameAIdx[i] = i % 200;
  const frameBIdx = new Uint8Array(n).fill(7);
  const frames = [{ indexes: frameAIdx, delayCs: 100 }, { indexes: frameBIdx, delayCs: 400 }];
  const buf = encodeGif({ width, height, frames, palette, loop: 0 });

  // Walk image descriptors (0x2c) and decode each frame's LZW block that follows. Start the scan
  // after the global color table: this fixture's palette is a full 0..255 ramp, so palette entry
  // 44's R channel byte is literally 0x2c (44) — scanning raw bytes from offset 0 would match that
  // GCT byte as a false image descriptor before the real one at header(6)+LSD(7)+GCT(palette.length).
  const decodedFrames = [];
  const gctEnd = 6 + 7 + palette.length;
  for (let i = gctEnd; i < buf.length; i++) {
    if (buf[i] !== 0x2c) continue;
    // Image descriptor: 1 (marker) + 4 (left,top) + 4 (width,height) + 1 (packed) = 10 bytes.
    const lzwStart = i + 10;
    decodedFrames.push(lzwDecode(buf.subarray(lzwStart)));
    if (decodedFrames.length === frames.length) break;
  }
  assert.deepEqual(decodedFrames[0], [...frameAIdx]);
  assert.deepEqual(decodedFrames[1], [...frameBIdx]);
});

test('encodeGif: graphic control extension carries each frame\'s own delayCs (little-endian, 2 bytes)', () => {
  const width = 2, height = 2, n = 4;
  const palette = new Uint8Array([0, 0, 0, 255, 255, 255]);
  const frames = [{ indexes: new Uint8Array(n).fill(0), delayCs: 12345 % 65536 }, { indexes: new Uint8Array(n).fill(1), delayCs: 77 }];
  const buf = encodeGif({ width, height, frames, palette });
  // Graphic control extension: 0x21 0xF9 0x04 <packed> <delayLo> <delayHi> <transparent> 0x00
  const delays = [];
  for (let i = 0; i < buf.length - 1; i++) {
    if (buf[i] === 0x21 && buf[i + 1] === 0xf9) delays.push(buf[i + 4] | (buf[i + 5] << 8));
  }
  assert.deepEqual(delays, [12345 % 65536, 77]);
});

test('encodeGif: a frame whose indexes array length does not match width*height throws', () => {
  const palette = new Uint8Array([1, 2, 3, 4, 5, 6]);
  assert.throws(
    () => encodeGif({ width: 3, height: 2, frames: [{ indexes: new Uint8Array(4), delayCs: 10 }], palette }),
    /frame index array length 4 does not match width\*height 6/,
  );
});

test('encodeGif: logical screen descriptor carries the given width/height (little-endian)', () => {
  const palette = new Uint8Array([1, 2, 3]);
  const buf = encodeGif({ width: 300, height: 150, frames: [{ indexes: new Uint8Array(300 * 150), delayCs: 10 }], palette });
  const w = buf[6] | (buf[7] << 8);
  const h = buf[8] | (buf[9] << 8);
  assert.equal(w, 300); assert.equal(h, 150);
});
