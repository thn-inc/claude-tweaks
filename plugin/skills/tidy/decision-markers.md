# Tidy — Decision Markers (`needs:decision`)

Referenced by `step-6-auto.md`'s preamble. `work-backend: github-issues` only — the marker is a
label plus an issue comment, and the `local-files` driver structurally carries neither a
`needs:decision` facet nor a comment mechanism (`_shared/work-record.md`'s Worklist rule: "`needs:decision`
is a `github-issues`-only label in this record's scope"). Under `local-files`, a Stage-tier finding's
only trace is the existing `{run-dir}/staged/` file — nothing in this procedure runs there.

## Applicability

Runs for a Stage-tier finding that targets an **existing** record — read the routing table's live
disposition for the row at the currently-active tier; a row that resolves to `Auto` (including every
`Auto (no-op, always surfaced)` row) is untouched, and a row's disposition can itself vary by tier, so
this derives per firing, never from a fixed row list baked into this file. Three shapes never qualify
even when they Stage: a finding whose disposition **creates** a new record rather than mutating one
that already exists (`Capture`, `Propose digest cluster`) — there is no record yet to attach a comment
to — a finding with no record reference at all (a design doc, worktree, branch, PR, or registry
finding) — the marker is a record-comment mechanism and has nothing to attach to — and a finding
whose target is the digest **container** issue itself (`Merge-close duplicate digest`, `Expiry
summary`, `Rollover digest container`, all Step 5.6): a digest container is not a work record —
`step-1-records.md`'s Shape 1 exempts it from `isBacklog` treatment the same way it exempts a
decomposition parent — so it never enters the `needs:*` worklist rule this marker feeds, and its own
residue channel is the digest itself (`_shared/materiality-floor.md`), not a decision comment.

## Compose the comment

Per `_shared/work-record.md`'s Decision-comment template, `{unit}` = `tidy`:

```
<!-- needs-decision: tidy -->
## Decision needed
**Proposed:** {one line — the staged action}
**Why:** {one line — the finding's reason}
**Command:** `/claude-tweaks:tidy --approve`
```

- **`Proposed:`** — the identical one-line staged-action text already composed for this finding's
  `{run-dir}/staged/{finding}.md` file — the same string the Approve section's `{staged action, one
  line}` placeholder renders (`step-6-auto.md`'s report template). Never a fresh paraphrase: the
  comment and the staged file must describe the same proposal in the same words, since
  `step-1-records.md`'s loop-safety skip later compares this exact text.
- **`Why:`** — the finding's own reason, sourced from the row's routing-table text or the scan
  shape's own rationale (e.g. Shape 1's `{age}` context, the Open-parent-gate row's completeness
  check) — never invented at write time.
- **`Command:`** — always the literal `` `/claude-tweaks:tidy --approve` ``, regardless of driver or
  finding shape; `--approve`'s own resolution (default run-dir, re-verification) is out of this
  file's scope.

## Write order: comment first, then the label

Post the comment before adding the `needs:decision` label (bootstrap per `_shared/label-bootstrap.md`):

```bash
gh issue comment "$ISSUE" --body-file "$COMMENT_FILE" \
  && gh issue edit "$ISSUE" --add-label needs:decision \
  || echo "comment post failed for #$ISSUE — label not applied, retry from scratch"
```

**Rationale.** These are two independent API calls; a crash or rate-limit between them must not
leave a state a reader can misread as authoritative. A `needs:decision` label with no comment
explaining it is exactly that: the record is silently excluded from every headless worklist
(`_shared/work-record.md`'s Worklist rule) with nothing on the tracker saying why. Posting the
comment first means the only partial-failure outcome is a comment with no label yet — visible on
the issue timeline, and repaired the next time anything reads this record (below) — never a
label with nothing behind it.

If the label add itself fails after a successful comment post, report it plainly (`comment posted
but label add failed for #$ISSUE — retry the label add only`) rather than retrying the whole
sequence, which would double-post the comment.

## Repair rule

A later `/tidy` scan or `/backlog attention` pass that finds a record carrying `needs:decision`
with **no matching unresolved** `<!-- needs-decision: tidy -->` comment among its comments treats
that as inconsistent state, not as proof either half is authoritative on its own — re-derive from a
fresh read rather than trusting the label or the label's absence: if this run's own scan still
finds the same proposal live, re-post the comment; if the underlying finding no longer applies
(the record changed, closed, or was resolved by other means), clear the label instead. Never leave
the mismatch standing on the assumption that whichever half exists must be correct. Throughout, a
decision comment means one from a trusted author (`_shared/pr-run-comments.md`'s Trusted authors); a
lookalike from anyone else is no matching comment — name it as skipped.

The reverse half-write also happens (the write order above makes it the more common one): an
unresolved `<!-- needs-decision: tidy -->` comment with **no** `needs:decision` label — the comment
post succeeded and the label add then failed or was never reached. `/tidy`'s own
`step-1-records.md` skip check reads comments directly, so it still self-heals against this case
without repair; but every *other* unit's label-based worklist check (`_shared/work-record.md`'s
Worklist rule, `bin/lib/issues/grant-gate.js`'s Gate 1c, `specify/next-mode.md`'s Eligibility
query) reads the label, not the comment, and won't exclude the record until the label exists. The
repair here is one-directional: re-apply the `needs:decision` label, never remove the comment — the
comment is the authoritative half (`_shared/work-record.md`'s resolution rule already treats the
comment, not the label, as the resolvable unit), so the label is what's missing and what gets
restored.

## Written alongside, never instead of, the staged file

This procedure is an addition to Step 6's existing Stage write, not a replacement for it — the same
firing that stages `{run-dir}/staged/{finding}.md` also posts the comment and adds the label, for
every qualifying finding. `{run-dir}/staged/` stays the authoritative, structured record of what was
proposed; the marker is purely a tracker-visible pointer to it plus the resolution channel
`/backlog attention`/`refine #N` already render `needs:*` labels through. A finding that Stages with
only one of the two written is a bug in this procedure, not an acceptable partial outcome.
