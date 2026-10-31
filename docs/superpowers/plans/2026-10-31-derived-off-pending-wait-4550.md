# Derived-`off` Pending Wait Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A pr-first merge under a *derived* `merge-verification: off` waits (Step 2.5's bounded watch) on a PR whose own checks are observed pending, instead of merging through Step 3 while CI runs.

**Architecture:** Prose-only change to the one canonical gate (`_shared/pr-first-merge.md` Step 2.5) plus two citing sites (`_shared/policy-schema-coverage.md` after its derivation block, `release/execute.md`'s PR-check gate). A second, project-level `resolve-policy.js merge-verification` read (no `--run`) tells a derived `off` from an explicit one. No `bin/` change; the four-branch derivation is untouched.

**Tech Stack:** Markdown skill prose; `node --test` prose-conformance tests.

**Spec:** `.claude-tweaks/pipelines/2026-10-31T095259-spec-4549-4550-4556/spec-4550/work/4550-spec.md`

## Global Constraints

- Do not change `_shared/policy-schema-coverage.md`'s four branches (between `<!-- merge-verification-derivation:start -->` and `:end -->`), `plugin/bin/lib/merge-verification.js`, or `tests/merge-verification.test.js`.
- The gate procedure is stated once, in `pr-first-merge.md`; `release/execute.md` cites Step 2.5's derived-`off` rule, never restates its condition (`tests/merge-verification-gate-conformance.test.js`'s single-statement rule).
- `tests/pr-first-merge.test.js:294`'s pin ``under `merge-verification: off` only — degrade to an immediate merge`` stays byte-identical (Step 3 item 1 is not edited).
- **Byte budget (blocking).** The `merge` compose bundle (`pr-first-merge.md` + `pr-checklist-refresh.md`) composes to at most **51,651 B** today against `RAIL_BYTES` **52,500 B** (`plugin/bin/lib/skill-audit/budgets.js`) — **849 B** of headroom, enforced by `tests/bin-lib/skill-audit/context-cost.test.js`'s `rail:` test. Task 1's net growth of `pr-first-merge.md` must keep that max ≤ 52,500; the copy below is sized at ~650 B. If a wording change pushes it over, trim this task's own new text — never existing content. `release/execute.md` is 47,670 B (90.8% of the rail): Task 2 adds ≤ 300 B.
- The project-level read prints a keyed envelope — probed in this repo: `node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-policy.js" merge-verification` → `{"merge-verification":{"value":"merge-when-green","source":"default"}}`. Prose names the **`merge-verification` entry** as `{"value":"off","source":"default"}` (the spec's literal, scoped to the entry — logged as a premise correction in `decisions.md`).

## Review Focus

1. **Red discovered during a derived-`off` watch.** The watch's own `RC=1` takes the Red path (park), while a derived `off` that reads red at the *first* read keeps the `off` Red column ("Step 3 as written; the red read is logged"). This plan takes the watch's outcomes in full (the spec: "take the `wait` row's bounded watch (and its timeout outcome…)") and leaves the first-read Red column unchanged — a reviewer should judge whether that asymmetry needs a spec ruling. No test pins a change to the Red column; Task 1's tests pin that the Red cell is unchanged.
2. **Project-level read failure.** Non-zero exit or unparseable JSON must count as *derived* (bounded wait), never explicit (blind merge) — Task 1 pins the clause.
3. **Run-level `off` set by the Manifesto over a non-`off` project value** (`merge-when-green` derived, Manifesto lever set to `off`) is *explicit* — the project entry's value is not `off`. Task 1 pins it.
4. **Derived `off` on a repo with no PR CI** (empty rollup, no head runs) must never enter the watch — otherwise every such repo parks after 15 minutes. Task 1 pins the empty-rollup clause.
5. **Release path restating the rule** instead of citing it would fork the single statement. Task 2 pins the citation and the absence of the `{"value":"off","source":"default"}` literal in `release/execute.md`.

## Prose sweep (Behavior-change prose sweep)

Grepped `plugin/`, `README.md`, `docs/getting-started.md` for `skips the *wait*`, `derives `off``, `non-default integration branch`, `Pending under `off``, and `merge-verification … off`:

| Hit | Disposition |
|---|---|
| `_shared/pr-first-merge.md:207` (`off` row Pending cell + parenthetical) | Task 1 rewrites |
| `release/execute.md:146` (delta 3: "Pending under `off` … no wait") | Task 2 rewrites |
| `_shared/pr-first-merge.md:175` (red bullet: "`off` skips the *wait*, not the read") | no-change — describes a red first read, where `off` still does not wait |
| `release/execute.md:145` (delta 2, same phrase, red context) | no-change — same reason |
| `_shared/pr-first-merge.md:370` (Step 3 item 1, `off` degrade) | no-change — pinned; a derived `off` with pending checks no longer reaches Step 3 while pending |
| `_shared/pr-first-merge.md:332` (closing keywords on a non-default branch, #4549) | no-change — unrelated |
| `_shared/policy-schema.md:100` (lever row, "Read via … --run … --values") | no-change — names the lever read; Step 2.5 owns what a site does with it |
| `_shared/express-lane.md:26` ("never `off`") | no-change — express lane overrides `off` |
| `_shared/pr-check-gate.md:51` (test gate red routing under `off`) | no-change — test-phase gate, not a merge wait |
| `_shared/policy-schema-coverage.md:70` (branch 2 "derives `off`") | no-change inside the block; Task 2 adds the sentence after the end marker |

## Spec coverage

| AC clause | Task / test |
|---|---|
| AC1.1 | Task 1 — `AC1.1 AC3.1 AC4.1: Step 2.5 carries the derived-off pending rule` |
| AC2.1, AC2.2 | Task 1 — `AC2.1 AC2.2: a derived off with an empty rollup still proceeds green` |
| AC3.1 | Task 1 — same test as AC1.1 |
| AC4.1 | Task 1 — same test as AC1.1 |
| AC5.1 | Task 1 (off row) + Task 2 — `AC5.1: the coverage block's follow-on sentence cites Step 2.5's derived-off rule` |
| AC5.2 | Task 2 Step 4 (git diff + unmodified suite) |
| AC6.1 | Task 2 — `AC6.1: the release PR-check gate carries the project-level read and cites the derived-off rule` |
| AC7.1 | Tasks 1-2 go-red controls; Task 2 Step 5 full suite |

---

### Task 1: Step 2.5 derived-`off` pending rule

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/skills/_shared/pr-first-merge.md:119-121` (lever-read fence), `:186-188` (empty-rollup bullet tail), `:207` (`off` row), `:209` (bounded-watch heading)
- Test: `tests/pr-first-merge.test.js` (append after the #3607 block, reusing `step25Section()` and `emptyRollupBullet()`)

**Interfaces:**
- Consumes: `step25Section()`, `emptyRollupBullet()`, `MERGE` already in `tests/pr-first-merge.test.js`.
- Produces: the Step 2.5 phrases Task 2 cites — "derived `off`" and "**Bounded watch**"; the AUTO text `derived off with pending checks on PR #{n} — bounded watch`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/pr-first-merge.test.js`:

```js
// #4550: a derived merge-verification `off` (no policy.yml key) waits on a PR's own observed
// pending checks; an explicit `off` keeps Step 3 as written. Frozen pre-change `off` row below
// proves the pins can go red [IL-105].
const PRE_4550_OFF_ROW = "| `off` | Step 3 as written (today's behavior, unchanged) | Step 3 as written (today's behavior — this is the #540-shaped race the lever exists to close; a repo derives `off` only when it has no PR CI or a non-default integration branch, `_shared/policy-schema-coverage.md`'s coverage block) | Step 3 as written; the red read is logged for the summary |";

const DERIVED_OFF_NEEDLES = [
  ['project-level read (no --run)', 'node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-policy.js" merge-verification\n'],
  ['derived entry literal', '`{"value":"off","source":"default"}`'],
  ['read failure counts as derived', 'or that read fails'],
  ['explicit: policy source', '`source: policy`'],
  ['explicit: run-level off over another project value', 'a run-level `off` over another project value'],
  ['off row pending → watch', 'Derived `off` (above) with a non-empty rollup or a head run not yet `completed` → **Bounded watch** below'],
  ['off row explicit → Step 3', 'Explicit `off` → Step 3 as written'],
  ['AUTO line', 'derived off with pending checks on PR #{n} — bounded watch'],
  ['watch heading names derived off', 'and a derived `off` with pending checks)'],
];

function assertDerivedOffRule(section) {
  for (const [label, needle] of DERIVED_OFF_NEEDLES) {
    assert.ok(section.includes(needle), `Step 2.5 missing ${label}: ${needle}`);
  }
  const row = section.split('\n').find((l) => l.startsWith('| `off` |'));
  assert.ok(row && row.endsWith('| Step 3 as written; the red read is logged for the summary |'), 'the off row Red cell is unchanged');
}

test('AC1.1 AC3.1 AC4.1: Step 2.5 carries the derived-off pending rule', () => {
  assertDerivedOffRule(step25Section());
});

test('AC7.1: each derived-off pin goes red when its clause is removed, and on the pre-#4550 off row', () => {
  const section = step25Section();
  assertDerivedOffRule(section); // the unmutated text passes, so each throw below is the mutation's doing
  for (const [label, needle] of DERIVED_OFF_NEEDLES) {
    assert.throws(() => assertDerivedOffRule(section.replace(needle, '')), `removing ${label} must fail the pin`);
  }
  const currentRow = section.split('\n').find((l) => l.startsWith('| `off` |'));
  assert.throws(() => assertDerivedOffRule(section.replace(currentRow, PRE_4550_OFF_ROW)));
});

function assertEmptyRollupNeverWaits(bullet) {
  assert.ok(bullet.includes('proceeds as green — derived `off` too, so a repo without PR CI never waits'), 'empty-rollup bullet must state a derived off never waits');
}

test('AC2.1 AC2.2: a derived off with an empty rollup still proceeds green', () => {
  assertEmptyRollupNeverWaits(emptyRollupBullet());
  assert.throws(() => assertEmptyRollupNeverWaits(PRE_3607_EMPTY_ROLLUP), 'the pre-change bullet fails the same pin (go-red) [IL-105]');
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/pr-first-merge.test.js`
Expected: FAIL — the three new tests fail (`AC1.1…` with `Step 2.5 missing project-level read (no --run)`, `AC7.1…` on its first, unmutated `assertDerivedOffRule(section)`, `AC2.1…` with `empty-rollup bullet must state a derived off never waits`). Every pre-existing test passes.

- [ ] **Step 3: Edit `plugin/skills/_shared/pr-first-merge.md` with exactly this copy**

(a) Replace the lever-read fence (lines 119-121) and append one paragraph after it:

````markdown
```bash
MERGE_VERIFICATION=$(node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-policy.js" --run "$PIPELINE_RUN_DIR" --values merge-verification)
node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-policy.js" merge-verification
```

The second, project-level read (no `--run`) tells a **derived** `off` from an explicit one: `off` is derived when `$MERGE_VERIFICATION` is `off` and that read's `merge-verification` entry is `{"value":"off","source":"default"}`, or that read fails (non-zero exit, unparseable) — a bounded wait, never a blind merge. `source: policy`, or a run-level `off` over another project value, is explicit.
````

(b) In the empty-rollup bullet, change the tail `simply "no CI" and proceeds as green.` to `simply "no CI" and proceeds as green — derived `off` too, so a repo without PR CI never waits.` (keep the existing line break before `simply`).

(c) Replace line 207 with:

```markdown
| `off` | Step 3 as written (today's behavior, unchanged) | Derived `off` (above) with a non-empty rollup or a head run not yet `completed` → **Bounded watch** below, logged `AUTO {HH:MM:SS} — Step 2.5 (merge-verification gate): derived off with pending checks on PR #{n} — bounded watch. Reversibility: high. [lever: merge-verification=off (default)]`. Explicit `off` → Step 3 as written (the #540-shaped race, kept by choice) | Step 3 as written; the red read is logged for the summary |
```

(d) In the bounded-watch heading (line 209), change `(`wait`, and `merge-when-green` when arming would not hold)` to `(`wait`, `merge-when-green` when arming would not hold, and a derived `off` with pending checks)`.

- [ ] **Step 4: Run tests and the byte rail**

Run: `node --test tests/pr-first-merge.test.js tests/merge-verification-gate-conformance.test.js tests/bin-lib/skill-audit/context-cost.test.js`
Expected: PASS, 0 fail.

Run: `node -e "const m=require('./plugin/bin/lib/skill-audit/context-cost.js'); console.log(Math.max(...m.composedBytesReport('plugin').filter((r)=>r.step==='merge').map((r)=>r.max)))"`
Expected: a number ≤ 52500 (was 51651). Record it in the commit body.

- [ ] **Step 5: Commit**

```bash
git -C "$WORKTREE" add plugin/skills/_shared/pr-first-merge.md tests/pr-first-merge.test.js
git -C "$WORKTREE" commit -m "Wait on observed pending checks under a derived off — pr-first-merge Step 2.5 (#4550)"
```

---

### Task 2: Cite the rule from the coverage block and the release path

**Role:** integration

**Files:**
- Modify: `plugin/skills/_shared/policy-schema-coverage.md:75` (one sentence after the `:end -->` marker line, outside the markers)
- Modify: `plugin/skills/release/execute.md` — the PR-check gate fence (~line 137) and delta 3's last sentence (~line 146)
- Test: `tests/merge-verification-gate-conformance.test.js` (append)

**Interfaces:**
- Consumes: Task 1's Step 2.5 phrases "derived `off`" and "**Bounded watch**".
- Produces: nothing later tasks use.

- [ ] **Step 1: Write the failing tests**

Append to `tests/merge-verification-gate-conformance.test.js`:

```js
// #4550: the derived-off pending rule is stated once (Step 2.5); the coverage block and the
// release path point at it. Each pin is factored so its go-red control runs the same code.
function assertCoverageCitesDerivedOff(text) {
  const end = text.indexOf('<!-- merge-verification-derivation:end -->');
  assert.ok(end !== -1, 'derivation end marker present');
  const after = text.slice(end, text.indexOf('\n## ', end));
  assert.ok(after.includes("`_shared/pr-first-merge.md` Step 2.5's derived-`off` rule"), 'sentence after the block cites Step 2.5');
  const block = text.slice(text.indexOf('<!-- merge-verification-derivation:start -->'), end);
  assert.ok(!block.includes('derived-`off` rule'), 'the sentence sits outside the markers');
}

function assertReleaseCitesDerivedOff(text) {
  const gate = text.slice(text.indexOf('**The PR-check gate'), text.indexOf('**Reviewed-tip comparison'));
  assert.ok(gate.includes('node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-policy.js" merge-verification\n'), 'release gate carries the project-level read');
  assert.ok(gate.includes('a derived `off` (Step 2.5) takes the bounded watch'), 'delta 3 applies the derived-off rule');
  assert.ok(!gate.includes('{"value":"off","source":"default"}'), 'release cites the rule, never restates its condition');
}

test('AC5.1: the coverage block\'s follow-on sentence cites Step 2.5\'s derived-off rule', () => {
  const text = read('_shared', 'policy-schema-coverage.md');
  assertCoverageCitesDerivedOff(text);
  assert.throws(() => assertCoverageCitesDerivedOff(text.replace("`_shared/pr-first-merge.md` Step 2.5's derived-`off` rule", '')));
});

test('AC6.1: the release PR-check gate carries the project-level read and cites the derived-off rule', () => {
  const text = read('release', 'execute.md');
  assertReleaseCitesDerivedOff(text);
  assert.throws(() => assertReleaseCitesDerivedOff(text.replace('node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-policy.js" merge-verification\n', '')));
  assert.throws(() => assertReleaseCitesDerivedOff(text.replace('a derived `off` (Step 2.5) takes the bounded watch', "Step 2.5's `off` column unchanged — today's behavior, no wait")));
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/merge-verification-gate-conformance.test.js`
Expected: FAIL — `sentence after the block cites Step 2.5` and `release gate carries the project-level read`.

- [ ] **Step 3: Edit both files with exactly this copy**

(a) `policy-schema-coverage.md`: after the `<!-- merge-verification-derivation:end -->` line, add a blank line and:

```markdown
A derived `off` still waits on a PR's own pending checks at merge time — `_shared/pr-first-merge.md` Step 2.5's derived-`off` rule — so branch 4 skips the wait only for a PR whose checks never report.
```

(b) `release/execute.md`: in the PR-check gate fence, add `node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-policy.js" merge-verification` as the line right after the `MERGE_VERIFICATION=$(…)` line. In delta 3, replace the last sentence `Pending under `off` is Step 2.5's `off` column unchanged — today's behavior, no wait.` with `Pending under `off` is Step 2.5's `off` column: a derived `off` (Step 2.5) takes the bounded watch, an explicit one does not wait.`

- [ ] **Step 4: Run tests and the unchanged-derivation check (AC5.2)**

Run: `node --test tests/merge-verification-gate-conformance.test.js tests/merge-verification.test.js tests/pr-first-merge.test.js`
Expected: PASS, 0 fail.

Run: `git -C "$WORKTREE" diff --exit-code d4d40c982 -- plugin/bin/lib/merge-verification.js tests/merge-verification.test.js`
Expected: exit 0, no output (AC5.2: code twin and its tests untouched).

Run: `git -C "$WORKTREE" diff -U0 d4d40c982 -- plugin/skills/_shared/policy-schema-coverage.md`
Expected: the only hunk starts after the `:end -->` line (no `-` line inside lines 66-75) (AC5.2: four branches unchanged).

- [ ] **Step 5: Commit**

```bash
git -C "$WORKTREE" add plugin/skills/_shared/policy-schema-coverage.md plugin/skills/release/execute.md tests/merge-verification-gate-conformance.test.js
git -C "$WORKTREE" commit -m "Cite the derived-off pending rule from the coverage block and the release gate (#4550)"
```

The full suite (`npm test`, AC7.1) runs centrally at /build Common Step 5, not inside this task.
