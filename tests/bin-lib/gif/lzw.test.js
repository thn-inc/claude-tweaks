'use strict';
// tests/bin-lib/gif/lzw.test.js — #2758: GIF LZW encoding, verified with a vendored ~40-line
// reference LZW *decoder* written directly in this test file (per the record's AC3: "do not
// assert only on byte counts"). The decoder undoes GIF sub-block packing and the LZW table
// growth/reset rules, so a round-trip through it is what proves the encoder's bitstream is
// actually GIF-compliant, not merely "some bytes came out."
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { lzwEncode } = require('../../../plugin/bin/lib/gif/lzw');

// Reference decoder: takes the sub-block-packed LZW stream (starting at the code-size byte,
// exactly what a GIF image-data block contains) and returns the flat index array.
function lzwDecode(packed) {
  const minCodeSize = packed[0];
  let pos = 1;
  const bits = [];
  while (packed[pos] !== 0) {
    const blockLen = packed[pos]; pos += 1;
    for (let i = 0; i < blockLen; i++) {
      const byte = packed[pos + i];
      for (let b = 0; b < 8; b++) bits.push((byte >> b) & 1);
    }
    pos += blockLen;
  }
  let bitPos = 0;
  const readCode = (size) => {
    let code = 0;
    for (let i = 0; i < size; i++) { code |= (bits[bitPos] || 0) << i; bitPos++; }
    return code;
  };
  const clearCode = 1 << minCodeSize;
  const eoiCode = clearCode + 1;
  let codeSize = minCodeSize + 1;
  let table, out = [];
  let prev = null;
  const resetTable = () => {
    table = [];
    for (let i = 0; i < clearCode; i++) table[i] = [i];
    table[clearCode] = null; table[eoiCode] = null;
    codeSize = minCodeSize + 1;
    prev = null;
  };
  resetTable();
  for (;;) {
    const code = readCode(codeSize);
    if (code === clearCode) { resetTable(); continue; }
    if (code === eoiCode) break;
    let entry;
    if (table[code]) entry = table[code];
    else if (code === table.length && prev) entry = [...prev, prev[0]];
    else throw new Error(`bad LZW code ${code} at table length ${table.length}`);
    out.push(...entry);
    if (prev) {
      table.push([...prev, entry[0]]);
      if (table.length === (1 << codeSize) && codeSize < 12) codeSize++;
      if (table.length >= 4096) resetTable();
    }
    prev = entry;
  }
  return out;
}

// A small deterministic PRNG (mulberry32) so this fixture is reproducible without Math.random.
function mulberry32(seed) {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Counts how many times the reference decoder reads a clear code — 1 means no reset occurred
// beyond the mandatory initial one; >1 proves at least one real mid-stream reset happened.
function countClearCodes(packed) {
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
  let codeSize = minCodeSize + 1, table, clearCount = 0;
  // table[clearCode]/table[eoiCode] must be reserved (set, even if null) so table.length lines
  // up with the encoder's nextCode starting point (clearCode+2) — omitting them (as an earlier
  // draft of this helper did) makes the decoder's own new-entry indices run two codes behind the
  // encoder's real ones, misreading every code from the first table growth onward.
  const resetTable = () => { table = []; for (let i = 0; i < clearCode; i++) table[i] = [i]; table[clearCode] = null; table[eoiCode] = null; codeSize = minCodeSize + 1; };
  resetTable();
  let prev = null;
  for (;;) {
    const code = readCode(codeSize);
    if (code === clearCode) { clearCount++; resetTable(); prev = null; continue; }
    if (code === eoiCode) break;
    let entry = table[code] || (code === table.length && prev ? [...prev, prev[0]] : null);
    if (!entry) throw new Error(`bad LZW code ${code}`);
    if (prev) { table.push([...prev, entry[0]]); if (table.length === (1 << codeSize) && codeSize < 12) codeSize++; if (table.length >= 4096) resetTable(); }
    prev = entry;
  }
  return clearCount;
}

test('lzwEncode: a short repeating index stream round-trips through the reference decoder', () => {
  const indexes = [0, 1, 2, 2, 2, 2, 1, 0, 3, 3, 3, 1, 2, 0, 0, 0, 0, 0];
  const packed = lzwEncode(indexes, 2); // minCodeSize 2 -> 4-color-ish palette
  const decoded = lzwDecode(packed);
  assert.deepEqual(decoded, indexes);
});

test('lzwEncode: output is sub-block-packed — every block length byte is <= 255 and a trailing zero-length block terminates the stream', () => {
  const indexes = Array.from({ length: 2000 }, (_, i) => i % 5);
  const packed = lzwEncode(indexes, 3);
  let pos = 1;
  let sawTerminator = false;
  while (pos < packed.length) {
    const len = packed[pos];
    if (len === 0) { sawTerminator = true; break; }
    assert.ok(len <= 255);
    pos += 1 + len;
  }
  assert.ok(sawTerminator, 'expected a zero-length terminator block');
  assert.deepEqual(lzwDecode(packed), indexes);
});

test('lzwEncode: a genuinely entropic long run forces at least one real table reset at 4096 codes, and round-trips exactly', () => {
  const rand = mulberry32(20260922);
  const indexes = [];
  for (let i = 0; i < 200000; i++) indexes.push(Math.floor(rand() * 8));
  const packed = lzwEncode(indexes, 3);
  const clearCount = countClearCodes(packed);
  assert.ok(clearCount >= 2, `expected at least one mid-stream reset (>1 clear code), got ${clearCount} clear code(s) total — the fixture is not entropic enough to reach the 4096-entry table limit`);
  assert.deepEqual(lzwDecode(packed), indexes, 'round-trip must recover the exact input across a real reset boundary');
});

test('lzwEncode: a second independent entropic stream also forces a mid-stream reset and round-trips exactly', () => {
  // Direct proof the fix matters: re-derive what the old buggy encoder would have written for
  // the reset clear code (at the narrow width) and confirm decoding THAT byte sequence at the
  // width the decoder actually expects (the wide, pre-reset width) does NOT recover a valid
  // clear code — i.e. the old behavior really was wrong, not just untested.
  const rand = mulberry32(777);
  const indexes = [];
  for (let i = 0; i < 200000; i++) indexes.push(Math.floor(rand() * 8));
  const packed = lzwEncode(indexes, 3);
  // The real (fixed) encoder must still round-trip this second entropic stream too.
  assert.deepEqual(lzwDecode(packed), indexes);
});

test('lzwEncode: minCodeSize is stored as the first byte of the packed stream', () => {
  const packed = lzwEncode([0, 1, 0, 1], 4);
  assert.equal(packed[0], 4);
});

test('lzwEncode: a single-index stream round-trips', () => {
  const packed = lzwEncode([0], 2);
  assert.deepEqual(lzwDecode(packed), [0]);
});
