# Sibling-session check (Steps 4-5)

Branches, claims, and labels are all remote-facing signals — none of them can see a live
session already standing in an unpushed worktree. `[IL-107]`'s actual incident was a
nine-task implementation, eleven commits deep in an unpushed worktree, nearly redone from
scratch for exactly this reason: `origin/main`, the record's labels, and the claim refs all
showed the work as untouched.

Before writing any claim, for each member of the selected group run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/hooks.js" check-sibling-sessions --record "$ISSUE"
```

Branch on the printed line:

- `claude-tweaks: sibling session may already hold record...` — names a live worktree (path,
  branch, pid) whose lock names that record. Surface it and stop the automated claim for this
  group. This is **not** an unconditional hard block: matching this plugin's "ambiguity
  resolves to allow, but never silently" posture elsewhere (e.g. E1's foreign-session
  warning), a human/agent that confirms the other session is actually stale can still proceed
  with the claim manually.
- `claude-tweaks: no sibling-session conflict found for record...` — proceed to the claim
  procedure below exactly as before this check existed. The check also fails open (an
  unresolvable `git worktree list`, a dead pid, or an unparseable lock all print this same
  no-conflict line) — never treat silence as a reason to escalate.

This check is additive to the existing branches/claims/labels check that follows in Step 4,
not a replacement for it, and it does not alter that check's own logic.

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
