# Console engine item ids from targetPath (#3389) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Wrap-Up Review Console name the file each curation-engine finding touched (`skills:.claude/skills/x/SKILL.md`) instead of `skills:undefined`.

**Architecture:** `engineItems` in `plugin/bin/lib/console/resolve.js` builds each engine finding's console item id as `` `${rowId}:${f.target}` ``, but the engine stores a finding's file under `targetPath` (`plugin/bin/lib/wrap-up/engine-record.js` keeps the payload's findings verbatim; `target` exists only at the row level, `entry.target`, e.g. `"Skills"`). Derive the id label once per finding from `f.targetPath`, else legacy `f.target`, else the row's `entry.target`, and use it on both the staged and applied branches.

**Tech Stack:** Node 18+, `node --test` (built-in).

**Spec:** `.claude-tweaks/pipelines/2026-10-17T183731-record-3389/work/3389-spec.md` (materialized from GitHub issue #3389)

## Global Constraints

- Fallback order is exactly: `f.targetPath` → `f.target` (older `engine-state.json`) → row `entry.target` (only when a finding carries neither).
- The test lives in the console-resolve suite (`tests/bin-lib/console/`) and must be proven red against the current code before the fix lands.
- `npm test` passes.

## Review Focus

- A staged finding with no `stagePath` (so it is not deduplicated against a `staged/` file) — its id must also use `targetPath`, not just the applied branch. Covered: Task 1 test includes a staged finding without `stagePath`.
- An older `engine-state.json` whose findings carry only `target` — must keep rendering `references:docs/a.md`. Covered by the existing test `engine-state.json staged findings classify ... (#1932)` (resolve.test.js:480), which must stay green unchanged.
- A finding carrying neither `targetPath` nor `target` — must fall back to the row's `target`, never `undefined`. Covered: Task 1 test.
- Two findings on one row — ids must differ. Covered: Task 1 test.
- The CLI (`console-resolve.js --run <dir> --policy console-auto`) renders whatever ids `resolveAll` returns; verified by a scratch CLI run in Step 4, no separate committed test.

---

### Task 1: Derive engine item ids from `targetPath`

**Files:**
- Modify: `plugin/bin/lib/console/resolve.js:321-339` (`engineItems` and its shape comment)
- Test: `tests/bin-lib/console/resolve.test.js` (new test inserted directly after the existing `engine-state.json staged findings classify ...` test, ~line 486)

**Interfaces:**
- Consumes: `resolveAll({ runDir, policy, deps })`, test helpers `fixture({ engineState, headers })` and `deps()` already in `resolve.test.js`.
- Produces: no new exports. `engineItems` keeps its signature `(snapshot, stagedIds) => Array<{id, section, resolution, reason}>`.

- [ ] **Step 1: Write the failing test**

Test name: `engine findings take their console id from targetPath, fall back to the row target, and two findings on one row stay distinct (#3389)`.

Fixture `engineState`:

```js
const engineState = { results: {
  skills: { result: 'findings', target: 'Skills', findings: [
    { targetPath: '.claude/skills/x/SKILL.md', action: 'applied', commit: 'abc1234', kind: 'update', summary: 's' },
    { targetPath: '.claude/skills/y/SKILL.md', action: 'applied', commit: 'def5678', kind: 'update', summary: 's' },
  ] },
  docs: { result: 'findings', target: 'Docs', findings: [
    { targetPath: 'docs/guide.md', action: 'staged', kind: 'update', summary: 's' },
    { action: 'applied', commit: 'aaa0000', kind: 'update', summary: 's' },
  ] },
} };
```

Run `resolveAll({ runDir: fixture({ engineState, headers: [7] }), policy: 'console-auto', deps: deps() })` and assert:
- (AC1, AC3) the ids of items with `resolution === 'applied'` in section `Skill updates` deep-equal `['skills:.claude/skills/x/SKILL.md', 'skills:.claude/skills/y/SKILL.md']` (distinct, file-naming);
- some item has id `docs:docs/guide.md`;
- some item has id `docs:Docs` (row-target fallback);
- no item id matches `/:undefined$/`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test --test-name-pattern="#3389" tests/bin-lib/console/resolve.test.js`
Expected: FAIL — ids come back as `skills:undefined` (twice) and `docs:undefined`.

- [ ] **Step 3: Implement in `engineItems`**

Inside the findings loop compute `const label = f.targetPath || f.target || entry.target;` and use `` `${rowId}:${label}` `` as the id in both the staged and applied `out.push` calls. Update the shape comment above the function to `findings: [{targetPath, action, commit?, stagePath?}]` (legacy `target` on older files; row-level `target`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/console/resolve.test.js tests/bin-lib/console/cli.test.js`
Expected: PASS, 0 failures (the pre-existing `#1932` engine test stays green via the `f.target` fallback).

Real-input probe (not committed): run `resolveAll` against a copy of the archived run `.claude-tweaks/pipelines/archive/2026-10-17T103744-record-3373/` (main checkout; its `engine-state.json` holds one applied Skills finding `targetPath: .claude/skills/run-directory-fact-packs/SKILL.md` and two staged Journeys findings) and confirm ids `skills:.claude/skills/run-directory-fact-packs/SKILL.md` plus two distinct `journeys:docs/journeys/...` ids — 3 engine items, none ending `:undefined`.

Scratch check of the CLI AC (AC2, not committed): build a temp git repo with `.claude-tweaks/policy.yml` (`autonomy: unattended`), a run dir `.claude-tweaks/pipelines/2026-09-06T000000-record-7/` holding `work/7-spec.md`, an empty `decisions.md`, an empty `staged/`, and an `engine-state.json` with one applied Skills finding `targetPath: .claude/skills/x/SKILL.md`; run `node plugin/bin/console-resolve.js --run <dir> --policy console-auto --dry-run` and confirm the output contains `skills:.claude/skills/x/SKILL.md` and not `skills:undefined`.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/console/resolve.js tests/bin-lib/console/resolve.test.js
git commit -m "Name curation-engine console items by targetPath — resolve.js read f.target, the engine stores targetPath (refs #3389)"
```

---

## Self-review

- **Spec coverage:** Deliverable 1 (id from `targetPath`, fallbacks `f.target` → row `target`, distinct ids) → Task 1 Step 3. Deliverable 2 (red-first test, two applied findings on one row) → Steps 1-2. AC1/AC3 → Step 1 assertions. AC2 (CLI) → Step 4 scratch check. AC4 (`npm test`) → run centrally by `/build` Common Step 5.
- **Placeholders:** none.
