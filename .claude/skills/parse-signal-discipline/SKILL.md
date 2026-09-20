---
name: parse-signal-discipline
description: Use when writing or reviewing a mechanized deterministic check that parses loose, real-world prose (a plan, a record body, a free-form config value) rather than a formal grammar — the check's "I could not parse this" case must be a distinguishable signal, never silently identical to "this input legitimately does not apply." Keywords - parse failure, could-not-parse, deterministic check, prose heuristic, silent null, false negative, mechanized check, plan-audit.
---

# Parse-Signal Discipline — Distinguish "Couldn't Parse" From "Doesn't Apply"

A deterministic check that mechanizes a hand-run prose heuristic — grepping a plan for a
verification command, reading a record body for a metadata line, scanning free-form config for a
keyword — is not parsing a formal grammar. Real inputs vary in ways the check's author didn't
anticipate. When the check hits an input it cannot confidently parse, that outcome must be
distinguishable from "this input legitimately does not need this check" — collapsing both into one
`null`/skip return turns an unparseable input into a silent false negative: the check reports
nothing, and nothing downstream ever learns the check didn't actually run.

## The anti-pattern

A function returns the same falsy value (`null`, `undefined`, `[]`, `false`) for two genuinely
different situations:

1. **Doesn't apply.** The input correctly has nothing for this check to find — e.g. a task with no
   Step 2 sub-step at all.
2. **Couldn't parse.** The input has the shape the check is looking for, but malformed or
   incomplete — e.g. a Step 2 heading present, but with no matching `Run:`/`Expected:` pair
   underneath it.

A caller that only ever sees the merged falsy value cannot tell these apart, so it always takes the
"doesn't apply" branch — even when the real story is "this input needed checking and the checker
gave up silently."

## Worked example: `extractStep2Verification`

`plugin/bin/lib/plan-audit/parser.js`'s `extractStep2Verification` (from #903's
`plan-audit.js` Check C) is the concrete case this rule generalizes from — surfaced during #903's
own review/hindsight pass as ledger item 19, building on
ledger item 18's finding about the same function. Its own code comment states the collapse
explicitly:

> Returns null when the task carries no Step 2 (or no Run:/Expected: pair under it) — a non-code
> task, per plan-audit.md's Check C.

Both "no Step 2 at all" (doesn't apply — a documentation-only task has no verification command to
check) and "Step 2 exists but has no parseable Run:/Expected: pair" (couldn't parse — a malformed
task that *should* have a verification command) return the identical `null`. Check C's caller
(`extractVerificationChecks`) filters on that `null` and moves on either way, so a task whose
Step 2 was simply malformed silently drops out of Check C's audit with no warning — exactly a false
negative, not a caught gap.

(Note: the record that requested this skill named the function `parseStep2`, which does not exist
anywhere in this repo — the real name is `extractStep2Verification`. This citation uses the
verified name; treat any reference to `parseStep2` elsewhere as the same stale-name drift.)

## Two more worked examples, both from the composer run (#1988, #1997)

The `extractStep2Verification` case above is the anti-pattern. These two are the rule applied
correctly, in opposite directions — one refuses to merge at the parser, one refuses to merge at the
reporter.

- **Refuse at the parser: a marker-shaped line is never content.** `plugin/bin/lib/compose-context/compose.js`'s
  `CANDIDATE_RE` (`/^\s*<!--\s*(?:when:|\/when\b)/`) splits the input into "not a marker at all"
  and "starts like a marker". Only the first is text; a line matching `CANDIDATE_RE` that then
  fails `OPEN_RE`/`CLOSE_RE`, or carries a key/value outside `VOCAB`, or nests past `MAX_DEPTH`,
  throws a `MarkerError` naming the file and line rather than falling through to
  `tokens.push({type: 'text'})`. The comment above the constant states the split as the contract:
  *"A line that starts like a marker is either a valid open/close or a malformed marker — never
  content."* That is the fix shape's step 1 realized as a hard error instead of a tagged result:
  legitimate for this parser because the caller (`bin/compose-context.js`) has a real place to put
  it — exit 2 with `file:line` on stderr, nothing written, any prior bundle left untouched.
  Silently treating a typo'd `<!-- when: mdoe=auto -->` as prose would compose the wrong branch
  into a bundle a skill step then reads as authoritative.
- **Refuse at the reporter: "could not measure" is not "does not apply".** `plugin/bin/lib/plan-audit/checks.js`'s
  `composedHeadroom` has three outcomes where the pre-#1997 code had two. A row with no `sources`
  is genuine non-applicability (parsing never reached a source list) and is `continue`-d — the fix
  shape's step 3. A row that *does* carry `sources` but also an `error` (missing source, unreadable
  source, malformed marker) is a call site the plan touches that the tool could not measure, and it
  goes to a separate `composedErrors` array with its `step`/`file`/`line`. The report itself
  throwing is one `composedErrors` row with `step: null` — never an empty result that reads as
  "nothing to report" (`[IL-146]`'s silent-fallback shape). Note the reporting posture:
  `composedErrors` never gates `ok`, which stays keyed off `composed`/`breaches` — the fix shape's
  step 2 says *surface it*, not *block on it*.

## The fix shape

When mechanizing a prose heuristic into a deterministic check:

1. **Give "couldn't parse" its own return shape**, distinguishable at the type level from "doesn't
   apply" — e.g. a tagged result (`{status: 'not-applicable'} | {status: 'unparseable', reason}
   | {status: 'ok', value}`), a sentinel distinct from your "doesn't apply" value, or a thrown/
   caught error the caller handles separately. Never reuse the same `null`/`undefined`/`[]` for
   both.
2. **Surface the unparseable case as a warning**, not a silent skip — the caller (or the check's own
   output) should name which input it could not confidently parse, so a human or a later pass can
   look at it, rather than the input silently vanishing from the audit's results.
3. **Reserve the merged-falsy shortcut for genuine non-applicability only** — it's fine for a check
   to return one clean "nothing here" value when the input plainly doesn't have the shape the check
   looks for at all (e.g. no Step 2 heading whatsoever). The risk is specifically when the input
   has *some* of the expected shape but not enough to parse confidently — that's the case that
   needs its own signal.
4. **An optional declaration file that was never read is the same collapse, one level up.** The rule
   is not confined to a parser's return value: any check whose allowlist, threshold, or exclusion
   set comes from an *optional* config file owes the same distinction between "no declaration was
   read at all" and "the declaration was read and lists none". `plugin/bin/verify.js`'s count-stamp
   block (#1925) passes `decl ? decl.flaky.files : null` into `nextFlakyHits` and says why in a
   comment beside it — an `[]` there would have meant "the allowlist is empty", so a run without
   `--scope` (or with `--scope` pointing at a missing file) silently wiped every accumulated
   `flakyHits` count instead of carrying them forward untouched. That defect shipped, and the
   whole-branch review caught it by running the CLI twice — once with a declaration, once without —
   and diffing the stamp. Pass `null`, or another shape the callee branches on explicitly; never the
   same empty collection the populated-but-empty case produces.

## When to use

- Writing a new function that parses a plan, a record body, a ledger entry, or any other loose
  prose artifact in this repo into a structured result for a deterministic (non-LLM) check to act
  on.
- Reviewing an existing parser of this kind and checking whether its "nothing found" return path
  actually merges two different situations.

## When not to use

- The input is validated against a real grammar or schema (JSON, YAML frontmatter with a fixed key
  set) where a parse failure is already a hard error, not a silent skip — this rule targets loose
  prose heuristics specifically, not formal-grammar parsing.
- The check truly has only one kind of "not found" — no plausible reason for a caller to need to
  tell "doesn't apply" apart from "couldn't parse" for this particular input shape.

## Origin

Filed as record #1595 from `/claude-tweaks:reflect` hindsight mode during #903's review (ledger
item 19), generalizing ledger item 18's finding about `plan-audit.js` Check C's
`extractStep2Verification`.
