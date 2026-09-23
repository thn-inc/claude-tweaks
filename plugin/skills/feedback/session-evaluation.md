# Session Evaluation — transcript judge dispatch

Loaded by `skills/feedback/SKILL.md`'s session-evaluation step on bare (or `--queue`) invocation.
Never loaded on free-text invocation — a free-text learning has no transcript to judge.

Follows `_shared/transcript-judge.md`'s shared dispatch harness (transcript resolution, the judge
dispatch's mechanics, slicing guidance, finding norms, self-assessment degradation, and the
watermark protocol) with feedback's own four parameters:

1. **Rubric** — the full body of `skills/_shared/feedback-objectives.md`, inlined verbatim.
2. **Output template** — the literal template below, inlined verbatim.
3. **Model profile** — `frontier`, resolved via `node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-profile.js"
   frontier` (no `--run-dir` — a standalone `/feedback` has no run dir, so `frontierUsed` is 0 and
   the resolver's cap branch passes; one judge dispatch per invocation is the contract's
   standalone-invocation cap for this skill's Frontier singleton, enforced by this skill rather
   than a run-dir tally).
4. **Watermark consumer key** — `feedback`.

## Output template

```
## {objective name — one block per rubric objective, in rubric order}
NO FINDING
— or —
NOT EVALUATED — {reason}
— or —
**Finding:** {symptom, one sentence}
**Evidence:** {transcript excerpt or precise pointer}
**Measurement:** {counts with a session-sizing denominator — countable lenses only; omit the line for judgment lenses}
**Cost this session:** {one line — retries, hand-work, a reverted decision; "unclear" is valid}
**Proposed fix:** {concrete solution idea}

Template note (applies to the Avoidable interactions block only, whichever outcome it renders):
end that block with a Measurement line stating the session total, e.g.
**Measurement:** total AskUserQuestion calls: {N}; {M} of {N} resolved to the pre-marked
Recommended option.

STATUS: {WORD}
```

## Skip check (before dispatch) — #701

Follows `_shared/transcript-judge.md`'s Skip check procedure — stat the resolved transcript's
current size, read the watermark (consumer key `feedback`), and call
`isTranscriptUnchanged(watermark, currentBytes)` (`bin/lib/transcript-judge/watermark.js`) — on
the branch where a transcript path actually resolved, before the judge dispatch. Self-assessment
is exempted from the shared procedure's own check; see `_shared/transcript-judge.md`'s
"Self-assessment is exempted" paragraph, not restated here.

**When `true` (unchanged) and `--full` was not passed:** skip the judge dispatch entirely, per the
shared procedure — no Task agent, no self-assessment. Gather 2 contributes nothing new to this
invocation's merged batch. Report a pointer to the prior watermark's `issueUrls` (below) in the
Step 0 run summary instead of a fresh finding list: "session evaluation unchanged since
{evaluatedAt} — prior filings: {issueUrls, or "none" if empty or absent}." A watermark written
before this field existed (a pre-#701 stamp) has no `issueUrls` at all, not merely an empty one —
treat absent the same as empty rather than surfacing `undefined`.

`--full` bypasses this check entirely (SKILL.md's Input table) and always dispatches fresh,
exactly as today — feedback's own full-reset override, per `_shared/transcript-judge.md`'s
parameterization note.

**When `false` (grown, or no watermark exists):** proceed to the judge dispatch as today, per the
shared procedure.

## Watermark payload

On a `DONE`/`DONE_WITH_CONCERNS` return (per `_shared/transcript-judge.md`'s watermark protocol,
consumer key `feedback`), the payload is:

```
{
  transcriptPath,
  bytesAtDispatch,
  evaluatedAt,
  sessionId,               // $CLAUDE_CODE_SESSION_ID at dispatch time — the transcript path
                           // is the load-bearing lookup key (per _shared/transcript-judge.md's
                           // Watermark key note), but a human or a future consumer reading the
                           // watermark file directly needs the session id without re-deriving it
                           // from the path's basename
  filedRecords,            // the record numbers this run actually filed, from Step 8
  findingsFiled,           // count of Gather-2-sourced findings that reached Step 8's
                           // `gh issue create` this run — filedRecords.length, carried
                           // explicitly so a skip-check summary can report a count without
                           // re-deriving it
  issueUrls,               // the URLs Step 8's `gh issue create` calls produced for this run's
                           // Gather-2-sourced findings, in filing order — what the Skip check
                           // above points a later invocation at instead of re-evaluating
  dismissedSubjects,       // bin/lib/declined-learning/store.js's listDeclined({ source: 'feedback' })
                           // mapped to each entry's subject text, skipping any entry with no
                           // `subject` (a pre-#1033 decline recorded before the field existed;
                           // a bare fingerprint is unmatchable in substance, per watermark.js) —
                           // every declined subject across every /feedback run to date, not just
                           // this one. Filtered to source: 'feedback' so a reflect-sourced decline
                           // never suppresses a feedback finding by accident.
}
```

**`dismissedSubjects` is computed live, immediately before composing `formatOffsetClause`'s item 5
(`_shared/transcript-judge.md`'s "dismissedSubjects sourcing" note) — never read off a previously
written watermark.** This is the fix for the one-run lag a fingerprint-only, snapshot-into-the-
watermark design had (#1033): the watermark write below happens once, right after the judge
returns and before this run's own Step 7 declines exist yet, so a value captured only at write
time would always be missing this run's own declines and only catch up the *next* time a watermark
happens to be written. Calling `listDeclined({ source: 'feedback' })` fresh at the moment the offset
clause is composed removes that extra lag entirely — the only residual gap is the one no design can
remove (a decline made later in *this same* run, after the judge already dispatched). The value
written into the watermark payload below is the same live-computed snapshot, kept for audit
visibility only — a later run never treats it as authoritative; it always recomputes fresh again
itself.

`filedRecords`/`findingsFiled`/`issueUrls` are populated after Step 8 completes, scoped to **this
invocation's Gather-2-sourced items only** — never Gather 1's queue candidates, which have their
own local issue to close and are not what a later skip-check summary should point at. Read Step
8's per-draft result table (SKILL.md Step 8 item 3) and keep the rows whose source item came from
this gather; a row's status of `filed` or `dedup-hit` contributes its issue URL to `issueUrls` and
its record identifier to `filedRecords`. `findingsFiled` is that filtered set's length. No stamp is
written at all when Gather 2's dispatch was reported as failed in the run summary (per SKILL.md's
failure-isolation rule) — an empty or all-failed batch still writes a stamp with `filedRecords: []`
/ `findingsFiled: 0` / `issueUrls: []` only when the dispatch itself succeeded (`DONE`/
`DONE_WITH_CONCERNS`) and simply found nothing to file, which is the ordinary "NO FINDING
everywhere" case, not a failure.

## After the judge returns

Hand each returned finding to `skills/feedback/SKILL.md`'s existing per-finding routing —
classify, dedup, draft, scrub, confirm — per `_shared/transcript-judge.md`'s "After the judge
returns" section.
