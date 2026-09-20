# Specify — Shaping Mode (one or more records)

Loaded by `/claude-tweaks:specify` when Resolve-the-input lands on case 1 (a work record reference,
or a comma-joined batch of them — `SKILL.md`'s `## Input`, "Comma-list batch form"), case 5 (a
backlog reference with no matching design doc), or the bare-drain headless entry path (including its
deprecated `next` alias) (`next-mode.md`'s
Shape step, which fetches the claimed record itself and hands it to this procedure directly — the
same in-process invocation `--chained` uses, never a recursive `Skill()` call). Each record already exists and IS the target —
there is nothing to decompose, and none of decomposition mode's Steps 1-9 (`decomposition-mode.md`
+ `decomposition-mode-closeout.md` in this skill's directory) ever run here.

**Batch = the same procedure, once per record.** A comma-list invocation has already resolved every
element (case 1's batch branch) before this file loads. Sniff every record's surface first (Step
2.5a needs only the fetched content) and resolve the one batched design-intent question (Metadata
block below), then run every section below independently for each record, in the order given: its
own five sections + `## Original request`, its own metadata block, its own
scoring/ceremony/framing/type stamps, its own compose-then-write-once call. Two things differ from a
single-record run and are stated where they apply below: interactive decisions raised per record
collapse into one batch table + one `AskUserQuestion` (Metadata block), and the Actions Performed
table renders one row per record. A failure shaping record *k* does not roll back records 1..k-1 —
each write already landed via the API (or on disk); report the failure on that record's own row and
keep shaping the rest.

This procedure is fully self-contained: once it completes, return to `SKILL.md`'s `## Next Actions`
block — except under `--chained`, or under the `next` form's headless posture (`next-mode.md`'s
Shape step), both of which return to the caller instead with no `## Next Actions` render (a comma
list never runs under `--chained` — `SKILL.md`'s `## Input` drops the flag with a notice first, and
`next` never shapes a comma list either — its own Flag rejection rejects it — so a batch always
reaches `## Next Actions`). Kept out of `SKILL.md` because shaping is now the primary path (`#N` record
references are the primary input) and it has no use for decomposition mode's much larger body.

**Parallel-safety.** Under `work-backend: github-issues`, shaping a record writes no local files — it edits the GitHub issue directly via `gh`, so no worktree is required and multiple records may be shaped concurrently with zero collision risk. `work-backend: local-files` does write a tracked file (`writeRecord`) and is not safe to parallelize without isolation.

> **Parallel execution:** On a comma-list batch, the per-record resolution fetch (`gh issue view` / local-store read) and Step 2.5a's surface sniff are independent per-record reads — the same fetches `flow/materialize.md`'s Resolution already parallelizes — and should run concurrently across every record in the batch. The per-record write calls (compose-then-write-once, `ceremony-check #{n}`, `framing-check #{n}`) and the single batched design-intent question stay sequential — not because cross-record writes collide (Parallel-safety above: they don't, each record's write targets its own issue), but because each is a multi-step invocation depending on that record's own already-resolved content and verdicts rather than a single independent read, and the loop itself never fans out (`SKILL.md`'s "a loop never a fan-out — no Task dispatch, one record at a time").

---

### Edit the body into spec shape

Rewrite the record's body into six sections, in this literal shape (`spec-template.md`'s own placement — `### Key Files` nested under `## Technical Approach`):

```
## Current State

{...}

## Deliverables

{...}

## Acceptance Criteria

{...}

## Technical Approach

{...}

### Key Files

- `{path}` — {what changes or new file purpose}
- `{path}` — {what changes}

## Gotchas

{...}
```

`## Current State`, `## Deliverables`, `## Acceptance Criteria`, `## Technical Approach`, and `## Gotchas` are the core of the record body template `spec-template.md` documents — Current State, Deliverables, and Acceptance Criteria are the structural minimum (`_shared/work-record.md`'s spec-shaped-body check re-verifies exactly these three are present and non-empty before the authorization gate will grant anything); Technical Approach and Gotchas can stay brief for a small record. `### Key Files` lists every file path the composed Technical Approach section references, plus — when the work renames a contract surface — every consumer file the rename-grep in `spec-template.md`'s `### Key Files` guidance turns up, plus — always — every generator module the generated-file grep in that same guidance turns up, with the generated entry annotated per that guidance. One bullet per path, in `spec-template.md`'s `- \`{path}\` — {what changes}` format. This is what `/flow`, `/dispatch`, and `/help` read for cross-spec file-overlap detection (`bin/lib/issues/grouping.js`'s `extractKeyFilesSection`) — omitting it silently disables that detection for this record (see Cross-spec conflict detection in `flow/multi-spec.md`). The template's fuller section list (Overview, Non-Goals, Prerequisites, and so on) is decomposition-mode scaffolding for multi-record output — a single shaped record doesn't need it.

Absorb the record's existing content into whichever section it belongs in — a human-filed or captured record's raw text usually becomes Current State plus Deliverables context, with Acceptance Criteria freshly written since raw captures rarely state them explicitly. A record already filed in this shape — every `by:code-health`/`by:harness-health`/`by:journey-health`/`by:docs-health` record is spec-shaped and agent-sized by construction, per `_shared/work-record.md`'s born-ready rule — needs near-zero translation: verify the sections are present and non-empty and move on rather than rewriting content that's already correct.

One authoring constraint on the composed prose itself: never write the literal placeholder tokens `TBD`, `TODO`, or `<!-- ambiguity:` anywhere in a composed body — not even as a *mention* (e.g. "…not as a TODO in the files"). `_shared/work-record.md`'s spec-shaped-body check, re-run by `/claude-tweaks:backlog refine`'s Step 3.5 and the grant gate, greps for these tokens with no context sensitivity, so a prose mention flags the record as carrying an unresolved placeholder and downgrades it back out of `ready`. Paraphrase instead ("a deferred-work comment", "an unresolved marker"). A marker *inherited* inside the preserved `## Original request` copy is different — it is sanctioned: the spec-shaped-body checks exempt that section (#1240), and the verbatim copy must never be hand-edited to remove one.

When a human-filed defect report names a specific affected file, function, or exact error string, do a cheap sanity check before shaping: grep the named artifact against the codebase. A miss doesn't necessarily mean the report is wrong (the code may be newer, or the artifact may genuinely live elsewhere) — but it's a fact-check worth doing at shaping time rather than discovering it mid-build, after a worktree and (under `pr-first`) a draft PR already exist (`#174`).

**Near-duplicate candidate check (#1944), also before composition.** Run `findNearDuplicates`
(`bin/lib/issues/near-duplicate.js`) with this record as subject against every other open record
in this session's already-fetched snapshot (`_shared/record-queue-fetch.md` — invalidate first,
per that file's staleness rule, when this is not the first record shaped in the current
session/batch). This is a screen, not a verdict (memory: similarity scores are
normalization-sensitive) — the finder never blocks shaping on its own signal alone.

When it returns no candidates, proceed straight to composition below. When it returns one or
more, render a three-column table in the shaping output before proceeding —

| Record | Score | Signals |
|--------|-------|---------|
| #{n} | {score} | {signals, comma-joined} |

— and append every candidate as `#{n}` to the composed body's `**Related:**` line (creating the
line if the record doesn't already carry one). A candidate surfaced here is worth a human's
attention even when shaping proceeds normally.

Then check each candidate's own current state. When any candidate is **both** `ready` **and**
either carries `bot:in-progress` or has an open linked PR (the same `closedByPullRequestsReferences`
connection dispatch's own open-PR exclusion reads — `record.js`'s `buildLinkedPRQuery` /
`partitionByOpenLinkedPR`), **stop shaping this record here** — do not compose, stamp, or write
`ready` for it. Instead, add the `needs:decision` label (bootstrap per
`_shared/label-bootstrap.md` if this repo has never stamped it before) and post
`_shared/work-record.md`'s canonical decision-comment, `{unit}` = `specify`:

```
<!-- needs-decision: specify -->
## Decision needed
**Proposed:** Absorb into #{candidate} — close this record as a duplicate rather than shaping it
**Why:** near-duplicate finder found {signals} against #{candidate}, which is `ready` with an
in-flight build (open PR / `bot:in-progress`)
**Command:** `gh issue close {n} --comment "Absorbed into #{candidate}"`
```

Report this record's Actions Performed row as `refused — proposed Absorb into #{candidate}`
rather than `shaped` — the same per-record failure-isolation posture a write/read-back failure
already uses on a batch (below): the rest of the batch keeps shaping. This is the one automatic
refusal the finder's signal authorizes on its own; every other candidate (no `ready` +
in-flight-build match) is surfaced via the table and `**Related:**` append only, mirroring the
refusal grounds an earlier sweep applied by hand for the same reason (#1944).

### Dependency-narration check

After composing `## Current State`/`## Deliverables` above, run `_shared/dependency-narration-check.md`'s check against that text — it catches a body that narrates another record's not-yet-merged follow-up as settled fact and, on a hit, auto-populates a `blocked-by:` edge onto this record before the compose-then-write-once call in `shaping-mode-stamping.md`. This record's own number is already known (it's the target being shaped), so the `work-links: native` branch runs its `bin/link-records.js` call immediately rather than waiting on a post-create step; the `body-text` branch's `Blocked by #{n}` line lands in the metadata block `shaping-mode-stamping.md`'s Metadata block subsection composes, the same placement `Parent: #N` already uses.

### Preserve the original request

Before editing, keep the record's fetched title and body exactly as they were. Append them to the composed body as their own section, using this exact heading — this is a rule, not a suggestion, and the section name is literal:

```
## Original request

{original title}

{original body, verbatim}
```

The shaped sections above are `/specify`'s editorial interpretation; `## Original request` is the record's ground truth if that interpretation ever needs to be checked or redone. The preserved copy is exempt from the spec-shaped-body placeholder check (#1240), so preservation stays byte-exact even when the original text carries a literal `TBD`/`TODO`/ambiguity marker.


**Split across two files (#1346).** This file holds the record-body edit into spec shape, the
spec-shape template, and preserving the original request. The metadata block, scoring/stage-label
stamping, compose-then-write-once, read-back verification, and Actions Performed live in
`shaping-mode-stamping.md`, this skill's directory. Continue there now.
