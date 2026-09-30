# Tidy — Collection Routing

Extracted from `scan-procedures.md` so that file stays under its own budget. Read by the main
thread when assembling the Step 6 report — maps each scan step's `[tag]` prefix to the report
section it renders in.

| Collection prefix | Renders in Step 6 report | Notes |
|---|---|---|
| `[backlog]`, `[parked]`, `[unsynced]`, `[doc]`, `[plan]`, `[git]`, `[registry]`, `[pr]`, `[gh-issue]`, `[parent-gate]`, `[claim]`, `[release-note]` | **Approve ({N})** (or **Applied automatically** when the tier auto-applied it) | Each row gets a pre-filled recommendation carrying its exact executable action. Some of these tags also emit non-mutating outcomes on individual findings — `[backlog]`/`[parked]`/`[plan]` Keep rows land in **Clean:** instead; `[backlog]`/`[parked]` Promote and `[doc]`'s "Run `/claude-tweaks:specify`" outcome land in **Yours ({N})**; `[pr]` awaiting-review and unarmed-ungranted outcomes land in **Yours ({N})**; `[claim]` Release and both missed-restoration backstops (`parked` / `bot:in-progress`) are staged, executable actions here, but `[claim]` Manual review outcomes (unreadable/unparseable blobs, empty-`decisions.md` backstop) land in **Yours ({N})** and Keep (live claim, issue open) lands in **Clean:** — the destination follows the actual routing outcome (`step-6-auto.md`'s Bucket mapping), never the tag alone. `[release-note]` scan errors and repair failures land in **Yours ({N})** (`release-note-repair.md`). |
| `[scoring]`, `[blocked]`, `[legacy]` (`step-1-records.md`'s Shape 5.5), `[acceptance-gap]`, `[sizing]`, `[unfiled]` | **Yours ({N})** | Auto (no-op, always surfaced) at every aggressiveness tier — no mutation exists to stage; each finding carries its own paste-ready command. |
| `[pattern]` | **Yours ({N})** | Informational; presented as items in Yours. |
| `[doctor]` | **Yours ({N})** | Surface-or-suppress, never apply — this step mutates nothing. Deliberately **not** **Approve ({N})**, whose every row carries a mutating Action Vocabulary recommendation. Section omitted entirely when the scan skipped or found nothing. |
| `[calibration]` | **Yours ({N})** | Report-only, surface-or-suppress, never applied — matches `[doctor]`'s semantics. No action drill. |
| `[health]` | **Yours ({N})** — each line carries the finding's own follow-up command (e.g. the matching `/claude-tweaks:*-health` skill or the file to review) | Project-level observations. |
| Keep / nothing-to-report scans (any tag above) | **Clean:** (counted) | Never itemized rows. |
