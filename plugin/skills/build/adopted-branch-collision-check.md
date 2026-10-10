# Adopted-Branch Remote Collision Check (#2844)

Referenced by `build/worktree-setup.md`'s skip-creation guard — read only when Common Step 1 skips
worktree creation because the run is already inside one (a dispatched group, a multi-spec shared
worktree, an adopted session worktree), under `integration-model: pr-first`
(`_shared/integration-model.md`). Kept out of that file
to stay under the composed-bytes ceiling at its call site (`context-cost.test.js`'s
`worktree-setup @ build/SKILL.md` bundle).

The adopt-path counterpart of Step 1.6 (Remote-only stale branch check). Step 1.6 runs before
`EnterWorktree` and is skipped with the rest of Steps 1-3 when no worktree is created, so an
adopted branch reaches `_shared/pr-early-run-lifecycle.md`'s push with nothing having checked
whether `origin` already carries an unrelated branch of the same name.

**When:** after Step 4.5 (record the assignment), before Spec Step 1's materialize commit. Runs on
every build that takes the skip path, including a resumed one and records 2..N of a multi-spec run.

**Why not Step 1.6's rule as written.** Step 1.6 can treat any remote ref as a collision because
its precondition is that no local branch of that name exists yet. Here the local branch exists and
may legitimately already be on `origin` — this run's own earlier push. The distinction is ancestry:
a remote tip contained in local `HEAD` is this branch's own history and the push fast-forwards it;
a remote tip not contained in `HEAD` would reject the push.

**Procedure**, via `plugin/bin/lib/worktree/remote-branch-collision.js`'s
`classifyRemoteBranch({ branch })` (unit-tested,
`tests/bin-lib/worktree/remote-branch-collision.test.js`), with `{branch}` the adopted worktree's
actual current branch (`git branch --show-current`) — never a name this run would have minted.
Run it from the worktree as one command — the module has no CLI of its own, and a hand-rolled
multi-line `node -e` silently no-ops on Windows Git Bash (`bin/node-eval-file.js`'s header), which
would read as a clean result:
The heredoc delimiter is unquoted so `${CLAUDE_PLUGIN_ROOT}` expands — keep the body free of any other `$` or unescaped backtick, per `bin/node-eval-file.js`'s header.
```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/node-eval-file.js" "$(git branch --show-current)" "$(gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null)" <<NODE_EVAL_EOF
const m = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/worktree/remote-branch-collision.js');
const [branch, repo] = process.argv.slice(1);
const r = m.classifyRemoteBranch({ branch });
const out = { state: r.state, reason: r.reason || null, remoteSha: r.remoteSha || null };
if (r.state === 'foreign' || (r.state === 'unreachable' && r.remoteSha)) {
  const reason = r.state === 'foreign' ? null : r.reason;
  out.card = m.formatStopCard({ branch, remoteSha: r.remoteSha, prLookup: repo ? m.findPrsForBranch({ branch, repo }) : null, reason });
}
console.log(JSON.stringify(out));
NODE_EVAL_EOF
```

It prints one JSON line. No output, or output that does not parse, is not a result: re-run once,
then treat it as `unreachable` with reason `no-output` (item 3). Branch on `state`:

1. `absent` — no such branch on `origin`. Nothing to do; the push creates it.
2. `mine` — `origin`'s tip is an ancestor of `HEAD`: this run's own earlier push (a resumed build,
   or a later record of the same multi-spec run). Nothing to do; never stop on this.
3. `unreachable` — could not determine. Log the degrade with its `reason` verbatim, never treat
   "could not look" as `absent`, then branch on `remoteSha`:
   - **`remoteSha` null** (`ls-remote-failed` — no network, no `origin` — or `no-output`):
     **fail open**, Step 1.6's own posture, and proceed. `invalid-branch-name` with an empty
     branch means a detached `HEAD`, not a network fault — log it as such; there is no branch for
     the push to collide with.
   - **`remoteSha` set** (`fetch-failed`, `ancestry-check-failed`): `origin` is confirmed to carry
     the branch, only its relation to `HEAD` is unknown, and proceeding would reproduce the
     rejected-push, local-only run this check exists to prevent. Stop as for `foreign` (item 4) —
     the command prints this case's `card` too, stating that the relation could not be determined
     (`{reason}`) rather than that the commit is not in this worktree's history.
4. `foreign` — `origin`'s tip is not in `HEAD`'s history: a same-name branch left by an unrelated
   run. Gather PR context, best-effort, via `findPrsForBranch({ branch, repo })` (a failed lookup
   renders as PR status unknown, distinct from a confirmed no-PR result), then render the stop
   card (`formatStopCard` — the command above prints it as `card`, for this case and item 3's):

   ```markdown
   ## Build: Adopted branch collides with an unrelated branch on origin

   `{branch}` already exists on `origin` at `{sha}`, and that commit is not in this worktree's
   history — {closed PR #{number} ({url}) | no PR found for it | PR status unknown (lookup
   failed)}. Pushing this branch would be rejected non-fast-forward.

   Options: (1) rename this worktree's local branch (`git branch -m {branch}-{suffix}`) and
   re-run, (2) delete the stale remote branch (`git push origin --delete {branch}`) and re-run,
   (3) stop and resume the existing remote branch/PR instead.
   ```

   **Interactive mode:** `AskUserQuestion` with these three options, recommending (1) — it touches
   only this worktree's own local ref.
   **Auto mode:** same posture as Step 1.6 — this is **not** a lever
   `_shared/auto-mode-contract.md` lists as silenceable (the remote branch may belong to someone
   else's live work, and a rename changes the branch a session adopted from unrelated prior work).
   Render the card and **stop the build** before the materialize commit — a registered HARD-GATE
   (`_shared/auto-mode-contract.md`'s HARD-GATE / BLOCKED / STOP row), the same posture
   `flow/claim-targets.md` uses for a claim contest. Never let it degrade to a failed push and a
   local-only run.

**Out of scope:** the creation path (Step 1.6 owns it), and cleaning up stale remote branches a
failed attempt leaves behind — this check reports the collision, it does not delete anything.
