---
files:
  - plugin/bin/check-artifact-overwrite.js
  - plugin/bin/lib/flow/artifact-overwrite-check.js
  - plugin/skills/flow/multispec-artifact-namespacing.md
---

# Catch a Silent Journey Overwrite Without Ruling By Hand

**Persona:** A claude-tweaks agent running `/claude-tweaks:flow`'s multi-spec Consolidated Review Console, whose shared worktree has a `docs/journeys/` file that more than one spec touched — the exact shape #786's completion check exists to police.
**Goal:** Confirm, before the console renders, that a later spec's commit on a shared journey/story path only ever *extended* an earlier spec's content (its own step, a shared bookkeeping list) rather than silently deleting it — without falling back to a manual `git log --numstat` ruling every time the raw walk sees an `A`-then-`M` path.
**Entry point:** A terminal at this repo's checkout root (or another project's resolved plugin root), inside the multi-spec run's shared worktree, with `$EXPECTED_BASE` known (the commit before spec 1's materialize commit).
**Success state:** One command answers "clean" or "overwrite" for the whole run's commit range, naming the offending path/commit/reason on an overwrite — the same verdict `flow/multispec-artifact-namespacing.md`'s HARD-GATE reads, reached without a human (or an agent) staring at `git blame` output.

## Steps

### 1. Run the mechanized check over the run's commit range — terminal
- **URL:** `node "${CLAUDE_PLUGIN_ROOT}/bin/check-artifact-overwrite.js" --base "$EXPECTED_BASE" --run "$MULTISPEC_PARENT_DIR" --path docs/journeys/ --path stories/`
- **Action:** Run it once, after every spec in the shared worktree has committed, before the Consolidated Review Console renders.
- **Should feel:** One command, one verdict — no manual `git log --numstat` reading required for the common case.
- **Should understand:** Exit `0` means clean — stdout is `{"clean":true,"overwrites":[]}` — and the console renders normally. A path that was only ever added once, with no later modification, never even appears in the walk.
- **Red flags:** A nonzero exit read as "clean" without checking it; a caller that greps stdout for a substring instead of parsing the JSON envelope.

### 2. Read a clean append-only run — the #1988-#1997 case
- **URL:** `node "${CLAUDE_PLUGIN_ROOT}/bin/check-artifact-overwrite.js" --base 4c6e76733 --head b247a02d3 --path docs/journeys/compose-a-per-run-context-bundle-1988.md` (this repo's own history)
- **Action:** Run it and read the JSON.
- **Should feel:** Vindicating — a shape that used to require a human ruling with `git log --numstat` as evidence now resolves itself.
- **Should understand:** `docs/journeys/compose-a-per-run-context-bundle-1988.md` was added by #1988 and modified by six later specs (#1989, #1991, #1992, #1993, #1995, #1997), each appending its own step or reflowing the trailing "Related specs: …" bookkeeping bullet. The check reports `clean: true` — every one of those later commits passes either the same-spec self-edit test (a spec correcting its own prior line, matched via `git blame` + the commit's own `refs #{N}` trailer) or the list-reflow test (a `- ` bookkeeping entry replaced by at least as many list entries).
- **Red flags:** `clean: false` on this exact real range — that would mean the safety tests regressed.

### 3. Read a clean step-markup reformat — the #2702/#2727/#2776 case
- **URL:** `node "${CLAUDE_PLUGIN_ROOT}/bin/check-artifact-overwrite.js" --base d81250829 --head 80e3dad2d --path docs/journeys/ --path stories/` (this repo's own history)
- **Action:** Run it and read the JSON.
- **Should feel:** No HARD-GATE for a cosmetic fix — a review fix that only changed how steps are marked up passes without a normalization script or a human ruling.
- **Should understand:** Commit `80e3dad2d` (refs #2776) converted the #2702 and #2727 journeys' numbered-list steps (`1. **Name** — text` with indented sub-bullets) to the canonical `### 1. Name — text` headers with flush sub-bullets. No step text changed, so the step-markup reformat test clears both files and the check reports `{"clean":true,"overwrites":[]}`, exit `0`. The same conversion that also drops a step, or edits a word inside one, still fails.
- **Red flags:** `clean: false` on this range, naming either journey — the reformat test regressed; or a conversion that silently dropped a step reported clean.

### 4. Read a clean step insertion — the #4488/#4484 case
- **URL:** `node "${CLAUDE_PLUGIN_ROOT}/bin/check-artifact-overwrite.js" --base 729a5ae5e --head 4706f21db --path docs/journeys/route-a-review-finding-the-release-gate-can-see-4488.md` (this repo's own history)
- **Action:** Run it and read the JSON.
- **Should feel:** Like a non-event. Inserting a step into another spec's journey no longer stops the run for a human ruling.
- **Should understand:**
  - Commit `4706f21db` (#4484) inserted a new step 3 into #4488's journey, so the later headings shifted: `### 3. A hand-typed prefix is refused` became `### 4. …`, and `### 4. The release gate reads it` became `### 5. …`, each with its text unchanged.
  - The step-renumber test clears both heading hunks, and the check reports `{"clean":true,"overwrites":[]}`, exit `0`.
  - Before #4590 this exact range exited `1`, and the run stopped at the HARD-GATE.
  - A renumbered heading whose text also changed still fails.
- **Red flags:** `clean: false` on this range — the step-renumber test regressed.

### 5. Read an overwrite — a later spec deletes an earlier spec's own step content
- **URL:** a synthetic fixture, same shape as `tests/bin-lib/flow/artifact-overwrite-check.test.js`'s "cross-spec overwrite" case: spec #10 adds a journey with a Step 1 body; a later commit tagged `refs #12` deletes that Step 1 body outright (not a `- ` list entry, and not traceable via blame to a `refs #12` commit).
- **Action:** Run the same command against that range.
- **Should feel:** Precise, not paranoid — the tool names exactly what it found, not a vague "something changed."
- **Should understand:** Exit `1`, and stdout's `overwrites[]` array carries one entry per offending path/commit: `{path, commit, reason}`, where `reason` names the deleted line number and the commit whose `refs` trailer it traces back to. This is the HARD-GATE case — `flow/multispec-artifact-namespacing.md` says stop before rendering the console and report this array.
- **Red flags:** An overwrite silently merged into "clean" because only the exit code was checked and `1` was treated as "harmless — probably just a lint warning"; a console that renders anyway.

### 6. Understand the five safety tests without reading the algorithm
- **URL:** `plugin/skills/flow/multispec-artifact-namespacing.md`'s "Append vs. overwrite (#2014)" section
- **Action:** Read it instead of `plugin/bin/lib/flow/artifact-overwrite-check.js` directly.
- **Should feel:** The prose and the code agree — reading either one gives the same mental model.
- **Should understand:** A deletion is safe when either (1) `git blame` on the deleting commit's parent revision traces every deleted line back to a commit of the *same* spec as the deleting commit (a spec editing its own prior content) — a spec read from the commit's own `refs #{N}` trailer first, else from the one spec whose `manifest.yml` window (supplied with `--run`) holds the commit's author date, else unattributed and not safe, or (2) every deleted line is itself a `- ` list entry and the hunk replaces it with at least as many list entries (a shared frontmatter `files:` list, or a running bookkeeping bullet every spec's commit legitimately reflows), or (3) the hunk's removed and added lines are equal once journey step markup is normalized — `N. **Name** — x` and `### N. Name — x` read the same, and list indentation and blank lines are ignored (a step-markup reformat), or (4) every deleted line is a numbered step heading the hunk re-adds under a different number with the same text (a step renumber, the shape inserting a step ahead of existing ones produces), or (5) every deleted line is an inline `Origin:` line (plain, `_italic_` or `**bold**`) citing at least one `#{N}`, re-added as an `Origin:` line that still cites every reference (a later spec adding itself to a journey's Origin line). Only a deletion failing all five is a real overwrite. The bulleted `## Origin` section falls under test 2, which does not check references.
- **Red flags:** The doc and the code disagreeing about which test applies, or which one exempts a given deletion.

## Origin
- Created during build of #2014 (mechanize the artifact-overwrite completion check's append-vs-overwrite judgment).
- Step 3 added, and step 5 widened to three tests, during build of #3341 (pass a content-preserving step-markup reformat).
- Step 4 added, and step 6 widened to five tests, during build of #4590 (step renumber and reference-preserving `Origin:` line).
- Related specs: #786 (the original completion check this extends).
