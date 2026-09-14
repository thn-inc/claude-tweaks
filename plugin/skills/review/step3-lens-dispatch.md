# Step 3 Lens Scope and Dispatch — /claude-tweaks:review

Read from `code-mode-steps.md`'s Step 3 before dispatching any lens. Holds the `review-effort` tier →
lens-scope mapping, the dispatch contract (context bundle, reproduction pairs, model profiles),
the canonical agent prompt (the "Per-lens Calibration + Output template" section below — moved
here from `step3-routing.md` so that file's findings-conditional lazy-load actually holds; it
used to be needed pre-dispatch, which made its "load only when findings exist" contract
structurally false), and the question list for lenses 3a-3f. The severity floor per lens stays
in `code-mode-steps.md`.

"Above" in the next section means `code-mode-steps.md`'s Step 3 preamble — the "skip lenses that don't
apply to the type of change" rule and the severity-floor table.

## Composed dispatch-contract bundle (#2019)

> Steps 3, 3.5, and 3.6 all cite the Subagent Contract's dispatch-facing sections (Working
> Directory Discipline, Model Selection, Failed-agent retrieval, the fan-out section) plus the
> run-directory resolution algorithm — never the whole `_shared/subagent-output-contract.md` or
> `_shared/pipeline-run-dir.md` files, which carry other content these steps never read. When a
> pipeline run directory exists, compose the narrower bundle once, before Step 3's first dispatch:
>
> ```bash
> node "${CLAUDE_PLUGIN_ROOT}/bin/compose-context.js" --run "$PIPELINE_RUN_DIR" --step review-dispatch "${CLAUDE_PLUGIN_ROOT}/skills/_shared/subagent-dispatch-core.md" "${CLAUDE_PLUGIN_ROOT}/skills/_shared/run-dir-resolution.md"
> ```
>
> then read `$PIPELINE_RUN_DIR/context/review-dispatch.md` for every citation below and in
> `step3-routing.md`/`step3-debate-and-refutation.md` — composed once per review run, not
> re-composed per step. **Standalone** (no run directory, or the compose command is unavailable or
> exits non-zero): read `_shared/subagent-dispatch-core.md` and `_shared/run-dir-resolution.md`
> directly instead — the two files this bundle composes.

## Lens scope and dispatch

**Lens scope by `review-effort` tier** (resolved in Step 2.5): lower tiers dispatch fewer agent-based lenses, trading breadth for speed and higher-confidence-only output; higher tiers trade speed for broader coverage.

| Tier | Agent-dispatched lenses in scope |
|------|------|
| `low` | 3b, 3c |
| `medium` | 3b, 3c, 3a, 3f |
| `high` | 3b, 3c, 3a, 3f, 3d, 3e, 3h — every applicable lens. **Reproduces this skill's pre-existing default behavior.** |
| `xhigh` | Same lens set as `high` |
| `max` | Same lens set as `high` |

A lens outside the resolved tier's scope is never dispatched — it does not run and produces no findings. The pre-existing "skip a lens if it doesn't apply to this change type" rule (above) still applies on top of whichever set the tier allows — e.g. at `high`, Performance is still skipped for a docs-only diff. Lens 3h additionally requires QA data to be available at all (its own existing, effort-independent gate) — when QA data isn't available, 3h doesn't run even at `high`+. Lenses 3g-cov, 3i, and 3i-diagram are **not** gated by effort at all — they're main-thread/deterministic, not agent-dispatched, and stay gated only by their own existing data-availability conditions.

Reproduction pairs (the 2-agent verification dispatch below) run for every lens that uses the reproduction-pair mechanism (3a-3f) and is in scope at the resolved tier, **at `medium` and above** — verification is never skipped there, only the initial lens set that gets a chance to flag something. (3h is never reproduction-paired, at any tier — see the "not dispatched as reproduction pairs" note below.)

**Low-tier single-read dispatch (`low` only).** At `low`, the reproduction mechanism does not run at all — dispatch **one** agent per in-scope lens (3b, 3c), not a pair. This is not "reproduction with N=1" (Mode 1 in `_shared/multi-agent-coordination.md` is N=2 always when it runs); it is the tier's economy trade, halving the cheapest tier's fixed cost. Every finding a single-read agent returns enters as `unconfirmed`, and the only path to `confirmed` is the Direct-verification override below applied deliberately: the reviewing agent reads the actual current source at each finding's `{path}:{line}` (the real file content, not the agent's report of it) and independently confirms it. Log a confirmation as `AUTO {HH:MM:SS} — Single-read (low tier): lens "{lens}" finding {path}:{line} confirmed via direct verification (source read independently). Reversibility: high.` A finding the reviewer cannot confirm this way stays `unconfirmed` — log `STAGED {HH:MM:SS} — Single-read (low tier): lens "{lens}" finding {path}:{line} not directly verified. Staged to Review Console as low-confidence. Reversibility: high.` — and routes to the Wrap-Up Console's Low-confidence subsection as usual. The correlated-misread protection a pair provides is deliberately traded away here; a review that warrants that protection warrants `medium` or above (Step 2.5's ambiguity rule already never defaults to `low`).

**Hung or non-responsive single-read agent.** A dispatched single-read agent that produces no output at all — no status word, no findings table, not even a failure — is a different failure mode from the reproduction-pair partner-death case above (which has a named error signature to detect). Wait a bounded interval (2-3 minutes), then attempt one nudge via `SendMessage` to the same agent; if that also produces nothing, treat the dispatch as failed and fall back to the reviewing agent's own Direct-verification override for that lens — reading the actual diff content directly and confirming (or not) whatever the lens would have checked — rather than continuing to poll indefinitely. Log `STAGED {HH:MM:SS} — Single-read (low tier): lens "{lens}" agent produced no output after a bounded wait; resolved via reviewing agent's own Direct-verification override. Reversibility: high.`

At `xhigh` and `max`, append the resolver's `effortLine` output to each dispatched lens's prompt, after the Output Format block (do not modify the CALIBRATION block itself — it stays byte-identical across all tiers, per the "Per-lens Calibration + Output template" section below): resolve the lens's profile per the composed review-dispatch bundle's (or, standalone, `_shared/subagent-dispatch-core.md`'s) Model Selection dispatch procedure and append the returned `effortLine` verbatim — shape `[Effort: {level} — apply {level}-level reasoning depth to this task.]`. This is still a best-effort prompt-level nudge, not a verified change to the dispatched agent's actual reasoning depth — the lens-scope table above is the load-bearing mechanism — but it is now the resolver's own honest statement of effort rather than a hand-written sentence, so it never drifts from what the resolver actually returned.

> **Working Directory Discipline:** Applies to every `Task()` dispatch in Step 3, Step 3.5, and Step 3.6 (reproduction, debate, refutation, and gap-sweep agents). Apply the Working Directory Discipline rule from the composed review-dispatch bundle (or, standalone, `_shared/subagent-dispatch-core.md`) before any git or path-sensitive command in the agent prompt. See also `_shared/git-discipline.md`.

> **Full diff content is read here, in the lens agents — not in the main thread.** Step 2 deliberately holds only `--stat`/`--name-only`, so this dispatch is the first point at which actual diff content is read. Give each lens agent the shared context bundle's path (built below) plus the diff *scope* — the base/branch refs, or the own-work file set when the Merge-Provenance Check found merge commits. Do not inline diff text into the prompts from the main thread: every dispatched agent has its own context window, and re-inlining the diff N times reintroduces the cost Step 2 exists to avoid.

> **Parallel execution — assemble the shared context on disk, never in main-thread context.** Every lens needs the same files, so build the bundle once — its content never enters this thread — and hand every dispatched agent the same path. One plain command (the compound-shell recipe this replaces is refused by the harness worktree guard, and its fixed `/tmp` path collided across concurrent review sessions):
>
> ```bash
> node "${CLAUDE_PLUGIN_ROOT}/bin/build-review-context.js" build --base {base} --branch {branch}
> ```
>
> Append `--run "$PIPELINE_RUN_DIR"` when a pipeline run directory exists (the scratch dir then lives under `{run}/review-ctx`, per-run unique — no `tmp/` path segment, since a common `Read(**/tmp/**)` permissions.deny glob matches any `tmp/` segment and blocked lens agents from reading this bundle, refs #1213); without it the CLI mints a fresh unique directory under the system temp dir — never a fixed shared path. The CLI prints one JSON line — `{dir, contextPath, bytes, files, emptySections}` — and only that line enters this thread. Carry the printed `dir` — written `{ctx-dir}` below and through Steps 3-3.6 — as a bare path: every scratch file this skill writes (`lens-*.json`, `findings-by-lens.json`) lives there, so concurrent reviews can never clobber each other's files. When Step 2.5's record-label read already minted a scratch dir (`review-effort-derivation.md`, `mint --print-dir`, which prints that same bare path — `{ctx-dir}` is that path, not the default JSON line `mint` prints without the flag), pass `--dir {ctx-dir}` to reuse it instead of minting a second dir. When Step 2's Merge-Provenance Check produced an own-work file set, write that list to a file (one path per line) and add `--files-from {path}`.
>
> A section can legitimately come out empty (`emptySections` names them) — a deleted file, or an unreadable path. That degrades safely rather than silently: the full diff sits at the top of the same bundle, so the agent still sees that file's change either way.
>
> **Pre-dispatch listing (scratch-sweep baseline).** Immediately after minting `{ctx-dir}` above and before dispatching any lens agent (reproduction pair or low-tier single read), capture `git status --porcelain --untracked-files=all > {ctx-dir}/pre-dispatch-status.txt`. This is the baseline the post-fan-out sweep (below) diffs against — capture it exactly once per review, here, regardless of tier.
>
> **`Path:Line` must be file-native, never bundle-relative.** The bundle concatenates every changed file's diff content under one running line count, which does not match any target file's own line numbering. Tell each dispatched agent explicitly: when reporting a `Path:Line` finding, re-read that location in the live target file (`Read`/`grep -n`, not the bundle's own line count) and report the line number from there. Two reproduction-pair agents that independently found the identical real issue but each reported a different numbering scheme (bundle vs. file) will not satisfy the `line ±2` reproduction-match rule even though the finding is the same — observed on record #1488's review, where one agent reported line 37 and the other line 2739 for the same ~90-line file. This instruction goes in the dispatch prompt alongside the scope, not inside the byte-identical Calibration/Output-template block below.
>
> **Scratch path (per dispatch).** Alongside the scope and `Path:Line` instructions above, give each dispatched lens agent a `SCRATCH: {ctx-dir}/agent-scratch/{agent-id}` line — `{agent-id}` a short per-dispatch identifier (e.g. `3b-a`, `3b-b` for lens 3b's reproduction pair) so sibling agents in the same fan-out never collide — and cite `_shared/subagent-output-contract.md`'s Scratch rule: any probe script or fixture the agent creates to verify its own work goes there, never in the repository tree, and is deleted before the status word.
>
> Do **not** `Read` the changed files into this thread to "front-load" them. `Read` places their full content in main-thread context, and each dispatched agent still reads its own copy regardless — so the front-load saves no I/O and costs the entire diff plus every touched file, the exact cost Step 2 exists to avoid. An agent needing more than the bundle (imports, schemas, callers) reads those itself, in its own context window.

> **Parallel execution (conditional):** At `medium` and above, when the diff spans 10+ files, dispatch each applicable lens (3a-3f) as a **reproduction pair** — 2 identical agents per lens (up to 12 Task agents total: 6 reproduction lenses × 2). When the diff is smaller, run each lens as a 2-agent reproduction pair sequentially in the main thread. At `low`, dispatch single agents per the Low-tier single-read rule above instead. Lenses 3g-cov, 3h, and 3i are not dispatched as reproduction pairs — they run as single agents (3h) or main-thread procedures (3g-cov, 3i). Dispatch shape: single-assistant-message rule (the composed review-dispatch bundle's, or standalone `_shared/subagent-dispatch-core.md`'s, fan-out section) applies.
>
> **Reproduction dispatch (Mode 1 — per lens):** For each lens, dispatch 2 agents in one batch with **byte-identical prompts** (same scope, same Template-A contract, same model profile). Independent runs — no agent sees the other's output. After both return, write each agent's `findings` array to `{ctx-dir}/lens-{LENS}-agentA.json` / `{ctx-dir}/lens-{LENS}-agentB.json` and call:
> ```bash
> node "${CLAUDE_PLUGIN_ROOT}/bin/review-coordination.js" categorise-reproduction {ctx-dir}/lens-{LENS}-agentA.json {ctx-dir}/lens-{LENS}-agentB.json
> ```
> A dispatched lens agent that fails mid-flight is a different case from one that completes — see the composed review-dispatch bundle's (or, standalone, `_shared/subagent-dispatch-core.md`'s) "Failed-agent retrieval" section for how to read its result cheaply, without blocking on the full envelope.
>
> **Reproduction-pair partner dies to a session/usage limit.** When one agent in a reproduction pair terminates early on an account session/usage limit (the `Agent terminated early due to an API error: You've hit your session limit` signature), retry that one agent once. If the retry also terminates the same way, treat the surviving partner as a Low-tier single read for that lens only — its findings enter `unconfirmed` unless elevated via the Direct-verification override below, never auto-promoted to `confirmed` on the strength of one agent alone. Log `STAGED {HH:MM:SS} — Reproduction: lens "{lens}" partner agent terminated on a session limit twice; single-read coverage. Reversibility: high.` to `decisions.md`, and carry a one-line coverage-caveat into the Step 7 summary and the PR verdict comment naming the affected lens.
>
> - Findings present in both agents' outputs, same severity bucket (path exact, line ±2, matching severity bucket) → emit as `confirmed`. Write to `decisions.md`: `AUTO {HH:MM:SS} — Reproduction: lens "{lens}" finding {path}:{line} reproduced. Confirmed. Reversibility: high.`
> - Findings present in both agents' outputs but straddling a severity-bucket boundary (path exact, line ±2, e.g. high vs medium — location+substance agreement, disagreement only on how severe it is) → still emit as `confirmed`, not `unconfirmed`: location+substance agreement is what "reproduced" means, severity is reconciled separately. `categoriseReproduction` (`bin/lib/coordination.js`) takes the lower of the two severities as the confirmed value and sets `severityContested: true` on the finding — surface that flag in the routing entry rather than silently dropping it. Write: `AUTO {HH:MM:SS} — Reproduction: lens "{lens}" finding {path}:{line} reproduced, severity contested (took the lower of the two). Confirmed. Reversibility: high.`
> - Findings present in only one agent's output → emit as `unconfirmed`. Write: `STAGED {HH:MM:SS} — Reproduction: lens "{lens}" finding {path}:{line} not reproduced. Staged to Review Console as low-confidence. Reversibility: high.` Unconfirmed findings do **not** enter Step 3 Routing — they route directly to the Wrap-Up Console's Low-confidence subsection.
> - Findings at the same location (path exact, line ±2) but from different substance (`categoriseReproduction`'s `sameSubstance` check on the `text`/`Finding` column comes back `false`, not merely straddling severity) → both stay `unconfirmed`, never merged into one `confirmed` entry — this is the coincidence #1980 fixes, where an unrelated pair within 2 lines of each other used to silently collapse into one finding with the other discarded. Each entry carries a `nearLocation: { source, path, line }` field naming the other side. Write: `STAGED {HH:MM:SS} — Reproduction: lens "{lens}" findings {path}:{lineA} / {path}:{lineB} share a location but not substance; both staged. Reversibility: high.` A routing-table row for an `unconfirmed` entry carrying `nearLocation` gains one extra clause: "same location as {source} finding at {path}:{line}, different substance" — so the reviewer sees both sides of the coincidence rather than just one.
>
> **Direct-verification override.** An `unconfirmed` finding can still be elevated to `confirmed` — an *additional* path alongside reproduction-pair agreement above, never a replacement for it — when the reviewing agent itself reads the actual conflicting source text the finding is about (the real file content, not the reproduction agent's report of it) and independently confirms the finding. This applies only in interactive/hybrid mode, or when an auto-mode agent's own pass happens to read that source directly as part of its work — never as blanket license for an unattended auto run to wave through every `unconfirmed` finding. Merely agreeing with the single agent's report, without independently reading the source, does not qualify — the override exists because independent source-reading rules out two agents sharing the same misread, which agreement-with-a-report cannot rule out. On a docs-only or prose-precision diff (skill files, `_shared/*.md` contracts, CLAUDE.md), two agents independently misreading the same ambiguous prose the same way is common enough that strict reproduction-pair agreement is not a reliable filter — expect Direct-verification override to be the resolution path that actually confirms a real finding on this diff class, not merely an exceptional escape hatch. When it applies: re-emit the finding as `confirmed`, write `AUTO {HH:MM:SS} — Reproduction: lens "{lens}" finding {path}:{line} elevated via direct-verification override (source read independently). Confirmed. Reversibility: high.`, and let it enter Step 3 Routing as an ordinary `confirmed` row.
>
> **Model profile (per lens):** 3a (Convention) and 3f (Test Quality) → [Use: Fast] — mechanical convention checks on isolated files. 3b-3e (Security, Errors, Performance, Architecture) → [Use: Standard] — multi-file analysis and cross-cutting findings. 3h (UX Analysis) → [Use: Capable] — judgment-heavy synthesis. Resolve each via `node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-profile.js" {profile}` (contract § Model Selection).
>
> **Output template (each agent must follow exactly):** The Calibration block + OUTPUT FORMAT must be reproduced byte-identical in each dispatched agent's prompt — do NOT paraphrase. The canonical dispatch template is the "Per-lens Calibration + Output template" section below; inline it verbatim into every `Task()` call.

## Per-lens Calibration + Output template (dispatch contract)

The CALIBRATION filter and severity scale below are the canonical copy from `_shared/criteria-review-quality.md`, reproduced here because dispatched agents cannot read sibling files. Keep them byte-identical to the fragment.

The Calibration and Output template MUST be reproduced byte-identical in every dispatched per-lens reviewer agent's prompt. Do NOT adapt, summarize, or paraphrase — the cross-lens reproduction logic in Step 3.5 depends on every agent applying the same filter.

```markdown
CALIBRATION (required):
Only flag issues where:
- the user will hit a bug, broken state, or unsafe behavior
- the code will fail under realistic load, edge cases, or future maintenance
- a project convention is violated in a way that compounds (not isolated stylistic choices)

Do NOT flag:
- alternate naming you'd prefer ("`fetchUser` would read better as `getUser`")
- formatting, whitespace, or import ordering quibbles
- "could be DRYer" without a concrete second caller that proves the duplication is real
- hypothetical edge cases the spec didn't require ("what if the input is a 4GB string?")
- missing comments on self-explanatory code

When in doubt: would a calibrated senior engineer block a PR on this finding alone? If no, drop it.

OUTPUT FORMAT (required):
Return ONLY a markdown table, no preamble:

| Severity | Path:Line | Finding | Evidence |
|---|---|---|---|
| critical | src/auth.ts:42 | Missing token expiry check | uses `<` not `<=` |
| medium | src/api.ts:180 | Unhandled rejection | line 184: `await fetch(...)` no try/catch |

Severity scale: critical / high / medium / low / info
If no findings: return literal text "No findings."
Return at most 15 rows, highest severity first; if more were found, append a final row reading "+N more" with the count in place of N — never omit this row when findings exceed the cap.
Do not add narration, headers, or summaries before or after the table.

After the table, on its own trailing line — the last non-empty line of your reply — write exactly one of: DONE / DONE_WITH_CONCERNS / NEEDS_CONTEXT / BLOCKED, as `STATUS: {WORD}`.
WRONG: putting the status word first, before the table.
WRONG: adding narration or a summary after the status line — it must be the reply's final line.
Self-check before sending: is the very last non-empty line of your reply literally `STATUS: {WORD}`? If you were about to add a closing remark after it, delete it.
```

Each agent's reply ends with a trailing `STATUS: {WORD}` line — one of `DONE / DONE_WITH_CONCERNS / NEEDS_CONTEXT / BLOCKED` — as its last non-empty line, after the table. The dispatcher merges findings into the Step 3 Routing table (`step3-routing.md`) — Severity maps directly, Path:Line maps to the Affected column, Finding maps to the Finding column, and the dispatcher fills the Category column from the lens that produced it. Re-prompt once on format violation — check the status word's **position**, not merely its presence: a reply whose last non-empty line is not exactly `STATUS: {WORD}` (e.g. narration or a re-stated finding follows the status word) is a violation even though the literal token appears somewhere in the reply. Verify the reply's last non-empty line is exactly the canonical `STATUS: {WORD}` form before accepting it as compliant (#606's wrap-up: a lens agent's narration-then-DONE reply was initially accepted on token presence alone, caught only by the Friction lens's `contract-violation` event).

**Pass diff scope, not diff text.** When composing each prompt, give the agent the shared context bundle's path (built above) plus the base/branch refs (or the own-work file set when Step 2's Merge-Provenance Check found merge commits). Do not paste diff content into the prompt: Step 2 deliberately keeps only `--stat`/`--name-only` in the main thread, and inlining the diff into N lens prompts would pull the full diff back into main-thread context to compose them.

## Post-fan-out untracked-file sweep

Run once per review, comparing against the pre-dispatch listing captured above (`{ctx-dir}/pre-dispatch-status.txt`) — never once per lens or per agent. At **`low`/`medium`** tier, this file's own Step 3 reproduction/single-read dispatch is the only fan-out this review runs (`step3-debate-and-refutation.md` never loads at these tiers) — run the sweep now, before returning to Step 3 Routing. At **`high` and above**, skip running it here **only if `step3-debate-and-refutation.md` was actually loaded and read this run** — its own closing section runs the sweep once, after Step 3.5/3.6, using this same pre-dispatch listing. If, for any reason, that file was not loaded this run despite the tier resolving `high`+, run the sweep here instead rather than skipping it silently.

Procedure: `git status --porcelain --untracked-files=all`, diffed against the captured pre-dispatch listing. Any new untracked path outside `{ctx-dir}` is:
- reported by name in the review summary's `Fan-out leftovers` section (`review-summary-template.md`), rendered in the compact form too,
- logged to `decisions.md`: `STAGED {HH:MM:SS} — Review fan-out left {n} untracked file(s): {paths}. Not deleted. Reversibility: n/a.`,
- excluded from evidence a reviewer trusts — a finding whose only supporting evidence is one of these paths is downgraded to `unconfirmed`, with that reason noted in its entry.

Never delete anything here — report only. A path under `{ctx-dir}` is a sibling agent's or the skill's own scratch output, not a leftover, and is excluded from the diff. A reviewer cannot distinguish its own dispatched agents' leftovers from a concurrent implementer's in-flight untracked work in the same worktree, so the controller — not this sweep — decides what happens to a reported file.

**Agent-scratch cleanup check.** The `{ctx-dir}` exclusion above covers the skill's own scratch files (`lens-*.json`, `findings-by-lens.json`, the pre/post-fan-out status snapshots) — it does not exempt `{ctx-dir}/agent-scratch/**` from scrutiny, because the Scratch rule's "delete what it created before its status word" is a self-reported promise (`_shared/subagent-output-contract.md`) with no verification elsewhere. As part of this same sweep, run `find {ctx-dir}/agent-scratch -type f 2>/dev/null`: any file still present means a dispatched agent did not honor that promise. Report it exactly like an untracked leftover above — named in the `Fan-out leftovers` section, logged to `decisions.md`, and excluded as sole evidence for a `confirmed` finding — the only difference is the path lives under `agent-scratch/` instead of outside `{ctx-dir}`.

## Lens definitions (3a-3f)

### 3a: Convention Compliance

- Does the code follow naming conventions documented in CLAUDE.md?
- Are project patterns followed (error handling, validation, logging)?
- Are shared utilities used instead of reinventing (check existing packages)?
- Are imports from the right packages (not duplicating types inline)?
- Does the code follow patterns documented in `.claude/skills/*.md`? Append a `review/skill` ledger entry when the code **diverges** from a skill (flag it in the findings table too — the code may be correct and the skill stale), **extends** a documented pattern with a new wrinkle worth capturing (enrichment), or establishes a reusable pattern in a domain **no skill covers** (tag the entry `[skill: NEW - {name}]` — hyphen, not em-dash, for tooling friendliness). Keep it to a one-line entry — `/claude-tweaks:wrap-up`'s Skills curation row does the deep analysis.

### 3b: Security

- Input validation at system boundaries?
- No raw SQL or command injection risks?
- Authentication/authorization checks present where needed?
- No secrets or sensitive data in code?
- OWASP top 10 considerations?
- Does every path-based allow/exemption decision resolve the real path (leaf symlink followed, `..` normalized) before deciding, and fail closed when the path is unprovable? (#1678: a file-tool gate exemption decided on the raw literal path let a symlink located outside any repo but pointing inside a protected worktree bypass the check entirely — see `docs/donts.md`'s matching rule, `[IL-150]`.)

### 3c: Error Handling

- Appropriate error types used (project's error class, not raw Error)?
- Edge cases handled (null, empty, malformed input)?
- Errors logged with sufficient context for debugging?
- User-facing errors safe (no internal details leaked)?
- No `fs.existsSync(...)`-then-`fs.readFileSync(...)` TOCTOU races — read directly and catch, treating a read failure the same as "absent," rather than checking existence first? (#901's hindsight: this exact pattern has recurred independently 4 times within fresh code, most recently #1269 (`[IL-146]`), in a project where concurrent sibling sessions routinely archive/prune the exact directories these readers walk. See `docs/donts.md`'s matching rule for the write-time version of this callout.)

### 3d: Performance

- No N+1 query patterns?
- Appropriate use of caching where applicable?
- No unnecessary re-renders (React)?
- Database queries have proper indexes?
- Pagination used for unbounded lists?

### 3e: Architecture

- Right level of abstraction (not over/under-engineered)?
- Proper separation of concerns?
- Dependencies flow in the right direction?
- No circular dependencies introduced?
- Changes consistent with existing architecture?
- **Shallow modules?** Does any new module have an interface nearly as complex as its implementation (a pass-through wrapper, a module whose interface mirrors its single dependency)? Flag at most the 1-2 most leverage-worthy at medium severity — and when shallow abstractions or wrong boundaries are the theme, recommend `/claude-tweaks:deepen` for a dedicated depth pass rather than trying to resolve module-level restructuring inline here. (module-level depth criteria: `_shared/criteria-architecture-depth.md`)

### 3f: Test Quality

- Tests verify behavior through the public interface, not implementation details? (No asserting on private methods, spying on internal collaborators, or checking intermediate data shapes that exist only because of the current implementation.)
- **Refactor-coupling diagnostic:** would this test break if you renamed an internal function or restructured the implementation *without changing behavior*? If yes, it's testing implementation, not behavior — flag it. The point of a test is to survive refactors and fail only when behavior breaks.
- **Discrimination diagnostic (new regression tests):** would this test still pass with the fix it was written for reverted? A fixture whose size or count incidentally clears an *unrelated* pre-existing threshold (a hub-path count, a batch-size cutoff) passes either way and proves nothing about the new rule — flag it, and require the fixture to neutralize that unrelated threshold (e.g. an options override) so only the rule under test decides the outcome. A green suite is not evidence here; the revert is. (#1420: 3 of 4 new `groupByFileOverlap` regression tests were green but non-discriminating until each pinned `{ hubPathMinCount: Infinity }`.)
- **Test names read as specifications?** A good name states a capability ("user can checkout with a valid cart"), not an implementation path ("returns 200 when cart items quantity > 0 and user authed"). Flag names that describe internals.
- Edge cases and error paths tested?
- Test data is realistic and follows schemas?
- No test pollution (shared mutable state)?
- Mocks are minimal and at the right level? (Mocking internal collaborators is a smell — prefer real objects or interface-level stand-ins.)
