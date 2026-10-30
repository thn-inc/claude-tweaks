# Tidy Plan Retention (#4465) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/claude-tweaks:tidy` Step 4 reads `superpowers-plans-retention` and stops auto-deleting `docs/superpowers/plans/` plans unless the policy is `prune-after-wrapup`.

**Architecture:** The retention routing lives once, in `plugin/skills/tidy/scan-procedures.md` Step 4. Step 4 still classifies a plan with its existing table; a would-be Delete for a `docs/superpowers/plans/` plan is then routed by the policy value into Delete (unchanged), Keep, or a new `Prune plan` recommendation. `step-6-auto.md` gains one terse Stage row for `Prune plan` and narrows its two plan-Delete mentions to `prune-after-wrapup`, citing Step 4 rather than restating it. `_shared/policy-schema.md` names tidy as a second consumer.

**Tech Stack:** Markdown skill prose, `node --test` conformance tests.

**Spec:** `.claude-tweaks/pipelines/2026-10-28T172234-spec-4468-4465-4423/spec-4465/work/4465-spec.md`

**Scope keywords:** superpowers-plans-retention, Audit Execution Plans

## Global Constraints

- `superpowers-plans-retention` values and default are fixed by `plugin/bin/lib/policy-schema.js`: `keep-forever` (default) / `prune-after-wrapup` / `ask`. Read it with `node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-policy.js" --values superpowers-plans-retention` — the same read `plugin/skills/wrap-up/cleanup-procedures.md` item 1 makes.
- The key governs `docs/superpowers/plans/` only. `~/.claude/plans/` (Claude Code's native plan-mode scratch) keeps Step 4's existing table unchanged. This is the spec's Plan Review Clarification 2, decided by the user.
- **Prune threshold and decline memory** (spec Plan Review Clarification 1, decided by the user):
  - Under `keep-forever`, past-cutoff plans stay Keep until **30 or more** of them exist. At that point tidy stages one `Prune plan (archive)` listing them all.
  - A human decline is recorded with `printf '%s' '{"description":"tidy Prune plan (archive): docs/superpowers/plans/","reason":"{why}"}' | node "${CLAUDE_PLUGIN_ROOT}/bin/declined-learning.js" record-decline --source tidy`.
  - Before staging, tidy checks the same description with `… declined-learning.js lookup --source tidy`. A non-null `decline` routes the plans back to Keep.
  - A failed lookup (non-zero exit) also counts as declined, so it fails closed toward Keep.
  - Reconcile's existing 180-day `pruneDeclines` expires a decline, so no new code is needed. The decline memory covers `keep-forever` only: `ask` stages on every run, because asking each time is that value's meaning.
- The age cutoff is **7 days** (ADR-0007's "last ~week"), measured from the plan's first-add commit date: `git -C "{REPO_ROOT}" log --diff-filter=A --format=%cs -1 -- {plan}`. Empty output or a non-zero exit (an uncommitted or unresolvable plan) counts as within the cutoff — fail closed toward Keep.
- `plan-citation-check.md` still runs before any plan Delete **and** before any `Prune plan` recommendation; a cited plan stays `Keep (cited plan)` under every value.
- **Size remedy (Size-headroom check):** `RAIL_BYTES` is 52500. `step-6-auto.md` is 49643 bytes (94.6%) and `_shared/policy-schema.md` 48481 (92.3%), so additions there stay terse (under 600 bytes each) and cite `scan-procedures.md` Step 4 instead of restating the routing. All routing detail goes in `scan-procedures.md` (45166 bytes).
- Commit style: `{Verb} {what} — {detail}`, imperative, ending with the trailer line `Claude-Session: https://claude.ai/code/session_01YPgdwTF5oxR7DnGFhhiX8r`.
- `#4468` already edited `scan-procedures.md` Step 4.5 and `step-6-auto.md` on this branch — read the live files; touch only Step 4 and the named rows.

## Review Focus

1. An uncommitted plan (no first-add commit) under `keep-forever` must read as within the cutoff → Keep, never a prune proposal. Pinned in Task 1.
2. A `~/.claude/plans/` scratch file must not be routed by the key — its Delete stays Delete. Pinned in Task 1.
3. A cited plan must stay `Keep (cited plan)` under every value — the citation check runs before a `Prune plan` recommendation too. Pinned in Task 1.
4. `aggressive` tidy must not auto-apply a `Prune plan` — the new row is Stage at every tier. Pinned in Task 2.
5. Under `ask`, a plan whose spec is in progress stays Keep (only would-be Deletes are staged). Pinned in Task 1.
6. A declined `keep-forever` prune must not re-stage on the next run (decline lookup → Keep). A lookup failure must fail closed toward Keep. Pinned in Task 1.

---

### Task 1: Step 4 resolves and routes by `superpowers-plans-retention`

**Files:**
- Modify: `plugin/skills/tidy/scan-procedures.md` (Step 4, the plan table and the "Before any plan Delete" line, currently lines 39-52)
- Modify: `plugin/skills/tidy/plan-citation-check.md` (line 3, the reader sentence)
- Modify: `tests/plan-citations-resolve.test.js:75` (the pinned "Before any plan Delete:" regex)
- Create: `tests/tidy-plan-retention-conformance.test.js`

**Review risk:** high

Why high: decision logic that decides whether a plan file may be deleted. It branches on the policy value, a git-derived age against the cutoff, the 30-plan threshold, and a decline lookup, with fail-closed handling.

**Covers:** AC1.1 — with `superpowers-plans-retention` unset (`keep-forever`), a plan within the cutoff is Keep (the route and fail-closed tests), and Task 2 confines auto-applied plan Deletes to `prune-after-wrapup`, so a `moderate` run deletes no plan created within the cutoff.

**Interfaces:**
- Produces: the recommendation strings Task 2's Step 6 row keys on — `Prune plan (archive)` (keep-forever, past the cutoff) and `Prune plan (ask)` (every would-be Delete under `ask`); both stage as one `tidy-prune-plan-{n}` proposal per run.

- [ ] **Step 1: Write the failing test (covers AC1.1)**

Create `tests/tidy-plan-retention-conformance.test.js` (header comment naming #4465; `readText` from `./helpers/read-skill`, `REPO_ROOT = path.join(__dirname, '..')`, same shape as `tests/tidy-scan-dispatch-conformance.test.js`). Slice Step 4 with a helper `step4Section()` that takes `SCAN_PROCEDURES` from `'## Step 4: Audit Execution Plans'` to `'## Step 4.5:'`, asserting both indexes are not `-1`. Tests:

```js
test('tidy Step 4 resolves superpowers-plans-retention (#4465)', () => {
  const s = step4Section();
  assert.match(s, /node "\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/resolve-policy\.js" --values superpowers-plans-retention/);
  assert.match(s, /governs `docs\/superpowers\/plans\/` only; `~\/\.claude\/plans\/`/);
});

test('tidy Step 4 routes a would-be plan Delete by the policy value (#4465)', () => {
  const s = step4Section();
  assert.match(s, /`prune-after-wrapup` → Delete, unchanged/);
  assert.match(s, /`ask` → `Prune plan \(ask\)`/);
  assert.match(s, /`keep-forever` \(the default\) → Keep, unless 30 or more plans are past the cutoff and no live decline exists — then one `Prune plan \(archive\)` listing them all/);
  assert.match(s, /only a would-be Delete is routed — a Keep row stays Keep under every value/);
});

test('tidy Step 4 remembers a declined keep-forever prune and fails closed (#4465)', () => {
  const s = step4Section();
  assert.match(s, /declined-learning\.js" lookup --source tidy/);
  assert.match(s, /declined-learning\.js" record-decline --source tidy/);
  assert.match(s, /"description":"tidy Prune plan \(archive\): docs\/superpowers\/plans\/"/);
  assert.match(s, /a non-null `decline`, or a lookup that exits non-zero, routes them to Keep/);
});

test('tidy Step 4 pins the 7-day cutoff and fails closed toward Keep (#4465)', () => {
  const s = step4Section();
  assert.match(s, /git -C "\{REPO_ROOT\}" log --diff-filter=A --format=%cs -1 -- \{plan\}/);
  assert.match(s, /7 days/);
  assert.match(s, /empty output or a non-zero exit counts as within the cutoff/);
});

test('the plan citation check runs before a Prune plan recommendation too (#4465)', () => {
  assert.match(step4Section(), /\*\*Before any plan Delete or `Prune plan`:\*\* run `plan-citation-check\.md`/);
  assert.match(PLAN_CITATION, /before recommending any plan Delete or `Prune plan`/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/tidy-plan-retention-conformance.test.js`
Expected: FAIL — 5 failing tests (no retention text in Step 4 yet).

- [ ] **Step 3: Edit Step 4 in `plugin/skills/tidy/scan-procedures.md` and line 3 of `plan-citation-check.md`**

In Step 4, keep the existing four-row table as the plan *classification*. Directly under it, add one bold-led paragraph `**Plan retention (#4465).**` carrying, in this order: the resolve command (exact text above); "It governs `docs/superpowers/plans/` only; `~/.claude/plans/` (native plan-mode scratch) keeps the table's recommendation as-is."; "only a would-be Delete is routed — a Keep row stays Keep under every value"; the three routes as exact phrases — "`prune-after-wrapup` → Delete, unchanged", "`ask` → `Prune plan (ask)`", "`keep-forever` (the default) → Keep, unless 30 or more plans are past the cutoff and no live decline exists — then one `Prune plan (archive)` listing them all"; the cutoff — "7 days (ADR-0007's 'last ~week'), from the plan's first-add commit date `git -C "{REPO_ROOT}" log --diff-filter=A --format=%cs -1 -- {plan}`; empty output or a non-zero exit counts as within the cutoff — Keep"; the decline memory — the lookup command `printf '%s' '{"description":"tidy Prune plan (archive): docs/superpowers/plans/"}' | node "${CLAUDE_PLUGIN_ROOT}/bin/declined-learning.js" lookup --source tidy` run before staging, "a non-null `decline`, or a lookup that exits non-zero, routes them to Keep", and the record command (same description plus `"reason":"{why}"`, verb `record-decline --source tidy`) run when a human excludes the `tidy-prune-plan-{n}` item at Step 6's approval or `--approve`; and that every `Prune plan` finding in one run is collected into a single staged proposal (`step-6-auto.md`'s Prune plan row). Change the "**Before any plan Delete:**" line to "**Before any plan Delete or `Prune plan`:** run `plan-citation-check.md`." In `plan-citation-check.md` line 3, change "before recommending any plan Delete" to "before recommending any plan Delete or `Prune plan`". In `tests/plan-citations-resolve.test.js:75`, update the pinned regex to `/Before any plan Delete or `Prune plan`:\*\* run `plan-citation-check\.md`/` (message unchanged).

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/tidy-plan-retention-conformance.test.js tests/tidy-scan-dispatch-conformance.test.js tests/plan-citations-resolve.test.js`
Expected: PASS — all tests in all three files.

- [ ] **Step 5: Commit**

```bash
git add tests/tidy-plan-retention-conformance.test.js tests/plan-citations-resolve.test.js plugin/skills/tidy/scan-procedures.md plugin/skills/tidy/plan-citation-check.md
git commit -m "Route tidy Step 4 plan deletes by superpowers-plans-retention — keep-forever keeps recent plans (#4465)"
```

### Task 2: Step 6 stages `Prune plan`, the Action Vocabulary executes it, and policy schema names tidy

**Files:**
- Modify: `plugin/skills/tidy/step-6-auto.md` (the two plan-Delete rows, currently lines 45-46; add one row after them)
- Modify: `plugin/skills/tidy/SKILL.md` (Action Vocabulary table, add one `**Prune plan**` row after `**Keep**`, currently line 129)
- Modify: `plugin/skills/_shared/policy-schema.md` (the `superpowers-plans-retention` row, currently line 202: consumer and values cells)
- Modify: `tests/tidy-plan-retention-conformance.test.js` (append)

**Interfaces:**
- Consumes: Task 1's `Prune plan (archive)` / `Prune plan (ask)` recommendations, the `tidy-prune-plan-{n}` staged id, and Step 4's decline-record command (cited, not restated).

- [ ] **Step 1: Append the failing tests**

Add `STEP6_AUTO` (`plugin/skills/tidy/step-6-auto.md`), `TIDY_SKILL` (`plugin/skills/tidy/SKILL.md`) and `POLICY_SCHEMA` (`plugin/skills/_shared/policy-schema.md`) reads, then:

```js
test('step-6-auto.md stages Prune plan at every tier (#4465)', () => {
  const row = STEP6_AUTO.split('\n').find((l) => l.startsWith('| **Prune plan**'));
  assert.ok(row, 'Prune plan row is present');
  assert.match(row, /\| Stage \| Stage \| Stage/);
  assert.match(row, /`scan-procedures\.md` Step 4's Plan retention/);
  assert.match(row, /tidy-prune-plan-\{n\}/);
});

test('step-6-auto.md auto-deletes plans only under prune-after-wrapup (#4465)', () => {
  assert.doesNotMatch(STEP6_AUTO, /orphaned plans whose related spec is complete,/);
  assert.match(STEP6_AUTO, /plans whose related spec is complete or that have no related spec, under `prune-after-wrapup`/);
  assert.match(STEP6_AUTO, /old plans whose spec status is unclear, under `prune-after-wrapup`/);
});

test('SKILL.md Action Vocabulary defines Prune plan execution and re-verify (#4465)', () => {
  const row = TIDY_SKILL.split('\n').find((l) => l.startsWith('| **Prune plan**'));
  assert.ok(row, 'Prune plan Action Vocabulary row is present');
  assert.match(row, /`git rm` each listed plan, one commit/);
  assert.match(row, /`plan-citation-check\.md` still clean, still past the 7-day cutoff, and `superpowers-plans-retention` still the value that staged it/);
  assert.match(row, /`stale — skipped`/);
  assert.match(row, /records its decline per Step 4's Plan retention/);
});

test('policy-schema.md names tidy Step 4 as a superpowers-plans-retention consumer and describes its routing (#4465)', () => {
  const row = POLICY_SCHEMA.split('\n').find((l) => l.startsWith('| `superpowers-plans-retention`'));
  assert.ok(row);
  assert.match(row, /`\/claude-tweaks:tidy` Step 4 \(`tidy\/scan-procedures\.md`\)/);
  assert.match(row, /tidy keeps them until 30 or more are past a 7-day cutoff, then stages one bulk prune/);
  assert.match(row, /tidy's Approve section/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/tidy-plan-retention-conformance.test.js`
Expected: FAIL. The 4 new tests fail, and Task 1's 5 still pass.

- [ ] **Step 3: Edit `step-6-auto.md`, `SKILL.md`, and `policy-schema.md`**

In `step-6-auto.md`:
- Line 45's Delete row: replace "orphaned plans whose related spec is complete," with "plans whose related spec is complete or that have no related spec, under `prune-after-wrapup`,". This names Step 4's orphan class too.
- Line 46's judgment-Delete row: replace "old plans whose spec status is unclear," with "old plans whose spec status is unclear, under `prune-after-wrapup`,".
- After line 46, add one row: `| **Prune plan** (`scan-procedures.md` Step 4's Plan retention — `keep-forever` at 30+ past the cutoff, or any plan Delete under `ask`; one `tidy-prune-plan-{n}` proposal per run) | Stage | Stage | Stage |`.

In `SKILL.md`'s Action Vocabulary, after the `**Keep**` row, add: `| **Prune plan** | Bulk-remove `docs/superpowers/plans/` plans per `scan-procedures.md` Step 4's Plan retention — `Prune plan (archive)` or `Prune plan (ask)` | `git rm` each listed plan, one commit. Re-verify each plan first (`_shared/reverify-before-write.md`): `plan-citation-check.md` still clean, still past the 7-day cutoff, and `superpowers-plans-retention` still the value that staged it; a plan that fails is dropped as `stale — skipped`. A declined `Prune plan (archive)` records its decline per Step 4's Plan retention | Yes (file; git history keeps it) |`.

In `policy-schema.md`'s `superpowers-plans-retention` row:
- Consumer cell: "`/claude-tweaks:wrap-up`'s cleanup-planning item 1 (`cleanup-procedures.md`) and `/claude-tweaks:tidy` Step 4 (`tidy/scan-procedures.md`)".
- Values cell: "`keep-forever` (wrap-up never deletes `docs/superpowers/plans/*.md`; tidy keeps them until 30 or more are past a 7-day cutoff, then stages one bulk prune — ADR-0007) / `prune-after-wrapup` (delete this spec's own plan/spec file(s) as part of cleanup; tidy deletes closed-record plans) / `ask` (stage the decision — the Wrap-Up Review Console, or tidy's Approve section)".
- Additions to `step-6-auto.md` and `policy-schema.md` stay under 600 bytes each.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/tidy-plan-retention-conformance.test.js tests/tidy-scan-dispatch-conformance.test.js tests/policy-schema.test.js tests/tidy-report-rules.test.js tests/plan-citations-resolve.test.js`
Expected: PASS — all tests.

Then check the size rail: `wc -c plugin/skills/tidy/step-6-auto.md plugin/skills/_shared/policy-schema.md plugin/skills/tidy/SKILL.md`. Each must stay under 52500.

- [ ] **Step 5: Commit**

```bash
git add tests/tidy-plan-retention-conformance.test.js plugin/skills/tidy/step-6-auto.md plugin/skills/tidy/SKILL.md plugin/skills/_shared/policy-schema.md
git commit -m "Stage tidy's Prune plan at every tier and name tidy as a plans-retention consumer (#4465)"
```
