# Inform-tier relay + case-canonical realpath conventions (#3419) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Write down two conventions that recurred in #3380. Every SessionStart inform-tier line names its relay. A path guard resolves with `fs.realpathSync.native`.

**Architecture:** This is a docs-only change with no behavior change. It edits three maintainer-side docs (`docs/hooks.md`, `docs/donts.md`, `docs/incident-log.md`) and pins them with one whitespace-collapsed prose conformance test, following the `tests/fork-worktree-isolation-conformance.test.js` pattern.

**Tech Stack:** Markdown; `node --test` (built-in `node:test` + `node:assert/strict`).

**Spec:** `.claude-tweaks/pipelines/2026-10-17T194051-record-3419/work/3419-spec.md`

## Global Constraints

- Nothing under `plugin/` changes. All three docs and the test are maintainer-side (ADR-0015).
- `docs/hooks.md` states the relay rule **once**, in the inform-tier bullet run (lines 22-26 today: the `worktree-always` verdict banner through the Interaction-style directive).
- `docs/donts.md` keeps the house shape, "rule plus one clause of why", and the `[IL-150]` tag stays at the end of the bullet.
- `docs/incident-log.md` IL-150 cites #3380's run ledger row 48 as the casing instance. Fix commit: `722ece0d6`. It was merged via PR #3406.
- Coordinate with #3417 (open; the shared path-guard helper). Do not retarget the rule at a helper that does not exist yet.
- Commit messages say `refs #3419`, never `closes`/`fixes`.

## Review Focus

- The relay rule must not be restated a second time anywhere in `docs/hooks.md`. The test asserts exactly one occurrence.
- The rule must sit inside the inform-tier run, not in the generic tier bullet at line 6. The test asserts that the next bullet is an `(inform tier` bullet.
- The IL-150 assertion must be scoped to the IL-150 section (`## IL-150` up to `## IL-151`). A `#3380` match elsewhere in the 1.7k-line log must not satisfy it.
- `[IL-150]` lines elsewhere in `docs/donts.md` must not satisfy the donts assertion. Scope it to the bullet that carries `realTarget()`.

---

### Task 1: Document both conventions and pin them

**Files:**
- Test: `tests/inform-tier-relay-realpath-conformance.test.js` (create)
- Modify: `docs/hooks.md:22` (insert one bullet before the `worktree-always` verdict banner bullet)
- Modify: `docs/donts.md:116` (the `[IL-150]` bullet)
- Modify: `docs/incident-log.md:1324-1346` (IL-150 section, append a paragraph before `## IL-151`)

**Interfaces:** none (single task).

- [ ] **Step 1: Write the failing test** `tests/inform-tier-relay-realpath-conformance.test.js`. Use the `collapsed()` helper shape from `tests/fork-worktree-isolation-conformance.test.js` (whitespace-collapsed read). Write three tests:
  - `'docs/hooks.md states the inform-tier relay rule once, inside the inform-tier run'`: split `docs/hooks.md` into lines and find the lines matching `/Every inform-tier line names its relay/`. Assert there is exactly 1 such line. Assert it also matches `/never run it yourself/`. Assert the line after it matches `/\(inform tier/`.
  - `'docs/donts.md [IL-150] names fs.realpathSync.native'`: the single line containing both `realTarget()` and `[IL-150]` matches `/fs\.realpathSync\.native/`.
  - `'docs/incident-log.md IL-150 cites #3380 row 48 as the casing instance'`: slice `collapsed(INCIDENT_LOG)` from `'## IL-150 '` up to `'## IL-151 '`. The slice matches `/#3380/`, `/row 48/`, `/722ece0d6/` and `/fs\.realpathSync\.native/`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/inform-tier-relay-realpath-conformance.test.js`
Expected: FAIL, 3 of 3 tests failing (no relay line yet, no `.native` in the IL-150 bullet, no #3380 citation in IL-150).

- [ ] **Step 3: Edit the three docs**
  - `docs/hooks.md`: insert a new bullet directly above `- **\`worktree-always\` verdict banner (inform tier):**`. Its exact copy:
    `- **Every inform-tier line names its relay (#3419):** SessionStart \`additionalContext\` reaches the model, not the user, so each inform-tier line says who passes it on and how (e.g. \`tell the user once, in your first reply\`), and a line carrying a runnable command also says \`never run it yourself\` — otherwise an autonomous run may execute it; the #803 residue banner and #3380's superpowers notice each shipped without a relay and had to gain one later.`
  - `docs/donts.md` `[IL-150]` bullet: before ` \`[IL-150]\``, append `; resolve with \`fs.realpathSync.native\`, never the JS \`fs.realpathSync\`, which echoes the input's casing on a case-insensitive volume and so lets a mis-cased path past a \`===\` or \`path.relative\` comparison`.
  - `docs/incident-log.md`: append one paragraph as the last paragraph of the IL-150 section, before `## IL-151`. It opens with `**Second instance — casing (#3380, run ledger row 48).**`, then states:
    - the #3380 review (lens 3b) found that `superpowers-version.js`'s home exclusion and ancestor match compared JS `fs.realpathSync` paths case-sensitively;
    - the JS form echoes input casing on a case-insensitive volume, so a mis-cased home entry slipped past `excludeHome`;
    - it was fixed in `722ece0d6` (merged via PR #3406) by switching to `fs.realpathSync.native`, which returns canonical case;
    - the rule now names that form. `realTarget()` in `pre-tool-use.js` still uses the JS form; #3417's shared helper is where that converges.

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/inform-tier-relay-realpath-conformance.test.js`
Expected: PASS, 3 of 3.

- [ ] **Step 5: Commit**

```bash
git add tests/inform-tier-relay-realpath-conformance.test.js docs/hooks.md docs/donts.md docs/incident-log.md
git commit -m "Document inform-tier relay and case-canonical realpath conventions — refs #3419"
```
