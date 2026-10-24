---
files:
  - .claude/skills/lib-module-split/SKILL.md
  - docs/plugin-structure.md
---

# Split a Shared Lib Module Behind a Facade

**Persona:** A claude-tweaks maintainer about to break a high-fan-in `plugin/bin/lib/` module (dozens of `require` sites, some of them in skill-prose `node -e` lines) into cohesive sub-modules. They want to prove nothing moved but location, and to leave no comment, skill bullet or journey still saying the code lives where it used to.
**Goal:** Ship a split that is provably a pure move and leaves no stale location claim behind.
**Entry point:** The `lib-module-split` project skill (`.claude/skills/lib-module-split/SKILL.md`), loaded when planning or reviewing the split.
**Success state:**
- `pure-move.js` prints all three check lines with nothing missing, no cycles and no facade requirers.
- Every hit from the four sweep commands has been either repointed or deliberately kept as an import-path reference.
- `docs/plugin-structure.md` names the facade and each sub-module.
- The full suite is green.

## Steps

### 1. Decide facade or migrate
- **URL:** the skill's "When a facade beats migrating call sites" table, plus its fan-in `git grep -lE … | wc -l` command.
- **Action:** Count the importers and check how many of them are skill prose. Pick facade or migrate from the table.
- **Should feel:** Settled by evidence. The fan-in count and the expand-contract rule decide it, not taste.
- **Should understand:**
  - A facade does not forbid migration. It defers migration so consumers can move one at a time.
  - What breaks expand-contract is removing the old path while an installed build still reads it.
- **Red flags:** Migrating 69 call sites in the same change as the split, including skill-prose require lines the installed build still executes.

### 2. Prove the move was pure
- **URL:** the skill's "The pure-move proof" section.
- **Action:**
  - Extract the base and head trees with `git archive`, one command per Bash call.
  - Save the inlined `pure-move.js` to a scratch file.
  - Run it with the facade and every new sub-module as arguments.
- **Should feel:** Conclusive. Three short lines (`check 1`, `check 2`, `check 3`) and exit 0, or a named failure.
- **Should understand:** Each check catches what the other two pass, so all three must run.
  - Editing an internal constant leaves check 1 green and turns check 2 red.
  - Adding a require cycle leaves checks 1 and 2 green and turns check 3 red.
  - For #2805, a 60/60 declaration count against the review's 62 is expected: check 2 skips the base facade's two `require` lines on purpose.
- **Red flags:**
  - Calling the split proven on check 1 alone.
  - Running the script with a heredoc `node -e` inside a worktree session, where the Bash guard refuses it.
  - Comparing against a base that already carries unrelated edits to the file.

### 3. Sweep the four stale-claim shapes
- **URL:** the skill's "The stale-location sweep" section.
- **Action:** Run each of the four commands with the facade name substituted in:
  - the `requires only` grep
  - the `stale-pointers.js` classifier
  - the content-location grep
  - the journey `files:` grep

  Then classify every hit with the skill's test: does the claim still hold if the reader only ever does `require('{facade}')`?
- **Should feel:** Like working through a short candidate list, not a verdict to accept blindly. Each hit gets an explicit keep-or-repoint decision.
- **Should understand:** There are two kinds of hit.
  - An exported symbol reached through the facade is an import-path reference. It stays correct after the split, for example `record.js`'s `parseDependencyAssumptions`.
  - A claim about the facade file's own text is stale and gets repointed. Examples: its requires ("record.js requires only ./facet-shape"), its comments, or a non-exported internal ("`record.js`'s `DEP_RE`").
  - Journey `files:` entries keep the facade and gain the sub-modules whose symbols the journey exercises. `/visual-review` overlap and `/journey-health` churn read those paths.
- **Red flags:**
  - Repointing every hit to a sub-module, which churns correct import advice.
  - Deleting a journey's facade entry instead of adding to it.
  - Treating the classifier's line-level output as final. A line can name the facade for one symbol and correctly attribute another.

### 4. Update the module-family entry and verify
- **URL:** the `plugin/bin/lib/{family}/` line in `docs/plugin-structure.md`, then the skill's "Done when" list.
- **Action:**
  - Rewrite the facade's clause to name each sub-module with its one-phrase responsibility.
  - Run the full suite, redirected to a file.
- **Should feel:** Like the easy last step. The skill says #2805's own docs curation stopped here, and every claim fixed later was found by the sweep in step 3.
- **Should understand:** Conformance tests pin prose, so a repointed sentence can turn the suite red even when no code changed.
- **Red flags:** Treating the `docs/plugin-structure.md` edit as the whole docs sweep.

## Origin
- Created during the build of #4010. That build added the `lib-module-split` project skill from #2805's review hindsight: PR #2822's review proved the split from scratch scripts, and fix commit `31cf39c0e` repointed 15 stale claims across 16 files.
