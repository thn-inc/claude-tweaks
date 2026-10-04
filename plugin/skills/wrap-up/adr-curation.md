# Decision Records (ADRs) — judge file

Judge file for the `decision-records` registry row (`Decision records`). The gate, the scope, and the row's `SCANNED` line are **engine-owned** — see `curation-engine.md`; this file is judgment only. The row's disposition is `stage`: every finding it emits carries `"action": "staged"`. ADR proposals are routed through the Review Console alongside other configuration updates — never written silently.

Capture the *why* behind significant decisions made during this work — distinct from `decisions.md` (the per-run auto-decision audit log) and the spec (which records *what*). Apply the **ADR gate** from `_shared/decision-records.md` (read it for the gate, the location convention, and the template).

## Step 1: Gather decision candidates

Gather from this work's surfaces — the same three that produced the `adrCandidateCount` signal opening this row, re-walked here so the judgment works from the actual candidates rather than from a count:

- Architectural deviations classified in `/build` Common Step 4.5
- Interface trade-offs flagged `[ADR-candidate]` by `/claude-tweaks:deepen`
- Tradeoffs accepted during `/claude-tweaks:review` and reflection insights about approach

## Step 2: Run the ADR gate

**Run the ADR gate** on each candidate — write an ADR only when ALL THREE hold: **hard to reverse** AND **surprising without context** AND **the result of a real trade-off**. If any factor is missing, do not propose an ADR (the decision belongs in the spec, a code comment, or nowhere).

## Step 3: Resolve the path before proposing it

**Resolve the path before proposing it.** Read `doc-convention-adr` via the canonical read path (`node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-policy.js" doc-convention-adr` — `_shared/policy-schema.md`) and branch on the JSON envelope: `source: "policy"` means the key is set, so use the recorded `value` and skip detection entirely; `source: "default"` means it is unset (the key has no schema default), so read `_shared/existing-convention-detection.md` and run its procedure for the `adr` genre against `docs/decisions/` and that genre's declared aliases. The result is a resolved path plus one of three outcomes: `plugin`, `project`, or `conflict`.

## Step 4: Propose

For each decision that passes the gate, propose creating the resolved path, using the ADR skeleton in `_shared/diataxis-genre-templates.md`.

→ Collect each as: `[adr] {resolved-path} — {decision title}`

→ On a `conflict` outcome, additionally collect exactly one row per run: `[adr-convention] docs/decisions/ — {plugin form} vs {found form} ({N} existing)`. This row requires per-item approval and is **not** covered by Approve all's own default (see `review-console.md`) — it belongs to `review-console-interactive.md`'s drills-individually class, so Approve all still fires its own three-way question for it as part of the same console stop rather than leaving it unanswered. Until it is answered, no `[adr]` row from this run may be written — the resolved path depends on the answer.

Each collected item becomes one payload finding with `action: "staged"`: `targetPath` is the resolved ADR path (or `docs/decisions/` for the convention row), `summary` is the decision title (or the `{plugin form} vs {found form}` comparison), and `stagePath` is the `staged/` file holding the full proposal, named `staged/wrap-up-adr-{n}.md`.

## Zero is the normal outcome

Most wrap-ups produce **zero** ADRs; that is correct. ADRs are valuable because they are rare. A run that gathered candidates and passed none through the gate reports `Clean`, and that is a complete, correct result — not a sign the gate was applied too strictly.
