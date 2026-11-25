---
files:
  - plugin/skills/review/review-effort-derivation.md
  - plugin/skills/review/code-mode-steps.md
  - plugin/skills/review/review-summary-template.md
  - plugin/bin/lib/review-context/size-proxy.js
  - plugin/bin/build-review-context.js
---

# Review a Large Change at the Tier Its Diff Earns

**Persona:** a maintainer running `/claude-tweaks:review` on a record whose `risk:*`/`size:*` labels were set at shaping time, before the change grew.
**Goal:** a change much larger than its labels gets the review depth its measured diff earns, without anyone overriding the tier by hand.
**Entry point:** `/claude-tweaks:review #{n}` (or the `review` phase of `/claude-tweaks:flow #{n}`) with no effort token, on a labelled record.
**Success state:** the resolved `review-effort` tier is the higher of the label tier and the diff tier, and the summary line names both inputs whenever they differ.

## Steps

### 1. Labels undercut the diff — tier rises to the diff tier
- **URL:** Step 2.5 (Derive Review Effort), `review-effort-derivation.md` steps 2-4
- **Action:** the reviewer reads the record's labels (e.g. `risk:low` × `size:medium` → label tier `low`), runs the diff heuristic over the `build-review-context.js size-proxy` counts (e.g. 142 files touching a cross-package interface → risk proxy `medium` × size proxy `high` → diff tier `high`), and takes the higher.
- **Should feel:** automatic. Nobody has to notice the mismatch and override the tier by hand, as #4028's reviewer had to.
- **Should understand:** labels never lower a tier the diff already earns. A label far below the measured diff is the ambiguity Step 2.5's rule names, and it resolves upward. The proxies and the risk × size table are the same ones the no-label fallback always used.
- **Red flags:** a labelled record resolving to its label tier while its diff stat clears the 10-file / 300-line `high` threshold; Step 3 dispatching only the `low`-tier lens set (3b/3c) on a diff that size.

### 2. Read the summary line — both inputs named
- **URL:** Step 7 summary, `**Review effort:**` line
- **Action:** the maintainer reads `**Review effort:** high (derived from label low, diff heuristic high (risk:low × size:medium; {reasoning}))`.
- **Should feel:** self-explanatory. The line shows which input set the tier and what the other one said.
- **Should understand:** the both-inputs form appears whenever the two tiers differ, in either direction. When they agree, the line keeps the familiar `record labels: risk:{x} × size:{y}` form.
- **Red flags:** a tier above the label tier with only `record labels: …` as its source; a both-inputs line on a review whose label tier and diff tier agree.

### 3. A small code change in a pipeline run — bookkeeping and lockfiles not counted
- **URL:** Step 2.5, `review-effort-derivation.md` step 3 (record-size proxy)
- **Action:** the reviewer runs `build-review-context.js size-proxy --base {base} --branch {branch}` on a run whose diff is 13 files / 350 lines, 10 of them the run's own materialized spec, plan and ledger files plus one lockfile. The proxy counts 3 files / 60 lines (size `medium`), and the summary's `{reasoning}` reads `size medium (3 files / 60 lines; excluded 10 files / 290 lines: bookkeeping 9, lockfile 1)`.
- **Should feel:** proportionate. A 60-line code change no longer earns the dispatch count of a 350-line one because the pipeline wrote its own paperwork into the branch.
- **Should understand:** only paths the project's `.claude-tweaks/verify-scope.json` maps to no suite (or, with no declaration, the plugin's bookkeeping list) and lockfiles are excluded; skill markdown and `*.jsonl` fixtures still count. If the verb fails or prints nothing usable, the reviewer falls back to the unfiltered `--stat` totals with a one-line notice, never a lower guess.
- **Red flags:** a `{reasoning}` with no `excluded …` part on a run whose diff carries its spec and plan; a changed `*.md` skill file listed as excluded; a size-proxy failure that resolves a lower tier than the unfiltered totals would.

### 4. A comment-only schema edit — the risk proxy stays put
- **URL:** Step 2.5, `review-effort-derivation.md` step 3 (risk proxy)
- **Action:** the diff touches a schema/migration file only to edit a comment. The reviewer reads that file's `git diff -w {base}...{branch} -- {file}`, finds every changed line blank or a comment, and does not fire the schema trigger.
- **Should feel:** sensible. A reworded comment no longer drives the risk proxy to `high`.
- **Should understand:** one changed line that is neither blank nor a comment fires the trigger, and a hunk the reader cannot classify fires it too. A lockfile excluded from the size count is still seen by the new-dependency check.
- **Red flags:** a schema change that alters a column or constraint resolving risk below `high`; a lockfile-only refresh, with no manifest change, resolving risk `high` as a new dependency.

## Origin
- Created during build of #4221. #4028 carried `risk:low` / `size:medium`, which derived `low` (lenses 3b and 3c only) for a 142-file, 5,733-line diff that included a 728-line PreToolUse hook. The reviewer raised the tier to `high` by hand. Step 2.5 now derives both tiers and takes the higher.
- Updated during build of #5148: steps 3-4 added. Consumer runs measured flow artifacts and lockfile churn pushing small code deltas to `medium`-`max` tiers (up to about 35 agents for under 100 lines of code), and a one-line comment edit to a schema file firing the risk proxy. The size proxy now comes from `build-review-context.js size-proxy`, and the schema trigger skips comment-only edits.
- Related journeys: `run-a-review-from-a-worktree-isolated-session-2956.md` (step 1 there is the label read this journey's step 1 starts from).
