# Step 6 — Worktree Configuration (detailed procedure)

*Core Bootstrap step — order-dependent, so later steps may assume earlier ones completed; runs unconditionally and idempotently, acting only on missing state. Gated by `version-check.md` in this directory.*

`/claude-tweaks:build worktree` and `/claude-tweaks:flow worktree` use `/superpowers:using-git-worktrees` to create isolated workspaces. Two worktree conventions coexist by design, not by drift: the native-tool path (e.g. `EnterWorktree` → `.claude/worktrees/`, harness-owned — cleanup is the harness's job, not superpowers') and the git-fallback path (`git worktree add` per `using-git-worktrees` Step 1b, used only when no native tool exists → `.worktrees/` in the project root, superpowers-owned — this is the only directory `/superpowers:finishing-a-development-branch` cleans up). Neither supersedes the other. Anything that needs to detect a worktree should run `git worktree list` or check `GIT_DIR != GIT_COMMON` (see `bin/lib/hooks/worktree-detect.js`) rather than assume a fixed directory name.

1. Check if `.worktrees/` exists in the project root.
2. If it doesn't exist, create it and verify it's in `.gitignore` (suggest adding if not) — this keeps the git-fallback path ready even on projects that primarily use a native tool.
3. If a `.claude/worktrees/` directory exists, leave it alone — it belongs to the native tool's own harness-managed lifecycle, not superpowers'. Do not suggest migrating it into `.worktrees/`: doing so would relocate a live, harness-tracked worktree into the one path superpowers' own cleanup step will later remove, deleting it out from under the harness's bookkeeping.
4. **Base ref** — see `_shared/worktree-base-ref.md` for why this matters (shared with `build/worktree-setup.md`'s runtime verification of the same setting). Read `settings.json`; if `worktree.baseRef` is unset or `fresh`, surface:
   ```
   Worktree base ref is `{current value or 'unset (default: fresh)'}`. claude-tweaks branches from your current local HEAD — `fresh` can branch from a stale `origin/<default-branch>`. Set `worktree.baseRef: "head"`? (Y/n)
   ```
   **When `integration-branch` is set in `.claude-tweaks/policy.yml` and differs from the repo's GitHub default branch, this stops being a recommendation.** Under `fresh` every task forks from `origin/<GitHub default>` — the wrong branch by construction, on every single run. Say so explicitly rather than asking neutrally: `"This project's integration branch is '{integration}', but the GitHub default is '{default}'. With baseRef 'fresh', every worktree would branch from '{default}'. Setting it to 'head' is required for this project, not optional."` The plugin cannot set this itself — it lives in the harness's settings.json and `EnterWorktree` accepts no base-ref argument — so a declined offer leaves the hole open, with `/claude-tweaks:build`'s own base-ref verification as the only backstop.

   On yes, write `{ "worktree": { "baseRef": "head" } }` into `settings.json` (backup first, merge — don't clobber existing keys). In `auto` mode, set it without prompting and log the change.
5. **`worktree-always` policy** — check `.claude-tweaks/policy.yml` (repo root) for a `worktree-always:` line:

   | State found | Behavior |
   |---|---|
   | `worktree.always: true` (pre-#602 spelling, no `worktree-always:` line) | No-op — already enabled through the RENAMED_KEYS alias; do not re-ask. The Renamed key drift check (`update-mode.md`) offers the spelling migration separately. |
   | No `worktree-always:` line AND no `worktree.always:` line (no file, or file present without either key) | Ask the question below |
   | `worktree-always: true` | No-op — already enabled, skip silently |
   | `worktree-always: false` | Ask the question below (re-offer — matches Step 11/12/13's re-offer-on-decline convention) |
   | `worktree.always: false` (pre-#602 spelling, no `worktree-always:` line) | Ask the question below (re-offer — matches Step 11/12/13's re-offer-on-decline convention) |

   When asking, call `AskUserQuestion`:
   - `question`: `"Require an isolated git worktree for every file edit in this project?"`, `header`: `"Worktree policy"`, `multiSelect`: `false`
   - Option 1 — `label`: `"Yes — enforce worktree-always (Recommended)"`, `description`: `"Mechanically denies Edit/Write/NotebookEdit/git commit outside a linked worktree from the first prompt of every future session. Prevents concurrent sessions from colliding on the main checkout."`
   - Option 2 — `label`: `"No — allow direct edits in the main checkout"`, `description`: `"Leaves the main checkout open for direct edits. You can enable this later by re-running /init."`

   **Do not write `.claude-tweaks/policy.yml` here.** Record the answer (`true` for Option 1, `false` for Option 2 — write `false` explicitly rather than leaving the key absent, so the idempotency check above can detect "already asked, declined" on a future run) and carry it forward to the end of this `/init` invocation. Writing it immediately would deny this same run's own remaining direct-to-main-checkout `Edit`/`Write` calls — Steps 7-20 below. (Phase 9's own writes are unaffected by this policy either way: Phase 9 isolates itself in a scratch worktree unconditionally, regardless of what `worktree-always` says — see `../SKILL.md`'s "Phase 9: Present Summary and Confirm.") See `../SKILL.md`'s "Finalizing the worktree-always Decision" for the general rule governing where the write actually happens — normally at Phase 9 ("Worktree Policy Finalization"), but at whatever point this invocation actually ends if that happens first (examples: the `bootstrap`-only scope, or the Scope Selection Gate's "Done" choices). Wherever it lands, that write itself is also made via the scratch-worktree procedure, not a direct main-checkout `Edit` — see `worktree-policy-finalization.md`.
