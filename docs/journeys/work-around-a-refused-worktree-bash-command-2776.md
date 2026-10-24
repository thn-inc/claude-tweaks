---
files:
  - plugin/skills/_shared/scratch-worktree.md
  - plugin/skills/feedback/SKILL.md
  - plugin/skills/feedback/bare-invocation.md
  - plugin/skills/dispatch/task-prompt.md
  - plugin/skills/_shared/pr-run-comments.md
  - plugin/bin/find-run-comment.js
---

# Work Around a Refused Worktree Bash Command

**Persona:** An agent session (or the maintainer driving it) running `/claude-tweaks:flow` inside a `worktree-always` project's linked worktree. One of its Bash calls has just come back refused or denied, often a command the skill prose itself prescribes.
**Goal:** Learn whether this refusal shape is known, and find the workaround that runs on the next try. Skip rediscovering it by trial and error, and never edit plugin hook code to "fix" it.
**Entry point:** The refusal message in the failed tool result. Then `_shared/scratch-worktree.md`'s "## 7. Shell constraint", reached from `_shared/worktree-setup.md`'s pointer to it.
**Success state:** The session re-runs the work in a form §7 records as passing, on the first retry. It knows whether the refusal came from the harness guard or from a permission rule.

## Steps

### 1. Classify the refusal by its wording — A Bash call fails before running.
- **Action:** Read the refusal text. "This session is isolated in the worktree … too complex to verify" or "runs X with a value computed at runtime" is the harness's worktree guard. "Permission to use Bash with command … has been denied" is a permission rule from settings, not that guard.
- **Should feel:** Oriented. Two refusal sources, told apart by their wording.
- **Should understand:** Neither one is `plugin/bin/lib/hooks/pre-tool-use.js`. A plugin hook can add denials but can never lift the harness's own.
- **Red flags:** The session opens `pre-tool-use.js` to "fix" the guard, or files a plugin defect against it.

### 2. Find the shape in §7 — The session looks the failed command up.
- **Action:** Look the failed command up by shape in §7's current-state table (Shape, Example, Verdict, Refusal wording, Workaround, Last verified). Heredoc + `gh pr comment` is refused only with a runtime path variable, a `.git/` log read is a `.log` permission rule (plus a path that does not resolve inside a linked worktree), and the rows marked `passes` ran unrefused.
- **Should feel:** Quick. A match is one scan away, not a series of probes.
- **Should understand:** Each row is "last observed, not a guarantee", with its Last-verified date. A shape listed as passing can still be refused under a different harness build or settings file.
- **Red flags:** The `.g*t`/`.g*hub` glob workaround reached for out of habit, though the bare forms pass. A `.git/worktrees/…` path written relative to the worktree.

### 3. Re-run in the passing form — The session applies the recorded workaround.
- **Action:** A literal path in place of `$TMPDIR` (or the `Write` tool for a comment body, then a plain `gh pr comment N --body-file /literal/path`). For the verify log: the path skill prose prescribes, `{git-dir}/claude-tweaks-verify/`, with `{git-dir}` the absolute path from `git rev-parse --git-dir`. Or read `verify.js`'s own summary of the failing region. For a command that runs `git` and also carries a `$(git …)` substitution or, inside its `node -e` text, a runtime variable such as `${CLAUDE_PLUGIN_ROOT}` — run the inner `git` call on its own, then paste its printed value and the literal plugin root into the outer command. The `git … | node -e` pipe itself passes. For a `gh … --jq '…|…'` call, or a `gh … --repo github.com/…` call, that came back refused because an exit-code echo was chained on (`; echo exit=$?`), run the `gh` call alone. To filter run comments, use `_shared/pr-run-comments.md`'s Find-step form: a plain `gh pr view {n} --repo {owner}/{repo} --json comments > {file}`, then `node {plugin-root}/bin/find-run-comment.js --comments-file {file} --kind {kind}`. That form passes even with the echo chained on. For a path spelled with a backslash-escaped space (`Code\ Workspaces`), double-quote the whole path instead. A dispatched agent reads this one in its Task prompt's shell-constraint list (`dispatch/task-prompt.md` item 6), so it doesn't need §7 for it.
- **Should feel:** Uneventful. The retry runs.
- **Should understand:** One plain command per Bash call stays the default (§7's practical workaround). The table narrows which shapes need special handling. It does not lift that default.
- **Red flags:** The same refused shape retried unchanged. The pipe blamed and split apart while the `$(git …)` substitution or runtime variable stays in. A path rewritten just to slip past a deny rule someone set on purpose. A new shape that §7 doesn't cover gets worked around silently, with no table row or record filed.

### 4. File an uncovered shape upstream — The session reports a refusal §7 doesn't record.
- **Action:** Run `/claude-tweaks:feedback` with the refusal quoted. Before Step 1 names `pre-tool-use.js` or any plugin hook as the affected component, it greps the quote's reason clause (e.g. `too complex to verify`, never the `This session is isolated … Refusing to run it` frame) under the plugin's `bin/`. A bare `/claude-tweaks:feedback` session-evaluation batch applies the same check.
- **Should feel:** Correctly routed on the first draft, with no premise-correction reshape needed later.
- **Should understand:** No match → the draft names the Claude Code harness worktree guard and goes in as a `_shared/scratch-worktree.md` §7 table-row candidate (a documentation finding). A `claude-tweaks:`-prefixed deny still names the plugin hook. A `Permission to use Bash … has been denied` refusal is a permission rule, not either.
- **Red flags:** A filed record that blames `pre-tool-use.js` for a refusal string absent from `bin/`. A grep fragment containing `git`, which the guard refuses itself.

## Outcome

A refused Bash call in a worktree session costs one lookup and one retry, not a dozen probes. The session knows which refusals are the harness guard, which are permission rules, and which reported shapes don't reproduce at all.

_Origin: record #2776 (reshaped to doc-only: the refusals come from the harness guard, not `pre-tool-use.js`), built 2026-10-16. Step 4 added by record #3338 (`/claude-tweaks:feedback` checks a quoted refusal against `bin/` before blaming a plugin hook), built 2026-10-20. Step 2 repointed by record #3340 (§7's dated addenda folded into one live-re-verified current-state table), built 2026-10-20. Step 3 extended by record #3829 (the avoid-list names the `$(git …)` shape and a runtime variable in the `node -e` text of a `git` command; `ceremony-derivation.md`'s diff-facts call pre-split), built 2026-10-22. Step 3 extended by record #3936 (a `gh --jq`/`github.com` call chained onto an unquoted `$?` is refused while each passes alone; the Find step's fetch-to-file plus `bin/find-run-comment.js` form survives it), built 2026-10-24. Step 3 extended by record #4022 (the dispatch Task prompt's avoid-list names the backslash-escaped-space path shape and its double-quoted fix, agreeing with §7's refused row), built 2026-10-24._
