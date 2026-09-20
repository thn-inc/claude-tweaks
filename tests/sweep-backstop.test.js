'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

// #414: Sweep backstop — unarmed ready PRs, unsettled runs, tidy housekeeping
// auto-merge grant. Prose-as-implementation, same convention as the other
// pr-first sub-issues' test files — pin the key claims against the actual
// file text, plus syntax-check every embedded node -e script (a real
// mechanical check beyond regex pinning, since these scripts are meant to
// be copy-paste executable).

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const SCAN = read('plugin', 'skills', '_shared', 'github-pr-scan.md');
const STEP6 = read('plugin', 'skills', 'tidy', 'step-6-auto.md');
const TIDY_SKILL = read('plugin', 'skills', 'tidy', 'SKILL.md');
const TIDY_STEP75_WORKTREE = read('plugin', 'skills', 'tidy', 'step-7-5-worktree-always.md');
const ACTIONS_GH = read('plugin', 'skills', 'tidy', 'actions-github-issues.md');
const POLICY_SCHEMA_MD = read('plugin', 'skills', '_shared', 'policy-schema.md');
const { POLICY_KEYS } = require('../plugin/bin/lib/policy-schema');
const { composedBytesReport, overComposedCeiling } = require('../plugin/bin/lib/skill-audit/context-cost.js');

// --- Extract and syntax-check every `node -e "..."` script in the two new items ---

function extractItemSection(text, startMarker, endMarker) {
  const start = text.indexOf(startMarker);
  const end = text.indexOf(endMarker, start);
  assert.ok(start > 0, `could not find start marker: ${startMarker}`);
  assert.ok(end > start, `could not find end marker: ${endMarker}`);
  return text.slice(start, end);
}

// Matches `node -e "` ... closing `"` at the start of a line (the file's own
// convention — every node -e block in this file closes with a bare `"` line).
function extractNodeScripts(section) {
  const scripts = [];
  const re = /node -e "\n([\s\S]*?)\n\s*"/g;
  let m;
  while ((m = re.exec(section)) !== null) {
    // Un-escape the shell-double-quoted script body the same way bash would:
    // \" -> ", \\ -> \. This file only ever escapes double quotes inside
    // these blocks (verified below), so this is a safe, narrow unescape.
    scripts.push(m[1].replace(/\\"/g, '"').replace(/\\\$/g, '$'));
  }
  return scripts;
}

function assertAllSyntaxValid(scripts, label) {
  assert.ok(scripts.length > 0, `expected at least one node -e script in ${label}`);
  for (const [i, script] of scripts.entries()) {
    const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ct-sweep-syntax-')), `script-${i}.js`);
    fs.writeFileSync(tmp, script);
    assert.doesNotThrow(
      () => execFileSync('node', ['--check', tmp], { stdio: 'pipe' }),
      `${label} script #${i} has a syntax error:\n${script}`,
    );
  }
}

const ITEM9 = extractItemSection(SCAN, '9. **Unarmed ready PR**', '10. **Unsettled run**');
const ITEM10 = extractItemSection(SCAN, '10. **Unsettled run**', '\nFindings and recommendations');

test('item 9 (unarmed ready PR): every embedded node -e script is syntactically valid', () => {
  assertAllSyntaxValid(extractNodeScripts(ITEM9), 'item 9');
});

test('item 10 (unsettled run): every embedded node -e script is syntactically valid', () => {
  assertAllSyntaxValid(extractNodeScripts(ITEM10), 'item 10');
});

// #438: item 9's green-check filter must treat a permanently-conditional-skip
// check (SKIPPED/NEUTRAL) as non-blocking, not as a failure — otherwise the
// filter can never find a candidate on any PR carrying such a check (e.g.
// track-issue-fixes.yml's default-branch-only cleanup-fix-labels job, which
// reports SKIPPED on every feature-branch PR). Runs item 9's actual embedded
// candidate-filter script (not just a syntax check) against a fixture PR
// list, isolated to a session-scoped temp directory so it never touches the
// script's hardcoded /tmp/pr-scan-unarmed*.json paths shared with a live sweep.
test("item 9's green-check filter treats SKIPPED as non-blocking, not a failure (regression)", () => {
  const filterScript = extractNodeScripts(ITEM9)[0];
  assert.ok(
    filterScript && /PR_SCAN_UNARMED_CANDIDATES/.test(filterScript),
    'expected the first item-9 script to be the candidate filter (writes $PR_SCAN_UNARMED_CANDIDATES)',
  );

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-item9-filter-'));
  const inputPath = path.join(tmpDir, 'pr-scan-unarmed.json');
  const candidatesPath = path.join(tmpDir, 'pr-scan-unarmed-candidates.json');

  // Source-text substitution standing in for bash's own $VAR expansion — the
  // script closes over these as the session-scoped shell variables
  // github-pr-scan.md's own `eval "$(session-tmp-resolve.js ...)"` line
  // resolves (_shared/session-tmp-root.md), never literal paths, so running
  // it standalone here (outside that bash fence) requires substituting them
  // ourselves first. Longer name first — $PR_SCAN_UNARMED is a prefix of
  // $PR_SCAN_UNARMED_CANDIDATES.
  const isolatedScript = filterScript
    .split('$PR_SCAN_UNARMED_CANDIDATES').join(candidatesPath)
    .split('$PR_SCAN_UNARMED').join(inputPath);

  // Comfortably older than the pr-unarmed-age-hours default (24h) used below,
  // so the age filter doesn't trip first and mask the conclusion-filter
  // behavior under test.
  const oldEnough = new Date(Date.now() - 25 * 3600000).toISOString();
  const fixturePrs = [
    {
      // Positive case: SUCCESS + SKIPPED must still be "green".
      number: 1001,
      title: 'positive: SUCCESS + SKIPPED is green',
      isDraft: false,
      autoMergeRequest: null,
      updatedAt: oldEnough,
      statusCheckRollup: [{ conclusion: 'SUCCESS' }, { conclusion: 'SKIPPED' }],
      body: '<!-- claude-tweaks-run: 2026-01-01T000000-record-1001 -->',
    },
    {
      // Negative control: identical except one conclusion is a real FAILURE —
      // isolates the SKIPPED-handling behavior as the one varying dimension;
      // without this, a test that can't go red would prove nothing.
      number: 1002,
      title: 'negative control: a real FAILURE is still excluded',
      isDraft: false,
      autoMergeRequest: null,
      updatedAt: oldEnough,
      statusCheckRollup: [{ conclusion: 'SUCCESS' }, { conclusion: 'FAILURE' }],
      body: '<!-- claude-tweaks-run: 2026-01-01T000000-record-1002 -->',
    },
  ];
  fs.writeFileSync(inputPath, JSON.stringify(fixturePrs));

  const scriptPath = path.join(tmpDir, 'item9-filter.js');
  fs.writeFileSync(scriptPath, isolatedScript);
  execFileSync('node', [scriptPath], {
    env: { ...process.env, UNARMED_AGE: '24' },
    stdio: 'pipe',
  });

  const candidateNumbers = JSON.parse(fs.readFileSync(candidatesPath, 'utf8')).map((c) => c.number);
  assert.ok(
    candidateNumbers.includes(1001),
    'PR with SUCCESS + SKIPPED conclusions should be a candidate — SKIPPED must not be treated as a failure',
  );
  assert.ok(
    !candidateNumbers.includes(1002),
    'PR with a real FAILURE conclusion should be excluded — proves the assertion actually discriminates',
  );
});

// --- Key prose claims ---

test('item 9 detects plugin-created PRs purely GitHub-side, via either marker', () => {
  assert.match(ITEM9, /<!-- claude-tweaks-run: \{run-id\} -->/);
  assert.match(ITEM9, /<!-- tidy-housekeeping-pr -->/);
  assert.match(ITEM9, /no local run-dir join/);
});

// Review finding (whole-branch review, e90376a4..HEAD): the wrap-up-residue-pr marker
// (wrap-up/residue-sweep.md's pr-first landing path) used to be explicitly excluded from this
// safety net, despite residue-sweep.md's own prose calling it the same low-judgment,
// purely-mechanical shape as a tidy Step-7 commit. Both the candidate filter's HOUSEKEEPING_MARKER
// and the grant classifier's isHousekeeping now recognize it too, on the same housekeeping-auto-merge
// lever — pinned here both as a prose claim and by actually running the embedded filter script
// against a fixture PR carrying only the wrap-up-residue-pr marker.
test('item 9 also recognizes wrap-up-residue-pr as a mechanical-housekeeping marker (finding regression)', () => {
  assert.match(ITEM9, /<!-- wrap-up-residue-pr -->/);
  assert.match(ITEM9, /HOUSEKEEPING_MARKER = \/<!-- \(\?:tidy-housekeeping-pr\|wrap-up-residue-pr\) -->\//);
  assert.match(ITEM9, /isHousekeeping = \/<!-- \(\?:tidy-housekeeping-pr\|wrap-up-residue-pr\) -->\/\.test/);
});

test("item 9's filter script treats a wrap-up-residue-pr-marked PR as a housekeeping candidate (finding regression)", () => {
  const filterScript = extractNodeScripts(ITEM9)[0];
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-item9-residue-'));
  const inputPath = path.join(tmpDir, 'pr-scan-unarmed.json');
  const candidatesPath = path.join(tmpDir, 'pr-scan-unarmed-candidates.json');
  // Longer name first — $PR_SCAN_UNARMED is a prefix of $PR_SCAN_UNARMED_CANDIDATES.
  const isolatedScript = filterScript
    .split('$PR_SCAN_UNARMED_CANDIDATES').join(candidatesPath)
    .split('$PR_SCAN_UNARMED').join(inputPath);

  const oldEnough = new Date(Date.now() - 25 * 3600000).toISOString();
  fs.writeFileSync(inputPath, JSON.stringify([{
    number: 2001,
    title: 'wrap-up residue: archive merged run dirs',
    isDraft: false,
    autoMergeRequest: null,
    updatedAt: oldEnough,
    statusCheckRollup: [{ conclusion: 'SUCCESS' }],
    body: '<!-- wrap-up-residue-pr -->',
  }]));

  const scriptPath = path.join(tmpDir, 'item9-residue-filter.js');
  fs.writeFileSync(scriptPath, isolatedScript);
  execFileSync('node', [scriptPath], { env: { ...process.env, UNARMED_AGE: '24' }, stdio: 'pipe' });

  const candidateNumbers = JSON.parse(fs.readFileSync(candidatesPath, 'utf8')).map((c) => c.number);
  assert.ok(candidateNumbers.includes(2001), 'a PR carrying only the wrap-up-residue-pr marker must be a candidate');
});

test('item 9 re-verifies unresolved threads per candidate, never against the full open-PR list', () => {
  assert.match(ITEM9, /run once per\s*\n?\s*\*\*candidate\*\*, never against the full open-PR list/);
});

test('item 9 never trusts the list-time snapshot for the actual write', () => {
  assert.match(ITEM9, /The list-time snapshot above is never trusted for the actual write/);
  assert.match(ITEM9, /re-read immediately before `gh pr merge --auto` runs/);
});

test('item 9 shares one [pr-unarmed] prefix for both granted and ungranted outcomes', () => {
  assert.match(ITEM9, /Both outcomes share the `\[pr-unarmed\]` prefix/);
});

test('item 10 unions claim-blob and bot:in-progress evidence, since they can drift apart', () => {
  assert.match(ITEM10, /a claim\/\s*\n\s*#\s*label drift case/);
});

test('item 10 reverse-joins via closingIssuesReferences, no marker regex needed', () => {
  assert.match(ITEM10, /no marker regex\s*\n\s*#\s*needed here/);
});

test('item 10: no PR at all qualifies unconditionally; a PR qualifies only when progress is no more recent than claimedAt', () => {
  assert.match(ITEM10, /No PR found\*\* qualifies unconditionally/);
  assert.match(ITEM10, /no more recent than the claim's `claimedAt`/);
});

test('item 10 resume command is read verbatim from the PR body when a PR exists, reconstructed only when none exists', () => {
  assert.match(ITEM10, /read and report it verbatim rather than reconstructing it/);
  assert.match(ITEM10, /the reconstructed command above starts from `reconcile`/);
});

test('the anti-pattern entry names self-scheduled per-PR check-in loops and states the replacement', () => {
  assert.match(SCAN, /Anti-pattern: a self-scheduled per-PR check-in loop\./);
  assert.match(SCAN, /that durability lives in GitHub's own `--auto`.*plus this scheduled sweep/s);
});

// --- Output Contract / Severity mapping / Findings table ---

test('the Output Contract documents both new prefixes with their row shapes', () => {
  assert.match(SCAN, /`\[pr-unarmed\]` — a green, gate-passed, plugin-created PR/);
  assert.match(SCAN, /`\[unsettled\]` — a claimed or `bot:in-progress` issue/);
});

test('the severity mapping assigns distinct severities to granted vs. ungranted unarmed PRs', () => {
  assert.match(SCAN, /Unarmed ready PR, granted \(item 9\).*\| medium \|/);
  assert.match(SCAN, /Unarmed ready PR, ungranted \(item 9\).*\| info \|/);
  assert.match(SCAN, /Unsettled run \(item 10\).*\| medium \|/);
});

test('existing severity rows are unchanged (delta review — AC4)', () => {
  const PRE_EXISTING_ROWS = [
    '| Failing CI or `CHANGES_REQUESTED` on any open PR (current branch\'s or repo-wide) | high |',
    '| Unresolved review threads | medium |',
    '| Stale open PR (>4 weeks) | medium |',
    '| Open PR superseded (related work already merged) | medium |',
    '| Merged/closed PR with local branch/worktree remnants | medium |',
    '| Code-health/harness-health/journey-health/docs-health issue stale/superseded | medium |',
    '| Code-health/harness-health/journey-health/docs-health issue still valid, awaiting `/claude-tweaks:backlog refine` | low |',
    '| Open PR awaiting review (not draft, not yet `Stale`, 0 unresolved threads, CI clean) | info |',
    '| Closed record with no acceptance disposition (`acceptance-gap` scope) | info |',
    '| Decomposition parent complete with no acceptance disposition (`parent-gate` scope) | info |',
    '| Fresh draft PR / no PR / scan skipped | info |',
  ];
  for (const row of PRE_EXISTING_ROWS) {
    assert.ok(SCAN.includes(row), `pre-existing severity row missing or altered: ${row}`);
  }
});

// --- Policy keys: threshold defaults and grant, no hardcoded literals in prose ---

test('pr-unarmed-age-hours and unsettled-age-hours are registered with a 24-hour default each', () => {
  const unarmed = POLICY_KEYS.find((k) => k.key === 'pr-unarmed-age-hours');
  const unsettled = POLICY_KEYS.find((k) => k.key === 'unsettled-age-hours');
  assert.ok(unarmed, 'pr-unarmed-age-hours key not found');
  assert.strictEqual(unarmed.type, 'integer');
  assert.strictEqual(unarmed.default, 24);
  assert.ok(unsettled, 'unsettled-age-hours key not found');
  assert.strictEqual(unsettled.type, 'integer');
  assert.strictEqual(unsettled.default, 24);
});

test('housekeeping-auto-merge row: boolean, static default false (the supervised base — effective default derives from autonomy, #580)', () => {
  const key = POLICY_KEYS.find((k) => k.key === 'housekeeping-auto-merge');
  assert.ok(key, 'housekeeping-auto-merge key not found');
  assert.strictEqual(key.type, 'boolean');
  assert.strictEqual(key.default, false);
});

test('all three new keys are documented in policy-schema.md', () => {
  assert.match(POLICY_SCHEMA_MD, /`pr-unarmed-age-hours`/);
  assert.match(POLICY_SCHEMA_MD, /`unsettled-age-hours`/);
  assert.match(POLICY_SCHEMA_MD, /`housekeeping-auto-merge`/);
});

test('the scan resolves thresholds via resolve-policy.js, never a hardcoded literal', () => {
  assert.match(ITEM9, /resolve-policy\.js" --values pr-unarmed-age-hours/);
  assert.match(ITEM9, /resolve-policy\.js" --values housekeeping-auto-merge/);
  assert.match(ITEM10, /resolve-policy\.js" --values unsettled-age-hours/);
});

// --- tidy/step-6-auto.md: arm-housekeeping only auto-applies under the grant at moderate+ ---

test('step-6-auto.md: the housekeeping-marker flavor of Arm ready PR auto-applies only at moderate+, under the grant', () => {
  const row = STEP6.match(/\| \*\*Arm ready PR\*\* \(a green, gate-passed, `\[pr-unarmed\]` PR granted via `housekeeping-auto-merge`[^\n]*\n/);
  assert.ok(row, 'housekeeping Arm ready PR row not found');
  assert.match(row[0], /\| Stage \| Auto-apply — only under the grant/);
});

test('step-6-auto.md: the record-linked flavor of Arm ready PR always stages, at every tier', () => {
  const row = STEP6.match(/\| \*\*Arm ready PR\*\* \(item 9's other granted flavor[^\n]*\n/);
  assert.ok(row, 'record-linked Arm ready PR row not found');
  assert.match(row[0], /\| Stage \| Stage \| Stage/);
});

test('step-6-auto.md: ungranted unarmed PRs and unsettled runs never auto-apply at any tier', () => {
  const ungrantedRow = STEP6.match(/\| \*\*Unarmed ready PR, ungranted\*\*[^\n]*\n/);
  const unsettledRow = STEP6.match(/\| \*\*Unsettled run\*\*[^\n]*\n/);
  assert.ok(ungrantedRow && unsettledRow, 'expected both rows to exist');
  assert.match(ungrantedRow[0], /Auto \(no-op, always surfaced\) \| Auto \(no-op, always surfaced\) \| Auto \(no-op, always surfaced\)/);
  assert.match(unsettledRow[0], /Auto \(no-op, always surfaced\) \| Auto \(no-op, always surfaced\) \| Auto \(no-op, always surfaced\)/);
});

// --- Arm ready PR action: re-verification before write, delegates to pr-first-merge.md ---

test('actions-github-issues.md\'s Arm ready PR re-verifies every gate fresh before writing, never trusting the scan snapshot', () => {
  assert.match(ACTIONS_GH, /## Arm ready PR/);
  assert.match(ACTIONS_GH, /Re-verify before writing — never trust the scan's own snapshot/);
  assert.match(ACTIONS_GH, /this is a silent\s*\n?\s*no-op: skip it, don't error/);
});

test('actions-github-issues.md\'s Arm ready PR delegates merge mechanics to pr-first-merge.md, per the Non-Goals (no new merge mechanics)', () => {
  assert.match(ACTIONS_GH, /run `_shared\/pr-first-merge\.md`'s Step 3/);
  assert.match(ACTIONS_GH, /so this\s*\n?\s*action does not reimplement it/);
});

test('tidy/SKILL.md registers Arm ready PR in the Action Vocabulary table', () => {
  assert.match(TIDY_SKILL, /\*\*Arm ready PR\*\* \| A green, gate-passed, granted PR/);
});

test('tidy/SKILL.md Step 7 documents the marker and grant, and states the marker is stamped under pr-first + worktree-always (#424)', () => {
  assert.match(TIDY_STEP75_WORKTREE, /<!-- tidy-housekeeping-pr -->/);
  assert.match(TIDY_STEP75_WORKTREE, /`housekeeping-auto-merge` set project-wide/);
  assert.match(TIDY_STEP75_WORKTREE, /this run's commit is pushed as a PR by the `worktree-always` handling above/);
  assert.doesNotMatch(TIDY_SKILL, /As of this writing, Step 7 above does not itself open a PR/);
});

test('tidy/SKILL.md Step 7.5 opens a marker-stamped PR under pr-first + worktree-always, reusing pr-early-run-lifecycle.md rather than a second implementation (#424)', () => {
  assert.match(TIDY_STEP75_WORKTREE, /skip §5-6's merge-back/);
  assert.match(TIDY_STEP75_WORKTREE, /reusing `_shared\/pr-early-run-lifecycle\.md`'s Step 1 shape/);
  assert.match(TIDY_STEP75_WORKTREE, /Step 3 shape \(compose the body, `gh pr create --base/);
  assert.match(TIDY_STEP75_WORKTREE, /never `--draft` here/);
  assert.match(TIDY_STEP75_WORKTREE, /Stamp `<!-- tidy-housekeeping-pr -->` in the body at creation/);
  assert.match(TIDY_STEP75_WORKTREE, /never Step 4's `record-pr`\/phase-checklist machinery/);
});

test("tidy/SKILL.md Step 7.5 opens the pr-first PR ready (not draft), since tidy's own judgment layer already passed by creation time (#424)", () => {
  assert.match(TIDY_STEP75_WORKTREE, /Arm ready PR action explicitly never touches Step 2 \(Mark the PR ready\)/);
  assert.match(TIDY_STEP75_WORKTREE, /item 9's own filter skips any PR still in draft/);
});

test('tidy/SKILL.md Step 7.5 leaves the local-merge / no-worktree-always path unchanged and falls back to it if the PR-open path fails (#424)', () => {
  assert.match(TIDY_STEP75_WORKTREE, /\*\*`local-merge`\*\* \(including an unresolved\/undetectable model/);
  assert.match(TIDY_STEP75_WORKTREE, /fall through to the `local-merge` branch above and merge back locally instead/);
});

// --- integration-model.md conformance (mirrors the repo-wide test.js's own check) ---

test('every new/edited file mentioning integration-model cites the shared fragment', () => {
  const FRAGMENT = '_shared/integration-model.md';
  for (const [name, text] of [['tidy/SKILL.md', TIDY_SKILL]]) {
    if (/integration-model/.test(text)) {
      assert.ok(text.includes(FRAGMENT), `${name} mentions integration-model without citing ${FRAGMENT}`);
    }
  }
});

// --- Composed-bytes gate on the one touched file that is a compose source ---
//
// step-6-auto.md, tidy/SKILL.md, and actions-github-issues.md carried a raw
// 40 KB per-file assertion here, but none of the three is a compose call
// site's source — since #1990 the per-file 40 KB ceiling is a warning tier,
// not a hard gate, and these three have no composed gate to retarget to.
// Per-file 40 KB pins on these files retired by #1997 — the per-file tier is
// a warning since #1990 and these files have no compose call site; removal
// condition in docs/incident-log.md [IL-153].
//
// github-pr-scan.md IS a compose source (scan-procedures.md's `pr-scan` step,
// #1992), so it keeps a hard gate here — retargeted to the composed
// bundle at that call site rather than the raw file, since the `pr-scan`
// composed gate (#1992) is what actually guards this file's reader-facing
// cost now.
test('github-pr-scan.md stays under the pr-scan composed-bytes ceiling', () => {
  const PLUGIN_ROOT = path.join(ROOT, 'plugin');
  // Guard against a vacuous pass (#1997): if the `pr-scan` call site is ever
  // removed or renamed, the filter below yields [] regardless of whether
  // github-pr-scan.md is actually over budget anywhere — retarget this test
  // or restore the raw per-file pin instead of leaving it silently vacuous.
  assert.ok(
    composedBytesReport(PLUGIN_ROOT).some((r) => r.step === 'pr-scan' && !r.unparsed),
    'the pr-scan call site is gone — retarget or restore the raw pin',
  );
  const overRows = overComposedCeiling(composedBytesReport(PLUGIN_ROOT)).filter((r) => r.step === 'pr-scan');
  assert.deepStrictEqual(overRows, [], `pr-scan composed bundle over ceiling: ${JSON.stringify(overRows)}`);
});
