// tests/dispatch-named-target-exclusion-fixture.test.js — #1983 AC4.
//
// AC4 asks to replay #1776/#1804/#1818 against a tip where #1819 (the tidy sweep that deleted
// their target ledgers) has merged, and confirm three exclusions + three staged closes + zero
// build attempts. Those three issues are long-closed by the time this record was built, so a
// literal historical replay has no live precondition left to reproduce against. This test
// supplies the synthetic-fixture equivalent the record's own Technical Approach anticipates:
// three synthetic by:docs-health records whose named targets are absent at a fixture git ref,
// standing in for the historical #1776/#1804/#1818 scenario.
//
// #5230: the subject is the queue-pull module's target-missing pass
// (plugin/bin/lib/dispatch/queue-pull.js), run alone over a groups file, with its git probe going
// to a REAL fixture repository through the module's default runner (the in-process tests in
// tests/bin-lib/dispatch/queue-pull.test.js answer `git cat-file -e` from a table). The staging and
// logging tail (stage-item.js, log-decision.js, hooks.js resolve-run-dir) is faked here; that suite
// pins its argv and bodies.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { gitRepo, fixtureGit } = require('./helpers/git-fixtures');
const { PASSES, makeContext, runPasses } = require('../plugin/bin/lib/dispatch/queue-pull');

function docsHealthRecord(number, docPath) {
  return {
    number,
    labels: ['by:docs-health', 'ready'],
    body: `**Doc:** ${docPath} | **Section:** Freshness | **Category:** staleness | **Misleads:** agent | **Classification:** additive | **Confidence:** high`,
  };
}

// The pass's CLI calls: the integration-branch policy read answers `main`, the run-dir resolution a
// scratch dir, and log-decision.js / stage-item.js succeed. Anything else throws; the module catches
// a step's throw and prints it to stderr, so the test asserts stderr carries no `unexpected CLI`.
function fakeCli(runDir) {
  return (name, args) => {
    if (name === 'resolve-policy.js' && args[1] === 'integration-branch') return { status: 0, stdout: 'main\n', stderr: '' };
    if (name === 'hooks.js') return { status: 0, stdout: `${runDir}\n`, stderr: '' };
    if (name === 'log-decision.js' || name === 'stage-item.js') return { status: 0, stdout: '', stderr: '' };
    throw new Error(`unexpected CLI ${name} ${args.join(' ')}`);
  };
}

test('the queue-pull module\'s named-target exclusion excludes exactly the synthetic records standing in for #1776/#1804/#1818, leaves a present-target record and a non-docs-health record untouched (#1983 AC4)', (t) => {
  const repo = gitRepo();
  // Present-target fixture: commit a docs-health ledger the fixture ref DOES carry, so the
  // exclusion logic must NOT touch it -- proves the mechanism discriminates rather than
  // excluding everything.
  fs.mkdirSync(path.join(repo, 'docs', 'plans'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'docs', 'plans', 'present-ledger.md'), '# present\n');
  fixtureGit(['-C', repo, 'add', 'docs/plans/present-ledger.md']);
  fixtureGit(['-C', repo, 'commit', '-q', '-m', 'add present ledger']);
  // The pass probes origin/<integration branch>; the fixture's origin/main is its HEAD.
  fixtureGit(['-C', repo, 'update-ref', 'refs/remotes/origin/main', 'HEAD']);

  // Synthetic stand-ins for #1776/#1804/#1818: by:docs-health records naming a ledger never
  // committed at all, so it is absent at origin/main by construction -- the same shape as
  // "tidy PR #1819 already deleted it" without depending on that closed PR's live history.
  const groups = [
    [docsHealthRecord(11776, 'docs/plans/synthetic-1776-ledger.md')],
    [docsHealthRecord(11804, 'docs/plans/synthetic-1804-ledger.md')],
    [docsHealthRecord(11818, 'docs/plans/synthetic-1818-ledger.md')],
    [docsHealthRecord(19999, 'docs/plans/present-ledger.md')],
    [{ number: 18888, labels: ['by:capture', 'ready'], body: '### Key Files\n\n- `plugin/bin/foo.js` (modify)' }],
  ];

  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-named-target-fixture-'));
  const sessionId = `named-target-fixture-${process.pid}-${path.basename(scratch)}`;
  const errs = [];
  const ctx = makeContext({ sessionId, cwd: repo }, { spawnCli: fakeCli(scratch), stdout: () => {}, stderr: (s) => errs.push(s), tmpName: () => path.join(scratch, 'proposal.md') });
  t.after(() => {
    fs.rmSync(path.dirname(ctx.paths['dispatch-groups.json']), { recursive: true, force: true });
    fs.rmSync(scratch, { recursive: true, force: true });
    fs.rmSync(repo, { recursive: true, force: true });
  });
  fs.writeFileSync(ctx.paths['dispatch-groups.json'], JSON.stringify(groups));
  runPasses(PASSES.filter((p) => p.id === 'target-missing'), ctx);
  assert.doesNotMatch(errs.join(''), /unexpected CLI/, 'the pass made a CLI call the fake does not answer');
  assert.equal(ctx.state.integrationRef, 'origin/main');

  const missing = JSON.parse(fs.readFileSync(ctx.paths['dispatch-exclusions.json'], 'utf8'))
    .filter((e) => e.reason === 'target-missing')
    .map((e) => ({ number: e.records[0], path: e.detail.path }));
  assert.deepStrictEqual(
    missing.map((m) => m.number).sort((a, b) => a - b),
    [11776, 11804, 11818],
    'exactly the three synthetic absent-target records are excluded -- AC4\'s "yields three exclusions"',
  );
  for (const m of missing) {
    assert.ok(m.path.startsWith('docs/plans/synthetic-'), `excluded entry names the absent path (got ${m.path})`);
  }

  const finalGroups = JSON.parse(fs.readFileSync(ctx.paths['dispatch-groups.json'], 'utf8'));
  const survivingNumbers = finalGroups.flat().map((r) => r.number).sort((a, b) => a - b);
  assert.deepStrictEqual(
    survivingNumbers,
    [18888, 19999],
    'the present-target record and the non-docs-health record both survive the filter untouched',
  );
});
