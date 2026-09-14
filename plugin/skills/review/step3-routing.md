# Review — Step 3 Routing (Code Review Findings)

Loaded by `/claude-tweaks:review` Step 3 after lenses 3a-3i have produced findings. Contains the full routing rules — severity-based auto routing, the interactive batch table, recommendation rules, deferral gate, and parallel-fix dispatch contract. Lazy-loaded only when findings actually exist (skip the load entirely when all lenses returned "No findings.") — the canonical per-lens dispatch template that used to force a pre-dispatch load of this file now lives in `step3-lens-dispatch.md`'s "Per-lens Calibration + Output template" section, which is where the CALIBRATION-block byte-identity with `_shared/criteria-review-quality.md` is pinned.

## Inputs

- Findings table merged from lenses 3a-3i, plus open QA ledger entries with phase `test/qa`.
- Pipeline run directory (when in auto/hybrid mode).
- `review-auto-apply-ceiling`, resolved per the Auto mode section below (resolver `--run` overlay; ceiling-conditional default when nothing is set).
- The resolved `review-effort` tier from `/claude-tweaks:review`'s Step 2.5.

**`unconfirmed` findings can originate from several sources**, and all render identically in this table with `(low-confidence)` appended — the caller does not distinguish them:

- No reproduction agreement (Step 3) — a lens's finding surfaced by only one of its two reproduction agents. **Direct-verification override:** this specific source can still resolve to `confirmed` — see `step3-lens-dispatch.md`'s "Direct-verification override" — when the reviewing agent independently reads the actual conflicting source text (not the agent report) and confirms the finding; that override is additional to reproduction-pair agreement, not a substitute for it, and does not apply to any of the other `unconfirmed` sources below except the low-tier single-read source, where it is the designed confirmation path.
- Low-tier single-read (Step 3, `review-effort: low` only) — the tier dispatches one agent per lens instead of a reproduction pair (`step3-lens-dispatch.md`'s "Low-tier single-read dispatch"), so every finding starts `unconfirmed`; the Direct-verification override is the only path to `confirmed` for this source.
- Cross-lens debate converged negative (Step 3.5) — both judges disagreed.
- A `confirmed` finding downgraded by the Per-Candidate Refutation Pass (Step 3.5, `xhigh`/`max` only) — the finding survived reproduction (and possibly debate) but a later falsification agent refuted it.
- Gap-sweep, single-source by design (Step 3.6, `xhigh`/`max` only) — a fresh-eyes finding with no reproduction partner, by design (pairing it against a second identical fresh-eyes agent would defeat its purpose).

**Effort-tier surfacing.** By default (`review-effort` at `low`/`medium`/`high`), this table includes only `confirmed` findings — `unconfirmed` (any of the sources above) and `contested` (debate inconclusive) findings bypass this table entirely and route straight to the Wrap-Up Review Console's Low-confidence and Contested subsections, unchanged from this skill's pre-existing behavior.

At **`xhigh` and above**, `unconfirmed` findings additionally appear inline in this table too — add them as ordinary rows with `(low-confidence)` appended to the Finding column, alongside the `confirmed` rows. They still also get staged to the Wrap-Up Console as before (surfacing inline doesn't remove the staging).

At **`max`**, `contested` findings additionally appear inline as well, on top of the `unconfirmed` rows `xhigh` already added — so at `max` this table shows `confirmed` + `unconfirmed` + `contested` findings together, all three buckets at once. Add `contested` rows with `(contested — {debate verdicts})` appended to the Finding column, summarizing the side-by-side verdicts from Step 3.5's debate. They still also get staged to `staged/review-contested-{N}.md` as before.

**Refutation overflow note (required when present).** At `xhigh`/`max`, the Per-Candidate Refutation Pass (`step3-debate-and-refutation.md`, step 3) caps its fan-out at 10 candidates. When it capped, it emits a `+{N} more confirmed findings were not refuted …` line — render that line immediately above the findings table, verbatim. Those `+{N}` findings are ordinary `confirmed` rows in the table; the note exists so the reader knows they reached routing without a falsification attempt, rather than having silently passed one. Omit the note only when the pass did not cap (or did not run at all).

**Every finding from lenses 3a-3i must be explicitly resolved.** When lenses were dispatched as parallel Task agents, merge their results into a single table here: combine all findings, preserve their category labels, and de-duplicate — if two lenses flag the same issue, keep the entry with the higher severity. UX findings from lens 3h, coverage findings from lens 3g-cov, and documentation findings from lens 3i are merged into the batch table alongside code review findings with their respective categories ("UX", "Coverage", "Docs").

Unresolved QA ledger entries (status `open`, phase `test/qa`) are included in the code review findings table alongside code review findings. Use the category and severity from the ledger entry. This ensures QA failures flow through the same resolution process as code review findings — they must be explicitly fixed, deferred, or accepted before the review can pass.

## Auto mode (severity-based routing)

When a pipeline run directory exists (see the composed review-dispatch bundle's — `step3-lens-dispatch.md`'s "Composed dispatch-contract bundle" section composes it — run-dir-resolution content for the resolution order and bash snippet, or `_shared/run-dir-resolution.md` directly standalone), resolve `review-auto-apply-ceiling` — `node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-policy.js" --run "$PIPELINE_RUN_DIR" review-auto-apply-ceiling` (JSON envelope, not `--values`, because the next sentence needs `source`). When the envelope's `source` is `default` (no CLI arg, no Manifesto override, no project policy — nothing set at run or policy level), the effective default is ceiling-conditional: `medium` when the resolved `autonomy` ceiling is `unattended`, `low` otherwise — see `_shared/autonomy-ceiling.md` for the rationale; this is a skill-default shift, not a new capability, so an explicit value at any level still wins. A piped `/flow` run never reaches this `source: default` branch for this lever — the Manifesto computes the same ceiling-conditional value into `config.yml` (`flow/manifesto.md`'s Recommendation-defaults row), which resolves as `source: run-config` here, already ceiling-correct. What this branch remains for is a run directory whose `config.yml` never set the lever — e.g. a `/build`-parented review resolving a standalone-materialization run dir, which carries `decisions.md`/`staged/` but no Manifesto-written `config.yml` (`_shared/run-dir-resolution.md`); a standalone `/review` with no run directory never executes this resolution at all (`_shared/policy-schema.md`'s lever row: no standalone direct-read site exists).

Also resolve `review-auto-apply-prose-exempt` the same way — `node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-policy.js" --run "$PIPELINE_RUN_DIR" review-auto-apply-prose-exempt` (boolean, default `true`). When it resolves `true` **and** every `Target:` path in the finding's staged-patch preamble (`_shared/staged-patch.md`) matches `skills/**/*.md` or `docs/**/*.md` — prose-only files; `tests/**` was narrowed out of this set by #1059, since it is executable code in this repo and in every consumer project, and #660's own evidentiary basis never exercised it — look up this finding's row in the table below using a **bumped ceiling** — one severity tier above the resolved `review-auto-apply-ceiling` (`none`→`low`, `low`→`medium`, `medium`→`medium` — capped: the bump never reaches `high` or `critical` at any ceiling value) — instead of the plain ceiling. A finding whose fix spans both an exempt and a non-exempt `Target:` path is not eligible for the bump; it routes on the plain ceiling like any other finding. **When `review-auto-apply-prose-exempt` resolves `false`**, this whole paragraph is inert — every finding routes on the plain, unbumped `review-auto-apply-ceiling` exactly as it did before this dimension existed.

Per the `/review` Step 3 Routing row in `_shared/auto-mode-contract.md`, severity routes to: low → AUTO, medium → STAGED, high → STAGED, critical → KEPT-PROMPT (rare; security/correctness hard-fails the bookend). Append every entry to `decisions.md` under the `## /review` heading.

| Severity | Default action under `review-auto-apply-ceiling: low` | Log entry |
|---|---|---|
| **Critical** | Stage as patch + `KEPT-PROMPT` — surface inline ALSO. Critical findings always interrupt. | `KEPT-PROMPT {time} — Step 3 Routing: critical finding {category} at {file:line}. Surfaced inline. Reversibility: high.` |
| **High** | Stage as patch in `staged/review-{n}.patch`. Surface at Review Console. | `STAGED {time} — Step 3 Routing: high-severity finding {category} at {file:line}. Stage path: staged/review-{n}.patch. Reversibility: high.` |
| **Medium** | Stage as patch in `staged/review-{n}.patch`. Surface at Review Console. | `STAGED {time} — Step 3 Routing: medium-severity finding {category} at {file:line}. Stage path: staged/review-{n}.patch. Reversibility: high.` |
| **Low** | Auto-apply the fix. Commit. | `AUTO {time} — Step 3 Routing: applied low-severity {category} fix at {file:line}. Reversibility: high; commit: {hash}.` |

When `review-auto-apply-ceiling: medium`: auto-apply Low AND Medium; stage High; prompt Critical.
When `review-auto-apply-ceiling: none`: stage everything; never auto-apply, except a finding eligible for the prose-exempt bump above, which routes at `low`.

**Logging a bumped auto-apply.** When the bump above is what moved a finding from Staged/Kept-prompt under the plain ceiling to Auto under the bumped ceiling, the `AUTO` log entry names the bump explicitly: pass `--lever "review-auto-apply-ceiling={ceiling} ({source}); prose-exempt bump applied"` to `log-decision.js`, rendering `[lever: review-auto-apply-ceiling=low (default); prose-exempt bump applied]` — distinguishing it from an ordinary ceiling-driven `AUTO` entry (no trailing clause). A finding that was already going to auto-apply under the plain ceiling (the bump wasn't load-bearing) logs the ordinary format with no bump suffix.

**Ledger first, then the patch.** For a High/Medium finding, append it to the open items ledger (status `open`, phase `review`) before composing the staged patch — the assigned item number is what the patch's `Ledger:` field below points at, so the order matters: a patch composed first would have nothing to reference.

**Staging a patch — validate first, describe the invariant.** Every `staged/review-{n}.patch` written by the rows above follows `_shared/staged-patch.md`: the file opens with a `Target:` / `Invariant:` / `Finding:` / `Staged-at:` / `Ledger:` preamble (the target file plus the one-sentence property the fix establishes — the durable intent — plus the exact ledger row this finding was just appended to) followed by the unified diff, and is validated with `git apply --check` from the worktree **before** the `STAGED` log entry is written. A failing check is handled per that file's Staging-time gate and surfaces here, at staging time — never first at the console. This matters because `/simplify`, polish, and later fix waves legitimately move the target lines between now and the console; the console applies the diff when it still fits and otherwise re-derives the edit from `Invariant:` (that file's Console apply with description fallback), so a stale diff is expected, not an error.

After routing, append all findings to the ledger as usual (status `open` for staged, `fixed` for auto-applied). The Review Console at `/wrap-up`'s Phase 4 surfaces staged items for batch approval, and its apply step writes each outcome back to the `Ledger:`-named row (`_shared/staged-patch.md`'s Write-back to the ledger) — the ledger entry above is not the last write for that item, just the first.

## Interactive mode (per-batch user input)

Present all findings as a single batch table with recommended actions pre-filled:

```
### Code Review Findings

| # | Finding | Severity | Category | Affected | Recommended |
|---|---------|----------|----------|----------|-------------|
| 1 | {description} | Critical | Security | {files} | Fix now |
| 2 | {description} | High | Error | {files} | Fix now |
| 3 | {description} | Medium | Convention | {files} | Fix now |
| 4 | {description} | Low | Perf | {files} | Fix now |
```

The table renders as markdown, as above. Immediately below it, call `AskUserQuestion` with:

- `question`: `"How do you want to handle these findings?"`, `header`: `"Findings"`, `multiSelect`: `false`
- Option 1 — `label`: `"Apply all (Recommended)"`, `description`: `"Apply all recommended fixes"`
- Option 2 — `label`: `"Override specific items"`, `description`: `"Tell me which #s to change"`

**Hard gate.** Check the response you are about to send: does it already contain the `### Code Review Findings` table above as literal rendered markdown, with a row for every finding? If not, render it now, in this response, before the tool call — "Apply all" with no table above it leaves the user approving an unnamed set of fixes.

If "Override specific items" is chosen, the follow-up is ordinary free-text chat in the next message, per docs/skill-authoring.md's Multi-item decisions convention — not the tool's `Other` field.

**Recommendation rules** (interactive mode — severity-to-route mapping in `auto` mode is the table at the top of this file):

- **Critical** (security vulnerabilities, data loss risks) — always "Fix now". Non-negotiable.
- **High** (broken behavior, missing validation) — default "Fix now".
- **Medium** — default "Fix now". Even if effort is moderate, close the gap now.
- **Low** — default "Fix now". Most low-severity findings are trivial to fix.
- **"Don't fix"** — only for false positives or intentional patterns. If the finding is a genuine improvement, it must be fixed or routed — never silently dismissed.

**When "Fix now" isn't possible**, route to the right destination:

- **Defer** (new work record — born-ready, or `parked` on a concrete wake condition) — the fix is understood but it's bigger and not relevant to the current work. Compose the body via `specShapedBody` (finding + evidence → Current State, citing the origin spec as `refs #{n}`; the fix → Deliverables; the review lens's own check → Acceptance Criteria; `filedBy: 'review'`; `provenance: { origin: 'spec #{n} review ({lens})', deferReason }` — the reason chosen by the mapping below; footer `_Filed by \`review\` via specShapedBody._`), then create it directly via the unified record contract (`_shared/work-record.md`) — `gh issue create` (`work-backend: github-issues`) or `local-store.js`'s `writeRecord` (`work-backend: local-files`) — with `recordPayload({ …, risk, size, ready: true })` scored per the Scoring axis (born-ready per `_shared/work-record.md`'s `/review` row), or `header: 'Trigger: {wake condition}'` + `parked: true` instead of `ready` when the reason is `blocked-dependency`/`blocked-external` with a concrete wake condition. A finding whose verification cannot be honestly stated (its own text names an open choice or missing evidence) uses the composer's `openQuestion` variant and files `needs:definition` (a label with no `recordPayload` parameter — append it at the create call) with no `ready` and no scoring, per `_shared/work-record.md`'s `/review` row; a finding naming an open product choice routes to Capture instead (`tangential` captures). Before composing, apply `_shared/materiality-floor.md`'s floor test to this item (judged the same way this bullet already scores `risk`/`size` for `recordPayload`, plus the `priority` axis no filing path here stamps — the routing skill judges that one too, per that contract): when it fails to clear the materiality floor, and `Defer-reason` is not `tangential` (which always clears the materiality floor per that contract's Overrides section), the batch table's Recommended column shows `"Digest — below floor"` instead of `"Defer — {reason}"` — the digest entry is written only once the human approves that row (via "Apply all" or an override), never silently substituted underneath an unchanged Defer label; once approved, check `isMaterialityDuplicate` (`_shared/materiality-floor.md`'s Dedup section) against the open digest container before appending — a re-encountered finding folds into its existing entry rather than adding a second one — then skip the rest of this bullet's `specShapedBody`/`recordPayload`/`gh issue create` steps for that item. This skill's own end-of-run summary states the digest comment URL and the count routed this run, per `_shared/materiality-floor.md`'s "Digest URL and count surfacing" section — never left implicit in the digest issue alone, and never omitted on a zero-routing run.
- **Capture** — the finding is complex or uncertain and needs brainstorming/exploration before it can be acted on. This enters the full capture → `/superpowers:brainstorming` pipeline. Invoke `/claude-tweaks:capture` with the shaped body and `--defer-reason={value} --source review` (capture's Shaped-body branch — `capture/SKILL.md`), plus `--needs-definition` when the finding names an open choice. This branch's items usually carry `Defer-reason: tangential` (per the Defer bullet above), which `_shared/materiality-floor.md`'s override always clears — a Capture-routed finding with reason `tangential` never routes to the digest container; it files via `/claude-tweaks:capture` as above. A Capture-routed finding carrying a different `Defer-reason:` (the rarer case) is still subject to the same materiality-floor test as the Defer bullet above, applied before invoking capture. Cited here so `_shared/materiality-floor.md`'s Overrides section is confirmed to cover every filing branch in this file, not only the common case — not to be confused with `_shared/deferral-gate.md`'s own "Floor mapping" section, a different, autonomy-ceiling floor with the opposite verdict for `tangential`.

**Deferral gate:** `_shared/deferral-gate.md` is the gate — run its fix-now criteria before any Defer or Capture, and never skip a fix for one of its bad reasons (its list includes "minor / not load-bearing" — severity floors decide what blocks, not what gets fixed). A finding that fails fix-now carries exactly one `Defer-reason:` from that file's vocabulary, chosen by this mapping (one line of justification recorded in `decisions.md` alongside the routing decision):

- a defect in a file the diff does not touch → `pre-existing-outside-diff`
- a fix needing a product/design call → `needs-human-decision`
- a fix that expands scope past the fix-now criteria → `genuinely-larger`
- a fix waiting on unbuilt functionality → `blocked-dependency`
- a fix waiting on external state → `blocked-external`
- a new capability the finding suggests → `tangential` (Capture, not Defer)

A finding that fails fix-now with **no** valid reason stays `open` — in an interactive review it goes to the human drill; in `auto` it becomes an `open` ledger item for wrap-up's Phase 2 drill — it is never filed as a record; it resolves at the human drill (interactive) or wrap-up's ledger resolve gate (auto).

If any findings are "Fix now", make the changes, re-verify per `_shared/deferral-gate.md`'s Re-verification rule (`/claude-tweaks:test`), and verify fixes didn't introduce new findings.

## Parallel fix dispatch (3+ independent fixes)

> **Working Directory Discipline:** Applies to every fix-agent `Task()` dispatch. Apply the Working Directory Discipline rule from the composed review-dispatch bundle (or, standalone, `_shared/subagent-dispatch-core.md`) before any git or path-sensitive command in the agent prompt. See also `_shared/git-discipline.md`.

> **Parallel execution (conditional):** When there are 3+ "Fix now" findings across different files with no shared file dependencies, dispatch fixes as parallel agents using the `/superpowers:dispatching-parallel-agents` pattern — one agent per independent fix domain. Each agent gets: specific file scope, finding details, constraint to not modify other files. Returns summary of changes. After all agents complete, check for conflicts between agent changes, then re-run `/claude-tweaks:test`. When fixes overlap files or there are fewer than 3 findings, fix sequentially in the main thread.
>
> **Model profile:** [Use: Standard] — fix agents make targeted code edits constrained to their assigned files. Upgrade to Capable only when the fix requires architectural redesign rather than localized correction. Resolve via `node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-profile.js" standard` (contract § Model Selection).
>
> **Output template (each agent must follow exactly):**
>
> ```markdown
> OUTPUT FORMAT (required):
> First line: DONE / DONE_WITH_CONCERNS / NEEDS_CONTEXT / BLOCKED
> Then per change made:
> - {path}:{line} — {change description}
> If no changes made: return literal text 'No changes.'
> ```
>
> **Post-dispatch diff audit (mandatory).** After all fix agents return and before re-running `/claude-tweaks:test`, run `git diff --stat` (plus `git status --porcelain` for untracked additions) and verify every file each agent claimed to change actually appears with real hunks. A detailed, specific fix narrative with zero corresponding diff is an observed failure mode — never accept an agent's bullets as evidence of the edit. An agent whose claimed changes are absent from the diff is treated as failed: its findings stay `open`, and the fix is re-applied inline in the main thread (never by re-trusting a second narrative). Only after the audit passes does the dispatcher inspect the bullets for cross-file conflicts and re-run `/claude-tweaks:test`. This audit's sibling runs earlier in the same review — the post-fan-out untracked-file sweep (`step3-lens-dispatch.md`) checks the same class of leftover after the lens/refutation/gap-sweep fan-out, before this routing step ever loads; both apply one rule (report untracked leftovers, never silently trust them) at the two points in the pipeline where dispatched agents write files.

**Write all findings to the open items ledger** (see `/claude-tweaks:ledger`). Use the appropriate `review/*` phase. Status: `open` for "Fix now" items, `deferred` for Defer routes, `accepted` for "Don't fix" items (with reason). After fixing, update status to `fixed`.

## Routing bias

Fix it now — always the recommended default, regardless of severity. Defer when the fix is understood but bigger and not relevant now. Capture when the finding needs exploration before it can be acted on. The goal is to close gaps early, not accumulate a backlog.

## Wait-for-resolution + auto-advance

**Wait for resolution** (interactive mode only). When code review findings exist, present the findings table and wait for the user's response before proceeding to Step 4. In `auto` mode, findings are auto-routed per the severity table above and the skill proceeds without waiting.

**Auto-advance on zero findings:** When there are zero code review findings AND zero unresolved QA ledger entries (`open` items with phase `test/qa`), auto-advance to Step 4 without waiting for user input. Present "No code review findings" as a note within the Step 4 hindsight message.

**Small batch consolidation:** When total findings across Step 3 Routing and Step 4 combined are 5 or fewer items, consolidate into a single batch table with a "Type" column (`Code Review` / `Hindsight`) instead of two sequential tables. This saves one interaction. When more than 5 total, present sequentially (one per message) to keep each decision manageable.
