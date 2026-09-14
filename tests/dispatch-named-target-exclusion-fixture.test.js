// tests/dispatch-named-target-exclusion-fixture.test.js — #1983 AC4.
//
// AC4 asks to replay #1776/#1804/#1818 against a tip where #1819 (the tidy sweep that deleted
// their target ledgers) has merged, and confirm three exclusions + three staged closes + zero
// build attempts. Those three issues are long-closed by the time this record was built, so a
// literal historical replay has no live precondition left to reproduce against. This test
// supplies the synthetic-fixture equivalent the record's own Technical Approach anticipates:
// three synthetic by:docs-health records whose named targets are absent at a fixture git ref,
// standing in for the historical #1776/#1804/#1818 scenario, run through the *actual* exclusion
// logic queue-pull-script.md ships (extract-and-run, per skill-prose-conformance-tests) rather
// than a hand-reimplementation of it.
//
// Scope: the three `node -e` blocks that (1) compute each candidate's namedTarget, (2) test
// existence via `git cat-file -e` against the resolved integration ref, and (3) filter excluded
// candidates out of $DISPATCH_GROUPS. This is the load-bearing part of AC4's "yields three
// exclusions" claim. The staging/logging tail (stage-item.js, log-decision.js, hooks.js
// resolve-run-dir) is already covered structurally by
// tests/dispatch-tidy-named-target-coordination.test.js and by those CLIs' own suites, and
// pulling it into this fixture would mean re-deriving run-dir anchoring rather than testing
// AC4's actual claim.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { gitRepo, fixtureGit, FIXTURE_TIMEOUT_MS } = require('./helpers/git-fixtures');

const ROOT = path.join(__dirname, '..');
const QUEUE_PULL_SCRIPT = fs.readFileSync(
  path.join(ROOT, 'plugin', 'skills', 'dispatch', 'queue-pull-script.md'), 'utf8',
);

// Structurally anchored (not a prose sentence): the first line is the require call unique to
// this block, the last is the mv this block's own filter step performs -- both content, not
// commentary, so a rewording of the surrounding prose does not move this extraction.
const START_ANCHOR = 'node -e "\n  const fs = require(\'fs\');\n  const { namedTarget } = require(\'${CLAUDE_PLUGIN_ROOT}/bin/lib/issues/named-target.js\');';
const END_ANCHOR = '" "$DISPATCH_GROUPS" "$DISPATCH_TARGET_MISSING_EXCLUDED" > "${DISPATCH_GROUPS}.tmp" && mv "${DISPATCH_GROUPS}.tmp" "$DISPATCH_GROUPS"';

function extractExclusionSnippet() {
  const startIdx = QUEUE_PULL_SCRIPT.indexOf(START_ANCHOR);
  assert.notStrictEqual(startIdx, -1, 'extraction start anchor not found in queue-pull-script.md -- extraction is out of sync with the live file');
  const endIdx = QUEUE_PULL_SCRIPT.indexOf(END_ANCHOR, startIdx);
  assert.notStrictEqual(endIdx, -1, 'extraction end anchor not found in queue-pull-script.md -- extraction is out of sync with the live file');
  return QUEUE_PULL_SCRIPT.slice(startIdx, endIdx + END_ANCHOR.length);
}

function docsHealthRecord(number, docPath) {
  return {
    number,
    labels: ['by:docs-health', 'ready'],
    body: `**Doc:** ${docPath} | **Section:** Freshness | **Category:** staleness | **Misleads:** agent | **Classification:** additive | **Confidence:** high`,
  };
}

test('queue-pull-script.md\'s named-target exclusion excludes exactly the synthetic records standing in for #1776/#1804/#1818, leaves a present-target record and a non-docs-health record untouched (#1983 AC4)', () => {
  const snippet = extractExclusionSnippet();

  const repo = gitRepo();
  // Present-target fixture: commit a docs-health ledger the fixture ref DOES carry, so the
  // exclusion logic must NOT touch it -- proves the mechanism discriminates rather than
  // excluding everything.
  fs.mkdirSync(path.join(repo, 'docs', 'plans'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'docs', 'plans', 'present-ledger.md'), '# present\n');
  fixtureGit(['-C', repo, 'add', 'docs/plans/present-ledger.md']);
  fixtureGit(['-C', repo, 'commit', '-q', '-m', 'add present ledger']);
  const integrationRef = fixtureGit(['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();

  // Synthetic stand-ins for #1776/#1804/#1818: by:docs-health records naming a ledger never
  // committed at all, so it is absent at integrationRef by construction -- the same shape as
  // "tidy PR #1819 already deleted it" without depending on that closed PR's live history.
  const groups = [
    [docsHealthRecord(11776, 'docs/plans/synthetic-1776-ledger.md')],
    [docsHealthRecord(11804, 'docs/plans/synthetic-1804-ledger.md')],
    [docsHealthRecord(11818, 'docs/plans/synthetic-1818-ledger.md')],
    [docsHealthRecord(19999, 'docs/plans/present-ledger.md')],
    [{ number: 18888, labels: ['by:capture', 'ready'], body: '### Key Files\n\n- `plugin/bin/foo.js` (modify)' }],
  ];

  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-named-target-fixture-'));
  const dispatchGroups = path.join(scratch, 'dispatch-groups.json');
  const namedTargets = path.join(scratch, 'dispatch-named-targets.json');
  const missingExcluded = path.join(scratch, 'dispatch-target-missing-excluded.json');
  fs.writeFileSync(dispatchGroups, JSON.stringify(groups));

  execFileSync('bash', ['-c', snippet], {
    cwd: repo,
    timeout: FIXTURE_TIMEOUT_MS,
    env: {
      ...process.env,
      CLAUDE_PLUGIN_ROOT: path.join(ROOT, 'plugin'),
      DISPATCH_GROUPS: dispatchGroups,
      DISPATCH_NAMED_TARGETS: namedTargets,
      DISPATCH_TARGET_MISSING_EXCLUDED: missingExcluded,
      INTEGRATION_REF: integrationRef,
    },
  });

  const missing = JSON.parse(fs.readFileSync(missingExcluded, 'utf8'));
  assert.deepStrictEqual(
    missing.map((m) => m.number).sort((a, b) => a - b),
    [11776, 11804, 11818],
    'exactly the three synthetic absent-target records are excluded -- AC4\'s "yields three exclusions"',
  );
  for (const m of missing) {
    assert.ok(m.path.startsWith('docs/plans/synthetic-'), `excluded entry names the absent path (got ${m.path})`);
  }

  const finalGroups = JSON.parse(fs.readFileSync(dispatchGroups, 'utf8'));
  const survivingNumbers = finalGroups.flat().map((r) => r.number).sort((a, b) => a - b);
  assert.deepStrictEqual(
    survivingNumbers,
    [18888, 19999],
    'the present-target record and the non-docs-health record both survive the filter untouched',
  );
});
