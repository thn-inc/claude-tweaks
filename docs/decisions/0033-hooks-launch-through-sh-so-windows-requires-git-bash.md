# 0033. Hooks launch through a POSIX sh script, so Windows requires Git Bash

- **Status:** accepted
- **Date:** 2026-11-14
- **Context:** #5392

## Context

Every `plugin/hooks/hooks.json` registration was `node "${CLAUDE_PLUGIN_ROOT}/bin/hooks.js" <event>`. When the PATH Claude Code started with has no `node`, `/bin/sh` exits 127 before `hooks.js` runs. Claude Code reports that only as a non-blocking error, so every gate (the `worktree-always` deny, the write gate, E1, the Review Console ask gate) and every hook-written run artifact is off for the whole session, and nothing tells the model or the user. On 2026-11-13 one `/flow` session (PR #5371) logged 525 such errors and ran its whole build ungated, and three sibling sessions started in the same minute were in the same state. Node was installed on that machine. Only the session's PATH missed it, which is common with nvm, fnm and asdf setups that resolve `node` only in an interactive shell.

A launcher that finds node before giving up, and says so when it can't, must itself run without node, so it has to be a shell script. `hooks.json` holds one command string per registration, shared by every platform. Claude Code runs that string with `sh -c` on macOS and Linux, with Git Bash on Windows, and with PowerShell when Git Bash isn't installed (code.claude.com/docs/en/hooks.md, "Exec form and shell form"). PowerShell has no `sh`.

## Decision

Every registration is `sh "${CLAUDE_PLUGIN_ROOT}/bin/hooks.sh" <event>`. The launcher resolves node (PATH, then the path the last session saved, then well-known install locations) and `exec`s it on `hooks.js`. When it finds none, it warns at session start and on every prompt, and denies write-capable tools in projects whose policy sets `worktree-always: true`. Git Bash is a stated Windows requirement (README's Dependencies table, `docs/hooks.md`). A Windows install without it loses every claude-tweaks hook, where the old plain `node` registration ran.

## Alternatives considered

- **Ship without the launcher.** No Windows cost, but the 2026-11-13 failure stays as it was: any session whose PATH lacks node runs with every guard silently off. Rejected because a guard that fails with no signal is the failure the gates exist to prevent.
- **A registration that works under both `sh` and PowerShell.** It would keep Windows-without-Git-Bash working, but it needs one command string that both shells parse into the same launch. The no-node branch (drain stdin, print fixed JSON, read `policy.yml`) would then exist twice, once per shell, and each copy would need its own differential test against `resolveWorktreeAlways` to stay in sync. Rejected because that doubles the code on the one path that must never break, all to serve a configuration Claude Code treats as a fallback.
- **Node first, launcher only as a fallback** (`node … || sh hooks.sh …`). Plain node keeps working under PowerShell when node is on PATH. But `||` also fires when `hooks.js` itself exits non-zero, which reruns the hook after it has already drained stdin. Windows PowerShell 5.1 has no `||`. And a PowerShell session with no node still has no `sh` to fall back to. Rejected because it adds a second run path that misbehaves on ordinary failures and still leaves Windows-without-Git-Bash with no hooks once node is missing.

## Consequences

- On macOS, Linux and Windows with Git Bash, a session whose PATH lacks node now either finds node or is told the guards are off, and in `worktree-always` projects it is stopped from editing.
- On Windows without Git Bash, every hook fails as a non-blocking error and no guard runs. The silent fail-open this fixes on POSIX moves to that population, and README's Dependencies table is the only notice.
- Each hook call pays one `sh` startup before node. `npm run test:perf`'s hook budget is measured with the launcher in the path.
- `plugin/.gitattributes` must keep `hooks.sh` LF on a `core.autocrlf` checkout, because `sh` cannot run a CRLF script.
- The launcher carries a shell copy of `parseFlatLines`/`resolveWorktreeAlways` semantics. `tests/hooks-launcher.test.js`'s `hooks.sh AC9` differential keeps the two copies in agreement, and `policy-deprecations.md`'s `worktree.always` removal now covers both readers.
- Revisit if Claude Code's hook config gains a per-platform command, so Windows registrations could keep plain `node`, or if Windows users without Git Bash turn out to be a real population.
