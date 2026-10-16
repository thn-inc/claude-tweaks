---
files:
  - plugin/skills/_shared/scratch-worktree.md
---

# Work Around a Refused Worktree Bash Command

**Persona:** An agent session (or the maintainer driving it) running `/claude-tweaks:flow` inside a `worktree-always` project's linked worktree. One of its Bash calls has just come back refused or denied, often a command the skill prose itself prescribes.
**Goal:** Learn whether this refusal shape is known, and find the workaround that runs on the next try. Skip rediscovering it by trial and error, and never edit plugin hook code to "fix" it.
**Entry point:** The refusal message in the failed tool result. Then `_shared/scratch-worktree.md`'s "## 7. Shell constraint", reached from `_shared/worktree-setup.md`'s pointer to it.
**Success state:** The session re-runs the work in a form §7 records as passing, on the first retry. It knows whether the refusal came from the harness guard or from a permission rule.

## Steps

1. **Classify the refusal by its wording** — A Bash call fails before running.
   - **Action:** Read the refusal text. "This session is isolated in the worktree … too complex to verify" or "runs X with a value computed at runtime" is the harness's worktree guard. "Permission to use Bash with command … has been denied" is a permission rule from settings, not that guard.
   - **Should feel:** Oriented. Two refusal sources, told apart by their wording.
   - **Should understand:** Neither one is `plugin/bin/lib/hooks/pre-tool-use.js`. A plugin hook can add denials but can never lift the harness's own.
   - **Red flags:** The session opens `pre-tool-use.js` to "fix" the guard, or files a plugin defect against it.

2. **Find the shape in §7** — The session looks the failed command up.
   - **Action:** Scan §7's dated addenda, newest first. The 2026-10-16 (#2776) entry covers heredoc + `gh pr comment` (refused only with a runtime path variable), a `.git/` log read (a `Read(**/*.log)` permission rule, plus a path that does not resolve inside a linked worktree), and five shapes that ran unrefused.
   - **Should feel:** Quick. A match is one scan away, not a series of probes.
   - **Should understand:** Each entry is "last observed, not a guarantee". A shape listed as not reproducing can still be refused under a different harness build or settings file.
   - **Red flags:** The `.g*t`/`.g*hub` glob workaround reached for out of habit, though the bare forms pass. A `.git/worktrees/…` path written relative to the worktree.

3. **Re-run in the passing form** — The session applies the recorded workaround.
   - **Action:** A literal path in place of `$TMPDIR` (or the `Write` tool for a comment body, then a plain `gh pr comment N --body-file /literal/path`). For the verify log: the absolute git dir from `git rev-parse --git-dir`, or the `Read` tool on that path.
   - **Should feel:** Uneventful. The retry runs.
   - **Should understand:** One plain command per Bash call stays the default (§7's practical workaround). The #2776 entry narrows which shapes need special handling. It does not lift that default.
   - **Red flags:** The same refused shape retried unchanged. A new shape that §7 doesn't cover gets worked around silently, with no addendum or record filed.

## Outcome

A refused Bash call in a worktree session costs one lookup and one retry, not a dozen probes. The session knows which refusals are the harness guard, which are permission rules, and which reported shapes don't reproduce at all.

_Origin: record #2776 (reshaped to doc-only: the refusals come from the harness guard, not `pre-tool-use.js`), built 2026-10-16._
