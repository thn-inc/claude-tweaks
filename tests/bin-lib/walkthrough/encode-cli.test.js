'use strict';
// tests/bin-lib/walkthrough/encode-cli.test.js — #2758: activity-render.js-shaped CLI wrapper
// over encode.js. Every dependency injected; no real file I/O.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const { run } = require('../../../plugin/bin/walkthrough-encode');

function crc32(buf) {
  let c; const table = crc32.table || (crc32.table = (() => { const t = []; for (let n = 0; n < 256; n++) { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })());
  c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) { const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0); const t = Buffer.from(type, 'latin1'); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0); return Buffer.concat([len, t, data, crc]); }
function fixturePng(width, height) {
  const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const rows = []; for (let y = 0; y < height; y++) { const row = Buffer.alloc(width * 3 + 1); for (let x = 0; x < width; x++) { row[1 + x * 3] = x; row[1 + x * 3 + 1] = y; row[1 + x * 3 + 2] = 9; } rows.push(row); }
  const idat = zlib.deflateSync(Buffer.concat(rows));
  return Buffer.concat([SIG, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

function deps(files, overrides = {}) {
  const out = { stdout: [], stderr: [], written: {} };
  const d = {
    readFile: (p) => { if (!(p in files)) { const e = new Error(`ENOENT: ${p}`); e.code = 'ENOENT'; throw e; } return files[p]; },
    writeFileAtomic: (p, content) => { out.written[p] = content; },
    stdout: (s) => out.stdout.push(s), stderr: (s) => out.stderr.push(s),
    ...overrides,
  };
  return { d, out };
}

test('--help exits 0 before any file read', () => {
  const { d, out } = deps({}, { readFile: () => { throw new Error('must not read'); } });
  assert.equal(run(['--help'], d), 0);
  assert.match(out.stdout.join(''), /usage: walkthrough-encode\.js/);
});

test('exit 1: missing --frames, missing --out, unknown flag', () => {
  for (const argv of [['--out', 'o.gif'], ['--frames', 'a.png'], ['--frames', 'a.png', '--out', 'o.gif', '--bogus']]) {
    const { d } = deps({});
    assert.equal(run(argv, d), 1, argv.join(' '));
  }
});

test('happy path: 3 comma-separated frames encode, exit 0, prints frames:3 and writes atomically', () => {
  const png = fixturePng(8, 6);
  const { d, out } = deps({ 'a.png': png, 'b.png': png, 'c.png': png });
  assert.equal(run(['--frames', 'a.png,b.png,c.png', '--out', 'o.gif', '--budget-mb', '8'], d), 0);
  const parsed = JSON.parse(out.stdout.join(''));
  assert.equal(parsed.frames, 3);
  assert.equal(parsed.out, 'o.gif');
  assert.ok(out.written['o.gif'].subarray(0, 6).toString('ascii') === 'GIF89a');
});

test('--frames accepts a directory path expanded to its *.png entries in lexical order', () => {
  const png = fixturePng(4, 4);
  const { d, out } = deps({ 'dir/01.png': png, 'dir/02.png': png }, { readdir: () => ['02.png', '01.png'] });
  assert.equal(run(['--frames', 'dir', '--out', 'o.gif'], d), 0);
  assert.equal(JSON.parse(out.stdout.join('')).frames, 2);
});

test('exit 2: an unreadable frame relays the read error', () => {
  const { d, out } = deps({ 'a.png': fixturePng(4, 4) });
  assert.equal(run(['--frames', 'a.png,missing.png', '--out', 'o.gif'], d), 2);
  assert.match(out.stderr.join(''), /missing\.png/);
});

test('exit 2: a dimension-mismatched frame relays FrameMismatchError naming the offending path', () => {
  const { d, out } = deps({ 'a.png': fixturePng(8, 8), 'b.png': fixturePng(4, 4) });
  assert.equal(run(['--frames', 'a.png,b.png', '--out', 'o.gif'], d), 2);
  assert.match(out.stderr.join(''), /b\.png/);
});

test('exit 3: over budget prints the lever list, fewer steps first, lower --width second naming current width, writes nothing', () => {
  const { d, out } = deps({ 'a.png': fixturePng(128, 96) });
  assert.equal(run(['--frames', 'a.png', '--out', 'o.gif', '--budget-mb', '0.000001'], d), 3);
  const parsed = JSON.parse(out.stdout.join(''));
  assert.deepEqual(parsed.levers, ['fewer steps', 'lower --width (current 128px)']);
  assert.deepEqual(out.written, {});
});

test('--delay-ms / --last-hold-ms / --width are threaded through to the encode call', () => {
  const { d, out } = deps({ 'a.png': fixturePng(128, 64), 'b.png': fixturePng(128, 64) });
  assert.equal(run(['--frames', 'a.png,b.png', '--out', 'o.gif', '--width', '64', '--delay-ms', '500', '--last-hold-ms', '1000'], d), 0);
  const parsed = JSON.parse(out.stdout.join(''));
  assert.equal(parsed.width, 64);
  assert.equal(parsed.height, 32);
});

test('exit 1: non-numeric --budget-mb, --width, or --delay-ms are rejected, never silently NaN-ed', () => {
  const png = fixturePng(8, 6);
  for (const argv of [['--frames', 'a.png', '--out', 'o.gif', '--budget-mb', 'eight'], ['--frames', 'a.png', '--out', 'o.gif', '--width', 'half'], ['--frames', 'a.png', '--out', 'o.gif', '--delay-ms', 'fast']]) {
    const { d, out } = deps({ 'a.png': png });
    assert.equal(run(argv, d), 1, argv.join(' '));
    assert.deepEqual(out.written, {}, 'must write nothing on a malformed numeric flag');
  }
});

test('--steps-json and --captions together produce the caption file and include captions in the stdout JSON', () => {
  const png = fixturePng(8, 6);
  const steps = JSON.stringify([{ action: 'click', locator: { role: 'button', name: 'Go' } }]);
  const { d, out } = deps({ 'a.png': png, 'steps.json': Buffer.from(steps) });
  assert.equal(run(['--frames', 'a.png', '--out', 'o.gif', '--steps-json', 'steps.json', '--captions', 'o.md'], d), 0);
  const parsed = JSON.parse(out.stdout.join(''));
  assert.equal(parsed.captions, 'o.md');
  assert.match(out.written['o.md'], /^1\. click role=button "Go"$/m);
});

test('--caption-title prepends a "# {title}" line above the rendered list', () => {
  const png = fixturePng(8, 6);
  const steps = JSON.stringify([{ action: 'click', locator: { role: 'button', name: 'Go' } }]);
  const { d, out } = deps({ 'a.png': png, 'steps.json': Buffer.from(steps) });
  assert.equal(run(['--frames', 'a.png', '--out', 'o.gif', '--steps-json', 'steps.json', '--captions', 'o.md', '--caption-title', 'My Story'], d), 0);
  assert.match(out.written['o.md'], /^# My Story\n\n1\. click role=button "Go"$/m);
});

test('exit 1: only one of --steps-json/--captions given', () => {
  const png = fixturePng(8, 6);
  for (const argv of [['--frames', 'a.png', '--out', 'o.gif', '--steps-json', 'steps.json'], ['--frames', 'a.png', '--out', 'o.gif', '--captions', 'o.md']]) {
    const { d, out } = deps({ 'a.png': png });
    assert.equal(run(argv, d), 1, argv.join(' '));
    assert.deepEqual(out.written, {});
  }
});

test('exit 1: malformed --steps-json content names the offending file, writes nothing', () => {
  const png = fixturePng(8, 6);
  const { d, out } = deps({ 'a.png': png, 'steps.json': Buffer.from('not json') });
  assert.equal(run(['--frames', 'a.png', '--out', 'o.gif', '--steps-json', 'steps.json', '--captions', 'o.md'], d), 1);
  assert.match(out.stderr.join(''), /steps\.json/);
  assert.deepEqual(out.written, {});
});
