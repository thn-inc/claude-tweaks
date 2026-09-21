# Upstream Feedback Batch Contract

The shared render + chunked-`multiSelect` + drift-fallback contract for filing upstream
feedback (`U#` items) in bulk. Cited by every call site — `skills/feedback/SKILL.md`'s Step 7
(1..N items via direct or `--queue` invocation), and `skills/wrap-up/review-console.md`'s and
`skills/flow/multispec-review-console.md`'s Upstream feedback sections, where it is the Override
drill specifically (Approve all resolves `U#` to its own stated default with no call into this
contract — filed when the staged draft carries a `**Causal:** systemic` tag, declined otherwise
(#2551); the `unattended`-only `consoleAutoResolve` path resolves `U#` to filed unconditionally
the same way, also without a call here — see `review-console.md`'s Auto-resolution
short-circuit) — none of
which restates these rules inline (CLAUDE.md's cross-reference rule: every relationship stated
once).

## Rendering

Render every candidate's full scrubbed draft as literal markdown text immediately above the
`AskUserQuestion` call — `multiSelect: true` does not support the tool's `preview` field
(single-select only), so the option `description` alone is too short to carry a filing decision.

**Prior-decline annotation (#1033).** When the caller's Step 4 dedup attached a `priorDecline: {
declinedAt, reason }` to an item (`skills/feedback/SKILL.md` Step 4's Prior-decline annotation),
append it to the rendered draft, never silently suppressed — same convention
`reflect/full-mode.md`'s Prior-decline annotation uses for insights:

```
_(previously declined {declinedAt date}: {reason})_
```

## Chunking

Split the batch into groups of at most 4 items — `AskUserQuestion`'s own per-question option cap
(2-4 items; confirmed against the tool's own current schema at call time, not assumed from this
file). Issue one `multiSelect: true` `AskUserQuestion` call per chunk, sequentially — never in
parallel, so each chunk's answer is known before the next renders. Each chunk's options: `label`
= the item's title, `description` = a one-line summary plus any dedup flag (literal format
`**possible duplicate:** #{N}` when a dedup search found a match — never rendered as a separate
`AskUserQuestion` call) plus, when the item carries a `priorDecline` (#1033), `**previously
declined:** {declinedAt date}: {reason}` on its own line within the same description.

**No pre-selection exists.** The tool's `options` schema carries only `label`/`description`/
`preview` — confirmed against the tool's own current schema, not assumed — so every option
renders unchecked. Checking an item is the explicit per-item approval act; nothing is
pre-authorized. This is stricter than a pre-checked design, not weaker: `[IL-114]`'s "an approval
never implies a differently-scoped write is authorized" holds more cleanly when the affirmative
act is checking, not un-checking. Submitting a chunk with some items unchecked declines exactly
those — see Declining an item below.

A batch of 6 renders as 2 calls (4, then 2); a batch of 4 or fewer renders as exactly 1 call. A
batch of exactly 1 item is the degenerate single-chunk case — functionally unchanged from a
direct single-item `/claude-tweaks:feedback` invocation.

## Question text

State explicitly that a checked item **will be filed**, not shortlisted, and restate the escape
hatch plainly (CLAUDE.md's `[IL-13]`: the tool's `Other` field is otherwise undocumented in the
rendered UI). Append this fixed sentence to every batch question's text:

> To edit an item instead of filing or skipping it as-is, describe the change and which item it
> applies to (by title) in your next message.

## Declining an item

An unchecked item is logged as declined, never silently dropped. **First, in every branch
below:** compute the item's fingerprint via `bin/lib/feedback/file-feedback.js`'s
`computeFingerprint(draft)` (the same fingerprint `/feedback`'s own filing step would have
embedded had this item been checked instead) and record the decline via
`bin/lib/declined-learning/store.js`'s `recordDecline(fingerprint, { reason, source: 'feedback',
subject: draft.fingerprintBasis.summary })` — `reason` is the user's stated reason when the caller
collected one (the wrap-up/multi-spec console path below), or the literal string `'declined, no
reason given'` otherwise; `subject` (#1033) is the same human-legible summary text
`fingerprintBasis` already carries on the draft, so a future judge dispatch (`session-evaluation.md`'s
`dismissedSubjects`) can render this decline as text a re-evaluation can actually compare meaning
against, not just an opaque hash. A decline write failure degrades open exactly like a watermark
write failure (`_shared/transcript-judge.md`'s "On a write failure" line) — log it as a one-line
note and continue; never abort the batch over it.

Then, per branch:

- **`/feedback --queue` (direct invocation):** post a comment on that item's local
  `upstream-candidate` issue — `"Declined via /claude-tweaks:feedback batch review, {date}"` —
  and leave the issue open. Visible context for a future run.
- **Wrap-up / multi-spec console path:** log the decline to the originating run's `decisions.md`
  with the user's stated reason, or `"declined, no reason given"` when none was offered — the
  same convention the console's `Q#`/`M#` sections already use.
- **Direct single-item invocation (no `--queue`, not from a console):** the single-chunk case
  still renders one confirm; not checking the item (or declining to submit) means nothing is
  filed — the learning stays local, reported as declined at `/feedback`'s Step 9. No comment is
  posted anywhere — there is no local `upstream-candidate` issue to comment on in this path.

## Re-affirming a previously-declined item (#1033)

The mirror of Declining above. When an item carrying a `priorDecline` (`skills/feedback/SKILL.md`
Step 4's Prior-decline annotation) is **checked** — or is resolved to filed by the `unattended`
`consoleAutoResolve` path (`skills/wrap-up/review-console.md`'s Auto-resolution short-circuit) —
the human has re-affirmed a finding they previously declined. Clear the stale entry via
`bin/lib/declined-learning/store.js`'s `clearDecline(fingerprint)`, using the same fingerprint
Step 4's `lookupDecline` matched on, immediately after that item's filing call returns. Same
convention `reflect/full-mode.md`'s Prior-decline annotation already applies to a re-affirmed
insight, and the same failure posture as the decline write above: a clear failure degrades open —
log a one-line note and continue, never abort the batch over it.

Without this, the entry outlives the re-affirmation twice over: it keeps annotating the same
finding on every future run, and — since the entry's `subject` feeds
`session-evaluation.md`'s `dismissedSubjects` into the judge's offset clause, which since #1033
instructs the judge to "omit any new finding whose symptom matches one of these in substance" —
it keeps suppressing a whole class of findings the human has since said they want filed.

## Editing an item

Editing content instead of a flat include/exclude is a free-text message in the next reply,
naming the target item by the title shown in its rendered draft — the same free-text-in-next-
message channel `review-console.md`'s top-level "Approve all / Override specific items" already
uses, generalized to name a single item rather than a global choice. This is the **only** override
mechanism either caller needs — neither defines a separate one.

**No matching title.** When the named title matches no item rendered in this session (a typo, an
item from an already-answered chunk, or one already filed) — list the titles still open for
editing and ask the caller to name one of those, rather than guessing which item was meant or
silently applying the edit to the nearest-matching title. If no reply follows, treat the original
chunk's checkbox answers as final.

## Caller responsibilities

The contract handles rendering, chunking, question text, and override/decline logging. Each
caller is responsible for:

- Gathering and scrubbing every candidate's draft **before** calling into this contract (the
  contract never gathers or scrubs on its own)
- Filing each checked item after the chunk's answer comes back — `/feedback`'s own Step 8 for a
  direct invocation, or `/claude-tweaks:feedback --pre-confirmed` once per checked item for the
  wrap-up / multi-spec console path (see `skills/feedback/SKILL.md`'s Component-Skill Contract for
  who may pass that flag)
