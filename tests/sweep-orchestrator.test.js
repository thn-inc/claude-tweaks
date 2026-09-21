'use strict';
// Pins record #1494's `/claude-tweaks:sweep` orchestrator skill (Tasks 1-3):
// plugin/skills/sweep/SKILL.md (created, Task 1: commit 36f9d1cc7), the
// `--source sweep` parent-contract text threaded through tidy/SKILL.md,
// specify/SKILL.md, specify/next-mode.md, backlog/SKILL.md (Task 2: commit
// b2c02e32e), and _shared/pipeline-run-dir.md's standalone-auto allowlist
// (also Task 1/2). Each assertion below pins the LIVE text as it landed —
// not the plan draft's paraphrase, since Task 2's byte-budget trims reworded
// several sentences — and was discrimination-checked against base commit
// 0ac4d7a00 (pre-#1494) via `git show 0ac4d7a00:{path}`, per
// skill-prose-conformance-tests: either the file/section is entirely absent
// at base (sweep/SKILL.md doesn't exist there at all — `git show` errors
// "exists on disk, but not in 0ac4d7a00"), or the specific pinned substring
// is absent even though the surrounding file already existed (verified via
// `git show 0ac4d7a00:{path} | grep -c '{substring}'` returning 0). Per-test
// discrimination notes are inline above each test.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SWEEP_DIR = path.join(ROOT, 'plugin', 'skills', 'sweep');
const TIDY_DIR = path.join(ROOT, 'plugin', 'skills', 'tidy');
const SPECIFY_DIR = path.join(ROOT, 'plugin', 'skills', 'specify');
const BACKLOG_DIR = path.join(ROOT, 'plugin', 'skills', 'backlog');
const SHARED_DIR = path.join(ROOT, 'plugin', 'skills', '_shared');

function read(...segments) {
  return fs.readFileSync(path.join(...segments), 'utf8');
}

// --- (1) sweep/SKILL.md exists; prose contains all three component calls
// with --source sweep, in order ---
// Discrimination: `plugin/skills/sweep/` does not exist at base commit
// 0ac4d7a00 at all (`git show 0ac4d7a00:plugin/skills/sweep/SKILL.md` fails
// with "exists on disk, but not in 0ac4d7a00") — every assertion in this
// block is therefore unconditionally discriminating.
test('sweep/SKILL.md exists and its prose contains all three component calls with --source sweep', () => {
  const filePath = path.join(SWEEP_DIR, 'SKILL.md');
  assert.ok(fs.existsSync(filePath), 'plugin/skills/sweep/SKILL.md must exist — absent entirely at base commit 0ac4d7a00');
  const source = read(filePath);
  assert.ok(
    source.includes('Invoke `/claude-tweaks:tidy --source sweep`'),
    'Step 1 must invoke tidy with --source sweep',
  );
  assert.ok(
    source.includes('Invoke `/claude-tweaks:specify --source sweep` bare'),
    'Step 2 must invoke specify bare drain with --source sweep',
  );
  assert.ok(
    source.includes('Invoke `/claude-tweaks:backlog refine --source sweep` under the same'),
    'Step 3 must invoke backlog refine (headless posture) with --source sweep',
  );
});

// --- (2) both between-step invalidations plus the close-out invalidation:
// invalidateSnapshot cites bin/lib/issues/record-snapshot.js; Step 2.5's
// "Repeat" instruction is present ---
// Discrimination: same as (1) — the whole file is absent at base.
test('sweep/SKILL.md: invalidateSnapshot cites record-snapshot.js; Step 2.5 and Step 4 both "Repeat" it', () => {
  const source = read(SWEEP_DIR, 'SKILL.md');
  assert.match(
    source,
    /## Step 1\.5: Invalidate the record snapshot/,
    'expected the Step 1.5 heading (first between-step invalidation)',
  );
  assert.ok(
    source.includes("require('${CLAUDE_PLUGIN_ROOT}/bin/lib/issues/record-snapshot.js').invalidateSnapshot("),
    'expected the literal invalidateSnapshot call citing bin/lib/issues/record-snapshot.js',
  );
  assert.ok(
    source.includes("Repeat Step 1.5's invalidation command verbatim before Step 3."),
    "expected Step 2.5's Repeat instruction (second between-step invalidation, before Specify->Refine)",
  );
  assert.ok(
    source.includes("Repeat Step 1.5's invalidation command once more, so the close-out reads the run's final record state."),
    'expected Step 4 close-out to repeat the invalidation a third time',
  );
});

// --- (3) failure propagation: halt-and-report discriminating sentence, plus
// the internal-error carve-out ---
// Discrimination: same as (1) — the whole file is absent at base.
test('sweep/SKILL.md: Failure propagation halts the sequence and carves out internal per-record error handling', () => {
  const source = read(SWEEP_DIR, 'SKILL.md');
  assert.ok(
    source.includes('An unhandled error in a step halts the sequence before the next step'),
    'expected the halt-and-report discriminating sentence',
  );
  assert.ok(
    source.includes(
      "tidy's staged fallbacks) is NOT a sweep-level failure — only an exception the step's own contract doesn't already catch halts the run.",
    ),
    'expected the internal-error carve-out sentence',
  );
});

// --- (4) the never-invokes boundary: When-to-Use NOT-for-building bullet,
// and the Anti-Patterns row ---
// Discrimination: same as (1) — the whole file is absent at base.
test('sweep/SKILL.md: never-invokes-build-machinery boundary is stated in When-to-Use and Anti-Patterns', () => {
  const source = read(SWEEP_DIR, 'SKILL.md');
  assert.ok(
    source.includes(
      'NOT for building — sweep never invokes `/claude-tweaks:flow`, `/claude-tweaks:build`, or `/claude-tweaks:dispatch`; its close-out only recommends the dispatch command',
    ),
    'expected the When-to-Use NOT-for-building bullet',
  );
  const antiPatternRow = source.split('\n').find((l) =>
    l.startsWith('| Invoking `/claude-tweaks:dispatch`, `/claude-tweaks:flow`, or `/claude-tweaks:build` from sweep'),
  );
  assert.ok(antiPatternRow, 'expected the Anti-Patterns row naming dispatch/flow/build');
  assert.match(
    antiPatternRow,
    /the eval scenario fails CI on this, not just doc review/,
    'expected the Anti-Patterns row to cite the eval scenario as the enforcement mechanism',
  );
});

// --- (5) _shared/run-dir-resolution.md's standalone-auto allowlist contains
// `/claude-tweaks:sweep`, and a sweep clause paragraph exists ---
// Discrimination: base commit 0ac4d7a00's pipeline-run-dir.md (the ancestor of this
// content, moved to run-dir-resolution.md at #2019) contains ZERO occurrences of
// "claude-tweaks:sweep" (`git show 0ac4d7a00:plugin/skills/_shared/pipeline-run-dir.md | grep -c claude-tweaks:sweep` => 0)
// — the whole file predates sweep, so both assertions below are discriminating.
test('_shared/run-dir-resolution.md: standalone-auto allowlist names /claude-tweaks:sweep, and its own clause paragraph exists', () => {
  const source = read(SHARED_DIR, 'run-dir-resolution.md');
  assert.ok(
    source.includes('the standalone-auto allowlist (`/tidy`, `/init`, `/capture`, `/claude-tweaks:dispatch`, `/claude-tweaks:backlog`, `/claude-tweaks:specify`, `/claude-tweaks:sweep`)'),
    'expected the standalone-auto allowlist line to name /claude-tweaks:sweep',
  );
  assert.ok(
    source.includes(
      '`/claude-tweaks:sweep` is the orchestrator case: it is always hands-off, so step 5\'s interactive fallback is never a real option for it either.',
    ),
    "expected sweep's own resolution-order clause paragraph",
  );
});

// --- (6) tidy CSC, specify CSC, next-mode.md, and backlog/SKILL.md line 104 ---
test('tidy/SKILL.md Component-Skill Contract: names /claude-tweaks:sweep as sole sanctioned parent, no PIPELINE_RUN_DIR signal', () => {
  const source = read(TIDY_DIR, 'SKILL.md');
  // Discrimination: base commit 0ac4d7a00's tidy/SKILL.md contains ZERO
  // occurrences of "claude-tweaks:sweep" anywhere in the file (checked via
  // `git show 0ac4d7a00:plugin/skills/tidy/SKILL.md | grep -c claude-tweaks:sweep`
  // => 0) — at base the CSC instead read "/claude-tweaks:tidy is a
  // standalone-only maintenance skill — it is not invoked by any parent
  // skill in the workflow." The "no `PIPELINE_RUN_DIR` signal" phrase itself
  // already existed at base (applied to "no parent at all"), so it alone
  // does not discriminate; paired with the /claude-tweaks:sweep mention in
  // the same CSC block, the combination is new.
  assert.ok(
    source.includes('one sanctioned parent: `/claude-tweaks:sweep`'),
    'expected the CSC to name /claude-tweaks:sweep as the sole sanctioned parent',
  );
  assert.ok(
    source.includes("there is still no `PIPELINE_RUN_DIR` signal expected"),
    'expected the no-PIPELINE_RUN_DIR-signal clause alongside the sweep parent mention',
  );
});

test('specify/SKILL.md Component-Skill Contract contains --source sweep', () => {
  // Discrimination: base commit 0ac4d7a00's specify/SKILL.md has ZERO
  // occurrences of "source sweep" anywhere in the file (checked via
  // `git show 0ac4d7a00:plugin/skills/specify/SKILL.md | grep -c "source sweep"`
  // => 0) — the CSC at base named only /claude-tweaks:capture's --chained caller.
  const source = read(SPECIFY_DIR, 'SKILL.md');
  assert.ok(
    source.includes(
      'Skill(skill: "claude-tweaks:specify", args: "--source sweep [--budget ...]")',
    ),
    "expected the CSC to document /claude-tweaks:sweep's Step 2 invocation with --source sweep",
  );
});

test('specify/next-mode.md contains the --source sweep component paragraph', () => {
  // Discrimination: base commit 0ac4d7a00's next-mode.md has ZERO
  // occurrences of "component step of" (checked via
  // `git show 0ac4d7a00:plugin/skills/specify/next-mode.md | grep -c "component step of"`
  // => 0) — this whole paragraph is new.
  const source = read(SPECIFY_DIR, 'next-mode.md');
  assert.ok(
    source.includes(
      "**Under `--source sweep`,** this firing is a component step of `/claude-tweaks:sweep`",
    ),
    'expected the --source sweep component-step paragraph in the Zero eligible or budget exhausted section',
  );
});

test('backlog/SKILL.md line 103 states --source sweep never renders Next Actions', () => {
  // Discrimination: base commit 0ac4d7a00's backlog/SKILL.md line 104
  // already mentioned "--source sweep" (it existed as a paste-ready human
  // form back then — 5 total "source sweep" occurrences at base, none of
  // them this clause), but had ZERO occurrences of "NEVER renders Next
  // Actions" anywhere in the file (checked via
  // `git show 0ac4d7a00:plugin/skills/backlog/SKILL.md | grep -c "NEVER renders Next Actions"`
  // => 0). At base, line 104 read: 'a human typed `/claude-tweaks:backlog
  // refine --source routine`/`--source sweep`/`grant` directly ... → render'
  // — the literal OPPOSITE of the live rule below, which reserves
  // --source sweep for the parent and forbids it as a human-typeable form.
  // Line number moved 104 -> 103 (#1909): the per-SKILL.md Interaction-style
  // directive that used to sit right after the frontmatter was removed
  // (moved to a single SessionStart-hook injection), shifting every line
  // below it up by one. The pinned clause's own text is unchanged.
  const source = read(BACKLOG_DIR, 'SKILL.md');
  const lines = source.split('\n');
  assert.ok(
    lines[102].includes(
      '`--source sweep` is reserved for `/claude-tweaks:sweep`\'s component-step invocation and NEVER renders Next Actions, regardless of who typed it',
    ),
    `expected line 103 to state the --source-sweep-never-renders rule, got: ${lines[102]}`,
  );
});

// --- (8) #1883: Step 4's "## Staged for approval" block names
// report-condensed.md, the empty-staged/ omission, and the lint call,
// positioned after the attention render (item 2) and before Next Actions
// (item 4) ---
// Discrimination: before #1883, sweep/SKILL.md's Step 4 had exactly 3 items
// (invalidate, attention render, Next Actions+log) and no mention of
// report-condensed.md, "## Staged for approval", or tidy-report-lint.js
// anywhere in the file.
test('sweep/SKILL.md Step 4: "## Staged for approval" block cites report-condensed.md, the lint call, and the empty-staged/ omission', () => {
  const source = read(SWEEP_DIR, 'SKILL.md');
  const step4Start = source.indexOf('## Step 4: Close-out');
  const nextActionsHeadingIdx = source.indexOf('\n## Next Actions', step4Start);
  const step4 = source.slice(step4Start, nextActionsHeadingIdx);
  assert.ok(
    step4.includes('## Staged for approval'),
    'expected Step 4 to render a "## Staged for approval" heading',
  );
  assert.ok(
    step4.includes('report-condensed.md'),
    'expected Step 4 to read report-condensed.md for the Approve section',
  );
  assert.ok(
    step4.includes("falling back to `report.md`'s Approve section when the condensed file is absent"),
    'expected the report.md fallback clause',
  );
  assert.ok(
    step4.includes('When `staged/` is empty, render nothing'),
    'expected the empty-staged/ omission rule',
  );
  assert.ok(
    step4.includes('node "${CLAUDE_PLUGIN_ROOT}/bin/tidy-report-lint.js" --surface=condensed'),
    'expected the pre-send lint call over the inlined block',
  );
  // Positioned after the attention render (item 2) and before Next Actions (item 4).
  const attentionIdx = step4.indexOf('Invoke `/claude-tweaks:backlog attention`');
  const stagedIdx = step4.indexOf('## Staged for approval');
  const nextActionsIdx = step4.indexOf("Render sweep's `## Next Actions`");
  assert.ok(attentionIdx >= 0 && stagedIdx > attentionIdx, 'expected the staged block after the attention render');
  assert.ok(nextActionsIdx > stagedIdx, 'expected Next Actions rendering after the staged block');
});

// --- (9) #1883: attention's Tidy row is unchanged by this record ---
test('backlog/attention-mode.md: Tidy row still renders a one-line cross-run count', () => {
  const source = read(BACKLOG_DIR, 'attention-mode.md');
  assert.ok(
    source.includes('tidy proposal(s) staged awaiting approval'),
    'expected attention-mode.md\'s Tidy row to remain a one-line staged-count summary',
  );
});

// --- (10) #1884: sweep's Next Actions carries attention's batch-launcher
// lines verbatim in the needs-you slot, under both orderings ---
test('sweep/SKILL.md: Step 4 item 2 and Next Actions cite attention\'s Batch launchers block verbatim, replacing the whole needs-you slot', () => {
  const source = read(SWEEP_DIR, 'SKILL.md');
  assert.ok(
    source.includes('This includes its `### Batch launchers` block'),
    'expected Step 4 item 2 to name attention\'s Batch launchers block',
  );
  assert.ok(
    source.includes('never re-derives them'),
    'expected Step 4 item 2 to state the lines are taken verbatim, never re-derived',
  );
  const nextActions = source.split('\n## Next Actions\n')[1].split('\n## Component-Skill Contract')[0];
  assert.ok(
    nextActions.includes('its lines — one\nper group, in that block\'s own order — replace `/claude-tweaks:dispatch` in this slot entirely'),
    'expected the precedence rule to replace the whole needs-you slot with every batch-launcher line, not just the top pick',
  );
  assert.ok(
    nextActions.includes('applies under both orderings above'),
    'expected the rule to apply to both the tidy-staged and nothing-staged orderings',
  );
});

// --- (7) --source sweep in both tidy's and specify's argument-hint lines ---
test('tidy and specify argument-hint lines both carry --source sweep', () => {
  // Discrimination: base commit 0ac4d7a00's tidy argument-hint was
  // '[--scope=<name>[,<name>...]] [--dry-run] [--approve [run-dir]]' (no
  // --source at all); specify's was '... [--chained]' (no --source at all)
  // — both confirmed via `git show 0ac4d7a00:{path} | grep "^argument-hint:"`.
  const tidySource = read(TIDY_DIR, 'SKILL.md');
  const tidyHint = tidySource.split('\n').find((l) => l.startsWith('argument-hint:'));
  assert.ok(tidyHint, 'expected an argument-hint frontmatter line in tidy/SKILL.md');
  assert.ok(tidyHint.includes('--source sweep'), 'expected --source sweep in tidy\'s argument-hint');

  const specifySource = read(SPECIFY_DIR, 'SKILL.md');
  const specifyHint = specifySource.split('\n').find((l) => l.startsWith('argument-hint:'));
  assert.ok(specifyHint, 'expected an argument-hint frontmatter line in specify/SKILL.md');
  assert.ok(specifyHint.includes('--source sweep'), 'expected --source sweep in specify\'s argument-hint');
});
