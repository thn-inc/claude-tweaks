'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const {
  findRecentCommitOverlap, findOpenPrOverlap, deriveKeyTerms, DEFAULT_LOOKBACK_DAYS, DEFAULT_MIN_TERM_MATCHES,
} = require('../../../plugin/bin/lib/issues/recent-commit-check');

// A fake git-log runner: asserts the argv shape, returns a %x1f-delimited
// log formatted exactly like the module's own --format string.
function fakeGitLog(lines, { expectFiles } = {}) {
  return (cmd, args) => {
    assert.strictEqual(cmd, 'git');
    assert.strictEqual(args[0], '-C');
    assert.strictEqual(args[2], 'log');
    assert.ok(args.some((a) => a.startsWith('--since=')));
    assert.ok(args.includes('--no-merges'));
    if (expectFiles) {
      const dashIdx = args.indexOf('--');
      assert.notStrictEqual(dashIdx, -1, 'expected a -- path separator');
      assert.deepStrictEqual(args.slice(dashIdx + 1), expectFiles);
    } else {
      assert.strictEqual(args.includes('--'), false);
    }
    return lines.map((l) => `${l.sha}\x1f${l.subject}\x1f${l.date}`).join('\n') + (lines.length ? '\n' : '');
  };
}

test('deriveKeyTerms lowercases, strips punctuation, drops short words and stopwords', () => {
  const terms = deriveKeyTerms("materialize.js's `--run-dir` anchoring check refuses a genuinely-new write");
  assert.ok(terms.includes('materialize'));
  assert.ok(terms.includes('anchoring'));
  assert.ok(terms.includes('refuses'));
  assert.ok(terms.includes('genuinely-new')); // hyphenated compounds stay intact (more specific, fewer false positives)
  assert.ok(!terms.includes('this'));
  assert.ok(!terms.includes('a')); // too short
});

test('deriveKeyTerms returns [] for empty/non-string input', () => {
  assert.deepStrictEqual(deriveKeyTerms(''), []);
  assert.deepStrictEqual(deriveKeyTerms(undefined), []);
});

test('findRecentCommitOverlap returns null when no terms can be derived', () => {
  const execImpl = () => { throw new Error('must not be called'); };
  assert.strictEqual(findRecentCommitOverlap({ root: '/r', title: 'a to is' }, execImpl), null);
});

test('findRecentCommitOverlap returns null when git throws (no repo, no git)', () => {
  const execImpl = () => { throw new Error('not a git repository'); };
  assert.strictEqual(
    findRecentCommitOverlap({ root: '/r', title: 'materialize run-dir anchoring guard' }, execImpl),
    null,
  );
});

test('findRecentCommitOverlap returns null when no commit subject clears the term threshold', () => {
  const execImpl = fakeGitLog([
    { sha: 'aaa1111', subject: 'unrelated typo fix in readme', date: '2026-08-20T10:00:00Z' },
  ]);
  const result = findRecentCommitOverlap(
    { root: '/r', title: 'materialize run-dir anchoring guard refuses worktree write' },
    execImpl,
  );
  assert.strictEqual(result, null);
});

test('findRecentCommitOverlap (unscoped) requires DEFAULT_MIN_TERM_MATCHES distinct terms in a subject', () => {
  const execImpl = fakeGitLog([
    // only one overlapping term ("anchoring") — below the default threshold of 2
    { sha: 'bbb2222', subject: 'fix anchoring elsewhere', date: '2026-08-20T10:00:00Z' },
  ]);
  const result = findRecentCommitOverlap(
    { root: '/r', title: 'materialize run-dir anchoring guard refuses worktree write' },
    execImpl,
  );
  assert.strictEqual(result, null);
});

test('findRecentCommitOverlap (unscoped) matches when >= 2 terms overlap the commit subject', () => {
  const execImpl = fakeGitLog([
    { sha: 'ccc3333', subject: 'Fix materialize.js run-dir anchoring guard (refs #959)', date: '2026-08-21T06:55:00Z' },
  ]);
  const result = findRecentCommitOverlap(
    { root: '/r', title: 'materialize run-dir anchoring guard refuses worktree write' },
    execImpl,
  );
  assert.notStrictEqual(result, null);
  assert.strictEqual(result.lookbackDays, DEFAULT_LOOKBACK_DAYS);
  assert.strictEqual(result.fileScoped, false);
  assert.strictEqual(result.commits.length, 1);
  assert.strictEqual(result.commits[0].sha, 'ccc3333');
  assert.ok(result.commits[0].matchedTerms.length >= DEFAULT_MIN_TERM_MATCHES);
});

test('findRecentCommitOverlap (file-scoped) matches on a single overlapping term once files narrow the log', () => {
  const execImpl = fakeGitLog(
    [{ sha: 'ddd4444', subject: 'Fix anchoring bug (refs #959)', date: '2026-08-21T06:55:00Z' }],
    { expectFiles: ['bin/materialize.js'] },
  );
  const result = findRecentCommitOverlap(
    { root: '/r', title: 'materialize anchoring regression', files: ['bin/materialize.js'] },
    execImpl,
  );
  assert.notStrictEqual(result, null);
  assert.strictEqual(result.fileScoped, true);
  assert.strictEqual(result.commits[0].sha, 'ddd4444');
});

test('findRecentCommitOverlap sorts strong matches newest-first', () => {
  const execImpl = fakeGitLog([
    { sha: 'older111', subject: 'materialize anchoring guard tweak', date: '2026-08-10T00:00:00Z' },
    { sha: 'newer222', subject: 'materialize anchoring guard rewrite', date: '2026-08-22T00:00:00Z' },
  ]);
  const result = findRecentCommitOverlap(
    { root: '/r', title: 'materialize anchoring guard' },
    execImpl,
  );
  assert.deepStrictEqual(result.commits.map((c) => c.sha), ['newer222', 'older111']);
});

test('findRecentCommitOverlap accepts explicit terms instead of deriving from title', () => {
  const execImpl = fakeGitLog([
    { sha: 'eee5555', subject: 'shadow guard worktree-relative write fix', date: '2026-08-21T00:00:00Z' },
  ]);
  const result = findRecentCommitOverlap(
    { root: '/r', terms: ['shadow', 'guard'] },
    execImpl,
  );
  assert.notStrictEqual(result, null);
  assert.strictEqual(result.commits[0].sha, 'eee5555');
});

test('findRecentCommitOverlap returns null on empty git log output', () => {
  const execImpl = fakeGitLog([]);
  const result = findRecentCommitOverlap(
    { root: '/r', title: 'materialize anchoring guard' },
    execImpl,
  );
  assert.strictEqual(result, null);
});

test('findRecentCommitOverlap ignores non-positive/non-finite lookbackDays and falls back to the default', () => {
  const execImpl = (cmd, args) => {
    assert.ok(args.includes(`--since=${DEFAULT_LOOKBACK_DAYS}.days`));
    return '';
  };
  findRecentCommitOverlap({ root: '/r', title: 'materialize anchoring guard', lookbackDays: -5 }, execImpl);
  findRecentCommitOverlap({ root: '/r', title: 'materialize anchoring guard', lookbackDays: NaN }, execImpl);
});

test('findRecentCommitOverlap defaults execImpl to child_process.execFileSync when not injected (real repo smoke test)', () => {
  // Proves the real default path runs against this checkout's own git log —
  // matches read-commit.test.js's convention for exercising the real seam.
  // Uses an unlikely-to-collide term set so this stays green regardless of
  // recent commit history content.
  const result = findRecentCommitOverlap({
    root: process.cwd(),
    terms: ['zzzzznonexistenttermzzzz', 'yyyyalsofakeyyyy'],
    lookbackDays: 3650,
  });
  assert.strictEqual(result, null);
});

// findOpenPrOverlap fixtures are the real #3155-incident titles, verbatim
// (#3155's fix PR #3172 and the three by:capture records filed while it was open).
const PR_3172 = {
  number: 3172,
  title: 'bin/verify.js baseline adjudication mangles failing-file paths in a space-containing checkout path (#3155)',
  url: 'https://github.com/thn-inc/claude-tweaks/pull/3172',
};
const TITLE_3178 = 'verify.js baseline isolation mis-extracts test-file paths containing a space';
const TITLE_3185 = 'verify.js baseline adjudication misclassifies a flaky test as attributable when the checkout path contains a space';
const TITLE_3189 = "bin/verify.js's --baseline adjudicator mis-extracts failing-test file paths on a checkout whose path contains a space";

test('findOpenPrOverlap names PR #3172 for the #3185 incident title, with the five shared terms (AC3.1)', () => {
  const result = findOpenPrOverlap({ title: TITLE_3185, prs: [PR_3172] });
  assert.notStrictEqual(result, null);
  assert.strictEqual(result.prs.length, 1);
  assert.strictEqual(result.prs[0].number, 3172);
  assert.strictEqual(result.prs[0].title, PR_3172.title);
  assert.strictEqual(result.prs[0].url, PR_3172.url);
  assert.deepStrictEqual(result.prs[0].matchedTerms, ['verify', 'baseline', 'adjudication', 'checkout', 'path']);
});

test('findOpenPrOverlap matches the #3178 and #3189 incident titles against PR #3172 on 3 and 4 terms', () => {
  const r3178 = findOpenPrOverlap({ title: TITLE_3178, prs: [PR_3172] });
  assert.strictEqual(r3178.prs[0].number, 3172);
  assert.strictEqual(r3178.prs[0].matchedTerms.length, 3);
  const r3189 = findOpenPrOverlap({ title: TITLE_3189, prs: [PR_3172] });
  assert.strictEqual(r3189.prs[0].number, 3172);
  assert.strictEqual(r3189.prs[0].matchedTerms.length, 4);
});

test('findOpenPrOverlap returns null for an unrelated title sharing at most one term (AC3.2)', () => {
  // The candidate's own terms are capture/list/open/pull/requests/record; the second
  // open PR shares only "record" with it, which is below the module default of 2.
  const candidate = 'capture should list open pull requests before filing a record';
  const prs = [PR_3172, { number: 3190, title: 'Document record snapshot invalidation', url: 'https://github.com/thn-inc/claude-tweaks/pull/3190' }];
  assert.strictEqual(findOpenPrOverlap({ title: candidate, prs }), null);
});

test('findOpenPrOverlap ranks matches by matched-term count, most first', () => {
  // 3172 shares 5 terms with TITLE_3185 and 3178 shares 3; input order puts 3178 first.
  const result = findOpenPrOverlap({ title: TITLE_3185, prs: [{ number: 3178, title: TITLE_3178 }, PR_3172] });
  assert.deepStrictEqual(result.prs.map((p) => p.number), [3172, 3178]);
  assert.deepStrictEqual(result.prs[1].matchedTerms, ['verify', 'baseline', 'space']);
});

test('findOpenPrOverlap breaks matched-term ties by higher PR number first', () => {
  const prs = [
    { number: 3100, title: TITLE_3178 },
    { number: 3150, title: TITLE_3178 },
  ];
  const result = findOpenPrOverlap({ title: TITLE_3178, prs });
  assert.deepStrictEqual(result.prs.map((p) => p.number), [3150, 3100]);
});

test('findOpenPrOverlap returns null for unusable PR input', () => {
  for (const prs of [[], undefined, 'x', {}]) {
    assert.strictEqual(findOpenPrOverlap({ title: TITLE_3185, prs }), null, `prs=${JSON.stringify(prs)}`);
  }
});

test('findOpenPrOverlap returns null for an empty or non-string candidate title', () => {
  for (const title of ['', undefined, 42, null]) {
    assert.strictEqual(findOpenPrOverlap({ title, prs: [PR_3172] }), null, `title=${JSON.stringify(title)}`);
  }
});

test('findOpenPrOverlap returns null instead of throwing when called with null or no argument', () => {
  assert.strictEqual(findOpenPrOverlap(null), null);
  assert.strictEqual(findOpenPrOverlap(), null);
});

test('findOpenPrOverlap skips PR entries without a string title instead of throwing', () => {
  const prs = [null, { number: 1 }, { number: 2, title: 42 }, PR_3172];
  const result = findOpenPrOverlap({ title: TITLE_3185, prs });
  assert.deepStrictEqual(result.prs.map((p) => p.number), [3172]);
});
