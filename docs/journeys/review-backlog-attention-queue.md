---
files:
  - plugin/skills/backlog/attention-mode.md
  - plugin/skills/backlog/SKILL.md
  - plugin/skills/specify/next-mode.md
  - plugin/bin/lib/issues/grant-gate.js
---

# Review the Backlog Attention Queue

**Persona:** A claude-tweaks maintainer doing a periodic backlog check-in, wanting to know what's waiting on a human decision before picking the next thing to build.
**Goal:** See every open record that genuinely needs a human call — an undecided idea (`needs:definition`), a decision proposal nobody has answered (`needs:decision`, or any other `needs:*` marker), a solution nobody justified (`solution:unjustified`), a spec a machine wrote that nobody has reviewed or granted (`shaped:headless` with no `auto:build`), a record parked by a failed build (`bot:blocked`), or a record parked by the merge-verification gate with its grants still intact (`bot:parked`) — ranked in one place, alongside a merge-lane circuit-breaker warning and a staged-tidy-proposals nudge when either applies, and know exactly what to do about each one.
**Entry point:** A terminal with `/claude-tweaks:backlog attention` run bare.
**Success state:** Up to two non-record lines (a tripped merge-lane breaker, staged tidy proposals awaiting `--approve`) followed by one ranked table (or an explicit "nothing needs attention" line) covering every classification with no duplicate rows, each carrying a concrete next command to run — the maintainer picks one and moves, without having to separately remember what each label means or re-derive its remedy.

## Steps

### 1. Run the query — terminal
- **URL:** `/claude-tweaks:backlog attention`
- **Action:** Invoke the mode bare. It reads the whole `needs:*` family, `bot:blocked`, and `bot:parked` from the session-scoped record snapshot (falling back to one plain `gh issue list` refresh when stale or absent), and runs two further `gh issue list` fetches — `solution:unjustified` on its own, plus `ready` + `shaped:headless` as one deliberate two-label AND query — merges everything by issue number, drops any `shaped:headless` record that already carries `auto:build`, ranks by priority band then age, and renders one table.
- **Should feel:** Read-only and safe — like checking a dashboard, not opening a work queue that might mutate something. No grant, no shaping, no write happens anywhere in this mode.
- **Should understand:** A record matching two or more classifications renders as exactly one row (`Type: needs:definition + solution:unjustified`) with each remedy concatenated in fixed fetch order, never a separate row per matched type for the same issue. The `solution:unjustified` fetch stays its own single-label call, and the `ready`+`shaped:headless` fetch stays one deliberate two-label AND call, because `--label` ANDs within one call — splitting the latter would silently widen it to every `ready` record plus every `shaped:headless` record.
- **Red flags:** The same issue number appearing twice in the table; a mode that writes a label, grants, or shapes anything instead of just listing; a `shaped:headless` record that already carries `auto:build` appearing in the table at all (it has been granted — it is no longer waiting on anyone)

### 1.5. Read the two non-record lines, if either renders — terminal
- **URL:** same session, above the ranked table
- **Action:** A `⚠ Merge-lane circuit breaker tripped …` line renders when the global breaker read succeeds and comes back tripped — it names who tripped it, when, and why, and points at `/claude-tweaks:backlog refine --reset-breaker`. A `{count} tidy proposal(s) staged awaiting approval …` line renders when the newest standalone tidy (or sweep) run still has unapproved items in its `staged/` directory, pointing at `/claude-tweaks:tidy --approve`.
- **Should feel:** Like two independent heads-up notices, not part of the ranked table — either can render with the table empty, and both are silent when their own condition doesn't hold.
- **Should understand:** Both lines are best-effort and fail safe — a failed or degraded breaker read omits the banner entirely rather than guessing, and the tidy row only ever surfaces the single newest matching run directory.
- **Red flags:** A tripped-breaker banner rendered from a failed or degraded read; either line counted as a row in the ranked table below it.

### 2. Read a row's recommended action — terminal
- **URL:** same session, immediately after Step 1's table renders
- **Action:** Read the `Recommended action` column for the row the maintainer wants to act on. A `needs:definition` row points to `/claude-tweaks:specify #{n}` (routes through brainstorming — the record has no decided approach yet). A `needs:decision` row (or any other `needs:*` marker) points to `/claude-tweaks:backlog refine #{n}`, quoting the record's own pending `**Proposed:**` line verbatim. A `solution:unjustified` row points to `/claude-tweaks:challenge #{n}` for the evidence-or-accept-risk verdict. A `shaped:headless (no grant)` row points to bare `/claude-tweaks:backlog refine` to grant it through the sweep's Grant lane, with the reason stated inline — the spec body was written by a headless drain and no human has read it. A `bot:blocked` row points to `/claude-tweaks:backlog refine #{n}` to re-authorize after the failure. A `bot:parked` row also points to `/claude-tweaks:backlog refine #{n}`, but to review the parked PR and resume once its checks are green — not to re-authorize, since a merge-verification park never revokes grants.
- **Should feel:** Like the table already did the remembering — the maintainer doesn't need to separately recall which label means what or which skill resolves it.
- **Should understand:** This mode never runs the recommended command itself — it only names it. The maintainer runs it in a follow-up message, same as reading `/claude-tweaks:help`'s Triage Queue and then acting on one row. Any `needs:*` marker this mode doesn't name individually still gets a row, with a generic `/claude-tweaks:backlog refine #{n}` remedy — the catch-all is deliberate and permanent, not a gap.
- **Red flags:** A recommended action that doesn't match the label (e.g. a `needs:definition` row pointing at `/backlog refine`); a row with no recommended action at all; a `shaped:headless` row's remedy pointing at `refine #{n}` instead of bare `refine` (the per-record resolver has no grant path for it).

### 3. Act on the top pick — terminal
- **URL:** same session
- **Action:** Run the command from the row acted on, or from the table's trailing "Pick up next" line if undecided which to tackle first (the same oldest/highest-priority record the ranking already surfaced).
- **Should feel:** Like picking up exactly where the table left off — no re-fetching, no re-deriving priority by hand.
- **Should understand:** Every remedy on this list is genuinely human-owed — a `needs:definition` record structurally cannot be shaped by `/specify` in place (it redirects to brainstorming instead), a `solution:unjustified` record's grant requires the same one-line judgment call a human would make anyway at grant time, a `needs:decision` (or other `needs:*`) proposal is by definition awaiting a human answer, and a `shaped:headless` record above the fixed `medium` provenance floor on either risk or size structurally cannot be machine-granted at all — `evaluateGrantGate` denies it with `shaped-headless-floor` on every firing of the grant unit, so this list is the only place it will ever surface.
- **Red flags:** `/claude-tweaks:specify` shaping a `needs:definition` record in place instead of redirecting; a `solution:unjustified` record silently granted with no human decision recorded anywhere.

## Origin
- Created during the retroactive wrap-up of #473-#476 (`needs:definition`/`solution:unjustified` decomposition, PR #480) — `/backlog attention` shipped with zero journey coverage anywhere in `docs/journeys/`
- Related specs: #473 (needs:definition), #474 (this mode), #475 (solution:unjustified)
- Updated during build of #967/#968/#969 — `/specify next` (the headless shaping unit at the time, now bare `/specify` drain's deprecated `next` alias, refs #1491) introduced `shaped:headless`, `/backlog attention` gained it as a third classification, and `grant-gate.js` gained the `shaped-headless-floor` deny that makes this list the sole surface for a machine-shaped record above the provenance floor.
- Updated during build of #1489 (backlog attention widening + refine record resolver) — the mode now reads the whole `needs:*` family (not only `needs:definition`) plus `bot:blocked` off the session-scoped record snapshot, gained the merge-lane breaker banner and staged-tidy-proposals row as two independent non-record lines, and repointed `solution:unjustified`'s remedy at `/claude-tweaks:challenge #{n}`.
- Updated during build of #2328 — the mode now also reads `bot:parked` (the merge-verification gate's park facet, grants left intact) off the same session-scoped snapshot, so a parked record surfaces here too, with its own non-re-authorize remedy distinct from `bot:blocked`'s.
