---
files:
  - plugin/skills/tidy/step-6-auto.md
  - plugin/skills/tidy/step-6-interactive.md
  - plugin/skills/tidy/SKILL.md
  - plugin/skills/tidy/scan-procedures.md
  - plugin/bin/lib/reconcile/release-merged.js
  - plugin/bin/lib/reconcile/archive-branches.js
  - plugin/bin/lib/reconcile/prune-remote.js
  - plugin/bin/lib/reconcile/squash-provenance.js
  - plugin/bin/lib/reconcile/reap-merged.js
---

# Tidy Standalone-Auto Report: Verb-Grouped Sections and Reconcile-Converged Rows

**Persona:** claude-tweaks maintainer (or a scheduled tidy Routine firing) running periodic backlog hygiene on a `pr-first` project with `auto-mode: default-on`.
**Goal:** One report that separates what tidy already did, what it will do on a click, and what only the human can do — with every actionable line ending in a paste-ready command, and mechanical cleanups (issue-closed claim releases, abandoned-branch archival) already converged by reconcile rather than staged for approval.
**Entry point:** `/claude-tweaks:tidy` standalone in auto mode (no parent pipeline run dir), interactively or as the weekly scheduled Routine.
**Success state:** The report renders the four literal sections — **Applied automatically**, **Approve ({N})**, **Yours ({N})**, **Clean:** — empty sections omitted (Clean always present), each section's rows as aligned columns inside ```text fences, no line over 100 characters; reconcile-converged outcomes (released claims on closed issues, archived/deleted abandoned branches) appear under Applied with their reversibility token; Yours is grouped by the command the human runs and every group closes with a batch line, a paste block (one command per row), or a ref-less line — except the fixed final `review ({k})` group (findings whose follow-up is a path or prose rather than a command), which closes with no command line at all; a report over 40 lines arrives condensed with the full report at `{run-dir}/report.md`; Next Actions derives from Approve/Yours groups as plain markdown (Approve line first when non-empty, one line per Yours group carrying its batch line or first paste line, total handoff capped at four lines).

## Steps

### 1. Scans run — reconcile converges first
- **Action:** Tidy's scan procedures run `reconcile()` at their own trigger points. Under `pr-first`, the release check drops claims on merged-PR evidence (`merged: reconciled from PR #{n}`) or issue-closed evidence (`issue-closed: reconciled from #{n}`), the archive-branches check deletes plugin-owned branches proven merged (cherry-equivalent, or squash-merged via the PR's own merge commit — #2252) and tags-then-deletes aged unmerged ones, the remote-prune check deletes remote plugin-owned branches carrying both signals (a MERGED PR and a merged-in-substance proof — cherry-equivalence or squash provenance) and no open PR — for this one destructive check any OPEN PR governs over a MERGED one (#664), so a branch with both can be prune-skipped remotely in the same pass that archives it locally, where the merged-wins tie-break still stands — after refreshing origin, and the reap check removes merged runs' worktrees — a locked worktree with a live owner is reap's skip, reported with its reason, never broken. Under `local-merge`, only `reap`'s legacy ancestry check runs — everything else keeps staging. Two whole-pass early exits (#820) can skip the entire requested check set before any of the above runs: a GitHub-health preflight (`preflight.js`, ~2s) on an unreachable/degraded GitHub, and an overall wall-clock pass budget (`budget.js`) once exceeded — either means this call converged nothing, not that there was nothing to converge; a failed shared fetch is likewise reported once for whichever of `mirror`/`red-tip`/`remote-prune` were requested together, not per check; and remote-prune carries a third check-level skip of its own: its bulk PR screen is all-or-nothing, so a `gh-absent` or `pr-screen-failed` screen skips the entire remote-prune check with that reason (#1082) — archive-branches deliberately does not, degrading to per-branch skips so its gh-independent archive-tag GC keeps running (#1083).
- **Expect:** No approval prompt for any of this — these are reconcile's background-convergence writes, outside the skill-side auto-mode contract; tidy only reports the results. A preflight or budget skip is a check-set-wide `unknown`, not a clean pass — a report reading "nothing to converge" after one must not be trusted as "reconcile ran and found nothing" without also checking `decisions.md`/`events.jsonl` for the skip reason.

### 2. Findings route by the table, not judgment
- **Action:** Each scan finding routes per `step-6-auto.md`'s tier table (default `moderate`): reversible git-tracked cleanups auto-apply, outward-facing GitHub writes stage, no-op findings surface with their command.
- **Expect:** The section a finding lands in is a stated function of its routing outcome (bucket mapping) — executed/converged → Applied; staged-executable → Approve; command-carrying no-ops → Yours; Keep/clean scans → Clean (counted, never itemized). Nothing renders information-only.

### 3. The report renders before any question
- **Action:** The hard gate requires the rendered report in the same response, above any `AskUserQuestion`.
- **Expect:** The conformance scan ran first — no `┌─┐` box art, but aligned columns inside ```text fences (the "no box-drawing tables" rule bans drawn borders, not alignment); no line over 100 characters, titles truncated to 50 with `…`; records as `#{N}` plus a title column (titles from the scan agents' own findings — no per-row `gh issue view`); Yours grouped by the command the human runs in the fixed order `specify`, `demo`, `git`, `capture`, `backlog refine`, then alphabetical, with the command-less `review ({k})` group last of all, one row per record and no `(likewise …)` shorthand, each group closing with one batch line (`flow`/`dispatch` — multi-ref `argument-hint`) or a paste block of single commands, or one ref-less line when the command takes no record (`/claude-tweaks:backlog refine`); Clean as one `{scan}  {count} checked` line per scan; `{run-dir}/decisions.md` referenced by path exactly once. The interactive twin (`plugin/skills/tidy/step-6-interactive.md`) renders this identical template and is bound by the same Report rules and Yours grouping, differing only in its close: it presents the report and then calls `AskUserQuestion` with the "Approve ({N}) (Recommended)" / "Override specific items" options — which is the `AskUserQuestion` this step's hard gate orders the report above.

### 4. Next Actions close the loop
- **Action:** The plain-markdown `## Next Actions` block derives from the report: an "Approve ({N})" line first (bolded, recommended) when Approve is non-empty, then Yours *groups* — one line per group in report order, carrying the group's batch line, the first line of its paste block, or its ref-less line (total handoff capped at four lines) — then the help dashboard — no closing question.
- **Expect:** A finding class that keeps staging run after run reads as a missing routing rule (the principle stated once in `step-6-auto.md`'s preamble) — the Approve bucket should trend empty as routing rows (or reconcile checks) absorb recurring classes; the durable exception is outward-facing GitHub writes, forbidden at every tier by the auto-mode contract.

### 5. A wide sweep condenses instead of flooding the chat
- **Action:** A full sweep whose report would exceed 40 lines (a dozen-plus Yours records across several groups is enough — every single-ref record costs a row plus a paste line) writes the whole report to `{run-dir}/report.md` and sends a ~20-line condensed report: Approve in full, Yours as group heads with counts (plus batch lines), Applied and Clean collapsed to counts, and a `Full report:` footer.
- **Expect:** Nothing is lost — every row and every paste block is in `report.md`; the condensed report is what the hard gate checks for, and Next Actions still derives from the groups. At 40 lines or fewer no `report.md` is written and the report arrives whole.

## Origin
- Created during build of #695 (tidy standalone-auto report shape)
- Updated during build of #2252 (Reconcile under squash): Step 1 now names the second merged-in-substance proof — squash provenance via the PR's own merge commit — beside cherry-equivalence for both branch checks; `plugin/bin/lib/reconcile/squash-provenance.js` added to `files:`

## Example render

An example of the post-#695 shape for a sweep with 3 auto-applied cleanups, no staged items, 16 Yours records across four groups, and six clean scans (fictional records). The 16 Yours records fit in 28 lines; the whole report is 49, so this render ships condensed, with this full form in `report.md`:

````markdown
## Tidy Report — 2026-08-16

**Applied automatically**
```text
released     #612  Reclaim net-empty branches after merge — reconci…   reconcile-converged
archived     #588  Retire the legacy effort:* label family             reconcile-converged
deleted      #601  Terminal track for design-wrapper — plan file       commit 3f9c1a2
```

**Yours (16)**
```text
/claude-tweaks:specify (6)
   #640  Backlog overview funnel: stage counts per lane                  ready, missing risk/size
   #652  Reconcile red-tip detection for stale mirror refs               ready, missing risk/size
   #655  Routine kickoff kernel self-heal fallback                       ready, missing risk/size
   #661  Dispatch two-call gate: settle before teardown                  ready, missing risk/size
   #663  Help dashboard trust table render                               ready, missing risk/size
   #670  Capture born-ready chain: --chained shaping                     ready, missing risk/size
   /claude-tweaks:specify #640,#652,#655,#661,#663,#670
/claude-tweaks:demo (5)
   #598  Merge verification policy key                                   closed, no acceptance
   #599  Reference card argument-hint pin                                closed, no acceptance
   #608  Specify native sub_issues linking                               closed, no acceptance
   #610  Specify native blocked_by linking                               closed, no acceptance
   #647  permittedGrants per-grant reasons                               closed, no acceptance
   /claude-tweaks:demo #598,#599,#608,#610,#647
git (2)
   #617  Design exhaust deferral gate                                    PR closed unmerged, wt kept
   #620  Revive needs-definition sweep                                   PR closed unmerged, wt kept
   git -C .claude/worktrees/design-exhaust-deferral-gate log --oneline -5
   git -C .claude/worktrees/revive-needs-definition log --oneline -5
/claude-tweaks:backlog refine (3)
   #571  Tidy reconcile routing for build+ worktrees                     bot:blocked, retry ceiling
   #574  Sweep backstop unarmed PR grant                                 bot:blocked, retry ceiling
   #589  Docs-health depth mismatch judge                                bot:blocked, retry ceiling
   /claude-tweaks:backlog refine
```

**Clean:**
```text
parked             3 checked
worktrees          9 checked
doc registry       —
design docs        2 checked
plans              4 checked
issue claims       12 checked
```

Full decision log: .claude-tweaks/pipelines/2026-08-16T203000-tidy-standalone/decisions.md
````

