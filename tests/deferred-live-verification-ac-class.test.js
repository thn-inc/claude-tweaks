const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const CONTRACT = fs.readFileSync(
  path.join(__dirname, '..', 'plugin', 'skills', '_shared', 'auto-mode-contract.md'),
  'utf8',
);
const LEDGER_FORMAT = fs.readFileSync(
  path.join(__dirname, '..', 'plugin', 'skills', '_shared', 'ledger-format.md'),
  'utf8',
);

function neverReversibleSection() {
  const start = CONTRACT.indexOf('### Never-reversible (auto-FORBIDDEN, regardless of mode)');
  const end = CONTRACT.indexOf('## What `auto` silences', start);
  assert.notStrictEqual(start, -1, 'Never-reversible heading present');
  assert.ok(end > start, 'section delimited by the What auto silences heading');
  return CONTRACT.slice(start, end);
}

function requiredForOpsSection() {
  const start = LEDGER_FORMAT.indexOf('Required for `ops`-phase items');
  const end = LEDGER_FORMAT.indexOf('## Resolve Gate (Nothing-Left-Behind)', start);
  assert.notStrictEqual(start, -1, 'Required for ops-phase items heading present');
  assert.ok(end > start, 'section delimited by the Resolve Gate heading');
  return LEDGER_FORMAT.slice(start, end);
}

test('auto-mode-contract.md names the deferred-live-verification AC class as never-reversible', () => {
  const section = neverReversibleSection();
  assert.match(section, /live[, ].*side-effecting.*hard-to-reverse/i);
  assert.match(section, /acceptance criterion/i);
  assert.match(section, /#683/, 'cites #683 as the worked example');
  assert.match(section, /reason-not-auto: live-verification/);
});

test('the documented rule generalizes past the worktree\\/PR\\/merge example (spec AC3)', () => {
  const section = neverReversibleSection();
  // Must name at least one non-PR/merge example of the class, not just the worked example.
  assert.match(section, /irreversible external API call/i);
});

// Per-file 40 KB pin on _shared/auto-mode-contract.md retired by #1997 — the
// per-file tier is a warning since #1990 and this file has no compose call
// site; removal condition in docs/incident-log.md [IL-153].

test('ledger-format.md defines the live-verification reason-not-auto qualifier', () => {
  const section = requiredForOpsSection();
  assert.match(section, /`live-verification`/);
  assert.match(section, /#683/, 'qualifier row cites #683 as the worked example');
});
