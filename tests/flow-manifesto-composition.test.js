// tests/flow-manifesto-composition.test.js — pins the mode-marker placement in
// plugin/skills/flow/manifesto.md (#1991) as composed behavior, not bytes: the
// `hybrid` bullet cites "same as `confirm`", so the `confirm` bullet must stay
// unconditional (present under every resolved mode); the `auto`, `hybrid`, and
// `interactive` bullets and the auto-FYI paragraph are single-mode and must be
// absent from the other modes' bundles; an unresolved `mode` keeps every branch.
// Composes through compose-context/compose.js's own `compose` so a fence that
// moves silently (re-fencing `confirm`, unfencing `auto`) goes red here — the
// byte-identity and grep-negative proofs #1991 pasted into its PR are plan-time
// and cannot. Only each bullet's opening is matched, never its prose, so the
// bullets can be reworded freely.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { compose, KEYS, VOCAB, UNRESOLVED } = require('../plugin/bin/lib/compose-context/compose');

const FILE = 'plugin/skills/flow/manifesto.md';
const content = fs.readFileSync(path.join(__dirname, '..', FILE), 'utf8');

const OPENINGS = {
  auto: '- **`auto` mode (flow\'s default)**',
  confirm: '- **`confirm` mode**',
  hybrid: '- **`hybrid` mode**',
  interactive: '- **`interactive` mode**',
  fyi: 'render the FYI variant instead',
};

// The manifesto composed at `mode`, every other condition pinned to its first
// vocabulary value. `sourceContent` defaults to the real file; the discrimination
// test passes a doctored copy through the same composition path.
function bundleFor(mode, sourceContent = content) {
  const conditions = Object.fromEntries(KEYS.map((key) => [key, key === 'mode' ? mode : VOCAB[key][0]]));
  return compose([{ path: FILE, content: sourceContent }], conditions);
}

function presence(bundle) {
  return Object.fromEntries(Object.entries(OPENINGS).map(([name, opening]) => [name, bundle.includes(opening)]));
}

test('the confirm bullet is unconditional — hybrid cites it, so every resolved mode keeps it', () => {
  for (const mode of ['auto', 'hybrid', 'interactive']) {
    assert.equal(bundleFor(mode).includes(OPENINGS.confirm), true, `confirm bullet missing under mode=${mode}`);
  }
});

test('an auto run composes only its own bullet and the FYI paragraph (hybrid and interactive stripped)', () => {
  assert.deepEqual(presence(bundleFor('auto')), { auto: true, confirm: true, hybrid: false, interactive: false, fyi: true });
});

test('a hybrid run keeps its bullet and its confirm antecedent, and drops the auto-only prose', () => {
  assert.deepEqual(presence(bundleFor('hybrid')), { auto: false, confirm: true, hybrid: true, interactive: false, fyi: false });
});

test('an unresolved mode keeps every branch — the standalone read is the whole file', () => {
  assert.deepEqual(presence(bundleFor(UNRESOLVED)), { auto: true, confirm: true, hybrid: true, interactive: true, fyi: true });
});

test('discrimination: re-fencing the confirm bullet under mode=confirm goes red', () => {
  const refenced = content.replace(OPENINGS.confirm, `<!-- when: mode=confirm -->\n${OPENINGS.confirm}`)
    .replace(OPENINGS.hybrid, `<!-- /when -->\n${OPENINGS.hybrid}`);
  const bundle = bundleFor('hybrid', refenced);
  assert.equal(bundle.includes(OPENINGS.confirm), false, 'the fixture must actually strip the confirm bullet under hybrid');
});
