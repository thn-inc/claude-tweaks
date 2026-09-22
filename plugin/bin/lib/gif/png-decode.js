// plugin/bin/lib/gif/png-decode.js — from-scratch PNG decoder for the walkthrough codec (#2758).
// Handles 8-bit, non-interlaced grayscale (0), RGB (2), and RGBA (6) — the three color types the
// vendored GIF codec commits to regardless of what any one live probe observes (Task 0's live
// probe on this record found color type 2, RGB — not the RGBA the record originally guessed).
// Always returns RGBA: grayscale and RGB inputs are expanded so every downstream consumer
// (palette.js, encoder.js) sees one uniform shape.
'use strict';

const zlib = require('zlib');

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const CHANNELS = { 0: 1, 2: 3, 6: 4 }; // grayscale, RGB, RGBA — bytes per pixel at 8-bit

class PngDecodeError extends Error {
  constructor(message) { super(message); this.name = 'PngDecodeError'; }
}

function readChunks(buf) {
  const chunks = [];
  let off = 8;
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('latin1', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    chunks.push({ type, data });
    off += 12 + len; // length(4) + type(4) + data(len) + crc(4)
  }
  return chunks;
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

// Un-filters `raw` (concatenated scanlines, each prefixed with its own filter-type byte) into
// one flat buffer of `height` rows of `width * bpp` bytes, per the PNG spec's five filter types.
function unfilter(raw, width, height, bpp) {
  const stride = width * bpp;
  const out = Buffer.alloc(stride * height);
  let src = 0;
  for (let y = 0; y < height; y++) {
    const filterType = raw[src]; src += 1;
    const rowStart = y * stride;
    const prevRowStart = (y - 1) * stride;
    for (let x = 0; x < stride; x++) {
      const rawByte = raw[src + x];
      const left = x >= bpp ? out[rowStart + x - bpp] : 0;
      const up = y > 0 ? out[prevRowStart + x] : 0;
      const upLeft = y > 0 && x >= bpp ? out[prevRowStart + x - bpp] : 0;
      let value;
      switch (filterType) {
        case 0: value = rawByte; break; // None
        case 1: value = rawByte + left; break; // Sub
        case 2: value = rawByte + up; break; // Up
        case 3: value = rawByte + Math.floor((left + up) / 2); break; // Average
        case 4: value = rawByte + paeth(left, up, upLeft); break; // Paeth
        default: throw new PngDecodeError(`unsupported filter type ${filterType} at row ${y}`);
      }
      out[rowStart + x] = value & 0xff;
    }
    src += stride;
  }
  return out;
}

// unfiltered (width*height*bpp bytes) -> RGBA (width*height*4 bytes), colorType 0/2/6 only.
function expandToRgba(unfiltered, width, height, colorType) {
  const rgba = new Uint8Array(width * height * 4);
  const bpp = CHANNELS[colorType];
  for (let p = 0; p < width * height; p++) {
    const si = p * bpp, di = p * 4;
    if (colorType === 0) {
      const g = unfiltered[si];
      rgba[di] = g; rgba[di + 1] = g; rgba[di + 2] = g; rgba[di + 3] = 255;
    } else if (colorType === 2) {
      rgba[di] = unfiltered[si]; rgba[di + 1] = unfiltered[si + 1]; rgba[di + 2] = unfiltered[si + 2]; rgba[di + 3] = 255;
    } else { // 6
      rgba[di] = unfiltered[si]; rgba[di + 1] = unfiltered[si + 1]; rgba[di + 2] = unfiltered[si + 2]; rgba[di + 3] = unfiltered[si + 3];
    }
  }
  return rgba;
}

function decodePng(buffer) {
  if (buffer.length < 8 || !buffer.subarray(0, 8).equals(SIGNATURE)) {
    throw new PngDecodeError('not a PNG file (bad signature)');
  }
  const chunks = readChunks(buffer);
  const ihdrChunk = chunks.find((c) => c.type === 'IHDR');
  if (!ihdrChunk) throw new PngDecodeError('missing IHDR chunk');
  const ihdr = ihdrChunk.data;
  const width = ihdr.readUInt32BE(0);
  const height = ihdr.readUInt32BE(4);
  const bitDepth = ihdr[8];
  const colorType = ihdr[9];
  const interlace = ihdr[12];

  if (interlace !== 0) throw new PngDecodeError('interlaced PNGs are not supported');
  if (bitDepth !== 8) throw new PngDecodeError(`unsupported bit depth ${bitDepth} — only 8-bit is supported (16-bit not implemented)`);
  if (colorType === 3) throw new PngDecodeError('palette (color type 3) PNGs are not supported');
  if (!(colorType in CHANNELS)) throw new PngDecodeError(`unsupported color type ${colorType}`);

  const idat = Buffer.concat(chunks.filter((c) => c.type === 'IDAT').map((c) => c.data));
  const raw = zlib.inflateSync(idat);
  const bpp = CHANNELS[colorType];
  const unfiltered = unfilter(raw, width, height, bpp);
  const rgba = expandToRgba(unfiltered, width, height, colorType);
  return { width, height, rgba };
}

module.exports = { decodePng, PngDecodeError };
