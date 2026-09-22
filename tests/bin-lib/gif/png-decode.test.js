'use strict';
// tests/bin-lib/gif/png-decode.test.js — #2758: a from-scratch PNG decoder for the three color
// types the vendored codec commits to (0 grayscale, 2 RGB, 6 RGBA), 8-bit, non-interlaced. Every
// fixture is hand-built with zlib.deflateSync so the test never depends on a real screenshot.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const { decodePng, PngDecodeError } = require('../../../plugin/bin/lib/gif/png-decode');

const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function crc32(buf) {
  let c;
  const table = crc32.table || (crc32.table = (() => {
    const t = [];
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })());
  c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'latin1');
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

// Builds a minimal, valid PNG of the given color type from a raw scanline buffer (no filtering —
// filter byte 0 = None on every row, except where a test explicitly wants a filtered row).
function buildPng({ width, height, colorType, bitDepth = 8, rowsRaw, filterBytes }) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = bitDepth; ihdr[9] = colorType; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const rows = [];
  for (let y = 0; y < height; y++) {
    rows.push(Buffer.from([filterBytes ? filterBytes[y] : 0]));
    rows.push(rowsRaw[y]);
  }
  const raw = Buffer.concat(rows);
  const idat = zlib.deflateSync(raw);
  return Buffer.concat([SIG, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

test('decodePng: color type 0 (grayscale) 4x4, filter None, expands to RGBA', () => {
  const width = 4, height = 4;
  const rowsRaw = [];
  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(width);
    for (let x = 0; x < width; x++) row[x] = (y * width + x) * 16;
    rowsRaw.push(row);
  }
  const png = buildPng({ width, height, colorType: 0, rowsRaw });
  const { width: w, height: h, rgba } = decodePng(png);
  assert.equal(w, 4); assert.equal(h, 4);
  assert.equal(rgba.length, 4 * 4 * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const gray = (y * width + x) * 16;
      const i = (y * width + x) * 4;
      assert.equal(rgba[i], gray); assert.equal(rgba[i + 1], gray); assert.equal(rgba[i + 2], gray); assert.equal(rgba[i + 3], 255);
    }
  }
});

test('decodePng: color type 2 (RGB) 4x4, filter None, exact bytes', () => {
  const width = 4, height = 4;
  const rowsRaw = [];
  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(width * 3);
    for (let x = 0; x < width; x++) { row[x * 3] = x * 10; row[x * 3 + 1] = y * 10; row[x * 3 + 2] = 200; }
    rowsRaw.push(row);
  }
  const png = buildPng({ width, height, colorType: 2, rowsRaw });
  const { rgba } = decodePng(png);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      assert.equal(rgba[i], x * 10); assert.equal(rgba[i + 1], y * 10); assert.equal(rgba[i + 2], 200); assert.equal(rgba[i + 3], 255);
    }
  }
});

test('decodePng: color type 6 (RGBA) 4x4 with filter type 1 (Sub) on row 2, exact bytes', () => {
  const width = 4, height = 4;
  const rowsRaw = [];
  const filterBytes = [0, 0, 1, 0];
  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(width * 4);
    for (let x = 0; x < width; x++) { row[x * 4] = x * 5 + 1; row[x * 4 + 1] = y * 5 + 1; row[x * 4 + 2] = 50; row[x * 4 + 3] = 128; }
    if (y === 2) {
      // Sub-filter row 2 in place: filt(x) = raw(x) - raw(x - bpp), bpp = 4 for RGBA.
      const bpp = 4;
      const original = Buffer.from(row);
      for (let x = row.length - 1; x >= bpp; x--) row[x] = (original[x] - original[x - bpp]) & 0xff;
    }
    rowsRaw.push(row);
  }
  const png = buildPng({ width, height, colorType: 6, rowsRaw, filterBytes });
  const { rgba } = decodePng(png);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      assert.equal(rgba[i], x * 5 + 1); assert.equal(rgba[i + 1], y * 5 + 1); assert.equal(rgba[i + 2], 50); assert.equal(rgba[i + 3], 128);
    }
  }
});

test('decodePng: color type 3 (palette) throws PngDecodeError naming "palette"', () => {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(2, 0); ihdr.writeUInt32BE(2, 4);
  ihdr[8] = 8; ihdr[9] = 3; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const idat = zlib.deflateSync(Buffer.from([0, 0, 0, 0, 0]));
  const png = Buffer.concat([SIG, chunk('IHDR', ihdr), chunk('PLTE', Buffer.alloc(3)), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
  assert.throws(() => decodePng(png), (err) => err instanceof PngDecodeError && /palette/i.test(err.message));
});

test('decodePng: interlaced input throws PngDecodeError naming "interlace"', () => {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(2, 0); ihdr.writeUInt32BE(2, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 1;
  const idat = zlib.deflateSync(Buffer.alloc(1));
  const png = Buffer.concat([SIG, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
  assert.throws(() => decodePng(png), (err) => err instanceof PngDecodeError && /interlace/i.test(err.message));
});

test('decodePng: 16-bit depth throws PngDecodeError naming "16-bit" or "bit depth"', () => {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0); ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 16; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const idat = zlib.deflateSync(Buffer.alloc(7));
  const png = Buffer.concat([SIG, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
  assert.throws(() => decodePng(png), (err) => err instanceof PngDecodeError && /16-bit|bit depth/i.test(err.message));
});

test('decodePng: bad signature throws PngDecodeError', () => {
  assert.throws(() => decodePng(Buffer.from('not a png')), (err) => err instanceof PngDecodeError);
});

test('decodePng: IDAT that inflates to fewer bytes than IHDR promises throws PngDecodeError naming "truncated"', () => {
  const width = 4, height = 4; // color type 2 (RGB): expects height * (width*3 + 1) = 4 * 13 = 52 bytes
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const shortRaw = Buffer.alloc(10); // far fewer than the 52 bytes the header promises
  const idat = zlib.deflateSync(shortRaw);
  const png = Buffer.concat([SIG, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
  assert.throws(() => decodePng(png), (err) => err instanceof PngDecodeError && /truncated/i.test(err.message));
});

test('decodePng: filter types 2 (Up), 3 (Average), 4 (Paeth) each round-trip on a 3x3 RGB fixture', () => {
  const width = 3, height = 3;
  // Build the unfiltered target first, then derive each filtered row from it by hand so the
  // decoder's un-filter math is what round-trips it back to these exact bytes.
  const target = [];
  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(width * 3);
    for (let x = 0; x < width; x++) { row[x * 3] = x * 30 + y; row[x * 3 + 1] = 100; row[x * 3 + 2] = 200 - y * 10; }
    target.push(row);
  }
  const bpp = 3;
  const filterBytes = [0, 2, 3]; // row0 None, row1 Up, row2 Average (Paeth covered by a second run below)
  const rowsRaw = target.map((row, y) => {
    if (y === 0) return Buffer.from(row);
    const prev = target[y - 1];
    const out = Buffer.from(row);
    if (filterBytes[y] === 2) { // Up: filt(x) = raw(x) - prior(x)
      for (let x = 0; x < row.length; x++) out[x] = (row[x] - prev[x]) & 0xff;
    } else if (filterBytes[y] === 3) { // Average: filt(x) = raw(x) - floor((left + up) / 2)
      for (let x = 0; x < row.length; x++) {
        const left = x >= bpp ? row[x - bpp] : 0;
        out[x] = (row[x] - Math.floor((left + prev[x]) / 2)) & 0xff;
      }
    }
    return out;
  });
  const png = buildPng({ width, height, colorType: 2, rowsRaw, filterBytes });
  const { rgba } = decodePng(png);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4;
    assert.equal(rgba[i], target[y][x * 3]); assert.equal(rgba[i + 1], target[y][x * 3 + 1]); assert.equal(rgba[i + 2], target[y][x * 3 + 2]);
  }

  // Paeth (filter 4) on its own 2-row fixture, since Paeth needs both a left and an up neighbor
  // to exercise its predictor selection meaningfully.
  const t2 = [Buffer.from([10, 20, 30, 40, 50, 60]), Buffer.from([15, 25, 35, 45, 55, 65])];
  const paethPredict = (a, b, c) => { const p = a + b - c; const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; };
  const row1 = Buffer.from(t2[1]);
  for (let x = 0; x < row1.length; x++) {
    const left = x >= bpp ? t2[1][x - bpp] : 0, up = t2[0][x], upLeft = x >= bpp ? t2[0][x - bpp] : 0;
    row1[x] = (t2[1][x] - paethPredict(left, up, upLeft)) & 0xff;
  }
  const png2 = buildPng({ width: 2, height: 2, colorType: 2, rowsRaw: [Buffer.from(t2[0]), row1], filterBytes: [0, 4] });
  const { rgba: rgba2 } = decodePng(png2);
  for (let x = 0; x < 2; x++) {
    // Row 1's pixels sit after row 0's 2 pixels in the flattened RGBA buffer — offset by
    // `width` pixels, not `x` alone (a bug in this fixture's original indexing).
    const i1 = (2 + x) * 4;
    assert.equal(rgba2[i1], t2[1][x * 3]); assert.equal(rgba2[i1 + 1], t2[1][x * 3 + 1]); assert.equal(rgba2[i1 + 2], t2[1][x * 3 + 2]);
  }
});
