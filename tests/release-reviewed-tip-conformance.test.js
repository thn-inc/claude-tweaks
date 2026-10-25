// tests/release-reviewed-tip-conformance.test.js — pins #4041: /release Step 5 merged whatever
// origin/{branch} held at merge time, so a commit that landed after Step 3's whole-branch review shipped
// unreviewed. Step 3 now records the reviewed tip in its marker line, and Step 5 compares origin/{branch}
// with it immediately before the merge, runs a delta review per move, and holds the release once the
// integration branch has moved more than the `release-tip-moves` policy key allows. This suite pins the
// key's schema row, then extracts the comparison from the live execute.md fence and executes it against
// fixture clones of a bare origin (extract-and-run form), and pins the prose around it with go-red proofs.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { POLICY_KEYS } = require('../plugin/bin/lib/policy-schema');
const { readText } = require('./helpers/read-skill');
const { originWithTwoClones, FIXTURE_TIMEOUT_MS } = require('./helpers/git-fixtures');

const ROOT = path.join(__dirname, '..');
const RELEASE_DIR = path.join(ROOT, 'plugin', 'skills', 'release');
const SKILL = path.join(RELEASE_DIR, 'SKILL.md');
const EXECUTE = path.join(RELEASE_DIR, 'execute.md');
const CONSOLE = path.join(RELEASE_DIR, 'console.md');
const BOOKKEEPING = path.join(RELEASE_DIR, 'bookkeeping.md');
const ROUTINE_TEMPLATE = path.join(RELEASE_DIR, 'routine-template.yml');
const AUTONOMY_CEILING = path.join(ROOT, 'plugin', 'skills', '_shared', 'autonomy-ceiling.md');
const POLICY_SCHEMA_DOC = path.join(ROOT, 'plugin', 'skills', '_shared', 'policy-schema.md');
const BRANCH = 'main';

test('release-tip-moves is an advanced merge-safety integer defaulting to 2', () => {
  const row = POLICY_KEYS.find((r) => r.key === 'release-tip-moves');
  assert.ok(row, 'release-tip-moves missing from POLICY_KEYS');
  assert.equal(row.type, 'integer');
  assert.equal(row.default, 2);
  assert.equal(row.min, 0, '0 means "hold on the first move", so the floor is 0, not unset');
  assert.equal(row.category, 'merge-safety');
  assert.equal(row.tier, 'advanced');
});

// The `bash` fence of execute.md containing `needle`, with {branch} resolved to `main`,
// {reviewed-tip} to the given sha and, when given, {tip-sha} to `tipSha`.
function fenceContaining(executeText, needle, reviewedTip, tipSha) {
  const fences = [...executeText.matchAll(/```bash\r?\n([\s\S]*?)```/g)].map((m) => m[1]);
  const fence = fences.find((f) => f.includes(needle));
  assert.ok(fence, `extraction pattern is out of sync: no execute.md bash fence contains '${needle}'`);
  const resolved = fence.split('{branch}').join(BRANCH).split('{reviewed-tip}').join(reviewedTip);
  return tipSha === undefined ? resolved : resolved.split('{tip-sha}').join(tipSha);
}

// The fence that compares origin/{branch} with the reviewed tip.
function comparisonFence(executeText, reviewedTip) {
  return fenceContaining(executeText, "rev-parse origin/{branch} | grep -qxF '{reviewed-tip}'", reviewedTip);
}

// Runs body against a fresh fixture and always removes it afterwards.
function withFixture(prefix, body) {
  const fx = originWithTwoClones(prefix);
  try {
    body(fx);
  } finally {
    fs.rmSync(fx.root, { recursive: true, force: true });
  }
}

// The reviewed tip: what origin/main is in `work` after Step 3's fetch.
function reviewedTipOf(fx) {
  fx.run(fx.work, ['fetch', '-q', 'origin', BRANCH]);
  return fx.run(fx.work, ['rev-parse', `origin/${BRANCH}`]).trim();
}

// Status and stderr of the comparison run from `work` as $RUN_ROOT.
function runComparison(fence, fx) {
  const result = spawnSync('bash', ['-c', fence], { env: { ...fx.env, RUN_ROOT: fx.work }, encoding: 'utf8', timeout: FIXTURE_TIMEOUT_MS });
  return { status: result.status, stderr: result.stderr };
}

// Advances origin/{BRANCH} from the other clone, after the reviewed tip was read.
function pushUpstream(fx) {
  fx.commit(fx.other, 'upstream.txt');
  fx.run(fx.other, ['push', '-q', 'origin', BRANCH]);
}

// Advances origin/{BRANCH} with a run-dir-only commit. The comparison fence reads it as a move; 3a exempts it.
function pushRunDirUpstream(fx) {
  const dir = path.join(fx.other, '.claude-tweaks', 'pipelines', 'archive', 'r2');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'y.md'), 'upstream archive\n');
  fx.run(fx.other, ['add', '.claude-tweaks/pipelines']);
  fx.run(fx.other, ['commit', '-q', '-m', '[reconcile] archive run r2']);
  fx.run(fx.other, ['push', '-q', 'origin', BRANCH]);
}

// Runs the comparison fence, after `mutate` doctored it, against an origin that moved once the
// reviewed tip was read. Returns the run's status and stderr.
function runAfterMove(prefix, mutate) {
  let result;
  withFixture(prefix, (fx) => {
    const tip = reviewedTipOf(fx);
    const fence = mutate(comparisonFence(readText(EXECUTE), tip));
    pushUpstream(fx);
    result = runComparison(fence, fx);
  });
  return result;
}

test('AC1.1: an unmoved origin/{branch} exits 0', () => {
  withFixture('release-reviewed-tip-', (fx) => {
    const tip = reviewedTipOf(fx);
    const { status, stderr } = runComparison(comparisonFence(readText(EXECUTE), tip), fx);
    assert.equal(status, 0, `expected exit 0, got ${status} (stderr: ${stderr})`);
  });
});

test('AC1.1: a moved origin/{branch} exits non-zero with empty stderr', () => {
  withFixture('release-reviewed-tip-', (fx) => {
    const tip = reviewedTipOf(fx);
    pushUpstream(fx);
    const { status, stderr } = runComparison(comparisonFence(readText(EXECUTE), tip), fx);
    assert.notEqual(status, 0, 'expected a non-zero exit, got 0');
    assert.equal(stderr, '', 'a move is a silent non-zero: stderr is reserved for a comparison that could not run');
  });
});

test('AC1.1: the comparison fence reads a run-dir-only commit on origin/{branch} as a move (3a then exempts it)', () => {
  withFixture('release-reviewed-tip-', (fx) => {
    const tip = reviewedTipOf(fx);
    pushRunDirUpstream(fx);
    const { status } = runComparison(comparisonFence(readText(EXECUTE), tip), fx);
    assert.notEqual(status, 0, 'the fence reads any move, run-dir-only included, as a move: expected a non-zero exit, got 0');
  });
});

test('AC1.1: a failed fetch exits non-zero with non-empty stderr', () => {
  withFixture('release-reviewed-tip-', (fx) => {
    const tip = reviewedTipOf(fx);
    fx.run(fx.work, ['remote', 'set-url', 'origin', path.join(fx.root, 'missing.git')]);
    const { status, stderr } = runComparison(comparisonFence(readText(EXECUTE), tip), fx);
    assert.notEqual(status, 0, 'a comparison that could not run must not read as unmoved');
    assert.notEqual(stderr, '', 'a failed fetch must leave its own error on stderr for the report');
  });
});

test('AC1.2: go-red: dropping the compare clause lets the moved row exit 0', () => {
  withFixture('release-reviewed-tip-nocompare-', (fx) => {
    const tip = reviewedTipOf(fx);
    const fence = comparisonFence(readText(EXECUTE), tip);
    const clause = ` \\\n  && git -C "$RUN_ROOT" rev-parse origin/${BRANCH} | grep -qxF '${tip}'`;
    assert.ok(fence.includes(clause), 'anchor text for the compare clause not found — proof cannot discriminate');
    const doctored = fence.replace(clause, '');
    assert.notEqual(doctored, fence, 'dropping the compare clause must change the fence');
    pushUpstream(fx);
    assert.notEqual(runComparison(fence, fx).status, 0, 'the real fence must stop on a move');
    assert.equal(runComparison(doctored, fx).status, 0, 'without the compare clause the moved row must pass (exit 0)');
  });
});

test('AC1.2: go-red: dropping the fetch compares a stale ref, so the moved row exits 0', () => {
  const statusAfterMove = (mutate) => runAfterMove('release-reviewed-tip-nofetch-', mutate).status;
  const fetchClause = `git -C "$RUN_ROOT" fetch --quiet origin ${BRANCH} \\\n  && `;
  const real = comparisonFence(readText(EXECUTE), 'x');
  assert.ok(real.includes(fetchClause), 'anchor text for the fetch clause not found — proof cannot discriminate');
  assert.notEqual(statusAfterMove((f) => f), 0, 'the real fence must stop on a move');
  assert.equal(statusAfterMove((f) => f.replace(fetchClause, '')), 0, 'without the fetch the moved row compares a stale origin/{branch} and passes (exit 0)');
});

test('go-red: without --quiet a move leaves fetch output on stderr, so it would read as a git error', () => {
  const moveStderr = (mutate) => runAfterMove('release-reviewed-tip-quiet-', mutate).stderr;
  const real = comparisonFence(readText(EXECUTE), 'x');
  assert.ok(real.includes(' --quiet'), 'anchor text " --quiet" not found — proof cannot discriminate');
  assert.equal(moveStderr((f) => f), '', 'the real fence keeps a move silent');
  assert.notEqual(moveStderr((f) => f.replace(' --quiet', '')), '', 'without --quiet the moved row must leave the ref-update summary on stderr');
});

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const DELTA_MARKER = 'AUTO {HH:MM:SS} — Step 5: origin/{branch} moved {reviewed-short} → {tip-short} ({n} commits) before the merge — move {m} of {bound}; delta review starting, base {reviewed-tip}..{branch}; ## /review marker: {k} existing lines. Reversibility: n/a (marker). [lever: release-tip-moves={bound} ({source})]';

// The new block of execute.md, from its heading to the Merge heading.
function blockOf(executeText) {
  const start = executeText.indexOf('**Reviewed-tip comparison');
  assert.notEqual(start, -1, 'extraction pattern is out of sync: execute.md has no "**Reviewed-tip comparison" block');
  const end = executeText.indexOf('**Merge.**', start);
  assert.notEqual(end, -1, 'extraction pattern is out of sync: execute.md has no "**Merge.**" paragraph after the block');
  return executeText.slice(start, end);
}

// [label, source, pattern]: each pattern must match exactly once in its source. `block` is the new
// execute.md block, `execute` the whole file, `skill`, `console`, `bookkeeping`, `schemaDoc`, `routine` (the
// firing contract) and `ceiling` (autonomy-ceiling.md) the whole files.
const FACTS = [
  ['skill', 'the Step 3 marker carries the unbraced `at reviewed tip {tip-sha};` and keeps the optional review-tree clause',
    /whole-branch review starting, base \{base\}\.\.\{branch\} at reviewed tip \{tip-sha\}; ## \/review marker: \{k\} existing lines\{; review tree HEAD \{head-sha\} is origin\/\{branch\} \{tip-sha\} plus run-dir-only commits\}\. Reversibility: n\/a \(marker\)\./],
  ['skill', '{tip-sha} is rev-parse origin/{branch}, read after the check passes',
    /`\{tip-sha\}` is the full 40-hex `git -C "\$RUN_ROOT" rev-parse origin\/\{branch\}`, read right after the check above passes/],
  ['skill', 'Step 8 HELD names `integration branch kept moving`',
    /and `integration branch kept moving`, where/],
  ['console', 'console.md names the reviewed-tip comparison among the HELD stops',
    /the reviewed-tip comparison's two stops/],
  ['execute', 'the --as path advances the reviewed tip to the Release-As commit only when its parent is the reviewed tip',
    /the reviewed tip advances to the `Release-As:` commit only when `\{sha\}\^` equals the reviewed tip/],
  ['execute', 'the --as advance is logged',
    /Step 5: reviewed tip advanced to this run's Release-As commit \{short\} \(parent is the reviewed tip\); at reviewed tip \{sha\}\. Reversibility: n\/a\./],
  ['block', 'the comparison reads the last recorded reviewed tip, never re-derived',
    /Read `\{reviewed-tip\}` from the last line[^\n]*`decisions\.md`[^\n]*`at reviewed tip`[^\n]*never re-derived/],
  ['block', 'no recorded tip is `failed`, reason `no reviewed tip recorded`',
    /`failed`, reason `no reviewed tip recorded`/],
  ['block', 'a failed fetch is `failed`, stderr verbatim',
    /a failed fetch[^\n]*`failed`[^\n]*stderr[^\n]*verbatim/],
  ['block', 'an unmoved branch is logged and merges',
    /Step 5: origin\/\{branch\} still at reviewed tip \{short\}; merging\./],
  ['block', 'the move count is the number of lines carrying the delta marker\'s `origin/{branch} moved {any-short} →` form, any short sha',
    /the number of lines in the `## \/release` block[^\n]*that carry `origin\/\{branch\} moved \{any-short\} →`, where `\{any-short\}` is whatever short sha that line names/],
  ['block', 'the count never keys on the current reviewed tip, which would cap it at one move',
    /Never match only the current `\{reviewed-short\}`[^\n]*the bound never trips/],
  ['block', '`release-tip-moves` is read in resolve-policy.js\'s JSON form, not --values',
    /resolve-policy\.js" --run "\{run-dir\}" release-tip-moves\n/],
  ['block', '`{bound}` is the entry\'s value and `{source}` its source',
    /`\{bound\}` in this block's log lines is `N`, and `\{source\}` is `S`/],
  ['block', 'an unreadable bound fails closed as `failed`, reason `release-tip-moves unreadable`, with no default substituted',
    /Fail closed — `failed`, reason `release-tip-moves unreadable`, nothing merged, never a default substituted for a value that could not be read/],
  ['block', 'the bound read fails closed on a non-zero exit',
    /on any of: a non-zero exit;/],
  ['block', 'the bound read fails closed on output that does not parse',
    /output that does not parse as that object;/],
  ['block', 'the bound read fails closed on `"invalid": true` (a present-but-invalid value exits 0 with the default)',
    /`"invalid": true` on the entry, because a present-but-invalid value \(`abc`, `-1`\) exits `0` and prints the schema default/],
  ['block', 'the bound read fails closed on a value that is not a non-negative integer',
    /or a `value` that is not a non-negative integer\./],
  ['block', 'the bound is exceeded only when `{m}` is strictly greater than `{bound}` (0 holds on the first move)',
    /When `\{m\}` is greater than `\{bound\}` \(`0` holds on the first move\)/],
  ['block', 'a failing arrived-commit `git log` in the bound stop is `failed`, stderr verbatim, nothing merged',
    /A non-zero exit from that `git log` is `failed`, stderr verbatim, nothing merged/],
  ['block', 'the bound stop\'s STAGED line carries the release-tip-moves lever field',
    /move \{m\} exceeds release-tip-moves \{bound\}; release held\. Stage path: staged\/release-held\.md\. Reversibility: high\. \[lever: release-tip-moves=\{bound\} \(\{source\}\)\]/],
  ['block', 'a silent non-zero is a move only once rev-parse differs from the reviewed tip; equal is `failed`',
    /`origin\/\{branch\}` moved, once confirmed: `git -C "\$RUN_ROOT" rev-parse origin\/\{branch\}` must differ from `\{reviewed-tip\}`\. Equal means the comparison did not run[^\n]*`failed`[^\n]*nothing merged/],
  ['block', '3a resolves {tip-sha} once and uses the literal sha, never the symbolic ref again',
    /Resolve `\{tip-sha\}` once, as the full 40-hex sha of `git -C "\$RUN_ROOT" rev-parse origin\/\{branch\}`, and use that literal sha from here on, never the symbolic ref again/],
  ['block', '3a advances the reviewed tip to that same {tip-sha}',
    /logging that same `\{tip-sha\}` after `at reviewed tip`/],
  ['block', '3a: any exit other than 0 or 1 (128 for an unresolvable sha) is `failed`, stderr verbatim, nothing merged',
    /Any other exit \(`128` for a sha git cannot resolve, say\) is a git error: `failed`, stderr verbatim, nothing merged/],
  ['block', 'past the bound the run is `HELD`, reason `integration branch kept moving`',
    /`HELD`, reason `integration branch kept moving`/],
  ['block', 'the bound stop stages release-held.md through stage-item.js',
    /stage-item\.js" --run "\{run-dir\}" --id release-held --file/],
  ['block', 'the bound stop lists the arrived commits with git log --first-parent --oneline',
    /git -C "\$RUN_ROOT" log --first-parent --oneline \{step3-tip\}\.\.origin\/\{branch\}/],
  ['block', 'the bound stop suggests holding merges',
    /suggest[^\n]*holding merges/],
  ['block', 'the delta brings $RUN_ROOT to the tip with pull --rebase --no-autostash',
    /git -C "\$RUN_ROOT" pull --rebase --no-autostash origin \{branch\}/],
  ['block', 'Step 5 has its own failure line, `stopped before the merge: {reason}`, not Step 3\'s console-stage one',
    /Every failure in this step is `failed`, reported as `stopped before the merge: \{reason\}`\. Step 3's `stopped before the console` lines are not reused, because the console has already rendered/],
  ['block', 'the branch is asserted before the pull: anything but {branch} is `failed`, reports the current branch, prints no `switch` command, pulls nothing',
    /First assert the anchor is still on the integration branch: `git -C "\$RUN_ROOT" rev-parse --abbrev-ref HEAD` must equal `\{branch\}`\. Anything else is `failed`: report the current branch and stop, print no `switch` command, and pull nothing\. `\$RUN_ROOT` is the shared main checkout, and a sibling session owns its checkout state/],
  ['block', 'nothing outside run dirs may have changed locally since the reviewed tip, or nothing is pulled',
    /assert nothing outside run dirs changed locally since the reviewed tip: `git -C "\$RUN_ROOT" diff --quiet \{reviewed-tip\} HEAD -- ':!\.claude-tweaks\/pipelines'`\. Non-zero is `failed` and nothing is pulled, because a sibling's local shipped commits must not be rebased/],
  ['block', 'a rebase that refuses is `failed` with git\'s stderr verbatim',
    /A rebase that refuses is `failed` with git's stderr verbatim\./],
  ['block', 'a rebase that stops mid-way is aborted before `failed`, so the shared checkout is never left mid-rebase',
    /A rebase that stops mid-way on a conflict runs `git -C "\$RUN_ROOT" rebase --abort` first, then reports `failed` with git's stderr verbatim, so the shared checkout is never left mid-rebase/],
  ['block', 'the delta re-runs Step 3\'s review-tree check and a failure is `failed` under Step 5\'s prefix, without Step 3\'s `switch` recovery',
    /re-run SKILL\.md Step 3's review-tree check; any failure is `failed`, reported with Step 3's stop line and reason under this step's prefix and without its `switch` recovery/],
  ['block', 'a failing `rev-list --count` is `failed`, stderr verbatim, nothing merged',
    /`\{n\}` is `git -C "\$RUN_ROOT" rev-list --count \{reviewed-tip\}\.\.origin\/\{branch\}`; a non-zero exit from it is `failed`, stderr verbatim, nothing merged/],
  ['block', 'the new tip\'s test gate is the review\'s own Step 1.5',
    /the review's own Step 1\.5/],
  ['block', 'the delta marker line',
    new RegExp(escapeRe(DELTA_MARKER))],
  ['block', 'the delta invokes review base:{reviewed-tip} and classifies only the lines after its marker by Step 3\'s table',
    /`\/claude-tweaks:review base:\{reviewed-tip\}`[^\n]*classify only the lines[^\n]*Step 3's[^\n]*table/],
  ['block', 'a review that did not complete is a stop, not a pass',
    /`failed`, reason `delta review did not complete`/],
  ['block', 'a `review: blocking` delta routes to console.md\'s gate (unchanged rules) and then `HELD`',
    /`review: blocking`[^\n]*console\.md[^\n]*`--allow-blocking`[^\n]*`--train`[^\n]*`HELD`/],
  ['block', 'a clean or findings delta re-enters at the PR-check gate',
    /`review: clean` or `review: findings[^\n]*re-enter at the PR-check gate/],
  ['block', 'the remaining window is the merge call itself',
    /the remaining window is the merge call itself/],
  ['block', 'Step 8\'s HELD summary prints the arrived-commit list for the bound stop',
    /Step 8's HELD summary also prints that `git log` output, the arrived commits, under its gate-and-staged-path line/],
  ['skill', 'SKILL.md Step 8 prints the arrived-commit list beneath the HELD staged-path line',
    /For `integration branch kept moving`, the list of arrived commits \(`execute\.md`'s bound step\) prints beneath that line/],
  ['block', 'every release-held.md the block composes carries the --as warning (the Release-As commit is already on {branch})',
    /Every `release-held\.md` this block composes carries one more line when `--as` was given: the `Release-As:` commit is already on `\{branch\}`, so re-run without pushing a second override/],
  ['block', 'a run-dir-only move gets its own step 3a',
    /\*\*3a\. A run-dir-only move does not count\.\*\*/],
  ['block', 'the run-dir-only check is a tree diff outside .claude-tweaks/pipelines',
    /diff --quiet \{reviewed-tip\} \{tip-sha\} -- ':!\.claude-tweaks\/pipelines'/],
  ['block', 'a run-dir-only move is not counted, runs no review, advances the reviewed tip and re-compares',
    /Exit `0` — every arrived commit is run-dir-only: do not count it toward the bound and run no review\. Advance the reviewed tip instead[^\n]*go back to 1 and compare again/],
  ['block', 'the run-dir-only advance line carries `at reviewed tip {tip-sha}` and is not a counted move line',
    /by run-dir-only commits \(\{n\} commits, nothing outside \.claude-tweaks\/pipelines\); no review, not counted; at reviewed tip \{tip-sha\}\./],
  ['block', 'the re-entry derives a bump part from the arrived commits',
    /On that re-entry, derive the bump part from the arrived commits too/],
  ['block', 'the arrived commits are read as `git log --format=%B {reviewed-tip}..{tip-sha}`',
    /git -C "\$RUN_ROOT" log --format=%B \{reviewed-tip\}\.\.\{tip-sha\}/],
  ['block', 'the arrived part: `!` or a BREAKING CHANGE footer is major, feat minor, anything else patch',
    /a `!` after a subject's type, or a `BREAKING CHANGE:` footer, is major; `feat` is minor; anything else is patch/],
  ['block', 'only a major derived from the arrived commits changes the route',
    /Only a major derived from the arrived commits changes the route/],
  ['block', 'a minor or patch from the arrived commits leaves delta 5\'s title rule standing',
    /A minor or patch leaves delta 5's title rule standing/],
  ['block', '`--as` runs are exempt from the arrived-commit major hold (the Release-As override pins the shipped version)',
    /`--as` runs are exempt from this hold: the shipped version is pinned by the `Release-As:` override, and Step 4's `--as` major gate measures the `--as` value, not commit parts/],
  ['block', 'pre-major folds as the pack does: preMajor AND the config flag bump-minor-pre-major make a breaking marker minor; without the flag it stays major',
    /Fold pre-major exactly as the pack's own `bumpPart` does[\s\S]{0,120}`proposedVersion\.value\.preMajor` is `true` \*\*and\*\* `release-please-config\.json` sets `bump-minor-pre-major`[\s\S]{0,200}a breaking marker counts as minor, not major; without that flag it stays major/],
  ['block', 'a failing arrived-commit `git log --format=%B` is `failed`, stderr verbatim, nothing merged',
    /a non-zero exit is `failed`, stderr verbatim, nothing merged\) and take the conventional-commit part/],
  ['block', 'step 1 lists the lines that carry the reviewed tip and excludes the delta marker',
    /Step 3's marker, a run-dir-only advance line \(3a\), a delta verdict line \(6\), or the `--as` advance line above\. The delta marker is never such a line: it is written before its review has run/],
  ['block', 'the delta marker carries no `at reviewed tip` clause, with the reason',
    /The marker deliberately carries no `at reviewed tip` clause: the delta has not been reviewed yet/],
  ['block', 'the delta verdict line carries the optional `at reviewed tip {tip-sha}` clause',
    /Findings staged at \{paths\|none\}\{; at reviewed tip \{tip-sha\}\}\. Reversibility: n\/a \(gate evaluation\)\./],
  ['block', 'the verdict clause is written only for clean, findings or an overridden blocking verdict',
    /written only when the verdict is `clean`, `findings`, or an overridden `blocking`/],
  ['block', 'the re-entry runs again from the delta verdict line\'s `at reviewed tip`',
    /runs again from the delta verdict line's `at reviewed tip`/],
  ['block', 'a major from the arrived commits takes delta 5\'s HELD path with a reason naming the arrived commits',
    /takes delta 5's `re-rendered to a major after the console` HELD path, with the reason named `re-rendered to a major after the console — from the arrived commits \{shas\}, the release PR title still reads v\{title-version\}`/],
  ['skill', 'SKILL.md Step 5 summary mentions the reviewed-tip comparison',
    /it also compares `origin\/\{branch\}` with the tip Step 3 reviewed: a move runs a delta review, and more moves than `release-tip-moves` allows is `HELD`/],
  ['skill', 'SKILL.md Step 8 says the blocking delta re-fires the existing `review: blocking` gate',
    /re-fires the existing `review: blocking` gate on the delta range/],
  ['skill', 'SKILL.md Step 8 `failed` names an unreadable release-tip-moves',
    /an unreadable `release-tip-moves`/],
  ['skill', 'SKILL.md Step 8 `failed` names a failed git read of the arrived commits',
    /a failed git read of the arrived commits/],
  ['skill', 'the --train row says Step 5\'s no-merge stops also stage release-held.md and exit `HELD`',
    /exit `HELD`; so do Step 5's no-merge stops\. Refused unless/],
  ['skill', 'the --train semantics heading says Step 5\'s no-merge stops end it the same way',
    /Step 5's no-merge stops end it the same way\.\*\*/],
  ['skill', '`HELD` asserts a Step 4 HARD-GATE or a Step 5 no-merge stop fired and nothing merged or tagged',
    /a HARD-GATE at Step 4 or a no-merge stop at Step 5 fired, and nothing was merged or tagged/],
  ['routine', 'the Routine firing contract names the blocking delta review as a Step 5 HELD stop',
    /blocking delta review of commits that reached the integration branch after Step 3 reviewed it,/],
  ['routine', 'the Routine firing contract names `integration branch kept moving` with its recovery (pause merges or raise the bound)',
    /`integration branch kept moving` \(more moves than `release-tip-moves` allows\), whose recovery/],
  ['ceiling', 'autonomy-ceiling.md\'s `train` row names the Step 5 stops, with the pause-merges-or-raise-the-bound recovery',
    /Step 5's `integration branch kept moving` stop is the same `HELD`, but its recovery is to pause merges or raise `release-tip-moves`/],
  ['console', 'console.md says the merge never happens (not that Step 5 never runs) under HELD',
    /The merge never happens and Step 8's summary reads `HELD`\./],
  ['bookkeeping', 'bookkeeping.md defines the HELD no-Step-6/7 rule over every no-merge stop',
    /or one of Step 5's stops that merge nothing/],
  ['schemaDoc', 'the policy-schema.md row states the 0 floor',
    /Floor `0`: it holds on the first move\./],
];

function sources() {
  const execute = readText(EXECUTE);
  return {
    skill: readText(SKILL), console: readText(CONSOLE), bookkeeping: readText(BOOKKEEPING), schemaDoc: readText(POLICY_SCHEMA_DOC),
    routine: readText(ROUTINE_TEMPLATE), ceiling: readText(AUTONOMY_CEILING), execute, block: blockOf(execute),
  };
}

function missingFacts(srcs) {
  return FACTS.filter(([source, , pattern]) => !pattern.test(srcs[source])).map(([, fact]) => fact);
}

test('AC2.1/AC3.1: every reviewed-tip prose fact is present exactly once', () => {
  const srcs = sources();
  assert.deepEqual(missingFacts(srcs), [], 'release prose must state every reviewed-tip fact');
  for (const [source, fact, pattern] of FACTS) {
    const count = (srcs[source].match(new RegExp(pattern.source, 'g')) || []).length;
    assert.equal(count, 1, `"${fact}" must match exactly once in ${source}, matched ${count}`);
  }
});

test('AC2.1/AC3.1: each reviewed-tip prose fact can actually go red on its own (discrimination proof)', () => {
  const srcs = sources();
  for (const [source, fact, pattern] of FACTS) {
    const doctored = srcs[source].replace(pattern, '');
    assert.notEqual(doctored, srcs[source], `anchor text for "${fact}" not found — proof cannot discriminate`);
    assert.ok(!pattern.test(doctored), `removing "${fact}" must turn its own assertion red`);
  }
});

// Phrases that claimed the gh-absent stop was the only, or the third, non-Step-4 HELD reason, or that HELD
// is a Step-4-only word. Once delta 5's major re-render and the reviewed-tip stops exist, they are false.
const STALE_HELD_PHRASES = [
  ['execute', 'the one `HELD` that is not a Step 4 HARD-GATE'],
  ['execute', 'names it as the third reason for the word'],
  ['skill', 'A third reason carries the same word'],
  ['skill', 'A fourth, `integration branch kept moving`'],
  ['skill', 'beside those two HARD-GATEs'],
  ['console', 'the only other `HELD` reason'],
  ['console', 'Step 5 never runs and Step 8\'s summary reads'],
  ['bookkeeping', 'A HARD-GATE fires at Step 4, before Step 5 ever runs'],
  ['skill', 'stage `release-held.md` in the run directory before Step 5 and exit `HELD`. Refused unless'],
  ['skill', '**Two HARD-GATEs stop it before Step 5.**'],
  ['skill', 'a HARD-GATE fired at Step 4 before Step 5, and nothing was merged or tagged'],
];

function staleHeldPhrases(srcs) {
  return STALE_HELD_PHRASES.filter(([source, phrase]) => srcs[source].includes(phrase)).map(([, phrase]) => phrase);
}

test('no stale ordinal or "the one HELD" claim survives in execute.md, SKILL.md, console.md or bookkeeping.md', () => {
  const srcs = sources();
  assert.deepEqual(staleHeldPhrases(srcs), [], 'a stale HELD-reason phrase is still present');
  for (const [source, phrase] of STALE_HELD_PHRASES) {
    const reintroduced = { ...srcs, [source]: `${srcs[source]}\n${phrase}\n` };
    assert.deepEqual(staleHeldPhrases(reintroduced), [phrase], `go-red: re-adding "${phrase}" must be caught by the check`);
  }
});

// The four Step 5 stops that merge nothing, as Step 8's HELD bullet must name them.
const STEP5_HELD_REASONS = [
  ['gh-absent Transport stop', /pr-first with no `gh` on `PATH`/],
  ['delta 5 major re-render', /delta 5's re-render to a major/],
  ['blocking delta review', /a `review: blocking` delta review/],
  ['integration branch kept moving', /`integration branch kept moving`/],
];

function missingHeldReasons(bullet) {
  return STEP5_HELD_REASONS.filter(([, pattern]) => !pattern.test(bullet)).map(([reason]) => reason);
}

test('SKILL.md Step 8 HELD bullet names every Step 5 HELD stop', () => {
  const m = readText(SKILL).match(/^- \*\*`HELD`\*\*[^\n]*$/m);
  assert.ok(m, 'extraction pattern is out of sync: no "- **`HELD`**" bullet in SKILL.md');
  const bullet = m[0];
  assert.deepEqual(missingHeldReasons(bullet), [], 'the HELD bullet must name all four Step 5 stops');
  for (const [reason, pattern] of STEP5_HELD_REASONS) {
    const doctored = bullet.replace(pattern, '');
    assert.notEqual(doctored, bullet, `anchor text for "${reason}" not found — proof cannot discriminate`);
    assert.deepEqual(missingHeldReasons(doctored), [reason], `removing only "${reason}" must turn exactly that assertion red`);
  }
});

test('the Step 3 marker stays one line and its tip clause matches the sibling pin', () => {
  const lines = readText(SKILL).split('\n').filter((l) => l.includes('whole-branch review starting'));
  assert.equal(lines.length, 1, 'the Step 3 marker must be exactly one line');
  assert.ok(
    lines[0].includes('{; review tree HEAD {head-sha} is origin/{branch} {tip-sha} plus run-dir-only commits}'),
    'the marker line must keep the optional review-tree clause #4012 pins',
  );
});

test('placement: the comparison block sits after delta 5 and before Merge', () => {
  const text = readText(EXECUTE);
  const delta5 = text.indexOf('re-rendered to a major after the console');
  const block = text.indexOf('**Reviewed-tip comparison');
  const merge = text.indexOf('**Merge.**');
  assert.ok(delta5 !== -1 && block !== -1 && merge !== -1, 'placement anchors missing');
  assert.ok(delta5 < block, 'the comparison block must come after delta 5');
  assert.ok(block < merge, 'the comparison block must come before the Merge paragraph');
});

// The fence that compares the trees outside run dirs, at the literal {tip-sha}.
function runDirOnlyFence(executeText, reviewedTip, tipSha) {
  return fenceContaining(executeText, 'diff --quiet {reviewed-tip} {tip-sha}', reviewedTip, tipSha);
}

// 3a's {tip-sha}: what origin/{BRANCH} is in `work` once the upstream moved, resolved once.
function arrivedTipOf(fx) {
  return reviewedTipOf(fx);
}

// Status of the run-dir-only check once the upstream moved: 0 means every arrived commit is run-dir-only.
// `mutate` doctors the fence first; `tipSha` overrides the resolved {tip-sha}.
function runDirOnlyStatus(fx, reviewedTip, { mutate = (f) => f, tipSha = arrivedTipOf(fx) } = {}) {
  return runComparison(mutate(runDirOnlyFence(readText(EXECUTE), reviewedTip, tipSha)), fx).status;
}

test('3a: a run-dir-only move exits 0 and a move touching code exits 1', () => {
  for (const [name, push, expected] of [['run-dir-only', pushRunDirUpstream, 0], ['code', pushUpstream, 1]]) {
    withFixture('release-reviewed-tip-rundir-', (fx) => {
      const tip = reviewedTipOf(fx);
      push(fx);
      const status = runDirOnlyStatus(fx, tip);
      assert.equal(status, expected, `${name} move: expected exit ${expected}, got ${status}`);
    });
  }
});

test('3a: go-red: without the run-dir pathspec a run-dir-only move reads as a code move', () => {
  withFixture('release-reviewed-tip-rundir-nopath-', (fx) => {
    const tip = reviewedTipOf(fx);
    const pathspec = " -- ':!.claude-tweaks/pipelines'";
    assert.ok(runDirOnlyFence(readText(EXECUTE), tip, 'x').includes(pathspec), 'anchor text for the pathspec not found — proof cannot discriminate');
    pushRunDirUpstream(fx);
    assert.equal(runDirOnlyStatus(fx, tip), 0, 'the real fence must call a run-dir-only move run-dir-only');
    assert.equal(runDirOnlyStatus(fx, tip, { mutate: (f) => f.replace(pathspec, '') }), 1, 'without the pathspec the same move must exit 1');
  });
});

test('3a: the diff reads the literal {tip-sha}: a commit that lands after it was resolved is not diffed', () => {
  withFixture('release-reviewed-tip-literal-', (fx) => {
    const tip = reviewedTipOf(fx);
    pushRunDirUpstream(fx);
    const tipSha = arrivedTipOf(fx);
    pushUpstream(fx); // a sibling's code commit arrives after {tip-sha} was resolved
    assert.notEqual(arrivedTipOf(fx), tipSha, 'fixture must have moved origin past the resolved tip');
    assert.equal(runDirOnlyStatus(fx, tip, { tipSha }), 0, 'the literal sha is run-dir-only; the later code commit is the next comparison\'s move, not this diff\'s');
    // go-red: diffing the symbolic ref instead reads the later commit, so the advance would skip past it unseen
    const symbolic = runDirOnlyStatus(fx, tip, { tipSha, mutate: (f) => f.replace(tipSha, `origin/${BRANCH}`) });
    assert.equal(symbolic, 1, 'a diff on origin/{branch} sees the commit that {tip-sha} does not name');
  });
});

test('3a: a reviewed tip git cannot resolve exits 128, neither 0 nor 1, so the prose calls it a git error', () => {
  withFixture('release-reviewed-tip-badsha-', (fx) => {
    reviewedTipOf(fx);
    pushUpstream(fx);
    const status = runDirOnlyStatus(fx, '0'.repeat(40));
    assert.equal(status, 128, `expected exit 128 for an unresolvable reviewed tip, got ${status}`);
  });
});

// The bound read, run for real: the command extracted from the live fence, against a fixture run dir
// outside any checkout (so the resolver reads no policy.yml and the schema default is 2).
function readBound(configLine, mutate = (f) => f) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'release-tip-bound-'));
  try {
    const runDir = path.join(tmp, 'run');
    fs.mkdirSync(runDir);
    if (configLine !== null) fs.writeFileSync(path.join(runDir, 'config.yml'), `${configLine}\n`);
    const fence = mutate(fenceContaining(readText(EXECUTE), 'resolve-policy.js" --run "{run-dir}" release-tip-moves', 'x')).split('{run-dir}').join(runDir);
    const result = spawnSync('bash', ['-c', fence], {
      cwd: tmp,
      env: { ...process.env, CLAUDE_PLUGIN_ROOT: path.join(ROOT, 'plugin') },
      encoding: 'utf8',
      timeout: FIXTURE_TIMEOUT_MS,
    });
    return { status: result.status, stdout: result.stdout, stderr: result.stderr };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

test('bound read: a valid run-config value resolves with its source and no invalid flag', () => {
  const { status, stdout } = readBound('release-tip-moves: 0');
  assert.equal(status, 0);
  assert.deepEqual(JSON.parse(stdout), { 'release-tip-moves': { value: 0, source: 'run-config' } });
});

test('bound read: a present-but-invalid value exits 0 with the default and `invalid: true`, the only sign the prose fails closed on', () => {
  for (const bad of ['abc', '-1', '1.5']) {
    const { status, stdout } = readBound(`release-tip-moves: ${bad}`);
    assert.equal(status, 0, `${bad}: the resolver exits 0 on a present-but-invalid value`);
    const entry = JSON.parse(stdout)['release-tip-moves'];
    assert.equal(entry.invalid, true, `${bad}: the entry must carry invalid: true`);
    assert.equal(entry.value, 2, `${bad}: the entry carries the schema default, which must never be used as the bound`);
  }
});

test('bound read: go-red: the --values form prints the default with exit 0 and no sign of the invalid value', () => {
  const real = readBound('release-tip-moves: abc');
  assert.equal(JSON.parse(real.stdout)['release-tip-moves'].invalid, true, 'the real fence must expose the invalid value');
  const values = readBound('release-tip-moves: abc', (f) => f.replace('release-tip-moves', '--values release-tip-moves'));
  assert.equal(values.status, 0);
  assert.equal(values.stdout.trim(), '2', 'the --values form reads as a plain, valid-looking 2');
  assert.ok(!values.stdout.includes('invalid'), 'the --values form drops the invalid flag');
});

// The counted form the bound step names (`origin/{branch} moved {any-short} →`).
function countedForm(block) {
  const literal = block.match(/that carry `(origin\/\{branch\} moved \{any-short\} →)`/);
  assert.ok(literal, 'extraction pattern is out of sync: the bound step names no counted literal');
  return literal[1];
}

// The counted form as a regex: `{branch}` and the sha placeholder become the given patterns, the rest
// matches literally.
function movedFormRe(form, { branch, short }) {
  return new RegExp(form.split(/(\{[a-z-]+\})/).map((part) => {
    if (part === '{branch}') return branch;
    if (/^\{[a-z-]+\}$/.test(part)) return short;
    return part.replace(/[.*+?^$()|[\]\\{}/]/g, (c) => `\\${c}`);
  }).join(''));
}

// The log-line templates in the block that the counted form matches (any placeholder standing in for the
// sha), so a log line that drifts into the move count turns this red.
function countedMoveLines(block) {
  const re = movedFormRe(countedForm(block), { branch: '\\{branch\\}', short: '\\{[a-z-]+\\}' });
  return block.split('\n').filter((l) => /^(AUTO|STAGED) \{HH:MM:SS\}/.test(l) && re.test(l));
}

test('move count: only the delta marker carries the counted literal', () => {
  const block = blockOf(readText(EXECUTE));
  const counted = countedMoveLines(block);
  assert.equal(counted.length, 1, `exactly one log line may carry the counted literal, found ${counted.length}`);
  assert.ok(counted[0].includes('delta review starting'), 'the one counted line must be the delta marker');
  for (const [name, from] of [
    ['terminal STAGED line', 'origin/{branch} moved past the reviewed tip'],
    ['run-dir-only advance line', 'origin/{branch} advanced {reviewed-short} →'],
  ]) {
    const drifted = block.replace(from, 'origin/{branch} moved {reviewed-short} →');
    assert.notEqual(drifted, block, `go-red anchor for the ${name} not found`);
    assert.equal(countedMoveLines(drifted).length, 2, `go-red: a ${name} carrying the literal must be counted`);
  }
});

test('move count: the counted form matches every earlier delta marker, so move 3 reads as move 3', () => {
  const form = countedForm(blockOf(readText(EXECUTE)));
  const log = [
    'AUTO 10:00:00 — Step 5: origin/main moved aaaaaaa → bbbbbbb (2 commits) before the merge — move 1 of 2; delta review starting',
    'AUTO 10:20:00 — Step 5: origin/main moved bbbbbbb → ccccccc (1 commits) before the merge — move 2 of 2; delta review starting',
  ];
  const counted = log.filter((l) => movedFormRe(form, { branch: 'main', short: '[0-9a-f]{7,40}' }).test(l)).length;
  assert.equal(counted, 2, 'both earlier delta markers count, so the next move is move 3 and exceeds a bound of 2');
  // Go-red: keying the count on the current reviewed tip (ccccccc after move 2) finds neither marker.
  const keyedOnCurrent = log.filter((l) => movedFormRe(form, { branch: 'main', short: 'ccccccc' }).test(l)).length;
  assert.equal(keyedOnCurrent, 0, 'go-red: a count keyed on the current reviewed tip undercounts');
});

test('placement: 3a sits between the exit classification and the bound; the branch assertion precedes the pull', () => {
  const block = blockOf(readText(EXECUTE));
  const at = (s) => {
    const i = block.indexOf(s);
    assert.notEqual(i, -1, `placement anchor missing: ${s}`);
    return i;
  };
  assert.ok(at('**3. Classify the exit.**') < at('**3a.') && at('**3a.') < at('**4. The bound.**'), '3a must sit between steps 3 and 4');
  assert.ok(at('rev-parse --abbrev-ref HEAD` must equal `{branch}`') < at('pull --rebase --no-autostash origin {branch}'), 'the branch assertion must precede the pull');
  assert.ok(at("diff --quiet {reviewed-tip} HEAD -- ':!.claude-tweaks/pipelines'") < at('pull --rebase --no-autostash origin {branch}'), 'the local-change assertion must precede the pull');
  assert.ok(at('rebase --abort') > at('pull --rebase --no-autostash origin {branch}'), 'the abort belongs to the pull');
});

test('Step 5 has no `stopped before the console` line: the console has rendered by then', () => {
  const stale = (block) => block.includes('stopped before the console');
  const block = blockOf(readText(EXECUTE));
  assert.ok(block.includes('stopped before the merge:'), 'anchor for Step 5\'s own prefix missing');
  assert.equal(stale(block.replace('Step 3\'s `stopped before the console` lines are not reused', '')), false, 'the only mention is the sentence that rules it out');
  assert.equal(stale(`${block}\nstopped before the console: review tree is not origin/main\n`), true, 'go-red: a reused Step 3 stop line must be caught');
});

test('Step 5 prints no `switch` command: a sibling session owns the shared checkout state', () => {
  const step5 = blockOf(readText(EXECUTE)).split('**5. Bring the checkout to the tip.**')[1].split('**6. Delta review.**')[0];
  const switchCommands = (text) => text.match(/git -C "\$RUN_ROOT" switch/g) || [];
  assert.deepEqual(switchCommands(step5), [], 'Step 5 must not print a switch command');
  assert.equal(switchCommands(`${step5}\ngit -C "$RUN_ROOT" switch main\n`).length, 1, 'go-red: a printed switch command must be caught');
});

// The delta marker is written before the delta review has run, so it must not carry `at reviewed tip`.
function deltaMarkerLine(block) {
  const lines = block.split('\n').filter((l) => /^AUTO \{HH:MM:SS\}/.test(l) && l.includes('delta review starting'));
  assert.equal(lines.length, 1, `exactly one delta marker line expected, found ${lines.length}`);
  return lines[0];
}

test('A8: the delta marker carries no `at reviewed tip` clause; the clause moves to the delta verdict line', () => {
  const block = blockOf(readText(EXECUTE));
  const marker = deltaMarkerLine(block);
  assert.ok(marker.includes('origin/{branch} moved {reviewed-short} → {tip-short}'), 'the marker keeps the counted form');
  assert.ok(!marker.includes('at reviewed tip'), 'the marker must not carry the clause');
  const drifted = block.replace(marker, marker.replace('Reversibility:', 'at reviewed tip {tip-sha}; Reversibility:'));
  assert.notEqual(drifted, block, 'go-red anchor not found');
  assert.ok(deltaMarkerLine(drifted).includes('at reviewed tip'), 'go-red: a clause on the marker must be caught');
  const verdict = block.split('\n').find((l) => l.startsWith('AUTO {HH:MM:SS} — Step 5: delta review base'));
  assert.ok(verdict && verdict.includes('{; at reviewed tip {tip-sha}}'), 'the verdict line carries the optional clause');
});

test('A12: the decisions that consulted release-tip-moves carry the lever field, and no other line in the block does', () => {
  const block = blockOf(readText(EXECUTE));
  const withLever = (b) => b.split('\n').filter((l) => /^(AUTO|STAGED) \{HH:MM:SS\}/.test(l) && l.includes('[lever: '));
  const lines = withLever(block);
  assert.equal(lines.length, 2, `expected the STAGED bound line and the delta marker, found ${lines.length}`);
  for (const line of lines) assert.ok(line.endsWith('[lever: release-tip-moves={bound} ({source})]'), `lever field must be the last element: ${line}`);
  const bare = block.replace(' [lever: release-tip-moves={bound} ({source})]', '');
  assert.equal(withLever(bare).length, 1, 'go-red: dropping one lever field must be caught');
});

test('A13: go-red: flipping the bound comparator to "at least" or "greater than or equal" turns its fact red', () => {
  const fact = FACTS.find(([, label]) => label.startsWith('the bound is exceeded only when'));
  assert.ok(fact, 'the comparator fact is missing');
  const block = blockOf(readText(EXECUTE));
  assert.ok(fact[2].test(block), 'the real block states the strict comparator');
  for (const flipped of ['at least `{bound}`', 'greater than or equal to `{bound}`', 'greater than or equal `{bound}`']) {
    const doctored = block.replace('is greater than `{bound}`', `is ${flipped}`);
    assert.notEqual(doctored, block, 'go-red anchor not found');
    assert.ok(!fact[2].test(doctored), `a flip to "${flipped}" must turn the comparator fact red`);
  }
});
