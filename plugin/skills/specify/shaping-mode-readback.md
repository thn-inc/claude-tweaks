# Specify — Shaping Mode: Read-back and Actions Performed (continued)

Continues `shaping-mode-stamping.md` (this skill's directory) — the metadata block through
compose-then-write-once there, read-back verification and Actions Performed here (#2841's split).
Read it once a record's write call in that file's Compose-then-write-once section has run —
landed, been refused by the pre-write shape check, or failed — or was never needed because the
record was already shaped and fully stamped (skip Read-back verification then; its Actions
Performed row still renders) — on every entry path that file names. Section names are unchanged across the split, so a cross-reference naming a section here
still resolves regardless of which file it lands in; "above" in this file means this file's own
earlier text where the thing named lives here (Read-back verification, the Actions Performed
row), and otherwise `shaping-mode-stamping.md`'s sections (and, before them, `shaping-mode.md`'s),
which precede this file in reading order.

---

### Diagram suggestion

Once this record's write call (`shaping-mode-stamping.md`'s Compose-then-write-once) has run —
landed, been refused by the pre-write shape check, or failed — but before Read-back verification
below, run `diagram-suggestion.md`'s Gate (this skill's directory) against this record. A record
the Near-duplicate candidate check refused (`shaping-mode.md`'s Absorb refusal, reported
`refused — proposed Absorb into #{candidate}`) never reaches Compose-then-write-once, so this
section does not apply to it — `shaping-mode.md` routes it straight to its Actions Performed row,
skipping this section and Read-back verification. When the `diagram-suggestions` flag is
disabled or missing, skip the rest of this section for this record — no scan, no block, no log
line.

When enabled, run `diagram-suggestion.md`'s Detection against this record's already-composed body
(the one assembled in `shaping-mode-stamping.md`'s Compose-then-write-once section — no re-fetch
needed), and hold the result per `diagram-suggestion.md`'s Output format — at most two
recommendations for this record, the two strongest matches, nothing when no signal matches. On a
comma-list batch, run this independently for each record in the batch — the two-per-record cap is
per record, never two for the whole batch.

**Interactive entry** (case 1 or case 5 of `SKILL.md`'s Resolve-the-input, not `--chained`): hold
every record's recommendation(s) and render them together in the `### Diagram suggestions` block
below, after Actions Performed.

**Headless entry** (bare drain / the deprecated `next` alias's headless posture, or `--chained` —
the same two postures `shaping-mode.md`'s own opening section names): never render the block.
Where the STAGED line below goes depends on which of the two headless postures this is — they do
not share a log destination:

- **Bare drain / the `next` alias's headless posture:** a run directory resolved for this
  invocation (`$RUN_DIR`). Log one line per emitted recommendation to `$RUN_DIR`'s decision log
  (the normal `log-decision.js --run "$RUN_DIR" --status STAGED ...` path), per
  `diagram-suggestion.md`'s Rendering section, with this mode's own `{step-id}` set to `Diagram
  suggestion`:

  `STAGED {time} — Diagram suggestion: diagram-suggestion ({type}) for {ref}. Reversibility: high.`

- **`--chained`:** `$PIPELINE_RUN_DIR` is never consulted under `--chained` (`SKILL.md`'s
  Component-Skill Contract) — there is no run directory to log to for this invocation. Fold the
  same STAGED line into this call's own returned output instead, the same convention
  `_shared/worktree-catchup-no-run-dir.md` already uses for the worktree catch-up line under the
  same no-run-dir posture: report it in the caller's own user-facing output (the next reply) in
  place of a `decisions.md` entry — never invent a run-directory path for this invocation, and
  never drop the suggestion silently.

---

### Read-back verification

Immediately after each record's write lands — the `gh issue edit`/`writeRecord` call above, for that record specifically, before moving to the next record in the batch — re-fetch the record fresh (never trust the write call's own response) and assert it landed correctly:

- **`work-backend: github-issues`:** `gh issue view {n} --json labels,body`.
- **`work-backend: local-files`:** `readRecord(path)` (`bin/lib/issues/local-store.js`), re-reading from disk.

Assert, against the re-fetched result:
- `ready` is present, plus every scoring label this record's stamp step (above) added or already carried (`risk:*`, `size:*`, `ceremony:*`, Type). When this pass was entered via the `next` form's headless posture, `shaped:headless` is present too — the atomicity guarantee above is only as good as this check catching a partial write of the two-flag call.
- The six spec-shaped sections (`## Current State`, `## Deliverables`, `## Acceptance Criteria`, `## Release Note`, `## Technical Approach`, `## Gotchas`) plus `## Original request` are all present in the re-fetched body.
- No unresolved placeholder marker (`TBD`, `TODO`, `<!-- ambiguity:`) survived into the written body outside the preserved `## Original request` section (these exact literals — assertion targets, not composed-body mentions — see the placeholder-token rule above).
- `parked` is absent from the re-fetched labels — the stamp step above always removes it on promotion.
- No `needs:*`-prefixed label survived the write — this pass's own removal bullet (above) always
  clears every one the record carried on entry.
- When this record's framing verdict (stamp step above) was `open`, `solution:unjustified` (and the pre-rename spelling `framing:baked`) are absent. When the verdict was `solution-baked`, `solution:unjustified` is present instead, and the Gotchas section carries the folded assumption bullets the stamp step wrote.
- When the Compatibility bullet stamped `breaking`, the label is present in the re-fetched labels
  (`facets.breaking === true` under local-files) **and** the re-fetched body carries a non-empty
  `## Breaking Change` section — a `breaking` record with no section fails
  `bin/compose-subject.js` at merge time, so catch it here.
- When the re-fetched `## Current State`/`## Technical Approach` places the affected component
  outside the plugin (names no `/claude-tweaks:*` skill, `skills/_shared/*` contract, or
  `bin/*.js` behavior as affected — `shaping-mode.md`'s Feedback-filing deliverable check, same
  classifier rule 1 test), the re-fetched `## Deliverables`/`## Acceptance Criteria` must not
  direct `/claude-tweaks:feedback` to file against that component — the mechanical safety net for
  a composition-time miss.

A read-back failure does **not** roll back the write or stop the batch — it follows the same per-record failure-isolation posture as a write failure (above): note the specific assertion(s) that failed, keep shaping the rest of the batch, and surface every record's read-back failure together in Actions Performed below rather than stopping on the first one (`flow/materialize.md`'s Materialization hard gate uses the same all-at-once reporting convention for its own record-level failures).

### Actions Performed

One row per record — a single-record run renders one row, a comma-list batch renders one row per shaped record (a record whose pre-write shape check refused the body, whose write failed, or whose read-back verification (above) failed, renders its row with the failure in the Detail cell instead of the stamps):

| Action | Detail | Ref |
|--------|--------|-----|
| Operational | Shaped record {ref} into spec shape — stamped `risk:{tier}`/`size:{tier}`/`ceremony:{tier}` and Type where each was absent, added `ready`, removed `parked` if present | `{hash}` (local-files) / `—` (github-issues — edit already landed via API, no commit) |

For a comma-list batch, render one row per shaped element, in list order, and prefix each Detail with its outcome: `shaped` (this run edited the record — the row above), `already shaped, no-op` (`compose-record.js --check` exited 0 on the record's live body — `shaping-mode.md`'s Edit the body into spec shape runs it — and every label family was already stamped: nothing written, nothing to undo; a body `--check` rejected is never reported this way), `refused — proposed Absorb into #{candidate}` (`shaping-mode.md`'s Near-duplicate candidate check found a title-similar, `ready` candidate scoring at least 2 signals with a live claim or an open linked PR (`shapingRefusal`, #3141) and stopped before composing — no body write, `needs:decision` stamped instead), or `failed` (the pre-write shape check (Compose-then-write-once) refused the composed body, the write call itself failed, or the read-back verification (above) failed — the Detail cell's own text names which one). There is no `skipped` outcome here — the batch branch's stop-all failure semantics (`SKILL.md`'s `## Input`, Comma-list batch form) mean an unresolvable element never reaches shaping mode at all; every row this table renders is an element that was actually shaped, refused, or attempted-and-failed. The Ref column follows the same per-driver rule on every row.

### Diagram suggestions (optional — render only on interactive entry, and only when the Diagram suggestion section above emitted any)

- {one or two `**Diagram suggestion:** …` blocks held by the Diagram suggestion section above, one per record that emitted any}

Shaping mode ends here — return to `SKILL.md` and render its `## Next Actions` block: the "Shaping mode — one record shaped in place" row of its Situation table for a single record, the "Shaping mode — multiple records shaped in place" row for a comma-list batch (its recommended command lists every successfully shaped record, in the order given). Under `--chained` (see `SKILL.md`'s Input and Component-Skill Contract), or under the `next` form's headless posture (`next-mode.md`), skip Next Actions entirely and return control to the calling skill — the shaped, `ready` record is the whole deliverable; `next-mode.md` has nobody present to read a rendered Next Actions block anyway.

`/specify` adds `ready`, `risk:*`/`size:*` (when unstamped), and Type (when absent), removes `parked` and every `needs:*`-prefixed label on promotion — and, as the one removal carve-out, strips `ready`/`risk:*`/`size:*`/`ceremony:*`/`solution:unjustified` from a record bearing the parent marker (`parent-issue` label / `facets.isParentIssue`) when `SKILL.md` case 1's parent-record guard fires: cleanup of a past mis-shape, reported in output, never prompted — and never touches `auto:*` or `bot:*` — those stay `/backlog refine`'s (human-granted authorization) and `/dispatch`'s (bot-state mirror) territory.
