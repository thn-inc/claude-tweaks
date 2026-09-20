# Wrap-Up Review Console — interactive rendering

Read this file only once `review-console.md` has determined a real stop will actually render to a
human — i.e. the Auto-resolution short-circuit (`consoleAutoResolve`) did not resolve and return,
`--dry-run` did not already short-circuit, and the empty-console fast path did not fire. This file
holds the batch table templates, `AskUserQuestion` wording, and numbering rules that only that
live-render path ever uses; `review-console.md` itself holds every check and decision that runs
regardless of whether a human ever sees a rendered console.

## Numbering rules

- The console's **named batch sections** are the ones headed below — Auto-applied, Pending review, Low-confidence findings, Contested findings, Skill updates, Documentation updates, Journey updates, Configuration updates, Reference repairs, Cleanup actions (the two coordination-derived sections — Low-confidence findings, Contested findings — render only when non-empty, as does Reference repairs). Together they use a **single global sequence** starting at #1: every row across every present section has a unique number, with no restart between sections.
- Three sections use their own prefixed sequence instead of the global one — **Queue writes** (`Q1`, `Q2`, …), **Memory updates** (`M1`, `M2`, …), and **Upstream feedback** (`U1`, `U2`, …) — and are never counted into the batch sections above (Hard requirements below explains why). A fourth section — **Refused — no defer reason** — follows Queue writes; see `refused-proposals.md`.
- **One row type is per-item without being its own section:** a `[{genre}-convention]` row — `[adr-convention]` from the Decision records curation row (`adr-curation.md`) and `[journey-convention]` staged by `/claude-tweaks:journeys` Step 2 both render inside Configuration updates; a Diátaxis-genre instance from the Docs curation row's D2 check (`docs-health-integration.md`) renders inside Documentation updates instead, alongside that row's other findings — keeps its section's global number, but carries a three-way choice rather than approve/reject, so "Approve all" never applies a default to it — it belongs to the drills-individually class (Hard requirements below) and still gets its own three-way question as part of the same console stop. It is the one row shape that is per-item despite sitting inside a batch section — see the Configuration updates section below for its render shape and for what it blocks until answered (the shape is genre-generic; only the hosting section differs by which curation row — or, for Journey, which non-curation staged file — found the conflict).
- This applies to both the example below and any real Console output. Do not restart numbering within the global sequence.

## Console-on-PR (`integration-model: pr-first` only)

Reached only when the Auto-resolution short-circuit did not already resolve and return (see
`review-console.md`). Resolve `integration-model` per `_shared/integration-model.md`; `local-merge`
→ skip to "Present the console" below, unchanged.

`pr-first` with a `pr` object on `run-state.json` (`_shared/pr-run-comments.md`'s gate): read `_shared/console-on-pr.md` and follow it in full — same content as "Present the console" below, rendered as PR checkboxes and posted/updated there instead of a chat table, `console.json` written to the run dir. A live session also asks via `AskUserQuestion` here (`_shared/console-execution.md`'s Live-session accelerator, first answer wins); headless skips straight to reporting `pending-review` with the PR URL, per that file's Headless conclusion. Never also render "Present the console" on this path.

`pr-first` with no `pr` object yet (fail-safe — should not normally happen): fall through to "Present the console" below.

## Present the console

Read `console-template.md` and render that exact shape — every section's column layout, the engine-vs-prose-fallback distinction (engine output is plainer: one uniform four-column table per section, not the richer per-section shapes shown there), and the `[{genre}-convention]` row's three-way prompt. Worked example rows there are fictional; substitute this run's own `decisions.md`/`staged/` content.

**Lever attribution suffix.** A `decisions.md` entry's optional `[lever: …]` field (`_shared/auto-decision-log.md`'s Lever attribution section) appends to that row's existing detail cell (`What`/`Detail`) as an inline code span — no new column. Absence is valid and never annotated.

**Hard gate (restated):** the tables must be literal rendered markdown in THIS response, above this tool call — see `review-console.md`'s top-of-file gate.

**Qualifying-rows list (drills-individually class — Hard requirements below defines it).** When this run's console carries at least one row in that class, list them — row number plus qualifying reason (`no default` or `restructural`) — immediately above the terminal options, one line per row, e.g. `#17 — no default (adr-convention)` or `#16 — restructural`. Omit this list entirely when the class is empty.

Immediately after presenting the console tables above (and the qualifying-rows list, when non-empty), call `AskUserQuestion` with `question`: `"How do you want to handle the Review Console items?"`, `header`: `"Review Console"`, `multiSelect`: `false`. Cleanup actions' worktree/branch-finish row is what makes the merge decision real (`cleanup-procedures-execution.md` Section C) — folding it into these options is what keeps that row from becoming its own improvised stop (`_shared/auto-mode-contract.md`'s bookend rule).

**`integration-model: pr-first`** — read the PR's live CI status before rendering the options
below, the same read `_shared/pr-first-merge.md`'s Step 2.5 (Merge-verification gate) classifies
as green/pending/red (`gh pr view {pr-number} --json state,mergeStateStatus,headRefOid,statusCheckRollup`)
— cite that classification rather than restating it. Read `pack.pr` from `{run-dir}/wrap-up-pack.json`
first (#1930) — its `value` is that same `gh pr view` JSON — and run the command itself only when the
pack file is absent. An `ok: false` field is the state read having failed, which is Step 2.5's own
first classification (`state-read-failed`: report `pending-review` and stop; a read failure is not
"no CI"), never a green or empty rollup. This is the same rule
`dispatch/SKILL.md`'s "Confirm before resuming" applies to its own Resume/Cancel options, so a
run reaching both prompts in one session (dispatch's resume confirmation, then this console on
re-entry) never sees them disagree. Four options:
- Option 1 — `label`: `"Approve all + merge"` (append `" (Recommended)"` when CI reads green or pending), `description`: `"Apply pending items, accept auto-applied, apply skill + config updates, execute cleanup incl. merging the branch (items 1-{N}); resolve every Q#/M# to Apply and every U# to filed (if its staged draft carries a systemic causal tag) or declined (otherwise) — their own stated defaults, no further prompts except rows marked drills-individually, listed above the options when present"`
- Option 2 — `label`: `"Approve all, leave PR open"` (append `" (Recommended)"` instead when CI reads red — apply everything except the merge, which stays blocked until CI is fixed), `description`: `"Same as above, but skip the branch-finish merge — the PR stays open for manual merge later"`
- Option 3 — `label`: `"Override specific items"`, `description`: `"Reply with #s to skip/modify (e.g., \"skip 5, modify 7, revert 1\"); also the only path that drills Q#/M#/U# individually"`
- Option 4 — `label`: `"Stop and re-engage"`, `description`: `"Pause the pipeline; resume after manual review"`

Exactly one of options 1 and 2 carries `(Recommended)`, never both, never neither. Options 3 and 4
never carry it — they are the deliberate-override and pause paths, not defaults.

**`integration-model: local-merge`** — no PR to leave open, so the merge decision isn't split; unchanged three options: `"Approve all (Recommended)"` (apply pending items and execute cleanup, incl. branch-finish), `"Override specific items"`, `"Stop and re-engage"`, same descriptions as above minus the merge clause.

If "Override specific items" is chosen, the skip/modify list is ordinary free-text chat in the next message, per docs/skill-authoring.md's Multi-item decisions convention — not the tool's `Other` field.

Queue writes, Memory updates, and Upstream feedback all resolve as part of this terminal decision now: choosing Approve all resolves every `Q#`/`M#` item to `Apply` and every `U#` item to filed (its staged draft carries a `**Causal:** systemic` tag) or declined (otherwise) — their own stated defaults — with no further prompt (see Hard requirements below). Choosing Override is what still drills them individually, below.

After the user selects Override (option 2), resolve remaining `Q#` and `M#` items via `_shared/batched-item-drill.md`'s multiSelect chunking (genuinely binary: Apply vs. Skip) — one `multiSelect: true` `AskUserQuestion` call per chunk of ≤4 items **within the same section** (a `Q#` and an `M#` never share a call — different destinations, different staged-file shapes — chunking is within a section, never across sections). All items pre-checked to `Apply` (the recommended default — most staged proposals are fine as-drafted); unchecking an item means `Skip`. Editing content is the free-text override path (shared contract), naming the target item by its rendered title (e.g. `"Q1: shorten the trigger condition"`). Approve all (option 1) never reaches this drill — it already resolved every item to its default above.

- `question` for a `Q#` chunk: `"Queue writes — which should be created? (checked = Apply, uncheck to Skip)"`, `header`: `"Queue writes"`, each checkbox option's label the item's own short title (e.g. `"Q1: Add OAuth refresh edge case"`)
- `question` for an `M#` chunk: `"Memory updates — which should be written? (checked = Apply, uncheck to Skip)"`, `header`: `"Memory updates"`, same per-item checkbox convention

Applied to this example's two queue writes (one chunk, both pre-checked):
- `question`: `"Queue writes — which should be created? (checked = Apply, uncheck to Skip)"`, `header`: `"Queue writes"`
- Checkbox 1 — `"Q1: Add OAuth refresh edge case"` (pre-checked) — blocked on /auth provider docs, parked with trigger '/auth provider docs land'
- Checkbox 2 — `"Q2: Investigate token rotation strategy"` (pre-checked) — surfaced by /reflect Step 3

**Upstream feedback**, under Override, uses its own multiSelect chunking mechanism — `_shared/upstream-feedback-batch.md`, not `batched-item-drill.md` — since every option renders **unchecked** by default (checking is the explicit per-item approval act, per `[IL-114]`), the inverse of `Q#`/`M#`'s pre-checked convention: filing publishes outward-facing, irreversible content. Call into that contract with this run's `U#` rows: render each item's scrubbed draft (from `staged/wrap-up-upstream-*.md`), then issue the contract's chunked `multiSelect` call(s). Checking and submitting **authorizes filing now**, not shortlisting for later confirmation. Approve all never reaches this drill for an item that resolves via it — an item declines by default under Approve all unless its staged draft carries a `**Causal:** systemic` tag, in which case Approve all resolves it to filed directly instead (#2551; `review-console.md`'s Auto-resolution short-circuit resolves every `U#` row to filed unconditionally, tag or not, regardless of this drill).

**On approval (option 1):** when the qualifying-rows list above was non-empty, resolve every
listed row first — the `[adr-convention]` three-way `AskUserQuestion`, then the restructural rows'
`_shared/batched-item-drill.md` chunk(s) (Hard requirements below gives the full order and shape)
— before proceeding to `review-console.md`'s "On approval" procedure below, since that procedure's
Configuration-updates step (item 5) needs each row's resolved disposition. Shared with the
Auto-resolution short-circuit — the numbered execution steps live in `review-console.md` itself
rather than here; both this file's "Present the console" flow and that file's auto-resolve path
invoke the same procedure.

## On override (option 2)

1. Parse the user's overrides across every numbered item in the console
2. For each item: apply (per `review-console.md`'s "On approval" step 1), skip (delete from staged/), or modify (re-edit the staged patch then apply)
3. Auto-applied items the user wants reverted: `git revert {commit}` (one revert commit per item, to keep history clean)
4. Cleanup items the user skipped: leave the target intact (spec/plan/worktree stays)
5. Queue writes (`Q#`), Memory updates (`M#`), and Upstream feedback (`U#`) resolve via their own multiSelect chunking (`_shared/batched-item-drill.md` for `Q#`/`M#`; `_shared/upstream-feedback-batch.md` for `U#`) — override is the one path where they resolve individually instead of by their Approve-all default; no per-item gate can be bulk-resolved by a shared toggle even here (Hard requirements below)
6. Commit, then proceed to the phase-trace report

## On stop (option 3)

Halt before applying. Leave the run directory intact. User resumes with `/claude-tweaks:wrap-up resume` (re-reads the same run directory and re-presents the console).

**Logging the terminal decision:** Immediately after the terminal `AskUserQuestion` resolves (when Approve all / Approve all + merge / Override / Stop is chosen), log `AUTO {time} — Review Console: terminal decision {approve-all|approve-all-merge|leave-pr-open|override|stop}. Reversibility: n/a.` to `decisions.md`, naming whichever of the four options (three under `local-merge`) was chosen.

## Hard requirements

- The console MUST present every entry from `decisions.md` (auto-applied + staged + kept-prompt + scanned), every file in `staged/`, every cleanup action that would otherwise run at Phase 4's execution step, and every queue-write, memory-update, and upstream-feedback proposal. Silently dropping any item is forbidden.
- **Sort order within each section:** reversibility:low first (highest-stakes revert), then reversibility:med, then reversibility:high. Within the same reversibility, severity:high first.
- **Queue writes, Memory updates, and Upstream feedback are covered by the terminal Approve all / Override / Stop decision**, per the ceiling-aware stance (`_shared/auto-mode-contract.md`'s never-silenced rows, `_shared/autonomy-ceiling.md`). Choosing **Approve all** resolves every `Q#`/`M#` item to its pre-checked `Apply` default and every `U#` item to its own default — filed when the staged draft carries a `**Causal:** systemic` tag (`upstream-feedback.md`'s Step 2; #2551), else its usual unchecked/declined default — with zero additional `AskUserQuestion` calls either way; this is what "fold into Approve all" means. Choosing **Override specific items** is what still drills per item: `Q#`/`M#` resolve via `_shared/batched-item-drill.md`'s multiSelect chunking (a checkbox per item, pre-checked to `Apply` — the checked/unchecked state *is* that item's individual choice, never a shared bulk toggle answered once for the chunk); `U#` resolves via `_shared/upstream-feedback-batch.md`'s own multiSelect chunking (unchecked by default, per `[IL-114]` — the inverse default, since filing publishes outward-facing, irreversible content). Neither mechanism may fold two items' choices into one shared answer. This enforces `_shared/auto-mode-card.md`'s not-silenced rules for work-record creation, memory writes, and upstream filing by construction: Approve all still applies each item's own stated default rather than skipping the decision, and Override still resolves each item individually. (Retired: earlier revisions of this file required a standalone per-item `AskUserQuestion`, outside the terminal decision, for every `Q#`/`M#`/`U#` item regardless of which top-level option was chosen — that requirement is what the contract rewrite retired.) **A different table's approval never satisfies this gate** — not the Reflection Insights batch, not the Skill Updates batch, not any other — even when that answer was "Apply all." A batch table's "Apply all" approves what its own rows list; routing an insight to Memory is one such row, and its resolution is governed by this section's own `M#` default, not that table's.
- **A `[{genre}-convention]` row is also per-item**, whichever section hosts it (Configuration updates for `[adr-convention]` and `[journey-convention]`, Documentation updates for a D2 Diátaxis-genre instance). Never fold it into "Approve all" and never pick one of its three options as a default. It belongs to the drills-individually class below — the terminal Approve all still fires its own three-way `AskUserQuestion` for it as part of the same console stop, and it is that answer, not a fold-in default, that resolves it and every matching `[doc]`/`[adr]`/new-journey row from the same run (their paths depend on the answer). It is never left unanswered on any path through the console.
- **The "drills individually" class** is what still prompts after the terminal Approve all (or Approve all + merge) — the "no further prompts" promise in the option descriptions above is conditioned on this class being empty. Two row kinds belong to it: (a) a `[{genre}-convention]` row (the bullet above — no default exists to fold into Approve all); (b) a stage-only finding whose emitting judge classified it **restructural** (`curation-engine.md`'s applied-precondition vocabulary — changing existing wording, moving content, renaming sections, splitting or merging files; today only the CLAUDE.md & rules row emits these into the batch sections, and any future stage-only row inherits the class the same way, by disposition + classification rather than by row name — there is no graded threshold and no new taxonomy beyond curation-engine.md's existing binary). When Approve all is chosen and this class is non-empty, drill it as part of the **same console stop**, in this order: first every `[{genre}-convention]` row present (each its own three-way `AskUserQuestion`) — for `[adr-convention]` specifically, its single answer is global, resolving every blocked `[adr]` row in the run, since it records one convention choice in `policy.yml`; `[journey-convention]` and a D2 Diátaxis-genre instance follow the same per-row three-way-question mechanic but resolve their own convention through `/claude-tweaks:journeys`/`docs-health-integration.md` rather than `policy.yml`, so their answer is scoped to that row's own genre, not global across genres — then the restructural rows via `_shared/batched-item-drill.md`'s multiSelect chunking (≤4 per chunk, pre-checked to `Apply` — unchecking an item skips it; the checkbox is the individual confirmation a restructural finding still needs despite sitting in a batch section). The console lists the qualifying rows — row number plus qualifying reason — immediately above the terminal options whenever the class is non-empty (see "Present the console" above). Override (option 2/3) already drills every item individually, so this class adds nothing new on that path — it exists only to close the Approve-all gap.
