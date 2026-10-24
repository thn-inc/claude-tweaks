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

// The `bash` fence of execute.md that compares origin/{branch} with the reviewed tip, with {branch}
// resolved to `main` and {reviewed-tip} to the given sha.
function comparisonFence(executeText, reviewedTip) {
  const fences = [...executeText.matchAll(/```bash\r?\n([\s\S]*?)```/g)].map((m) => m[1]);
  const fence = fences.find((f) => f.includes('rev-parse origin/{branch})" = "{reviewed-tip}"'));
  assert.ok(fence, 'extraction pattern is out of sync: no execute.md bash fence contains \'rev-parse origin/{branch})" = "{reviewed-tip}"\'');
  return fence.split('{branch}').join(BRANCH).split('{reviewed-tip}').join(reviewedTip);
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

// Advances origin/{BRANCH} with a run-dir-only commit. Any move counts: only a review can clear it.
function pushRunDirUpstream(fx) {
  const dir = path.join(fx.other, '.claude-tweaks', 'pipelines', 'archive', 'r2');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'y.md'), 'upstream archive\n');
  fx.run(fx.other, ['add', '.claude-tweaks/pipelines']);
  fx.run(fx.other, ['commit', '-q', '-m', '[reconcile] archive run r2']);
  fx.run(fx.other, ['push', '-q', 'origin', BRANCH]);
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

test('AC1.1: a run-dir-only commit on origin/{branch} still counts as a move', () => {
  withFixture('release-reviewed-tip-', (fx) => {
    const tip = reviewedTipOf(fx);
    pushRunDirUpstream(fx);
    const { status } = runComparison(comparisonFence(readText(EXECUTE), tip), fx);
    assert.notEqual(status, 0, 'any move counts, run-dir-only included: expected a non-zero exit, got 0');
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
    const clause = ` \\\n  && [ "$(git -C "$RUN_ROOT" rev-parse origin/${BRANCH})" = "${tip}" ]`;
    assert.ok(fence.includes(clause), 'anchor text for the compare clause not found — proof cannot discriminate');
    const doctored = fence.replace(clause, '');
    assert.notEqual(doctored, fence, 'dropping the compare clause must change the fence');
    pushUpstream(fx);
    assert.notEqual(runComparison(fence, fx).status, 0, 'the real fence must stop on a move');
    assert.equal(runComparison(doctored, fx).status, 0, 'without the compare clause the moved row must pass (exit 0)');
  });
});

test('AC1.2: go-red: dropping the fetch compares a stale ref, so the moved row exits 0', () => {
  const stopsOnMove = (mutate) => {
    let status;
    withFixture('release-reviewed-tip-nofetch-', (fx) => {
      const tip = reviewedTipOf(fx);
      const fence = mutate(comparisonFence(readText(EXECUTE), tip));
      pushUpstream(fx);
      status = runComparison(fence, fx).status;
    });
    return status;
  };
  const fetchClause = `git -C "$RUN_ROOT" fetch --quiet origin ${BRANCH} \\\n  && `;
  const real = comparisonFence(readText(EXECUTE), 'x');
  assert.ok(real.includes(fetchClause), 'anchor text for the fetch clause not found — proof cannot discriminate');
  assert.notEqual(stopsOnMove((f) => f), 0, 'the real fence must stop on a move');
  assert.equal(stopsOnMove((f) => f.replace(fetchClause, '')), 0, 'without the fetch the moved row compares a stale origin/{branch} and passes (exit 0)');
});

test('go-red: without --quiet a move leaves fetch output on stderr, so it would read as a git error', () => {
  const moveStderr = (mutate) => {
    let stderr;
    withFixture('release-reviewed-tip-quiet-', (fx) => {
      const tip = reviewedTipOf(fx);
      const fence = mutate(comparisonFence(readText(EXECUTE), tip));
      pushUpstream(fx);
      stderr = runComparison(fence, fx).stderr;
    });
    return stderr;
  };
  const real = comparisonFence(readText(EXECUTE), 'x');
  assert.ok(real.includes(' --quiet'), 'anchor text " --quiet" not found — proof cannot discriminate');
  assert.equal(moveStderr((f) => f), '', 'the real fence keeps a move silent');
  assert.notEqual(moveStderr((f) => f.replace(' --quiet', '')), '', 'without --quiet the moved row must leave the ref-update summary on stderr');
});

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const DELTA_MARKER = 'AUTO {HH:MM:SS} — Step 5: origin/{branch} moved {reviewed-short} → {tip-short} ({n} commits) before the merge — move {m} of {bound}; delta review starting, base {reviewed-tip}..{branch} at reviewed tip {tip-sha}; ## /review marker: {k} existing lines. Reversibility: n/a (marker).';

// The new block of execute.md, from its heading to the Merge heading.
function blockOf(executeText) {
  const start = executeText.indexOf('**Reviewed-tip comparison');
  assert.notEqual(start, -1, 'extraction pattern is out of sync: execute.md has no "**Reviewed-tip comparison" block');
  const end = executeText.indexOf('**Merge.**', start);
  assert.notEqual(end, -1, 'extraction pattern is out of sync: execute.md has no "**Merge.**" paragraph after the block');
  return executeText.slice(start, end);
}

// [label, source, pattern]: each pattern must match exactly once in its source. `block` is the new
// execute.md block, `execute` the whole file, `skill` and `console` the whole files.
const FACTS = [
  ['skill', 'the Step 3 marker carries the unbraced `at reviewed tip {tip-sha};` and keeps the optional review-tree clause',
    /whole-branch review starting, base \{base\}\.\.\{branch\} at reviewed tip \{tip-sha\}; ## \/review marker: \{k\} existing lines\{; review tree HEAD \{head-sha\} is origin\/\{branch\} \{tip-sha\} plus run-dir-only commits\}\. Reversibility: n\/a \(marker\)\./],
  ['skill', '{tip-sha} is rev-parse origin/{branch}, read after the check passes',
    /`\{tip-sha\}` is the full 40-hex `git -C "\$RUN_ROOT" rev-parse origin\/\{branch\}`, read right after the check above passes/],
  ['skill', 'Step 8 HELD names `integration branch kept moving`',
    /`integration branch kept moving`/],
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
  ['block', 'the move count is the number of `Step 5: origin/{branch} moved` lines',
    /the number of `Step 5: origin\/\{branch\} moved` lines/],
  ['block', '`release-tip-moves` is read with resolve-policy.js --values',
    /resolve-policy\.js" --run "\{run-dir\}" --values release-tip-moves/],
  ['block', 'past the bound the run is `HELD`, reason `integration branch kept moving`',
    /`HELD`, reason `integration branch kept moving`/],
  ['block', 'the bound stop stages release-held.md through stage-item.js',
    /stage-item\.js" --run "\{run-dir\}" --id release-held --file/],
  ['block', 'the bound stop lists the arrived commits with git log --first-parent --oneline',
    /git -C "\$RUN_ROOT" log --first-parent --oneline \{step3-tip\}\.\.origin\/\{branch\}/],
  ['block', 'the bound stop suggests holding merges',
    /suggest[^\n]*holding merges/],
  ['block', 'the delta brings $RUN_ROOT to the tip with pull --rebase',
    /git -C "\$RUN_ROOT" pull --rebase origin \{branch\}/],
  ['block', 'the delta re-runs Step 3\'s review-tree check and a failure is `failed` with Step 3\'s stop lines',
    /re-run SKILL\.md Step 3's review-tree check[^\n]*`failed`[^\n]*Step 3's stop lines/],
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
];

function sources() {
  const execute = readText(EXECUTE);
  return { skill: readText(SKILL), console: readText(CONSOLE), execute, block: blockOf(execute) };
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

test('console.md no longer calls the gh-absent stop the only other HELD reason', () => {
  const text = readText(CONSOLE);
  assert.ok(!text.includes('the only other `HELD` reason'), 'console.md still says the gh-absent stop is the only other HELD reason');
  const doctored = text.replace('the reviewed-tip comparison\'s two stops', 'the only other `HELD` reason');
  assert.notEqual(doctored, text, 'go-red anchor "the reviewed-tip comparison\'s two stops" not found');
  assert.ok(doctored.includes('the only other `HELD` reason'), 'go-red: the stale phrase must be visible to the assertion');
});

// Phrases that claimed the gh-absent stop was the only, or the third, non-Step-4 HELD reason. Once delta 5's
// major re-render and the reviewed-tip stops exist, they are false.
const STALE_HELD_PHRASES = [
  ['execute', 'the one `HELD` that is not a Step 4 HARD-GATE'],
  ['execute', 'names it as the third reason for the word'],
  ['skill', 'A third reason carries the same word'],
  ['skill', 'A fourth, `integration branch kept moving`'],
];

function staleHeldPhrases(srcs) {
  return STALE_HELD_PHRASES.filter(([source, phrase]) => srcs[source].includes(phrase)).map(([, phrase]) => phrase);
}

test('no stale ordinal or "the one HELD" claim survives in execute.md or SKILL.md', () => {
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

test('byte guard: release/SKILL.md stays under 49,500 bytes', () => {
  const size = fs.statSync(SKILL).size;
  assert.ok(size < 49500, `release/SKILL.md is ${size} bytes; the budget is 49,500`);
});
