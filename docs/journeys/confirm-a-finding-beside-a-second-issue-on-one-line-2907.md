---
files:
  - plugin/bin/lib/coordination.js
  - plugin/skills/review/step3-lens-dispatch.md
---

# Confirm a Finding Beside a Second Issue on One Line

**Persona:** a developer who runs `/claude-tweaks:review` (usually inside `/claude-tweaks:flow`) at `medium` effort or above, and reads the review summary to decide what to fix before merge.
**Goal:** when both agents of a reproduction pair report the same issue at one location, and one agent also reports a different issue there, the shared issue lands `confirmed` no matter which order that agent listed its findings in.
**Entry point:** `/claude-tweaks:review #{n}` (or the `review` phase of `/claude-tweaks:flow #{n}`) on a diff where one line carries more than one problem.
**Success state:** the summary's `### Code Review Findings (confirmed)` table lists the shared issue once. Only the second issue, reported by one agent alone, stays `unconfirmed`, with no `nearLocation` pointer. It then goes to Step 3.7's tiebreak (`get-a-verdict-on-every-unverified-review-finding-3947.md`), and reaches the Review Console's Low-confidence section only if the tiebreak cannot settle it.

## Steps

### 1. Run a review on a line with two problems
- **URL:** `/claude-tweaks:review #{n}` at `review-effort` `medium` or above
- **Action:** let Step 3 dispatch a lens as a reproduction pair. Agent A reports two findings at one `path:line` (say a missing size cap and a symlink containment gap); agent B reports only the symlink gap there.
- **Should feel:** nothing different during the run. The change is in how `categorise-reproduction` pairs the reports, not in what the agents are asked or how long the review takes.
- **Should understand:** pairing is settled across all of agent A's findings before anything is labelled a coincidence. The best text match wins, and a finding is never left out when re-routing another pair would confirm both. Agent A's report order no longer matters.
- **Red flags:** the symlink gap is confirmed in one run and lands unconfirmed in another, with only A's report order differing. All three reports land unconfirmed.

### 2. Read the confirmed and low-confidence findings — the review summary
- **URL:** the review summary's `### Code Review Findings (confirmed)` table, then the Review Console's Low-confidence section
- **Action:** look for the shared issue, then for the issue only one agent reported.
- **Should feel:** confident that the confirmed table reflects what both agents found, without reading the source to reconcile three overlapping entries.
- **Should understand:** the shared issue is confirmed once. The single-agent issue stays `unconfirmed` as a plain entry: its B-side neighbour paired with the other A finding, so it is no #1980 coincidence partner and carries no `nearLocation`. A `nearLocation` pointer still marks a ±2 pair that shares a location but not substance when neither side reproduced anything.
- **Red flags:** the single-agent issue carries a `nearLocation` pointing at the B finding that confirmed the shared issue. The shared issue appears both in `confirmed` and in Low-confidence.

## Origin
- Created during build of #2907. On #2628's review (lens 3b, `candidates-app-store-readiness.js:308`), both agents reported the symlink containment gap, and agent A also reported a size-cap issue on the same line. Because pairing walked A's findings in order, B's symlink finding was taken as the size-cap finding's coincidence partner: 0 confirmed / 3 unconfirmed, and 1 / 1 with A's order reversed. The fix pairs best-first across all A findings, adds augmenting paths so each pass is a maximum pairing, and draws coincidences only afterwards.
- Related journeys: `confirm-findings-split-across-a-multi-line-statement-2955.md` (the same matcher, two agents anchoring one finding on different lines), `confirm-coverage-findings-across-reproduction-pairs-3049.md` (where agents anchor a coverage gap).
