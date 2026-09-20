# Tidy — Scan Execution Mechanics

The dispatch contract, model profile, output template, and column semantics for Steps 1-4.95's
scan batch, extracted from `SKILL.md` so this skill's main file stays under its own budget. `SKILL.md`
keeps the step-cost framing sentence and a stub pointing here; the per-step data-source table
(which step reads what, and its `[type]` output prefix) also stays in `SKILL.md`.

---

> **Parallel execution:** Dispatch the agent-backed steps selected by the active scope (Steps 1, 3, 4.5, 4.7, 4.8, 5.5, and 5.6 for an unscoped/full run; a `--scope`-filtered subset otherwise, per "Scope Selection" above) as parallel Task agents — each scan is independent (Work Records, Design Docs, Git, Issue Claims, GitHub PRs/Issues, Patterns). Each agent returns findings in the `[type] item — detail — recommendation` format. Step 3's classification tables are inlined directly into its agent prompt (see Step 3 below) so subagents have everything they need. Step 5.5 has no data dependency on any other step (git-log only), so it joins the parallel batch directly — its output is simply slotted into the correct Step 6 report section afterward. Step 5.6 (the digest sweep) has no agent of its own — its driver-dependent scope (per "Scope Selection" above) folds it into whichever existing agent already owns that driver's container: the Work Records agent under `work-backend: local-files` (container: `specs/digest.md`), the GitHub PRs/Issues agent under `work-backend: github-issues` (container: the `digest`-labeled issue); that agent reads `digest-sweep.md` whole and inlines it into its own prompt (per `SKILL.md`'s "The digest sweep is likewise a separate file" note) when Step 5.6 is in scope. Step 5 is the one step that stays sequential: it depends on Step 1's record-scan results (its `ready`, unclaimed rows), which is why `specs` pulls in both Step 1 and Step 5 (per "Scope Selection" above), and it runs only after the parallel batch (including Step 1) completes. Assemble all findings into the Step 6 report.
>
> **Contract:** Each agent follows `_shared/subagent-output-contract.md` — minimal input, status line first, output template inlined verbatim. [Use: Fast] (resolved as stated in the Model profile line below). Dispatch shape: single-assistant-message rule (`_shared/subagent-dispatch-core.md`'s fan-out section) applies.
>
> **Model profile:** [Use: Fast] — each scan is a mechanical read of a single data source (the open work-record queue, design-doc directory, `bin/residue.js` + local branches, issue-claim blobs + comments, gh PR/issue queries, recent git history). No cross-cutting analysis at the per-scan level; Step 5 does the synthesis sequentially in the main thread after the parallel batch (including Step 5.5) completes. Resolve via `node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-profile.js" fast` (contract § Model Selection).
>
> **Output template (each agent must follow exactly):**
>
> ```markdown
> OUTPUT FORMAT (required):
> Return ONLY a markdown table, no preamble:
>
> | Severity | Path:Line | Finding | Evidence |
> |---|---|---|---|
> | critical | src/auth.ts:42 | Missing token expiry check | uses `<` not `<=` |
> | medium | src/api.ts:180 | Unhandled rejection | line 184: `await fetch(...)` no try/catch |
>
> Severity scale: critical / high / medium / low / info
> If no findings: return literal text "No findings."
> Return at most 15 rows, highest severity first; if more were found, append a final row reading "+N more" with the count in place of N — never omit this row when findings exceed the cap.
> Do not add narration, headers, or summaries before or after the table.
> ```
>
> Each agent's first reply line must be one of `DONE / DONE_WITH_CONCERNS / NEEDS_CONTEXT / BLOCKED`, then the Template A table verbatim. Agents do not invent a new schema.
>
> **Tidy-specific column semantics (for the dispatcher, not the agents):** when the dispatcher receives Template A rows back from each scan agent, it interprets the four standard columns in this skill's vocabulary — Severity = recommendation urgency (`info` for Keep, `low` for routine cleanup, `medium` for Promote/Absorb/Defer, `high` for stale-Delete or registry break); Path:Line = the artifact (the record reference — `#{n}` under `github-issues`, the local record path under `local-files` — `docs/REGISTRY.md`, or a worktree path); Finding = `[type] item — short detail` (e.g., `[backlog] "Build redis cache" — 5 weeks old`); Evidence = the recommendation (`Delete — stale` / `Promote — ready for brainstorm` / `Absorb → #42`). The dispatcher merges all agents' Template A tables into the Step 6 report using these semantics. **Template A itself is unchanged** — the remapping is purely how the dispatcher reads it.

> **Parallel execution:** Use parallel tool calls aggressively — the `Glob`/`Read` operations in Steps 4 and 4.6, Step 4.9's Skill-tool call, and Step 4.95's Skill-tool call are independent and should run concurrently.

Issue those Step 4/4.6/4.9/4.95 tool calls in the same message that dispatches the agent batch above — they depend on neither it nor each other, so the whole batch overlaps. Being in the main thread they need no status line and no agent envelope, and the Contract/Model profile/Output template above do not apply to them; their findings feed the Step 6 report directly in the same `[plan]`/`[ledger]`/`[registry]`/`[doctor]`/`[calibration]` format, read through the same column semantics. Keep Step 4's judgment metadata-only (filename, file age, whether a related record exists and is still open) — do not read plan bodies into the main thread, which is the cost this demotion exists to avoid. The one exception is the ledger scan's own small, structured `*-ledger.md` files (a few KB, a fixed table format), read in full to check each row's `Status` column per `scan-procedures.md`'s Step 4 ledger rules — not the same cost class as an execution-plan body. All four steps stay `--scope`-selectable exactly as before (`plans` → 4, `registry` → 4.6, `design` → 4.9; Step 4.95 has no scope tag of its own — it runs on every unscoped full sweep, same as `[doctor]`'s own report-only posture); only the execution mechanism changes, not which steps a scope covers.
