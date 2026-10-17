# Superpowers 7.0.0 Re-pin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move `tools/upstream-drift/manifest.yml`'s superpowers pin from 6.2.0 to 7.0.0, retarget the one assertion 7.0.0 broke, add five assertions for the upstream lines the dispatch-cost-shape records lean on, and record the verification evidence the spec's ACs 6-8 require.

**Architecture:** One manifest edit (Task 1: re-pin, retarget, five new assertions — all in the same entry, the new assertions only resolve after the re-pin) and one verification task (Task 2: drift run, discrimination check, contract-path diff) whose output is a committed evidence file the PR description quotes. No shipped `plugin/` code changes.

**Tech Stack:** YAML manifest read by `tools/upstream-drift/manifest.js`; checks in `tools/upstream-drift/checks.js` (`checkVersion`, `checkAssertions`); `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-10-17T111000-spec-3376-3386/spec-3376/work/3376-spec.md` (record #3376)

## Global Constraints

- Worktree: `/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude/worktrees/record-3229`, branch `worktree-record-3229`. Every command runs there (`cd` + `pwd` + `git rev-parse --show-toplevel` before the first commit).
- Superpowers 7.0.0 cache root: `/Users/thomasholknielsen/.claude/plugins/cache/claude-plugins-official/superpowers/7.0.0` (its `.claude-plugin/plugin.json` reads `"version": "7.0.0"` — the pin is read from this artifact, never from release notes, `[IL-89]`).
- `checkAssertions` matches with `content.includes(mustMatch)` on raw bytes: every `must-match` is a single-line literal, copied byte-exact from this plan.
- Never loosen a `must-match` until it matches anything (`.claude/skills/upstream-repin/SKILL.md`, "Retarget what upstream retired").
- `tools/` is maintainer-side and never ships; nothing under `plugin/` changes in this plan.
- **Ruling on AC1 vs AC3 (spec self-contradiction):** AC1's "no other superpowers version string remains in the entry" is read as "no stale pin value remains" — `pinned: "7.0.0"` and the string `"6.2.0"` appears nowhere as a pin. AC3 explicitly requires each new `claims:` to name the version the line first appeared in, so historical version text inside `claims:` (including the existing `(v5.1.0+)` claim) is allowed. The spec is the authority; this ruling is the only reading under which both ACs can hold.
- **Corrected fact (spec Current State said otherwise):** measured against the local caches on 2026-10-17, the pre-flight scan sentence first appears in **6.3.0**, not 6.2.0. First-appearance versions to use: pre-flight scan 6.3.0; cheapest-tier transcription line 6.2.0 or earlier (6.2.0 is the earliest cached version); re-review tier line 6.2.0 or earlier; batch rule 6.3.0; writing-plans body line 7.0.0.

## Review Focus

1. A new `must-match` that wraps or carries a stray trailing space never matches — each is checked with a byte-exact count against the 7.0.0 cache (Task 1 Step 4).
2. A drift run that resolves no root reports `skipped`, which verifies nothing — Task 2 asserts every assertion result is `ok` and none `skipped`.
3. The discrimination check must turn exactly one assertion red and be restored before commit — Task 2 Step 3 verifies the restore with `git diff --exit-code` on the manifest.
4. A YAML quoting slip in a new `claims:` (an unquoted `": "`) makes `loadManifest` throw — Task 1 Step 4 loads the real manifest.
5. A retarget that silently changes which local claim the brainstorming assertion backs — Task 1 keeps `file: "CLAUDE.md"` and re-reads CLAUDE.md's override prose against the 7.0.0 line.

---

### Task 1: Re-pin the superpowers entry, retarget brainstorming, add five assertions

**Files:**
- Modify: `tools/upstream-drift/manifest.yml` (the `- name: superpowers` entry, `pinned:` at line 212; the brainstorming assertion at ~line 238; append five assertions after the last existing superpowers assertion, before `fixtures: []`)

**Interfaces:**
- Consumes: nothing.
- Produces: superpowers entry with `pinned: "7.0.0"` and 19 assertions (14 kept — one retargeted — plus 5 new); Task 2 runs the checks against it.

- [ ] **Step 1: Confirm the failing state**

Run, from the worktree:
```bash
node -e "const {loadManifest}=require('./tools/upstream-drift/manifest.js');const {checkVersion,checkAssertions}=require('./tools/upstream-drift/checks.js');const sp=loadManifest('tools/upstream-drift/manifest.yml').dependencies.find(d=>d.name==='superpowers');console.log(sp.pinned, sp.assertions.length, checkVersion(sp).status, checkAssertions(sp).status)"
```
Expected: `6.2.0 14 ok ok` (6.2.0 is cached here, so today's entry is green against 6.2.0 — the change is what makes it verify 7.0.0).

- [ ] **Step 2: Re-pin**

Change the entry's `pinned: "6.2.0"` to `pinned: "7.0.0"`. Add a comment line directly above it: `# Re-pinned 6.2.0 -> 7.0.0 (#3376), read from the installed 7.0.0 plugin.json.`

- [ ] **Step 3: Retarget the brainstorming assertion**

In the assertion with `file: "CLAUDE.md"`, replace `must-match: "Invoke the writing-plans skill"` with `must-match: "invoke superpowers:writing-plans and no other skill"`, and change its `claims:` to `"brainstorming's terminal step names writing-plans as the next skill — the step the project override suppresses"`. Add a comment above the assertion: `# Retargeted (#3376): 7.0.0's brainstorming rewrite dropped "Invoke the writing-plans skill"; the surviving terminal-step line is "For software, invoke superpowers:writing-plans and no other skill." CLAUDE.md's override still holds against it.` Re-read CLAUDE.md's "Superpowers overrides" paragraph against `skills/brainstorming/SKILL.md` line ~192 in the 7.0.0 cache before committing; if the override no longer describes 7.0.0's behavior, stop and report NEEDS_CONTEXT instead of committing.

- [ ] **Step 4: Append the five new assertions**

Append these five entries, in this order, after the last existing superpowers assertion (the `docs/superpowers/plans/YYYY-MM-DD-<feature-name>.md` one), keeping the entry's six-space list indentation. `upstream-path` / `must-match` are byte-exact; `claims:` text is exact copy:

| # | file | upstream-path | must-match | claims |
|---|---|---|---|---|
| 1 | `plugin/skills/build/plan-authoring-checks.md` | `skills/subagent-driven-development/SKILL.md` | `Before dispatching Task 1, scan the plan once for conflicts, writing down` | `will rely on (record #3377): the plan reviewer is defined against SDD's controller pre-flight scan and must not redo it — line first appeared in superpowers 6.3.0` |
| 2 | `plugin/skills/build/dispatch.md` | `skills/subagent-driven-development/SKILL.md` | `that implementer. Single-file mechanical fixes also take the cheapest tier.` | `will rely on (record #3378): per-task implementer tiers send transcription tasks to the cheapest tier, per SDD's Model Selection — line first appeared in superpowers 6.2.0 or earlier` |
| 3 | `plugin/skills/build/dispatch.md` | `skills/subagent-driven-development/SKILL.md` | `small fix diffs take a cheap-to-mid tier.` | `will rely on (record #3378): the forwarded scoped re-review tier applies SDD's cheap-to-mid rule for small fix diffs — line first appeared in superpowers 6.2.0 or earlier` |
| 4 | `plugin/skills/build/plan-authoring-checks.md` | `skills/subagent-driven-development/SKILL.md` | `**Batch small same-shape work.** When the plan lists several tasks that are` | `the Batched-plan marker cites SDD's batch rule, and will rely on it for adjacent-task merging (record #3379) — line first appeared in superpowers 6.3.0` |
| 5 | `plugin/skills/build/plan-authoring-checks.md` | `skills/writing-plans/SKILL.md` | `writes the body. A body appears only for an algorithm the signature and` | `will rely on (record #3378): a task whose plan gives only signatures and tests is an integration task, not transcription — line first appeared in superpowers 7.0.0` |

Quote every value with double quotes, as the existing entries do. If a `must-match` contains a `"`, use single quotes for that value instead (precedent: the `sdd-workspace` assertion).

- [ ] **Step 5: Verify**

Covers: AC1.1 (`pinned` reads 7.0.0, no stale pin — see the AC1 ruling), AC2.1 and AC2.2 (count 19 = 14 kept incl. the retarget + 5), AC3.1 (each new `file:` exists, `claims:` names record + first-appearance version, literal counted ≥1 below), AC4.1 and AC4.2 (brainstorming literal replaced, found in 7.0.0, reason comment present), AC5.1 (`node --test tools/upstream-drift/tests/`).

Run the Step 1 command again. Expected: `7.0.0 19 ok ok`.

Then count every new and retargeted literal byte-exact in the 7.0.0 cache (each must print `1` or more):
```bash
node -e "const fs=require('fs');const R='/Users/thomasholknielsen/.claude/plugins/cache/claude-plugins-official/superpowers/7.0.0/';const sp=require('./tools/upstream-drift/manifest.js').loadManifest('tools/upstream-drift/manifest.yml').dependencies.find(d=>d.name==='superpowers');for(const a of sp.assertions)console.log(fs.readFileSync(R+a['upstream-path'],'utf8').split(a['must-match']).length-1, a['must-match'].slice(0,60))"
```
Expected: 19 lines, none starting with `0`.

Run: `node --test tools/upstream-drift/tests/`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add tools/upstream-drift/manifest.yml
git commit -m "Re-pin superpowers to 7.0.0 in the drift manifest — retarget brainstorming, pin five dispatch cost-shape lines (refs #3376)"
```

### Task 2: Record the verification evidence (drift run, discrimination check, contract-path diff)

**Files:**
- Create: `.claude-tweaks/pipelines/2026-10-17T111000-spec-3376-3386/spec-3376/work/3376-verification.md` (tracked audit trail; the PR description quotes it)

**Interfaces:**
- Consumes: Task 1's superpowers entry (`pinned: "7.0.0"`, 19 assertions).
- Produces: the evidence file with three sections — `## Drift run`, `## Discrimination check`, `## Contract-path changes 6.2.0 -> 7.0.0` — read by the controller to fill the PR description (ACs 6-8).

- [ ] **Step 1: Verify the drift run (AC6)**

Covers: AC6.1 (version `ok`, assertions `ok`, none `skipped`, counts recorded), AC6.2 (run through the read-only `/upstream-drift` skill or its documented scratch-script substitution — never `tools/upstream-drift/run.js`).

Invoke the read-only `/upstream-drift --dep superpowers --drift-only` skill if the Skill tool is available to you; otherwise run `checkVersion` and `checkAssertions` from a scratch node script outside the repo and say so in the file (the spec allows this substitution). Record verbatim: the version check's `status` and `detail`, the assertions check's `status`, the count of results, and the count by status. Expected: version `ok`, assertions `ok`, 19 results, 19 `ok`, 0 `skipped`/`unmatched`/`missing-file`. Any other outcome: stop and report BLOCKED with the raw output.

- [ ] **Step 2: Verify discrimination (AC7)**

Covers: AC7.1.

Temporarily change assertion 1's `must-match` (pre-flight scan, from Task 1 Step 4) to `Before dispatching Task 1, scan the plan once for conflictZ` in `tools/upstream-drift/manifest.yml`, re-run `checkAssertions`, and record the output for that one assertion (expected `unmatched`) plus the overall status (expected `drift`). Restore the manifest with `git checkout -- tools/upstream-drift/manifest.yml`, then run `git diff --exit-code tools/upstream-drift/manifest.yml` (expected exit 0) and re-run Step 1's check (expected `ok`). Record both in the file. Never commit the altered manifest.

- [ ] **Step 3: Verify contract-path changes (AC8)**

Covers: AC8.1.

For each of the six `contract-paths`, run `diff -u` between the 6.2.0 and 7.0.0 cache copies (`/Users/thomasholknielsen/.claude/plugins/cache/claude-plugins-official/superpowers/{6.2.0,7.0.0}/{path}`). Read the hunks for changes to what `plugin/skills/build/dispatch.md`, `plugin/skills/build/SKILL.md` and `plugin/skills/_shared/local-files-preflight-stop.md` rely on: the `.superpowers/sdd` workspace, `progress.md`, the per-task review loop, `## Final Review`, Cleanup/Finish. List each relevant change as one bullet naming the upstream file, what changed, and which of the three claude-tweaks files it touches — or write "No changes affecting these files" for a path with none. This is a bounded read, not a behavioral verification; do not edit any `plugin/` file — a change that looks like it breaks one of the three files is reported as a finding (DONE_WITH_CONCERNS), not fixed.

- [ ] **Step 4: Commit**

```bash
git add .claude-tweaks/pipelines/2026-10-17T111000-spec-3376-3386/spec-3376/work/3376-verification.md
git commit -m "Record superpowers 7.0.0 re-pin verification — drift run, discrimination check, contract-path diff (refs #3376)"
```
