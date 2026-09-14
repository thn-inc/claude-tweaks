---
files:
  - plugin/bin/release-local.js
  - plugin/bin/lib/release-local/commits.js
  - plugin/bin/lib/release-local/bump.js
  - plugin/bin/lib/release-local/manifest.js
  - plugin/bin/lib/release-local/changelog.js
  - plugin/bin/lib/release/precheck.js
  - plugin/bin/lib/release/run.js
---

# Cut a Release Without a Forge

**Persona:** Maintainer of a Rust CLI whose repository lives on a self-hosted bare remote with no pull requests (`integration-model: local-merge`), who has been hand-editing `Cargo.toml` and a CHANGELOG before every tag and wants the release-please shape without release-please — and who has already run `/claude-tweaks:init` so `release-please-config.json` and `.release-please-manifest.json` exist.
**Goal:** One command turns the conventional commits merged since the last tag into the right semver bump, a CHANGELOG section indistinguishable from release-please's, a `chore(release): vX.Y.Z` commit, an annotated tag, a push, and the project's own publish hook — or a precise refusal that says why nothing happened.
**Entry point:** `node plugin/bin/release-local.js --dry-run` on the integration branch with a clean tree.
**Success state:** `git describe --contains HEAD` names the new tag; `Cargo.toml` and `.release-please-manifest.json` differ from the previous commit in exactly one token each; `CHANGELOG.md` opens with `## [1.3.0](…/compare/v1.2.0...v1.3.0) (date)` when `origin` is GitHub, or `## 1.3.0 (date)` otherwise; the hook ran once; the exit code is `0`.

## Steps

### 1. Preview the release — `--dry-run`
- **URL:** `node plugin/bin/release-local.js --dry-run`
- **Action:** Runs the branch and clean-tree guard, reads first-parent commits since the last `v*` tag, derives the bump, runs the collision pre-check against sibling worktrees and plan documents, and prints the plan: the proposed version and part, counts of feat/fix/breaking, the hook that will run, the manifest files that will change, any `unconventional` subjects, and the exact CHANGELOG section.
- **Should feel:** Trustworthy — what is printed is what a live run writes, byte for byte, and nothing on disk moved.
- **Should understand:** `--first-parent` means a `--no-ff` merge counts once, with the composer-written subject; branch-internal commits never reach the changelog. An `unconventional` line is a signal that someone bypassed the merge-time composer, not a formatting nit.
- **Red flags:** A plan that silently omits a commit; a "manifest: none" line on a repo that has a stack manifest; the preview and the later live output differing.

### 2. Nothing to release — exit `3`
- **URL:** the same command on a history of only `chore:`/`docs:` commits
- **Action:** The engine reports `nothing to release: N commit(s) since vX.Y.Z, none feat/fix/breaking` and exits `3` without touching a file.
- **Should feel:** Calm — a non-event, not an error; the shell script wrapping it can branch on `3` and move on.
- **Should understand:** Precedence is breaking → major, feat → minor, fix → patch; anything else never bumps, on a first release too.
- **Red flags:** A `0.0.1` bump from a `chore:`-only history; a manifest edit left behind.

### 3. Land it — the live run
- **URL:** `node plugin/bin/release-local.js`
- **Action:** The manifest token(s) and the CHANGELOG are spliced, one `chore(release): v1.3.0` commit lands, `v1.3.0` is created as an annotated tag, the branch and the tag are pushed after a fetch-and-ancestry re-check, and the `release-hook` policy command runs. The last line reads `released v1.3.0`.
- **Should feel:** Like release-please did it — the same tag scheme, the same CHANGELOG grammar, the same manifest handling — so the history has no format seam if the project later moves to `pr-first`.
- **Should understand:** The tag is the version of record; the manifest follows it. A `manifest-drift` line in the plan means the manifest had wandered away from the last tag and the tag won.
- **Red flags:** A reformatted `Cargo.toml` (keys reordered, indentation changed) — only the version token may differ; a CHANGELOG bullet carrying a PR link under local-merge; a lightweight tag.

### 4. Something failed part-way — a named partial state
- **URL:** any non-zero exit after Step 3 began writing
- **Action:** The engine names exactly what landed and what to run next, on stderr: edits on disk but not committed (`git restore --staged --worktree -- <the edited files>`, plus `rm <file>` for any file the run created), commit landed but no tag (`git tag -a …`), tagged but not pushed (`git fetch origin main && git rebase origin/main && git tag -f -a v1.3.0 -m v1.3.0 && git push origin main && git push --force origin v1.3.0` — or a plain `git push origin main v1.3.0` when this was the branch's first push), or — exit `5` — everything landed and only the hook failed (`re-run the hook alone: <command>`). Exit `4` is a collision (a sibling worktree or a plan already claims the number) and names the claimant with a suggested renumber.
- **Should feel:** Recoverable — every message says "do NOT re-run release-local" and hands over the one command that finishes the job.
- **Should understand:** Re-running blind after a partial state would bump a second time; the exit code alone tells a wrapper script whether git is done (`5`) or not (`1`).
- **Red flags:** A bare stack trace; a recovery command listing files that were never edited; "NOT pushed" on a repo with no `origin`.

## Origin
- Created during build of #2254 (record: The local engine `bin/release-local.js`)
- Steps 1-4 built in this session
- Related specs: #2253 (Step 21 bootstrap writes the config this engine reads), #2255 (the `/claude-tweaks:release` skill that fronts this CLI), #2250 (design)
