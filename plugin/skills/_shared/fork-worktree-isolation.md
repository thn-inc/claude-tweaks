# Fork / Worktree Write-Guard — Shared Contract

Canonical home for the write-guard mandate `_shared/subagent-output-contract.md`'s Input
Discipline section points to, and the resolution `docs/incident-log.md`'s IL-07 entry
records for its fifth recurrence (issue #2278). Read by anyone dispatching a subagent
(fork or otherwise) whose scope is narrow, read-only, or research-only and whose scope
must not risk landing a write in the dispatcher's own live worktree.

## The corrected hazard

Issue #2278 (and IL-07's four prior recurrences) framed this as a `fork`-specific hazard:
"forks share the parent's cwd (not just conversation context)." That framing under-states
the problem. Three throwaway diagnostic dispatches run from inside a live pipeline
worktree during #2278's own build (2026-09-12) established:

1. An ordinary, non-fork `Task`/`Agent` dispatch with no `isolation` argument **also**
   resolves `pwd` and `git rev-parse --show-toplevel` to the dispatcher's own live
   worktree — identical to a fork's behavior. The hazard is dispatch-shape-general, not
   fork-specific: any subagent dispatched with no isolation shares the parent's worktree.
2. Passing `isolation: "worktree"` on the same `Agent` tool call roots the dispatched
   agent in a genuinely separate, freshly created worktree
   (`.claude/worktrees/agent-{agent-id}`) — confirmed by the identical `pwd`/
   `git rev-parse --show-toplevel` probe returning a different path with a different
   git toplevel. This is a harness-level filesystem boundary, not a prompt convention:
   nothing the dispatched agent does — malicious, confused, or merely scope-creeping —
   can land a write in the dispatcher's worktree once its own cwd is rooted elsewhere.
3. A `fork` dispatched with `isolation: "worktree"` and an explicit "ignore all prior
   context, this is a one-shot diagnostic probe" instruction still misidentified its own
   role — it echoed back prose resembling the dispatcher's own unrelated in-progress
   narration instead of running the two requested shell commands, burning several tool
   calls in the process. This reproduces IL-07's third and fourth recorded failure modes
   (a fork ignoring an explicit "do NOT apply any changes yourself, read-only analysis"
   instruction) a fifth time, live, during the investigation that produced this file. It
   left the isolation-compatibility question for `fork` specifically **unresolved** —
   whether `isolation: "worktree"` actually redirects a fork's own cwd was not confirmed
   either way, because the fork never executed the probe commands at all.

## Mandate: isolation: "worktree" for narrow/read-only dispatch

Any dispatch — fork or fresh agent — whose scope is narrow, read-only, or research-only,
and which must not risk a write landing in the dispatcher's own live shared worktree,
**must** pass `isolation: "worktree"` on the `Agent` tool call. This is the structural
write-guard Deliverable 1 of issue #2278 asked for: it already exists in the harness as a
documented `Agent`-tool parameter (empirical finding 2 above), and the fix this plugin
owns is requiring its use, not inventing new infrastructure. It also directly delivers
Deliverable 2's "default to a throwaway copy of the worktree" — `isolation: "worktree"`
*is* that throwaway copy, automatically cleaned up by the harness when the dispatched
agent makes no changes (per the `Agent` tool's own documented behavior).

**Never rely on `isolation: "worktree"` alone to make `fork` safe for narrow-scope work.**
Given finding 3 above, prefer a fresh (non-fork) agent type for any narrow/read-only/
research-scoped dispatch regardless of isolation — `fork`'s independent inherited-history
identity-confusion hazard is not addressed by filesystem isolation, since a confused fork
that never runs the intended commands at all is not made safe by rooting it in a private
worktree it never uses correctly in the first place. `_shared/subagent-output-contract.md`'s
existing "prohibited for a clean-room fan-out dispatch" rule already forces a fresh agent
for parallel fan-out work; this file extends the same preference to narrow *solo*
dispatches, which that rule's own scope (fan-out only) did not previously cover.

**Prose alone is not the guard.** "Research only, do not modify files" in a dispatch
prompt is advisory context the agent may ignore (IL-07, five recorded instances now
including finding 3 above) — it is not what makes this mandate structural. What makes it
structural is that `isolation: "worktree"` changes *where the dispatched agent's writes
physically land*, independent of whether the agent complies with anything in its prompt.
Keep the scope-limiting prose too (Input Discipline's existing "Constraints that prevent
overreach" — e.g. "Read-only") as a second layer, but never as the only layer.

## What this does not resolve

Whether `isolation: "worktree"` actually redirects a `fork`'s own cwd (as opposed to a
fresh agent's) is still empirically unconfirmed — finding 3's fork dispatch never reached
the point of running the probe. Given the mandate above already routes narrow-scope work
to a fresh (non-fork) agent regardless, closing this specific question is not required to
land the fix; it is left as an open question for whoever next needs to dispatch a fork
under isolation, rather than blocking this record on a fork-specific probe.

## Consumers

| Skill / file | Role |
|---|---|
| `_shared/subagent-output-contract.md` | Input Discipline section's fork-prohibition clause points here for the full rationale and the isolation mandate — kept as a one-line pointer there for byte-headroom reasons. |
| `docs/donts.md` | The existing fork Don't rule (`[IL-07]`) cites this file's mandate as the structural remedy, alongside its existing "use a fresh non-fork agent" advice. |
| `docs/incident-log.md` | IL-07's entry records this file as the fifth recurrence's resolution — the first of the five that lands a structural (not purely prose) mitigation. |
