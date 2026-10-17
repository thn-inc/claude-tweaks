// tests/bin-lib/skill-audit/load.test.js — the per-invocation skill load
// model (#3307): bin/lib/skill-audit/load.js plus the text-level measuring
// helper it shares with context-cost.js.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { measuredTextBytes, measuredBytes } = require('../../../plugin/bin/lib/skill-audit/context-cost');

test('measuredTextBytes equals measuredBytes for the same content (CRLF + markers)', () => {
  const text = '<!-- when: mode=auto -->\r\nhello\r\n<!-- /when -->\r\nbye\r\n';
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'load-model-'));
  const file = path.join(dir, 'x.md');
  fs.writeFileSync(file, text);
  assert.deepStrictEqual(measuredTextBytes(text), measuredBytes(file));
  assert.strictEqual(measuredTextBytes(text).bytes, Buffer.byteLength('hello\nbye\n'));
});

test('measuredTextBytes falls back to raw normalized bytes on a malformed marker, naming the label', () => {
  const text = '<!-- when: mode=auto -->\nx\n';
  const r = measuredTextBytes(text, 'lbl.md');
  assert.strictEqual(r.bytes, Buffer.byteLength(text));
  assert.match(r.markerError, /^lbl\.md:1: unclosed marker/);
});
