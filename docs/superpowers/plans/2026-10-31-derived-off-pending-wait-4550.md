# Derived-`off` Pending Wait Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A pr-first merge under a *derived* `merge-verification: off` waits (Step 2.5's bounded watch) on a PR whose own checks are observed pending, and parks on a red one, instead of merging through Step 3 while CI runs or fails.

**Architecture:** Prose-only change to the one canonical gate (`_shared/pr-first-merge.md` Step 2.5) plus three citing sites (`_shared/policy-schema-coverage.md` after its derivation block, `release/execute.md`'s PR-check gate, `_shared/pr-check-gate.md`'s `red` routing). A second, project-level `resolve-policy.js merge-verification` read (no `--run`) tells a derived `off` from an explicit one. No `bin/` change; the four-branch derivation is untouched.

**Tech Stack:** Markdown skill prose; `node --test` prose-conformance tests.

**Spec:** `.claude-tweaks/pipelines/2026-10-31T095259-spec-4549-4550-4556/spec-4550/work/4550-spec.md` (including its `## Plan Review Clarifications` — the user's plan-review decision on red under a derived `off`)

## Global Constraints

- Do not change `_shared/policy-schema-coverage.md`'s four branches (between `<!-- merge-verification-derivation:start -->` and `:end -->`), `plugin/bin/lib/merge-verification.js`, or `tests/merge-verification.test.js`.
- The gate procedure is stated once, in `pr-first-merge.md`; `release/execute.md` and `pr-check-gate.md` cite Step 2.5's derived/explicit rule, never restate its condition (`tests/merge-verification-gate-conformance.test.js`'s single-statement rule).
- `tests/pr-first-merge.test.js:294`'s pin ``under `merge-verification: off` only — degrade to an immediate merge`` stays byte-identical (Step 3 item 1 is not edited).
- **Byte budget (blocking).** The `merge` compose bundle (`pr-first-merge.md` + `pr-checklist-refresh.md`) composes to at most **51,651 B** today against `RAIL_BYTES` **52,500 B** (`plugin/bin/lib/skill-audit/budgets.js`) — **849 B** of headroom, enforced by `tests/bin-lib/skill-audit/context-cost.test.js`'s `rail:` test. Task 1's copy below is sized at ~620 B net. If a wording change pushes the max over 52,500, trim this task's own new text — never existing content. `release/execute.md` is 47,670 B (90.8% of the rail): Task 2 adds ≤ 350 B. `pr-check-gate.md` is 7,477 B.
- The project-level read prints a keyed envelope — probed in this repo: `node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-policy.js" merge-verification` → `{"merge-verification":{"value":"merge-when-green","source":"default"}}`. Prose names the **`merge-verification` entry** as `{"value":"off","source":"default"}` (the spec's literal, scoped to the entry — logged as a premise correction in `decisions.md`).
- **Decided by the user at plan review (spec clarification):** a derived `off` takes the Red path on red at the first read and during the watch; an explicit `off` keeps "Step 3 as written" on red.

## Review Focus

1. **Project-level read failure.** Non-zero exit or unparseable JSON must count as *derived* (bounded wait / park), never explicit (blind merge) — Task 1 pins the clause.
2. **Run-level `off` set by the Manifesto over a non-`off` project value** (`merge-when-green` derived, Manifesto lever set to `off`) is *explicit* — the project entry's value is not `off`. Task 1 pins it.
3. **Derived `off` on a repo with no PR CI** (empty rollup, no head runs) must never enter the watch — otherwise every such repo parks after 15 minutes. Task 1 pins the empty-rollup clause.
4. **Branch-2 derived `off` with third-party status checks** (no Actions `pull_request` workflow, but a StatusContext from another CI) now waits and parks on those checks like branch 4. Task 2's coverage sentence names branches 2 and 4 so neither reads as "never waits".
5. **Mirror sites restating the rule** instead of citing it would fork the single statement. Task 2 pins the citations and the absence of the `{"value":"off","source":"default"}` literal in `release/execute.md` and `pr-check-gate.md`.

## Prose sweep (Behavior-change prose sweep)

Grepped `plugin/`, `tests/`, `README.md`, `docs/getting-started.md` for `skips the *wait*`, `derives `off``, `non-default integration branch`, `Pending under `off``, `merges anyway`, `logged and shown`, `route `red` like`, and `merge-verification … off`:

| Hit | Disposition |
|---|---|
| `_shared/pr-first-merge.md:207` (`off` row: Pending cell + parenthetical, Red cell) | Task 1 rewrites |
| `_shared/pr-first-merge.md:172-176` (red bullet: "the value `off` merges anyway … logged and shown, not acted on") | Task 1 rewrites |
| `release/execute.md:146` (delta 3: "Pending under `off` … no wait") | Task 2 rewrites |
| `release/execute.md:145` (delta 2: "`off` still merges anyway") | Task 2 rewrites |
| `_shared/pr-check-gate.md:50-54` (`red` under `off` passes with a caveat, quoting Step 2.5's "logged and shown, not acted on") | Task 2 rewrites |
| `_shared/pr-first-merge.md:370` (Step 3 item 1, `off` degrade) | no-change — pinned; a derived `off` with pending checks no longer reaches Step 3 while pending, and once the watch reads green the `wait` row's green cell merges through Step 3's immediate `--squash` form |
| `_shared/pr-first-merge.md:332` (closing keywords on a non-default branch, #4549) | no-change — unrelated |
| `_shared/policy-schema.md:100` (lever row, "Read via … --run … --values") | no-change — names the lever read; Step 2.5 owns what a site does with it |
| `_shared/express-lane.md:26` ("never `off`") | no-change — express lane overrides `off` |
| `_shared/policy-schema-coverage.md:70` (branch 2 "derives `off`") | no-change inside the block; Task 2's sentence after the end marker names branch 2 |
| `tests/pr-check-gate-conformance.test.js:39-43` (red bullet names `merge-verification` and `` `off` ``) | no-change — still holds after Task 2 |

## Spec coverage

| AC clause | Task / test |
|---|---|
| AC1.1 | Task 1 — `AC1.1 AC3.1 AC4.1: Step 2.5 carries the derived-off pending and red rule` |
| AC2.1, AC2.2 | Task 1 — `AC2.1 AC2.2: a derived off with an empty rollup still proceeds green` |
| AC3.1 | Task 1 — same test as AC1.1 |
| AC4.1 | Task 1 — same test as AC1.1 |
| AC5.1 | Task 1 (off row) + Task 2 — `AC5.1: the coverage block's follow-on sentence cites Step 2.5's derived-off rule` |
| AC5.2 | Task 2 Step 4 (git diff + unmodified suite) |
| AC6.1 | Task 2 — `AC6.1: the release PR-check gate carries the project-level read and cites the derived-off rule` |
| AC7.1 | Tasks 1-2 go-red controls; full suite at /build Common Step 5 |
| Plan Review Clarification (red under derived `off`) | Task 1 (Red cell + red bullet needles) + Task 2 (`release delta 2` and `pr-check-gate` needles) |

---

### Task 1: Step 2.5 derived-`off` pending and red rule

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/skills/_shared/pr-first-merge.md:119-121` (lever-read fence + new paragraph), `:172-176` (red bullet tail), `:186-188` (empty-rollup bullet tail), `:207` (`off` row), `:209` (bounded-watch heading)
- Test: `tests/pr-first-merge.test.js` (append after the #3607 block, reusing `step25Section()` and `emptyRollupBullet()`)

**Interfaces:**
- Consumes: `step25Section()`, `emptyRollupBullet()`, `PRE_3607_EMPTY_ROLLUP`, `MERGE` already in `tests/pr-first-merge.test.js`.
- Produces: the Step 2.5 terms Task 2 cites — "derived `off`" / "explicit" (defined in the new paragraph after the lever-read fence), "**Bounded watch**", "**Red path**"; the AUTO text `derived off with pending checks on PR #{n} — bounded watch`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/pr-first-merge.test.js`:

```js
// #4550: a derived merge-verification `off` (no policy.yml key) waits on a PR's own observed
// pending checks and parks on a red one; an explicit `off` keeps Step 3 as written. Frozen
// pre-change `off` row below proves the pins can go red [IL-105].
const PRE_4550_OFF_ROW = "| `off` | Step 3 as written (today's behavior, unchanged) | Step 3 as written (today's behavior — this is the #540-shaped race the lever exists to close; a repo derives `off` only when it has no PR CI or a non-default integration branch, `_shared/policy-schema-coverage.md`'s coverage block) | Step 3 as written; the red read is logged for the summary |";

const DERIVED_OFF_NEEDLES = [
  ['project-level read (no --run)', 'node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-policy.js" merge-verification\n'],
  ['derived entry literal', '`{"value":"off","source":"default"}`'],
  ['read failure counts as derived', 'or the read fails'],
  ['explicit: policy source', '`source: policy`'],
  ['explicit: run-level off over another project value', 'a run-level `off` over another project value'],
  ['off row pending → watch', 'Derived `off` with a non-empty rollup or a head run not yet `completed` → **Bounded watch** below'],
  ['off row pending explicit → Step 3', 'Explicit `off` → Step 3 as written |'],
  ['off row red split', '| Derived `off` → **Red path**. Explicit `off` → Step 3 as written; the red read is logged for the summary |'],
  ['red bullet: explicit merges, derived parks', 'but an explicit `off` merges anyway; a derived `off` takes the **Red path**'],
  ['AUTO line', 'derived off with pending checks on PR #{n} — bounded watch'],
  ['watch heading names derived off', 'and a derived `off` with pending checks)'],
];

function assertDerivedOffRule(section) {
  for (const [label, needle] of DERIVED_OFF_NEEDLES) {
    assert.ok(section.includes(needle), `Step 2.5 missing ${label}: ${needle}`);
  }
}

test('AC1.1 AC3.1 AC4.1: Step 2.5 carries the derived-off pending and red rule', () => {
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

(a) Replace the lever-read fence (lines 119-121) and add one paragraph right after it:

````markdown
```bash
MERGE_VERIFICATION=$(node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-policy.js" --run "$PIPELINE_RUN_DIR" --values merge-verification)
node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-policy.js" merge-verification
```

The project-level read (no `--run`) tells a **derived** `off` from an explicit one: derived when `$MERGE_VERIFICATION` is `off` and that read's `merge-verification` entry is `{"value":"off","source":"default"}`, or the read fails — a wait, never a blind merge. `source: policy`, or a run-level `off` over another project value, is explicit.
````

(b) In the red classification bullet (lines 172-176), change `but the value `off` merges anyway (today's behavior); the red classification is logged and shown, not acted on.` to `but an explicit `off` merges anyway; a derived `off` takes the **Red path**. An explicit `off`'s red read is logged and shown, not acted on.` — two-space continuation indent; the phrase `but an explicit `off` merges anyway; a derived `off` takes the **Red path**` stays on one line (Step 1's needle matches it literally — a rewrap that splits it fails the test), the rest may rewrap.

(c) In the empty-rollup bullet, change the tail `simply "no CI" and proceeds as green.` to `simply "no CI" and proceeds as green — derived `off` too, so a repo without PR CI never waits.` (keep the existing line break before `simply`).

(d) Replace line 207 with:

```markdown
| `off` | Step 3 as written (today's behavior, unchanged) | Derived `off` with a non-empty rollup or a head run not yet `completed` → **Bounded watch** below, logged `AUTO {HH:MM:SS} — Step 2.5 (merge-verification gate): derived off with pending checks on PR #{n} — bounded watch. Reversibility: high.` Explicit `off` → Step 3 as written | Derived `off` → **Red path**. Explicit `off` → Step 3 as written; the red read is logged for the summary |
```

(e) In the bounded-watch heading (line 209), change `(`wait`, and `merge-when-green` when arming would not hold)` to `(`wait`, `merge-when-green` when arming would not hold, and a derived `off` with pending checks)`.

- [ ] **Step 4: Run tests and the byte rail**

Run: `node --test tests/pr-first-merge.test.js tests/merge-verification-gate-conformance.test.js tests/pr-check-gate-conformance.test.js tests/bin-lib/skill-audit/context-cost.test.js`
Expected: PASS, 0 fail.

Run: `node -e "const m=require('./plugin/bin/lib/skill-audit/context-cost.js'); console.log(Math.max(...m.composedBytesReport('plugin').filter((r)=>r.step==='merge').map((r)=>r.max)))"`
Expected: a number ≤ 52500 (was 51651). Record it in the commit body.

- [ ] **Step 5: Commit**

```bash
git -C "$WORKTREE" add plugin/skills/_shared/pr-first-merge.md tests/pr-first-merge.test.js
git -C "$WORKTREE" commit -m "Wait on pending and park on red under a derived off — pr-first-merge Step 2.5 (#4550)"
```

---

### Task 2: Cite the rule from the coverage block, the release path, and the PR-check gate

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/skills/_shared/policy-schema-coverage.md:75` (one sentence after the `:end -->` marker line, outside the markers)
- Modify: `plugin/skills/release/execute.md` — the PR-check gate fence (~line 137), delta 2's last sentence (~line 145), delta 3's last sentence (~line 146)
- Modify: `plugin/skills/_shared/pr-check-gate.md:50-54` (the `red` bullet's `off` routing)
- Test: `tests/merge-verification-gate-conformance.test.js` (append)

**Interfaces:**
- Consumes: Task 1's Step 2.5 terms "derived `off`" / "explicit", "**Bounded watch**", "**Red path**".
- Produces: nothing later tasks use.

- [ ] **Step 1: Write the failing tests**

Append to `tests/merge-verification-gate-conformance.test.js`:

```js
// #4550: the derived-off rule is stated once (Step 2.5); the coverage block, the release path and
// the PR-check gate point at it. Each pin is factored so its go-red control runs the same code.
const COVERAGE_CITE = "`_shared/pr-first-merge.md` Step 2.5's derived-`off` rule — so branches 2 and 4 skip the wait only for a PR whose checks never report";
const RELEASE_PROJECT_READ = 'node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-policy.js" merge-verification\n';
const RELEASE_DELTA_2 = 'an explicit `off` still merges anyway; a derived `off` (Step 2.5) red is `failed`';
const RELEASE_DELTA_3 = 'a derived `off` (Step 2.5) takes the bounded watch, an explicit one does not wait';
const CHECK_GATE_RED = 'When it prints `off` and Step 2.5 reads it as explicit';

function assertCoverageCitesDerivedOff(text) {
  const end = text.indexOf('<!-- merge-verification-derivation:end -->');
  assert.ok(end !== -1, 'derivation end marker present');
  const after = text.slice(end, text.indexOf('\n## ', end));
  assert.ok(after.includes(COVERAGE_CITE), 'sentence after the block cites Step 2.5 and names branches 2 and 4');
  const block = text.slice(text.indexOf('<!-- merge-verification-derivation:start -->'), end);
  assert.ok(!block.includes('derived-`off` rule'), 'the sentence sits outside the markers');
}

function assertReleaseCitesDerivedOff(text) {
  const gate = text.slice(text.indexOf('**The PR-check gate'), text.indexOf('**Reviewed-tip comparison'));
  for (const needle of [RELEASE_PROJECT_READ, RELEASE_DELTA_2, RELEASE_DELTA_3]) {
    assert.ok(gate.includes(needle), `release PR-check gate missing: ${needle}`);
  }
  assert.ok(!gate.includes('{"value":"off","source":"default"}'), 'release cites the rule, never restates its condition');
}

function assertCheckGateCitesDerivedOff(text) {
  const red = text.slice(text.indexOf('- **`red`**'), text.indexOf('\n- **', text.indexOf('- **`red`**') + 1));
  assert.ok(red.includes(CHECK_GATE_RED), 'pr-check-gate passes red with a caveat only under an explicit off');
  assert.ok(red.includes('a derived `off`'), 'pr-check-gate names a derived off among the gate-failure values');
  assert.ok(!red.includes('{"value":"off","source":"default"}'), 'pr-check-gate cites the rule, never restates its condition');
}

test('AC5.1: the coverage block\'s follow-on sentence cites Step 2.5\'s derived-off rule', () => {
  const text = read('_shared', 'policy-schema-coverage.md');
  assertCoverageCitesDerivedOff(text);
  assert.throws(() => assertCoverageCitesDerivedOff(text.replace(COVERAGE_CITE, '')));
});

test('AC6.1: the release PR-check gate carries the project-level read and cites the derived-off rule', () => {
  const text = read('release', 'execute.md');
  assertReleaseCitesDerivedOff(text);
  for (const needle of [RELEASE_PROJECT_READ, RELEASE_DELTA_2, RELEASE_DELTA_3]) {
    assert.throws(() => assertReleaseCitesDerivedOff(text.replace(needle, '')), `removing ${needle} must fail the pin`);
  }
});

test('plan-review clarification: the PR-check gate fails a derived-off red and passes only an explicit one', () => {
  const text = read('_shared', 'pr-check-gate.md');
  assertCheckGateCitesDerivedOff(text);
  assert.throws(() => assertCheckGateCitesDerivedOff(text.replace(CHECK_GATE_RED, 'When it prints `off`')));
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/merge-verification-gate-conformance.test.js`
Expected: FAIL — the three new tests fail (`sentence after the block cites Step 2.5…`, `release PR-check gate missing: node …`, `pr-check-gate passes red with a caveat only under an explicit off`); every pre-existing test passes.

- [ ] **Step 3: Edit the three files with exactly this copy**

(a) `policy-schema-coverage.md`: after the `<!-- merge-verification-derivation:end -->` line, add a blank line and:

```markdown
A derived `off` still waits on a PR's own pending checks, and parks on a red one, at merge time — `_shared/pr-first-merge.md` Step 2.5's derived-`off` rule — so branches 2 and 4 skip the wait only for a PR whose checks never report.
```

(b) `release/execute.md`:
- In the PR-check gate fence, add `node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-policy.js" merge-verification` as the line right after the `MERGE_VERIFICATION=$(…)` line.
- In delta 2, replace the ending `, and `off` still merges anyway.` with `, and an explicit `off` still merges anyway; a derived `off` (Step 2.5) red is `failed`, never merged.`
- In delta 3, replace the last sentence `Pending under `off` is Step 2.5's `off` column unchanged — today's behavior, no wait.` with `Pending under `off` is Step 2.5's `off` column: a derived `off` (Step 2.5) takes the bounded watch, an explicit one does not wait.`

(c) `pr-check-gate.md`, in the `red` bullet: change `When it prints `off`, route `red` like` to `When it prints `off` and Step 2.5 reads it as explicit (its project-level `resolve-policy.js merge-verification` read), route `red` like`; change `matching `_shared/pr-first-merge.md` Step 2.5's `off` behaviour (a red PR check is "logged and shown, not acted on" there too)` to `matching `_shared/pr-first-merge.md` Step 2.5's explicit-`off` behaviour (a red PR check is "logged and shown, not acted on" there too)`; and change `Otherwise (`merge-when-green`,` to `Otherwise (a derived `off`, `merge-when-green`,`. The phrases `When it prints `off` and Step 2.5 reads it as explicit` and `a derived `off`` each stay on one line (Step 1's needles match them literally); the rest of the bullet may rewrap.

- [ ] **Step 4: Run tests and the unchanged-derivation check (AC5.2)**

Run: `node --test tests/merge-verification-gate-conformance.test.js tests/merge-verification.test.js tests/pr-first-merge.test.js tests/pr-check-gate-conformance.test.js tests/bin-lib/skill-audit/context-cost.test.js`
Expected: PASS, 0 fail.

Run: `git -C "$WORKTREE" diff --exit-code d4d40c982 -- plugin/bin/lib/merge-verification.js tests/merge-verification.test.js`
Expected: exit 0, no output (AC5.2: code twin and its tests untouched).

Run: `git -C "$WORKTREE" diff -U0 d4d40c982 -- plugin/skills/_shared/policy-schema-coverage.md`
Expected: the only hunk starts after the `:end -->` line (no `-` line inside lines 66-75) (AC5.2: four branches unchanged).

- [ ] **Step 5: Commit**

```bash
git -C "$WORKTREE" add plugin/skills/_shared/policy-schema-coverage.md plugin/skills/release/execute.md plugin/skills/_shared/pr-check-gate.md tests/merge-verification-gate-conformance.test.js
git -C "$WORKTREE" commit -m "Cite the derived-off rule from the coverage block, the release gate and the PR-check gate (#4550)"
```

The full suite (`npm test`, AC7.1) runs centrally at /build Common Step 5, not inside this task.
