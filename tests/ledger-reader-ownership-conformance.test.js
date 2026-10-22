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
const ALLOWED_RE = /fallback|inherited|unattributed|other run(?:'s|s')/i;

function sentences(text) {
  return text.split(/(?<=[.!?])\s+(?=[A-Z*`(#\d-])/);
}

function assertNoBareGlob(text, label) {
  const bare = sentences(text).filter((s) => GLOB_RE.test(s) && !ALLOWED_RE.test(s));
  assert.deepStrictEqual(bare, [], `${label}: a this-run ledger lookup uses the bare docs/plans glob`);
}

function assertRuleIsProbeFirst(text) {
  assert.ok(text.includes('wrap-up-pack.js" --run "{run-dir}" --print ledger --json "{run-dir}/wrap-up-pack-ledger.json"'), 'rule runs the ledger probe');
  assert.match(text, /read its `value\.files`/);
  assert.match(text, /a `ledger\.md` entry is the run-dir file above \(relative to the run dir/);
  assert.match(text, /An empty `value\.files` means this run has no ledger yet — not a cue to look further/);
  assert.match(text, /`value\.unattributedFiles` lists the `docs\/plans\/` ledgers inherited from the integration branch: another run's/);
  assert.match(text, /\*\*Fallback, for a reader only:\*\* when the probe returns `ok: false` or cannot run/);
  assert.match(text, /if it exists, that is the ledger and the glob is not consulted/);
  assert.match(text, /When a run dir resolves, a caller that flips or deletes ledger rows or files never takes this fallback on a probe failure: it fails closed instead/);
  assert.match(text, /An append \(a new row, or Create's already-exists check\) and any caller with no run dir at all take the fallback as written/);
}

test('AC1.1: ledger-format.md resolves this run\'s ledger through the ledger probe', () => {
  const text = read('_shared/ledger-format.md');
  assertRuleIsProbeFirst(text);
  assertNoBareGlob(text, '_shared/ledger-format.md');
});

test('AC2.1 go-red: the pre-#3687 resolution rule fails the probe-first assertions', () => {
  const PRE = flat('**Resolution rule for a caller reading "the active ledger for this run":** when a run dir resolves (`$PIPELINE_RUN_DIR` or the most-recent-matching run), check `{run-dir}/ledger.md` for existence first — if it exists, that\'s the active ledger; if not, fall back to the `docs/plans/*-ledger.md` glob.');
  assert.throws(() => assertRuleIsProbeFirst(PRE), /rule runs the ledger probe/);
});

test('AC2.1 go-red: a bare glob lookup sentence fails, a fallback/inherited sentence passes', () => {
  assert.throws(() => assertNoBareGlob(flat('1. Find active ledger files: glob `docs/plans/*-ledger.md`. Then show counts.'), 'fixture'));
  assert.throws(() => assertNoBareGlob(flat('LEDGER_FILE=$(git -C "$WORKTREE_PATH" ls-files "docs/plans/*-record-{n}-ledger.md")'), 'fixture'));
  assert.throws(() => assertNoBareGlob(flat("if it exists, that's the active ledger; if not, fall back to the `docs/plans/*-ledger.md` glob."), 'fixture'));
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

test('ledger resolve with a run dir stops on a probe failure — the gate flips rows', () => {
  assert.match(read('ledger/SKILL.md'), /when its probe fails, report the probe error and stop: the gate flips rows, so it never takes the rule's fallback/);
});

test('auto-merge short-circuit deletes through delete-ledger (the rule\'s writer branch), never a glob', () => {
  const text = read('wrap-up/auto-merge-short-circuit.md');
  assert.ok(text.includes('hooks.js" delete-ledger --run "$RUN_DIR"'));
  assert.match(text, /Handle its printed report exactly as `cleanup-procedures\.md`'s Item 2 paragraph does/);
  assert.match(text, /ownership-aware, never a glob, failing closed on a ledger it cannot attribute to this run/);
});

test('auto-merge short-circuit commits only a tracked deletion and leaves the ledger alone on any other report', () => {
  const text = read('wrap-up/auto-merge-short-circuit.md');
  assert.match(text, /ls-files --error-unmatch -- "\$LEDGER_FILE"/);
  assert.match(text, /Only a tracked `docs\/plans\/` path gets the deletion staged and committed/);
  assert.match(text, /Every other report except `not found` leaves the ledger on disk: commit nothing and log one `SKIP` line/);
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
