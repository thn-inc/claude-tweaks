'use strict';
// tests/bin-lib/walkthrough/encode-standalone-no-redaction.test.js — #4612: the packet's recording
// redacts at its render choke point, and the standalone walkthrough-encode.js path stays out of that:
// its caption file is the author's own, for a demo they chose to make (AC6).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const { run } = require('../../../plugin/bin/walkthrough-encode');

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) {
    c ^= byte;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const name = Buffer.from(type, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([name, data])), 0);
  return Buffer.concat([len, name, data, crc]);
}

function fixturePng(width, height) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const row = Buffer.alloc(width * 3 + 1);
  const idat = zlib.deflateSync(Buffer.concat(Array.from({ length: height }, () => row)));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0)),
  ]);
}

const SECRET_CAPTION = 'log in with api_key=sk_live_123abc as bob@example.com';
const SECRET_TITLE = 'token=ghp_abc123def';
const SECRET_FRAME = 'sk_live_frame.png';

test('AC6: a secret-shaped caption reaches the caption file unchanged', () => {
  const written = {};
  const read = [];
  const files = {
    [SECRET_FRAME]: fixturePng(4, 4),
    'steps.json': Buffer.from(JSON.stringify([{ caption: SECRET_CAPTION }])),
  };
  const code = run(
    ['--frames', SECRET_FRAME, '--out', 'o.gif', '--steps-json', 'steps.json', '--captions', 'captions.md', '--caption-title', SECRET_TITLE],
    {
      readFile: (file) => { read.push(file); return files[file]; },
      readdir: () => { throw new Error('not a directory'); },
      writeFileAtomic: (file, content) => { written[file] = content; },
      stdout: () => {},
      stderr: (text) => assert.fail(text),
    },
  );
  assert.equal(code, 0);
  assert.equal(written['captions.md'], `# ${SECRET_TITLE}\n\n1. ${SECRET_CAPTION}\n`);
  assert.ok(read.includes(SECRET_FRAME), 'the frame path reaches the encoder as given');
});
