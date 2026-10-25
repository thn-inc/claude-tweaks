---
files:
  - tools/guard-refusals.js
  - tools/guard-refusals/transcripts.js
  - tools/guard-refusals/trace.js
  - tools/guard-refusals/shapes.js
  - tools/guard-refusals/fences.js
  - plugin/skills/_shared/scratch-worktree.md
  - tests/skill-fence-guard-shapes.test.js
  - tests/guard-refusals/shapes.test.js
---

# Measure Worktree-Guard Refusals and Find the Fence Behind Them

**Persona:** The claude-tweaks plugin maintainer, at a terminal in a checkout of this repo (`tools/` is maintainer-side and never ships). A fortnight of `/claude-tweaks:flow` and `/claude-tweaks:dispatch` runs has left transcripts under their `~/.claude/projects` store, or under `$CLAUDE_CONFIG_DIR/projects` when the maintainer runs a second account. Friction reports mention "Refusing to run it" but nobody has counted them.
**Goal:** Learn which refusal reasons, which command shapes and which skill fences cause Claude Code's worktree-isolation guard to refuse Bash calls, and how many refusals a pipeline run costs on average. This is the instrument for the follow-up measurement in #4216.
**Entry point:** `node tools/guard-refusals.js` run from the repo root (add `--json` for the full report).
**Success state:** The maintainer holds one number (`perPipeline.mean` over a stated window) and a short ranked list of `file:line` fences. Each fence is either migrated to a guard-accepted form, or its shape has a §7 row plus detector, with `tests/skill-fence-guard-shapes.test.js` green. A later re-run over a newer window shows the count for that fence falling.

## Steps

### 1. Run the CLI over a window — `node tools/guard-refusals.js`
- **URL:** `node tools/guard-refusals.js --since-days 14 --match claude-tweaks --json > report.json`. Flags: `--projects-dir <dir>`, `--match <slug-substring>`, `--since-days <n>` (default 14), `--until <iso>` (default now), `--skills-root <dir>` (default this checkout's `plugin/skills`), `--json`, `--help`.
- **Action:** Run it without `--json` first for the short table, then with `--json` to keep the report. The window is `[until - since-days, until)` over transcript file mtimes. The first table line prints it as `guard refusals {since} .. {until}`, with `files`, `unreadable`, `calls` (unique Bash and Write tool_use ids) and `refusals` on the line below.
- **Should feel:** Cheap and repeatable. One command, a short table, the same command next week giving a comparable number.
- **Should understand:** Exit 0 is a report, even a zero-refusal one. Exit 2 is a malformed invocation (an unknown flag, `--since-days` not a positive number, `--until` not an ISO timestamp) or a `--projects-dir` / `--skills-root` that is missing or unreadable, and stderr names which. `--until` pins a window so two runs compare like for like.
- **Red flags:** `files 0` on a machine that ran pipelines (the store is under `$CLAUDE_CONFIG_DIR/projects`, and `--projects-dir` was not passed). `unreadable` above 0 on a store nothing was writing to. A `--since-days` shorter than the runs under study, so `perPipeline.runs` reads 0 while `refusals` does not.

### 2. Read the four breakdowns — `byReason`, `byShape`, `byFence`, `perPipeline`
- **URL:** the `--json` report, or the table's `by reason`, `by shape`, `by fence (top 10)` and `per pipeline:` blocks
- **Action:** Read `perPipeline` first: `runs` (pipeline runs in the window whose id timestamp falls in it, refused or not), `attributedRefusals`, `unattributedRefusals`, `mean` and `median` of attributed refusals per run, a clean run counting 0. Then `byReason` (a fixed vocabulary such as `names-git`, `node-runtime-operand`, `gh-runtime`, `runs-eval`, `too-complex`, `other`), `byShape` (the static detector ids from `tools/guard-refusals/shapes.js`, such as `gh-computed-input`, `git-var-operand`, `eval-token`, `node-eval-computed-arg`, plus `unclassified`), and `byFence` (`file:line` of the skill fence the refused command was copied from). A command may match several shapes, so `byShape` can sum to more than `refusals`.
- **Should feel:** Decisive. One reason and one shape sit clearly on top, or the report plainly says there is no dominant cause.
- **Should understand:** `mean` and `median` can differ sharply: a few runs with dozens of refusals and many clean ones give a median of 0 beside a mean of 2. The mean is the figure #4216 compares across windows. `unattributedRefusals` are refusals with no run named before the call, or a run outside the window, so they count in `refusals` but not in `mean`. `tools/guard-refusals/transcripts.js` attributes a refusal to the nearest run id the same transcript file named before the call, and a subagent file that names none inherits its parent session's run. `top` holds up to 20 sample commands per reason, cut to 300 characters.
- **Red flags:** `unclassified` as the top `byShape` key (a shape no detector knows, which is a §7 gap). `unattributedRefusals` larger than `attributedRefusals`, which makes `mean` a floor rather than a measurement. A `byReason` of `other` ahead of every named reason, which means the refusal wording changed and `trace.js`'s reason table needs a clause.

### 3. Trace the top fence to its source — `file:line`
- **URL:** a `byFence` key such as `{skill}/{file}.md:{line}`, relative to `plugin/skills`, and the matching `refusals[]` entries (`command`, `reason`, `shapes`, `fences`, `runId`)
- **Action:** Open the file at that line: it is the opening line of a shell fence, as `tools/guard-refusals/fences.js` extracts them. Compare the fence's text to a `refusals[].command` carrying that fence id. A fence line matches a command line when both are equal once `${CLAUDE_PLUGIN_ROOT}` and the literal plugin root are normalized and each `{placeholder}` or `$VAR` in the fence is treated as a wildcard. When two fences tie for the most matched lines, both ids are listed.
- **Should feel:** Like following a stack trace. From a count to the exact prose line takes one open.
- **Should understand:** An empty `fences` list on a refusal means the agent composed the command itself, so the fix is a §7 row or a prose rule, not a fence edit. Several refusals sharing one fence id is the signal worth acting on first. A tied pair is a shared snippet copied into two skills.
- **Red flags:** A fence id whose file no longer has a fence at that line (the report ran against a different `--skills-root` than the checkout being edited). Editing the fence the `top` sample resembles rather than the one `byFence` names.

### 4. Act on the fence or the shape — migrate it, or record it
- **URL:** `plugin/skills/{skill}/{file}.md` at the traced line, `plugin/skills/_shared/scratch-worktree.md` section 7, `tools/guard-refusals/shapes.js`
- **Action:** Pick the branch the evidence names. **Known shape, accepted form exists:** rewrite the fence into the passing form §7 records (per-variable `VAR="$(node …/session-tmp-resolve.js --value {file})"` lines instead of `eval`, `--` before a computed `node -e` argument, a literal path pasted in place of a runtime variable) and delete its ratchet entry from `tests/skill-fence-guard-shapes.test.js`'s allowlist, which fails on a stale entry. **Fence already allowlisted as a ratchet entry:** it is waiting on #4217's per-fence migration, so cite the entry and do not add a second. **Shape no detector flags (`unclassified`) or a new refusal wording:** probe the shape in a guard-isolated worktree session, add or update its §7 row (Shape, Example, Verdict, Refusal wording, Workaround, Last verified), and add the detector in `shapes.js` whose `row` is that row's exact Example cell. `tests/guard-refusals/shapes.test.js` fails until every refused row has a bound detector and no detector fires on a passes-row example.
- **Should feel:** Mechanical and gated. The change that closes a gap is the same size as the gap, and a test turns red if the row, the detector or the fence is left behind.
- **Should understand:** `tests/skill-fence-guard-shapes.test.js` is the gate: it scans every shell fence under `plugin/skills` (and unlabelled ones, and unterminated ones) with every detector, and a new offender that is not allowlisted fails the suite. Ratchet entries are only allowed for the four detectors added in #4028 (`gh-computed-input`, `git-text-redirect-var`, `git-var-operand`, `node-git-text`) plus `queue-pull-script.md`'s `git-in-substitution` hit. The five shapes the normalizer rewrites need no fence edit in a linked worktree session, because `bin/lib/hooks/guard-rewrite.js` normalizes them before the guard reads them.
- **Red flags:** A detector added with no §7 row, or a row with a refused verdict and no detector. A new ratchet entry for a detector outside that list. A fence "fixed" by adding a `guard-rewrite.js` rule that rewrites into a form §7 lists as refused (the guard re-checks the rewritten text, so it is refused anyway).

### 5. Re-measure and compare — the same command over a newer window
- **URL:** `node tools/guard-refusals.js --since-days 14 --until {iso} --json`
- **Action:** After the migrated fence has run in real pipelines, re-run with the same flags over a later window, or pin both windows with `--until`. Compare `perPipeline.mean`, the fence's `byFence` count and its `byShape` ids.
- **Should feel:** Closed-loop. The fence that was on top is absent or lower, and the mean is lower or the report says why not.
- **Should understand:** The two windows must hold runs of the migrated skills, and a run only counts when its id timestamp (`YYYY-MM-DDTHHMMSS`, UTC) is inside the window, so a window that ends before the migrated plugin version shipped measures nothing about it. #4216 owns the comparison across plugin versions.
- **Red flags:** A mean that drops while `perPipeline.runs` also collapses (fewer pipelines ran, not fewer refusals). A comparison between a window before the fence changed and one that has no run of that skill in it.

## Outcome

"How often does the worktree guard refuse our own skill prose" becomes one command with a number, a ranked list of fences, and a test that stops a refused shape from re-entering `plugin/skills`. Fixing a fence, recording a shape and re-measuring are each one step from the report.

_Origin: record #4028 (`tools/guard-refusals.js` and its `guard-refusals/` modules, §7 rows and detectors, `tests/skill-fence-guard-shapes.test.js`), built 2026-10-25. Follow-ups: #4216 (the per-pipeline measurement over later plugin versions), #4217 (migration of the ratchet-allowlisted fences). Related: `work-around-a-refused-worktree-bash-command-2776.md` is the agent-side counterpart that looks one refused command up in §7._
