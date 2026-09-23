# UX Heuristics Lens

Shared, criteria-only checklist — what to flag when applying the UX-heuristics lens during a visual review pass or a UI-affecting code review (#2655). No workflow, no Next Actions: this file is the checklist itself, invoked from `page-mode.md`'s Step 4 (Structured Analysis) and available to `/claude-tweaks:review`'s Code-Mode Procedure for UI-affecting diffs. Source: a ~20-item social-media Reel (hook-only caption, unsourced) — treat every row as a manual-inspection prompt to check for, not a hard rule to enforce mechanically; some rows (e.g. sub-400ms interactions) can't be measured without instrumentation this repo doesn't have, so judge them from lived interaction feel, not a stopwatch.

## When this lens applies

Gate invocation on `Surface: web/mobile/desktop` (per `design-wrapper/frontend-detection.md`'s existing Surface-detection signal) — a backend/infra record with no rendered UI never pays for this pass. Within visual review, it runs as part of page mode's Step 4 structured analysis (full inspection only — the QA-accelerated path defers to `qa-accelerated.md`'s own visual-quality-only focus, which already covers "Visual weight and balance"). A code-review invocation checks the lens against a rendered screenshot of the changed UI (via the same `browser-review.md` session conventions), not against source code directly — several rows (visible progress, error recoverability, transition timing) are only observable live.

## The checklist

| Heuristic | What it flags | Example violation |
|---|---|---|
| Reduce choices per screen | More top-level options/actions than a user can scan at a glance | A settings screen with 15+ ungrouped toggles in one flat list |
| Use large targets | Interactive elements sized or spaced too small/tight for comfortable tapping/clicking | A 16px icon-only button with no surrounding padding, adjacent to another tappable element |
| Favor familiar patterns | A novel interaction where a well-established convention exists and would serve just as well | A custom swipe-to-delete gesture with no visible affordance, replacing a standard delete icon |
| Group related info | Visually or spatially separated content that belongs together | A form's error message rendered far from the field it refers to |
| Chunk content | A long unbroken block of text/fields with no visual segmentation | A 12-field signup form with no section headers or grouping |
| Keep interactions under ~400ms | A click/tap/keystroke response that feels sluggish (manual-inspection prompt — no stopwatch available; judge from lived feel, not a measured threshold) | A button press with a visible lag before any feedback appears |
| Highlight the primary action | No clear visual distinction between the primary action and secondary/tertiary ones | Three same-weight buttons ("Save", "Cancel", "Delete") with no visual hierarchy |
| Keep key actions nearby | A frequently-needed action requires excessive scrolling or navigation to reach | The "Submit" button is off-screen below a long form with no sticky footer |
| Put essentials first | Critical information or actions buried below less important content | A dashboard's most-used metric appears third, after two decorative widgets |
| End flows memorably | A multi-step flow ends abruptly with no confirmation, summary, or next-step guidance | A checkout flow that just redirects to the homepage after payment with no confirmation screen |
| Show visible progress | A long-running operation gives no indication it's working | A file upload with no progress bar or spinner — the UI just appears frozen |
| Simplify complex interfaces | A screen exposes more configuration/complexity than the common case needs | An "advanced" option always visible instead of behind a disclosure toggle |
| Use sensible defaults | A field/setting ships with no default, or a default that fits nobody | A "results per page" selector defaulting to 1 instead of a reasonable common value |
| Prevent errors proactively | The UI allows an input it will later reject, instead of guiding the user away from it upfront | A date picker that lets you select a past date for a future-only booking, then errors on submit |
| Make errors recoverable | An error state offers no path back to a working state | A failed form submission that clears all entered data instead of preserving it |
| Keep patterns consistent | The same kind of control/interaction is styled or behaves differently in different places | One page's "Cancel" button is red (implying destructive) while another page's "Cancel" is neutral |
| Visually connect related elements | Elements that interact with each other have no visual relationship (proximity, alignment, shared styling) | A tooltip's trigger icon and its popup content share no visual link (no arrow, no proximity) |
| Reduce task time | A flow requires more steps or re-entry of the same information than necessary | Asking for the same email address twice with no autofill/carry-forward between steps |
| Reveal complexity gradually | All configuration options are shown at once instead of progressively disclosed as needed | A "create project" form showing 20 fields upfront instead of starting with just name + type |
| Make completion feel close | A multi-step flow gives no sense of how much remains | A 6-step wizard with no step indicator ("Step 3 of 6") or progress bar |

## Reporting a finding

When a screen violates a heuristic, name the specific heuristic (not a vague "UX could be better") and cite the concrete evidence — an `eN` ref plus description (per `browser-review.md`'s Element-reference convention) or a screenshot path. Findings from this lens fold into the same Step 6 Report & Route table as every other visual-review lens, with `Source = UX Heuristics`.

## What NOT to flag

- A heuristic that doesn't apply to this screen's context (e.g. "end flows memorably" on a single-page settings toggle with no multi-step flow) — silence on an inapplicable row is expected, not a missed check.
- A genuine, deliberate design tradeoff already documented in `DESIGN.md` or an accepted decision — this lens surfaces observations for judgment, it does not override a documented decision.
- Sub-400ms interaction timing when no instrumentation is available and the interaction doesn't feel sluggish in the live walk — do not fabricate a measured value.
