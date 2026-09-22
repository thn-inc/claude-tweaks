// plugin/bin/lib/gif/lzw.js — GIF-compliant LZW encoder for the walkthrough codec (#2758).
// Implements the GIF87a/89a variable-code-size LZW variant: a clear code and end-of-information
// code reserved at (1<<minCodeSize) and +1, code size starts at minCodeSize+1 and grows by one
// bit each time the table's next index would overflow the current code width, up to 12 bits,
// with a full table reset at 4096 entries. Output is packed into GIF sub-blocks: a leading
// minCodeSize byte, then each ≤255-byte run of packed bits prefixed with its own length byte,
// terminated by a zero-length block — the shape a real GIF image-data block is bit-for-bit.
//
// The mid-stream reset's clear code MUST be written at the code width still in effect just
// before the reset (up to 12 bits), never at the post-reset narrow width — the decoder is still
// reading at the old width until it decodes that specific code as a clear code, at which point
// IT ALSO narrows for what follows. Writing the clear code narrow (a bug this file shipped with
// once, caught by a whole-branch review that decoded a real corrupted GIF) desyncs the
// bitstream irrecoverably from that point on. `initTable()` below only rebuilds dictionary state
// — it writes nothing; every call site decides separately, and correctly, at what width to emit
// the clear code that precedes a table's use.
'use strict';

const MAX_CODE_BITS = 12;
const MAX_TABLE_SIZE = 1 << MAX_CODE_BITS; // 4096

// A bit writer that packs variable-width codes LSB-first (GIF's bit order) and, independently,
// packs the resulting byte stream into length-prefixed ≤255-byte GIF sub-blocks.
function makeBitWriter() {
  const bytes = [];
  let current = 0, bitCount = 0;
  return {
    writeCode(code, size) {
      for (let i = 0; i < size; i++) {
        current |= ((code >> i) & 1) << bitCount;
        bitCount++;
        if (bitCount === 8) { bytes.push(current); current = 0; bitCount = 0; }
      }
    },
    flushToSubBlocks() {
      if (bitCount > 0) bytes.push(current);
      const out = [];
      for (let i = 0; i < bytes.length; i += 255) {
        const slice = bytes.slice(i, i + 255);
        out.push(slice.length, ...slice);
      }
      out.push(0); // terminator
      return out;
    },
  };
}

function lzwEncode(indexStream, minCodeSize) {
  const clearCode = 1 << minCodeSize;
  const eoiCode = clearCode + 1;
  const writer = makeBitWriter();
  let codeSize, table, nextCode;

  // Rebuilds the dictionary/nextCode/codeSize to their post-reset state. Writes nothing — the
  // caller writes the clear code itself, at whatever width was in effect at the call site.
  const initTable = () => {
    table = new Map();
    for (let i = 0; i < clearCode; i++) table.set(String(i), i);
    nextCode = clearCode + 2;
    codeSize = minCodeSize + 1;
  };

  initTable();
  writer.writeCode(clearCode, codeSize); // initial clear code, at the starting (narrow) width
  let w = '';
  for (let i = 0; i < indexStream.length; i++) {
    const k = String(indexStream[i]);
    const wk = w === '' ? k : `${w},${k}`;
    if (table.has(wk)) {
      w = wk;
    } else {
      writer.writeCode(table.get(w), codeSize);
      table.set(wk, nextCode);
      nextCode++;
      if (nextCode > (1 << codeSize) && codeSize < MAX_CODE_BITS) codeSize++;
      if (nextCode >= MAX_TABLE_SIZE) {
        writer.writeCode(clearCode, codeSize); // emit at the CURRENT (still-wide) width first
        initTable(); // then rebuild — codeSize narrows to minCodeSize+1 for what follows
      }
      w = k;
    }
  }
  if (w !== '') writer.writeCode(table.get(w), codeSize);
  writer.writeCode(eoiCode, codeSize);

  const subBlocks = writer.flushToSubBlocks();
  return new Uint8Array([minCodeSize, ...subBlocks]);
}

module.exports = { lzwEncode };
