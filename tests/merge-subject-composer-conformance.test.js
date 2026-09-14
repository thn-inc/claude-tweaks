// tests/merge-subject-composer-conformance.test.js — pins #2251's merge-site contract:
// every merge site sources its subject/body from bin/compose-subject.js (AC 5), the two
// pr-first sites squash (AC 1), and pr-first-merge.md stays net-small (AC 6). Frozen
// pre-change excerpts prove each pattern can go red (skill-prose-conformance-tests, IL-105).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const PR_FIRST = 'plugin/skills/_shared/pr-first-merge.md';
const LOCAL_SITES = [
  'plugin/skills/_shared/local-merge-auto-finish.md',
  'plugin/skills/wrap-up/auto-merge-short-circuit.md',
  'plugin/skills/dispatch/settle-and-merge.md',
  'plugin/skills/flow/worktree-merge.md',
];

// AC 6: 30,404 bytes before #2251; net-small means at most +500.
const PR_FIRST_BYTE_CEILING = 30904;

// Frozen pre-change excerpts (byte-for-byte from the pre-#2251 files).
const PRE_PR_FIRST_SITE = `gh pr merge {pr-number} --repo {owner}/{repo} --auto --merge \\
  -t "[{tag}] {one-line summary}" \\
  -b "$(printf 'Fixes #%s\\n' {issue-list})"`;
const PRE_LOCAL_SITE = `git merge --no-ff {branch} -m "[auto-merge] {one-line summary}

Fixes #{issue}
Fixes #{second-issue}"`;
const PRE_WORKTREE_MERGE_SITE = `   git merge --no-ff {branch} -m "Merge {branch} — specs {list}

   Fixes #{issue}
   Fixes #{second-issue}"`;

const COMPOSER_CALL = /SUBJECT_EXPORTS=\$\(node "\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/compose-subject\.js" [^\n]*--shell\) \|\| exit 1\n[ \t]*eval "\$SUBJECT_EXPORTS"/;
const LOCAL_MERGE_FORM = /git merge --no-ff \{[a-z-]+\} -m "\$SUBJECT_TITLE\n\n\$SUBJECT_BODY"/;
const STALE_LOCAL_FORM = /git merge --no-ff \{[a-z-]+\} -m "(\[|Merge \{branch\})/;
const STALE_PR_FIRST_FORM = /gh pr merge \{pr-number\}[^\n]*--merge \\/;

test('pr-first-merge.md: both gh pr merge sites squash and take the composer output', () => {
  const text = read(PR_FIRST);
  const squashSites = text.match(/gh pr merge \{pr-number\} --repo \{owner\}\/\{repo\} (--auto )?--squash \\\n\s+-t "\$SUBJECT_TITLE" -b "\$SUBJECT_BODY"/g) || [];
  assert.equal(squashSites.length, 2, 'expected exactly two squash merge sites');
  assert.match(text, COMPOSER_CALL);
  // F1: the degrade fence (the `--squash` site under `merge-verification: off`) no longer relies
  // on the first fence's shell state surviving into its own, separate Bash call — it guards its
  // own composer call, same as the first fence.
  const composerCalls = text.match(new RegExp(COMPOSER_CALL.source, 'g')) || [];
  assert.equal(composerCalls.length, 2, 'expected both squash sites to run their own guarded composer call');
  assert.doesNotMatch(text, STALE_PR_FIRST_FORM);
  assert.doesNotMatch(text, /-t "\[\{tag\}\] \{one-line summary\}"/);
  // go-red proof
  assert.match(PRE_PR_FIRST_SITE, STALE_PR_FIRST_FORM);
  assert.doesNotMatch(PRE_PR_FIRST_SITE, COMPOSER_CALL);
});

test('pr-first-merge.md stays net-small (AC 6 byte ceiling)', () => {
  const bytes = fs.statSync(path.join(ROOT, PR_FIRST)).size;
  assert.ok(bytes <= PR_FIRST_BYTE_CEILING, `${PR_FIRST} is ${bytes} bytes, over the ${PR_FIRST_BYTE_CEILING}-byte ceiling (#2251 AC 6)`);
});

for (const rel of LOCAL_SITES) {
  test(`${path.basename(rel)}: the --no-ff merge sources -m from the composer`, () => {
    const text = read(rel);
    assert.match(text, COMPOSER_CALL, 'composer eval line present');
    assert.match(text, LOCAL_MERGE_FORM, 'merge takes $SUBJECT_TITLE / $SUBJECT_BODY');
    assert.doesNotMatch(text, STALE_LOCAL_FORM, 'no free-form -m subject remains');
  });
}

test('go-red proof: the frozen pre-change local-merge forms match the stale pattern and not the new one', () => {
  for (const pre of [PRE_LOCAL_SITE, PRE_WORKTREE_MERGE_SITE]) {
    assert.match(pre, STALE_LOCAL_FORM);
    assert.doesNotMatch(pre, LOCAL_MERGE_FORM);
    assert.doesNotMatch(pre, COMPOSER_CALL);
  }
});
