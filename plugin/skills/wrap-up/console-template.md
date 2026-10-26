# Wrap-Up Review Console — Template

Referenced by `skills/wrap-up/review-console-interactive.md`'s "Present the console" section. This is the literal shape to render — every section's column layout and worked example rows, with fictional data standing in for a real run's `decisions.md`/`staged/` content. Read `review-console-interactive.md` itself for the numbering rules, the engine-vs-prose-fallback distinction, and the operative `AskUserQuestion` call that follows this template.

```markdown
### Wrap-Up Review Console

The pipeline auto-resolved {N} decisions and staged {M} items for your review. Every section below — the named batch sections, plus Queue writes, Memory updates, Upstream feedback, and Reflection insights — resolves via the same terminal Approve all / Override / Stop choice. Approve all applies each section's own default (batch sections: apply, except Dismissed duplicates rows, which stay as they are; Low-confidence and Contested rows: each row's tiebreak recommendation, below; `Q#`/`M#`: their pre-checked `Apply` default; `U#`: filed when its staged draft carries a `**Causal:** systemic` tag, else its usual unchecked/declined default; `R#`: each row's recommended destination, D4/D5 rows informational) with no further prompts, except rows marked drills-individually (listed above the terminal options when present — see `review-console-interactive.md`'s Hard requirements). Override is what still drills `Q#`/`M#`/`U#`/`R#` individually — one or more chunked `multiSelect` calls, `_shared/batched-item-drill.md` for `Q#`/`M#`/`R#`, `_shared/upstream-feedback-batch.md` for `U#` (see `review-console-interactive.md`'s Hard requirements for why).

> **Still pending from earlier** (#2736 — render only when `check-session-residue` reported something; omit entirely otherwise, no row/number of its own, purely informational)
>
> - 2026-07-01T090000-record-42 (status: interrupted) — resolve with: review {run}/decisions.md and staged/ to resume, or close a finished run with: `node "${CLAUDE_PLUGIN_ROOT}/bin/hooks.js" close-run --run <dir>`
> - 2026-06-30T101500-tidy-standalone — staged proposal(s) awaiting approval: `/claude-tweaks:tidy --approve "<dir>"`

#### Auto-applied (already in commits — override = revert)

| # | Skill | What | Where | Status |
|---|---|---|---|---|
| 1 | /review | Applied 3 severity:low formatting fixes | commit `def5678` | Applied |
| 2 | /test | Auto-fixed 4 lint failures | commit `ghi9012` | Applied |
| 3 | /build | Scope-creep: added src/utils/cache.ts to plan | commit `abc1234` | Applied |
| 4 | /stories | Applied 2 journey link suggestions | stories/login.yml, stories/logout.yml | Applied |

A `SCANNED` entry (the scan-summary log line the engine writes for any curation row — Skills, Docs, Journeys, CLAUDE.md & rules, and the rest — see `_shared/auto-decision-log.md`) also renders in this section, but with `Status` = `Informational` and `Where` = the registry row it ran for (no commit ref, since nothing was applied) — there is nothing to revert for these rows. The `What` cell paraphrases the `SCANNED` line into reader language (what ran, what it found) rather than quoting it — the raw line, with its internal fragments (`gap detection:`, the routing codes, and the rest of section 5's exempt vocabulary), stays in `decisions.md`, never in this table.

A `FAILED` entry (a batch write that errored — see `_shared/auto-decision-log.md`'s Status semantics) renders in this section too, with `Status` = `Failed`, `Where` = the record ref or call site the write targeted (no commit ref — nothing landed), and the `What` cell naming the write type and the error. It is never an approve-or-revert row: nothing was applied, so Override has nothing to act on and Approve all resolves it to a no-op. It still counts as decision-bearing for the Empty-console fast path (`review-console.md`), so a run whose only decision-bearing line is a `FAILED` one renders this section with that row alone — which is the point: the operator sees the failed write and retries it from the producing skill's own closing summary (`backlog/refine-mode.md` Step 5's paste-ready retry).

#### Pending review (staged — apply, skip, or modify per item; `ratify`/`reverse` an `sdd-ruling-*` row)

| # | Skill | What | Detail | Patch |
|---|---|---|---|---|
| 5 | /review | 2 severity:medium findings | Unhandled rejection in src/api.ts:180; missing null check in src/auth/session.ts:42 | `staged/review-2.patch`, `staged/review-3.patch` |
| 7 | /wrap-up | Skill restructure proposed | Split `auth/SKILL.md` into `auth/` + `session-management/` | `staged/wrap-up-skill-restructure.md` |

#### Dismissed duplicates (byte-identical to their anchor — informational; Approve all and Override leave them as they are)

| # | Copy | Anchor |
|---|---|---|
| {n} | `staged/build-deviation-1.md.shadow-dup` | `staged/build-deviation-1.md` |

Renders only when non-empty; rows take the next numbers of the global sequence. A `.shadow-dup` copy goes here only when `cmp -s "{run-dir}/staged/{copy}" "{run-dir}/staged/{anchor}"` exits 0 (`{anchor}`: the copy's name minus its `.shadow-dup`/`.shadow-dup-{n}` suffix); any other copy, a missing or unreadable anchor included, is a `Q#` row.

#### Low-confidence findings (not reproduced — Approve all files or drops each per its tiebreak recommendation)

Render this section only when `console-filings.js --run "{item-run-dir}" --list` (`review-console.md` step 7) prints a `Low-confidence findings` row — a STAGED unconfirmed-finding line, a staged review file, or a tiebreak `console` verdict — and build every row from that output: `Item` is its `id`, `Path:Line`/`Severity`/`Lens`/`Recommendation` its fields (`—` for a null), `Finding` the claim its STAGED line or staged file states. Omit the section entirely when empty.

| # | Item | Path:Line | Finding | Severity | Lens | Recommendation |
|---|---|---|---|---|---|---|
| 8 | tiebreak:3f2a9c1b7d04 | src/auth.ts:42 | Possible null check missing | medium | error-handling | file |
| 9 | review-unconfirmed-2.md | src/api.ts:180 | Race condition on token refresh | high | security | drop |

> These findings were surfaced by exactly one reviewer agent (or downgraded by a debate that converged negative), and the tiebreak (`review/step3-tiebreak.md`) could not settle them. The signal is real but unreplicated; the user decides whether to file or drop each.

`Item` is the console item id — the staged file, or `tiebreak:{id}` for a verdict no staged file carries — the value `review-console.md` step 7's `--only` takes. `Severity` and `Recommendation` are the tiebreak verdict's. **Approve all resolves each row to its recommendation:** `file`, or none, → `filed` (a backlog record, step 7); `drop` → `dropped` (nothing executes). A human choosing Approve all on a `drop` row is a human decision: `_shared/auto-mode-contract.md`'s `### Tiebreak-refuted drop (one-decision amendment)` governs autonomous resolution, which files every can't-tell item. A legacy row whose STAGED line carries no tiebreak verdict shows `—` and stays undecided (`keep-staged`) under Approve all — never resolved `dropped`.

#### Contested findings (debate inconclusive — Approve all files or drops each per its tiebreak recommendation)

Render this section only when `--list` prints a `Contested findings` row (a cross-lens debate with mixed/partial verdicts), built as Low-confidence findings' rows are. Omit the section entirely when empty.

| # | Item | Path:Line | Lens A verdict | Lens B verdict | Severity | Recommendation |
|---|---|---|---|---|---|---|
| 10 | review-contested-1.md | src/auth.ts:42 | agree (security) | partial (architecture) | high | file |

> Two reviewer lenses disagreed on this region and one debate round did not converge. Both verdicts are staged at `staged/review-contested-{N}.md` with reasoning side-by-side. The columns and the Approve-all default are Low-confidence findings' above.

#### Dropped by tiebreak (read-only — no decision)

| Path:Line | Lens | Severity | Evidence |
|---|---|---|---|
| src/cache.ts:88 | performance | high | src/cache.ts:90 "if (!entry) return fetchFresh(key);" |

Renders only when `decisions.md` holds a resolver `AUTO … dropped … Severity: high` (or `critical`) line; a missing or malformed line renders no block. Unnumbered — Approve all and Override never reach it; low and medium drops stay in `decisions.md` only. A refuted finding whose staged review file exists also shows that file's own row resolved `dropped` (the file's final outcome), while this block lists the finding.

Generate the next five sections — Skill updates, Documentation updates, Journey updates, Configuration updates, and Reference repairs, in that order, matching `engine-render.js`'s `SECTION_SPECS` emission order — via `render --section console --start-at {n}` when the engine ran (`curation-engine.md` section 2, with `{n}` the next number in this console's global sequence).

The engine's real output shape is plainer than the per-section shapes below: `renderConsoleSections` emits a bare `#### {title}` heading per section plus one uniform `| # | Target | Change | Disposition |` table (integer `#`, `finding.targetPath`, `finding.summary`, and `applied ({commit})` / `staged ({stagePath})`) — the same four columns for all five sections, no six-column Reference repairs shape and no `18a`/`18b` sub-lettering. The richer per-section shapes below (`| # | Skill | Section | Change |`, the six-column Reference repairs table, etc.) are the **prose-fallback template**, used when the engine did not run. On an engine run, insert `render`'s output verbatim into this response — do not hand-expand it into these shapes.

#### Skill updates (from the Skills curation row)

| # | Skill | Section | Change |
|---|---|---|---|
| 11 | auth | Anti-Patterns | Add: "Don't share session tokens via querystring" |
| 12 | NEW | session-management | Create new skill for session lifecycle patterns |

A reflect observation or convention (`staged/reflect-{n}.md`) also lands in this section, but it is not an engine finding. On an engine run, render each as a row of a `| # | Target | Change | Disposition |` table directly after the engine's output, numbers continuing the global sequence — Target is the `edit` path for an edit destination, else the staged file `staged/reflect-{n}.md`, Change is `{destination verb}: {finding one-line}`, Disposition is `staged (staged/reflect-{n}.md)`. Approve all applies each to its own destination (`review-console.md` step 2's reflect clause).

#### Documentation updates (from the Docs curation row)

| # | Type | Target | Change |
|---|---|---|---|
| 13 | doc | docs/api.md | Document new /auth/refresh endpoint |

A `[{genre}-convention]` row (see the Configuration updates section below for its full render shape) also renders inside this section on a D2 `conflict` outcome for one of the four core Diátaxis genres, taking its own next number in the global sequence like any other finding — e.g. `#14  how-to-convention  docs/guides/  — this repo's how-to guides disagree with the plugin's convention`, keyed against that genre's own `doc-convention-{genre}` policy key. It blocks every `[doc]` row for that same genre from the same run until answered.

#### Journey updates (from the Journeys curation row)

| # | Type | Target | Change |
|---|---|---|---|
| 15 | journey | docs/journeys/login-flow.md | Origin-coverage check failed: `src/auth/session.ts` in `files:` but not visited by any step |

#### Configuration updates (from the CLAUDE.md & rules and Decision records curation rows)

| # | Type | Target | Change |
|---|---|---|---|
| 16 | claude.md | Commands | Add `npm run lint:fix` to test workflow |

A `[{genre}-convention]` row renders inside this section but carries its own three-way prompt, following the same not-covered-by-"Approve all" rule as Queue writes below — this is the general row shape `_shared/existing-convention-detection.md` collects for **any** genre whose Detection is `active` (`_shared/diataxis-genre-templates.md`), not an ADR-specific one; `[adr-convention]` below is the canonical worked instance. A `[journey-convention]` row also renders here on a `conflict` `/claude-tweaks:journeys` Step 2 staged during this run (`journeys/SKILL.md`'s Step 2 auto-mode branch) — journeys is not part of `/claude-tweaks:wrap-up`'s curation engine, so this is the one row type in this section sourced from a different skill's staged file rather than a curation row's own scan; it resolves identically once it reaches here. Render it as:

```
#17  adr-convention  docs/decisions/  — this repo's decision records disagree with the plugin's convention

     plugin form  : 0017-slack-transport.md
     found (16)   : ADR-016-slack-integration-strategy.md
     project skill: .claude/skills/architecture-decision/SKILL.md

     1  Conform forward   — new files use the plugin's form   -> doc-convention-adr: plugin
     2  Migrate           — rename all 16, fix REGISTRY rows and inbound links
     3  Keep project form — resolve from this repo             -> doc-convention-adr: project
```

A Diátaxis-genre instance (Tutorial/How-To/Reference/Explanation, surfaced in Documentation updates above rather than here) renders identically, substituting the genre name and its own `doc-convention-{genre}` key — e.g. `how-to-convention  docs/guides/  — this repo's how-to guides disagree with the plugin's convention`, with the same three numbered options against `doc-convention-how-to`. Omit the `project skill` line when detection found none. "Approve all" never applies a default to any `[{genre}-convention]` row — it belongs to the drills-individually class (`review-console-interactive.md`'s Hard requirements), so Approve all still fires this row's own three-way `AskUserQuestion` as part of the same console stop, and that answer resolves every `[doc]`/`[adr]` row for that same genre from the same run, since their resolved paths depend on it.

#### Reference repairs (from the Broken references curation row)

Render this section whenever the broken-reference sweep found a surviving reference, in either of
two states. **Applied** rows are reported, not re-approved — they already happened, committed by
the controller's serial-commit pass (`curation-engine.md` section 4) with the `Initiative-Fix:`
trailer, under a `trusted`/`unattended` ceiling (`_shared/initiative-budget.md`).
**Staged** rows are ordinary approval rows like any other in this console.

| # | State | Target | Repair | Broken by | Why |
|---|-------|--------|--------|-----------|-----|
| 18a | applied | docs/plugin-structure.md | `build/setup.md` → `build/worktree-setup.md` | skills/build/setup.md | pointer repair 1/3, 2 lines |
| 18b | staged | tests/paths.test.js | `build/setup.md` → `build/worktree-setup.md` | skills/build/setup.md | test file — never auto-repaired |

The `Why` column carries `permittedInitiative`'s own reason string verbatim for both states, so a
run that tripped a cap reads differently from a run that found nothing — under the prose fallback
directly, and on an engine run via the finding's `summary` field (`reference-sweep.md`'s staging
guidance), which is what `engine-render.js`'s uniform Change column renders. **A sweep that found
surviving references but applied none must still render this section** — an empty Auto-applied
list plus a populated staged list is the signal that the ceiling is holding, and collapsing it to
silence hides exactly that.

#### Cleanup actions (executed at Phase 4's execution step after approval)

Render the cleanup rows from the canonical list in `cleanup-procedures.md`, filtered by Condition (e.g., omit the worktree row when no worktree strategy was used). Each row gets a globally-unique # in the shared batch-section sequence (see Numbering rules above). Example:

| # | Type | Action | Details |
|---|---|---|---|
| 19 | cleanup | {row from cleanup-procedures.md canonical list} | {details} |
| ... | cleanup | ... | ... |

#### Queue writes (Approve all applies the default; Override drills each item)

Render this section only when leftover routing or another step (e.g. `/reflect`'s
tangential-idea routing) has proposed a new work record **and it wasn't already auto-filed by the
Ledger narrowing auto-file step above**. Each remaining row gets its own prompt — bulk
approval is forbidden per `_shared/auto-mode-card.md`'s work-record-creation row. The exact
write mechanism (`gh issue create` / `local-store.js`, or — for a skill not yet migrated onto
the unified record system — its own destination) lives in the producing skill's own staged
file; this table only needs enough to render the prompt.

**Where the `Q#` rows come from.** Every file in `{run-dir}/staged/` carrying a
`Title:`/`Type:`/`Labels:` header is a queue write — `ledger-record-*.md`
(`_shared/ledger-format.md`'s Resolve Gate Phase 3 `Defer` / `Keep` / `Acknowledge` dispositions, including the
ones `nothing-left-behind.md`'s Ops acknowledgment stages), `leftover-*.md`, and any other
producer's staged proposal. Identify them by that header, not by filename, so a new producer is
picked up without editing this file. A divergent or collision `.shadow-dup` copy (`shadow-dup-divergent`/`shadow-dup-collision`)
is a `Q#` row too, though it carries no header: `review-console.md` step 7 composes one.

| Q# | Destination | What | Source |
|---|---|---|---|
| Q1 | record (parked — trigger: /auth provider docs land) | "Add OAuth refresh edge case" — blocked on /auth provider docs | Phase 3 leftover routing, `staged/leftover-add-oauth-refresh-edge-case.md` |
| Q2 | record (backlog) | "Investigate token rotation strategy" — surfaced by /reflect Step 3 | reflect insight stage file |

#### Refused — no defer reason (no default — never resolved by Approve all or `consoleAutoResolve`)

Renders only when non-empty (`refused-proposals.md`). Rows reuse the item's own `Q#` — no sequence of their own:

| # | Proposal | Staged path | Defer-reason |
|---|---|---|---|
| Q2 | "Track retry metrics dashboard" | `staged/reflect-staged-2.md` | `bogus` (invalid) |
| Q3 | "Clean up the retry helper loop" | `staged/leftover-retry-cleanup.md` | absent |

#### Memory updates (Approve all applies the default; Override drills each item)

Render this section only when the Memory curation row staged a memory-file proposal (`staged/wrap-up-memory-*.md`); omit it entirely otherwise.

| M# | Name | Type | Fact | Index line | Patch |
|---|---|---|---|---|---|
| M1 | dispatch-prompt-conventions | feedback | Restate convention-governed actions in the dispatch prompt | `- [Dispatch prompt conventions](dispatch-prompt-conventions.md) — restate the convention` | `staged/wrap-up-memory-1.md` |

> A memory file is cross-project and always-loaded — a wrong one degrades every future session in every project.

#### Upstream feedback (Approve all files a systemic-tagged row, declines the rest by default; Override files per item)

Render this section only when the Upstream feedback curation row staged one or more upstream
defect/gap reports (`staged/wrap-up-upstream-*.md`); omit it entirely otherwise. Approve all
resolves each row to filed when its staged draft carries a `**Causal:** systemic` tag
(`upstream-feedback.md`'s Step 2), same as `Q#`/`M#` resolve to their own `Apply` default —
otherwise it resolves to declined, same as before (#2551). The `unattended`-only
`consoleAutoResolve` path files every row unconditionally regardless of the tag; see
`review-console.md`. Filing an untagged item still requires choosing Override, which runs
through `_shared/upstream-feedback-batch.md`'s shared batch contract — one or more `multiSelect`
`AskUserQuestion` calls, chunked per that file's own rule (unchecked by default; checking is the
explicit approval) — instead of one call per item; see below for where this fires relative to the
terminal decision.

| U# | Kind | Component | Summary | Patch |
|---|---|---|---|---|
| U1 | defect | /claude-tweaks:dispatch | Parallel dispatch leaves one agent without a worktree under worktree-always | `staged/wrap-up-upstream-1.md` |

> Filing publishes privately-derived content to a public repository. The body shown is already
> scrubbed; a checked item files it via `/claude-tweaks:feedback --pre-confirmed`.

#### Reflection insights (Approve all applies each row's recommended destination; Override drills each item)

Render this section only when reflect staged `staged/wrap-up-reflect-insights.md` (`reflect/full-mode.md`'s
`--source wrap-up` branch); omit it entirely otherwise. Its rows are that file's table, renumbered
`R#`. Approve all applies each row's recommended destination at `review-console.md` step 10; D4
(Memory) and D5 (Upstream) rows stay informational — they resolve only through their own `M#`/`U#` rows.

| R# | Insight | Causal | Recommended Destination |
|---|---|---|---|
| R1 | Retry helper swallowed the last error, hiding the real cause | systemic | Implement now -> Skill: error-handling |
| R2 | Token refresh and session expiry share no clock source | — | Defer — genuinely-larger |

Below each table, the patch display is tiered by the item's recorded reversibility:

- **`reversibility: low` / `med`** — show the full patch / diff inline: the user approves exactly what will change where the revert is expensive.
- **`reversibility: high`** — show one line, `{#} {target} — {summary}`, plus a paste-ready view command on its own line: `cat "{absolute stagePath}"`. `{summary}` is the finding's own `summary` field on an engine run, or the item's `STAGED`/`AUTO` line description under the prose fallback.
- Resolve an item's reversibility in this order: the item's own recorded field (staged-file preamble), then its `decisions.md` entry — correlated by `stagePath` basename, unique per staged file and present in both the console row's Disposition cell and the `STAGED` line — and only with neither recorded, fall back to the full patch (fail toward showing more). An item with no `stagePath` at all also renders in full regardless of tier — the view-command tier only exists where there is a file to view.

Worked examples, one per tier (fictional data, like every example above):

    #5  CLAUDE.md — Trim the Commands section (reversibility: med)
        {full diff rendered inline here}
    #13 docs/api.md — Document new /auth/refresh endpoint (reversibility: high)
        cat "/Users/dev/project/.claude-tweaks/pipelines/2026-05-16T143207-spec-42/staged/wrap-up-doc-1.md"
```
