'use strict';
// tests/bin-lib/walkthrough/encode.test.js — #2758: frame delay planning, dimension-mismatch
// detection, downscale, budget enforcement, and caption rendering.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const {
  planFrames, encodeWalkthrough, captionList, FrameMismatchError, BudgetExceededError,
} = require('../../../plugin/bin/lib/walkthrough/encode');

// Minimal valid PNG builder (color type 2, RGB, uncompressed rows, filter None) — enough to
// exercise encodeWalkthrough's full decode->downscale->quantize->encode pipeline without a real
// screenshot.
function crc32(buf) {
  let c; const table = crc32.table || (crc32.table = (() => { const t = []; for (let n = 0; n < 256; n++) { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })());
  c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'latin1');
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}
function buildPng(width, height, colorFn) {
  const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const rows = [];
  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(width * 3 + 1); // +1 filter byte
    for (let x = 0; x < width; x++) { const [r, g, b] = colorFn(x, y); row[1 + x * 3] = r; row[1 + x * 3 + 1] = g; row[1 + x * 3 + 2] = b; }
    rows.push(row);
  }
  const idat = zlib.deflateSync(Buffer.concat(rows));
  return Buffer.concat([SIG, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

test('planFrames: N steps produce N frame-delay entries, first N-1 at delayCs 200, last at 400 (defaults)', () => {
  const plan = planFrames(5);
  assert.equal(plan.length, 5);
  for (let i = 0; i < 4; i++) assert.equal(plan[i].delayCs, 200);
  assert.equal(plan[4].delayCs, 400);
});

test('planFrames: a single step gets the last-hold delay, not the default', () => {
  const plan = planFrames(1);
  assert.equal(plan.length, 1);
  assert.equal(plan[0].delayCs, 400);
});

test('planFrames: custom delayMs/lastHoldMs are honored and converted to centiseconds', () => {
  const plan = planFrames(3, { delayMs: 1500, lastHoldMs: 3000 });
  assert.equal(plan[0].delayCs, 150); assert.equal(plan[1].delayCs, 150); assert.equal(plan[2].delayCs, 300);
});

test('captionList: a captioned step renders its caption; an uncaptioned step renders action + locator', () => {
  const steps = [
    { action: 'click', locator: { role: 'button', name: 'Add to cart' }, caption: 'Add the item to your cart' },
    { action: 'fill', locator: { testid: 'email-input' }, value: 'user@example.com' },
    { action: 'assert_visible', locator: { text: 'Order confirmed', exact: true } },
  ];
  const out = captionList(steps);
  assert.match(out, /^1\. Add the item to your cart$/m);
  assert.match(out, /^2\. fill testid="email-input"$/m);
  assert.match(out, /^3\. assert_visible text="Order confirmed"$/m);
});

test('captionList: a role locator renders as {action} role={role} "{name}"', () => {
  const out = captionList([{ action: 'click', locator: { role: 'button', name: 'Add to cart' } }]);
  assert.match(out, /^1\. click role=button "Add to cart"$/m);
});

test('captionList: an uncaptioned navigate step renders "{action} {target}", never the locator=? sentinel', () => {
  const out = captionList([{ action: 'navigate', target: 'https://example.com/page2' }]);
  assert.match(out, /^1\. navigate https:\/\/example\.com\/page2$/m);
  assert.equal(/locator=\?/.test(out), false);
});

test('captionList: an uncaptioned press step renders "{action} \\"{value}\\"", never the locator=? sentinel', () => {
  const out = captionList([{ action: 'press', value: 'Alt+ArrowLeft' }]);
  assert.match(out, /^1\. press "Alt\+ArrowLeft"$/m);
  assert.equal(/locator=\?/.test(out), false);
});

test('captionList: a role locator with no name renders "role={role}" without the literal "undefined"', () => {
  const out = captionList([{ action: 'click', locator: { role: 'button' } }]);
  assert.match(out, /^1\. click role=button$/m);
  assert.equal(/undefined/.test(out), false);
});

test('encodeWalkthrough: three identical-size fixtures encode to a valid GIF, prints frames:3', async () => {
  const png = buildPng(8, 6, (x, y) => [x * 10, y * 10, 50]);
  const readFile = (p) => png; // every path returns the same fixture bytes
  const result = encodeWalkthrough({ framePaths: ['a.png', 'b.png', 'c.png'], delays: [200, 200, 400], width: null, budgetBytes: 10 * 1024 * 1024 }, { readFile });
  assert.equal(result.width, 8); assert.equal(result.height, 6);
  assert.equal(result.buffer.subarray(0, 6).toString('ascii'), 'GIF89a');
  assert.equal(result.downscaled, false);
  assert.equal(result.bytes, result.buffer.length);
});

test('encodeWalkthrough: dimension mismatch throws FrameMismatchError naming the second path and both dimension pairs', () => {
  const pngA = buildPng(8, 6, () => [1, 2, 3]);
  const pngB = buildPng(4, 4, () => [1, 2, 3]);
  const readFile = (p) => (p === 'a.png' ? pngA : pngB);
  assert.throws(
    () => encodeWalkthrough({ framePaths: ['a.png', 'b.png'], delays: [200, 400], width: null, budgetBytes: 10 * 1024 * 1024 }, { readFile }),
    (err) => err instanceof FrameMismatchError && err.message.includes('b.png') && err.message.includes('8') && err.message.includes('4'),
  );
});

test('encodeWalkthrough: --width downscales by nearest-neighbor, height computed proportionally', () => {
  const png = buildPng(128, 96, (x, y) => [x, y, (x + y) % 256]);
  const readFile = () => png;
  const result = encodeWalkthrough({ framePaths: ['a.png'], delays: [400], width: 64, budgetBytes: 10 * 1024 * 1024 }, { readFile });
  assert.equal(result.width, 64);
  assert.equal(result.height, 48); // round(96 * 64/128)
  assert.equal(result.downscaled, true);
});

test('encodeWalkthrough: a tiny budget throws BudgetExceededError with the lever list, width-lever names the current width', () => {
  const png = buildPng(16, 12, (x, y) => [x * 15, y * 15, 99]);
  const readFile = () => png;
  assert.throws(
    () => encodeWalkthrough({ framePaths: ['a.png'], delays: [400], width: null, budgetBytes: 1 }, { readFile }),
    (err) => {
      assert.ok(err instanceof BudgetExceededError);
      assert.equal(err.budgetBytes, 1);
      assert.equal(err.levers[0], 'fewer steps');
      assert.equal(err.levers[1], 'lower --width (current 16px)');
      return true;
    },
  );
});
