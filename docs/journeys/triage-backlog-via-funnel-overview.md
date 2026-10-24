---
files:
  - plugin/bin/lib/issues/backlog.js
  - plugin/bin/lib/issues/record.js
  - plugin/bin/lib/issues/record-vocabulary.js
  - plugin/bin/lib/issues/facet-shape.js
  - plugin/bin/fetch-sub-issues.js
  - plugin/skills/_shared/trust-table.md
  - plugin/skills/backlog/overview-mode.md
  - plugin/skills/backlog/machine-grant-outlook.md
  - plugin/skills/backlog/SKILL.md
---

# Triage the Backlog Through the Funnel Overview

**Persona:** A maintainer with an open work-record queue who wants one glance to answer "where is everything, and what do I act on?" — without reading three lens tables or a full trust matrix.
**Goal:** Read the bare-mode funnel header, understand each stage's population and its single next verb, and drill into a lens only when a specific population needs detail.
**Entry point:** A Claude Code session in a project with `work-backend: github-issues` (or `local-files`); type `/claude-tweaks:backlog` with no arguments.
**Success state:** A funnel header whose six stage counts, together with the parked/not-planned annotation counts and the parents count in its own Sign-off paste block, account for the whole open queue, at most two annotation lines beneath the header (the machine-grant outlook's own line renders *inside* the header, under its stage line, and never counts against those two), a "Recommended next" callout, and per-stage paste blocks with integrity rules and a closing `Next:` line — with no lens tables rendered and every record appearing exactly once.

## Steps

### 1. Read the funnel header — bare `/claude-tweaks:backlog`
- **Action:** Run the skill with no lens argument and read the header block at the top of the report.
- **Should feel:** Like a process gauge, not a report — six stages in pipeline order (`captured ▶ prioritized ▶ specified ▶ granted ▶ dispatchable ▶ in flight`), a count per stage, and a fully-qualified command under each actionable stage.
- **Should understand:** The buckets are mutually exclusive (`funnelBuckets` in `plugin/bin/lib/issues/backlog.js` — first-match-wins precedence: live bot work outranks stage labels; a granted-but-blocked record shows as `granted`, never `dispatchable`). The header *is* the counts — there is no separate summary paragraph.
- **Red flags:** A record id in the header; a Critical/Risk-Value/Cleanup table rendering without a lens argument; a record missing from every funnel population, or counted in two of them (the six header stages alone do not sum to the open queue — parked and not-planned are annotation-line populations, and parents is a batch-emitter population, none of them header columns); a decomposition parent counted in the `prioritized`, `specified`, `granted`, or `dispatchable` stage; a per-step "running"/"passed" narration line (the narration allowance permits only one opening line plus failure/degradation lines).

### 2. Read the annotation lines — trust, parked/not-planned, and machine-grant outlook
- **Action:** Look immediately beneath the header — at most two lines appear there: a trust consequence line (only when some class verdict is `mixed`, e.g. `trust: clean, except human:human|low (mixed) → merges below stay PR-gated`), and `parked N · not-planned M → /claude-tweaks:tidy owns these` (only when non-zero). Then read back *inside* the header: only on a repo whose policy resolves `autonomy: unattended` with `grant-origination-enabled: true`, a `# machine-grant live (≤{cap}/day): {N} eligible pending grant-check; {M} refused — {failedKey}: {count}, ...; {K} human-filed (excluded — never machine-granted)` line renders directly under the `# specified {n}` line, before that stage's `/claude-tweaks:backlog refine` command line (`machine-grant-outlook.md`) — a header annotation, never a third line below the header.
- **Should feel:** Silent when clean — no `trust: clean` line, nothing about parked when there are none, and the machine-grant line's own segments (the `{failedKey}: {count}` list, the excluded-human-filed count) each disappear individually when zero rather than rendering as `0`.
- **Should understand:** The full trust table moved behind `/claude-tweaks:backlog overview trust` (uncapped, unchanged contract); `insufficient-evidence` cells render nothing in bare mode. `not-planned` counts open records carrying the `wontfix` label (`facets.notPlanned`). Decomposition-parent records are never `ready` and are not agent-sized work — they get no annotation line here at all; their count and a paste-ready close-out batch (`/claude-tweaks:demo #a,#b,...`) render in the report body's own Sign-off paste block instead, never `/claude-tweaks:specify`. Feeding the trust line, the trust fetch's sub-issue enumeration is batched (`bin/fetch-sub-issues.js`, probe-gated aliased GraphQL) and session-cached, so repeat invocations in a session skip it; a parent whose data can't be fetched fails the trust read loudly with no verdict rendered — an undercount is never silently graded (`_shared/trust-table.md`'s error ladder). The machine-grant line's `{eligible}`/`{refused}` population never counts a human-filed record under `refused` (`machineGrantOutlook` in `plugin/bin/lib/issues/backlog.js` pre-filters human-filed records the same way `refine-headless.md`'s own Step 1 does, before running the gate chain at all) — a human-filed record whose class trust also happens to be non-clean is counted under the excluded-human-filed segment, never misattributed to `refused: trust` (#1387). Origin is the only axis the pre-filter aligns: a `ready` record with an open blocker still counts as `eligible` here even though the headless posture's own candidate fetch would drop it, so the line can read higher than that posture's candidate-set size.
- **Red flags:** More than two annotation lines beneath the header (the machine-grant line is not one of them — it renders inside the header, under `# specified {n}`); the machine-grant line rendered below the header instead of inside it; a `parents N → ...` line rendered beneath the header (it moved to the Sign-off paste block); a rendered trust table in bare mode; a consequence line for an `insufficient-evidence` cell; a trust verdict rendered after the fetch reported a failed parent; a human-filed record counted in the machine-grant line's `refused: trust` (or any other `failedKey`) bucket instead of the excluded-human-filed count.

### 3. Drill into a lens — `/claude-tweaks:backlog overview trust` (or `critical` / `risk-value` / `cleanup`)
- **Action:** Re-run with an explicit lens argument when a population needs detail.
- **Should feel:** The full table you expected, exactly as before the funnel redesign — the lenses kept their complete renders, they just stopped rendering uninvited.
- **Should understand:** The buildable population Step 3's "Recommended next" ranks over is `funnelBuckets`' `dispatchable` ∪ `granted` — the same numbers the header showed, one predicate, so the recommendation can never disagree with the funnel counts.
- **Red flags:** A capped or truncated trust-lens table; lens output leaking into a later bare-mode run.

### 4. Trust the recommendation's dependency data — or see it loudly refuse
- **Action:** In bare mode, read the "Recommended next" callout on a repo with `work-links: native` and a wired dependency chain.
- **Should feel:** Grounded — the recommendation ranks on the native blocked-by graph (`blockersOf` in `plugin/bin/lib/issues/ranking.js`: attached `blockedBy` → local `facets.blockedBy` → canonical body lines), not on prose guesses. A chain's tail record never outranks its unbuilt prerequisites on a phantom zero-dependency read.
- **Should understand:** When a record's body *mentions* a dependency in prose but nothing resolves mechanically, the dependency-mismatch flag fires: the flagged records get no mechanical recommendation, and the headline is either a corrected pick with its evidence cited inline, or a plain "ranking is unreliable for these" statement pointing at `/claude-tweaks:backlog refine`'s repair. An unsynced local record's blockers are never matched against GitHub issue numbers (different id namespaces).
- **Red flags:** A "Recommended next" the same output later retracts; a chain's last record recommended first on a natively-wired repo; a flagged record silently dropped from the report.

### 5. See the human lane surface what no agent can drain
- **Action:** On a repo where any record carries `needs:definition` or `solution:unjustified` (or its pre-rename spelling `framing:baked` — still read), read the `└─ needs you: {n}` branch line under the funnel header and the `── Needs you ──` section rendered last, just above the Next Actions block.
- **Should feel:** Like the report handing you *your* work: paste blocks send agents off; the lane's launcher lines (`/claude-tweaks:specify #N` for definition gaps, `/claude-tweaks:challenge #N` for `solution:unjustified` evidence calls — the evidence-or-accept-risk mode that resolves the label in one step) are the session's recommended move whenever the lane is non-empty. Since #1101's batch-emitter rewrite, the Shape and Dispatch paste blocks carry no per-record annotations at all (chunked `#N` refs or a bare queue pointer only) — the Needs-you lane is the only place a `solution:unjustified` record's evidence call surfaces.
- **Should understand:** The lane is an overlay (`funnelBuckets`' `needsYou`) — records keep their stage bucket and are counted twice by design; only in-play records surface (in-flight/parked/not-planned are filtered); on a repo where no record carries either label nothing renders at all (dormant-safe). Both halves of the lane are live: `needs:definition` since v6.85.0, `solution:unjustified` since #677 renamed `framing:baked`.
- **Red flags:** The lane naming a parked or bot-claimed record as your next move; a needs-you branch line on a repo with no needs-labels; more than 3 rows without the attention pointer.
