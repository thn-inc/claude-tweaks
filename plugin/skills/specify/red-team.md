# Step 5: Multi-Persona Red-Team — Dispatch Prompt

Loaded by `/specify` Step 5 at dispatch time. The Template A block below is inlined verbatim into each agent's prompt (per the Subagent Contract — agents only see what's in their prompt; references to sibling files don't reach them). Dispatched once per sub-issue record — never for the parent, which is never built directly.

## Parallel dispatch

**Persona selection by tier** (`ceremony:*` label, stamped on the sub-issue in Step 3 — rationale
was `docs/superpowers/specs/2026-07-20-lifecycle-ceremony-tiering-design.md`, deleted `70849915`): `ceremony:fast-lane` →
dispatch **Skeptical Reviewer only** (roster tag `red-team-persona`, `_shared/ceremony-profile.md` — the fast-lane skip of the other two personas is rostered there); `ceremony:standard` (or a sub-issue with no `ceremony:*` label at
all — treat as `standard`, the conservative default) → dispatch all **three** personas below,
unchanged from before.

> **Parallel execution:** Dispatch the selected persona(s) as parallel Task agents (a single agent
> for `fast-lane`, three for `standard`) — each runs independently and returns Template-A findings
> narrowed to ambiguities, gaps, and unstated assumptions. Assemble results after all agents
> complete.
>
> **Dispatch shape:** single-assistant-message rule (`_shared/subagent-dispatch-core.md`'s fan-out section) applies. Batching unit here: one message per sub-issue's persona set — a `fast-lane` sub-issue's single Skeptical Reviewer call joins the next sub-issue's message rather than spending a whole message on one agent.
>
> **Contract:** Each agent follows the Subagent Contract — minimal input (a record reference + persona lens question + Template A), one of `DONE / DONE_WITH_CONCERNS / NEEDS_CONTEXT / BLOCKED` as its first reply line. `[Use: Standard]` (resolve via `node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-profile.js" standard`, contract § Model Selection). Read-only — personas never modify the record themselves.
>
> **Persona prompts (inline literally per agent — Mode 3 from `skills/_shared/multi-agent-coordination.md`):**
>
> ```
> Task scope: Read the sub-issue record below as {Implementer | Maintainer | Skeptical Reviewer}, then answer the lens question. Fetch it first — `work-backend: github-issues`: run `gh issue view {subIssueNum} --json body -q .body`; `work-backend: local-files`: Read `{recordPath}` directly. Exactly one applies per dispatch — never pass both a record number and a file path to the same agent.
> Lens question: {persona's lens question — verbatim from the table below}
> {Skeptical Reviewer addendum — the dispatcher composes this line in only when BOTH hold: the persona being dispatched is Skeptical Reviewer AND the record body actually contains a `Blocked by #N: {assumption}` line. Omit the line entirely from every other dispatch — the dispatcher knows both facts at compose time, so the agent never carries a self-skip branch it cannot act on. When included, the line reads: "Skeptical Reviewer addendum: the record carries a `Blocked by #N: {assumption}` line. Judge that trailing assumption text against this narrower check — does it assert a structural fact (a function, symbol, API, file, or exported artifact existing on #N) or a prose/documentation-shape claim (a specific string, wording, or a prediction about what #N's own `## Non-Goals` will or won't scope out)? A prose-shape assumption is fragile — #N's own later scoping decision can legitimately drop that exact wording while still shipping the capability — and must be surfaced as an unstated-assumption finding at that line's location, through the same findings table below. A structural assumption is not a finding under this check."}
> Constraint: Surface only ambiguities, gaps, and unstated assumptions. Not stylistic feedback. Not approval/rejection. Focus on the 3-5 most load-bearing items, not exhaustive enumeration — that is a ceiling, not a quota: one finding, or "No findings.", is a valid and expected outcome on a tight record, and padding toward a count is itself a defect. Read-only — do not modify the record.
>
> OUTPUT FORMAT (required):
> Return ONLY a markdown table, no preamble:
>
> | Severity | Path:Line | Finding | Evidence | Suggested resolution |
> |---|---|---|---|---|
> | medium | body:42 | "store retry state somewhere" leaves the surface undefined | the record mentions retry behavior in 3 places without naming a storage backend | name the table or in-memory structure |
>
> Severity scale: critical / high / medium / low / info
> Path:Line is a line offset within the record body, OR literal "general" if no precise location.
> Suggested resolution is optional — leave the cell empty if the persona has no constructive fix.
> If no findings: return literal text "No findings."
> Return at most 7 rows, highest severity first; if more were found, append a final row reading "+N more" with the count in place of N — never omit this row when findings exceed the cap.
> Do not add narration, headers, or summaries before or after the table.
>
> After the table, on its own trailing line — the last non-empty line of your reply — write exactly one of: DONE / DONE_WITH_CONCERNS / NEEDS_CONTEXT / BLOCKED.
>
> [Use: Standard] — resolve via `node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-profile.js" standard` (contract § Model Selection).
> ```
>
> **The three personas (lens questions verbatim):**
>
> | Persona | Lens question |
> |---|---|
> | Implementer | Could I build exactly what this asks for without asking a question? |
> | Maintainer | In 6 months, can someone changing related code know what they can/can't break? |
> | Skeptical Reviewer | What unstated assumption is doing the load-bearing work here? |

## Write-back procedure

**Synthesis path (record #220).** When this run is interactive and `node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-profile.js" frontier --run-dir "$PIPELINE_RUN_DIR"` (`_shared/subagent-dispatch-core.md`'s Model Selection dispatch procedure) returns `frontier`, dispatch the write-back below as **one** `[Use: Frontier]` singleton Task agent — the main thread hands it every persona's raw findings plus the current record body — and, when this decomposition followed a brainstorm in the same session, the brainstorm's decision summary (the design doc's rationale section, or the parent record's `## Decision Rationale` once Step 4 wrote it), since findings that turn on a design decision the record has not yet absorbed cannot be resolved from the record alone — and the agent returns the fully recomposed body (the same shape steps 1-4 and 6 below produce by hand — dedup, severity floor, markers, rows, one recomposed body; staging, ready-clearing, and decision-log writes — steps 5 and 7 — stay in the main thread regardless of which path ran). Any other resolution (non-interactive, stance below `default`, cap exhausted, or a plain non-interactive run with no run directory) means the resolver returns `capable` or degrades — **in that case the write-back stays exactly as documented below, run in the main thread, with no dispatch of any kind.** There is no Capable dispatch of this step; the degraded state is today's existing main-thread behavior, unchanged.

After all dispatched personas return (and, when the synthesis path above did not trigger, in the main thread itself), write findings back into the record body:

1. **Dedup across personas** — before writing anything, merge findings from different personas that flag the same location or the same underlying assumption into one finding, crediting every flagging persona in the `{persona}` slot (`Implementer+Skeptical Reviewer`) and keeping the highest severity among the merged. Convergence is a severity signal, not separate obligations — never write two markers against one sentence.
2. **Severity floor** — `info` findings are dropped outright (counted in the decision-log summary, never written to the record). `low` findings never become inline markers — they land in the `## Open Questions` table regardless of location precision. `medium` and above follow the two location rules below.
3. **Precise-location findings** (persona named a specific sentence, quoted text, or line range) → insert `<!-- ambiguity: {persona} — {finding text}{; suggested: {resolution}} -->` immediately after the flagged sentence. On the same line if short; on the next line if long.
4. **General findings** (no precise location) → accumulate into an `## Open Questions` table appended to the record, with columns `Persona | Finding | Suggested Resolution`. When this batch is empty, omit the section entirely — do not emit an empty header.
5. **Decision-worthy findings stage instead of self-resolving — only when a run directory actually resolved.** A `critical` finding, or one whose suggested resolution would change the sub-issue's Deliverables or Acceptance Criteria scope, is a decision, not a copy-edit, and Step 6 Self-Review must not resolve it on its own authority (`_shared/auto-mode-contract.md`: decision-worthy → stage, don't act). Write it into the record like any other finding per the rules above, then additionally, per which of `_shared/run-dir-resolution.md`'s Resolution order applied to this invocation:
   - **A run directory resolved** (steps 1-4 there — inherited from a pipeline parent, or `next`'s own standalone-auto run dir): compose a proposal file (the finding, its evidence, and the proposed resolution as concrete body edits) and stage it via `node "${CLAUDE_PLUGIN_ROOT}/bin/stage-item.js" --run "{the resolved run dir}" --id red-team-{ref}-{slug} --file {path}` (`_shared/auto-decision-log.md`'s staged-proposal CLI); clear the record's ready state (`gh issue edit {ref} --remove-label ready` under github-issues; set `facets.stage` back to `backlog` in the same `writeRecord` call under local-files); and write the `STAGED` entry from step 7. The Review Console applies or rejects the proposal — applying it edits the resolution in, deletes the marker, and restores `ready`.
   - **No run directory resolved** (step 5 there, interactive fallback — the ordinary human-invoked decomposition form; there is no `staged/` to write into). This is exactly the shape where a human is present (`specify/SKILL.md`: user-facing in every form but `--chained`), so ask them instead of staging into a file nothing will ever read: call `AskUserQuestion` with the finding, its evidence, and the proposed resolution — options `Apply the resolution` (Recommended) and `Leave the marker, don't clear ready`. Applying folds the resolution into the same compose-then-write in step 6 and deletes the marker; declining keeps the marker in place and still clears `ready` the same way the staged path does (a `critical` finding stays a `critical` finding either way — Step 6 still may not clear it on its own authority). No `decisions.md` exists in this shape, so there is nothing to log — skip step 7's `STAGED` entry for this finding.
   Everything below this bar keeps the existing no-stop flow.
6. **Compose-then-write-once** — fold every finding for a given sub-issue into one recomposed body, then write it with a single `gh issue edit {subIssueNum} --body-file` (github-issues) or `writeRecord` call (local-files) — the same discipline every other write in this skill uses. Never make one API call per finding.
7. **Decision-log entries — only when a run directory resolved.** When step 5 found one (steps 1-4 of `_shared/run-dir-resolution.md`'s Resolution order): one `AUTO` summary per sub-issue record, never one entry per finding, plus one `STAGED` entry per finding actually staged:
   ```
   AUTO {HH:MM:SS} — Red-team {ref}: {per-persona finding counts, severity mix, merged/dropped counts}. Written back as {n} inline <!-- ambiguity: --> markers + {m} Open Questions rows in one recomposed-body write. Reversibility: high.
   ```
   ```
   STAGED {HH:MM:SS} — Red-team {ref}: decision-worthy finding "{short finding}" staged for Review Console at staged/red-team-{ref}-{slug}.md; ready cleared pending resolution.
   ```
   Write both **after** the record body write lands — if the write-back fails, the decision-log should not lie about what happened. When no run directory resolved (step 5's interactive fallback), there is no `decisions.md` to write into — skip this step entirely; the record body write and, when it fired, step 5's `AskUserQuestion` resolution are the only artifacts of this run.

Red-team runs on every generated sub-issue record regardless of `Surface:` — the lens questions are artefact-agnostic. Step 6 Self-Review resolves everything below the decision-worthy bar; findings staged in step 5 resolve at the Review Console instead. There is no mid-flow stop here — staging is not a stop. Persona count varies by tier (see above); the write-back procedure itself is identical regardless of how many personas ran.
