# Worktree Setup — Shared Procedures

Canonical home for the three staleness-protection procedures every worktree-creation call site
needs: fast-forwarding the main checkout's own integration-branch ref before creating anything
(cheap, best-effort), catching a freshly created worktree up with the integration branch
(unconditional), and warning the owner of the *current* branch before creating one, when that
branch may itself be behind the integration branch. Consolidates what were two byte-identical copies
(`skills/flow/validation.md` Step 2.5, `skills/build/worktree-setup.md` Step 1) — see CLAUDE.md's
`[IL-32]`. `skills/_shared/scratch-worktree.md` Section 3 cites the Post-creation catch-up section
below instead of carrying its own copy. For the harness's separate worktree-session Bash guard (what commands fail in a worktree session, and why), see `skills/_shared/scratch-worktree.md`'s "## 7. Shell constraint".

## Resolving `{integration-branch}`

The two sections below resolve `{integration-branch}` differently, on purpose — they answer
different questions and must not be folded into one shared resolution:

- **Post-creation catch-up** runs inside a brand-new worktree whose branch has no `@{upstream}`
  of its own yet, so it resolves via `skills/_shared/integration-branch.md`'s full canonical
  ladder, git-inference rank included — there is nothing else to fall back to.
- **Pre-flight divergence check** compares the *current, already-tracked* branch before
  creating anything, so it deliberately **excludes** that ladder's git-inference rank — see its
  own subsection below for why.

Using either section's resolution for the other's purpose reintroduces a bug: the git-inference
rank shadows a tracked branch's real `@{upstream}` (false-positive divergence warnings on
ordinary feature branches), while the narrower policy-then-upstream resolution has no fallback
for a branch that was never pushed and carries no upstream at all.

## Adopt-or-create

Before any worktree-creation call site decides whether to invoke `EnterWorktree(name=...)` at
all, resolve whether the session is already inside a linked worktree — superpowers Step 0's own
check: `GIT_DIR != GIT_COMMON` (via `git rev-parse --git-dir` / `--git-common-dir`), guarded
against the submodule false-positive (`git rev-parse --show-superproject-working-tree` returning
a path means "submodule, not worktree" — treat as not-isolated). Every top-level
worktree-creation call site in this plugin needs this decision, not only this section's callers —
`EnterWorktree(name=...)` refuses outright when the session is already in a worktree ("Already in
a worktree session. Pass `path` to switch into another existing worktree, or use `ExitWorktree` to
leave this one before creating a new worktree."), so any call site that skips this check and
invokes it anyway from inside an existing worktree fails every time it runs under a
`worktree-always` project (`docs/incident-log.md`).

**Already isolated:** do not call `EnterWorktree(name=...)` — it will refuse. First run a
clean-tree precondition check: `git status --porcelain`. Non-empty (dirty) → do not adopt; fall
through to **Not isolated** below, but via `ExitWorktree(action: "keep")` first (leave the dirty
worktree on disk untouched — it may hold unrelated in-progress work from earlier in the same
session) rather than `EnterWorktree(name=...)` alone, since the harness's own "must not already
be in a worktree session" precondition for `name`-creation still applies until the session
actually leaves. Empty (clean) → **adopt** the current worktree as this run's workspace: no
`EXPECTED_BASE` capture applies (there is no separate "branch this worktree starts from" distinct
from what's already checked out — see Post-creation catch-up's own "no `EXPECTED_BASE` to
capture" case, which already documents skipping just the `EXPECTED_BASE`-specific merge below
while the origin-relative fetch+merge still runs on its own). The adopt path still runs
Post-creation catch-up's `git fetch origin {integration-branch}` / `git merge
origin/{integration-branch}` unconditionally — that half protects the "worktree fell behind"
direction regardless of how old the adopted worktree is, exactly as this file's own text already
states ("never assumed already-satisfied just because the worktree is brand new" applies with
equal force to a worktree that is *not* brand new). The caller records the actual current branch
name for anything downstream that reports or acts on it — never assume its own naming convention
(e.g. a call site that would otherwise mint `flow/spec-{N1}-{N2}...`) was applied; nothing renames
the branch, since a rename could break an already-open PR on a worktree left over from unrelated
prior work in the same session.

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

**Not isolated:** create normally — proceed to Pre-creation reconcile and Post-creation catch-up
below, unchanged (`EnterWorktree(name=...)`).

**Idempotent.** The adopt branch is a pure detection-plus-skip with no state mutation beyond
recording the current branch name, so re-invoking this gate a second time within the same session
(e.g. a later step in the same pipeline re-checking) produces the same outcome both times.

**Not the same problem as `dispatch/sequential-execution.md`'s `#447` handling.** `#447` covers a
dispatching session that is itself a Task-tool subagent, cwd-*pinned* by its own launcher — it
cannot move its cwd at all, so it falls back to a raw `git worktree add` plus explicit
`cd`-prefixed commands for every downstream call, since cwd inheritance is unavailable there. This
section is for a session that *could* move its cwd via `EnterWorktree` but is already elsewhere
when the decision point is reached. The two stay separate procedures — do not merge them.

## Pre-creation reconcile

Before any worktree-creation call (`EnterWorktree` or `git worktree add`), fast-forward the
*main checkout's* local `{integration-branch}` to origin's tip:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/hooks.js" reconcile
```

This is the cheap common-case optimization: it makes the Post-creation catch-up below a no-op
in the ordinary case, since a freshly cut worktree branch then starts at a tip that's already
current. It does not replace that catch-up, and is never a substitute for it — reconcile only
advances the *main checkout's* own `{integration-branch}` ref, and never touches a worktree's
branch. A worktree cut before reconcile ran, or cut concurrently by a sibling session that
advances `origin` afterward, can still start stale — the Post-creation catch-up stays the
unconditional backstop regardless of whether this step ran, or ran successfully. Never `git
checkout` or `git pull` in the shared checkout to accomplish this fast-forward — `reconcile`'s
mirror-ff is the sanctioned, worktree-safe mechanism (it never merges, runs strict
`--ff-only`, and needs no worktree guard).

## Post-creation catch-up

For the rest of this session's lifetime inside the new worktree, the harness's Bash-shape guard
stays in effect (see the "## 7. Shell constraint" pointer above) — default to one plain command
per call rather than rediscovering the boundary through refusals; see `docs/donts.md` for the
common mistake of assuming a specific editing idiom, rather than the command's shape, is what
gets refused.

Unconditionally, before anything else runs in the new worktree:

```bash
git fetch origin {integration-branch}
git merge origin/{integration-branch}
```

The `git fetch` above cites, rather than duplicates, what `bin/lib/reconcile`'s mirror-ff
check already does for the main checkout (#407/#408) — most call paths into worktree
creation (`session-start.js`, `dispatch/SKILL.md`'s queue pull, `tidy/scan-procedures.md`)
already ran `reconcile()` earlier in the same session, so `origin` is often already fresh
here. Run the fetch anyway — reconcile is best-effort and may have been skipped or
degraded (no remote, network failure) — but do not substitute reconcile for this step's
`git merge`: reconcile's mirror-ff only advances the *main checkout's* own
`{integration-branch}` ref, and never touches a worktree's own branch, which is exactly
what this merge does.

Resolve `{integration-branch}` via `skills/_shared/integration-branch.md`'s canonical ladder —
never hardcode `main`. Run this regardless of which creation path was used (`EnterWorktree`,
`git worktree add`, or any other), and regardless of whether the project has `worktree.baseRef`
configured correctly: the harness default is `fresh` (branches from `origin/<default-branch>`),
while claude-tweaks expects `head` (branches from current local HEAD) — see
`_shared/worktree-base-ref.md`. A worktree landing on the wrong default is an observed failure,
not a theoretical one (`[IL-106]`), and this fetch-then-merge is what makes the rest of any
calling procedure correct either way — never skipped, never conditioned on the creation path,
never assumed already-satisfied just because the worktree is brand new.

**Also catch up the other direction, when the caller captured one.** The fetch+merge above only
protects the "worktree fell behind the integration branch" direction. If the branch the worktree
was meant to start from itself carries local-only commits not yet on `origin` (observed in
practice: `worktree.baseRef: fresh` has been seen to actually resolve against a stale *local*
default-branch ref rather than the freshly fetched `origin/<default-branch>` its own name
implies), those commits are silently absent from the new worktree with no signal — the same gap
the base-ref verification this section replaced used to catch, in that one direction. When the
calling procedure captured a pre-creation `EXPECTED_BASE` (`git rev-parse HEAD` on the branch the
worktree starts from, taken *before* creation), also run:

```bash
git merge {EXPECTED_BASE}
```

This is safe unconditionally: on a freshly created branch with no commits of its own,
`{EXPECTED_BASE}` and `origin/{integration-branch}` are either already ancestor-related (the
merge is a no-op) or have genuinely diverged, in which case this merge surfaces exactly the same
way any other conflict does (see below) — there is no case where running it loses information a
caller that captured `EXPECTED_BASE` would want kept. A caller with no `EXPECTED_BASE` to
capture (there was no "branch the worktree starts from" — e.g. a from-scratch scratch worktree)
skips this merge; the fetch+merge above still runs on its own.

On a merge conflict from either merge, resolve it per `_shared/git-discipline.md`'s Merge conflict
resolution — never reset or discard. A freshly created worktree has no local commits yet to
protect, so a conflict here means the new branch's starting point (the harness's chosen base)
actually disagrees with the integration branch's tip, or with the branch it was meant to start
from; read both sides and produce a merged result, or surface it to the user if genuinely
ambiguous. This is the one case where "unconditional" still needs a human/agent decision.

**Fail open on fetch/merge command failure**, distinctly from a conflict: no `origin` remote, no
network, or an integration branch that was never pushed all make `git fetch` exit non-zero before
any merge is attempted. Treat this the same way the Pre-flight divergence check treats an empty
`UPSTREAM` (below) — log it and proceed rather than blocking worktree setup on a check whose
purpose is staleness protection, not connectivity verification. A caller with `events.jsonl`
access logs the failure distinctly from a same-shaped successful no-op merge — a reader should be
able to tell "checked, clean" apart from "check didn't run," the same distinction `[IL-105]`'s
own repair-loop guidance asks for elsewhere in this plugin.

**Log the correction when it changes anything.** When either merge actually advances the
worktree's branch (`git rev-parse HEAD` differs before and after — not a no-op), the calling
procedure appends an entry to the run's `decisions.md` under its own heading:
`AUTO {time} — Post-creation catch-up: worktree branch advanced from {before short} to {after
short} ({N} commit(s) from {origin/{integration-branch} or EXPECTED_BASE}). Reversibility: high
(worktree has no other commits yet).` A no-op merge (branch tip unchanged) writes nothing — this
mirrors `multi-spec.md`'s own pre-flight verify sweep, which skips the ledger write on a clean
sweep rather than logging "nothing found."

## Pre-flight divergence check

Resolve the `branch-divergence-check` setting via
`node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-policy.js" branch-divergence-check`. When enabled,
compare against the **upstream of the current branch** (or the detected remote default), never a
hardcoded `main`:

A project that pins an integration branch names the expected fork point directly, replacing the
upstream-then-`origin/HEAD` guess. Only the *stated* ranks of `skills/_shared/integration-branch.md`
apply here — the policy read below, and any explicit argument or CLAUDE.md statement above it.
**That fragment's git-inference rank must not be used for this check:** it resolves a branch in
nearly every repo, which would shadow the `@{upstream}` fallback and make a worktree-creation
call site on a tracked feature branch compare against the wrong ref and warn about a divergence
that isn't there.
<!-- integration-branch-ranks: excludes=5 -->

```bash
# Integration branch when the project pins one, else the upstream of the current
# branch, else the remote default branch (origin/HEAD). Assigned and used in the
# same call — a fresh shell per Bash invocation means a value resolved elsewhere
# would arrive empty here, and an empty UPSTREAM silently skips the check.
INTEGRATION_BRANCH=$(node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-policy.js" --values integration-branch)
UPSTREAM="${INTEGRATION_BRANCH:+origin/$INTEGRATION_BRANCH}"
[ -n "$UPSTREAM" ] || UPSTREAM=$(git rev-parse --abbrev-ref --symbolic-full-name @{upstream} 2>/dev/null) \
  || UPSTREAM="origin/$(git symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null | sed 's@^origin/@@')"
git fetch "${UPSTREAM%%/*}" "${UPSTREAM#*/}" 2>/dev/null
ahead=$(git rev-list --count "HEAD..$UPSTREAM" 2>/dev/null)
```

If `ahead > 0`, surface the divergence (`git log --oneline HEAD..$UPSTREAM | head -5`) and call
`AskUserQuestion`:
- `question`: `"{UPSTREAM} is {N} commits ahead — how do you want to proceed?"`, `header`:
  `"Divergence"`, `multiSelect`: `false`
- Option 1 — `label`: `"Rebase first (Recommended)"`, `description`: `"Rebase onto {UPSTREAM}
  before continuing"`
- Option 2 — `label`: `"Continue anyway"`, `description`: `"Proceed as-is; add an ops ledger
  entry noting the divergence"`

In `auto` mode, automatically choose option 2 and add an `ops` ledger entry; also log:

```
AUTO {time} — pre-flight branch-divergence-check — {UPSTREAM} is {N} ahead. Continued and added ops ledger
entry. Reversibility: low (divergence persists).
```

Each caller states its own log/memo-stamp conventions around this block (e.g. `/flow`'s Step 2.5
stamps `MERGE_CHECK_PASSED`/`UPSTREAM_SHA` for `/build` to skip a redundant re-run — see
`flow/validation.md`) — this section owns only the check itself, not what a caller does with its
result.

## Anti-patterns

| Pattern | Why it fails |
|---|---|
| Using the Pre-flight divergence check's narrower resolution for Post-creation catch-up | A brand-new worktree's branch has no `@{upstream}` yet — the narrower resolution has nothing to fall back to and silently no-ops |
| Using Post-creation catch-up's full ladder for the Pre-flight divergence check | Git-inference shadows a tracked branch's real `@{upstream}`, producing false-positive divergence warnings on ordinary feature branches |
| Skipping Post-creation catch-up because `worktree.baseRef` is set correctly | The catch-up is unconditional precisely because the plugin cannot verify `baseRef` took effect through `EnterWorktree` — see `[IL-106]` |
| Restating either section's block in a caller skill instead of citing this file | Recreates the exact duplication this file exists to eliminate |
| Skipping the `{EXPECTED_BASE}` merge because the fetch+merge against origin "already caught the worktree up" | Origin-relative catch-up only protects the behind direction — a caller that never captures `EXPECTED_BASE` has no protection against locally-committed-but-unpushed work silently missing from the new worktree |
| Treating a fetch/merge command failure the same as a clean no-op in the log | Both look like "nothing happened" to a reader unless logged distinctly — see the fail-open note above |
