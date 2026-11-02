// tests/github-pr-scan-fetch-limit.test.js
//
// Conformance for #4820: the PR scan in _shared/github-pr-scan.md sized its `gh issue list` /
// `gh pr list` fetches with hardcoded `--limit 50/100/200`, so a repo past the cap had its `[queue]`
// counts silently truncated: the sweep the record cites saw 200 of 308 open issues, and 354 open
// issues were measured live against the same cap at plan time. The `current-pr` and `repo-wide` scopes
// now take `--limit {resolved-limit}` (`backlog-fetch-limit`) and warn when a fetch reaches the cap.
//
// The prose is the declared contract: an agent runs these fences, so the live file is read and the
// fences that warn are extracted and run against a `gh` shell-function stub. Prose pins are proved on
// a mutated copy of the live text (the pinned clause is added in the same change, so there is no
// frozen excerpt to use as a control); the one behaviour change to existing text (item 8) has its
// pre-change fence frozen below and run, so the silent-truncation symptom is reproduced.
//
// Known pre-existing defect, out of scope for #4820 and fixed in flight by #4818 (PR #4883): item 10's second fence
// reads `process.env.UNSETTLED_AGE`, but its first fence sets `UNSETTLED_AGE` as an unexported shell
// variable in a separate Bash call, so a literal run of the two fences sees it unset. The item-10 test
// sets `UNSETTLED_AGE` in the spawn env instead of relying on the fences to pass it along.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawnSync } = require('child_process');
const { readText } = require('./helpers/read-skill');
const { sessionTmpRoot } = require('../plugin/bin/lib/session-tmp');

const PLUGIN_DIR = path.join(__dirname, '..', 'plugin');
const LIVE = readText(path.join(PLUGIN_DIR, 'skills', '_shared', 'github-pr-scan.md'));
const forwardSlashes = (p) => p.split(path.sep).join('/');

// The Fetch limit paragraph, byte-exact. It sits in every scope that carries a `--limit`, because a
// scope is inlined into a scan agent's prompt without the file's preamble.
const RULE = '**Fetch limit.** `{resolved-limit}` is the number `node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-policy.js" --values backlog-fetch-limit` prints, substituted literally into each command and block below, every occurrence; shell state does not survive between Bash calls. A fetch returning that many rows, or 1000 for a `--label` fetch (GitHub\'s cap), may be truncated: a block that checks prints a `WARNING:` line, and any other count at the cap is a floor, never a final count. Report every `WARNING:` line verbatim beside this scope\'s rows, never suppressed, and render a floor count as `{N}+`.';
const RULE_LAST_SENTENCE = ' Report every `WARNING:` line verbatim beside this scope\'s rows, never suppressed, and render a floor count as `{N}+`.';

// ---- helpers -------------------------------------------------------------------------------------

// The text from a scope's `## Scope: \`name\`` heading to the next `\n## ` heading.
function scopeSlice(text, name) {
  const heading = `## Scope: \`${name}\``;
  const start = text.indexOf(heading);
  assert.ok(start !== -1, `scope heading not found: ${heading}`);
  const end = text.indexOf('\n## ', start + heading.length);
  return end === -1 ? text.slice(start) : text.slice(start, end);
}

// The body of the `nth` ```bash fence after the first occurrence of `label`, dedented by the fence's
// own indentation. Anchored on the fence delimiters, not on a sentence.
function fenceAfter(text, label, nth = 0) {
  const at = text.indexOf(label);
  assert.ok(at !== -1, `label not found: ${label} — extraction pattern is out of sync with the doc`);
  const re = /^([ \t]*)```bash\n([\s\S]*?)\n[ \t]*```[ \t]*$/gm;
  re.lastIndex = at;
  let found = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (found++ === nth) {
      return m[2].split('\n').map((l) => (l.startsWith(m[1]) ? l.slice(m[1].length) : l)).join('\n');
    }
  }
  assert.fail(`no bash fence #${nth} after "${label}" — extraction pattern is out of sync with the doc`);
}

const ZSH_MISSING = Boolean(spawnSync('zsh', ['-f', '-c', 'true']).error);

// The `skip` option for a per-shell test: only the zsh variant is skipped, and only when zsh is not installed.
function shellTestOptions(shell) {
  return { skip: shell === 'zsh' && ZSH_MISSING ? 'zsh not on PATH' : false };
}

// The `gh` stub: a shell function serving the first N rows of the fixture universe (`ghRows`), N being the
// number after `--limit` (or in `--limit=N`) in its argv, or every row when the call carries no `--limit`. That models the
// real truncation, so a fence that fetches with a fixed cap gets a short list from a longer universe.
const GH_STUB = `gh() {
  local n="" prev="" a
  for a in "$@"; do
    if [ "$prev" = "--limit" ]; then n="$a"; fi
    case "$a" in --limit=*) n="\${a#--limit=}" ;; esac
    prev="$a"
  done
  node -e 'const r = require(process.env.FAKE_GH_OUT); const n = Number(process.argv[1]); console.log(JSON.stringify(n > 0 ? r.slice(0, n) : r));' -- "$n"
}`;

// Runs one extracted fence with `{resolved-limit}` substituted in every place it occurs. `gh` is the shell
// function above, so no network is touched and no PATH shim is needed; fixture paths travel through the
// spawn env, forward-slashed. `files` are written under the session temp root before the run:
// `{ name: rows }`, rows an array written as JSON or a string written as-is.
function runFence(fence, { limit = 1000, ghRows = [], files = {}, env = {}, shell = 'bash' } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-scan-fence-'));
  const sessionId = `pr-scan-fence-${path.basename(dir)}`;
  const root = sessionTmpRoot(sessionId);
  try {
    const ghOut = path.join(dir, 'gh-out.json');
    fs.writeFileSync(ghOut, JSON.stringify(ghRows));
    fs.mkdirSync(root, { recursive: true });
    for (const [name, rows] of Object.entries(files)) {
      fs.writeFileSync(path.join(root, name), typeof rows === 'string' ? rows : JSON.stringify(rows));
    }
    const body = fence.replaceAll('{resolved-limit}', String(limit));
    const script = `${GH_STUB}\n${body}`;
    const argv = shell === 'zsh' ? ['-f', '-c', script] : ['--noprofile', '--norc', '-c', script];
    const run = spawnSync(shell, argv, {
      encoding: 'utf8',
      env: { ...process.env, CLAUDE_PLUGIN_ROOT: forwardSlashes(PLUGIN_DIR), CLAUDE_CODE_SESSION_ID: sessionId, FAKE_GH_OUT: forwardSlashes(ghOut), ...env },
    });
    return { status: run.status, stdout: run.stdout, stderr: run.stderr };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(root, { recursive: true, force: true });
  }
}

// The limit token of every `gh issue|pr list … --limit X` call, one per match, after joining
// `\`-continued lines. `[^`\n]` keeps a match inside one code span, so prose that names `gh pr list` and
// `--limit {resolved-limit}` in separate spans is no match.
function limitSites(text) {
  const joined = text.replace(/\\\n\s*/g, ' ');
  return [...joined.matchAll(/gh (?:issue|pr) list\b[^`\n]*?--limit[\s=]+([^\s`]+)/g)].map((m) => m[1]);
}
const fixedLimitSites = (text) => limitSites(text).filter((t) => /^\d+$/.test(t));
// Every `gh issue|pr list … --json` call, sized or not: `limitSites` only sees a call that already carries a `--limit`,
// so a call added with none (gh's implicit 30) is visible only here. Prose that names a call without `--json` is no match.
function jsonListCalls(text) {
  return [...text.replace(/\\\n\s*/g, ' ').matchAll(/gh (?:issue|pr) list\b[^`\n]*?--json/g)];
}

function assertRule(scopeText) {
  assert.ok(scopeText.includes(RULE), 'the scope must carry the Fetch limit paragraph verbatim');
}

// Item 8 exactly as it read before #4820 (github-pr-scan.md, repo-wide): a fixed `--limit 200` and a
// node block that never compares the row count to the limit.
const PRE_CHANGE_ITEM8 = `PR_SCAN_RECORDS="$(node "\${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" --value pr-scan-records.json)"
gh issue list --state open --json number,title,labels --limit 200 > "$PR_SCAN_RECORDS"
node -e "
  const { parseRecordFacets } = require('\${CLAUDE_PLUGIN_ROOT}/bin/lib/issues/record.js');
  const { isPendingAuthorization } = require('\${CLAUDE_PLUGIN_ROOT}/bin/lib/issues/pending-authorization.js');
  const issues = require('$PR_SCAN_RECORDS');
  const faceted = issues.map((i) => parseRecordFacets(i.labels));
  const withFacets = issues.map((i, idx) => ({ number: i.number, title: i.title, facets: faceted[idx] }));
  const pending = withFacets.filter((i) => i.facets.stage === 'ready' && isPendingAuthorization(i.facets)).length;
  const blocked = withFacets.filter((i) => i.facets.bot.blocked).length;
  const backlog = withFacets.filter((i) => i.facets.stage === 'backlog').length;
  console.log(JSON.stringify({ pending, blocked, backlog }));
"`;

const CURRENT_PR = scopeSlice(LIVE, 'current-pr');
const REPO_WIDE = scopeSlice(LIVE, 'repo-wide');

// ---- fixed limits are gone, every call is sized -------------------------------------------------

test('no gh list call in github-pr-scan.md carries a fixed --limit', () => {
  assert.deepEqual(fixedLimitSites(LIVE), []);
  // Prove the helper. It sees the frozen pre-change fence's fixed limit ...
  assert.equal(fixedLimitSites(PRE_CHANGE_ITEM8).length, 1);
  // ... joins a `\`-continued call whose --limit is on the next line ...
  assert.equal(fixedLimitSites('gh pr list --state all --json number \\\n  --limit 200 > "$X"').length, 1);
  // ... passes a sized call ...
  assert.deepEqual(fixedLimitSites('gh issue list --state open --limit {resolved-limit}'), []);
  // ... sees the `--limit=N` form the stub also accepts ...
  assert.deepEqual(fixedLimitSites('gh issue list --limit=200 --json number'), ['200']);
  assert.deepEqual(limitSites('gh issue list --limit={resolved-limit} --json number'), ['{resolved-limit}']);
  // ... and ignores a comment that names a limit with no `gh … list` on the line.
  assert.deepEqual(fixedLimitSites('#    across `--state all --limit 200` exceed'), []);
});

test('every gh list call in github-pr-scan.md is sized from {resolved-limit}', () => {
  const sites = limitSites(LIVE);
  // current-pr item 4; repo-wide items 1, 3, 4 (x2), 5, 6, 7, 8, 9, 10 (x2).
  assert.equal(sites.length, 12, `expected 12 --limit sites, found: ${sites.join(' ')}`);
  assert.equal(sites.filter((t) => t === '{resolved-limit}').length, 12);
  // A call added with no --limit is one more `--json` call than sized site.
  assert.equal(jsonListCalls(LIVE).length, sites.length, 'every gh list call must carry --limit {resolved-limit}');
  assert.equal(jsonListCalls(`${LIVE}\n\ngh issue list --state open --json number`).length, sites.length + 1);
  assert.equal(jsonListCalls('the `gh issue list --state open` query already fetched').length, 0);
  // Prove the counter on a synthetic minimal pair.
  const sized = '`gh pr list --state merged --limit {resolved-limit}` AND `gh pr list --state closed --limit {resolved-limit}`';
  assert.equal(limitSites(sized).filter((t) => t === '{resolved-limit}').length, 2);
  const fixed = sized.replaceAll('{resolved-limit}', '50');
  assert.equal(limitSites(fixed).filter((t) => t === '{resolved-limit}').length, 0);
  assert.equal(fixedLimitSites(fixed).length, 2);
  assert.equal(limitSites('Every `gh pr list` call takes `--limit {resolved-limit}`').length, 0);
});

// ---- the Fetch limit rule -----------------------------------------------------------------------

test('current-pr and repo-wide each carry the Fetch limit rule', () => {
  assertRule(CURRENT_PR);
  assertRule(REPO_WIDE);
  for (const [name, slice] of [['current-pr', CURRENT_PR], ['repo-wide', REPO_WIDE]]) {
    // Go-red: the whole paragraph removed.
    const gone = slice.replace(RULE, '');
    assert.notEqual(gone, slice, `${name}: the rule must be present to remove`);
    assert.throws(() => assertRule(gone), { message: /Fetch limit/ }, `${name}: a scope without the rule must fail`);
    // Go-red: only the relay sentence removed, which pins "report every WARNING: line verbatim ... {N}+".
    const noRelay = slice.replace(RULE_LAST_SENTENCE, '');
    assert.notEqual(noRelay, slice, `${name}: the relay sentence must be present to remove`);
    assert.throws(() => assertRule(noRelay), { message: /Fetch limit/ }, `${name}: a rule without the relay sentence must fail`);
  }
});

test('the Output Contract\'s [queue] row renders a floor count', () => {
  const start = LIVE.indexOf('\n## Output Contract');
  assert.ok(start !== -1, 'Output Contract heading not found');
  const contract = LIVE.slice(start);
  const bullet = contract.split('\n').find((l) => l.startsWith('- `[queue]`'));
  assert.ok(bullet, 'the Output Contract must carry a [queue] bullet');
  const assertFloor = (b) => assert.ok(b.includes('{N}+'), 'the [queue] row must render a floor count as {N}+');
  assertFloor(bullet);
  const mutated = bullet.replace('{N}+', '{N}');
  assert.notEqual(mutated, bullet);
  assert.throws(() => assertFloor(mutated), { message: /floor count/ });
});

// ---- item 8: the open-issue fetch (#4820's observed symptom) -------------------------------------

const ITEM8_LABEL = '8. **Grant-queue counts**';
const issueRows = (n) => Array.from({ length: n }, (_, i) => ({ number: i + 1, title: `r${i + 1}`, labels: [] }));
const queueWarning = (n) => new RegExp(`^WARNING: \\[queue\\] fetched ${n} open issues, the backlog-fetch-limit cap — these counts are a floor$`, 'm');
// The spec's symptom: 308 open issues, a fetch capped at 200.
const UNIVERSE = 308;

test('item 8 reproduces #4820: the pre-change fence reports capped counts silently', () => {
  const run = runFence(PRE_CHANGE_ITEM8, { ghRows: issueRows(UNIVERSE) });
  assert.equal(run.status, 0, `item 8: the pre-change fence must exit 0: ${run.stderr}`);
  assert.deepEqual(JSON.parse(run.stdout), { pending: 0, blocked: 0, backlog: 200 }, `${UNIVERSE} open issues must read as 200`);
  assert.ok(!run.stderr.includes('WARNING:'), `the pre-change fence never warns: ${run.stderr}`);
  // The frozen text still describes the live fence apart from the two edits: it is the live fence with the
  // limit and the warning line reverted.
  const live = fenceAfter(REPO_WIDE, ITEM8_LABEL);
  const reverted = live
    .replace('--limit {resolved-limit}', '--limit 200')
    .replace(/^ {2}if \(issues\.length >= \{resolved-limit\}\).*\n/m, '');
  assert.notEqual(reverted, live);
  assert.equal(reverted, PRE_CHANGE_ITEM8, 'item 8: PRE_CHANGE_ITEM8 has drifted from the live fence');
});

for (const shell of ['bash', 'zsh']) {
  test(`item 8 counts the whole universe at a high limit and warns when the fetch reaches the limit (${shell})`, shellTestOptions(shell), () => {
    const fence = fenceAfter(REPO_WIDE, ITEM8_LABEL);
    // A limit above the universe counts all of it, with no warning.
    const whole = runFence(fence, { limit: 1000, ghRows: issueRows(UNIVERSE), shell });
    assert.equal(whole.status, 0, `item 8: the high-limit run must exit 0: ${whole.stderr}`);
    assert.deepEqual(JSON.parse(whole.stdout), { pending: 0, blocked: 0, backlog: UNIVERSE });
    assert.ok(!whole.stderr.includes('WARNING:'), whole.stderr);
    // The same universe at the old cap is truncated to 200, and now says so.
    const capped = runFence(fence, { limit: 200, ghRows: issueRows(UNIVERSE), shell });
    assert.equal(capped.status, 0, `item 8: the capped run must exit 0: ${capped.stderr}`);
    assert.deepEqual(JSON.parse(capped.stdout), { pending: 0, blocked: 0, backlog: 200 });
    assert.match(capped.stderr, queueWarning(200));
    if (shell !== 'bash') return;
    // A universe exactly the size of the limit cannot be told from a truncated one: it warns too.
    const exact = runFence(fence, { limit: 200, ghRows: issueRows(200) });
    assert.equal(exact.status, 0, `item 8: the exact-limit run must exit 0: ${exact.stderr}`);
    assert.match(exact.stderr, queueWarning(200));
    // One row under the limit is a real count: no warning.
    const under = runFence(fence, { limit: 200, ghRows: issueRows(199) });
    assert.equal(under.status, 0, `item 8: the under-limit run must exit 0: ${under.stderr}`);
    assert.ok(!under.stderr.includes('WARNING:'), under.stderr);
    // The open-issue fetch is unfiltered, so it paginates past 1000: 1000 rows under a limit of 1500 is not a cap ...
    const pastThousand = runFence(fence, { limit: 1500, ghRows: issueRows(1000) });
    assert.equal(pastThousand.status, 0, `item 8: the past-1000 run must exit 0: ${pastThousand.stderr}`);
    assert.ok(!pastThousand.stderr.includes('WARNING:'), pastThousand.stderr);
    // ... and reaching the limit itself is.
    const atLimit = runFence(fence, { limit: 1500, ghRows: issueRows(1500) });
    assert.equal(atLimit.status, 0, `item 8: the at-limit run must exit 0: ${atLimit.stderr}`);
    assert.match(atLimit.stderr, queueWarning(1500));
  });
}

// ---- item 4: the merged/closed branch cross-check ----------------------------------------------------

// The fence writes each PR list to a file and prints only the remnants, so up to `{resolved-limit}` rows per
// state never reach a Bash result; a list that reached the limit gets the `[pr]` cap row, printed by the block
// itself (the cross-check yields no count, so neither the WARNING nor the floor clause of the Fetch limit rule fires).
const ITEM4_LABEL = '4. **Merged/closed PRs with local remnants**';
const prRows = (n) => Array.from({ length: n }, (_, i) => ({ number: i + 1, headRefName: `branch-${i + 1}` }));
const capRow = (state, n) => `[pr] ${state} PR list: ${n} rows (the cap) — older ${state} branches unchecked — raise backlog-fetch-limit to check them`;

// A throwaway git repo carrying the named local branches, so the fence's `git branch --list` is the real one.
function repoWithBranches(names) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-scan-repo-'));
  const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.test', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.test' };
  const git = (...args) => {
    const r = spawnSync('git', ['-C', forwardSlashes(dir), ...args], { encoding: 'utf8', env });
    assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  };
  git('init', '--quiet');
  git('-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '--quiet', '-m', 'init');
  for (const n of names) git('branch', n);
  return dir;
}

for (const shell of ['bash', 'zsh']) {
  test(`item 4 prints only the local remnants and a cap row for each state whose list reached the limit (${shell})`, shellTestOptions(shell), () => {
    const fence = fenceAfter(REPO_WIDE, ITEM4_LABEL);
    const repo = repoWithBranches(['branch-2', 'branch-4', 'unrelated']);
    try {
      const run = (limit, rows, text = fence) => runFence(text.replaceAll('{REPO_ROOT}', forwardSlashes(repo)), { limit, ghRows: prRows(rows), shell });
      const remnants = ['merged PR #2 branch-2', 'merged PR #4 branch-4', 'closed PR #2 branch-2', 'closed PR #4 branch-4'];
      // A limit above the list: the remnants of both states, no cap row.
      const whole = run(1000, 5);
      assert.equal(whole.status, 0, `item 4: the high-limit run must exit 0: ${whole.stderr}`);
      assert.deepEqual(whole.stdout.trim().split('\n'), remnants);
      // The list truncated at the limit: both states say their older branches went unchecked, once each.
      const capped = run(5, 8);
      assert.equal(capped.status, 0, `item 4: the capped run must exit 0: ${capped.stderr}`);
      assert.deepEqual(capped.stdout.trim().split('\n'), [remnants[0], remnants[1], capRow('merged', 5), remnants[2], remnants[3], capRow('closed', 5)]);
      // A list exactly the size of the limit cannot be told from a truncated one: it says so too.
      assert.ok(run(5, 5).stdout.includes(capRow('merged', 5)), 'item 4: the exact-limit run must print the cap row');
      // One row under the limit is a whole list: no cap row.
      assert.ok(!run(6, 5).stdout.includes('(the cap)'), 'item 4: the under-limit run must not print the cap row');
      // 1000 rows per state stay out of the Bash result: only the remnants and the cap rows are printed.
      const big = run(1000, 1000);
      assert.equal(big.status, 0, `item 4: the 1000-row run must exit 0: ${big.stderr}`);
      assert.ok(big.stdout.length < 1000, `item 4: the 1000-row run printed ${big.stdout.length} chars`);
      assert.ok(big.stdout.includes(capRow('merged', 1000)) && big.stdout.includes(capRow('closed', 1000)));
      if (shell !== 'bash') return;
      // Go-red: a block without the comparison, or one that needs strictly more rows than the limit, fails the pinned cases.
      const noCheck = fence.replace(/^ +if \(prs\.length >= \{resolved-limit\}\).*\n/m, '');
      assert.notEqual(noCheck, fence, 'item 4: the cap comparison must be present to remove');
      assert.ok(!run(5, 8, noCheck).stdout.includes('(the cap)'));
      const strict = fence.replace('prs.length >= {resolved-limit}', 'prs.length > {resolved-limit}');
      assert.notEqual(strict, fence);
      assert.ok(!run(5, 5, strict).stdout.includes('(the cap)'));
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });
}

// ---- item 10: the unsettled-run join ---------------------------------------------------------------

const hoursAgo = (h) => new Date(Date.now() - h * 3600000).toISOString();
const UNSETTLED_WARNING = /^WARNING: \[unsettled\] the bot:in-progress fetch reached its cap — issues past it are unchecked$/m;
const PR_QUALIFIER = '(the PR fetch hit backlog-fetch-limit — an older PR may exist)';

test('item 10 warns at the bot:in-progress cap and qualifies no-PR rows at the PR-join cap', () => {
  const fence = fenceAfter(REPO_WIDE, '10. **Unsettled run**', 1);
  const labelled = (n) => Array.from({ length: n }, (_, i) => ({ number: i + 1, updatedAt: hoursAgo(48) }));
  // `gh pr list` returns newest first: every row but the last was created 1h ago, the last (the oldest fetched) `oldestHours` ago.
  // The labelled rows were last updated 48h ago and a claim entry is dated 48h ago, so the default 1h oldest row postdates both and 72h predates both.
  const prs = (n, oldestHours) => Array.from({ length: n }, (_, i) => ({ number: 9000 + i, url: `https://example.test/pull/${9000 + i}`, createdAt: hoursAgo(i === n - 1 ? oldestHours : 1), closingIssuesReferences: [] }));
  const run = (limit, labelledCount, prCount, fenceText = fence, oldestHours = 1, claimedCount = 0) => runFence(fenceText, {
    limit,
    env: { UNSETTLED_AGE: '24' },
    files: {
      'pr-scan-unsettled-claims.jsonl': Array.from({ length: claimedCount }, (_, i) => JSON.stringify({ number: 500 + i, claimedAt: hoursAgo(48), source: 'claim' })).join('\n'),
      'pr-scan-unsettled-labelled.json': labelled(labelledCount),
      'pr-scan-unsettled-prs.json': prs(prCount, oldestHours),
    },
  });
  // One claim-sourced candidate and no labelled rows: its claimedAt is the real claim time.
  const runClaim = (limit, prCount, fenceText = fence, oldestHours = 1) => run(limit, 0, prCount, fenceText, oldestHours, 1);

  // Both fetches at the limit: the label cap warns and each no-PR row says the PR join may be incomplete.
  const capped = run(2, 2, 2);
  assert.equal(capped.status, 0, capped.stderr);
  assert.match(capped.stderr, UNSETTLED_WARNING);
  const rows = capped.stdout.trim().split('\n');
  assert.equal(rows.length, 2, capped.stdout);
  for (const r of rows) {
    assert.match(r, /no PR found \d+h after claim \(the PR fetch hit backlog-fetch-limit — an older PR may exist\) — resume:/);
  }

  // Both fetches under the limit: a real result, no warning, no qualifier.
  const under = run(3, 2, 2);
  assert.equal(under.status, 0, under.stderr);
  assert.ok(!under.stderr.includes('WARNING:'), under.stderr);
  assert.ok(!under.stdout.includes('(the PR fetch hit'), under.stdout);
  assert.match(under.stdout, /no PR found \d+h after claim — resume:/);

  // Limit above GitHub's 1000 cap for a --label fetch: 1000 labelled rows is the cap, so it warns; two PRs is not.
  const labelCap = run(1500, 1000, 2);
  assert.equal(labelCap.status, 0, labelCap.stderr);
  assert.match(labelCap.stderr, UNSETTLED_WARNING);
  assert.ok(!labelCap.stdout.includes(PR_QUALIFIER), 'the PR fetch is unfiltered, so two rows under 1500 is not a cap');

  // Only the PR fetch hits the limit (3 PRs against a limit of 3, one labelled row): the qualifier is keyed on
  // the PR count alone, so it appears and the bot:in-progress warning does not.
  const assertPrOnlyCapped = (r) => {
    assert.equal(r.status, 0, r.stderr);
    assert.ok(!r.stderr.includes('WARNING:'), `PR-only cap: the labelled fetch is under the limit, so no warning: ${r.stderr}`);
    assert.ok(r.stdout.includes(PR_QUALIFIER), `PR-only cap: the no-PR row must carry the PR-fetch qualifier: ${r.stdout}`);
  };
  assertPrOnlyCapped(run(3, 1, 3));

  // A capped PR fetch whose oldest row predates a claim already reached back past it, so a PR for the claim would
  // have been fetched: the no-PR row is a real result, with no qualifier. Computed per claim against its own claimedAt.
  const assertCappedPredatesClaim = (r) => {
    assert.equal(r.status, 0, r.stderr);
    assert.ok(!r.stderr.includes('WARNING:'), `predates-claim: the labelled fetch is under the limit, so no warning: ${r.stderr}`);
    assert.match(r.stdout, /no PR found \d+h after claim — resume:/, `predates-claim: the no-PR row must be unqualified: ${r.stdout}`);
    assert.ok(!r.stdout.includes('(the PR fetch hit'), `predates-claim: a capped fetch reaching back past the claim carries no qualifier: ${r.stdout}`);
  };
  assertCappedPredatesClaim(runClaim(3, 3, fence, 72));
  // A claim whose PR fetch is capped and whose oldest row postdates it is qualified.
  const assertClaimPrOnlyCapped = (r) => {
    assert.equal(r.status, 0, r.stderr);
    assert.ok(r.stdout.includes(PR_QUALIFIER), `claim PR-only cap: the no-PR row must carry the PR-fetch qualifier: ${r.stdout}`);
  };
  assertClaimPrOnlyCapped(runClaim(3, 3));
  // A label's claimedAt is its issue's updatedAt, an upper bound on the real claim time: an oldest row that predates it
  // proves nothing about the real claim, so a capped fetch always qualifies a label-sourced no-PR row.
  const assertLabelQualified = (r) => {
    assert.equal(r.status, 0, r.stderr);
    assert.ok(r.stdout.includes(PR_QUALIFIER), `label-sourced: a capped fetch must qualify the no-PR row even when its oldest row predates updatedAt: ${r.stdout}`);
  };
  assertLabelQualified(run(3, 1, 3, fence, 72));

  // Go-red: a qualifier keyed on any count other than the PR count comes out wrong on that case.
  const PR_CAPPED_LINE = 'const PR_CAPPED = prs.length >= LIMIT;';
  assert.ok(fence.includes(PR_CAPPED_LINE), 'the PR_CAPPED line must be present to mutate');
  for (const wrong of ["require('$PR_SCAN_UNSETTLED_LABELLED').length", 'candidates.length']) {
    const mutated = fence.replace(PR_CAPPED_LINE, `const PR_CAPPED = ${wrong} >= LIMIT;`);
    assert.notEqual(mutated, fence);
    assert.throws(() => assertPrOnlyCapped(run(3, 1, 3, mutated)), { message: /PR-only cap/ }, `a qualifier keyed on ${wrong} must fail the PR-only case`);
  }

  // Go-red: the qualifier must also depend on the oldest fetched PR's createdAt against the candidate's claimedAt.
  const GATE = "PR_CAPPED && (source === 'label' || OLDEST_PR > Date.parse(claimedAt)) ?";
  assert.ok(fence.includes(GATE), 'the createdAt/claimedAt gate must be present to mutate');
  const noDate = fence.replace(GATE, 'PR_CAPPED ?');
  assert.notEqual(noDate, fence);
  assert.throws(() => assertCappedPredatesClaim(runClaim(3, 3, noDate, 72)), { message: /predates-claim/ }, 'a qualifier with no createdAt check must fail the predates-claim case');
  const reversed = fence.replace(GATE, "PR_CAPPED && (source === 'label' || OLDEST_PR < Date.parse(claimedAt)) ?");
  assert.notEqual(reversed, fence);
  assert.throws(() => assertClaimPrOnlyCapped(runClaim(3, 3, reversed)), { message: /claim PR-only cap/ }, 'a reversed createdAt comparison must fail the claim PR-only case');
  assert.throws(() => assertCappedPredatesClaim(runClaim(3, 3, reversed, 72)), { message: /predates-claim/ }, 'a reversed createdAt comparison must fail the predates-claim case');
  // A gate that trusts a label's updatedAt as the claim time drops the qualifier from a label-sourced row.
  const noLabelBranch = fence.replace(GATE, 'PR_CAPPED && OLDEST_PR > Date.parse(claimedAt) ?');
  assert.notEqual(noLabelBranch, fence);
  assert.throws(() => assertLabelQualified(run(3, 1, 3, noLabelBranch, 72)), { message: /label-sourced/ }, 'a gate with no label branch must fail the label-sourced case');
  // The oldest row is the minimum createdAt, not the first or last row's: a fence reading the first (newest) row sees 1h ago.
  const firstRow = fence.replace('Math.min(...prs.map((pr) => Date.parse(pr.createdAt)))', 'Date.parse(prs[0].createdAt)');
  assert.notEqual(firstRow, fence);
  assert.throws(() => assertCappedPredatesClaim(runClaim(3, 3, firstRow, 72)), { message: /predates-claim/ }, 'reading the newest row instead of the oldest must fail the predates-claim case');
});

// ---- the gh stub itself ----------------------------------------------------------------------------

test('the gh stub honours --limit=N as well as --limit N', () => {
  const rows = [{ number: 1 }, { number: 2 }, { number: 3 }];
  const joined = runFence('gh issue list --limit=2 --json number', { ghRows: rows });
  assert.equal(joined.status, 0, joined.stderr);
  assert.equal(JSON.parse(joined.stdout).length, 2, joined.stdout);
  const spaced = runFence('gh issue list --limit 2 --json number', { ghRows: rows });
  assert.equal(JSON.parse(spaced.stdout).length, 2, spaced.stdout);
  // No --limit at all serves every row.
  assert.equal(JSON.parse(runFence('gh issue list --json number', { ghRows: rows }).stdout).length, 3);
});

// ---- the triage-queue scope (github-pr-scan-triage.md) -----------------------------------------------

const TRIAGE = readText(path.join(PLUGIN_DIR, 'skills', '_shared', 'github-pr-scan-triage.md'));
const TRIAGE_ITEM1_LABEL = '1. **Pending authorization**';

test('no gh list call in github-pr-scan-triage.md carries a fixed --limit', () => {
  assert.deepEqual(fixedLimitSites(TRIAGE), []);
  // Items 1 (ready) and 2 (blocked) are the two sized fetches; item 3 is a commits-endpoint call with no --limit.
  assert.deepEqual(limitSites(TRIAGE), ['{resolved-limit}', '{resolved-limit}']);
  assert.equal(jsonListCalls(TRIAGE).length, 2, 'every gh list call in the triage scope must carry --limit {resolved-limit}');
});

test('triage-queue carries the Fetch limit rule and the floor render', () => {
  assertRule(TRIAGE);
  // Go-red: the whole paragraph removed.
  const gone = TRIAGE.replace(RULE, '');
  assert.notEqual(gone, TRIAGE, 'the rule must be present to remove');
  assert.throws(() => assertRule(gone), { message: /Fetch limit/ }, 'a scope without the rule must fail');
  // Go-red: only the relay sentence removed, which pins the verbatim WARNING relay and the `{N}+` floor render.
  const noRelay = TRIAGE.replace(RULE_LAST_SENTENCE, '');
  assert.notEqual(noRelay, TRIAGE, 'the relay sentence must be present to remove');
  assert.throws(() => assertRule(noRelay), { message: /Fetch limit/ }, 'a rule without the relay sentence must fail');
});

// Item 1 exactly as it read before #4820 (github-pr-scan-triage.md): a fixed `--limit 200` and a node
// block that never compares the row count to the limit.
const PRE_CHANGE_TRIAGE_ITEM1 = `TRIAGE_QUEUE_READY="$(node "\${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" --value triage-queue-ready.json)"
gh issue list --label ready --state open --json number,labels --limit 200 > "$TRIAGE_QUEUE_READY"
node -e "
  const { parseRecordFacets } = require('\${CLAUDE_PLUGIN_ROOT}/bin/lib/issues/record.js');
  const { isPendingAuthorization } = require('\${CLAUDE_PLUGIN_ROOT}/bin/lib/issues/pending-authorization.js');
  const issues = require('$TRIAGE_QUEUE_READY');
  const pending = issues.filter((i) => isPendingAuthorization(parseRecordFacets(i.labels))).length;
  console.log(pending);
"`;

const readyRows = (n) => Array.from({ length: n }, (_, i) => ({ number: i + 1, labels: [{ name: 'ready' }] }));
const TRIAGE_WARNING = /^WARNING: \[triage\] the ready fetch reached its cap — the pending count is a floor$/m;
// The ready universe measured at plan time was 324 records.
const READY_UNIVERSE = 324;

test('triage item 1 reproduces #4820: the pre-change fence reports a capped pending count silently', () => {
  const run = runFence(PRE_CHANGE_TRIAGE_ITEM1, { ghRows: readyRows(READY_UNIVERSE) });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout.trim(), '200', `${READY_UNIVERSE} ready records must read as 200`);
  assert.ok(!run.stderr.includes('WARNING:'), `the pre-change fence never warns: ${run.stderr}`);
  // The frozen text still describes the live fence apart from the two edits: it is the live fence with the
  // limit and the warning line reverted.
  const live = fenceAfter(TRIAGE, TRIAGE_ITEM1_LABEL);
  const reverted = live
    .replace('--limit {resolved-limit}', '--limit 200')
    .replace(/^ {2}if \(issues\.length >= Math\.min\(\{resolved-limit\}, 1000\)\).*\n/m, '');
  assert.notEqual(reverted, live);
  assert.equal(reverted, PRE_CHANGE_TRIAGE_ITEM1);
});

// The four cap cases for item 1, written once: the bash/zsh test runs them per shell, the go-red test runs them on mutants.
// Limit 2 against 2 rows reached its cap, so the count is a floor and the fence says so; limit 3 against 2 is a real count;
// the fetch is --label filtered, so GitHub caps it at 1000 whatever --limit says: 1000 rows under 1500 is the cap, 999 is not.
const assertItem1CapCases = (f, shell = 'bash') => {
  // Every run must exit 0, so a fence that crashes on a no-warn path cannot pass as "no WARNING:".
  const run = (limit, rows) => {
    const r = runFence(f, { limit, ghRows: readyRows(rows), shell });
    assert.equal(r.status, 0, `item 1: the fence must exit 0 (limit ${limit}, ${rows} rows): ${r.stderr}`);
    return r;
  };
  const capped = run(2, 2);
  assert.equal(capped.stdout.trim(), '2', 'item 1: the capped count still prints');
  assert.match(capped.stderr, TRIAGE_WARNING, 'item 1: a fetch at the limit must warn');
  assert.ok(!run(3, 2).stderr.includes('WARNING:'), 'item 1: a fetch under the limit must not warn');
  assert.match(run(1500, 1000).stderr, TRIAGE_WARNING, 'item 1: 1000 rows is the --label cap and must warn');
  assert.ok(!run(1500, 999).stderr.includes('WARNING:'), 'item 1: 999 rows under a 1500 limit must not warn');
};

for (const shell of ['bash', 'zsh']) {
  test(`triage item 1 counts the whole ready universe at a high limit and warns at the cap (${shell})`, shellTestOptions(shell), () => {
    const fence = fenceAfter(TRIAGE, TRIAGE_ITEM1_LABEL);
    // The live fence at the 1000 default counts the whole 324, with no warning.
    const whole = runFence(fence, { limit: 1000, ghRows: readyRows(READY_UNIVERSE), shell });
    assert.equal(whole.status, 0, whole.stderr);
    assert.equal(whole.stdout.trim(), String(READY_UNIVERSE));
    assert.ok(!whole.stderr.includes('WARNING:'), whole.stderr);
    assertItem1CapCases(fence, shell);
  });
}

test('triage item 1 go-red: a threshold that drops the label cap, or the comparison, fails the pinned cases', () => {
  const fence = fenceAfter(TRIAGE, TRIAGE_ITEM1_LABEL);
  const CHECK = 'issues.length >= Math.min({resolved-limit}, 1000)';
  assert.ok(fence.includes(CHECK), 'the threshold must be present to mutate');
  assertItem1CapCases(fence);
  for (const wrong of ['issues.length >= {resolved-limit}', 'issues.length > Math.min({resolved-limit}, 1000)', 'issues.length >= Math.max({resolved-limit}, 1000)']) {
    const mutated = fence.replace(CHECK, wrong);
    assert.notEqual(mutated, fence);
    assert.throws(() => assertItem1CapCases(mutated), { message: /item 1:/ }, `a threshold of "${wrong}" must fail a pinned case`);
  }
  // A fence that crashes on a no-warn path (999 rows, under the cap) prints no WARNING:, so only the exit-status check catches it.
  const crashing = fence.replace('console.log(pending);', 'console.log(pending); if (issues.length === 999) process.exit(3);');
  assert.notEqual(crashing, fence);
  assert.throws(() => assertItem1CapCases(crashing), { message: /item 1: the fence must exit 0 \(limit 1500, 999 rows\)/ }, 'a crash on the no-warn path must fail the status check');
});
