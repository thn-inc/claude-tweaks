# Dependency Freshness Check (Adopt Path Only)

Referenced by `_shared/worktree-setup.md`'s Adopt-or-create gate — read only when that gate's adopt branch is taken (an already-isolated cwd), never on the create branch.

**Dependency freshness check (adopt path only).** A fresh `EnterWorktree`/`git worktree add`
creation installs dependencies as part of `/superpowers:using-git-worktrees` itself
(`build/worktree-setup.md`'s Procedure Step 3 — "branch creation, dependency install, baseline
test verification"). The adopt branch never calls that skill, so an adopted worktree with no
local `node_modules` at all has no install step anywhere in its lifecycle — Node's module
resolution then walks up to the main checkout's own `node_modules`, which can be stale relative
to the adopted worktree's branch (missing a dependency that branch's own commits already added),
producing cascading `ERR_MODULE_NOT_FOUND` failures that read as a code regression rather than a
dependency gap. Run this check once per adopt, **after** Post-creation catch-up's fetch+merge
above (so it reads the worktree's final `package.json`/lockfile state, not a snapshot the same
step's own merge might still change):

1. **Applicability.** Resolve the lockfile first, before looking at `node_modules` at all —
   an explicit priority chain, not `ls | head -1` (which sorts its output alphabetically
   regardless of argument order and silently picks the wrong lockfile whenever more than one
   is present, e.g. a leftover npm lockfile after a yarn/pnpm migration):
   ```bash
   if [ -f package-lock.json ]; then LOCKFILE=package-lock.json
   elif [ -f yarn.lock ]; then LOCKFILE=yarn.lock
   elif [ -f pnpm-lock.yaml ]; then LOCKFILE=pnpm-lock.yaml
   else LOCKFILE=""
   fi
   ```
   No lockfile found at the worktree root → this project declares no installable Node dependency
   surface (a test-harness-only `package.json` with empty/no `dependencies`/`devDependencies`, or
   no `package.json` at all) — stop here, nothing to check. A missing `node_modules` is expected
   and correct in this case, not a gap: don't let step 2 below fire on a project that was never
   going to have one. `claude-tweaks`'s own `package.json` is exactly this case (no lockfile, no
   `node_modules`, by design — `.gitignore` even excludes `/package-lock.json`), so this
   applicability check is not a hypothetical edge case.
2. **Presence.** A lockfile exists → `node_modules` missing entirely at the worktree root → gap
   confirmed, skip to step 4.
3. **Staleness (cheap signal only).** `node_modules` present → compare its own mtime against the
   lockfile's. Re-resolve `$LOCKFILE` in this same call rather than reusing step 1's value — a
   fresh shell per Bash invocation means a value assigned in an earlier fenced block would arrive
   empty here, silently turning this check into a permanent no-op (`[ "" -nt node_modules ]`
   evaluates false unconditionally). Guard on `node_modules` actually resolving before the `-nt`
   test: bash's `-nt` treats a missing or unresolvable right-hand side as *newer* (i.e. `STALE`),
   the opposite of the safe default this check wants, so an explicit `[ -e node_modules ]` check
   is what actually produces the intended FRESH-leaning degrade — not `-nt`'s own behavior:
   ```bash
   if [ -f package-lock.json ]; then LOCKFILE=package-lock.json
   elif [ -f yarn.lock ]; then LOCKFILE=yarn.lock
   elif [ -f pnpm-lock.yaml ]; then LOCKFILE=pnpm-lock.yaml
   else LOCKFILE=""
   fi
   if [ -e node_modules ] && [ "$LOCKFILE" -nt node_modules ]; then echo STALE; else echo FRESH; fi
   ```
   `FRESH` → nothing to report, stop here. `node_modules` unresolvable for any other reason
   (permissions, a broken symlink) is caught by the explicit `[ -e node_modules ]` guard above,
   not left to `-nt`'s own missing-target behavior — this is a cheap mtime heuristic, not a
   hash-based guarantee, and a false negative here is far cheaper than a false positive that nags
   on every adopt.
4. **Report.** On missing or `STALE`, detect the project's install command the same
   lockfile-driven way `_shared/dev-url-detection.md`'s Step 2 detects a dev command:
   `package-lock.json` → `npm ci`, `yarn.lock` → `yarn install --frozen-lockfile`,
   `pnpm-lock.yaml` → `pnpm install --frozen-lockfile`. Surface a clear, actionable message naming
   the gap and the detected command before the caller proceeds to any build/test step — never a
   silent auto-install: an install command run unattended and wrong (ambiguous lockfile match, a
   monorepo workspace subtlety this cheap check can't see) can leave the worktree worse off than
   the stale-but-working state it started in, so this check always degrades to a warning rather
   than executing anything itself. Log entry (`auto`/`hybrid` — a pipeline run dir exists):
   ```
   AUTO {time} — Adopt-or-create: adopted worktree's node_modules is {missing|stale relative to
   {lockfile}}. Recommend `{install command}` before running tests. Reversibility: n/a (a
   detection, not a mutation).
   ```
   Standalone or interactive: surface the same message inline. This is a warning, not a
   HARD-GATE — the caller still proceeds (a project whose test commands don't touch
   `node_modules` at all pays no real cost either way), but the message must land before Common
   Step 5's verification, not after it starts failing.
