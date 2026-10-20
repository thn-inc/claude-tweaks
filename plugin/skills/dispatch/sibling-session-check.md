# Sibling-session check (Steps 4-5)

Branches and labels are remote-facing signals, and a claim is only visible once it is written —
none of them can see a live session already standing in an unpushed worktree, which is why the
check has a worktree half; its claims half covers a sibling on another machine. `[IL-107]`'s actual incident was a
nine-task implementation, eleven commits deep in an unpushed worktree, nearly redone from
scratch for exactly this reason: `origin/main`, the record's labels, and the claim refs all
showed the work as untouched.

Before writing any claim, for each member of the selected group run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/hooks.js" check-sibling-sessions --record "$ISSUE"
```

Branch on the printed line:

- `claude-tweaks: sibling session may already hold record...` — names either a live worktree
  (path, branch, pid) whose lock names that record, or a live claims-registry claim held by
  another session (run, session, host, claimed-at) — the second source covers a sibling on
  another machine, in the cloud, with an unlabeled worktree, or one that has claimed but not
  yet created a worktree. Surface it and stop the automated claim for this
  group. This is **not** an unconditional hard block: matching this plugin's "ambiguity
  resolves to allow, but never silently" posture elsewhere (e.g. E1's foreign-session
  warning), a human/agent that confirms the other session is actually stale can still proceed
  with the claim manually.
- `claude-tweaks: no sibling-session conflict found for record...` — proceed to the claim
  procedure below exactly as before this check existed. The check also fails open (an
  unresolvable `git worktree list`, a dead pid, an unparseable lock, a claim read failure —
  offline, auth, an unresolved repo slug — or an unreadable claim blob all print this same
  no-conflict line) — never treat silence as a reason to escalate.

This check is advisory. `/claude-tweaks:flow` Step 2.8's atomic claim (`flow/claim-targets.md`,
inside the group's first Task call) stays the correctness boundary; this check only stops
dispatch from minting a run dir and worktree for a group a sibling already holds.

## Worktree-resume check (Step 5, #2838)

The check above runs at Step 4, before the mint — it cannot see a sibling session that creates
its own worktree for this same group in the window between that check and Step 5's own
worktree-creation call a few steps later. Close that window at the point it actually bites: when
Step 5 creates and enters the group's worktree, check whether that call **resumed an existing
worktree** rather than creating a fresh one — observed live (#2838, group #2785): a sibling
session had already created worktree `dispatch-record-2785` seconds earlier, and `EnterWorktree`
silently resumed it instead of refusing, with no error to catch.

A resumed worktree is the sibling-conflict signal itself, independent of whatever Step 4's own
check (above) reported — treat it exactly the same way: this dispatching session takes no further
action inside that worktree. Exit it with `ExitWorktree(action: "keep")` (never tear down or
touch content that may belong to the live sibling session), log the conflict to this firing's own
`decisions.md` (`AUTO {time} — Step 5: worktree {name} was already present (sibling conflict) —
skipped group [{issue list}] without dispatching either call.`), and skip this group entirely —
neither of its two Task calls is dispatched. Proceed to the next group exactly as if this one had
been skipped at Step 4.

**Bind the run before call 1 (#3225).** When the worktree is fresh — the resume check above did
not fire — bind this group's minted run to it from this dispatching session before dispatching this group's first Task call:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/hooks.js" record-worktree --run "$GROUP_RUN_DIR" "{worktree}" --dispatch
```

`{worktree}` is the group's worktree path — the `EnterWorktree(path:)` target, or the
`git worktree add` path for a cwd-pinned session (`sequential-execution.md`, #447). For a cwd-pinned
session the bind still runs, but the gate stays inert: its Task calls reach the worktree only through
a `cd {worktree} &&` prefix, so the hook sees the pinned cwd rather than the worktree, and #2837's
check is the only guard there. One call writes
the worktree assignment, this session's id, a permanent `dispatched: true` marker, and a
`dispatchSessionId` (the same id, written only by `--dispatch`) into the run's `run-state.json`; from then on `bin/lib/hooks/pre-tool-use.js`'s `checkDispatchConfigGate`
denies git commits and pushes (and the other git writes it classifies: `mv`, `rm`, `update-ref`, `apply`)
in this worktree until `/claude-tweaks:flow` Step 3's Manifesto has written
`$GROUP_RUN_DIR/config.yml` — a first call that bypasses `/claude-tweaks:flow` is stopped at its
first commit, not after a full build. Expect the `claude-tweaks: worktree recorded for` confirmation line. A
failed bind never blocks dispatch: log it to this firing's own `decisions.md` and dispatch anyway —
the run then lacks the early checkpoint, and #2837's first-call artifact check (`two-call-gate.md`)
still applies.
