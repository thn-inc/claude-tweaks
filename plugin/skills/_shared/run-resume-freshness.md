# Run Resume Freshness Probe — Shared

A hard precondition before any of the three resume paths below rules a run safe to re-enter.
Read by `wrap-up/SKILL.md`'s `resume` command, `dispatch/SKILL.md`'s "Resuming a parked run"
section, and `flow/steps-and-gates.md`'s "Adopting an inherited run directory" case 1.

## What `status: interrupted` means — and does not mean

`run-state.json`'s `status: interrupted` stamp (`bin/lib/hooks/session-end.js`) is a statement
about **one past session**: the session that owned this run ended (crashed, closed, or timed
out) while the run was still non-`clean`. It is explicitly **not** a statement that no session
owns this run *now* — a different session can be actively committing to the same worktree at the
exact moment a resume path reads the stamp and rules it safe. On 2026-08-16, run
2026-08-16T174412 read `interrupted` while a live sibling session was actively committing to its
shared worktree; the misjudgment was caught only by an incidental glance at fresh commit
timestamps, not by any gate (#676).

**This stamp never fires on a normal Task-tool subagent turn end** — only on a real `SessionEnd`
(`bin/lib/hooks/session-end.js`; a `SubagentStop` never touches `run-state.json`). This is why
`/claude-tweaks:dispatch`'s two-call handoff (`build,test` then `review,polish,wrap-up` against
the same `PIPELINE_RUN_DIR`, both under the dispatching session's own `CLAUDE_CODE_SESSION_ID`, which Task subagents share) never trips
this probe: between the two calls the top-level dispatching session never ends, so `status` stays
`active` throughout, and the probe below short-circuits to safe on its very first status check.

## The probe

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/hooks.js" check-resume-freshness --run "{run-dir}"
```

Read-only — never writes `run-state.json`. Reads `run-state.json`'s `status`, `sessionId`, and
`worktree` fields and checks, in order:

1. **Own session** — `sessionId` already matches this call's own `CLAUDE_CODE_SESSION_ID`. Safe
   unconditionally (a session restart re-stamps ownership via `record-worktree`; this probe must
   never block a run's own continuing session from itself).
2. **Not `interrupted`** — any other status (`active`, `clean`, missing) is out of scope for this
   probe; safe.
3. **No recorded worktree, or the recorded worktree no longer exists on disk** — nothing to
   probe; safe.
4. **Worktree lock** — `bin/lib/run-liveness`'s `worktree-lock` evidence entry, read through
   `blocksResume` (only that entry and `last-commit` can block a resume; the owner-pid, heartbeat
   and owner-events entries never do). A live pid holding the worktree lock blocks (`locked`) —
   "run appears actively owned". An orphaned lock (its pid is dead) is not a blocker. An
   **unknown** lock (a `git worktree lock` reason that carries no pid), a worktree git does not
   list, an unresolvable main-checkout root, or a failed `git worktree list` fails **closed** to
   `indeterminate`, never a false "not locked".
5. **Last-commit age** — `run-liveness`'s `last-commit` evidence entry (`git -C {worktree} log -1
   --format=%ct`), read through `blocksResume` against a 10-minute threshold
   (`run-liveness/constants.js`'s `LIVE_WINDOW_MS`; "on the order of minutes" — long enough that
   one working session's normal commit cadence does not read as a stranger, short enough that a
   genuinely dead run isn't gated for an unreasonable stretch; see
   `bin/lib/hooks/resume-freshness.js`'s own header comment for the full rationale). A commit
   inside the threshold blocks (`recent-commit`). A failed `git log`, an unparseable time, or no
   commits at all (an empty log or unborn HEAD) fails **closed** to `indeterminate`.
6. Otherwise: safe (`stale`) — the run is genuinely quiet.

A lock or last-commit probe that could not answer at step 4 or step 5 (while status is genuinely
`interrupted`) fails **closed** — blocked (`indeterminate`), not safe-by-default.

## Branching on the result

The command writes exactly one line to stdout, and always exits `0`:

- Safe: `claude-tweaks: resume freshness OK for {run-id} ({verdict})` — proceed with the resume
  exactly as before this probe existed.
- Blocked: `claude-tweaks: resume freshness BLOCKED for {run-id} — run appears actively owned
  ({reason})` — **do not proceed.** Report the line verbatim instead of the resume's normal
  outcome, and stop; do not fall through to conversation-based work.

**When the verdict is `stale`** (the only safe verdict that means the run genuinely was
`interrupted` and is now confirmed quiet — `no-state`, `no-worktree`, and `worktree-gone` are also
safe, but mean there was nothing to probe in the first place, never that an `interrupted` run was
cleared): immediately reclaim ownership so the stale stamp does not linger and a later re-entry
within the same session is not re-probed for no reason:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/hooks.js" record-worktree --run "{run-dir}" "{worktree-path}"
```

This is the same idempotent restamp `build/worktree-setup.md` already documents for "a different
session later continues this pipeline" — it flips `status` back to `active` under the current
session's identity, which is also what makes the "Own session" fast path above correct for any
further probing inside the same now-resumed run.

## Staged inventory reconciliation (non-blocking companion check, #1269)

Run alongside `check-resume-freshness` at every call site that cites this file, not as a
replacement for it:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/hooks.js" check-staged-inventory --run "{run-dir}"
```

Parses every `STAGED ... Stage path: staged/{name}` line in this run's `decisions.md` and checks
whether the named file actually exists under `staged/` — catching the case where a session
crashed between `log-decision.js`'s write of the `decisions.md` line and `stage-item.js`'s write
of the actual staged file, leaving `decisions.md` claiming a proposal exists that was never
written.

**Never blocks the resume.** Unlike `check-resume-freshness`'s `OK`/`BLOCKED` verdict, this
command always exits `0` and its result never stops a resume from proceeding — it only surfaces
what it found:

- `claude-tweaks: staged inventory OK for {run-id} ({N} STAGED entries)` — every named `staged/`
  destination exists (or there are none). Proceed silently.
- `claude-tweaks: staged inventory MISMATCH for {run-id} — {N} of {M} STAGED entries missing from
  staged/: {paths}` — report this line verbatim alongside the resume's normal outcome so a human
  or agent re-deriving the missing proposal(s) from `decisions.md`'s prose knows to do so, rather
  than assuming `staged/` is complete.

## When blocked

A `BLOCKED` result stops the resume; it does not mean the run is unrecoverable.

- **`recent-commit`**: the recorded worktree committed inside the last 10 minutes. Wait past the
  threshold and re-run the probe — the age keeps advancing regardless of which session is asking,
  so this also resolves the common case of a session that crashed moments after its own last
  commit.
- **`locked`**: a live process holds the worktree lock. This is usually a genuine sibling session,
  but if this resume path itself just entered the worktree (e.g. via `EnterWorktree`) before
  probing, the lock the probe sees can be this session's own fresh entry rather than a stranger's
  — a lock alone cannot distinguish the two. Confirm first, don't assume: run
  `node "${CLAUDE_PLUGIN_ROOT}/bin/hooks.js" check-sibling-sessions --record "{record-number}"`
  (when this run corresponds to a claimed record) or otherwise verify with the human that no other
  session is working this run. A `live claim by run {run-id}` line naming this run's own run id
  is the interrupted session's claim on this same run, not a sibling — treat it as clear; any
  other run id is a genuine sibling. Once confirmed clear, claim ownership explicitly —
  `node "${CLAUDE_PLUGIN_ROOT}/bin/hooks.js" record-worktree --run "{run-dir}" "{worktree-path}"`
  — which stamps this session as owner, so the next probe call returns `own-session`.
- **`indeterminate`**: the probe could not resolve the worktree's lock state or its last-commit
  timestamp. Investigate directly (`git -C "{worktree-path}" worktree list --porcelain`, `git -C
  "{worktree-path}" log -1`) rather than retrying blindly — this verdict means the check itself
  failed, not that the run is busy. An **unknown lock** is the commonest cause: a worktree locked
  with a plain `git worktree lock --reason "..."` carries no pid, so the probe cannot tell whether
  anything still holds it. Confirm nothing does, then clear it (`git worktree unlock
  "{worktree-path}"`) or claim the run (`record-worktree`, as under `locked` above). The `reason`
  names the cause; two others are a recorded worktree path that is a regular file rather than a
  directory, and a `run-state.json` that cannot be read as a JSON object (`unreadable-run-state`) —
  fix the path or the file, then rerun.

Never bypass a `BLOCKED` result by skipping the probe on a later attempt — always re-run it after
taking one of the actions above, and only proceed once it reports `OK`.

## What this does not gate

- **The claim blob's TTL** (`_shared/issue-claims.md`, 72h) is untouched — it governs re-claiming
  a *record* against a competing dispatcher, a different concern with its own staleness rules,
  not resuming a *run*.
- **A run whose status is not `interrupted`** — including a dispatch-parked `pending-review` run
  before its orchestrating session has ended. Nothing needs gating there; see the "does not fire
  on a normal Task-tool subagent turn end" note above.
