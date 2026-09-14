---
files:
  - plugin/skills/specify/SKILL.md
  - plugin/skills/specify/shaping-mode.md
  - plugin/skills/specify/shaping-mode-stamping.md
  - plugin/skills/specify/spec-template.md
  - plugin/skills/specify/design-pre-steps.md
---

# Shape Several Records in One /specify Call

**Persona:** A claude-tweaks maintainer who has just triaged the backlog and holds three capture stubs (`#701`, `#702`, `#703`) that all need promoting to `ready` before `/claude-tweaks:dispatch` will pick them up, and does not want to run `/claude-tweaks:specify` three times and answer the same prompts three times. The record numbers arrive either hand-picked from memory or pasted verbatim as a `/tidy` Yours group head (`step-6-auto.md`'s Yours grouping) — same batch invocation either way, since the group head *is* the `/claude-tweaks:specify #N,#M,...` command.
**Goal:** Shape all three records into spec shape in one invocation — one command, at most one interactive decision, one summary table, one paste-ready follow-up command.
**Entry point:** A Claude Code session at the project checkout, `work-backend: github-issues`, the record numbers in hand — typed from memory, or pasted straight from a `/tidy` report's Yours section (`/claude-tweaks:specify` shows the grammar `[#N[,#M...]|#A-#B|record-id[,id...]|design-doc-path|topic|backlog-title] [--budget <n|all>] …` as the greyed argument hint, and `/claude-tweaks:help`'s reference card carries the same string).
**Success state:** Every record in the batch is `ready` with `risk:*`/`size:*`/`ceremony:*` stamped, its body carries `Surface:` + the five spec sections + `## Original request`, the Actions Performed table shows one row per record, and the terminal `## Next Actions` block leads with **`/claude-tweaks:flow #701,#702,#703`** — the maintainer never re-derived a command by hand.

## Steps

### 1. Run the batch — one comma-joined token, or a range
- **URL:** `/claude-tweaks:specify #701,#702,#703` — or, for a contiguous run, `/claude-tweaks:specify #701-#703`
- **Action:** Type the record references as one comma-joined, no-spaces token — the same `#A,#B` shape `/claude-tweaks:flow` already documents — or, when the batch is a contiguous run of issue numbers, the inclusive range form (`#A-#B`/`#A–#B`, sigil required on both bounds), which expands to the equivalent comma list before anything else runs.
- **Should feel:** Familiar — the grammar mirrors `/flow`, and the argument hint that appears while typing confirms both the comma and range forms are documented, not guessed.
- **Should understand:** Every element resolves independently (parallel fetches, as `flow/materialize.md`'s Resolution does); if any element cannot be resolved, all unresolvable elements are reported in one message before anything is shaped. A comma list is shaping-mode-only — decomposition (a design doc) and topic resolution stay single-input. The range form is capped at 25 elements (a hard input error names the element count above that) and requires `A ≤ B`; a range collapsing to one element (`A == B`) resolves as an ordinary single record reference, not through the batch path. A bare invocation with no record reference is a different, headless form entirely — it drains the queue via `--budget` (default one record, `all` for the whole eligible set) chosen by the skill rather than any record the user names, and is mutually exclusive with the comma-list and range forms documented here; the pre-#1491 literal `next` argument is a deprecated alias for `--budget 1`, no longer shown in the argument hint.
- **Red flags:** The skill shapes only the first record and stops; the skill asks "did you mean a path or a topic?" for a comma list of `#N` references; a resolution failure on `#703` reported only after `#701` was already rewritten; a typo like `#123-456` (missing sigil on the second bound) silently expanding into a huge range instead of failing as a malformed reference.

### 2. Answer the one batched design-intent and UI-stack question (frontend records only)
- **URL:** the same session, before any record is written
- **Action:** When one or more records sniff as a frontend surface, answer a single batch table (record, sniffed surface, recommended intent and UI stack pre-filled) followed by one `AskUserQuestion` for apply-all/override.
- **Should feel:** One decision for the whole batch, not one prompt per record — backend/infra records appear in the table with `Design-intent: —` / `Ui-stack: —` and are asked neither question.
- **Should understand:** Every record's surface is sniffed before the per-record loop starts, so both questions resolve once, up front, and one answer each applies to every frontend record in the batch; each record's `Surface:`/`Design-intent:`/`Ui-stack:` lines are then written into its own composed body during its own iteration.
- **Red flags:** A second `AskUserQuestion` for the second frontend record; a backend record being asked for a design intent or a UI stack.

### 3. Read one Actions Performed table, one row per record
- **URL:** the same session, after the last write lands
- **Action:** Scan the `### Actions Performed` table.
- **Should feel:** Complete at a glance — every record has a row naming what was stamped (`risk:`/`size:`/`ceremony:`, Type where absent, `ready` added, `parked` and every `needs:*`-prefixed label removed if present, `breaking` added when the shaped Acceptance Criteria name a contract change — #2251), and every record was re-fetched and verified immediately after its own write — not just written and hoped for.
- **Should understand:** Each record was written by its own compose-then-write-once call, then immediately read back (a fresh `gh issue view`/`readRecord` re-fetch, never trusting the write call's own response) to assert `ready` + labels are present, the five spec sections + `## Original request` are present, a `breaking`-stamped record additionally carries a non-empty `## Breaking Change` section (a `breaking` record without one fails `bin/compose-subject.js` at merge time, so the read-back is where it is caught — #2251), `parked` and every `needs:*` label the record carried are absent (a `needs:decision` removal also closes its live decision comment with a `**Resolved:**` line in the same batch iteration), and no placeholder marker survived outside the verbatim-preserved `## Original request` copy (markers inherited there are sanctioned — #1240). A failure shaping record *k* — whether the write itself or its read-back — does not roll back records 1..k-1 — that record's row carries `failed` in the Detail cell and the rest still shape. Under `work-backend: local-files` there is one commit per record. A record whose `needs:decision`-resolving comment edit fails is a legitimate exception to "removed if present": `shaping-mode.md` fails closed and leaves the label in place rather than removing it over an unresolved comment, so that record's row reports the retry, not a clean pass. A third Detail-cell outcome exists alongside `shaped`/`already shaped, no-op`/`failed`: `refused — proposed Absorb into #{candidate}` — the near-duplicate candidate check (#1944) found a `ready`, in-flight-build candidate for this record and stopped before composing, stamping `needs:decision` instead of `ready`. Same per-record failure-isolation posture as a write/read-back `failed` row: the rest of the batch keeps shaping. When a record's Key Files names a file that another module generates (the generated-file grep in `spec-template.md`'s `### Key Files` guidance — #326's incident), the composed body lists that generator module as the primary edit target and the generated entry's own bullet carries a `generated by` annotation — so a shaped record never again points a build at a generated file without its source of truth.
- **Red flags:** A single collapsed row for the whole batch; a failed record silently missing from the table; a record whose write succeeded but whose labels or sections didn't actually land, with no row flagging it; a `needs:decision` label removed from a record whose decision comment failed to resolve; a near-duplicate-refused record composed and stamped `ready` anyway; a record stamped `breaking` whose composed body carries no `## Breaking Change` section.

### 4. Take the paste-ready follow-up
- **URL:** the `## Next Actions` block at the end of the same reply
- **Action:** Copy the bolded first line — **`/claude-tweaks:flow #701,#702,#703`** — and run it.
- **Should feel:** No hand-assembly — the recommended command already lists every successfully shaped record, in the order given.
- **Should understand:** The block is the "Shaping mode — multiple records shaped in place" row of the skill's Situation table; under `work-backend: local-files` the ids are bare (`/claude-tweaks:flow 701,702,703`).
- **Red flags:** A Next Actions block naming only `#701`; an `AskUserQuestion` menu instead of plain paste-ready markdown lines.

### 5. Mix in a non-record element — the honest refusal
- **URL:** `/claude-tweaks:specify #701,docs/superpowers/specs/x-design.md`
- **Action:** Include a design-doc path (or a topic) as one comma-list element.
- **Should feel:** A one-line stop naming the offending element, before anything is shaped — not a misparse into decomposition mode.
- **Should understand:** The batch branch triggers on shape (the first argument contains a comma), then validates every element; `'{element}' is not a record reference — a comma list shapes records only; give a design doc or topic on its own` is the whole error.
- **Red flags:** `#701` shaped and the path silently dropped; the path treated as a design doc and decomposed.

### 6. Pass `--chained` on a batch — the flag is dropped, the batch still runs
- **URL:** `/claude-tweaks:specify #701,#702 --chained`
- **Action:** Add the component-mode flag to a comma list (a mistake — only `/claude-tweaks:capture`'s born-ready chain passes it, and it shapes exactly one record).
- **Should feel:** Forgiving and explicit — a one-line notice that the flag is ignored on a comma list, and both records still shape with `## Next Actions` rendered.
- **Should understand:** This is the flag's existing posture for every unsupported input shape (design doc, topic, decomposition, and now a comma-list batch): ignore with a notice rather than error. `/capture`'s single-record chain contract is unchanged.
- **Red flags:** The whole invocation refused; the batch shaped headlessly with no `## Next Actions`.

### 7. Include a decomposition parent — the batch refuses whole
- **URL:** `/claude-tweaks:specify #701,#416,#703` (where `#416` carries `parent-issue`, or is an unlabeled legacy parent with a `## Leaves` table)
- **Action:** Include a decomposition-parent reference as one batch element.
- **Should feel:** The same all-or-nothing honesty as an unresolvable element — every parent offender named in one message, nothing shaped, no per-offender prompting mid-batch.
- **Should understand:** The case-1 parent-record guard runs per element before anything is written. A labeled (tier-1) parent still gets its mis-shape residue (`ready`, scoring, ceremony, `solution:unjustified`) silently stripped — repair of wrong state, not shaping — and the failure message names any strip that ran. A sniff-only (tier-2) hit resolves like the guard's headless branch inside a batch — no prompt, since a prompt could not change the fail-all outcome — and the message points at `/claude-tweaks:specify #416` to repair interactively.
- **Red flags:** The parent shaped and marked `ready`; the non-parent elements shaped despite the fail-all posture; an `AskUserQuestion` firing mid-batch for a tier-2 offender; a residue strip that ran but went unmentioned.

## Origin
- Step 3 updated for #1944 (near-duplicate candidate check: a third Detail-cell outcome, `refused — proposed Absorb into #{candidate}`, isolated per-record like a write/read-back failure)
- Step 3 updated for #1321 (generated-file grep: a shaped record's Key Files lists a generated entry's generator as primary edit target, with the entry annotated)
- Step 7 added for #1071 (parent-record guard: batch fail-all, tier-2 refuse-without-prompt, reported residue strip)
- Steps 1 and 3 updated for #705 (range-form input, mandatory read-back verification after each write)
- Steps 1-3 updated for #357 (UI-stack decision point — batch table gains a `Ui-stack: —` column alongside `Design-intent:`, resolved by the same single batch decision)
- Persona/Entry point updated for #822 (folded the `/tidy` Yours-group-head paste path in from the retired sibling journey `shape-several-records-in-one-paste.md`, whose Steps 1-4 covered the same batch mechanic under a different entry-point framing and no unique behavior — `shaping-mode.md` explicitly documents "no `skipped` outcome" for the batch table, which is what that sibling had gone stale on)
- Step 3 updated for #1488 (every `needs:*`-prefixed label, not just `parked`, removed if present; a `needs:decision` removal also closes its live decision comment with a `**Resolved:**` line)
- Entry point and Step 1 updated for #1491 (bare drain mode: the argument hint's literal `next` alternative was replaced by a bare invocation plus `--budget`; `next` survives only as a deprecated alias)
- Step 3 updated for #2251 (Compatibility axis — shaping mode stamps `breaking` from the Acceptance Criteria’s contract-change language, and the read-back asserts the composed body’s `## Breaking Change` section)
- Related specs: #1071, #705, #695/#702 (comma-list batch form and this journey's original steps), #357, #822, #1488, #1491
