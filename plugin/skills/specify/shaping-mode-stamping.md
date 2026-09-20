# Specify — Shaping Mode: Stamping and Write (continued)

Continues `shaping-mode.md` (this skill's directory) — the body-shape edit and preserved original
request there, the metadata block through Actions Performed here. Loaded by
`/claude-tweaks:specify`'s shaping mode, the same entry paths as `shaping-mode.md` itself (case 1,
case 5, or the `next` form's headless entry). Section numbering/naming is unchanged across the
split (#1346), so a cross-reference naming a section here still resolves regardless of which file
it lands in.

---

### Metadata block

Run Step 2.5a's frontend-detection sniff (`design-pre-steps.md`) against the record's own content — not a design doc — to decide `Surface:`. When frontend, also run Step 2.5c's design-intent question to decide `Design-intent:` and Step 2.5c2's UI-stack question to decide `Ui-stack:` — under `--chained`, or under the `next` form's headless posture, neither step asks: `Design-intent:` resolves to `none`, and `Ui-stack:` resolves to the `ui-stack` project policy value, falling back to `none — no preference, defer to reference codebase` only when that value is empty (Step 2.5c2's own `--chained` branch; `next` pre-resolves both itself in `next-mode.md`'s Flag rejection step, before this file ever loads, the same "already resolved, just write it" shape a batch's pre-resolved value gets below). On a comma-list batch, run the sniff per record but ask the design-intent question **once** for all frontend records together, and Step 2.5c2's UI-stack question **once** the same way — that step's own "For multi-record decompositions" rule (`design-pre-steps.md`, end of the Step 2.5c2 section) applies verbatim to a comma-list batch: one answer applied across every frontend record in it. Render one batch table (record, sniffed surface, recommended intent and UI stack pre-filled) followed by a single `AskUserQuestion` for apply-all/override, per the Interaction style directive — never one call per record. The UI-stack column pre-fills with one recommended value applied to every frontend row, exactly the mechanic the design-intent column uses; the two steps keep their own separate `AskUserQuestion` definitions in `design-pre-steps.md` (each with its own header and options), so a batch that needs to *override* either recommendation asks that step's own call once for the batch, while the apply-all case resolves both columns in the single table call above. Backend/infra records in the same batch appear in the table with `Design-intent: —` / `Ui-stack: —` and are asked neither question. On a batch, the sniff and both of those single questions already ran once, upfront, per this file's opening paragraph — reaching this section for a given record in the per-record loop below only writes that record's already-resolved values into its own composed body; nothing here fires a second time. Insert a metadata block at the very top of the composed body, above `## Current State` and above `## Original request`:

```
Surface: web
Design-intent: {value}
Ui-stack: {value}
```

Backend/infra records omit the `Design-intent:` and `Ui-stack:` lines entirely — both only apply when Step 2.5a detected a frontend surface:

```
Surface: backend
```

These are plain body-metadata lines, not YAML frontmatter — capitalized keys, no code fence, no `---` markers. This is the wire format `/flow`/`/build` (spec 20's materialization step) lift into the build-time header. When `shaping-mode.md`'s Dependency-narration check found a hit under `work-links: body-text`, add `Blocked by #{n}` here too — the same metadata-block placement `Parent: #N` already uses. Values, for reference:

| `Surface:` | Meaning |
|---|---|
| `web` | Web page / responsive web UI |
| `mobile` | Native app surface — SwiftUI, UIKit, Compose, React Native, Flutter (not a web page merely viewed on a phone) |
| `desktop` | Desktop app UI (takes the design pipeline's web track) |
| `backend` | Server/API/data-layer work, no rendered UI |
| `infra` | Infrastructure/tooling/config work, no rendered UI |
| `terminal` | CLI/TUI surface — help text, output formatting, prompts, exit codes |

| `Design-intent:` | Meaning |
|---|---|
| `bold` | Eye-catching, confident |
| `quiet` | Restrained, refined |
| `minimal` | Strip to essence |
| `delightful` | Personality, micro-interactions |
| `onboarding` | First-run flows, empty states |
| `none` | No specific creative direction |

`Ui-stack:` has no fixed enumeration — it's a free-form string (component library name, styling approach, or an explicit no-preference answer). See `design-pre-steps.md`'s Step 2.5c2 for the preset options offered interactively.

`spec-template.md` stays canonical for the full metadata-block field set these two tables slice — including `Design-seed:`/`Visual-reference:`/`Parent:`, which shaping mode never writes. The `Design-intent:` one-liners above restate `design-pre-steps.md`'s Step 2.5c `AskUserQuestion` descriptions; keep both tables in sync by hand if either enum ever changes. `Ui-stack:` has no enum to restate — Step 2.5c2's preset options are documentation, not a closed value set.

### Stamp scoring and stage labels

Using the facets already read in Resolve-the-input case 1/5 (`parseRecordFacets` for GitHub, the record's own `facets` for local), update independently per family — never touch a family that's already stamped:

- **`risk:*` absent** — judge low/medium/high from the now-shaped Deliverables and Acceptance Criteria (blast radius, reversibility), per `_shared/work-record.md`'s Scoring axis, then stamp it.
- **`size:*` absent** — judge low/medium/high the same way (estimated size), then stamp it.
- **`ceremony:*` absent** — invoke the canonical ceremony-check pattern (`_shared/ceremony-check-invocation.md`) with `#{n}` against the now-shaped body — the same input a fresh fetch would use, but already in memory here. **This call site's delta:** per-record, with `#{n}`, and owns writeback — stamp the verdict as an explicit label, `ceremony:fast-lane` or `ceremony:standard` — never omit it. Bootstrap both label values per `_shared/label-bootstrap.md` before the first write, same as any new label pair.
- **Framing** — invoke `/claude-tweaks:challenge` in `framing-check` mode (`Skill(skill: "claude-tweaks:challenge", args: "framing-check #{n}")`) against the now-shaped body **and** the `## Original request` block preserved above — both passed wrapped per `_shared/untrusted-record-content.md` on every entry path: interactive, `next`, and `--chained` alike (the content originated outside this session regardless of who is present — that file's Scope). See `next-mode.md`'s "The guard's verdict is not reused here" for how this invocation relates to the Framing Guard's own.

  On `FRAMING: open`, stamp nothing and add nothing — absence is the clean state.

  On `FRAMING: solution-baked`, before stamping anything, run one bounded evidence search — a single pass, not iterative — against exactly two sources, for each technology/mechanism name the RATIONALE names as unjustified (search each independently when more than one is named):
  1. Grep the codebase for an existing benchmark/profile/measurement/decision-doc referencing the search term(s), and `CLAUDE.md` for a documented prior decision on the same tradeoff.
  2. `gh issue list --state closed --search "{search term(s)}"` (or `queryRecords('specs', { closed: true })` filtered to title/body match, under `local-files`) for a related closed record.

  **What counts as evidence:** a hit must reference the *same* named technology/mechanism *and* state a measurement, benchmark result, or an explicit prior decision — a bare name match with no such content does not count.

  If evidence meeting that bar is found for every named technology/mechanism, fold it into the composed body's `## Current State` (below, before the compose-then-write-once write call) and re-invoke `framing-check` once against the updated body — the second verdict is the sole authority on whether the justification is now sufficient. If the second verdict reads `open`, stamp nothing (same as the first-pass `open` case above). If evidence is not found for every named item, or the second verdict still reads `solution-baked`, stamp the `solution:unjustified` label and fold the RATIONALE's (or, after a re-invocation, the second verdict's) named assumptions into the body's `## Gotchas` section as bullets, each carrying its validation status.

  If the record already carries `solution:unjustified` (or the legacy `framing:baked`) from an earlier shaping pass (a parked-then-re-promoted record whose framing has since been resolved) and this pass's outcome is a clean `open`, **remove** it — the same promotion-time cleanup shaping mode already applies to `parked`, below. Never stamp `solution:unjustified` on an `open` outcome, and there is no `solution:justified` counterpart to fall back to. Bootstrap `solution:unjustified` per `_shared/label-bootstrap.md` before the first write. Both the Gotchas bullets and the label add/remove ride the single compose-then-write-once pass below — never a second edit.
- **Type absent** — judge `bug | feature | task` from the now-shaped content (defect vs. new capability vs. maintenance/refactor/docs/chore), per `_shared/work-record.md`'s Type axis, then stamp it: `work-backend: github-issues` — `work-types: native` applies the native Issue Type (`--type {t}` on the edit call below); `work-types: labels` adds the matching label instead (`--add-label "type:{t}"`, pair lives in `record.js`'s `TYPE_LABELS` — bootstrap it first per `_shared/label-bootstrap.md`, as decomposition mode does). `work-backend: local-files` — set `facets.type` in the `writeRecord` call below.
- **Compatibility** — stamp `breaking` when the now-shaped Acceptance Criteria name a contract
  change: a removed or renamed public flag, CLI verb, exported function, hook payload field,
  skill frontmatter key, work-record schema field, or `_shared/*.md` convention that existing
  consumers rely on (the same expand-contract signal CLAUDE.md's Philosophy already requires a
  spec to state explicitly — "add the new, migrate every consumer, remove the old"). This is a
  read of the AC *language*, never an inference from a diff, and the headless `next` posture
  applies the identical rule with no extra judgment call. When stamping it, the composed body
  must carry a `## Breaking Change` section (placement in the assembly order below) stating, in
  one short paragraph, what a consumer must change — `bin/compose-subject.js` reads that section
  verbatim as the merge commit's `BREAKING CHANGE:` footer and refuses to compose a
  `breaking`-labelled record that has none. Absent label means "not breaking" — a missed contract
  change is the design's accepted risk, not something to guess at. Bootstrap `breaking` per
  `_shared/label-bootstrap.md` before the first write, as with any new label. Never stamp it on
  a record whose ACs only *add* surface.
- **`parked` present** — remove it; a record entering shaping mode is being promoted out of hold.
- **`needs:*` present** — remove every `needs:*`-prefixed label the record carries (generalizes
  #825's `needs:definition`-only removal authority to the whole family — a record entering shaping
  mode is having its open question(s) resolved by this pass). For each `needs:decision` label
  being cleared this way — a label that owns a live decision comment, per
  `_shared/work-record.md`'s resolution rule — find every unresolved `<!-- needs-decision: -->`
  comment on the record and prepend `**Resolved:** promoted via /specify — {date}` to each, in the
  same edit, before removing the label. `needs:definition` carries no such comment and needs no
  equivalent write.
- **`ready`** — add it (idempotent when already present, e.g. a born-ready record).

**Per-record invocation.** Every run — a single record or a comma-list batch alike — the `ceremony-check #{n}` and `framing-check #{n}` invocations above run once per record; on a batch this means once per record inside the per-record loop, never reused or rendered from memory for a later record. **Self-check before writing:** confirm exactly one `ceremony-check #{n}` and one `framing-check #{n}` Skill invocation exist for this record (two `framing-check #{n}` invocations where the solution-baked evidence path above re-invoked once) before the compose-then-write-once pass below — a divergent ceremony or framing verdict across records, whether within one batch or across sequential single-record runs in the same session, is only valid when each record had its own invocation. **Under the `next` form's headless posture only:** one additional `framing-check #{n}` invocation, made by `next-mode.md`'s own `## Framing Guard` step before this file ever loads, does **not** count toward this self-check. It served a different purpose — routing the claimed record (shape it, or stamp `needs:definition` and stop), computed against the record's raw pre-shaping body — whereas this file's own invocation decides the `solution:unjustified` stamp against the now-shaped body plus `## Original request`. The two verdicts are independent inputs to independent decisions and may legitimately disagree; only this file's own invocation is the one this self-check counts, and only its verdict drives the stamp.

**Resolving live `needs:decision` comments (before the write below), when `needs:decision` is
present:**

```bash
gh issue view {n} --json comments -q '.comments[] | select(.body | contains("<!-- needs-decision: ")) | select(.body | contains("**Resolved:**") | not) | .id'
```

For each returned GraphQL node ID, fetch that comment's current body, prepend `**Resolved:**
promoted via /specify — {date}\n\n` to it, write the result to this run's session-scoped temp file
(`_shared/session-tmp-root.md`), and edit the comment in place — the identical
`updateIssueComment` GraphQL mutation `_shared/pr-run-comments.md`'s Post-or-update procedure Step
2 uses for PR comments, applied here to an issue comment's node ID instead of a PR's (same
`IssueComment` type, same mutation shape):

```bash
eval "$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" "NEEDS_DECISION_RESOLVED_BODY=needs-decision-resolved-{n}-{found-id}.md")"
gh api graphql -f query='mutation($id:ID!,$body:String!){updateIssueComment(input:{id:$id,body:$body}){issueComment{id}}}' \
  -f id="{found-id}" -F body=@"$NEEDS_DECISION_RESOLVED_BODY"
```

Do this for every unresolved comment found — a record refused by both `backlog-refine` and
`backlog-grant` concurrently carries two separate `needs:decision`-labeled comments, and both must
be resolved in this same shaping pass before the label itself is removed below. **Fail closed on
any mutation failure:** if any `updateIssueComment` call above fails, do not proceed to the
`--remove-label "needs:decision"` write in the same pass — leave the label in place (an unresolved
comment must never be silently orphaned by a label removal that didn't actually resolve it) and
report the failure so it can be retried.

### Compose-then-write-once

Assemble the full new body locally before making any write call — never edit the body incrementally against a live record. Final assembly order (`Design-intent:`/`Ui-stack:` omitted for non-frontend records):

```
Surface: {value}
Design-intent: {value}
Ui-stack: {value}

## Current State
...

## Deliverables
...

## Acceptance Criteria
...

## Technical Approach
...

## Gotchas
...

## Breaking Change        ← only when `breaking` is stamped
...

## Original request

{original title}

{original body, verbatim}
```

**`work-backend: github-issues`:** write the composed body to this run's session-scoped temp file (`_shared/session-tmp-root.md`), then a single call carries both the body and every label change (`--type {t}` under `work-types: native`; swap to `--add-label "type:{t}"` under `work-types: labels`):

```bash
SPECIFY_SHAPED_BODY=$(node -e "
  const { sessionTmpPath } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/session-tmp.js');
  console.log(sessionTmpPath(process.env.CLAUDE_CODE_SESSION_ID, 'specify-shaped-body.md') || require('path').join(require('os').tmpdir(), 'specify-shaped-body.md'))
")
gh issue edit {n} \
  --body-file "$SPECIFY_SHAPED_BODY" \
  --add-label ready \
  --add-label "risk:{tier}" \
  --add-label "size:{tier}" \
  --add-label "ceremony:{tier}" \
  --type {t} \
  --remove-label parked \
  --remove-label "needs:definition" \
  --remove-label "needs:decision"
```

Omit `--add-label "risk:{tier}"` / `--add-label "size:{tier}"` / `--add-label "ceremony:{tier}"` for whichever family was already stamped; omit `--type {t}` (or the `--add-label "type:{t}"` swap) when Type was already present; omit `--remove-label parked` when the record never carried it. Omit `--remove-label "needs:definition"` / `--remove-label "needs:decision"` individually for
whichever the record never carried — same omit-when-absent rule as `--remove-label parked` — and
run the comment-resolution mechanics above first when `needs:decision` is one of the labels being
removed. `--add-label "solution:unjustified"` follows a different rule from the three above: it is never about a family already being stamped, and it does not appear in the call by default — add it only when the Framing verdict (above, after the bounded evidence search where applicable) is `solution-baked`; on `open` add nothing. The label is presence-only and absence IS the clean state — most records are `open` (or clear evidence was found), so absence is the common case, not the exception; there is no `solution:justified` counterpart to fall back to. The reverse case needs its own flag: when the outcome is `open` **and** the record already carries `solution:unjustified` (or the legacy `framing:baked`) from an earlier pass, add `--remove-label "solution:unjustified"` (and `--remove-label "framing:baked"` too, when present, to fully retire the legacy label off this record) to the same call — the identical cleanup-on-promotion idiom as `--remove-label parked`, omitted when the record never carried either label. `--add-label breaking` is likewise absent from the call by default — add it only when the Compatibility bullet above stamped it; there is no removal case (a record that stops being breaking is re-shaped, and the label is cleared by hand).

One further flag is keyed to the **entry path**, not to any verdict: when this pass was entered via the bare-drain headless entry path (including its deprecated `next` alias) (`next-mode.md`'s Shape step — this file's opening paragraph names it as an entry path), add `--add-label "shaped:headless"` to this same call, alongside `--add-label ready`. Unlike `--add-label "solution:unjustified"`, this one is **unconditional** whenever the entry was via bare drain — every successful bare-drain shape carries the provenance marker, no exceptions — and it never appears at all under the interactive or `--chained` entry paths, which have a human or a caller in the loop. Carrying it in this call is what makes the pair atomic: `ready` and `shaped:headless` land in one write, so no reader ever observes a bare-drain-shaped record as `ready` (and therefore permanently outside bare drain's own eligibility query) without its marker, and a failed write leaves the record unshaped and still eligible rather than stranded half-stamped. Bootstrap `shaped:headless` per `_shared/label-bootstrap.md` before the first write, same as any other new label.

**`work-backend: local-files`:** one `writeRecord` call does the same job, setting `facets.stage: 'ready'` (which supersedes any prior `'parked'` value — the two are mutually exclusive states) and filling `facets.risk`/`facets.size`/`facets.ceremony`/`facets.type` when they were `null` (`facets.ceremony` always gets a value the first time a record is shaped — no null/unscored state for this axis, unlike `risk`/`size`) and `facets.solutionUnjustified` (unlike `facets.ceremony`, this one is written `true` ONLY on a final `solution-baked` outcome — `false` whenever the outcome is `open`, matching `sharedFacetDefaults()`'s own default) and `facets.breaking` (written `true` only when the Compatibility bullet stamped it, `false` otherwise). When the outcome is `open` and the record's existing `facets` already carry `solutionUnjustified: true` from an earlier pass, clear it — set `facets.solutionUnjustified` to `false` in the same `writeRecord` call rather than leaving a stale `true` on a record that has since re-shaped clean:

```bash
node -e "const {writeRecord}=require('${CLAUDE_PLUGIN_ROOT}/bin/lib/issues/local-store.js');
  writeRecord(process.argv[1], { title: process.argv[2], body: process.argv[3], facets: JSON.parse(process.argv[4]) });
" "$RECORD_PATH" "$TITLE" "$SHAPED_BODY" "$FACETS_JSON"
```

then commit — a local record is a tracked file, unlike a GitHub issue edit. On a comma-list batch, commit **once per record**, immediately after that record's `writeRecord` — never leave some records written and uncommitted while the next one is being shaped:

```bash
git add "$RECORD_PATH"
git commit -m "Shape record {id} into spec shape — ready"
```

Nothing to commit on the `github-issues` driver — the edit above already landed via the API.

### Read-back verification

Immediately after each record's write lands — the `gh issue edit`/`writeRecord` call above, for that record specifically, before moving to the next record in the batch — re-fetch the record fresh (never trust the write call's own response) and assert it landed correctly:

- **`work-backend: github-issues`:** `gh issue view {n} --json labels,body`.
- **`work-backend: local-files`:** `readRecord(path)` (`bin/lib/issues/local-store.js`), re-reading from disk.

Assert, against the re-fetched result:
- `ready` is present, plus every scoring label this record's stamp step (above) added or already carried (`risk:*`, `size:*`, `ceremony:*`, Type). When this pass was entered via the `next` form's headless posture, `shaped:headless` is present too — the atomicity guarantee above is only as good as this check catching a partial write of the two-flag call.
- The five spec-shaped sections (`## Current State`, `## Deliverables`, `## Acceptance Criteria`, `## Technical Approach`, `## Gotchas`) plus `## Original request` are all present in the re-fetched body.
- No unresolved placeholder marker (`TBD`, `TODO`, `<!-- ambiguity:`) survived into the written body outside the preserved `## Original request` section (these exact literals — assertion targets, not composed-body mentions — see the placeholder-token rule above).
- `parked` is absent from the re-fetched labels — the stamp step above always removes it on promotion.
- No `needs:*`-prefixed label survived the write — this pass's own removal bullet (above) always
  clears every one the record carried on entry.
- When this record's framing verdict (stamp step above) was `open`, `solution:unjustified` (and the pre-rename spelling `framing:baked`) are absent. When the verdict was `solution-baked`, `solution:unjustified` is present instead, and the Gotchas section carries the folded assumption bullets the stamp step wrote.
- When the Compatibility bullet stamped `breaking`, the label is present in the re-fetched labels
  (`facets.breaking === true` under local-files) **and** the re-fetched body carries a non-empty
  `## Breaking Change` section — a `breaking` record with no section fails
  `bin/compose-subject.js` at merge time, so catch it here.

A read-back failure does **not** roll back the write or stop the batch — it follows the same per-record failure-isolation posture as a write failure (above): note the specific assertion(s) that failed, keep shaping the rest of the batch, and surface every record's read-back failure together in Actions Performed below rather than stopping on the first one (`flow/materialize.md`'s Materialization hard gate uses the same all-at-once reporting convention for its own record-level failures).

### Actions Performed

One row per record — a single-record run renders one row, a comma-list batch renders one row per shaped record (a record whose write failed, or whose read-back verification (above) failed, renders its row with the failure in the Detail cell instead of the stamps):

| Action | Detail | Ref |
|--------|--------|-----|
| Operational | Shaped record {ref} into spec shape — stamped `risk:{tier}`/`size:{tier}`/`ceremony:{tier}` and Type where each was absent, added `ready`, removed `parked` if present | `{hash}` (local-files) / `—` (github-issues — edit already landed via API, no commit) |

For a comma-list batch, render one row per shaped element, in list order, and prefix each Detail with its outcome: `shaped` (this run edited the record — the row above), `already shaped, no-op` (every section present and non-empty and every label family already stamped — nothing written, nothing to undo), `refused — proposed Absorb into #{candidate}` (`shaping-mode.md`'s Near-duplicate candidate check found a `ready`, in-flight-build candidate and stopped before composing — no body write, `needs:decision` stamped instead), or `failed` (either the write call itself failed, or the read-back verification (above) failed — the Detail cell's own text names which one). There is no `skipped` outcome here — the batch branch's stop-all failure semantics (`SKILL.md`'s `## Input`, Comma-list batch form) mean an unresolvable element never reaches shaping mode at all; every row this table renders is an element that was actually shaped, refused, or attempted-and-failed. The Ref column follows the same per-driver rule on every row.

Shaping mode ends here — return to `SKILL.md` and render its `## Next Actions` block: the "Shaping mode — one record shaped in place" row of its Situation table for a single record, the "Shaping mode — multiple records shaped in place" row for a comma-list batch (its recommended command lists every successfully shaped record, in the order given). Under `--chained` (see `SKILL.md`'s Input and Component-Skill Contract), or under the `next` form's headless posture (`next-mode.md`), skip Next Actions entirely and return control to the calling skill — the shaped, `ready` record is the whole deliverable; `next-mode.md` has nobody present to read a rendered Next Actions block anyway.

`/specify` adds `ready`, `risk:*`/`size:*` (when unstamped), and Type (when absent), removes `parked` and every `needs:*`-prefixed label on promotion — and, as the one removal carve-out, strips `ready`/`risk:*`/`size:*`/`ceremony:*`/`solution:unjustified` from a record bearing the parent marker (`parent-issue` label / `facets.isParentIssue`) when `SKILL.md` case 1's parent-record guard fires: cleanup of a past mis-shape, reported in output, never prompted — and never touches `auto:*` or `bot:*` — those stay `/backlog refine`'s (human-granted authorization) and `/dispatch`'s (bot-state mirror) territory.
