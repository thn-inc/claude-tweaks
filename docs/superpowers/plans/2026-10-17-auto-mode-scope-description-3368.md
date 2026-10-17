# auto-mode policy key: scope description names /flow (#3368) Implementation Plan

**Goal:** Correct the `auto-mode` policy key's two stale descriptions so they say the key also sets the default mode of an interactively typed `/claude-tweaks:flow`, matching today's behavior, and pin the corrected scope with a conformance test.

**Spec:** `.claude-tweaks/pipelines/2026-10-17T100123-spec-3368-3365/spec-3368/work/3368-spec.md` (materialized from GitHub issue #3368)

---

### Task 1: Rewrite the auto-mode descriptions and pin them

**Files:**
- Modify: `plugin/skills/_shared/policy-schema.md` (line 111, the `` | `auto-mode` | `` row — default and meaning columns only)
- Modify: `plugin/bin/lib/policy-schema.js` (line 113, the `auto-mode` entry's `summary` only)
- Test: `tests/auto-mode-scope-conformance.test.js` (new)

- [ ] **Step 1: Failing test** — create `tests/auto-mode-scope-conformance.test.js` (`node:test` + `node:assert/strict`, same shape as the neighboring `tests/*-conformance.test.js` files). It asserts, against live files:
  - The `auto-mode` entry from `require('../plugin/bin/lib/policy-schema.js').POLICY_KEYS` (find by `key === 'auto-mode'`): its `summary` contains `/flow`; does not contain `Sets whether a standalone build or an unattended cleanup run starts hands-off by default`; and `summary.length <= 140`.
  - The `policy-schema.md` row: the line starting `` | `auto-mode` | `` exists exactly once; split on `|` and trim cells. The default column (4th cell) does not contain ``still defaults to `auto` ``. The meaning column (5th cell) does not contain ``standalone `/build` and unattended `/tidy` firings``; contains `/flow` (`/claude-tweaks:flow` matches too); contains `` `default-off` ``; and states that `default-off` resolves to `interactive` (assert it contains `interactive`).
  - Run: `node --test tests/auto-mode-scope-conformance.test.js` → Expected: FAIL (the summary lacks `/flow`, and the row still says "still defaults to `auto`").
- [ ] **Step 2: Implement** —
  - `policy-schema.md` row 111. Replace the default cell with: ``unset (each skill keeps its own default: `/flow` → `auto`; standalone `/build` and unattended `/tidy` → `interactive`)``. Replace the meaning cell with: ``` `default-on` → `auto`, `default-off` → `interactive` — the default mode for an interactively typed `/claude-tweaks:flow`, standalone `/claude-tweaks:build`, and unattended `/claude-tweaks:tidy`; an explicit mode argument always wins ```. Leave the key, source, and consumers cells byte-identical.
  - `policy-schema.js` line 113 `summary`: `"Sets whether a pipeline run (/flow), a standalone build, or an unattended cleanup run starts hands-off by default, without being asked."` (135 chars). Change nothing else in the entry.
  - Do not touch `plugin/skills/flow/SKILL.md`, `plugin/skills/flow/manifesto.md`, or `plugin/skills/_shared/auto-mode-contract.md` (spec AC 4: behavior is unchanged, only the descriptions are corrected).
- [ ] **Step 3: Run** `node --test tests/auto-mode-scope-conformance.test.js tests/policy-schema-metadata.test.js tests/policy-key-naming.test.js` — PASS. Then prove discrimination: in a scratch copy (never edit-and-restore in this shared worktree), restore the old summary text and confirm the new test goes red; quote the failing assertion in the report.
- [ ] **Step 4: Commit** — one commit staging exactly the three files above by explicit path: `Correct auto-mode policy key descriptions — name /flow alongside standalone build and unattended tidy` with body `refs #3368`.

---

## Self-review

- **Spec coverage:** Deliverable 1 → Step 2 first bullet (AC 1). Deliverable 2 → Step 2 second bullet (AC 2). Deliverable 3 → Step 1 (AC 3); the revert-red demonstration → Step 3 (AC 3). AC 4 → Step 2 third bullet. AC 5 (`npm test`) → `/build` Common Step 5, run centrally.
- **Placeholders:** none.
