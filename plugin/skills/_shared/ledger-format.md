# Ledger Format — Shared Contract

Canonical definition of the pipeline ledger's file format, status lifecycle, phase taxonomy, and resolve-gate procedure. Read by `/claude-tweaks:build`, `/claude-tweaks:test`, `/claude-tweaks:review`, `/claude-tweaks:wrap-up`, and `/claude-tweaks:flow` as a knowledge dependency — none of them invoke `/claude-tweaks:ledger` through the Skill tool; they read this file to learn the format, then read/write `docs/plans/YYYY-MM-DD-{feature}-ledger.md` directly using file operations. `skills/ledger/SKILL.md` is the thin skill for the two standalone human commands (`/claude-tweaks:ledger`, `/claude-tweaks:ledger resolve`) and cites this file rather than restating the contract.

## Ledger File Format

### Location

```
docs/plans/YYYY-MM-DD-{feature}-ledger.md
```

The `{feature}` name matches the execution plan or spec topic. One ledger per pipeline run.

### Format

```markdown
# Open Items — {spec title or design topic}

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build/ops | Set `API_KEY` in environment — referenced in `src/api.ts` (reason-not-auto: auth-not-configured — `gh secret set` requires `gh auth login` first) | open | — |
| 2 | review | Missing validation on `updateUser` input | fixed | Added zod schema — `abc1234` |
| 3 | test | Login story fails — selector `.login-btn` not found | open | — |
```

### Item Numbering

Items are numbered sequentially starting at 1. New items always get the next available number. Numbers are never reused — if item 3 is resolved, the next item is still 4.

### De-duplication on Append

Before appending, check existing items for semantic duplicates. If an item with the same phase and a substantially similar description already exists, skip the add and note "Duplicate — matches item #{N}" in the writing skill's own output — never silently skip.

## Status Lifecycle

```
open → fixed         (item was addressed in code)
open → deferred      (staged as a work record proposal — parked, with origin, files, and trigger — resolved at the run's Queue writes surface)
open → accepted      (intentional decision, with stated reason)
open → acknowledged  (for ops items — user is aware, requires action outside codebase; staged as a work record proposal — backlog — resolved at the run's Queue writes surface, same as deferred)
observation          (informational, non-blocking — e.g., QA caveats)
```

**Terminal statuses:** `fixed`, `deferred`, `accepted`, `acknowledged`, `observation` — these items are resolved and will not block the pipeline.

**Non-terminal status:** `open` — these items block pipeline completion.

**The status enum is closed.** Those five terminal values plus `open` are the only values a Status cell may hold — there is no `resolved`, `staged`, `done`, or `closed` status. "Resolved" in this file's own prose describes the *condition* of a terminal item, never a value to write into the column; an item that is settled takes the terminal status that says *how* (`fixed`, `deferred`, `accepted`, `acknowledged`), and a staged proposal is `deferred` with the staging path in its Resolution text. Writing an out-of-enum value does not fail loudly — `parseLedger` (`bin/lib/wrap-up/pack.js`) counts only `open` as blocking, so anything it does not recognize is silently treated as terminal.

**Resolution-text requirements.** `open` moves only to a terminal status, and only with resolution text (`observation` excepted). Terminal statuses are final — a wrong fix gets a new item, never a reopen. Per status: `fixed` includes the commit hash or file reference; `deferred` includes origin, affected files, and the trigger for when to revisit; `accepted` includes the stated reason why this is acceptable.

User-facing "Drop" choice in the resolve gate maps to status `accepted` with reason `dropped per user` (see this file's Resolve Gate section, Phase 3, for the full disposition table).

## Phase Taxonomy

Each item is tagged with a phase indicating where it was discovered.

**Schema:**

```
Phase     ::= Skill | Skill "/" Qualifier
Skill     ::= "build" | "test" | "review" | "reflect" | "wrap-up" | "ops" | "flow" | "design"
Qualifier ::= "ops" | "skill" | "hindsight" | "qa"
```

The qualifier adds specificity when a skill produces multiple finding types, but is optional. Downstream filters (e.g. the Wrap-Up Review Console) parse the phase string by splitting on `/` — keep the format strict.

| Phase | Source | Typical Items |
|-------|--------|---------------|
| `ops` | `/claude-tweaks:build` | Manual steps from spec that survived auto-classification triage, or discovered at AC-verification time inside the build itself (only items with a `reason-not-auto` qualifier — see below) |
| `build` | `/claude-tweaks:build` | Architecture deviations, blocked work, shared constants |
| `build/ops` | `/claude-tweaks:build` | Operational requirements that survived the platform probe — auto-executable items do not appear here |
| `build/skill` | `/claude-tweaks:build` | Skill update candidates from build observations |
| `test` | `/claude-tweaks:test` | Standard verification failures (types / lint / tests) |
| `test/qa` | `/claude-tweaks:test` (QA mode) | QA story failures and observations from `qa-reporting.md` Phase 5.5 |
| `review` | `/claude-tweaks:review` | Code review findings (all categories) |
| `review/skill` | `/claude-tweaks:review` | Skill update candidates from review |
| `review/hindsight` | `/claude-tweaks:reflect` (hindsight mode, via /review) | Implementation hindsight findings |
| `wrap-up` | `/claude-tweaks:reflect` (full mode, via /wrap-up) | Reflection insights |
| `reflect` | `/claude-tweaks:reflect` (standalone) | Standalone reflection findings |
| `design` | `/claude-tweaks:flow` (polish phase, via `/claude-tweaks:design-wrapper`) | One entry per design-wrapper command invoked during polish — `fixed` for each `commands_invoked` entry (a command the wrapper actually dispatched), `observation` for each `staged_suggestions` entry (nothing ran; it awaits a human at the Review Console) |

> **Phase taxonomy:** Use the item description and category column to distinguish finding types within a phase. Sub-phases (`build/ops`, `build/skill`, `review/skill`, `review/hindsight`, `test/qa`) carry semantic meaning that downstream skills filter on — keep them distinct. Lens-specific review sub-phases (e.g., `review/convention`, `review/ux`, `review/coverage`) collapse into `review`; the lens is recorded in the entry body, not the phase.

### Required for `ops`-phase items (`ops`, `build/ops`)

All `ops`-phase items must embed a `(reason-not-auto: {value})` qualifier in the Item description. This forces the writer to justify why the pipeline cannot resolve the item rather than reflexively routing "outside the codebase" tasks to manual.

| Value | When to use |
|-------|------------|
| `no-cli` | Dashboard-only, physical, or vendor-side — no programmatic interface exists |
| `requires-judgment` | A name, value, or copy decision someone must make at execution time |
| `requires-signoff` | Security, legal, change-management, or product approval gates the action |
| `auth-not-configured` | A CLI exists but credentials aren't set up on this machine. After the user runs the login command, the item should be re-triaged — it often becomes auto-executable. |
| `live-verification` | The AC's own verification is itself a real, side-effecting, hard-to-reverse action against shared state (a live PR/merge/delete cycle, an irreversible external API call) — never executed inline during an autonomous run to prove the AC; deferred here instead. See `_shared/auto-mode-contract.md`'s Never-reversible list. Worked example: #683's AC4 (a live worktree/PR/merge/teardown cycle). |

Items without a `reason-not-auto` qualifier are classification errors (the spec writer or the build skill missed the triage). If you encounter one, propose the correct classification rather than appending as-is — most "outside the codebase" tasks have a CLI and should not land here.

## Resolve Gate (Nothing-Left-Behind)

The critical gate that prevents dropped work. Called by `/claude-tweaks:wrap-up`'s Phase 3 ledger gate and `/claude-tweaks:flow` Step 5 — the latter only when `wrap-up` is in that invocation's resolved step list (`flow/steps-and-gates.md`'s **Partial step lists**). That condition defers *when* the gate runs onto the invocation that reaches wrap-up; it does not silence it, and does not touch the `auto` rule below.

The gate runs in three phases. The agent does Phase 1 silently; Phases 2 and 3 always require explicit per-item user input.

**`auto` mode does NOT silence this gate.** Per-item user input on the resolve gate is mandatory regardless of mode. For the full list of what `auto` silences (and what it does not), see `_shared/auto-mode-contract.md`. The one narrow exception is the autonomy ceiling's `ledgerNarrowing` bookkeeping capability (locked at `supervised`, unlocked from `trusted` up) — see `_shared/autonomy-ceiling.md` and the narrowing step at the top of Phase 2 below.

**The pipeline cannot complete with unresolved items.** This is a hard gate.

**Write-back contract.** Whatever procedure decides an `open` item's disposition — this gate's own Phase 1/2/3, a staged finding applied at the Review Console (`_shared/staged-patch.md`'s Write-back to the ledger), or an agent catching and correcting its own earlier misdiagnosis of an item later in the same run — updates that item's Status/Resolution columns in the ledger **file** at the point the decision is made. `decisions.md` is the audit trail of *why*; the ledger file is the source of truth for *what state the item is in*. A same-run misdiagnosis correction (an earlier read of an item turns out wrong, and a later step in this same run establishes the real disposition) is not a new item and not a reopen of a terminal one — it is the first terminal write for that item; log the correction to `decisions.md` for the record, but the ledger file itself only ever shows the corrected, final status.

---

### Phase 1 — Exhaust fixes (agent, silent)

**Re-check before attempting a fresh fix.** An item can already be resolved outside this run — the commit/issue/PR reference in its own Item text (or the `Ledger:` back-reference on a staged patch that already applied per `_shared/staged-patch.md`) may point at something that landed since this item was appended: a self-contained follow-up PR, a backlog issue filed by an earlier Phase 2/3 pass and since closed, or a Review Console apply this same run already logged. Check each `open` item's cited reference (`gh pr view` / `gh issue view` on any `#N` it names, or a `git log --grep` on any commit hash it names) before spending a fix attempt on it: already merged/closed/applied → skip straight to updating status (`fixed` with the resolving commit/PR, or the terminal status the closed reference itself establishes) and move to the next item, exactly as if Phase 1 had fixed it. This is the mechanism that covers a low-confidence finding deliberately left `open` for human attention that later gets fixed in a separate PR outside this gate's own view — no live auto-sync is needed (the fix is inherently post-hoc), only that this gate stops proposing a redundant fix (or a redundant Phase 2 drill question) for work that is already done.

**Exclusion: an item with an unapplied staged proposal.** An `open` item whose text carries its own `Ledger:` back-reference to an unapplied `staged/{name}` proposal (e.g. a `review-{n}.patch` from `/claude-tweaks:review`'s Step 3 Routing) is excluded from this phase's fix-exhaust and from Phase 2's per-item drill below, even when it would otherwise qualify under the Fix-now criteria — its resolution path is the Review Console's apply step (`_shared/staged-patch.md`), which is where the finding's own routing disposition (e.g. `review-auto-apply-ceiling`'s STAGED gate) is meant to get a human's explicit sign-off. Applying it silently here would bypass that gate for exactly the findings it was staged to protect.

For each remaining item with status `open`, attempt to fix it now. **The default is fix; defer is the exception.** Whether an item qualifies for fix-now, and which reasons for skipping a fix are never legitimate, are defined once in `_shared/deferral-gate.md` (its Fix-now criteria and Bad reasons to skip a fix sections) — apply that gate here exactly as written there. If the item qualifies, fix it, commit it, update status to `fixed` with the commit hash. Do this BEFORE presenting anything to the user.

---

### Phase 2 — Present remainder (per-item user input required)

#### Ledger narrowing (runs first, before the table below)

Resolve the `ceiling` per `_shared/autonomy-ceiling.md`'s existing precedence ladder. If
`bookkeepingPermissions(ceiling).ledgerNarrowing === true` (`bin/lib/issues/autonomy.js`), before
building the table below, check each remaining `open` item's Phase 1 blocker reason against
`bin/lib/issues/autonomy.js`'s `clearsFloor(blockerReason)`. For every item where it
returns `true`: auto-select `Route to a record → Keep (backlog)` — the only disposition this
capability ever authorizes from this drill; never `Fix anyway`, `Accept`, `Drop`, or `Defer →
parked` — compose the staged-proposal body exactly as Phase 3's `Keep` branch below already does (the staged header's `Defer-reason:` value is the reason that cleared the floor: the structured value itself when the check read one, else the structured twin of the matching regex group per `_shared/deferral-gate.md`'s floor-mapping table),
update ledger status to `deferred` (note `→ backlog`), and log:

```
AUTO {time} — Ledger Phase 2: item #{N} auto-routed to backlog (defer-reason: {value}) — landing: born-ready. Reversibility: high.
```

**Standalone run (no pipeline run directory resolves — see `_shared/pipeline-run-dir.md`):**
there is no `staged/` directory or `decisions.md` to write to, and no Review Console to later
reconcile a staged file into a real record. Note what the reason is **not**: the console is no
longer mode-gated — it runs in every mode, including interactive and standalone wrap-up. It is
absent here because this is `/claude-tweaks:ledger resolve` invoked outside any `/flow` or
`/wrap-up` run at all, so no wrap-up ever executes to render one. Apply Phase 3's standalone
"create directly instead of staging" behavior inline here instead — create the record now via
the same dual-driver contract Phase 3 uses (`gh issue create` / `local-store.js`'s `writeRecord`),
and surface the auto-routing decision in this run's summary output in place of the `decisions.md`
entry above, since no run-dir log exists to write it to.

Remove the item from this phase's remaining set — it does not appear in the table below and does
not get an `AskUserQuestion` drill. Items whose blocker reason returns `false` (ambiguous, or
outside the four categories) fall through to the unchanged per-item drill below — the floor check
fails closed, exactly as if the capability were locked for that one item.

**`ledgerRouteRemainder` (`unattended` only) — the items the floor check above leaves behind.**
`ledgerNarrowing` (checked above) is `trusted`+; `ledgerRouteRemainder` is a stricter,
`unattended`-only capability that widens the *same* routing one step further — see
`_shared/autonomy-ceiling.md`. It is a separate mechanism from `queueWriteAutoFile` (which files
the *record itself* once staged, not whether an item gets routed here at all) — do not treat one
as an earlier unlock of the other. When `bookkeepingPermissions(ceiling).ledgerRouteRemainder ===
true`, after the narrowing check above, run the same `clearsFloor(blockerReason)` test again
against every item still `open` — items the narrowing step already routed are gone from this set
by construction, so this never double-routes one. For every item where it returns `true`:
auto-select `Route to a record → Keep (backlog)` — the same restricted disposition
`ledgerNarrowing` uses and no other (`Fix anyway`, `Accept`, `Drop`, and `Defer → parked` are never
auto-chosen at any tier — this capability only widens *routing*, per the family's Non-Goals), stage
the record proposal exactly as Phase 3's `Keep` branch does, update status to `deferred` (note
`→ backlog`), and log — one field set beyond `ledgerNarrowing`'s line, since the report (below, and
`wrap-up/summary-template.md`'s "Routed to backlog" section) needs the new record's own ref and a
short description to render a row from:

```
AUTO {time} — Ledger Phase 2: item #{N} auto-routed to backlog as {ref} (defer-reason: {value}) — landing: born-ready — "{one-line description}". Reversibility: high.
```

At `supervised`/`trusted` (this capability locked), and for any item whose blocker reason still
returns `false` even under this wider check, nothing changes here — the item falls through to the
unchanged per-item drill below exactly as today. "Nothing stays unresolved" is true at `unattended`
only; the fail-closed-to-asking rule stays correct wherever a human can actually answer.

After Phase 1 (and, when the capability is unlocked, after the narrowing above), only items that qualify for
neither — Phase 1's fix-now criteria nor the narrowing's floor check — remain `open`. Present the
full table once, upfront — it is not re-rendered per item as the drill below proceeds:

```
### Unresolved Open Items

| # | Phase | Item | Why not fixed now |
|---|-------|------|-------------------|
| {N} | {phase} | {description} | {specific blocker — one of `_shared/deferral-gate.md`'s `Defer-reason:` values} |
```

Immediately below the table, before starting the drill, tell the user once: *"No item here has a safe default, so each gets its own question below — but if several should get the same treatment, say so in your answer to the first one (e.g. via 'Other') and I'll apply it to the rest."* This is the only place the hint appears — it is not repeated per item, and it is plain text, not a presented button (see Guardrail below).

Both `parked` and `backlog` are valid stage destinations for a new work record (see `_shared/work-record.md` for the full stage vocabulary) — the user picks per item. Rough guidance to surface alongside each row if helpful (not a rule):

- **`parked`** when the item has a clear trigger ("revisit after P5 ships," "when consumer X exists")
- **`backlog`** (no stage label) when the item is a captured idea without a specific trigger yet — to be triaged later

For each item, run a two-step drill, chunked per `_shared/batched-item-drill.md`'s contract (the old one-`AskUserQuestion`-per-item shape exceeded a reasonable call count for any batch bigger than a handful of items):

**Guardrail:** No chunk of this drill may gain a shared "apply to all" option answered once for the whole chunk — the checkbox state (Step 2a) or each item's own distinct question (Step 1, Step 2b) *is* the per-item choice. Bulk routing is user-initiated via `Other` only, never a presented default. See Anti-Patterns: "Bulk-resolving open items without per-item user input."

**Step 1 (always).** Step 1 is a genuine three-way choice (Fix anyway / Route to a record / Close out) — a checkbox can't represent "which of three sets," so this step uses **bundled single-select chunking**: up to 4 remaining items' separate single-select questions in one `AskUserQuestion` call (chunked per the shared contract), each item keeping its own distinct question and its own three options:

- `question`: `"How do you want to handle item #{N}: {short description}?"`, `header`: `"Item #{N}"`
- Option 1 — `label`: `"Fix anyway"`, `description`: `"Address it now even though it expands scope"`
- Option 2 — `label`: `"Route to a record"`, `description`: `"Defer (new record, parked) or keep (new record, backlog) — staged for per-item approval before the record is created"`
- Option 3 — `label`: `"Close out"`, `description`: `"Accept, acknowledge, or drop it"`

None of these three options carries `(Recommended)` — Phase 1 already fixed everything fixable; every remaining item is a genuine judgment call with no safe default. Restate the free-text override hint (shared contract) in this chunk's first question.

**Step 2a (only for items that chose "Route to a record" in Step 1) — genuinely binary, so this step uses multiSelect chunking**: one `multiSelect: true` `AskUserQuestion` call per chunk of ≤4 items in the "Route to a record" subset, one checkbox per item — checked = `Keep` (new record, backlog), unchecked = `Defer` (new record, parked). No item is pre-checked — every remaining item is inherently ambiguous (that's why it wasn't auto-routed by the narrowing step above), so there is no sensible default to pre-check toward.

- `question`: `"Where should these items go? (checked = Keep/backlog, unchecked = Defer/parked)"`, `header`: `"Route items"`

**Step 2b (only for items that chose "Close out" in Step 1) — three-way (Accept / Acknowledge / Drop), so this step keeps bundled single-select chunking**, same shape as Step 1: up to 4 items' separate single-select questions per `AskUserQuestion` call, chunked over the "Close out" subset:

- `question`: `"How should item #{N} be closed out?"`, `header`: `"Close item #{N}"`
- Option 1 — `label`: `"Accept"`, `description`: `"Intentional, with stated reason"`
- Option 2 — `label`: `"Acknowledge"`, `description`: `"Ops item requiring action outside the codebase — filed as a trackable backlog record"`
- Option 3 — `label`: `"Drop"`, `description`: `"No longer relevant"`

None of Step 1/2a/2b's options carries `(Recommended)` — every remaining item is a genuine judgment call with no safe default (Step 2a's binary encoding is a checkbox with no pre-check, not a recommendation).

**Step 1 must fully resolve (across however many chunked calls it took) before Step 2a/2b begin** — which items go to 2a vs. 2b isn't known until Step 1's responses return.

**Wait for the user's reply at every chunk.** Do NOT pre-classify items, do NOT pick "obviously correct" resolutions, do NOT auto-route to "apply all" — every remaining item gets an explicit per-item response (a checkbox state or its own distinct question), across however many chunks the drill takes. The user may bulk-route by answering any chunk's `Other` free-text field with a bulk instruction (e.g., Step 1 `Other`: "apply Route to a record + Defer to all remaining items"; Step 2b `Other`: "Drop the rest") — apply it to all remaining like-classified items and skip individual encoding for those. This is the direct replacement for the old `all: {choice}` free-text convention — but the request must come from them, never a presented button at any step, at any level of the drill.

---

### Phase 3 — Apply user decisions

For each item, apply the user-chosen disposition. **Each new work record (`parked` or `backlog`) requires the user's explicit choice for that specific item — never bulk-write without their per-item input.** Creating the record itself is a second, separate approval from the per-item disposition choice (`_shared/auto-mode-card.md`'s work-record-creation row) — `Defer`, `Keep`, and `Acknowledge` therefore **stage a record proposal**, never create the record directly, mirroring `wrap-up/leftover-routing.md`'s Auto mode behavior:

- `Fix anyway` → return to Phase 1 for that item, fix, commit, mark `fixed`
- `Defer` → stage a record proposal at `{run-dir}/staged/ledger-record-{slug}.md` (`Title:`/`Type:`/`Labels:`/`Defer-reason:` header + body, same staging shape as `leftover-{slug}.md` — see `wrap-up/leftover-routing.md` step 3). The body is composed via `specShapedBody` exactly as `leftover-routing.md` step 1 does, mapped from the ledger's own evidence: `header` = `'Trigger: {user-stated trigger}'`; `currentState` = the ledger item's evidence and affected files; `deliverables` = the fix as stated; `acceptanceCriteria` = the item's own verification (a test name, a grep, an observable behavior); `filedBy: 'ledger resolve gate'`; `provenance: { origin: 'ledger resolve gate', deferReason }` (the item's vocabulary value, per `_shared/deferral-gate.md`); footer `_Filed by \`ledger resolve gate\` via specShapedBody._`. Labels: scored (`risk:*`/`size:*` per `_shared/work-record.md`'s Scoring axis) + `parked` — spec-shaped and scored but not `ready`. An item whose own text names an open choice takes the `openQuestion` path (`needs:definition`, no `ready`, no scoring) — the escape hatch is not withheld from any branch. Update ledger status to `deferred`. Resolves at the Review Console's Queue writes section (which creates the record); log line carries `— landing: parked (defer-reason: {value})`
- `Keep` → same composition, backlog landing: no `Trigger:` header, `ready: true` + scoring (born-ready per `_shared/work-record.md`'s born-shaped `/wrap-up` row), `Origin: ledger resolve gate`. Update ledger status to `deferred` (note `→ backlog`). Same two-surface resolution as `Defer` above; log line carries `— landing: born-ready (defer-reason: {value})`
- **No pipeline run directory resolves** (truly standalone `/claude-tweaks:ledger resolve`, outside any `/flow` or `/wrap-up` run — see `_shared/pipeline-run-dir.md`): no Review Console will ever read a staged file, so create the record directly instead, using the same dual-driver contract the console would have used, composing via `specShapedBody` exactly as the branches above — an item whose own text names an open choice still takes the `openQuestion` path and files `needs:definition` (a label with no `recordPayload` parameter — append it at the create call) — with the reason **required**: a direct create without a valid `Defer-reason:` in the composed body is the same hard-gate violation `wrap-up/refused-proposals.md` refuses at the console (`_shared/deferral-gate.md`, "staged in a run directory or created directly"). When `bookkeepingPermissions(ceiling).ledgerNarrowing === true`, apply Phase 2's narrowing check inline here too (no wrap-up runs on this path, so there is no Review Console to centralize the auto-file decision through).
- `Accept` → record the user's stated reason in Resolution column. Update status to `accepted`
- `Acknowledge` (ops items only) → **stages a record proposal**, composed via `specShapedBody` with the born-ready label shape (`risk:*`, `size:*`, `ready`), scored per `_shared/work-record.md`'s Scoring axis, `Type: task`, `filedBy: 'ledger resolve gate'`, `provenance: { origin: 'ledger resolve gate (acknowledged)', deferReason: 'blocked-external' }`; footer `_Filed by \`ledger resolve gate\` via specShapedBody._` — `deliverables` = the human action ("do X in the dashboard"), `acceptanceCriteria` = the observable outcome; there is no separate Manual Steps section (`/build` Step 2.5 triages the deliverable at execution time). An ops action that itself names an open choice takes the `openQuestion` path like any other item. An ops item is action still outstanding, just not something the agent can perform, so unlike `Accept`/`Drop` it must not disappear once the ledger file is deleted at cleanup. Update ledger status to `acknowledged`. Same two-surface resolution as `Defer`/`Keep`; log line carries `— landing: born-ready (defer-reason: blocked-external)`
- `Drop` → mark as `accepted` with reason "dropped per user — no longer relevant"
