const { test } = require('node:test');
const assert = require('node:assert');
const { probeForge } = require('../../../plugin/bin/lib/residue/probes/forge');

function stubRunner(responses) {
  return (argv) => (Object.prototype.hasOwnProperty.call(responses, argv.join(' ')) ? responses[argv.join(' ')] : null);
}

const SCOPE = { ran: true, reason: null, base: 'a1b2c3d', headBranch: 'worktree-feat', branches: [], worktrees: [] };
const PR_LIST = 'gh pr list --state open --json number,title,headRefName --limit 100';
const PRS = JSON.stringify([
  { number: 182, title: 'Read Key Files', headRefName: 'worktree-fix-154' },
  { number: 198, title: 'Reaping', headRefName: 'worktree-feat' },
]);

test('an open PR for this work is reported', () => {
  const { findings } = probeForge({ scope: SCOPE, run: stubRunner({ [PR_LIST]: PRS }) });
  assert.ok(findings.some((f) => f.subject === 'PR #198'), 'the PR for HEAD branch is this work');
});

test('an open PR for another lane is reported but not auto-remediable', () => {
  const { findings } = probeForge({ scope: SCOPE, run: stubRunner({ [PR_LIST]: PRS }) });
  const other = findings.find((f) => f.subject === 'PR #182');
  assert.strictEqual(other.remedy, 'record', 'residue must not act on another lane PR');
  assert.strictEqual(other.scope, 'observed');
});

test('the PR list call caps at 100, matching this repo\'s other gh pr list call sites', () => {
  // gh's implicit default is 30 and truncates silently (`_shared/github-pr-scan.md`).
  let capturedArgv = null;
  const run = (argv) => {
    capturedArgv = argv;
    return PRS;
  };
  probeForge({ scope: SCOPE, run });
  assert.deepStrictEqual(capturedArgv, ['gh', 'pr', 'list', '--state', 'open', '--json', 'number,title,headRefName', '--limit', '100']);
});

test('a missing gh does not run, rather than reporting a clean forge', () => {
  const r = probeForge({ scope: SCOPE, run: stubRunner({}) });
  assert.strictEqual(r.ran, false);
  assert.deepStrictEqual(r.findings, []);
  assert.match(r.reason, /gh/);
});

test('unparseable gh output does not run, rather than throwing', () => {
  const r = probeForge({ scope: SCOPE, run: stubRunner({ [PR_LIST]: 'not json' }) });
  assert.strictEqual(r.ran, false);
  assert.match(r.reason, /could not parse/);
});

// #1781: pr-first's own recorded PR is open by design until Phase 4's merge
// decision — not residue. Keyed on the recorded PR number, not head-branch
// equality, so a *different* stale PR on the same head branch is untouched.
test('#1781: the recorded own PR is excluded from findings and reported on ownPr', () => {
  const { findings, ownPr } = probeForge({ scope: SCOPE, run: stubRunner({ [PR_LIST]: PRS }), ownPr: 198 });
  assert.ok(!findings.some((f) => f.subject === 'PR #198'), 'the recorded own PR must not appear as a finding');
  assert.deepStrictEqual(ownPr, { number: 198, headRefName: 'worktree-feat' });
  // The other open PR is untouched by the carve-out.
  assert.ok(findings.some((f) => f.subject === 'PR #182'));
});

test('#1781: a second open PR on the same head branch with a different number still reports as blast-radius', () => {
  const prs = JSON.stringify([
    { number: 198, title: 'Recorded own PR', headRefName: 'worktree-feat' },
    { number: 250, title: 'A forgotten draft from an earlier phase', headRefName: 'worktree-feat' },
  ]);
  const { findings, ownPr } = probeForge({ scope: SCOPE, run: stubRunner({ [PR_LIST]: prs }), ownPr: 198 });
  assert.deepStrictEqual(ownPr, { number: 198, headRefName: 'worktree-feat' });
  const forgotten = findings.find((f) => f.subject === 'PR #250');
  assert.ok(forgotten, 'the non-recorded same-head-branch PR must still be reported');
  assert.strictEqual(forgotten.scope, 'blast-radius');
});

test('#1781: ownPr unset (default) keeps existing "this work is reported" behavior and ownPr is null', () => {
  const { findings, ownPr } = probeForge({ scope: SCOPE, run: stubRunner({ [PR_LIST]: PRS }) });
  assert.ok(findings.some((f) => f.subject === 'PR #198'));
  assert.strictEqual(ownPr, null);
});
