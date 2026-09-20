# Research — Verify Mode Source Registry

Loaded by `verify-mode.md` when a question is classified **falsifiable** and needs a verdict.
`verify-mode.md` owns the mode's procedure; this file owns the sources, and it is separate
precisely because it is the part that grows — adding a source is an edit here, and the mode
procedure should not have to be re-read to make one.

## The registry

Entries are keyed by **what a source can falsify**, not by which tool they use. Three entries below
mechanically run `grep`; they are separate because they answer different kinds of question, and
collapsing them by tool would lose exactly the distinction the routing rules depend on.

| Source | What it can falsify | Confidence | Read mechanism |
|---|---|---|---|
| `runtime` | "this command works", "this produces X" — any claim about observable behavior when actually run | high | Execute it, bounded. See Bounded execution below. |
| `codebase` | "this symbol / branch / behavior exists in the source" | high | `Grep` / `Read` over source files. Provenance is `file:line`. |
| `repo-prose` | "this project already documents, decides, or forbids X" | high | `Grep` / `Read` over `CLAUDE.md`, `docs/**`, `skills/**`. Provenance is `file:line`. |
| `tests` | "this behavior is covered", "this invariant is enforced" | high | Read the suite; run one focused test when reading leaves real doubt. |
| `history` | "we have tried this before", "this failed before", "this was deliberate" | high | `docs/incident-log.md`, `git log`, closed work records. |
| `telemetry` | "this actually happens in practice", "at this rate" | high | `.claude-tweaks/pipelines/*/events.jsonl` and each run's `decisions.md`. |
| `deps` | "the dependency does / does not support X at the version we pin" | medium | `tools/upstream-drift/`'s checks and `manifest.yml`. See Dependency reads below. |
| `web` | "the outside world does X", "the state of the art is Y" | medium | `WebSearch` / `WebFetch` — the same tools the bare-topic survey path uses. |
| `human` | Anything only the human knows — intent, priority, an unstated constraint | n/a — terminator | **Dispatches no agent.** See The human terminator below. |

Confidence is a property of the **source**, carried on each verdict — never a document-level
disclaimer. A single run routinely mixes `file:line` evidence with web evidence, and a flat list
renders them identically.

### Bounded execution (`runtime`)

Reuse the technique `skills/docs-health/judge-procedure.md` already established for executing
command blocks — do not invent a second one:

```bash
cmd > /tmp/rv-$$.out 2>&1; echo "exit=$?"
```

Inspect the exit status plus `tail -20` of the temp file. The check is whether the command behaves
as claimed, not what it prints; an unbounded capture of something like `npm test` runs to hundreds
of KB and none of it changes the verdict. Widen to the full file only when the command fails, or
when its tail contradicts the claim and the detail is needed to describe the contradiction.

### Dependency reads (`deps`)

`node_modules` reads are **structurally denied in this project**, even after a grant attempt — this
is a standing environment fact, not a transient permission prompt to retry. When a `deps` question
needs the installed source, fall back to the dependency's public documentation (via WebFetch) and
record the verdict at **medium** confidence, noting the fallback in its provenance. Do not report a
`deps` verdict at high confidence on the strength of documentation alone: docs describe intent,
installed source describes behavior.

### The human terminator

`human` **dispatches no agent.** Routing a question here means stop researching it and ask — there
is no source that can settle intent, and a research pass that guesses at it produces a confident
answer to a question nobody asked. A question routed to `human` yields no verdict; it yields a
question for the caller to put to the user.

## Routing

A question goes to **every source that could falsify it** — not to the single best one. Multiple
sources per question is the normal case, not an exception, and a question that reaches only one
source is usually a question that was scoped too narrowly.

Route by reading the "What it can falsify" column against the question, and take every row that
could return a contradicting answer. Two consequences follow:

- **Agreement across sources is itself evidence.** Three sources that independently fail to falsify
  a claim support it far more than one that fails to falsify it once.
- **Disagreement is the most valuable outcome.** When `repo-prose` says one thing and `codebase`
  says another, the design question is settled less by which is right than by the fact that the two
  have drifted — that is a finding in its own right, and it is reported as one rather than resolved
  silently in favor of whichever source is easier to trust.

`human` is the exception to the fan-out, and it is **exclusive**. A question only a human can
settle is by definition one no source can falsify, so it never appears in the same routing as a
falsifiable source (see The human terminator). If a question looks like it routes both to `human`
and to a falsifiable source, it is two questions wearing one sentence: split it, route each half on
its own terms, and let the falsifiable half's verdicts stand as context the human reads before
answering the other half.

### Absence is a finding

A source that returns nothing has answered. Report it — never omit it. Which outcome that answer
takes depends on what the claim asserted, not on absence itself (see the dispatch prompt's absence
rule): "no precedent exists" verifies an absence-shaped claim, but the identical empty result
falsifies a presence-shaped claim like "X already handles Y". This binds hardest on `history` and
`telemetry`, where "we have never done this before" is frequently the single most design-changing
thing a run surfaces. A silently-absent result is indistinguishable from a lookup that failed, and
silence cannot be found by keyword search later.

## The verdict

Each dispatched source agent returns exactly one verdict:

```
claim:      {the specific proposition you checked, stated so it can be true or false}
outcome:    verified | falsified | unverified
source:     runtime | codebase | repo-prose | tests | history | telemetry | deps | web
confidence: high | medium
provenance: {file:line, command + exit status, URL, or record ref}
checked-at: {sha}
```

- **`claim`** — the proposition the outcome refers to, written so it can be true or false. Without
  it `verified` is unreadable: a caller cannot tell whether the source confirmed presence or
  confirmed absence, and those are opposite answers to the same question.
- **`outcome`** — `falsified` is the valuable one. It is not a failure of the research; it is the
  research working. `unverified` means the source ran and could not settle the claim either way,
  which is distinct from the source finding nothing — which outcome an empty result takes depends
  on what the claim asserted (see the dispatch prompt's absence rule).
- **`source`** — the registry row that produced it. `human` never appears here: it dispatches no
  agent and therefore returns no verdict.
- **`confidence`** — the tier from that source's registry row, not a per-run judgment. **Confidence
  is per-source, not per-report.** A run that mixes a `file:line` verdict with a `web` verdict must
  render them at their own tiers; a single document-level disclaimer lets the grep-verified fact
  lend its credibility to the blog post beside it.
- **`provenance`** — what a reader would have to open to check the verdict themselves. A verdict
  with no provenance is an assertion, and is treated as `unverified` regardless of what it claims.
- **`checked-at`** — the commit sha the check ran against, from `git rev-parse HEAD`. Verdicts rot:
  a claim verified against one tree says nothing about another, and without the sha there is no way
  to know which tree it was.

Related: #117 ("Stamp health-sweep issues with the commit they were verified against") applies the
same sha-stamping to a different producer. If it lands a shared helper, use it rather than
duplicating the mechanism.

## Dispatch

> **Parallel execution:** Dispatch each question×source pair as parallel Task agents — each runs
> independently and returns one verdict. Assemble results after all agents complete.

One agent per question×source pair. A question routed to four sources fans out to four agents, and
they run concurrently — the pairs share no state, and a source that is slow to read must not hold
up the three that are fast.

**The agents are read-only and carry no git access.** They read files, run bounded read-only
commands, and fetch URLs; they never stage, commit, or branch. This removes the shared-index race
rather than narrowing it — parallel agents with git access race on one index no matter how
file-disjoint their reads look.

Model profile: [Use: Fast] for `codebase`, `repo-prose`, `tests`, and `history` — these are grep-and-read
lookups against a named target. [Use: Standard] for `runtime`, `telemetry`, `deps`, and `web`, where the
agent has to judge whether what it found actually settles the claim. Resolve via `node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-profile.js" {fast|standard}` (`_shared/subagent-dispatch-core.md` § Model Selection).

Inline this block verbatim in every dispatch prompt. It is a define-in-prompt format rather than
Template A, per `skills/_shared/subagent-output-contract.md`'s "Not every consumer uses A/B/C" — a
source agent returns a verdict, and Template A's severity/path/finding columns cannot express one.
The contract's input discipline, four-value status line, and model profile selection all still apply.

```
Report one of these as your FIRST line, alone:
DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

OUTPUT FORMAT (required):
Then return ONLY these six lines, no preamble and no narration:

claim:      {the specific proposition you checked, stated so it can be true or false}
outcome:    verified | falsified | unverified
source:     {the one source you were assigned}
confidence: high | medium
provenance: {file:line, or command + exit status, or URL, or record ref}
checked-at: {output of `git rev-parse HEAD`}

If your source returns nothing, that is an answer, not a failure — but map it
to the outcome your claim actually takes. If your claim asserted something is
present ("X handles Y", "this is covered"), finding nothing FALSIFIES it:
report outcome: falsified. If your claim asserted absence ("no precedent
exists", "nothing depends on this"), finding nothing VERIFIES it: report
outcome: verified. Either way state the claim in the claim: line and name
what you searched in provenance. Never omit an empty result.

If you cannot reach your source at all, report BLOCKED and say what you tried,
in place of the six-line block.
Do not guess, and do not substitute a different source.
```

A verdict that arrives without provenance is treated as `unverified` whatever its `outcome` says —
re-dispatch once with the missing field named, then — if the field is still missing — drop the
pair and report it as unverified.
