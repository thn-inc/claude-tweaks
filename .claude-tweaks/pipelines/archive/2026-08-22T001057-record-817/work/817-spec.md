---
record: 817
origin: capture
risk: low
size: low
ceremony: fast-lane
grants: [build]
surface: backend
---
# 817: release-claim.js collapses an unreadable/corrupt claim blob into the same outcome as a live competing claim

Surface: backend

## Current State

`bin/lib/release-claim/release.js` maps an `unreadable` classified claim to the same outcome (`skipped-not-owner`, exit 4) as a claim genuinely held by a different live run, distinguished only by the string `unreadable` embedded in the message. An operator or downstream skill that retries on exit 4 assuming a sibling run will eventually release the claim will wait forever on a corrupted claim blob that can never self-resolve.

## Deliverables

Give the unreadable-blob case its own distinct outcome/exit code (or an explicit repair/force-release path), separate from the live-competing-claim case, so the two are mechanically distinguishable rather than distinguishable only by parsing the message string.

## Acceptance Criteria

- A corrupted claim blob produces a distinguishable exit code/outcome from a live-held claim.
- A regression test covers the corrupt-blob path.
- `npm test` green.

## Technical Approach

Add a new outcome (or exit code) in `bin/lib/release-claim/release.js`'s classification path for the `unreadable` case, keeping it separate from `skipped-not-owner`. Callers that currently branch on exit 4 alone need to be checked for whether they should now branch on the new outcome too, or whether the corrupted-blob case should surface distinctly (e.g. to a human) rather than being silently retried.

### Key Files

- `bin/lib/release-claim/release.js`

## Gotchas

- A caller relying on exit 4 meaning "retry later, a sibling holds it" must not silently swallow the new distinct outcome the same way — that reintroduces the same ambiguity one level up.

## Original request

release-claim.js collapses an unreadable/corrupt claim blob into the same outcome as a live competing claim

**Related:** none

## Current State
`bin/lib/release-claim/release.js` maps an `unreadable` classified claim to the same outcome (`skipped-not-owner`, exit 4) as a claim genuinely held by a different live run, distinguished only by the string `unreadable` in the message. An operator or downstream skill that retries on exit 4 assuming a sibling run will eventually release the claim will wait forever on a corrupted claim that can never self-resolve.

## Deliverables
Give the unreadable-blob case its own distinct outcome/exit code (or an explicit repair/force-release path), separate from the live-competing-claim case.

## Acceptance Criteria
A corrupted claim blob produces a distinguishable exit code/outcome from a live-held claim; a regression test covers the corrupt-blob path.

Defer-reason: found-during-review — surfaced by a whole-branch `/code-review` pass ahead of a release; not the review's own scope to fix.

