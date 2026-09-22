---
name: fact-validated-narration
description: Use when a skill emits LLM-written prose that cites external facts — a report, a digest, a dashboard — and a fabricated citation would be indistinguishable from a real one. Splits the work into gather / narrate / render, validates every citation against the gathered fact set, and names the free-text channels that must be neutralized before anything renders. Keywords - fact pack, narration, citation validation, refs, injection, neutralize, truncated, partial gather, never invent.
---

# Fact-Validated Narration — Gather, Narrate, Validated Render

A skill that writes prose about external facts — what shipped last week, what the queue looks like,
what a judge found — has a failure mode no reviewer can see from the output: a fabricated PR number,
a mis-attributed author, or a confident "nothing happened this period" that was actually a failed
API call. The prose reads identically either way. The discipline below is what makes the output's
truthfulness a property of the pipeline rather than of the model's care on that particular run.

`/claude-tweaks:activity` (#2757) is the shipped instance this generalizes from.

## The three-stage split

1. **Gather (deterministic).** A CLI writes a fact set to a file: `schemaVersion`, the rows, a
   per-call fail-safe `failures[]`, and a `truncated[]` signal for every row cap it hit. It never
   writes prose.
2. **Narrate (model).** The model reads the fact set and writes a *structured* file — items with
   text plus a `refs[]` array of fact ids. `refs[]` is the **only** citation channel. The model
   never writes a link, never writes the final document, and never writes a number the fact set
   does not contain.
3. **Render (deterministic).** A second CLI resolves every ref against the fact set and emits the
   final document. Anything a ref does not back is not a citation, whatever it looks like.

The model is between two deterministic processes and touches neither the input nor the output
artifact. That is the whole point: the narration step cannot invent a citation that survives,
because it is not the thing that writes citations.

## Ref resolution has three outcomes, not two

Absent, ambiguous, and unparseable each get their **own** warning form in the rendered output.
Collapsing them into one "dropped" case destroys the signal that tells a reader whether the gather
came back short or the narration went wrong. This is `parse-signal-discipline`'s rule applied to a
citation channel — read that skill for the general shape; this is the citation-specific instance.

## Enumerate every free-text channel before writing the renderer

Not one channel per review round. Write down, up front, every string in the output that did not come
from a validated ref, and neutralize all of them in one pass.

The obvious two are item text and headings. The third — the one #2757's whole-branch review caught,
after two earlier fix rounds had each closed exactly one channel — is the **gather step's own
failure messages**, which carry remote-controlled text (a repo name, a `gh` stderr body) straight
into the document. If you are discovering channels one review round at a time, you have not
enumerated; you are patching.

The rule this skill teaches is the enumeration discipline, not the list. The list is always longer
than it looks.

## A partial gather is never an empty period

`failures.length === 0` belongs in the "nothing happened in this period" predicate. Without it, a
gather that failed every single call renders as a clean, confident "no activity" report — the
highest-cost failure available to a document a human forwards to their manager. See
`isEmptyPeriod` in `plugin/bin/lib/activity/render.js`.

## Row-cap truncation is a rendered signal, not a silent slice

Any cap the gather applies appears in the output. A report that quietly dropped rows 51-200 is
wrong in a way the reader cannot detect.

## Shipped instance to cite

- `plugin/bin/lib/activity/gather.js` — the gather half (`schemaVersion`, per-call fail-safe
  batching, `failures[]`, `truncated[]`).
- `plugin/bin/lib/activity/render.js` — the validating half: `citableRefs`, `resolveRef`, `inline`,
  and `isEmptyPeriod`'s `failures.length === 0` clause.
- `plugin/skills/activity/SKILL.md` — the prose contract the two CLIs bracket.
- `tests/bin-lib/activity/render.test.js` — the injection and failed-gather cases.
- `tests/activity-never-invent-conformance.test.js` — the prose pin.

## When to use

- Adding or reviewing a skill whose output is model-written prose over facts gathered from outside
  the session — a report, a digest, a dashboard, a judge's rationale.
- Reviewing an existing one and checking whether the model can reach the output file directly, or
  whether any string in the rendered document bypasses ref validation.

## When not to use

- The output is deterministic (a table rendered straight from data with no model step) — there is no
  narration to validate.
- The facts are all inside the session's own transcript and a reader can check them without leaving
  it. The cost this skill pays for is specifically the unverifiable external citation.

## Nearest skills, and why this is separate

- `run-directory-fact-packs` owns the gather-side envelope and the anchored read-only CLI, but stops
  at the pack — it has no opinion on what a model may write from one.
- `parse-signal-discipline` owns one of the four elements (the unparseable case); cited above, not
  duplicated here.
- `gh-api-module-pattern` owns the seam the gather shells out on.

## Origin

Staged by the batch curation pass of run `2026-09-21T213441-spec-2697-2757-2758-2759` (from
`spec-2757/staged/reflect-3.md`, run ledger #13) and created at that run's consolidated Review
Console under the Skill updates section's Approve-all default.

**Reusability caveat, recorded deliberately.** There is exactly **one** shipped instance today. Two
next consumers are named and plausible but not committed: `/claude-tweaks:help`'s dashboard and
`/claude-tweaks:feedback`'s judge. If a later reader concludes `activity` is the only skill that
will ever narrate over gathered facts, the right move is to fold this content into
`run-directory-fact-packs` as a section and delete this file — the complexity criterion is strongly
met (the channel list was discovered one channel at a time across two fix rounds plus a whole-branch
review finding), the reusability one is not yet.
