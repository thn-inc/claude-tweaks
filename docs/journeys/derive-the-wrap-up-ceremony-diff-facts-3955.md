---
files:
  - plugin/bin/diff-facts.js
  - plugin/bin/lib/blast-radius-cli.js
  - plugin/bin/lib/dispatch/ceremony-derive.js
  - plugin/skills/wrap-up/ceremony-derivation.md
---

# Derive the Wrap-Up Ceremony Diff Facts in One Call

**Persona:** The agent running `/claude-tweaks:wrap-up` Phase 1 inside a worktree-isolated session, or a maintainer re-checking by hand why an `auto` run did or didn't drop to `fast-lane`. Either needs the run's diff classified before Reflect reads `ceremony-profile`, and has no wish to hand-assemble a `git` pipeline the session's Bash guard will refuse.
**Goal:** Get this run's diff facts (`fileCount`, `testFiles`, `docsFiles`, `implFiles`, `totalLines`, `lowSurface`) as one JSON line from one plain Bash call, and trust that a failure can never read as an empty, low-surface diff.
**Entry point:** `plugin/skills/wrap-up/ceremony-derivation.md` step 1, in an `auto`-mode run whose `config.yml` still reads `ceremony-profile: standard`, from a worktree with committed work ahead of its integration branch.
**Success state:** One JSON object on stdout and exit 0. Step 2 reads its `lowSurface` to decide whether to narrow `standard` to `fast-lane`. On any failure the result is exit 1, a `diff-facts: …` line on stderr, empty stdout, and `config.yml` left alone.

## Steps

### 1. Run the one documented command
- **URL:** `node "<plugin-root>/bin/diff-facts.js" --integration-branch main` (the literal plugin root substituted, as step 1 says)
- **Action:** Substitute the resolved integration branch and the literal plugin root into ceremony-derivation.md step 1's command, then run it as one plain Bash call from the worktree.
- **Should feel:** Like one ordinary command. Nothing to pre-split, no sha to paste between calls, and no refusal from the worktree session's shell guard.
- **Should understand:** The CLI resolves the merge-base of `HEAD` against `origin/main` when that ref exists (a stale local `main` cannot inflate the count), diffs `mergeBase..HEAD` with `--no-renames`, parses it with `parseNumstatZ`, and prints `computeDiffFacts`'s object unchanged. It shares one gather (`gatherDiffFiles`) with `blast-radius.js`, so ceremony derivation and merge-check classify the same diff. The same JSON is valid input for `resolve-profile.js --diff-facts` (`build/dispatch.md`'s whole-branch review model).
- **Red flags:** A refused command (the old `git … | node -e` shape coming back), or JSON carrying keys beyond `computeDiffFacts`'s eight.

### 2. Read `lowSurface` for the derivation decision
- **URL:** the printed JSON's `lowSurface` field
- **Action:** Hand the facts to ceremony-derivation.md step 2. When `lowSurface` is `true` (zero implementation files, in any mix of test and docs files), narrow `ceremony-profile` to `fast-lane` via `set-config.js`. When it is `false`, leave the `standard` default in place.
- **Should feel:** Mechanical. The verdict is in the JSON and nothing has to be re-derived.
- **Should understand:** Only committed work counts. An uncommitted edit in the working tree is not in `mergeBase..HEAD`, and a run with no committed work has `fileCount: 0`, which is never `lowSurface`. That keeps the failure direction safe: it stays on `standard`. Prompt prose under `skills/`, `agents/` or `commands/` counts as implementation, not docs. A top-level `docs/plans/*.html` diagram (the `/claude-tweaks:visualize` output path) counts as docs (#4187), so a docs-only record that ships one still derives `fast-lane`. Any other `.html`, including one nested under `docs/plans/`, is not docs.
- **Red flags:** `lowSurface: true` on a branch whose commits touch a `plugin/bin/` or `plugin/skills/` file. `lowSurface: false` on a diff of only `docs/**/*.md` plus one `docs/plans/{slug}.html` diagram.

### 3. Watch a failure fail loud
- **URL:** `node "<plugin-root>/bin/diff-facts.js" --integration-branch no-such-branch` (or `--integration-branch` with no value)
- **Action:** Run against a branch that cannot resolve, or with a malformed invocation.
- **Should feel:** Unambiguous. There is nothing on stdout to mistake for a result.
- **Should understand:** Exit 1, a single `diff-facts: …` stderr line (`could not resolve merge base …` or `--integration-branch requires a value`), and empty stdout. Step 1's failure branch then derives nothing, leaves `config.yml` untouched, and logs a `SKIP` naming the exit code.
- **Red flags:** Any stdout on a failure path. A failure followed by a `fast-lane` write to `config.yml`.

## Origin
- Created during build of #3955 (wrap-up ceremony diff facts in one process — replaced ceremony-derivation.md step 1's pre-split `git merge-base` + `git diff --numstat -z | node -e` composition, which #3829 had split into two calls with paste-in literals, with `plugin/bin/diff-facts.js`)
- Steps 1-3 built in this session
- Related specs: #3829 (the pre-split this replaces), #1545 (the diff-derived ceremony default), #888 (`blast-radius.js`, whose gather this shares)
- Updated during build of #4187: step 2 now covers `docs/plans/*.html` diagrams counting as docs in `isDocsPath`
