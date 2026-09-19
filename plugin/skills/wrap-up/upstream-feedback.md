# Upstream Feedback (D5) — judge file

Judge file for the `upstream` registry row (`Upstream feedback`), loaded per that row when its gate opens. The gate, the scope, and the row's `SCANNED` line are **engine-owned** — see `curation-engine.md`; this file is judgment only. The row's disposition is `stage`: **every** finding it emits carries `"action": "staged"`.

Stage-and-surface procedure for every learning `_shared/learning-routing.md` resolves to **D5** —
a defect or gap belonging to an upstream dependency rather than to this project.

## Step 1: Run the self-reference check first

Apply the contract's self-reference check before anything else. When it collapses D5 — the
"upstream" component turns out to be this project — re-classify the learning and hand it back to
the registry row that owns the re-classified destination. Nothing is staged here in that case.

## Step 2: Stage, never file during the run

One proposal per surviving learning:

```
STAGED {time} — Upstream feedback row: upstream {defect|gap} report proposed for {component}. Reversibility: medium (public issue; stage path: staged/wrap-up-upstream-{N}.md).
```

The stage file holds the fully drafted **and already scrubbed** body. Scrubbing happens at staging
time, not at filing time — the approver reads what will actually be published, and a body scrubbed
later is a body nobody approved.

**Causal-verdict tag (#2551).** When the learning being staged carries a `CAUSAL: systemic`
verdict from reflect's Near-misses chain-walk (`full-mode.md`'s Near-misses Chain Walk section),
prepend a `**Causal:** systemic` line to the staged draft body, before the drafted content —
`review-console.md`'s Step 9 reads this line to decide the item's "Approve all" default (below).
Omit the line entirely when the learning carries no causal verdict (most D5 findings won't —
the chain-walk is Near-misses-specific), the same omit-when-absent convention `SKILL.md`'s own
Causal column already uses. Also note it in the `STAGED` line above: append `; causal: systemic`
after the stage-path parenthetical when the tag applies, omitted otherwise.

Filing happens on approval, at `review-console.md`'s **On approval step 9** — that is what invokes
`/claude-tweaks:feedback --pre-confirmed` for each checked `U#` row. The console's own *Upstream
feedback section* does not file directly. Filing follows `_shared/auto-mode-card.md` /
`_shared/auto-mode-contract.md`'s tiered stance: at `supervised`/`trusted`, this row (`U#`) is
covered by the Review Console's batch "Approve all" — it defaults to filed when the staged draft
carries the `**Causal:** systemic` tag above, else it defaults to declined, with zero further
`AskUserQuestion` calls either way. At `unattended`, it auto-resolves to filed unconditionally
(causal tag or not) under `consoleAutoResolve`. Per-item chunking (inspect each scrubbed draft via
`_shared/upstream-feedback-batch.md`'s unchecked-by-default `multiSelect` drill before checking it
to file) survives only inside the Override drill — never as part of "Approve all". Phase 4's
execution step files nothing either — it only confirms the filing landed; see
`execution-and-verification.md`. The scrub gate (Step 2 above) still runs in every mode regardless
of tier — only the filing approval itself follows the tiered stance.
