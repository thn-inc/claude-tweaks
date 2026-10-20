# Step 9 — Establish GitHub Remote (detailed procedure)

*Optional Enhancement step — see `../SKILL.md`'s `## Input` for when this group is offered or filtered, and `../bootstrap-steps.md` for its ordering and renumbering conventions.*

Interactive-only. This step never runs under `auto`/non-interactive mode — creating a GitHub repository is a consequential, externally-visible, hard-to-reverse action, the same class of action `_shared/browser-detection.md` already bars from unattended auto-install. In `auto` mode, skip this step entirely; every downstream step falls through to its own existing gate-fails behavior unchanged.

**Gate:** `git rev-parse --is-inside-work-tree` fails → this step doesn't run at all (nothing to attach a remote to; `step-05-verify-git.md` already handles warning about a non-git directory). Otherwise, `git remote get-url origin` fails (no remote configured at all) → proceed with this step. Any existing remote — GitHub or not — skips this step silently; the user has already chosen a host.

Steps 10/14/16/17 independently check for a *reachable GitHub-flavored remote* specifically (not just any remote) via a related, richer two-tier check: `gh repo view --json owner,name` succeeding when `gh` is available and authenticated (works for GitHub Enterprise, not just github.com), else `git remote get-url origin` exits 0 as a fallback heuristic — a non-GitHub git host would simply see those steps' offers and decline them, which costs nothing. This step's own gate above is intentionally simpler and broader: it doesn't try to distinguish GitHub from other hosts, since creating a repo is only relevant when there is truly no remote configured yet.

**1. Ensure `gh` is ready.**

Check `gh --version`. If missing, detect the platform's package manager the same way `step-08-statusline-and-dependencies.md` does:

| Platform | Detect | Install command |
|---|---|---|
| macOS | `brew --version` | `brew install gh` |
| Windows | `winget --version` or `scoop --version` | `winget install --id GitHub.cli` or `scoop install gh` |
| Linux | `apt --version` / `dnf --version` / `pacman --version` | Print GitHub's own official Linux install instructions (https://github.com/cli/cli/blob/trunk/docs/install_linux.md) rather than a single `apt install gh` line — most distros don't ship `gh` in default repos and require adding GitHub's own package repository first; `pacman -S github-cli` is the one exception that installs directly |

Call `AskUserQuestion`:

- `question`: `"gh CLI not found — needed to create a GitHub repository. Install it now?"`, `header`: `"Install gh CLI"`, `multiSelect`: `false`
- Option 1 — `label`: `"Install gh CLI (Recommended)"`, `description`: `"Runs {the detected install command} via Bash."`
- Option 2 — `label`: `"Skip"`, `description`: `"Don't set up a GitHub remote this run."`

On macOS/Windows (no `sudo` needed), run the install command directly via Bash on accept, then re-verify with `gh --version`. On Linux, print the official install instructions instead of running anything — matching Step 8's existing "we don't run sudo from init" rule — and wait for the user to confirm they've run it, then re-verify. If installation fails, or no package manager is detected on a platform other than Linux, abort this step gracefully: proceed to whatever this invocation runs next (Steps 10/14/16/17 take their existing gate-fails paths).

Check `gh auth status`. If not authenticated, explain that this requires a one-time browser step, then run `gh auth login --web` and wait for the user to complete the device-flow authorization in their browser. Re-verify with `gh auth status` afterward. A user who declines, or an auth flow that doesn't complete, aborts this step gracefully the same way.

**2. Offer to create the repo.** Call `AskUserQuestion`:

- `question`: `"No GitHub remote found for this project. Create one now?"`, `header`: `"Create GitHub repo"`, `multiSelect`: `false`
- Option 1 — `label`: `"Create a GitHub repo (Recommended)"`, `description`: `"Set up a new GitHub repository and link it as origin."`
- Option 2 — `label`: `"Skip"`, `description`: `"Don't set up a GitHub remote this run."`

Declining falls through to existing behavior unchanged — Steps 10/14/16/17 each take their own gate-fails path.

**3. Choose owner.** Resolve the personal account (`gh api user --jq .login`) and the user's orgs (`gh api user/orgs --jq '.[].login'`). Call `AskUserQuestion`:

- `question`: `"Create the repo under your personal account or an organization?"`, `header`: `"Repo owner"`, `multiSelect`: `false`
- Option 1 — `label`: `"{personal account} (Recommended)"`, `description`: `"Create under your personal account."`
- Option 2..4 — one per org, up to 3, `label`: `"{org login}"`, `description`: `"Create under this organization."`

With zero orgs, Option 1 (the personal account) is the only explicit option — that's fine. `Other` is a built-in free-text field on every `AskUserQuestion` call regardless of how many explicit options are listed, so it satisfies the tool's requirements without a synthetic second option, and it doubles as the escape hatch for any org beyond the first 3 or any org not listed.

**4. Confirm name.** Default = the git top-level directory's basename (`git rev-parse --show-toplevel`), lowercased, with any run of characters outside `[a-z0-9-]` replaced by a single `-`, trimmed of leading/trailing `-` (GitHub repo naming rules). Present the default and let the user override it in the same exchange rather than a separate round-trip.

**5. Choose visibility.** Call `AskUserQuestion`:

- `question`: `"Repository visibility?"`, `header`: `"Visibility"`, `multiSelect`: `false`
- Option 1 — `label`: `"Private (Recommended)"`, `description`: `"Only you (and anyone you invite) can see it."`
- Option 2 — `label`: `"Public"`, `description`: `"Anyone can see it."`

**6. Final confirmation.** One explicit summary confirm before executing — covers the whole create+link+push action, not a re-ask of sub-steps 3-5:

- `question`: `"Create github.com/{owner}/{name} ({visibility}) and set it as origin{push_clause}?"`, `header`: `"Confirm"`, `multiSelect`: `false` (`{push_clause}` = `", pushing the current branch"` when `git rev-parse HEAD` succeeds, else empty string — matching the same commit-existence check the Execute step below uses for `$PUSH_FLAG`)
- Option 1 — `label`: `"Yes — create it (Recommended)"`, `description`: `"Runs gh repo create with --source=. --remote=origin."`
- Option 2 — `label`: `"Cancel"`, `description`: `"Don't create anything."`

**7. Execute.**

```bash
git rev-parse HEAD >/dev/null 2>&1 && PUSH_FLAG="--push" || PUSH_FLAG=""
gh repo create "{owner}/{name}" --{private|public} --source=. --remote=origin $PUSH_FLAG
```

`--push` is included only when the current branch already has at least one commit — an empty repo has nothing to push yet. On a name collision, report it and return to sub-step 4 (pick a different name); on a permission error (the chosen owner rejects the create), report it and return to sub-step 3 (pick a different owner) — neither aborts the whole step.

**8. Downstream effect.** Once the remote exists, Steps 10/14/16/17 see it via their own existing two-tier check (documented above) and take their already-documented enriched paths — no further action needed here.

**Failure handling summary:**

| Condition | Behavior |
|---|---|
| Not a git repo at all | This step doesn't run (nothing to attach a remote to) |
| A remote already exists (any host) | This step doesn't run |
| User declines install / auth / create | Clean fallback to existing behavior, nothing partially applied |
| `gh` install fails / no package manager detected (non-Linux) | Abort gracefully, same fallback |
| `gh auth login` doesn't complete | Abort gracefully, same fallback |
| Repo name collision | Re-prompt for a different name (sub-step 4), not a hard failure |
| Permission error on creation | Re-prompt for a different owner (sub-step 3), not a hard failure |
