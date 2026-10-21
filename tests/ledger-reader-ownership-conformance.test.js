'use strict';
// tests/ledger-reader-ownership-conformance.test.js — pins #3687: ledger readers outside
// wrap-up resolve THIS run's ledger through the ownership-aware ledger probe
// (`wrap-up-pack.js --print ledger`'s `value.files`), never a bare `docs/plans/*-ledger.md`
// glob, which also matches ledgers inherited from the integration branch. The glob may
// survive only as the documented reader fallback, or in prose naming inherited / other
// runs' ledgers. Live-corpus read (skill-prose-conformance-tests: a convention this project
// enforces); go-red controls run the same assertion function against frozen pre-change text.
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');

const SKILLS = path.join(__dirname, '..', 'plugin', 'skills');
const flat = (s) => s.replace(/\s+/g, ' ');
const read = (rel) => flat(readText(path.join(SKILLS, rel)));

const GLOB_RE = /docs\/plans\/\*[^\s`"]*-ledger\.md/;
const ALLOWED_RE = /fall ?back|inherited|unattributed|other run(?:'s|s')/i;

function sentences(text) {
  return text.split(/(?<=[.!?])\s+(?=[A-Z*`(#\d-])/);
}

function assertNoBareGlob(text, label) {
  const bare = sentences(text).filter((s) => GLOB_RE.test(s) && !ALLOWED_RE.test(s));
  assert.deepStrictEqual(bare, [], `${label}: a this-run ledger lookup uses the bare docs/plans glob`);
}

function assertRuleIsProbeFirst(text) {
  assert.ok(text.includes('wrap-up-pack.js" --run "$PIPELINE_RUN_DIR" --print ledger --json "$PIPELINE_RUN_DIR/wrap-up-pack-ledger.json"'), 'rule runs the ledger probe');
  assert.match(text, /read its `value\.files`/);
  assert.match(text, /a `ledger\.md` entry is the run-dir file above \(relative to the run dir/);
  assert.match(text, /An empty `value\.files` means this run has no ledger yet — not a cue to look further/);
  assert.match(text, /`value\.unattributedFiles` lists the `docs\/plans\/` ledgers inherited from the integration branch: another run's/);
  assert.match(text, /\*\*Fallback, for a reader only:\*\*/);
  assert.match(text, /A caller that writes or deletes the ledger never takes this fallback: it fails closed/);
}

test('AC1.1: ledger-format.md resolves this run\'s ledger through the ledger probe', () => {
  const text = read('_shared/ledger-format.md');
  assertRuleIsProbeFirst(text);
  assertNoBareGlob(text, '_shared/ledger-format.md');
});

test('AC2.1 go-red: the pre-#3687 resolution rule fails the probe-first assertions', () => {
  const PRE = flat('**Resolution rule for a caller reading "the active ledger for this run":** when a run dir resolves (`$PIPELINE_RUN_DIR` or the most-recent-matching run), check `{run-dir}/ledger.md` for existence first — if it exists, that\'s the active ledger; if not, fall back to the `docs/plans/*-ledger.md` glob.');
  assert.throws(() => assertRuleIsProbeFirst(PRE));
});

test('AC2.1 go-red: a bare glob lookup sentence fails, a fallback/inherited sentence passes', () => {
  assert.throws(() => assertNoBareGlob(flat('1. Find active ledger files: glob `docs/plans/*-ledger.md`. Then show counts.'), 'fixture'));
  assert.throws(() => assertNoBareGlob(flat('LEDGER_FILE=$(git -C "$WORKTREE_PATH" ls-files "docs/plans/*-record-{n}-ledger.md")'), 'fixture'));
  assert.doesNotThrow(() => assertNoBareGlob(flat('Fallback: the `docs/plans/*-ledger.md` glob. It also matches inherited ledgers in `docs/plans/*-ledger.md`.'), 'fixture'));
});

const RULE_CITE = "`_shared/ledger-format.md`'s resolution rule";
const READERS = ['ledger/SKILL.md', 'review/code-mode-steps.md', 'wrap-up/auto-merge-short-circuit.md'];

test('AC1.1/AC2.1: every repointed reader cites the resolution rule and carries no bare glob lookup', () => {
  for (const rel of READERS) {
    const text = read(rel);
    assert.ok(text.includes(RULE_CITE), `${rel} cites ${RULE_CITE}`);
    assertNoBareGlob(text, rel);
  }
});

test('ledger resolve never defaults to another run\'s ledger when a run dir resolves', () => {
  const text = read('ledger/SKILL.md');
  assert.match(text, /when the rule finds none, report `No ledger found for this run` rather than resolving another run's/);
});

test('auto-merge short-circuit deletes only value.files entries and fails closed on ok: false', () => {
  const text = read('wrap-up/auto-merge-short-circuit.md');
  assert.ok(text.includes('wrap-up-pack.js" --run "$RUN_DIR" --print ledger --json "$RUN_DIR/wrap-up-pack-ledger.json"'));
  assert.match(text, /For each `docs\/plans\/` path in the printed `value\.files`/);
  assert.match(text, /On `ok: false`, delete nothing and log one `SKIP` line/);
});

test('AC2.1 go-red: the pre-#3687 reader sentences fail the no-bare-glob assertion', () => {
  const PRE = [
    '1. Find active ledger files: glob `docs/plans/*-ledger.md`. When a run dir resolves for this invocation, also check `{run-dir}/ledger.md`.',
    'Otherwise, resolve against `docs/plans/*-ledger.md` the same way the `{feature-name}` form does above.',
    'After confirming `TEST_PASSED`, read the open items ledger (`docs/plans/*-ledger.md`, or the run-dir-scoped alternate) and filter for entries with phase `test/qa`:',
    'LEDGER_FILE=$(git -C "$WORKTREE_PATH" ls-files "docs/plans/*-record-{n}-ledger.md")',
  ];
  for (const s of PRE) assert.throws(() => assertNoBareGlob(flat(s), 'pre-change'), `must go red: ${s}`);
});

module.exports = { assertNoBareGlob, read };
