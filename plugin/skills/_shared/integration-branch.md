# Integration Branch — Canonical Resolution

The branch where finished work lands and new work starts. Canonical for every consumer that needs to know which branch represents this project's current state — read it, start from it, add to it, or compare against it.

## Why this exists

GitHub's default-branch pointer is a *display* fact: which branch the repo opens on, and where issue auto-closing works. On a `dev` → `staging` → `main` model it is not where development happens. Four sites in this plugin used to resolve that pointer independently, and each failed differently — one aborted, one silently measured a change against a tree that diverged 102 commits ago (#132, #61). Stating the branch once, here, is what keeps them from drifting apart again.

## Resolution ladder

Take the **first** source that yields a branch name; once one does, the rest are not consulted.

1. **An explicit argument** — `/claude-tweaks:routine`'s `--branch <name>`. Non-empty is the only check.

   `/claude-tweaks:assess-agent-autonomy`'s `--base <ref>` is **not** a rank of this ladder: it names an already-known merge-base *commit*, not a branch, and a caller that passes it short-circuits before this ladder is consulted at all. It is listed here only so the two are not confused — every rank below yields a branch name.
2. **`skills/{skill}/routine-template.yml`'s `branch:` field** — routine instantiation only; no other consumer has a template. Normally unset (see `_shared/routine-template-schema.md`).
3. **A flat `integration-branch:` line in `.claude-tweaks/policy.yml`:**

   ```bash
   INTEGRATION_BRANCH=$(node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-policy.js" --values integration-branch)
   ```

   The resolver strips a trailing inline comment from the value — this value is pasted into checkout and merge-base commands, where a trailing `# note` would become part of the branch name. An unset key prints an empty line, which falls through to rank 4.
4. **A branching model stated unambiguously in CLAUDE.md prose** — "development happens on `dev`", "branch from `dev`, PR into `dev`". A section that merely *names* several branches, or describes a release train without saying where work lands, resolves nothing: fall through to 5 rather than guessing which name is the one. (This reads project *documentation*, not configuration — it is not a config-key lookup and is unaffected by policy.yml being the sole config home.)
5. **Git — the current branch, checked against the GitHub default:** as three separate
   single-command Bash calls (`_shared/worktree-setup.md`'s "## 7. Shell constraint" applies here
   too whenever this rank is resolved from inside an isolated worktree) — never combine any of
   these with each other, or with a `$(...)` substitution feeding a git command, in one call:

   ```bash
   node -e "const { repoInfo } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/hooks/worktree-detect.js'); console.log(repoInfo(process.cwd()).isLinkedWorktree ? 'WORKTREE' : 'PRIMARY')"
   ```

   ```bash
   git branch --show-current
   ```

   ```bash
   gh repo view --json defaultBranchRef -q .defaultBranchRef.name
   ```

   Read the printed name directly. If that command errors or prints nothing (no `gh`, or
   offline), fall back to a second, separate call rather than an inline `||`:

   ```bash
   git remote show origin
   ```

   and read the value off its own `HEAD branch: {name}` output line.

   - **Discard the current branch when it isn't a real one.** If the first command prints `WORKTREE`, this session is inside a linked worktree, so `git branch --show-current` is a throwaway isolation branch that will not exist later — never propose it. Fall through to the GitHub default alone and say so wherever the choice is surfaced. Same worktree detection `[IL-61]` requires, for the same reason: under `worktree-always` the obvious git question answers about the worktree, not the project.
   - Both resolve and **match** → use it.
   - Both resolve and **differ** → do not assume silently. Propose the **current** branch where a human will see it, keeping both values in hand; where no human will (`--defaults`, a headless firing), fall back to the **GitHub default** and print the mismatch without stopping. Never silently pin a branch nobody confirmed.
   - Only one resolves → use that one.
6. **Nothing resolved** → the consumer's own fallback below.

Record which source won — consumers that surface a preview name it.

## Per-consumer fallback

Rank 6 is deliberately per-consumer, because they degrade differently. In every case the unresolved path reproduces the behavior that consumer had before this fragment existed, so a project that sets nothing sees no change.

| Consumer | Uses it for | Fallback when nothing resolved |
|---|---|---|
| `/claude-tweaks:routine` | Substituting `{{TARGET_BRANCH}}` into a routine's prompt | Prose telling the cloud agent to resolve the branch itself at firing time |
| `/claude-tweaks:routine` (record freshness) | Which branch `.claude-tweaks/routines/*.yml` is compared against before CREATE/UPDATE/STATUS read it (`routine/record-freshness.md`, #190) | Skip the comparison, report it unverified, proceed on the working checkout — the pre-#190 behavior, so an offline session is never blocked |
| `/claude-tweaks:dispatch`, `/claude-tweaks:wrap-up` | Merge target and push target | `git remote show origin` / `gh api default_branch`, as today |
| `bin/lib/release-preflight/pack.js` (`/claude-tweaks:release` Step 1 fact pack) | Release-target branch and tip ref | `git symbolic-ref --short refs/remotes/origin/HEAD`, then `git remote show origin`'s "HEAD branch:" line; unresolved degrades the whole pack (ruling 13's preamble-failure envelope) rather than guessing `'main'` (#2422) |
| `/claude-tweaks:assess-agent-autonomy` | `merge-base` for blast radius | `gh api default_branch`, as today; an unresolvable value is already the documented `needs-human` inconclusive-read case |
| `/claude-tweaks:build`, `/claude-tweaks:flow` | Expected fork point | Upstream of the current branch, else `origin/HEAD`, as today |
| `SessionStart` worktree reaper (`bin/lib/hooks/session-start.js` → `bin/lib/hooks/worktree-reap.js`) — the one non-skill consumer | The branch a finished worktree's content must already be in before the worktree is removed | **Reap nothing.** Only rank 3 and rank 5's *GitHub-default* half are available to it: a hook has no explicit argument, no routine template, and no reader for rank 4's prose, and rank 5's *current-branch* half is excluded outright by the anti-pattern below. Nothing resolved means no safe measurement, and here the consequence of measuring against a guess is a deletion rather than a warning — a probe removed a worktree holding genuinely unmerged work purely because the main checkout had been switched underfoot |
| `SessionStart` run-integrity check (`bin/lib/hooks/session-start.js` → `bin/lib/hooks/run-integrity.js`) | The branch a run's recorded worktree must be merged into before the run is flagged `shipped-unclosed` | **Flag nothing** (every run reads `in-progress`). Same rank restriction as the reaper row above — rank 3 and rank 5's GitHub-default half only, current-branch half excluded — via the same shared resolver (`worktree-reap.js`'s `resolveIntegrationBranch`). Nothing resolved means no safe measurement; here a wrong measurement is one misleading advisory line, but the fail-open direction is kept identical to the reaper's for the same anti-pattern reasons |

## Anti-Patterns

| Pattern | Why It Fails |
|---------|--------------|
| Resolving the GitHub default branch inline instead of citing this file | That is exactly how four sites came to answer one question four different ways, with nothing objecting. `tests/integration-branch-conformance.test.js` fails on a new un-cited resolver |
| Using the branch the main checkout currently has checked out | A concurrent session switches it underfoot — the reason `/claude-tweaks:dispatch`'s merge guard exists at all, and why the `SessionStart` reaper reaps nothing rather than falling back to it |
| Pinning the current branch inside a linked worktree | It is a throwaway isolation branch; it will not exist when a routine fires or a later run merges |
| Treating rank 4's CLAUDE.md read as a config-key lookup | It reads prose describing a branching model, not a `key: value` line. Design B's policy.yml consolidation does not remove it |
| Widening a shared resolver's return-value contract (e.g., a bare branch name -> a possibly `origin/`-prefixed ref) for the sake of one new caller, without grepping every existing consumer for a same-shape assumption (string equality, refspec construction) | #1688's `preferRemoteTrackingRef` upgrade, applied inside `resolveIntegrationBranch` itself, broke the bare-name assumption in 4 unaudited callers (`post-tool-use.js`, `teardown-run.js`, `merge-verification.js`, `reconcile/index.js` + its sub-modules) — silently disabling a worktree-staleness check, an integration-branch delete-protection guard, and downgrading merge-verification. `run-integrity.js`'s `checkRunIntegrity` was a 5th, missed until #1861: its self-ancestor guard needed the bare form, but — unlike the other four, which only ever needed the bare name for equality/string-building — it also feeds the value straight into a real `merge-base --is-ancestor`/`cherry` ancestor computation, which benefits from the origin/-prefixed freshness the other four never used. Normalizing the whole value (as the other four correctly do) would have traded one bug for a staleness regression in the ancestor check; the fix scopes `bareIntegrationName` to the guard's comparison only, leaving the value passed to the git commands unchanged. The new caller should normalize at its own call site instead, exactly as `pre-tool-use.js`'s `hasMaterializeCommit` already does independently via its own explicit `preferRemoteTrackingRef` call — and should audit which of its own uses need the bare form versus the fresher original, not assume every use needs the same one |
