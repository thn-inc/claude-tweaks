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
- **URL:** `node "${CLAUDE_PLUGIN_ROOT}/bin/check-artifact-overwrite.js" --base "$EXPECTED_BASE" --path docs/journeys/ --path stories/`
- **Action:** Run it once, after every spec in the shared worktree has committed, before the Consolidated Review Console renders.
- **Should feel:** One command, one verdict — no manual `git log --numstat` reading required for the common case.
- **Should understand:** Exit `0` means clean — stdout is `{"clean":true,"overwrites":[]}` — and the console renders normally. A path that was only ever added once, with no later modification, never even appears in the walk.
- **Red flags:** A nonzero exit read as "clean" without checking it; a caller that greps stdout for a substring instead of parsing the JSON envelope.

### 2. Read a clean append-only run — the #1988-#1997 case
- **URL:** `node "${CLAUDE_PLUGIN_ROOT}/bin/check-artifact-overwrite.js" --base 4c6e76733 --head b247a02d3 --path docs/journeys/compose-a-per-run-context-bundle-1988.md` (this repo's own history)
- **Action:** Run it and read the JSON.
- **Should feel:** Vindicating — a shape that used to require a human ruling with `git log --numstat` as evidence now resolves itself.
- **Should understand:** `docs/journeys/compose-a-per-run-context-bundle-1988.md` was added by #1988 and modified by six later specs (#1989, #1991, #1992, #1993, #1995, #1997), each appending its own step or reflowing the trailing "Related specs: …" bookkeeping bullet. The check reports `clean: true` — every one of those later commits passes either the same-spec self-edit test (a spec correcting its own prior line, matched via `git blame` + the commit's own `refs #{N}` trailer) or the list-reflow test (a `- ` bookkeeping entry replaced by at least as many list entries).
- **Red flags:** `clean: false` on this exact real range — that would mean the two safety tests regressed.

### 3. Read an overwrite — a later spec deletes an earlier spec's own step content
- **URL:** a synthetic fixture, same shape as `tests/bin-lib/flow/artifact-overwrite-check.test.js`'s "cross-spec overwrite" case: spec #10 adds a journey with a Step 1 body; a later commit tagged `refs #12` deletes that Step 1 body outright (not a `- ` list entry, and not traceable via blame to a `refs #12` commit).
- **Action:** Run the same command against that range.
- **Should feel:** Precise, not paranoid — the tool names exactly what it found, not a vague "something changed."
- **Should understand:** Exit `1`, and stdout's `overwrites[]` array carries one entry per offending path/commit: `{path, commit, reason}`, where `reason` names the deleted line number and the commit whose `refs` trailer it traces back to. This is the HARD-GATE case — `flow/multispec-artifact-namespacing.md` says stop before rendering the console and report this array.
- **Red flags:** An overwrite silently merged into "clean" because only the exit code was checked and `1` was treated as "harmless — probably just a lint warning"; a console that renders anyway.

### 4. Understand the two safety tests without reading the algorithm
- **URL:** `plugin/skills/flow/multispec-artifact-namespacing.md`'s "Append vs. overwrite (#2014)" section
- **Action:** Read it instead of `plugin/bin/lib/flow/artifact-overwrite-check.js` directly.
- **Should feel:** The prose and the code agree — reading either one gives the same mental model.
- **Should understand:** A deletion is safe when either (1) `git blame` on the deleting commit's parent revision traces every deleted line back to a commit carrying the *same* `refs #{N}` trailer as the deleting commit (a spec editing its own prior content), or (2) every deleted line is itself a `- ` list entry and the hunk replaces it with at least as many list entries (a shared frontmatter `files:` list, or a running bookkeeping bullet every spec's commit legitimately reflows). Only a deletion failing both is a real overwrite.
- **Red flags:** The doc and the code disagreeing about which test applies, or which one exempts a given deletion.

## Origin
- Created during build of #2014 (mechanize the artifact-overwrite completion check's append-vs-overwrite judgment).
- Related specs: #786 (the original completion check this extends).
