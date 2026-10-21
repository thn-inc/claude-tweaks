---
files:
  - plugin/bin/load-delta.js
  - plugin/bin/lib/skill-audit/load.js
  - plugin/bin/lib/skill-audit/plugin-root-reader.js
  - plugin/skills/review/step3-skill-load-delta.md
  - plugin/skills/review/review-summary-template.md
---

# Read a Skill Load Delta at Review

**Persona:** claude-tweaks maintainer reviewing a branch that edits skill prose — say, one that moves a long section of `flow/SKILL.md` into a sibling file — who wants to know whether the change actually cut what an invocation loads or only moved it.
**Goal:** See each skill entry point's floor (its `SKILL.md`'s own bytes, paid every invocation) and closure (floor plus every transitively cited file — the most one invocation can load) at the merge-base and at the working tree, and read the difference.
**Entry point:** `/claude-tweaks:review` on the branch (step 3j runs automatically), or a terminal at the checkout root running `node plugin/bin/load-delta.js`.
**Success state:** One line or one table in the review summary's `### Skill Load Delta` section that says, per changed entry point, how floor and closure moved — and the reviewer can tell a move from a cut at a glance. Nothing about the verdict changed.

## Steps

### 1. Run the delta against the integration branch — terminal
- **URL:** `node plugin/bin/load-delta.js --integration-branch main`
- **Action:** Run it from the checkout root (or let review step 3j run it with the branch its Step 2 resolved).
- **Should feel:** One read-only command, a few seconds, no setup — it found both `plugin` and `.claude` on its own.
- **Should understand:** The header names the base it measured from (`base 12bd855 = merge-base with origin/main`), so a wrong base is visible. Roots are every tracked `skills/*/SKILL.md` at the repo root or one directory down; base content comes from `git show`, so nothing is checked out or stashed.
- **Red flags:** A header with no ref name; a run that checks out or stashes anything; a guessed `main` when the integration branch could not be resolved (the CLI must say `no baseline (integration branch unresolved — pass --integration-branch)` instead).

### 2. Read one of the five outcomes
- **URL:** the CLI's output, or the review summary's `### Skill Load Delta` section.
- **Action:** Match it to one of: `Skill load delta: no skill files changed — skipped`; `Skill load delta: skill files changed, no entry point's load moved`; a table `| Entry | Floor | ΔFloor | Closure | ΔClosure | New unresolved |`; `Skill load delta: no baseline (…) — skipped`; `Skill load delta: no plugin roots discovered — skipped (pass --plugin-root <dir>)`.
- **Should feel:** The review never goes quiet about it — every run says exactly which case it is.
- **Should understand:** Only the table carries numbers; the line outcomes are distinct on purpose so "nothing to measure" is never confused with "measured and unchanged". A repo whose skills sit deeper (`plugins/{name}/skills/`) gets the no-roots line naming the parent whose skill files changed — re-run with `--plugin-root plugins/{name}`.
- **Red flags:** "no skill files changed" on a diff that plainly edits a `SKILL.md`; a delta row of all zeros (unchanged entries are never listed); a review verdict that changed because of 3j.

### 3. Tell a move from a cut
- **URL:** the table row naming the entry the branch edited — its own row, or a grouped `{count} entries: {e1}, {e2}, {e3}, … +{k} more` row.
- **Action:** Compare ΔFloor with ΔClosure.
- **Should feel:** Honest — a split that only moved text no longer reads as a saving. Short — a shared-file edit is one row, not a wall of identical ones.
- **Should understand:** Moving 10 KB of `SKILL.md` into a sibling the `SKILL.md` tells the reader to load shows floor ≈ −10,000 and closure up by just the pointer line: a move. A real cut lowers closure too. A change to one `_shared/*.md` file shows the same ΔClosure on every entry point whose closure contains it — in this corpus that is nearly all of them (one `_shared/integration-branch.md` row moved 38 of 39 `plugin` entries by +347) — so entry points with the same ΔFloor, ΔClosure, and New unresolved share one row naming how many they are, with the first three names and a `… +{k} more` tail, and Floor/Closure show the `min–max` range across them. An entry point on its own row moved by a different amount. The closure column is an upper bound that fans out widely; floor is the per-invocation number.
- **Red flags:** A closure that went down after a "split"; two entries that both cite only the changed `_shared` file landing on separate rows (their ΔClosure differs); a grouped row whose range collapses to one value when its members' sizes plainly differ.

### 4. Check the new unresolved citations
- **URL:** the table's `New unresolved` column.
- **Action:** Read any listed tokens.
- **Should feel:** A short, specific list — not noise.
- **Should understand:** It lists backticked `.md` tokens added by this branch (or a bare name the branch made ambiguous by adding a same-named file — qualify it as `{skill}/…`) that the citation grammar (relative to the citing file, `_shared/`, `${CLAUDE_PLUGIN_ROOT}/`, "in that skill's directory", `skills/…` (plugin-root-relative), `{skill}/…` (skills-dir-relative), or a bare name or sub-path naming exactly one file under the root's `skills/` or `agents/`) cannot resolve. Glob and placeholder tokens (`skills/*/SKILL.md`, `{n}-spec.md`) are left out. An unresolved token is never counted as 0 bytes — but if the reader really loads that file, its bytes are missing from the closure, so fix the citation form.
- **Red flags:** Placeholder tokens in the list; a citation you know resolves (e.g. a sibling in the same skill directory) listed as unresolved.

## Origin
- Created during build of #3307 (per-invocation skill load model and review step 3j — parent #3305, skill size limits guard platform limits only).
- Updated during build of #3457, which added citation-grammar rule (e): plugin-root-relative `skills/…` and skills-dir-relative `{skill}/…` tokens now resolve, so closures stop undercounting.
- Updated during build of #3634, which added citation-grammar rule (f): a bare name or sub-path that names exactly one `.md` file under the root's `skills/` or `agents/` now resolves.
- Updated during build of #3456, which groups entry points that moved by an identical ΔFloor, ΔClosure, and New unresolved into one table row (text output only; `--json` stays per-entry).
- Related specs: #3309 (transcript-measured actual load in `/harness-health`, which consumes `entryPointLoads`), #3310 (cuts every size consumer over to the rail, load delta, and size outlier), #3311 (retires the old per-file size-ceiling code and its merge-time probe).
