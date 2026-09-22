# Visual Review — Journey Mode

Loaded by `/claude-tweaks:visual-review` when the resolved mode is `journey:{name}`. Walks the full journey via a sequence of `playwright-cli` commands against one session (no `batch` equivalent — see "Assemble the sequence" below), applies the creative framework at each step, then assesses the overall arc.

Requires the shared prerequisites from `browser-review.md` (session naming, screenshot path convention, QA data loading, Step 0 reconnaissance) — load this file only AFTER those have been processed.

## Load the journey

Read `docs/journeys/{name}.md`. Extract:
- **Persona** — primary persona for the entire review (additional personas from Step 3 can supplement)
- **Goal** — what "success" looks like
- **Entry point** — where the review starts
- **Success state** — how you know the journey worked
- **Steps** — each step has a URL, action, "should feel", "should understand", and "red flags"

## Assemble the sequence

<!-- playwright-cli: no equivalent found for agent-browser batch — see issue Gotchas -->
Walk the journey via a sequence of individual `playwright-cli` commands that owns the session lifecycle for that walk — Playwright CLI has no `batch` equivalent (`playwright-cli-reference.md`'s Operation vocabulary table), so what was previously one bundled invocation is now a script of separate commands against the same `-s=<name>` session. Run every step's `open`/`goto`, `snapshot`, screenshot, and (see the Vitals capability-gap note below) `vitals` capture in sequence. End with `close` only if no further interactive ops are needed.

<!-- playwright-cli: no equivalent found for agent-browser vitals — see issue Gotchas -->
**Vitals capability gap:** Playwright CLI has no `vitals` command or equivalent (`browser-review.md`'s Shared review contract, "Vitals interpretation (Step 1)"). The worked example below omits the `vitals` calls the pre-migration form issued after each screenshot — Performance findings cannot be produced for this journey until a replacement capture mechanism is designed.

**Worked example — three-step checkout journey:**

```
playwright-cli -s=checkout-journey-review open https://app.example.com/cart
playwright-cli -s=checkout-journey-review tracing-start
playwright-cli -s=checkout-journey-review snapshot
playwright-cli -s=checkout-journey-review screenshot --filename=/absolute/path/to/repo/.claude-tweaks/artifacts/screenshots/browse/checkout-journey-review/01_cart.png
playwright-cli -s=checkout-journey-review goto https://app.example.com/checkout/shipping
playwright-cli -s=checkout-journey-review snapshot
playwright-cli -s=checkout-journey-review screenshot --filename=/absolute/path/to/repo/.claude-tweaks/artifacts/screenshots/browse/checkout-journey-review/02_shipping.png
playwright-cli -s=checkout-journey-review goto https://app.example.com/checkout/payment
playwright-cli -s=checkout-journey-review snapshot
playwright-cli -s=checkout-journey-review screenshot --filename=/absolute/path/to/repo/.claude-tweaks/artifacts/screenshots/browse/checkout-journey-review/03_payment.png
playwright-cli -s=checkout-journey-review close
```

Each command returns its own output: per-step snapshot trees (with `eN` element refs), and each screenshot's file path confirmed written. There is no concatenated batch output to parse by step boundary anymore — each command is its own step block; each `open`/`goto` marks the start of a new step.

**When per-step interactions are needed** (click, fill, type that depend on refs from a fresh snapshot): run them as additional individual commands against the same session, interleaved with the sequence above wherever the journey step calls for them — there is no `batch` boundary to split around anymore, since every command already runs individually in the same session.

## Per-step review (against the sequence's output)

For each step's block in the sequence's output:

1. **Health check** — console errors, failed network requests, broken rendering visible in the snapshot. If the step is broken, capture a trace (see "Trace on failure" below) and continue to the next step.
2. **Should-feel test** — the journey says this step should feel like "{should_feel}." Does the snapshot + screenshot support that? Be honest and specific about gaps. This is the key per-step test.
3. **Red-flag check** — does the step exhibit any of the journey's documented red flags?
4. **Vitals check** — compare the step's Web Vitals against the thresholds in `browser-review.md`'s Shared review contract, "Vitals interpretation (Step 1)" (LCP/CLS/INP/TTFB/FCP) — that table is canonical; this file doesn't restate the values. Vitals findings flow into the Step 6 table.

Note transition quality between steps (jarring? smooth? lost momentum?) as a one-word annotation for the arc assessment. Reference `eN` refs (paired with a short description, per `browser-review.md`'s Element-reference convention) when describing visual issues — "primary CTA (e3) competes visually with the secondary link (e5)" beats "the button on the right looks heavier than the link."

Do not perform full persona rotation, structured analysis, or reimagining at the per-step level — those are more valuable at the arc level where patterns across steps are visible.

## Assess the overall arc

After walking all steps, step back and evaluate the journey as a whole. This is where deeper analysis happens — patterns across steps produce better signal than per-step checklists.

**Journey coherence:**
- **Momentum** — does the journey build toward the goal, or does it stall somewhere?
- **Coherence** — does it feel like one experience, or stitched-together features?
- **Payoff** — does the success state deliver on the promise of the entry point? Is the "aha moment" actually there?
- **Length** — too many steps? Too few? Are there steps that could be eliminated or combined?
- **Drop-off risk** — where in the journey would a user most likely give up? Why?

**Interaction and visual quality (across the arc):**
- **Consistency** — does the visual language, interaction speed, and feedback quality stay consistent across steps?
- **Worst step** — which step has the biggest gap between "should feel" and "actually feels"? This is the primary candidate for improvement.
- **Best step** — which step nails its "should feel"? What makes it work? Can that quality be replicated elsewhere?

## Journey mode report

The report follows the same structure as the standard Report & Route (`browser-review.md`'s Shared review contract, "Report & Route (Step 6)") but adds journey-specific sections before the findings table:

```markdown
### Journey Assessment: {journey name}
**Persona:** {persona}
**Goal:** {goal}

| Step | Should Feel | Actually Feels | Vitals (LCP/CLS/INP) | Transition | Verdict |
|------|------------|----------------|----------------------|------------|---------|
| {step name} | {from journey file} | {honest assessment} | {values} | {smooth/jarring/stalls} | {pass/gap/fail} |

### Journey Arc
- Momentum: {builds well / stalls at step N / loses steam}
- Coherence: {feels unified / disjointed between steps N and M}
- Payoff: {delivers / underwhelming / missing}
- Drop-off risk: {step N — because {reason}}
- Worst step: {step N — biggest should-feel gap}
- Best step: {step N — what makes it work}
```

Journey-level findings merge into the Step 6 findings table alongside per-step findings.

## Update the journey file

If the browser review revealed that "should feel" descriptions are inaccurate, red flags are missing, or steps need reordering, **update the journey file**. The journey is a living document — each browser review refines it.

## When a journey step fails — capture trace, attach path, close session

When a journey step fails — assertion mismatch, page error, navigation timeout, broken render, unrecoverable interaction error — save the trace **before** closing the session. The trace lets you diagnose the failure offline without re-running the journey.

Tracing is record-then-stop: recording was started by `tracing-start` in the walk's opening sequence (see the worked example above) — a trace can only be saved for the interval after recording started, so a walk that never started recording has nothing to save on failure. To save:

```
playwright-cli -s=<session> tracing-stop
```

Unlike `agent-browser`'s `trace stop <path>`, `tracing-stop` takes no output-path argument — it auto-writes the trace to `.playwright-cli/traces/trace-<tool-timestamp>.trace` (plus a sibling `.network` file and a `resources/` directory) relative to the working directory (`playwright-cli-reference.md`'s caution on `tracing-stop`). Immediately after it returns, via the Bash tool, move that freshly-written file to an absolute path:

```
mv .playwright-cli/traces/trace-<tool-timestamp>.trace /absolute/path/to/repo/.claude-tweaks/artifacts/traces/<session>/<timestamp>.trace
```

`<timestamp>` should be ISO-like and filename-safe (`20260501-143022`); disambiguate by exact modification time rather than "most recent" alone when multiple sessions may stop tracing concurrently. Then close the session:

```
playwright-cli -s=<session> close
```

In the failure report, attach the trace's absolute path verbatim. The file is a Playwright CLI trace — a human opens it with `npx playwright show-trace <path>` (the CLI has no trace-viewing subcommand of its own). Do not omit the trace — failure reports without a trace path are not actionable. Artifacts older than 30 days are surfaced for deletion by `/tidy`'s residue sweep (the `artifact` residue finding); `.claude-tweaks/artifacts/` belongs in `.gitignore`.

<!-- playwright-cli: no equivalent found for agent-browser batch — see issue Gotchas -->
If the failure is mid-walk, the sequence run so far will have already returned per-command output up to the failure point — there is no batch to return partial output from anymore. Run `tracing-stop` (plus the relocation above) and `close` as the next two commands once the failure is detected.
