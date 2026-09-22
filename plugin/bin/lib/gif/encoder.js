// plugin/bin/lib/gif/encoder.js — GIF89a container writer for the walkthrough codec (#2758).
// Takes already-palette-mapped frames (Task 2's quantize().index() output) and Task 3's LZW
// encoder and assembles a complete animated GIF: header, logical screen descriptor, one global
// color table (one palette for the whole animation — never per-frame, per the record's own
// Gotchas), a NETSCAPE2.0 loop extension, then per frame a graphic control extension + image
// descriptor + LZW image data, and a trailer.
'use strict';

const { lzwEncode } = require('./lzw');

function nextPow2(n) {
  let p = 1;
  while (p < n) p *= 2;
  return Math.max(p, 2); // GIF color table size is always >= 2 entries
}

function le16(n) { return [n & 0xff, (n >> 8) & 0xff]; }

function encodeGif({ width, height, frames, palette, loop = 0 }) {
  const paletteSize = palette.length / 3;
  const tableSize = nextPow2(paletteSize);
  const colorBits = Math.log2(tableSize); // e.g. 256 -> 8, 3 -> 2 (after rounding to pow2 4)
  const paddedPalette = Buffer.alloc(tableSize * 3);
  Buffer.from(palette).copy(paddedPalette, 0, 0, palette.length);

  const parts = [];

  // Header
  parts.push(Buffer.from('GIF89a', 'ascii'));

  // Logical Screen Descriptor: width(2) height(2) packed(1) bgColorIndex(1) pixelAspect(1)
  const gctFlag = 1;
  const colorRes = colorBits - 1; // spec: color resolution bits stored as (bits - 1)
  const packedLsd = (gctFlag << 7) | (colorRes << 4) | (0 << 3) | (colorBits - 1);
  parts.push(Buffer.from([...le16(width), ...le16(height), packedLsd, 0, 0]));

  // Global Color Table
  parts.push(paddedPalette);

  // NETSCAPE2.0 application extension (looping)
  parts.push(Buffer.from([
    0x21, 0xff, 0x0b,
    ...Buffer.from('NETSCAPE2.0', 'ascii'),
    0x03, 0x01, ...le16(loop), 0x00,
  ]));

  const minCodeSize = Math.max(2, Math.ceil(Math.log2(Math.max(paletteSize, 2))));

  for (const frame of frames) {
    // Graphic Control Extension: 0x21 0xF9 blockSize(1)=4 packed(1) delay(2) transparentIdx(1) terminator(0)
    const packedGce = 0; // no transparency, no disposal method specified
    parts.push(Buffer.from([0x21, 0xf9, 0x04, packedGce, ...le16(frame.delayCs & 0xffff), 0x00, 0x00]));

    // Image Descriptor: 0x2C left(2) top(2) width(2) height(2) packed(1)
    parts.push(Buffer.from([0x2c, ...le16(0), ...le16(0), ...le16(width), ...le16(height), 0x00]));

    // Image Data: LZW-encoded, already sub-block-packed and minCodeSize-prefixed by lzwEncode.
    parts.push(Buffer.from(lzwEncode(frame.indexes, minCodeSize)));
  }

  parts.push(Buffer.from([0x3b])); // trailer

  return Buffer.concat(parts);
}

module.exports = { encodeGif };
