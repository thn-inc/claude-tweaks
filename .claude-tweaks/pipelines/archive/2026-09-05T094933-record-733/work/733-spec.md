---
record: 733
origin: human
risk: low
size: low
ceremony: fast-lane
grants: [build, merge]
surface: backend
---
# 733: Reproduction pairs — treat location+substance agreement with a straddled severity bucket as reproduced (severity contested), not unconfirmed

Surface: backend

Origin: /claude-tweaks:wrap-up Review Console (record #685, run 2026-08-16T205523-spec-685) — staged/reflect-4.md

## Current State

`categoriseReproduction` (`bin/lib/coordination.js`) requires severity-bucket agreement (`high`/`critical` vs `medium`/`low`/`info`) between two reviewers before treating a finding as reproduced. A run's own lens-3c reproduction pair agreed on location and substance for the digest-vs-Approve finding (`step-6-auto.md:154`) but rated it high (B) vs medium (A) — straddling that bucket boundary. Because of the strict bucket-agreement rule, a substantively reproduced finding came back `unconfirmed` and needed a direct-verification override to be rescued. A pair that agrees on the defect but straddles the high/medium line is a common shape; the bucket rule turns it into a false negative that only a source-reading reviewer catches.

## Deliverables

Change `categoriseReproduction` so a location+substance agreement with a straddled severity bucket is treated as reproduced (severity contested) rather than dropped to `unconfirmed` — e.g. take the lower of the two severities as the confirmed value, or flag the finding explicitly as "reproduced, severity contested" rather than silently downgrading it.

## Acceptance Criteria

- A reproduction pair that agrees on location and substance but rates severity in different buckets (e.g. high vs medium) is classified as reproduced, not `unconfirmed`.
- The confirmed severity for such a pair is deterministic (e.g. the lower of the two) or the "contested" state is surfaced explicitly to whatever consumes `categoriseReproduction`'s output.
- Existing reproduction-pair test cases that both agree on severity bucket keep their current classification (`reproduced` when they agree, `unconfirmed` for genuine location/substance disagreement) — this is a narrowing of the false-negative case only, not a general loosening.
- `npm test` green.

## Technical Approach

Locate `categoriseReproduction` in `bin/lib/coordination.js` and its severity-bucket comparison logic. Add a location+substance-agreement check that, when true, short-circuits the strict bucket-equality requirement and instead resolves severity via the lower-of-two rule (or an explicit "contested" flag), consumed by `skills/review/step3-lens-dispatch.md`'s reproduction-pair handling.

### Key Files

- `bin/lib/coordination.js` — `categoriseReproduction`
- `plugin/skills/review/step3-lens-dispatch.md` — reproduction-pair handling

## Gotchas

- Don't loosen the rule for pairs that disagree on *location or substance* — only the specific case of agreement on both with a straddled severity bucket.

## Original request

Reproduction pairs — treat location+substance agreement with a straddled severity bucket as reproduced (severity contested), not unconfirmed

# Reflect — staged finding 4

**Category:** tangential
**Severity:** low
**Reversibility:** high
**Source:** full mode, lens "Surprises"
**Files:** bin/lib/coordination.js, skills/review/step3-lens-dispatch.md

## Finding

The lens-3c reproduction pair agreed on location and substance for the digest-vs-Approve finding (step-6-auto.md:154) but rated it high (B) vs medium (A). `categoriseReproduction` requires severity-bucket agreement (`high`/`critical` vs `medium`/`low`/`info`), so a substantively reproduced finding came back `unconfirmed` and needed the direct-verification override. A pair that agrees on the defect but straddles the high/medium line is a common shape; the bucket rule turns it into a false negative that only a source-reading reviewer rescues. Routed D5 (names a `bin/lib` behavior; holds in any project) — self-reference: this repo owns it, so it becomes a project record, not an upstream issue.

## Suggested resolution

Consider a location-only match with the confirmed severity taken as the lower of the two (or flag "reproduced, severity contested") rather than dropping to unconfirmed — a record for `bin/lib/coordination.js` + `step3-lens-dispatch.md`'s reproduction rule.

## Decision-log reference

STAGED — Step 3: pattern observation "reproduction pair severity-bucket false negative" (self-reference: this repo owns the component → project record). Stage path: staged/reflect-4.md.


Origin: /claude-tweaks:wrap-up Review Console (record #685, run 2026-08-16T205523-spec-685) — staged/reflect-4.md

