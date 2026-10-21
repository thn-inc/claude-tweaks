'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const { readText } = require('./helpers/read-skill');

const ROOT = path.join(__dirname, '..');
const read = (rel) => readText(path.join(ROOT, rel));
const { ADOPTION_NOTES, PR_CONFLICT_NOTE } = require(path.join(ROOT, 'plugin', 'bin', 'lib', 'flow', 'preflight'));

test('steps-and-gates.md calls flow-preflight.js --run exactly once in the adoption section, no longer invokes check-resume-freshness --run, still names the verb, and checks BLOCKED right after the call (#1931 AC5)', () => {
  const t = read('plugin/skills/flow/steps-and-gates.md');
  assert.strictEqual((t.match(/flow-preflight\.js" --run/g) || []).length, 1);
  assert.strictEqual((t.match(/check-resume-freshness --run/g) || []).length, 0);
  assert.ok(t.includes('check-resume-freshness'), 'the verb is still cited by name (resume-freshness-citations pin)');
  const call = t.indexOf('flow-preflight.js" --run');
  const section = t.indexOf('### Adopting an inherited run directory');
  const next = t.indexOf('### Partial step lists');
  assert.ok(section < call && call < next, 'the call lives in the adoption section');
  const after = t.slice(call, call + 1200);
  assert.match(after, /freshness\.value\.verdict === 'BLOCKED'/, 'a literal check-and-stop on the freshness verdict follows the call');
  assert.match(after, /stop/i);
  assert.match(t, /inventory\.value\.status === 'MISMATCH'/);
  assert.match(t, /adoption\.value\.note/);
});

// #1931 I1: the CLI exits 3 (nothing written) for a missing/unanchored --run, so
// the module's case 4 is never reachable THROUGH it — the prose must give the
// reader a branch for each non-zero exit, or a code-3 run has no case at all.
test('the adoption section branches on the CLI\'s non-zero exits — 3 is case 4, 2 is a malformed invocation (#1931 I1)', () => {
  const t = read('plugin/skills/flow/steps-and-gates.md');
  const section = t.slice(t.indexOf('### Adopting an inherited run directory'), t.indexOf('### Partial step lists'));
  assert.ok(section.length > 0, 'the adoption section bounds must still resolve');
  assert.match(section, /exit code 3/);
  assert.match(section, /exit code 2/);
  // Anchored to the I1 paragraph's OWN wording — the reason-mapping sentence.
  // `is not anchored to the main checkout` alone would be satisfied by case 4's
  // note literal, which predates this paragraph.
  assert.match(section, /`missing` → `does not exist`/);
  assert.match(section, /the reason the CLI's own stderr names/);
  assert.match(section, /passes no `--json`/);
  // Case 4's own bullet no longer claims the pack reports the reason — it never
  // runs far enough to write one.
  assert.doesNotMatch(section, /The pack reports which reason applied/);
});

test('the four adoption note literals in preflight.js equal the ones steps-and-gates.md renders (#1931 AC5)', () => {
  const t = read('plugin/skills/flow/steps-and-gates.md');
  for (const n of [1, 2, 3, 4]) {
    assert.ok(t.includes('`' + ADOPTION_NOTES[n] + '`'), `case ${n} literal rendered verbatim in the prose`);
  }
});

test('manifesto.md renders the auto FYI table from preflight.levers and lists the pack as a source (#1931)', () => {
  const t = read('plugin/skills/flow/manifesto.md');
  assert.match(t, /preflight\.levers/);
  assert.match(t, /preflight\.json/);
  assert.match(t, /run-config/);
  assert.match(t, /`header`/);
  assert.match(t, /unresolved/);
  // #1931 C1: only case 1 has a config.yml to read — cases 2/3/5 compute the
  // levers fresh, so the do-not-re-resolve rule must not fire on them.
  assert.match(t, /adoption\.value\.case === 1/);
});

test('flow/SKILL.md names the pack in Step 3 (#1931 AC6)', () => {
  const t = read('plugin/skills/flow/SKILL.md');
  assert.match(t, /flow-preflight\.js/);
});

function readConflictSection() {
  const t = read('plugin/skills/flow/steps-and-gates.md');
  return t.slice(t.indexOf('### Adopting an inherited run directory'), t.indexOf('### Partial step lists'));
}

function assertConflictSection(section) {
  assert.ok(section.includes('`' + PR_CONFLICT_NOTE + '`'), 'the conflict line literal is rendered verbatim');
  assert.match(section, /pr\.value\.mergeable === 'CONFLICTING'/);
  assert.match(section, /pr\.value\.conflictNote/);
  assert.match(section, /pr\.ok/, 'the check guards on a successful pr read');
  assert.match(section, /_shared\/git-discipline\.md`'s Post-push merge-state check/);
  assert.match(section, /Catch-up \(`auto`\)/);
  assert.match(section, /--diff-filter=U/, 'the conflicting paths are named');
  assert.match(section, /HARD-GATE/);
  assert.match(section, /`MERGEABLE`/);
  assert.match(section, /`UNKNOWN`/);
  assert.match(section, /print nothing and log nothing/, 'the MERGEABLE/UNKNOWN no-op (no line, no decision entry) is stated, not just the tokens named');
  // ordering: after the BLOCKED freshness stop, before case 1
  const conflict = section.indexOf("pr.value.mergeable === 'CONFLICTING'");
  const blocked = section.indexOf("freshness.value.verdict === 'BLOCKED'");
  assert.ok(blocked !== -1 && blocked < conflict, 'the BLOCKED freshness stop is present and precedes the conflict paragraph');
  assert.ok(conflict < section.indexOf('1. **Set, the directory it names exists'));
  // the abort-and-stop path logs its own decision entry before the stop
  assert.match(section, /--reversibility high/, 'the aborted-merge entry is logged with reversibility high');
  assert.ok(section.indexOf('--reversibility high') < section.indexOf('stop as a HARD-GATE failure'), 'the abort entry is logged before the stop');
  // final-review fixes: open-only guard, spelled-out abort text, recovery form, no second `test` run
  assert.match(section, /pr\.value\.state === 'OPEN'/, 'only an open PR triggers the stop (pr-merge-state.js excludes non-OPEN)');
  assert.match(section, /merge aborted — HARD-GATE stop before \{next phase\}/, 'the abort entry spells out its --text');
  assert.match(section, /--text-file/, 'the abort entry names the --text-file form');
  assert.match(section, /Text from git or a user/, 'the abort entry cites the canonical --text-file procedure');
  assert.doesNotMatch(section, /escape any/i, 'the abort entry carries no hand-escape instruction');
  assert.match(section, /PIPELINE_RUN_DIR="\{run-dir\}" \/claude-tweaks:flow "\{target\}" \{step\}/, 'the stop names its resume form');
  assert.match(section, /\*\*Auto-insert `test`:\*\* rule/, 'the stamp re-verification cites the auto-insert rule instead of restating a test run');
}

test('the adoption section surfaces a CONFLICTING run PR and routes it to the git-discipline catch-up (#3014)', () => {
  assertConflictSection(readConflictSection());
});

test('go-red control: swapping the abort entry back to a double-quoted --text makes the section assertion throw (#3014)', () => {
  const section = readConflictSection();
  const mutated = section.split('--text-file').join('--text');
  assert.notStrictEqual(mutated, section, 'the control must actually mutate the text');
  assert.throws(() => assertConflictSection(mutated), /--text-file/);
});

test('auto-mode-contract registers the adopted-run PR-conflict stop in its HARD-GATE row (#3014)', () => {
  const t = read('plugin/skills/_shared/auto-mode-contract.md');
  const row = t.split('\n').find((l) => l.startsWith('| HARD-GATE / BLOCKED / STOP conditions'));
  assert.ok(row, 'the HARD-GATE row exists');
  assert.match(row, /adopted-run PR-conflict catch-up stop/);
  assert.match(row, /flow\/steps-and-gates\.md/);
  assert.match(row, /#3014/);
});
