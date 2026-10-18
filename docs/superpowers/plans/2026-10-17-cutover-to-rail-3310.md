# Cut every skill-size consumer over to the rail (#3310) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every live consumer of the old per-file / composed byte ceiling switches to the new size model:
- the Read-limit rail (`RAIL_BYTES`, `plugin/bin/lib/skill-audit/budgets.js`) is the only size limit that blocks;
- per-invocation cost is shown, never gated;
- coherence is the corpus-relative `sizeOutlier` bloat signal.

A new decision record states the model. #3311 then deletes the leftovers (`CEILING_BYTES`, the warning tier, `COMPOSED_STEP_EXCEPTIONS`, `merge-size-probe`, the test pins).

**Architecture:** One code change and one prose sweep.
- **plan-audit's `headroomCheck`** (`plugin/bin/lib/plan-audit/checks.js`) measures per-file and composed headroom against `RAIL_BYTES`. The JSON envelope keys are unchanged.
- **Harness-health's two judging procedures** pass `{ ceiling: Infinity }` to `bloatReport`, adding `sizeOutlier: false` for non-skill targets. The composed check goes through `rail.js`'s `composedRailViolations`.
- **The PR checklist** drops its merge-size probe item.
- **Every other live sentence** citing the old ceiling is rewritten to the rail, or deleted.

**Tech Stack:** Node 18+, `node:test`, `node:assert`. Markdown skill prose. No dependencies.

**Spec:** `.claude-tweaks/pipelines/2026-10-17T062549-spec-3307-3308-3306-3309-3310-3311/spec-3310/work/3310-spec.md` (materialized from GitHub issue #3310). Its **Boundary amendments** section supersedes the issue body wherever the two conflict. The values below are the amended ones. _(Spec file deleted at the series close-out in PR #3433; the GitHub record, with its As-built notes, is the durable spec.)_

## Build-time facts that supersede the issue body

1. **The rail is at the cap.** `RAIL_RATIO` = 1.0, and `RAIL_BYTES` = `Math.floor(25000 × 2.1)` = **52,500 B**. `RAIL_LINES` = 2,000. These were calibrated on Claude Code **2.1.302**, which pages a Read over the cap rather than failing; the calibration is in `budgets.js`'s header. The near band is `≥ 0.9 × RAIL_BYTES` = **47,250 B**.
2. **A raw `overRail` call flags every `composedBytesReport` row.** Those rows carry `max`, not `bytes`, and `overRail` fails closed on a non-numeric `bytes`. Harness-health must call `rail.js`'s `composedRailViolations(root)` instead.
3. **Non-skill bloat targets.** For a CLAUDE.md or rule-file target, pass `{ ceiling: Infinity, sizeOutlier: false }`: those targets carry their own line budgets (#3305 F2). For a skill target, pass `{ ceiling: Infinity }`.
4. **Decision record number:** `0024` is the next free one; `0022` and `0023` are taken on `origin/main`. Re-check it with `ls docs/decisions/` immediately before Task 6's commit.
5. **AC1's sweep** is `scratchpad/ac1-sweep.js`. The absolute path is below; it is a scratch script, so it is never committed. Its pathspec carries the amended exclusions: history, `tests/`, `CHANGELOG.md` and `code-health/scope.js`. The exceptions it allows are `context-cost.js`, `bloat.js`, both `merge-size-probe.js` files, and `docs/plugin-structure.md`'s `merge-size-probe.js` CLI row. Its baseline at plan time is **98 hits**.

   `AC1_SWEEP="/private/tmp/claude-501/-Users-thomasholknielsen-Code-Workspaces-claude-tweaks--claude-worktrees-skill-size-limits-3230/6868a867-4fdc-4b7b-b94f-8d2cc6f423c4/scratchpad/ac1-sweep.js"`

6. **F1, the p95 tier (Task 7), applies only if the plan-validation gate accepts it.** The live-corpus probe (n = 442 files, median 8,543 B, p95 39,519 B) shows the effect:
   - nearest-rank p95 flags 22 files;
   - `max(p95, 3 × median)` also flags 22, so it changes nothing live while fixing the uniform-corpus and tier-edge flips.

## The new model, stated once for every rewrite

Use this wording family. Never keep "50 KB", "51,200", "byte ceiling", "composed-bytes ceiling" or `CEILING_BYTES` in a rewritten sentence.

- **The Read-limit rail** (`RAIL_BYTES`/`RAIL_LINES`, `plugin/bin/lib/skill-audit/budgets.js`) is the only size limit that blocks.
  - It binds every shipped skill `.md` file and every composed bundle. A file or bundle over it cannot be read in one Read call.
  - The `rail:` tests in `tests/bin-lib/skill-audit/context-cost.test.js` enforce it, through `rail.js`.
- **Per-invocation cost is shown, not gated:** `/review`'s skill load delta, and `/harness-health`'s transcript-measured skill load.
- **Coherence** is the corpus-relative `sizeOutlier` bloat signal.
- **Composition over fragmentation** (decision 0016) still stands. When a file grows, fence its condition-specific passages with `when:` markers or compose them. Never split it into a "read X now" sibling that moves bytes without cutting them.
- **A sentence that only narrates why a file was split in the past** loses its size clause or is deleted, e.g. "extracted to stay under the composed-bytes ceiling". Keep the rest of the sentence when it still instructs.

## Global Constraints

- **`budgets.js` is the only module the rewritten code imports for a size number.**
  - `checks.js` imports `RAIL_BYTES` from `../skill-audit/budgets` and `composedBytesReport` from `../skill-audit/context-cost`.
  - It no longer imports `CEILING_BYTES` or `COMPOSED_STEP_EXCEPTIONS`.
- **Out of scope (#3311's leftovers):** do not delete or modify `context-cost.js`, `bloat.js`'s ceiling code, `merge-size-probe.js` (either file), or any test that only pins `CEILING_BYTES`.
  - Task 7 may change `bloat.js`'s `corpusSizeBaseline` and nothing else in that file.
- **Plan-audit envelope key names stay** (`breaches`, `nearCeiling`, `composed`, `composedNearCeiling`, and the composed row's `ceiling` field). Only their meaning moves to the rail.
- **Rule-shape constraints:**
  - `docs/donts.md` rules keep the "rule plus one clause of why" shape, with no narrative.
  - A skill reference inside actionable step text uses `/claude-tweaks:{skill}`.
- **Re-grep before editing.** Every target file's line numbers here are a snapshot; re-grep the cited string first.
- **Pinned prose.** `plugin/skills/**` prose is pinned by conformance tests. A test pinning a rewritten sentence is updated in the same commit as the prose.
- **Commits and verification.**
  - Commit style: `{Verb} {what} — {detail} (refs #3310)`. The message ends with the line `Claude-Session: https://claude.ai/code/session_01QCX4onFvfDc9rsSUN52717`. Never write "closes" or "fixes #".
  - Each implementer runs the targeted suites named in its task. The full `npm test` runs centrally after the last task.
  - Quote raw command output in your report; never summarize pass/fail counts.
- **Worktree.** Work only in `/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude/worktrees/skill-size-limits-3230`. Start with `cd` into it, then `pwd` and `git rev-parse --show-toplevel`, and confirm both match before any edit. Never `git stash`, `git reset`, or force-push. Stage specific files only.

## Review Focus

1. **The plan-audit near band is `≥ 0.9 × RAIL_BYTES`** (47,250 B), for files and composed rows alike. A 51,201 B file is `nearCeiling`, not a breach.
2. **Harness-health never calls `overRail` on raw `composedBytesReport` rows.**
3. **The prose↔code signal pin in `bloat.test.js`** still proves go-red with a frozen pre-change excerpt. The frozen excerpt becomes the pre-#3310 five-signal sentence.
4. **No pointer to a renumbered `pr-checklist-refresh.md` item is left stale** anywhere in `plugin/` or live `docs/`.

---

### Task 1: plan-audit headroom against the rail

**Files:**
- Modify: `plugin/bin/lib/plan-audit/checks.js`
- Modify: `plugin/bin/plan-audit.js`
- Modify: `plugin/skills/build/plan-audit.md`
- Modify: `plugin/skills/build/SKILL.md`
- Test: `tests/bin-lib/plan-audit/checks.test.js`
- Test: `tests/bin-lib/plan-audit/cli.test.js`

- [ ] **Step 1: Write the failing tests**

In `tests/bin-lib/plan-audit/checks.test.js`, replace the `CEILING_BYTES` import with these two lines:

```js
const { composedBytesReport } = require('../../../plugin/bin/lib/skill-audit/context-cost');
const { RAIL_BYTES } = require('../../../plugin/bin/lib/skill-audit/budgets');
```

Then rebuild every existing headroom fixture from `RAIL_BYTES` (each `CEILING_BYTES` becomes `RAIL_BYTES`; the composed row's expected `ceiling` becomes `RAIL_BYTES`). After the existing `headroomCheck ignores Create entries` test, add the following test. It reuses the file's existing `writeFileOfSize` and temp-repo helpers; match their names exactly as the neighbouring headroom tests use them.

```js
test('headroomCheck measures against the Read-limit rail: breach above RAIL_BYTES, near at >= 90% of it, neither below (#3310)', () => {
  const near = Math.ceil(0.9 * RAIL_BYTES);
  const cases = [
    { name: 'over-rail.md', bytes: RAIL_BYTES + 1, breach: true, nearFlag: false },
    { name: 'at-rail.md', bytes: RAIL_BYTES, breach: false, nearFlag: true },
    { name: 'near-edge.md', bytes: near, breach: false, nearFlag: true },
    { name: 'old-ceiling.md', bytes: 51201, breach: false, nearFlag: true },
    { name: 'below-near.md', bytes: near - 1, breach: false, nearFlag: false },
  ];
  for (const c of cases) {
    const repo = makeTmpRepo();
    try {
      const rel = path.join('plugin', 'skills', 'demo', c.name);
      writeFileOfSize(path.join(repo, rel), c.bytes);
      const result = headroomCheck([{ type: 'Modify', path: rel }], repo);
      assert.strictEqual(result.breaches.length, c.breach ? 1 : 0, `${c.name}: breach`);
      assert.strictEqual(result.nearCeiling.length, c.nearFlag ? 1 : 0, `${c.name}: nearCeiling`);
      if (c.nearFlag) assert.strictEqual(result.nearCeiling[0].headroom, RAIL_BYTES - c.bytes);
      assert.strictEqual(result.ok, !c.breach, `${c.name}: ok`);
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  }
});
```

If the file's temp-repo helper is not named `makeTmpRepo`, use the name the neighbouring headroom tests use.

In `tests/bin-lib/plan-audit/cli.test.js`, replace the `CEILING_BYTES` import with `const { RAIL_BYTES } = require(path.resolve(__dirname, '..', '..', '..', 'plugin', 'bin', 'lib', 'skill-audit', 'budgets'));`. Rebuild both fixtures: `RAIL_BYTES - 500` for the near-ceiling case, and `RAIL_BYTES + 1` for the breach case. Where the CLI test asserts the human summary line, assert `near rail` instead of `near-ceiling`, both for files (`Headroom: N near rail`) and for composed rows (`Composed: N near rail`).

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test tests/bin-lib/plan-audit/checks.test.js tests/bin-lib/plan-audit/cli.test.js`
Expected: FAIL. The new rail test fails on `old-ceiling.md: breach` (51,201 B is over today's 51,200 B ceiling), and the CLI summary assertions fail on `near rail`.

- [ ] **Step 3: Retarget `checks.js`**

1. Replace the import block. Delete the `CEILING_BYTES, composedBytesReport, COMPOSED_STEP_EXCEPTIONS` require and write:

```js
const { composedBytesReport } = require('../skill-audit/context-cost');
const { RAIL_BYTES } = require('../skill-audit/budgets');
```

2. In `composedHeadroom`, replace the three-line exceptions-or-ceiling pick with `const ceiling = RAIL_BYTES;`. Keep the `ceiling` field on the entry, so the envelope is unchanged.
3. In the comment block above `composedHeadroom`, replace "alongside `ceiling` (honoring `COMPOSED_STEP_EXCEPTIONS`) and `over`" with "alongside `ceiling` (the Read-limit rail, `RAIL_BYTES` — no per-step exceptions) and `over`". Also replace the opening phrase "a per-file ceiling never caught" with "a per-file check never caught", and "is what crosses the ceiling" with "is what crosses the rail".
4. In `headroomCheck`, replace `CEILING_BYTES` with `RAIL_BYTES` in the breach test, the near test (`bytes >= RAIL_BYTES * 0.9`), and the headroom arithmetic.
5. In the `composedErrors` comment ("not "over ceiling""), write "not "over the rail"".

- [ ] **Step 4: Retarget `plan-audit.js`'s summary wording**

Change `Headroom: ${…} near-ceiling` to `Headroom: ${…} near rail`, and `Composed: ${…} near-ceiling` to `Composed: ${…} near rail`. Leave every other summary part as it is.

- [ ] **Step 5: Rewrite the prose**

- **`plugin/skills/build/plan-audit.md`.** Re-grep for `ceiling` and `50 KB`. Rewrite the headroom description:
  - `breaches` = over `RAIL_BYTES`, the Read-limit rail in `plugin/bin/lib/skill-audit/budgets.js`. A file this size cannot be read in one Read call.
  - `nearCeiling` = at or above 90% of the rail. This is a plan-time heads-up and never fails the check.
  - Composed rows are measured against the same rail, with no per-step exceptions.
  - Keep the envelope key names, and keep every other sentence.
- **`plugin/skills/build/SKILL.md`, `**Size-headroom check:**` paragraph.** Replace the paragraph with:

  `**Size-headroom check:** when a plan task appends to a `plugin/skills/**/*.md` file already within ~10% of `RAIL_BYTES` (the Read-limit rail, `plugin/bin/lib/skill-audit/budgets.js`), measure `wc -c` on the merge base and name the composition step up front in the plan — `when:` markers or a compose call site, never a "read X now" split; the `rail:` tests fail CI for a file or composed bundle over the rail. (Same check applies in Design Step 3 below.)`
- **`plugin/skills/build/SKILL.md`, Common Step 1.5 bullet `**Headroom (always):**`.** Replace it with:

  `- **Headroom (always):** for each existing governed-corpus `.md` file (`plugin/skills/**/*.md`) the plan modifies, current bytes + headroom against `RAIL_BYTES`, the Read-limit rail — a soft `nearCeiling` flag (at or above 90% of the rail) never fails the check; a `breach` (over the rail) does.`

- [ ] **Step 6: Run the targeted suites**

Run: `node --test tests/bin-lib/plan-audit/checks.test.js tests/bin-lib/plan-audit/cli.test.js`
Expected: PASS.

Then run `grep -rln "Size-headroom check\|Headroom (always)\|near-ceiling" tests/`. Run every suite it lists, and fix any prose pin the rewrite broke in this same commit.

- [ ] **Step 7: Commit**

```bash
git add plugin/bin/lib/plan-audit/checks.js plugin/bin/plan-audit.js plugin/skills/build/plan-audit.md plugin/skills/build/SKILL.md tests/bin-lib/plan-audit/checks.test.js tests/bin-lib/plan-audit/cli.test.js
git commit -m "Retarget plan-audit headroom to the Read-limit rail — RAIL_BYTES breach, 90% near band, no composed exceptions (refs #3310)" -m "Claude-Session: https://claude.ai/code/session_01QCX4onFvfDc9rsSUN52717"
```

Also stage any prose-pin test you had to update.

---

### Task 2: harness-health bloat scan and composed check on the rail

**Files:**
- Modify: `plugin/skills/_shared/harness-health-analysis.md`
- Modify: `plugin/skills/harness-health/judge-procedure.md`
- Modify: `plugin/skills/harness-health/SKILL.md`
- Test: `tests/bin-lib/skill-audit/bloat.test.js`

- [ ] **Step 1: Write the failing tests**

In `tests/bin-lib/skill-audit/bloat.test.js`, make three changes to the `prose signal list names exactly the signals auditText returns` test and its constants:

1. Replace `FOUR_SIGNAL_EXCERPT` with a constant `FIVE_SIGNAL_EXCERPT`. Its value is the pre-#3310 sentence, verbatim:

```js
const FIVE_SIGNAL_EXCERPT = 'It reports five signals: files over the 50 KB soft ceiling, Anti-Pattern rows more than twice the corpus median byte length, provenance-narration phrasing (text addressed to whoever edited the file rather than to the model running it), adjacent table rows whose right-hand cells are identical or near-identical, and a skill file far larger than its siblings.';
```

2. Compute the live signal set without the ceiling signal, which both procedures suppress with `{ ceiling: Infinity }`:

```js
  // overCeiling is suppressed at both call sites with { ceiling: Infinity } (#3310);
  // #3311 deletes the field itself.
  const codeSignals = Object.keys(auditText('', { bytes: 0, rowMedian: null, sizeThreshold: 0 }))
    .filter((k) => k !== 'bytes' && k !== 'headroom' && k !== 'overCeiling');
```

3. Make the frozen check use `FIVE_SIGNAL_EXCERPT`, and update the comment above it to "The frozen excerpt is the pre-#3310 sentence; it must fail against today's live signal set".

Then append the following test. `REPO`, `fs` and `path` are already in scope in this file.

```js
test('both bloat-scan call sites suppress the ceiling signal, and suppress size outliers only for non-skill targets (#3310)', () => {
  for (const rel of [['_shared', 'harness-health-analysis.md'], ['harness-health', 'judge-procedure.md']]) {
    const text = fs.readFileSync(path.join(REPO, 'plugin', 'skills', ...rel), 'utf8');
    const label = rel.join('/');
    assert.match(text, /kind === 'skill' \? \{ ceiling: Infinity \} : \{ ceiling: Infinity, sizeOutlier: false \}/, `${label}: bloat call must pick options by kind`);
    assert.match(text, /bloatReport\(target, corpus, opts\)/, `${label}: bloat call must pass opts`);
    assert.doesNotMatch(text, /soft ceiling/, `${label}: no soft-ceiling signal`);
    assert.doesNotMatch(text, /\*\*Over the ceiling\.\*\*/, `${label}: guard bullet must be the rail bullet`);
    assert.match(text, /- \*\*Over the rail\.\*\* /, `${label}: rail guard bullet`);
  }
  const analysis = fs.readFileSync(path.join(REPO, 'plugin', 'skills', '_shared', 'harness-health-analysis.md'), 'utf8');
  assert.match(analysis, /composedRailViolations/, 'check 10 must go through rail.js');
  assert.doesNotMatch(analysis, /overComposedCeiling|CEILING_BYTES|COMPOSED_STEP_EXCEPTIONS/);
  const skill = fs.readFileSync(path.join(REPO, 'plugin', 'skills', 'harness-health', 'SKILL.md'), 'utf8');
  assert.doesNotMatch(skill, /overComposedCeiling/);
  assert.match(skill, /`rail:` suite/);
});

test('a 60,000 B skill target scanned with { ceiling: Infinity } prints no soft-ceiling line (#3310 AC3)', () => {
  const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'bloat-3310-'));
  try {
    const target = path.join(dir, 'big.md');
    fs.writeFileSync(target, `# Big\n\n${'word '.repeat(12000)}`);
    const sibling = path.join(dir, 'small.md');
    fs.writeFileSync(sibling, '# Small\n\ntext\n');
    assert.ok(fs.statSync(target).size >= 60000);
    assert.ok(!bloatReport(target, [sibling], { ceiling: Infinity }).includes('soft ceiling'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test tests/bin-lib/skill-audit/bloat.test.js`
Expected: FAIL. The signal-pin test fails (prose states five signals, live set is four), and the call-site test fails on `bloat call must pick options by kind`.

- [ ] **Step 3: Rewrite `_shared/harness-health-analysis.md`**

1. **Check 9's command.** Pass the target's `kind` as the first argument:

```bash
   setopt nullglob 2>/dev/null || shopt -s nullglob 2>/dev/null
   node -e "
   const { bloatReport } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/skill-audit/bloat.js');
   const [kind, target, ...corpus] = process.argv.slice(1);
   const opts = kind === 'skill' ? { ceiling: Infinity } : { ceiling: Infinity, sizeOutlier: false };
   console.log(bloatReport(target, corpus, opts));
   " "<kind>" "<target-path>" "<root>"/.claude/skills/*.md "<root>"/.claude/skills/*/*.md
```

   After the existing quoting paragraph, add one sentence: "`<kind>` is the target's kind (`skill`, `rule`, or `claude-md`): a rule file or CLAUDE.md carries check 4's tiered line budget, so it never joins the skill-size sample."

2. **The signal sentence.** Replace it, from "It reports five signals:" to its closing period, with:

   `It reports four signals: Anti-Pattern rows more than twice the corpus median byte length, provenance-narration phrasing (text addressed to whoever edited the file rather than to the model running it), adjacent table rows whose right-hand cells are identical or near-identical, and a skill file far larger than its siblings (skill targets only).`

   Keep the rest of that paragraph.

3. **Check 10.** Replace the code block and the paragraph after it with:

```bash
    node -e "
    const { composedBytesReport } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/skill-audit/context-cost.js');
    const { composedRailViolations } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/skill-audit/rail.js');
    const root = process.argv[1]; const rows = composedBytesReport(root);
    console.log(JSON.stringify({ rows: rows.map((r) => ({ step: r.step, file: r.file, max: r.max, error: r.error })), overRail: composedRailViolations(root) }));
    " "<plugin-root>"
```

   Follow it with:

   `` `<plugin-root>` is the directory with `skills/` directly beneath it — this repo's `plugin/`, or `${CLAUDE_PLUGIN_ROOT}` for an installed consumer — never the repo root. An `overRail` entry — a combination over `RAIL_BYTES` (`budgets.js`, the Read-limit rail), or a call site the module could not measure — is evidence for dimension 9, cited by the module's numbers, never restated here. `composedRailViolations` is the only rail reader for these rows: they carry `max`, not `bytes`, so `overRail` on a raw row fails closed. ``

   Also rename the check's bold lead from "**Composed-bytes measurement**" to "**Composed-bytes rail check**".

4. **Dimension 9's table row.**
   - In the question, replace "or a compose call site composing over its ceiling?" with "or a file or compose call site over the Read rail?".
   - In the Skill cell, write `✓ (all four signals, plus check 10's rail check)`.
   - In the Rule cell, write `✓ (provenance and degenerate-row signals; size is check 4's tiered line budget, so the size-outlier signal is suppressed)`.

5. **The `- **Over the ceiling.**` guard bullet.** Replace the whole bullet with:

   `- **Over the rail.** A real finding for a skill file, one of its sub-files, or a composed bundle over `RAIL_BYTES` (`budgets.js`): it cannot be read in one Read call, so a reader sees a paged partial view. The `rail:` tests already fail CI on it; cite `rail.js`'s `skillFileRailViolations`/`composedRailViolations` numbers. The fix is composition first — `when:` markers or a compose call site whose composed bytes check 10 measures — and extraction to a lazy-loaded sub-file only when the sub-file is a genuinely lazy unit some runs never read; never raising the rail. A sub-file cited by two or more stubs naming *sections* of it is the same defect one level down, since `Read` has no section granularity.`

- [ ] **Step 4: Rewrite `harness-health/judge-procedure.md`**

Apply the same edits, using this file's own placeholder style (`{plugin-root}`, `{target.path}`, `{root}`; add `"{target.kind}"` as the first argument):
- check 9's command and the `kind` sentence;
- the signal sentence, verbatim as above;
- dimension 9's table row (same cell texts; its question already names the composed bundle only if it does today, so re-read it first);
- the guard bullet, replaced by the identical `- **Over the rail.**` bullet.

This file has no check 10; do not add one.

- [ ] **Step 5: Rewrite `harness-health/SKILL.md`'s Composed-bytes-per-step paragraph**

In the paragraph that begins `**Composed-bytes-per-step check (#1909`, replace the clause "the hard gate on that measurement already lives in `tests/bin-lib/skill-audit/context-cost.test.js`'s `overComposedCeiling` suite" with:

"the hard gate on that measurement is the Read-limit rail — `tests/bin-lib/skill-audit/context-cost.test.js`'s `rail:` suite (`rail.js`'s `composedRailViolations` against `budgets.js`'s `RAIL_BYTES`)"

Leave the rest of the paragraph and the CLI call unchanged.

- [ ] **Step 6: Run the targeted suites**

Run: `node --test tests/bin-lib/skill-audit/bloat.test.js tests/bin-lib/skill-audit/context-cost.test.js`
Expected: PASS.

Then run `grep -rln "harness-health-analysis\|judge-procedure\|harness-health/SKILL" tests/`. Run every listed suite, and fix any prose pin the rewrite broke in this same commit.

- [ ] **Step 7: Commit**

```bash
git add plugin/skills/_shared/harness-health-analysis.md plugin/skills/harness-health/judge-procedure.md plugin/skills/harness-health/SKILL.md tests/bin-lib/skill-audit/bloat.test.js
git commit -m "Cut harness-health's bloat scan and composed check over to the rail — ceiling suppressed, outliers skill-only, composedRailViolations (refs #3310)" -m "Claude-Session: https://claude.ai/code/session_01QCX4onFvfDc9rsSUN52717"
```

Also stage any prose-pin test you had to update.

---

### Task 3: remove the merge-size probe from the PR checklist

**Files:**
- Modify: `plugin/skills/_shared/pr-checklist-refresh.md`
- Modify: `plugin/bin/lib/wrap-up/pack.js`
- Modify: `docs/journeys/read-an-accurate-spec-summary-after-a-premise-reversal-3050.md`
- Test: `tests/bin-lib/wrap-up/pack.test.js`

- [ ] **Step 1: Write the failing test**

In `tests/bin-lib/wrap-up/pack.test.js`, rewrite the test `the mergeSize probe is gone — its consumer must measure after its own fetch (#1930 fix round 4)`:

```js
// #3310 removed the pre-merge merge-size step itself: nothing consumes a
// merge-size prediction, from the pack or from the CLI.
test('no merge-size probe anywhere in the pre-merge refresh (#1930 fix round 4, #3310)', () => {
  assert.ok(!PROBE_NAMES.includes('mergeSize'));
  const refresh = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'plugin', 'skills', '_shared', 'pr-checklist-refresh.md'), 'utf8');
  assert.ok(!refresh.includes('pack.mergeSize'), 'the pre-merge step reads no pack-fed merge size');
  assert.ok(!refresh.includes('merge-size-probe'), 'the pre-merge step no longer runs the probe CLI');
  const section = refresh.slice(refresh.indexOf('## Pre-merge title/description refresh'), refresh.indexOf('## Merge-time gh-absent degrade'));
  const numbers = [...section.matchAll(/^(\d+)\. /gm)].map((m) => Number(m[1]));
  assert.deepStrictEqual(numbers, numbers.map((_, i) => i + 1), 'items are numbered contiguously from 1');
});
```

Delete the old comment block above it, which starts "The pre-merge merge-size step fetches".

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/bin-lib/wrap-up/pack.test.js`
Expected: FAIL with `the pre-merge step no longer runs the probe CLI`.

- [ ] **Step 3: Before renumbering, find every external citation of this section's item numbers**

```bash
grep -rn -i -E "pr-checklist-refresh|Pre-merge (title/description )?refresh" plugin docs .claude/skills tests | grep -i -E "(item|step) ?[1-5]"
```

Read each hit. The known one is `docs/journeys/read-an-accurate-spec-summary-after-a-premise-reversal-3050.md`'s "Pre-merge refresh step 2", which becomes step 1. A hit whose number refers to another file's steps (e.g. `pr-first-merge.md` Step 2) is not one of these.

Also check the same files for citations by item title: "Rewrite the `Fixes` block" becomes item 2, and the record-title read becomes item 3.

- [ ] **Step 4: Edit `pr-checklist-refresh.md`**

Delete item `1. **Merge-size probe (#641).**` in full, through the line ending "surfaces a real conflict on its own." Then renumber the remaining items 2→1, 3→2, 4→3, 5→4. Fix any in-file cross-reference to those numbers.

- [ ] **Step 5: Reword `pack.js`'s comment**

Replace the six-line `// No mergeSize probe (#1930 fix round 4): …` comment with:

```js
    // No mergeSize probe (#1930 fix round 4). #3310 removed its only consumer,
    // the pre-merge merge-size step: size limits block only at the Read rail,
    // which the rail tests enforce on the merged tree.
```

- [ ] **Step 6: Fix the Step 3 citations**

Update each citation found in Step 3, including the 3050 journey's "step 2" → "step 1".

- [ ] **Step 7: Run the targeted suites**

Run: `node --test tests/bin-lib/wrap-up/pack.test.js tests/pr-early-run-lifecycle.test.js tests/bundle-fixes-reconciliation-2015.test.js tests/deferred-closure-fixes-2686.test.js tests/premise-reversal-spec-summary-3050.test.js tests/merge-verification-gate-conformance.test.js tests/bin-lib/flow/manifest.test.js tests/bin-lib/skill-audit/context-cost.test.js`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add plugin/skills/_shared/pr-checklist-refresh.md plugin/bin/lib/wrap-up/pack.js tests/bin-lib/wrap-up/pack.test.js docs/journeys/read-an-accurate-spec-summary-after-a-premise-reversal-3050.md
git commit -m "Remove the merge-size probe from the pre-merge refresh — items renumbered from 1, citations repointed (refs #3310)" -m "Claude-Session: https://claude.ai/code/session_01QCX4onFvfDc9rsSUN52717"
```

Also stage any other file whose citation you fixed.

---

### Task 4: plan-time guidance measures against the rail

**Files:**
- Modify: `plugin/skills/specify/decomposition-mode.md`
- Modify: `plugin/skills/specify/collapse-decision.md`
- Modify: `plugin/skills/build/plan-authoring-checks.md`
- Test: `tests/specify-decomposition-collapse.test.js`

- [ ] **Step 1: Write the failing test**

In `tests/specify-decomposition-collapse.test.js`, update the existing assertion at `:68`. It pins `never read the adjacent Ceiling-headroom flag` in `collapse-decision.md`; it becomes `/never read the adjacent Rail-headroom flag/`. Then append the following test, using the file's existing `read(rel)` helper (repo-root relative):

```js
test('decomposition-mode names a rail-headroom flag measured against RAIL_BYTES, and collapse-decision follows the rename (#3310)', () => {
  const decomp = read('plugin/skills/specify/decomposition-mode.md');
  assert.match(decomp, /\*\*Rail-headroom flag\.\*\*/);
  assert.match(decomp, /RAIL_BYTES/);
  assert.doesNotMatch(decomp, /CEILING_BYTES|Ceiling-headroom/);
  const collapse = read('plugin/skills/specify/collapse-decision.md');
  assert.match(collapse, /rail-headroom flag/i);
  assert.doesNotMatch(collapse, /ceiling-headroom/i);
});
```

If the file's helper is named differently, use its name. If no existing test pins this text, append the test as written.

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/specify-decomposition-collapse.test.js`
Expected: FAIL on `/\*\*Rail-headroom flag\.\*\*/`.

- [ ] **Step 3: Rewrite the three prose files**

- **`decomposition-mode.md`.** Rename the paragraph `**Ceiling-headroom flag.**` to `**Rail-headroom flag.**`. It reads the shared file's current `wc -c` against `RAIL_BYTES` (52,500 B, the Read-limit rail in `plugin/bin/lib/skill-audit/budgets.js`) and flags a group whose shared file sits within 10% of it, i.e. at or above 47,250 B. Delete the stale "(45 KB …)" figure. Keep the rest of the paragraph's instruction: what the flag triggers.
- **`collapse-decision.md`.** Follow the rename: "Ceiling-headroom flag" becomes "Rail-headroom flag", with its anchor or wording.
- **`plan-authoring-checks.md`, `**Byte-pin check:**`.** "measure it against every ceiling that binds it, not only the shared 51,200-byte constant" becomes "measure it against `RAIL_BYTES` (the Read-limit rail, `plugin/bin/lib/skill-audit/budgets.js`) and against any per-file byte pin still present in `tests/`". Keep the `grep tests/` instruction that follows.

- [ ] **Step 4: Run the targeted suites**

Run: `node --test tests/specify-decomposition-collapse.test.js`
Expected: PASS.

Then run `grep -rln "decomposition-mode\|collapse-decision\|plan-authoring-checks" tests/`. Run every listed suite, and fix any prose pin the rewrite broke in this same commit.

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/specify/decomposition-mode.md plugin/skills/specify/collapse-decision.md plugin/skills/build/plan-authoring-checks.md tests/specify-decomposition-collapse.test.js
git commit -m "Measure plan-time size headroom against the rail — rail-headroom flag at 90% of RAIL_BYTES, byte-pin check (refs #3310)" -m "Claude-Session: https://claude.ai/code/session_01QCX4onFvfDc9rsSUN52717"
```

---

### Task 5: rewrite every remaining live citation of the old size model

**Files:**
- Modify: `plugin/skills/_shared/session-tmp-root.md`
- Modify: `plugin/skills/_shared/worktree-setup.md`
- Modify: `plugin/skills/backlog/refine-record.md`
- Modify: `plugin/skills/tidy/digest-sweep.md`
- Modify: `plugin/skills/review/focus-criterion-passes.md`
- Modify: `plugin/skills/review/code-mode-steps.md`
- Modify: `plugin/skills/build/worktree-setup.md`
- Modify: `plugin/skills/build/adopted-branch-collision-check.md`
- Modify: `plugin/skills/build/cherry-pick-provenance-check.md`
- Modify: `plugin/bin/lib/flow/artifact-overwrite-check.js`
- Modify: `plugin/bin/lib/wrap-up/engine-verify.js`
- Modify: `.claude/skills/compose-context-fencing/SKILL.md`
- Modify: `.claude/skills/shared-contract-extraction/SKILL.md`
- Modify: `docs/skill-authoring.md`
- Modify: `docs/donts.md`
- Modify: `docs/plugin-structure.md`
- Modify: `docs/skill-graph.md`
- Modify: `docs/journeys/compose-a-per-run-context-bundle-1988.md`
- Modify: `docs/journeys/measure-composed-bytes-per-call-site-1990.md`
- Modify: `docs/journeys/read-a-size-outlier-in-the-bloat-scan-3308.md`
- Modify: `docs/journeys/read-a-skill-load-delta-at-review-3307.md`
- Modify: `docs/journeys/act-on-a-red-read-limit-rail-3306.md`

- [ ] **Step 1: The failing check is AC1's sweep**

No committed test, per the spec: AC1 is a scratch script.

- [ ] **Step 2: Run it to verify it fails**

Run: `node "/private/tmp/claude-501/-Users-thomasholknielsen-Code-Workspaces-claude-tweaks--claude-worktrees-skill-size-limits-3230/6868a867-4fdc-4b7b-b94f-8d2cc6f423c4/scratchpad/ac1-sweep.js"`
Expected: FAIL (exit 1). Its hit list names every file above, plus whatever Tasks 1–4 have not already cleared.

- [ ] **Step 3: Rewrite each hit**

Apply "The new model, stated once for every rewrite" above to every hit the sweep prints, file by file. Re-grep each file for `ceiling`, `50 KB`, `51,200`, `40 KB`, `45 KB` and `40,960` before editing.

Per-file guidance:
- **Split-provenance sentences** in `session-tmp-root.md`, `worktree-setup.md` (both), `refine-record.md`, `digest-sweep.md`, `focus-criterion-passes.md`, `code-mode-steps.md`, `adopted-branch-collision-check.md` and `cherry-pick-provenance-check.md`: drop the size clause, keeping the pointer. For example, `extracted to stay under the composed-bytes ceiling at its call site (…)` becomes `kept in its own file and composed at its call site (…)`, or the clause is deleted when the remaining sentence still reads. In `session-tmp-root.md`, "which matters for a skill file already close to the 50 KB ceiling" becomes "which matters for a skill file near the Read rail".
- **`artifact-overwrite-check.js` and `engine-verify.js`:** each comment names `bin/lib/merge-size-probe.js` as a shape example, and #3311 deletes that file. Repoint each to the `gh-api-module-pattern` project skill alone. Read the comment and keep its sense.
- **`.claude/skills/compose-context-fencing/SKILL.md`:**
  - The `:23` bullet says the composed gate is the hard one. Rewrite it: the hard gate for a composed call site and for a raw file is the Read rail (`rail.js`, `budgets.js`).
  - The `:59` "Gates:" list becomes the rail tests (`context-cost.test.js` `rail:` suite), `plan-audit`'s `headroomCheck` against `RAIL_BYTES`, and `bloat.js`'s size-outlier signal. Remove `merge-size-probe`.
- **`.claude/skills/shared-contract-extraction/SKILL.md`:** the `:54` merge-time bullet, plus both "no `_shared` byte ceiling" mentions. The latter become "no `_shared` size budget beyond the Read rail".
- **`docs/skill-authoring.md`:**
  - The `**Size:**` paragraph becomes the new model in two to four sentences: the rail binds and blocks; load delta and transcript load are shown; the size outlier is a coherence signal.
  - In `**Composition over fragmentation.**`, "When a file nears its ceiling" becomes "When a file grows", and "Per-file byte ceilings measure …" is reworded so it names no ceiling.
- **`docs/donts.md` `:16`, `:17`, `:187`.** Rewrite each to the rail, keeping "rule plus one clause of why".
  - `:17`: "on a SKILL.md already close to 50 KB" becomes "on a SKILL.md already near the Read rail".
  - `:187`: measure `wc -c` against `RAIL_BYTES`; drop the "warning tier and merge-time disclosure" clause, since #3310 removes the disclosure.
- **`docs/plugin-structure.md`:**
  - `:23`: the `skill-audit/` description names the rail (`budgets.js`/`rail.js`), the load model, the bloat signals and transcript load; drop "40 KB per-file ceiling".
  - `:129`: the context-cost-report row's pointer becomes "that's the `rail:` suite in `tests/bin-lib/skill-audit/context-cost.test.js`".
  - Leave the `merge-size-probe.js` CLI row (#3311).
- **`docs/skill-graph.md` `:232` and `:637`:** drop the size clause ("to fit the `merge` bundle under the 40 KB composed-bytes ceiling", "to stay inside that file's own byte ceiling headroom"), keeping the edge text.
- **Journeys:**
  - **1988:** for every step quoting a measured byte figure against `CEILING_BYTES`, re-measure live with

    ```bash
    node -e 'const c=require("./plugin/bin/lib/skill-audit/context-cost.js");for(const r of c.composedBytesReport("plugin"))console.log(r.step,r.max)'
    ```

    and restate the figure against the 52,500 B rail (`RAIL_BYTES`). Step 116's `ceiling` field is the rail now; step 119's red flag drops the `40960` literal clause, or restates it as a rail literal outside `budgets.js`. In the `## Notes` provenance lines, delete only the `against the 51,200 B ceiling`-style clauses, keeping each line's record pointer, and add one line: `- Re-measured against the Read rail during build of #3310 (the ceiling is gone; composed bundles are judged by `rail.js`'s `composedRailViolations`).`
  - **1990:** the step-26 URL calls `require("./plugin/bin/lib/skill-audit/rail.js").composedRailViolations("plugin")`. The "Should understand" line compares against `RAIL_BYTES` (52,500 B). The red flags drop the exception-entry clause. The `:14` success state and the `:48` related-specs line lose their ceiling mentions.
  - **3308, 3307, 3306:** rewrite the related-spec and provenance lines that say "#3310 … stops citing the 50 KB ceiling" to "#3310 (cuts every size consumer over to the rail)". In 3308, "It sits beside the existing "over the 50 KB soft ceiling" signal, which still reports until #3311" becomes "The ceiling signal is suppressed at every call site since #3310; #3311 removes it".

Every journey edit also bumps nothing else. Keep each journey's frontmatter `files:` unchanged unless a listed file was deleted.

- [ ] **Step 4: Run the sweep and the targeted suites**

Run: `node "/private/tmp/claude-501/-Users-thomasholknielsen-Code-Workspaces-claude-tweaks--claude-worktrees-skill-size-limits-3230/6868a867-4fdc-4b7b-b94f-8d2cc6f423c4/scratchpad/ac1-sweep.js"`
Expected: `ac1-sweep: clean`. If the only remaining hits are in the decision record or `docs/incident-log.md`, those are excluded paths, so the script does not print them.

Then run, for every file you edited, `grep -rln "{basename}" tests/`, and run each suite it lists. Also run: `node --test tests/bin-lib/skill-audit/context-cost.test.js tests/skill-mode-split-conformance.test.js tests/sweep-backstop.test.js`.
Expected: PASS.

- [ ] **Step 5: Commit**

Stage each edited file by name.

```bash
git commit -m "Rewrite every live citation of the old byte ceiling to the Read rail — skills, project skills, docs, journeys (refs #3310)" -m "Claude-Session: https://claude.ai/code/session_01QCX4onFvfDc9rsSUN52717"
```

---

### Task 6: decision record, 0016 status, IL-153 pointer

**Files:**
- Create: `docs/decisions/0024-skill-size-limits-guard-platform-limits-only.md`
- Modify: `docs/decisions/0016-composed-bundles-gate-context-size-not-per-file-ceilings.md`
- Modify: `docs/incident-log.md`

- [ ] **Step 1: Re-check the number**

Run: `ls docs/decisions/`
If `0024-*` exists, use the next free number in the file name, the title, and the 0016 status line.

- [ ] **Step 2: Write the decision record**

Use exactly this content, substituting the number only if Step 1 moved it:

````markdown
# 0024. Skill size limits block only where they guard a platform limit

- **Status:** accepted
- **Date:** 2026-10-17
- **Context:** #3230 (rethink skill byte ceilings), decomposed as parent #3305 into #3306–#3311; reverses #2020; supersedes the ceiling numbers of [0016](0016-composed-bundles-gate-context-size-not-per-file-ceilings.md)

## Context

One global byte ceiling (`CEILING_BYTES`, raised in steps from 40 KB to 50 KB) gated every shipped skill file and, since #1990, every composed bundle. It kept tipping `main` red on concurrent merges. Two branches each green alone could merge into a file over the line, and each raise only moved the cliff (#3230). #2020 had decided every `SKILL.md` keeps a hard ceiling in `npm test`.

The number was never derived from a limit. The platform limits that actually exist, read from Claude Code 2.1.302 (calibrated in session; `plugin/bin/lib/skill-audit/budgets.js`'s header records the samples):

- **Read tool:** 25,000 tokens and 2,000 lines per call without `offset`/`limit`. Over the cap, Read returns a paged partial view, so the file cannot be read in one call.
- **Skill listing:** budget = context tokens × 4 × 0.01 characters; each description is capped at 1,536 characters.
- **Bash inline output:** 30,000 characters. This, not a single-read ceiling, is what truncated #611's 34.3 KB file. Skill prose instructs Read, never `cat`, so this cap is recorded and is **not** a rail.

## Decision

Four goals, each with its own mechanism:

1. **Guard the platform limit (blocks).** The Read-limit rail: `RAIL_BYTES` = 25,000 tokens × 2.1 B/token (the densest measured file) = 52,500 B, and `RAIL_LINES` = 2,000, at `RAIL_RATIO` 1.0. An 80% rail landed under 17 shipped files at the measured ratio and was set to the cap at #3306's plan gate. The margin is the conservative bytes-per-token itself. The rail binds every shipped skill `.md` and every composed bundle (`rail.js`; the `rail:` tests in `context-cost.test.js`), and each description's 1,536-character cap.
2. **Show per-invocation cost (never blocks).** `/review`'s skill load delta (floor and closure per entry point, #3307) and `/harness-health`'s transcript-measured load (#3309).
3. **Keep files coherent (evidence, never blocks).** The corpus-relative `sizeOutlier` bloat signal (#3308).
4. **Compose, don't fragment.** [0016](0016-composed-bundles-gate-context-size-not-per-file-ceilings.md)'s composition-over-fragmentation principle stands: fence condition-specific passages with `when:` markers or compose them, never a "read X now" split that moves bytes without cutting them.

Plan-audit keeps its near band at 90% of the limit (now `RAIL_BYTES`), unchanged from its existing convention, as a plan-time heads-up threshold, not re-derived. Its JSON envelope keys keep their names.

`budgets.js`'s exports are read by `plan-audit`'s `checks.js` (`RAIL_BYTES`), `rail.js` (`overRail`, `DESCRIPTION_MAX_CHARS`), harness-health's two judging procedures (through `rail.js`), and `context-cost.test.js`/`budgets.test.js`. Renaming `RAIL_BYTES` or `overRail` means updating each of these deliberately.

## Consequences

- No size number tips `main` red unless a file or bundle genuinely cannot be read in one call. The concurrent-merge disclosure (`merge-size-probe`) goes with the cliff it predicted.
- #2020's hard per-`SKILL.md` gate is reversed. #3311 deletes `CEILING_BYTES`, the warning tier, `COMPOSED_STEP_EXCEPTIONS`, `merge-size-probe`, and the per-file test pins.
- **Accepted trade-off:** the rail sits at the cap with no ratio margin. Tokenizer drift, `when:` marker lines a direct Read still sees, and a denser-than-measured file are absorbed only by the 2.1 B/token floor until the calibration is re-run (#3304 tracks drift checks).
- Cost is visible but no longer gated. A file can grow expensive below the rail, and the load delta and the size outlier make that a reviewer's judgment, not a test failure.

## Alternatives considered

- **Keep one global ceiling and raise it again:** rejected. It is the cliff that kept tipping `main` red, and no limit derives its number.
- **Per-file ceilings tuned per file:** rejected. Hundreds of numbers to maintain, still unrelated to any platform limit.
- **A rail at 80% of the Read cap:** rejected at #3306's plan gate. 42,000 B at the measured ratio sat under 17 shipped files.
- **A rail on the Bash 30,000-character cap:** rejected. Skills read with Read, and the cap sits below files shipping today.
````

- [ ] **Step 3: Update 0016's Status line**

Change `- **Status:** accepted` to `- **Status:** accepted — ceiling numbers superseded by [0024](0024-skill-size-limits-guard-platform-limits-only.md)`.

- [ ] **Step 4: Add the IL-153 pointer**

In `docs/incident-log.md`'s `## IL-153 — …` entry, add exactly one line directly after the heading's blank line:

`> Superseded: [decision 0024](decisions/0024-skill-size-limits-guard-platform-limits-only.md) (#3310) — size limits now block only at the Read rail.`

Make no other change there.

- [ ] **Step 5: Verify**

Run: `git diff -- docs/incident-log.md | grep -c '^+[^+]'`
Expected: `1`.

Then run `grep -c "25,000\|2,000 lines\|1,536\|0.01\|30,000\|2.1.302\|#2020\|0016\|#611\|#3230" docs/decisions/0024-skill-size-limits-guard-platform-limits-only.md` and confirm each token appears. Then run `node --test tests/decisions-*.test.js 2>/dev/null; grep -rln "docs/decisions" tests/`, and run every suite listed.

- [ ] **Step 6: Commit**

```bash
git add docs/decisions/0024-skill-size-limits-guard-platform-limits-only.md docs/decisions/0016-composed-bundles-gate-context-size-not-per-file-ceilings.md docs/incident-log.md
git commit -m "Record decision 0024 — skill size limits block only at the Read rail; 0016 ceiling numbers superseded, IL-153 pointer (refs #3310)" -m "Claude-Session: https://claude.ai/code/session_01QCX4onFvfDc9rsSUN52717"
```

---

### Task 7: size-outlier threshold floored at 3 × median (#3305 F1, only if the plan gate accepts it)

**Files:**
- Modify: `plugin/bin/lib/skill-audit/bloat.js`
- Modify: `docs/journeys/read-a-size-outlier-in-the-bloat-scan-3308.md`
- Test: `tests/bin-lib/skill-audit/bloat.test.js`

- [ ] **Step 1: Write the failing tests**

In `tests/bin-lib/skill-audit/bloat.test.js`:

- **Rewrite `size outlier: p95 tier baseline with 20 files`** (#3308's AC1 pin). Its 1,000…20,000 B fixture has median 10,500 B, so the floor (31,500 B) would win and nothing would be flagged. Build the 20 files instead as 10 at 1,000 B plus 10 at 10,000, 11,000, …, 19,000 B, keeping the same `skillWith([SHORT_ROW])` + padding construction. For that set:
  - median = 5,500 B, so the floor is 16,500 B;
  - nearest-rank p95 = 18,000 B, so the threshold is 18,000 B;
  - only the 19,000 B file is flagged.

  Assert `threshold === 18000`, exactly one outlier (`file-20`), and the report lines `/size baseline: p95 \(floor 3× median\) 18000 B over 20 files/` and `/size-outlier: 19000 B, above the corpus threshold of 18000 B/`.
- **Leave `size outlier: boundary — at threshold not outlier, one byte above is` unchanged.** It reads the threshold dynamically, and it keeps passing under the floor (21 files at ~1,100 B give a threshold of ~3 × 1,100).
- **Add the two tests below.** Reuse the file's existing `corpusSizeBaseline` import.

```js
test('size outlier: a uniform 20+ file corpus flags nothing — the p95 threshold is floored at 3x median (#3305 F1)', () => {
  const files = Array.from({ length: 20 }, (_, i) => ({ file: `f${i}.md`, bytes: 10000 + i * 10 }));
  const b = corpusSizeBaseline(files);
  assert.strictEqual(b.method, 'p95');
  assert.ok(files.every((f) => f.bytes <= b.threshold), `threshold ${b.threshold} must cover a uniform corpus`);
});

test('size outlier: the 19 to 20 file tier edge no longer flips a verdict (#3305 F1)', () => {
  const nineteen = [...Array.from({ length: 18 }, () => ({ bytes: 5000 })), { bytes: 14000 }];
  const twenty = [...nineteen, { bytes: 5000 }];
  assert.ok(14000 <= corpusSizeBaseline(nineteen).threshold);
  assert.ok(14000 <= corpusSizeBaseline(twenty).threshold);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test tests/bin-lib/skill-audit/bloat.test.js`
Expected: FAIL. Both new tests fail (p95 alone flags the top file), and the rewritten p95-tier test fails on its report label: the threshold is already 18,000 B, but the label lacks `(floor 3× median)`.

- [ ] **Step 3: Floor the p95 tier**

In `corpusSizeBaseline`, replace the p95 branch with:

```js
  if (sample >= SIZE_PERCENTILE_MIN_SAMPLE) {
    // Nearest-rank p95, floored at the small-corpus tier's 3x median: a
    // uniform corpus flags nothing, and the 19->20-file edge cannot flip a
    // verdict (#3305 F1)
    const sorted = [...sizes].sort((a, b) => a - b);
    const p95 = sorted[Math.ceil(SIZE_OUTLIER_PERCENTILE * sample) - 1];
    const threshold = Math.max(p95, median(sizes) * SIZE_MEDIAN_MULTIPLE);
    return { usable: true, sample, method: 'p95', threshold };
  }
```

In `formatBloatReport`, change the p95 method label from `p95 ${sizeBaseline.threshold} B` to `p95 (floor 3× median) ${sizeBaseline.threshold} B`.

- [ ] **Step 4: Update the 3308 journey**

Update the step that explains the threshold so it says p95, floored at 3 × median. Add one `## Notes` line: `- Threshold floored at 3 × median during build of #3310 (#3305 F1): a uniform corpus flags nothing; live corpus unchanged (22 flagged).`

- [ ] **Step 5: Run the targeted suites**

Run: `node --test tests/bin-lib/skill-audit/bloat.test.js tests/bin-lib/skill-audit/context-cost.test.js`
Expected: PASS.

Then run `grep -rln "size baseline: p95\|corpusSizeBaseline" tests/`, run each suite it lists, and update any pin on the old label in this same commit.

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/lib/skill-audit/bloat.js tests/bin-lib/skill-audit/bloat.test.js docs/journeys/read-a-size-outlier-in-the-bloat-scan-3308.md
git commit -m "Floor the size-outlier p95 threshold at 3x median — uniform corpora flag nothing, tier edge stable (refs #3310, #3305 F1)" -m "Claude-Session: https://claude.ai/code/session_01QCX4onFvfDc9rsSUN52717"
```

---

## Final verification (central, after Task 7)

1. `node "$AC1_SWEEP"` → `ac1-sweep: clean` (AC1).
2. `npm test > {scratch}/npm-test-3310.txt 2>&1; echo exit=$? >> {scratch}/npm-test-3310.txt` → exit 0 (AC7).
3. `plan-audit` against a plan modifying every live compose source reports no composed breach (AC2's second clause). Use `context-cost.js`'s `composedBytesReport("plugin")` sources to build a scratch plan, run `node plugin/bin/plan-audit.js {scratch-plan} --repo-root .`, and confirm `headroom.composed.every(c => c.over === 0)`.
