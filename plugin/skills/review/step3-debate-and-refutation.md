# Review — Step 3.5/3.6: Cross-Lens Debate, Per-Candidate Refutation, and Gap-Sweep

Loaded by `/claude-tweaks:review` after Step 3's per-lens reproduction completes. Contains the full procedure for the three effort-gated findings-quality mechanisms: Cross-Lens Debate and the Per-Candidate Refutation Pass (Step 3.5), and Gap-Sweep / Completeness Critic (Step 3.6). Lazy-loaded only when the resolved `review-effort` tier (Step 2.5) is `high` or above — at `low`/`medium`, code-mode-steps.md's own gate skips straight to Step 3 Routing without reading this file at all.

## Step 3.5: Cross-Lens Debate & Per-Candidate Refutation

Two independent findings-quality mechanisms live in this step, each gated at its own `review-effort` tier (Step 2.5). Cross-Lens Debate resolves contradictions between different lenses reviewing the same region. The Per-Candidate Refutation Pass re-examines individually `confirmed` findings for correlated error that reproduction-pair agreement alone can't catch — two reproduction agents sharing the same blind spot, or the same miscalibration, still agree with each other. They operate on different inputs — debate on cross-lens contradiction pairs, refutation on the `confirmed` bucket once debate has resolved, narrowed by that pass's own severity floor and fan-out cap — and both can fire in the same `xhigh`/`max` review without interfering with each other.

### Cross-Lens Debate

**Skip this entire step when the resolved `review-effort` tier (Step 2.5) is `low` or `medium`** — contested findings remain `unconfirmed`/staged without a debate round, trading resolution depth for speed at the lower tiers, matching Step 3's own narrower lens scope there. At `high` and above, run as follows:

After per-lens reproduction completes, scan for contradictions across lenses before routing. Two lenses that both flagged the same region with mismatched severity get exactly one debate round to converge or escalate to `contested`. A silent lens — one that reviewed the region but produced no finding there at all — cannot enter this mechanism: `detectCrossLensOverlap` below only pairs findings that exist in *both* lenses' arrays, so the asymmetric "one flagged, the other did not" case has no data to pair against and is never dispatched (see step 5's skip condition).

1. **Detect overlap.** Collect each lens's `confirmed` and `unconfirmed` findings into one `{lensName: [findings...]}` object, write it to `{ctx-dir}/findings-by-lens.json` (the scratch dir minted by Step 3's `build-review-context.js` call — never a fixed shared `/tmp` name, which collides across concurrent review sessions), and call:
   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/bin/review-coordination.js" detect-overlap {ctx-dir}/findings-by-lens.json
   ```
   It returns pairs `{lensA, lensB, findingA, findingB}` for findings on the same `path` within ±5 lines from *different* lenses.

2. **Filter to contradictions.** Each overlap pair already has a finding from both lenses (by construction of step 1) — keep only those where the two findings' severities don't match. Pairs where the severities match (both lenses agree) produce no debate.

3. **Dispatch debate (Mode 2 — 2 agents, 1 round, parallel).** For each contradiction, dispatch 2 agents using the original lens-agents' identity (re-dispatch the affected lens's reviewer with the *stripped opposing finding* as input — no model identity, no reasoning chain, just finding text + evidence). Both judges return `agree | disagree | partial` plus one paragraph of reasoning. Resolve the model per the composed review-dispatch bundle's (or, standalone, `_shared/subagent-dispatch-core.md`'s) Model Selection dispatch procedure (`node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-profile.js" frontier --run-dir "$PIPELINE_RUN_DIR"`, once per judge) — this pair is the contract's contract-enumerated verdict-gate exception to the general singleton-only rule: it is a fixed, contradiction-bounded 2-agent shape, not an N-way fan-out over a variable candidate set (see that Model Selection section). Degrades per the resolver's own preconditions (that same Model Selection section) — never enumerated locally here. Inline this template literally in each `Task()` prompt:
>
>    ```
>    Two lenses disagreed on this region. Review the conflicting findings below and return:
>    First line: one of DONE / DONE_WITH_CONCERNS / NEEDS_CONTEXT / BLOCKED. Then:
>    1. Verdict: agree / disagree / partial
>    2. One paragraph of reasoning.
>
>    Contested region: {path}:{line}
>    Finding A (lens: {lensA}): {finding text}
>    Finding B (lens: {lensB}): {finding text}
>
>    [Use: Frontier — debate agent. Independent run; do not see the other judge's reasoning.
>    Degrades per the resolver's preconditions (contract § Model Selection).]
>    Read-only.
>    ```

4. **Resolve.** Apply `resolveDebate`:
   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/bin/review-coordination.js" resolve-debate {verdictA} {verdictB}
   ```
   - Both `agree` → finding upgraded to `confirmed`. Write `AUTO {HH:MM:SS} — Debate: cross-lens disagreement on {path}:{line} converged positive after 1 round. Reversibility: high.`
   - Both `disagree` → finding downgraded to `unconfirmed` (lands in Low-confidence subsection). Write `AUTO {HH:MM:SS} — Debate: cross-lens disagreement on {path}:{line} converged negative after 1 round. Reversibility: high.`
   - Mixed / partial → finding becomes `contested`. Write `STAGED {HH:MM:SS} — Debate: cross-lens disagreement on {path}:{line} inconclusive ({verdicts}). Both verdicts staged. Reversibility: high.` Stage the side-by-side verdicts to `staged/review-contested-{N}.md`.

5. **Skip debate** when no overlap is detected, or when only one lens covered a region. Avoid running debate on every `Path:Line` where any two lenses touched — that explodes the token budget for no value.

### Per-Candidate Refutation Pass

**Skip this entire step when the resolved `review-effort` tier (Step 2.5) is not `xhigh` or `max`** — one tier stricter than Cross-Lens Debate's `high`+ gate above, so `high`-tier reviews aren't paying for both mechanisms at once. At `xhigh` and `max`, run as follows:

This is explicitly NOT a second reproduction pair — reproduction pairs (Step 3) check agreement between two initial readers; refutation is a distinct, later agent whose only job is to try to break a finding that already survived that agreement. Correlated error (both reproduction agents sharing the same blind spot, or the same miscalibration) is exactly what agreement alone can't catch. This was caught concretely during the #45 native-review prototype: a dedicated verifier subagent, dispatched per surviving candidate finding with the explicit job of trying to falsify it using fresh evidence-gathering, caught false positives that reproduction-pair agreement alone had let through.

> **Parallel execution:** Dispatch one refutation agent per **in-scope** `confirmed` candidate (after the floor and cap in steps 2-3 below) as parallel Task agents — each runs independently, sees only its own candidate finding (not the other candidates or the lens's original reasoning chain), and returns a `refuted`/`not-refuted` verdict. Assemble results after all agents complete.

This pass is the only place in the skill where an unbounded fan-out would meet the Capable profile, so it carries an explicit severity floor and fan-out cap — fixed values stated here, not left to model judgment. This is the same cost discipline Cross-Lens Debate's step 5 applies ("Avoid running debate on every `Path:Line`…"), made concrete.

1. **Collect candidates.** Once Cross-Lens Debate above has resolved, take the full `confirmed` bucket — every finding that would otherwise proceed to Step 3 Routing, whether it got there via plain reproduction or via debate converging positive. Then apply the floor and the cap below, in that order.

2. **Apply the severity floor — `medium`.** Drop `low` and `info` candidates from the refutation set. Falsifying a `low` costs more than simply applying it, and a wrongly-`confirmed` `low` does little damage if it survives.

   Floor-skipped candidates are **not** downgraded — they proceed to Step 3 Routing as `confirmed`, exactly as if this pass had never run. Downgrading them to `unconfirmed` would pull them *out* of routing on the strength of an examination that never happened, which is less scrutiny of the code, not more. Write one aggregate entry: `AUTO {HH:MM:SS} — Refutation: {N} low/info candidates below the medium severity floor, not refuted; proceeding as confirmed. Reversibility: high.`

   This floor is fixed at `medium` and is deliberately independent of `review-auto-apply-ceiling` (`step3-routing.md`), which governs which findings *surface at all* — not which ones get falsified.

3. **Apply the fan-out cap — 10 candidates.** Order the remaining candidates by severity descending (`critical` → `high` → `medium`), breaking ties by `path:line` ascending so the selection is deterministic and reproducible across runs. Refute only the first 10.

   If more than 10 remain, the overflow note below is **mandatory, not optional** — this repo's rule is that no surfaced finding is ever silently dropped. Append it verbatim to `decisions.md` and render it immediately above the Step 3 Routing findings table:

   > `+{N} more confirmed findings were not refuted (refutation fan-out capped at 10, highest severity first) — they proceed to Step 3 Routing unexamined by this pass.`

   Overflow candidates, like floor-skipped ones, stay `confirmed` and route normally. Also write: `AUTO {HH:MM:SS} — Refutation: fan-out capped at 10; +{N} confirmed findings not refuted, proceeding as confirmed. Reversibility: high.`

   Worst case after the floor and cap: **10 Capable-tier agents per review, regardless of finding count** (refutation stays `[Use: Capable]` unconditionally — it is a variable-N fan-out over confirmed candidates, which Frontier structurally forbids), **plus at most `frontier-run-cap` (default 3 — `.claude-tweaks/policy.yml`, the composed review-dispatch bundle's / `_shared/subagent-dispatch-core.md`'s Model Selection section) Frontier singleton dispatches per run** from the gap-sweep and cross-lens debate slots above. A 25-confirmed-finding review previously fanned out to 25 unbounded Capable-tier agents; it now dispatches at most 10 Capable refutation agents — a ~60% cut to this pass's worst case, and the first bound of any kind on it — plus whatever the run's Frontier cap allows for the two verdict-gate slots, tracked independently in `frontier-tally.log`.

   Typical runs cost well under that worst case, because the `medium` floor is applied *before* the cap is consulted: the cap only binds on a review that surfaces 10 or more `medium`-or-higher `confirmed` findings, which is the tail rather than the norm. The floor is doing most of the work here and the cap is the backstop — so tightening the cap further buys little, while lowering the floor would quietly undo both.

4. **Dispatch one refutation agent per in-scope candidate, given fresh file access.** Each agent gets the finding's path/line/severity/evidence and fresh read access to the actual current file content (not the finding's cached evidence text) — instructed to actively try to falsify it: re-trace whether the claimed failure is actually reachable, verify the cited evidence still matches the current code, and challenge the reasoning rather than restate it. Inline this template literally in each `Task()` prompt:
>
>    ```
>    You are trying to FALSIFY this finding, not confirm it. Re-read the actual current file
>    content at {path}:{line} (do not trust the cached evidence text below) and determine
>    whether the claimed issue is real and reachable.
>
>    First line: one of DONE / DONE_WITH_CONCERNS / NEEDS_CONTEXT / BLOCKED. Then:
>    1. Verdict: refuted / not-refuted
>    2. One paragraph of reasoning, citing what you actually found in the current file.
>
>    Candidate finding: {path}:{line}
>    Severity: {severity}  Category: {category}
>    Finding: {finding text}
>    Cached evidence: {evidence text}
>
>    SCRATCH: {ctx-dir}/agent-scratch/{agent-id} — any probe script or fixture you create to verify this finding goes there (never in the repository tree) and must be deleted before your status word (`_shared/subagent-output-contract.md`'s Scratch rule).
>
>    [Use: Capable — refutation agent. Independent run; fresh file read, not the
>    lens's original context. Resolve via `node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-profile.js" capable` (contract § Model Selection).]
>    ```

5. **Resolve.** First check the dispatched agent's own status line, per the Subagent Contract (`_shared/subagent-output-contract.md`): a `BLOCKED`/`NEEDS_CONTEXT` status, or a response with no parseable `Verdict:` line, means the refutation attempt itself failed — do not fabricate a verdict for `resolveRefutation`. Treat this case directly: downgrade to `unconfirmed` and write `AUTO {HH:MM:SS} — Refutation: {path}:{line} — dispatch failed ({status}/unparseable verdict), not genuinely re-examined. Downgraded to unconfirmed out of caution. Reversibility: high.` A failed dispatch must never be logged as if a real falsification attempt happened.

   Otherwise, apply `resolveRefutation` to the parsed `Verdict:` value:
   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/bin/review-coordination.js" resolve-refutation {verdict}
   ```
   `resolveRefutation` itself also fails toward scrutiny on any unrecognized value — only the exact literal `not-refuted` keeps a finding `confirmed`; `refuted` and anything else downgrade to `unconfirmed`. This is defense in depth against a malformed verdict slipping past the explicit status check above, not a substitute for it.
   - `refuted` → finding downgraded to `unconfirmed` (lands in Low-confidence subsection). Write `AUTO {HH:MM:SS} — Refutation: {path}:{line} refuted — {one-line reasoning}. Downgraded to unconfirmed. Reversibility: high.`
   - `not-refuted` → finding proceeds unchanged toward Step 3 Routing. Write `AUTO {HH:MM:SS} — Refutation: {path}:{line} not refuted — stands as confirmed. Reversibility: high.`

After Step 3.5, every finding has a final bucket — `confirmed`, `unconfirmed`, or `contested`. A `confirmed` finding downgraded by the Per-Candidate Refutation Pass above joins `unconfirmed` with the same visibility rules as any other unconfirmed finding. Only `confirmed` findings flow into Step 3 Routing. `unconfirmed` and `contested` are already staged to the Wrap-Up Console.

## Step 3.6: Gap-Sweep / Completeness Critic

**Skip this entire step when the resolved `review-effort` tier (Step 2.5) is not `xhigh` or `max`** — the same gate as the Per-Candidate Refutation Pass above, one tier stricter than Cross-Lens Debate's `high`+ gate, since this stacks additional cost on top of an already-thorough pass. At `low`/`medium`/`high`, this step is a no-op: no dispatch, nothing added to the summary. At `xhigh` and `max`, run as follows:

Each of lenses 3a-3i is angle-scoped by construction — 3b only looks for security issues, 3e only architecture, and so on — so a real defect that doesn't cleanly fit any single lens's angle can pass through every lens unflagged. This step asks the question none of them do: what did every lens, collectively, miss? This was caught concretely during the #45 native-review prototype: its own final "what did we miss" fresh-eyes pass caught 2 of 4 real findings that none of the angle-based finders surfaced.

Dispatch **exactly one** `[Use: Frontier]` agent — **not a reproduction pair**. A fresh-eyes pass loses its value if paired/averaged against a second identical fresh-eyes agent, so resist the urge to "fix" this into a pair even though the pattern immediately above (Cross-Lens Debate, Per-Candidate Refutation Pass) dispatches multiple agents per unit of work — this step is deliberately single-source, which is exactly the singleton shape Frontier requires. Resolve the model per the composed review-dispatch bundle's (or, standalone, `_shared/subagent-dispatch-core.md`'s) Model Selection dispatch procedure (`node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-profile.js" frontier --run-dir "$PIPELINE_RUN_DIR"`); it degrades per the resolver's own preconditions (that same Model Selection section) — never enumerated locally here. Give the agent: the diff scope from Step 2 (the branch's-own-work scope when the Merge-Provenance Check found merge commits) and a compact list of what lenses 3a-3i already flagged — `path:line` + one-line summary for every `confirmed` and `unconfirmed` finding so far, after Step 3.5's debate and refutation have both resolved. Inline this template literally in the `Task()` prompt, per the Subagent Contract (the composed review-dispatch bundle, or standalone `_shared/subagent-dispatch-core.md`) — Template A output:

```
You are a fresh-eyes reviewer. The following lenses have already reviewed this diff and
produced these findings: {already-flagged findings list, path:line + one-line summary}.
Do NOT restate any of these. Find genuine gaps — real defects the above list does not
already cover. If you find nothing beyond what's already flagged, return "No findings."

[... CALIBRATION + OUTPUT FORMAT block, byte-identical to the per-lens dispatch contract
in step3-lens-dispatch.md ...]

SCRATCH: {ctx-dir}/agent-scratch/gap-sweep — any probe script or fixture you create to verify a finding goes there (never in the repository tree) and must be deleted before your status word (`_shared/subagent-output-contract.md`'s Scratch rule).

[Use: Frontier — gap-sweep agent. Independent run; single dispatch, not a
reproduction pair. Degrades per the resolver's preconditions (contract § Model Selection).]
```

Findings returned are tagged with an internal `source: gap-sweep` marker (parallel to how lenses tag findings with their own lens name for Step 3 Routing's Category column) and inserted directly into the `unconfirmed` bucket — the same confidence tier a single-source, non-reproduction-paired lens finding gets. They are **not** auto-promoted to `confirmed` — there's no second agent to reproduce them against, by design. This reuses `step3-routing.md`'s existing `xhigh`/`max` inline-visibility rules (unconfirmed findings surface inline at `xhigh`+) — no new routing table needed. Write `STAGED {HH:MM:SS} — Gap-sweep: {path}:{line} — {one-line finding}. Staged to Review Console as low-confidence (gap-sweep, single-source by design). Reversibility: high.`

Check the agent's status line first, per the Subagent Contract: a `BLOCKED`/`NEEDS_CONTEXT` status, or a response that parses as neither a findings table nor the literal `No findings.`, means the sweep did not actually complete — write `STAGED {HH:MM:SS} — Gap-sweep: dispatch failed ({status}), sweep not genuinely performed. Reversibility: high.` so a persistently broken dispatch stays visible rather than silently reading as "we checked and found nothing." Only a genuine `DONE`/`DONE_WITH_CONCERNS` response with literal `No findings.` text logs nothing further, per the existing per-lens convention — no decision-log entry is needed for an actually-completed zero-findings pass.

## Post-fan-out sweep (this file's own closing step)

`step3-lens-dispatch.md` defines the post-fan-out untracked-file sweep procedure and captures the pre-dispatch baseline (`{ctx-dir}/pre-dispatch-status.txt`) before Step 3's first dispatch; that file's own sweep only runs itself at `low`/`medium` tier, since this file never loads there. At every tier that loads this file (`high` and above), run that sweep exactly once — here, after Cross-Lens Debate at `high` (this file's Step 3.5/3.6 refutation and gap-sweep never run at that tier), or after Gap-Sweep (Step 3.6) at `xhigh`/`max` — before proceeding to Step 3 Routing.
