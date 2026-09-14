// tests/reflect-friction-lens-vocab.test.js
//
// Pins skills/reflect/full-mode.md's Friction Lens event-type-to-file
// vocabulary against the real `appendEvent(...)` call sites in
// bin/lib/hooks/*.js. This doc-to-code claim already drifted once — #452's
// final review found `contract-violation` misattributed to the wrong file —
// with nothing catching it automatically.
//
// This suite reads live production prose, which [IL-80] warns against — a
// test asserting "this real file currently contains X" is a scheduled
// failure timed to the next migration. It is acceptable HERE, and only
// here, for the same reason tests/hooks-gate-coverage.test.js's header
// gives: the `friction-lens-vocab` block below is a declared contract whose
// update IS the intended action when the vocabulary changes, not incidental
// prose.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { FRICTION_EVENT_TYPES } = require('../plugin/bin/lib/friction-lens-vocab');

const ROOT = path.join(__dirname, '..');
const FULL_MODE_PATH = path.join(ROOT, 'plugin', 'skills', 'reflect', 'full-mode.md');
const HOOKS_DIR = path.join(ROOT, 'plugin', 'bin', 'lib', 'hooks');

const BEGIN = '<!-- friction-lens-vocab:begin -->';
const END = '<!-- friction-lens-vocab:end -->';

// The CLI's own filter list (bin/friction-events.js, via bin/lib/friction-lens-vocab.js) is the
// list under test here, not a second hardcoded copy — a divergence between the shared constant
// and the doc block below is exactly what this suite exists to catch (#2016).
const EVENT_TYPES = FRICTION_EVENT_TYPES;

function vocabBlock() {
  const text = fs.readFileSync(FULL_MODE_PATH, 'utf8');
  const start = text.indexOf(BEGIN);
  const end = text.indexOf(END);
  assert.ok(start !== -1 && end !== -1 && end > start,
    `full-mode.md must contain a ${BEGIN} ... ${END} block — it is the canonical statement of the Friction Lens event vocabulary`);
  return text.slice(start + BEGIN.length, end);
}

// `- `event-type`: `file.js`` lines -> { eventType: file }
function parseVocab(block) {
  const map = {};
  for (const line of block.split('\n')) {
    const m = /^-\s*`([^`]+)`:\s*`([^`]+)`\s*$/.exec(line.trim());
    if (m) map[m[1]] = m[2];
  }
  return map;
}

// event-type -> the file actually containing `appendEvent(..., 'event-type', ...)`
function liveCallSites() {
  const sites = {};
  for (const file of fs.readdirSync(HOOKS_DIR)) {
    if (!file.endsWith('.js')) continue;
    const src = fs.readFileSync(path.join(HOOKS_DIR, file), 'utf8');
    const re = /appendEvent\([^,]+,\s*'([a-zA-Z-]+)'/g;
    let m;
    while ((m = re.exec(src))) {
      sites[m[1]] = `bin/lib/hooks/${file}`;
    }
  }
  return sites;
}

test('full-mode.md declares a non-empty friction-lens-vocab block', () => {
  assert.ok(vocabBlock().trim().length > 0);
});

test('the friction-lens-vocab block declares exactly the five event types bin/friction-events.js filters to', () => {
  const declared = parseVocab(vocabBlock());
  assert.deepStrictEqual(Object.keys(declared).sort(), [...EVENT_TYPES].sort(),
    'full-mode.md\'s friction-lens-vocab block and bin/lib/friction-lens-vocab.js\'s FRICTION_EVENT_TYPES (the CLI\'s own filter list) have diverged');
});

for (const eventType of EVENT_TYPES) {
  test(`Friction Lens vocabulary for '${eventType}' matches its live appendEvent call site`, () => {
    const declared = parseVocab(vocabBlock());
    const live = liveCallSites();
    assert.ok(declared[eventType], `full-mode.md's friction-lens-vocab block is missing '${eventType}'`);
    assert.ok(live[eventType], `no appendEvent(..., '${eventType}', ...) call site found under bin/lib/hooks/`);
    assert.strictEqual(declared[eventType], live[eventType],
      `full-mode.md says '${eventType}' is logged by ${declared[eventType]}, but the real appendEvent call site is in ${live[eventType]}`);
  });
}
