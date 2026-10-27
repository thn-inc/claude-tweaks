'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');

const FILE = path.join(__dirname, '..', 'plugin', 'skills', 'wrap-up', 'review-console.md');

function eventsInputLine(text) {
  const line = text.split('\n').find((l) => /^4\. `events\.jsonl`/.test(l));
  assert.ok(line, 'Read inputs item 4 (events.jsonl) must exist');
  return line;
}

function assertExclusion(line) {
  for (const t of ['`wd-deny`', '`wd-push-mismatch`', '`contract-violation`', '`gate-denial`']) {
    assert.ok(line.includes(t), `events.jsonl input must still surface ${t}`);
  }
  assert.match(line, /`gate-denial`[^\n]*`test: true`/, 'must state the test:true gate-denial exclusion');
  assert.ok(line.includes('bin/friction-events.js'), 'must cite the read boundary that owns the same exclusion');
}

test('AC1.1: the Review Console events.jsonl read skips test:true gate-denial events (#4186)', () => {
  assertExclusion(eventsInputLine(readText(FILE)));
});

test('AC1.1 go-red control: the pre-#4186 line fails the same assertion', () => {
  const before = '4. `events.jsonl` — hook-recorded typed events; surface `wd-deny`, `wd-push-mismatch`, `contract-violation`, and `gate-denial` events';
  assert.throws(() => assertExclusion(before));
});
