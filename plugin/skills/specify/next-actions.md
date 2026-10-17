# Specify — Next Actions

Full Next Actions procedure for `/claude-tweaks:specify`, lazy-loaded from `SKILL.md` so that
file stays lean. Rendered for both modes — this is the one
block that straddles them, which is why it lives in its own file rather than either mode's own
sub-file.

Self-routing — render based on what was produced. The records are **already durable** by the time this block renders: a `github-issues` run's shaped record and sub-issues exist on the tracker the moment the edit/create call lands; a `local-files` run's record files exist on disk regardless of whether decomposition mode's Step 9 found anything to commit. Never offer "commit then flow" or "have me commit these sub-issues" as an option; that question is closed before Next Actions renders (see shaping mode's write step, or decomposition mode's Step 9). Options are purely about *which* records to pipeline and in *what order*.

This "Situation → options" table is the assistant's own lookup logic to pick which situation applies — it stays internal and is never itself shown to the user or rendered as one of the markdown lines below. The commands below show the `work-backend: github-issues` form (`#{N}`); under `work-backend: local-files`, drop the `#` and emit bare record ids instead (`/claude-tweaks:flow {N}`, `/claude-tweaks:flow {N1},{N2},...`).

| Situation | Options |
|---|---|
| Shaping mode — one record shaped in place | 1. `/claude-tweaks:flow #{N}` — automated pipeline for record #{N}: "{title}" **(Recommended)**<br>2. `/claude-tweaks:build #{N}` — build only (no test/review/wrap-up)<br>3. `/claude-tweaks:help` — pipeline dashboard |
| Shaping mode — multiple records shaped in place (a comma-separated list) | 1. `/claude-tweaks:flow #{N1},#{N2},...` — sequential pipeline for every record shaped this run **(Recommended)**<br>2. `/claude-tweaks:flow #{N1}` — pipeline just the first shaped record<br>3. `/claude-tweaks:help` — pipeline dashboard |
| Decomposition mode — single sub-issue record produced | 1. `/claude-tweaks:flow #{N}` — automated pipeline for record #{N}: "{title}" **(Recommended)**<br>2. `/claude-tweaks:build #{N}` — build only (no test/review/wrap-up)<br>3. `/claude-tweaks:help` — pipeline dashboard |
| Multiple sub-issue records produced from a single phase / single-phase doc | 1. `/claude-tweaks:flow #{N1},#{N2},...,#{Nk}` — sequential pipeline, all sub-issues **(Recommended)**<br>2. `/claude-tweaks:flow #{N1}` — pipeline just the highest-priority sub-issue<br>3. `/claude-tweaks:help` — pipeline dashboard |
| Phase-N decomposition with remaining phases in design doc | 1. `/claude-tweaks:flow #{N1},#{N2},...` — pipeline this phase's sub-issues **(Recommended)**<br>2. `/claude-tweaks:specify {doc} phase-{N+1}` — decompose next phase<br>3. `/claude-tweaks:help` — pipeline dashboard |
| All phases decomposed in one run (large multi-phase decomposition) | 1. `/claude-tweaks:flow #{first-phase-sub-issue-Ns}` — pipeline phase 1 sub-issues first **(Recommended)**<br>2. `/claude-tweaks:flow #{all-sub-issue-Ns}` — pipeline everything sequentially (long-running)<br>3. `/claude-tweaks:help` — see the full dependency graph before deciding |

Once the matching situation is resolved, render its numbered list as plain markdown (docs/skill-authoring.md's Skill handoffs convention) — one paste-ready command per line, the entry marked `(Recommended)` in the table renders first with its command bolded and suffixed `(recommended)`. The `work-backend: local-files` id-form note above still applies to every command line rendered this way. For the multiple-records row, `{N1},{N2},...` is the shaped elements only, in list order — an element the batch skipped never appears in the recommended command, and the block renders once, after the last element.

Always recommend `/claude-tweaks:flow` over `/claude-tweaks:build` — `/claude-tweaks:flow` is the canonical path through the pipeline, and the shape gate at materialization time (spec 20's contract) accepts well-structured sub-issue records of any size.
