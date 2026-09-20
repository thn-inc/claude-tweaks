# Tidy — Digest Sweep

The digest sweep's procedures, extracted into their own lazy-load unit so `SKILL.md` keeps only a
short trigger paragraph pointing here (`SKILL.md` sits close enough to its 46,080-byte ceiling
that this sweep's prose does not fit inline — measure with `wc -c` before adding to it).

The dispatcher reads this file **whole** and inlines it into the relevant agent's prompt when this
sweep is in scope (an unscoped run, or `--scope=backlog`/`--scope=github` per the driver the
digest container lives on); subagents cannot read sibling files, so everything the sweep needs is
here or in the `_shared/` fragments this file names for the dispatcher to inline alongside it.

---

## Digest sweep (Step 5.6)

No-ops silently when no open `digest`-labeled issue exists (`work-backend: github-issues`) or
`specs/digest.md` doesn't exist (`work-backend: local-files`) — nothing has routed yet (#1262 has
not landed, or no below-floor finding has fired since it did). Four procedures run in order
against whatever container exists, per `_shared/materiality-floor.md`'s Container section. Every
output below routes through `SKILL.md`'s Action Vocabulary (`Merge-close duplicate digest`,
`Propose digest cluster`, `Expiry summary`, `Rollover digest container`) and `step-6-auto.md`'s
matching tier rows — none of these bypasses Step 6/7.

### Bootstrap-race repair

When more than one open `digest`-labeled issue exists (a creation race in
`_shared/materiality-floor.md`'s lazy bootstrap), merge the newer issue's comments into the older
(in creation order) and close the newer with a comment pointing at the surviving issue — the
`Merge-close duplicate digest` action, Stage at every tier (`step-6-auto.md`). Runs before
promotion/expiry below, since both need a single container to operate against. No analogous race
exists on `work-backend: local-files` (single-writer backend) — skip this procedure there.

### Cluster promotion

Read every active entry line (no trailing marker — neither a promotion `→ {id}` nor an expiry
`→ expired`) across the container's comments (`github-issues`) or body (`local-files`), per
`_shared/materiality-floor.md`'s entry format. Group by `{area}` (the entry format's first field).
A re-encountered finding never produces a second active line to read here in the first place —
`_shared/materiality-floor.md`'s Dedup section has every routing skill check
`isMaterialityDuplicate` before appending, so this sweep's own count is never inflated by
repeated firings of one recurring finding.
When **3 or more** un-promoted entry lines share the same `{area}`, propose one spec-shaped issue
absorbing them — each entry becomes one Deliverables bullet, the cluster's shared `{area}` becomes
the proposal's title subject. Present the proposal per this project's standard staged-item flow
(`{run-dir}/staged/digest-promotion-{n}.md`) — the `Propose digest cluster` action, Stage at every
tier (`step-6-auto.md`).

On approval: file the proposed record, then append `→ {id}` to each promoted entry **line** in the
container — `→ #{n}` under `work-backend: github-issues`, `→ {n}` under `work-backend: local-files`
(this project's `#`-optional record-reference convention, `_shared/work-record.md`). Markers and
counting are strictly per-line, never per-comment, since one comment can hold many entries from one
run.

Individual entries — including solitary ones that never cluster — remain manually promotable or
re-filable at any time; the ≥3 threshold gates only this sweep's own automatic *proposals*, never a
human's ability to act on a single entry directly.

### Expiry

Un-promoted entry lines older than 90 days (parsed from each entry's `{provenance}` — a run-id's
ISO timestamp, or the comment/edit timestamp when provenance names a skill instead of a run) roll
into one closing summary comment naming every expired entry; those lines then move out of the
active set — the `Expiry summary` action (`step-6-auto.md`: Stage at every tier on `github-issues`,
Auto-apply at moderate+ on `local-files`, a tracked-file edit). An entry whose `{provenance}` cannot
be parsed to either date form is left un-promoted and excluded from this sweep's expiry set — never
guessed at — since the `local-files` Auto-apply path has no staging review to catch a misclassified
age before the file edit lands. On `github-issues`, the summary
comment is the durable record (the entries themselves stay in the closed comment's history —
nothing is deleted); append `→ expired` to each rolled-in entry **line**, the same per-line marker
mechanism Cluster promotion uses above, so a later sweep's "no trailing marker" read excludes it
and never re-summarizes the same entry twice. On `local-files`, no marker is needed — the entry
lines physically move to an `## Archived {YYYY-MM-DD}` section at the bottom of `specs/digest.md`,
which the active-set read already excludes by location.

### Container rollover

When the digest issue reaches 100 comments (`github-issues` only — a file has no analogous limit),
close it with a summary comment, then bootstrap a fresh digest issue: the `digest` label and the
pinned-issue role move to the new issue (unpin the old, pin the new), and the closed issue's
comment history remains the archive for everything it held — the `Rollover digest container`
action, Stage at every tier (`step-6-auto.md`).
