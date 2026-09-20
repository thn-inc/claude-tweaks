---
name: driver-skill-outcome-taxonomy
description: Use when writing or reviewing a skill that drives engines it does not implement — merging, tagging, pushing, closing records through release-please, `gh pr merge`, a bin/ CLI or a fact pack — and its steps must report an outcome. Covers the four outcome words keyed on what physically landed, the gating-vs-shipped split for any value the engine decides, and the per-step recovery each word owes. Keywords - driver skill, outcome word, failed, HELD, PARTIAL, released, gating version, shipped version, provenance, bookkeeping failure, recovery.
---

# Driver-skill outcome taxonomy

A **driver skill** orchestrates engines it does not implement: it fetches, gates, invokes
release-please or `bin/release-local.js`, merges through `gh pr merge`, tags, then books records.
`plugin/skills/release/SKILL.md` is the shipped instance. Every review finding on #2256 that
survived refutation was a taxonomy or a provenance confusion — not a logic bug — which is what this
skill exists to prevent.

## The four outcome words, keyed on what physically landed

Pick the word from the *world*, never from the last step that ran:

| Word | Means | Test |
|---|---|---|
| `HELD` | A gate fired **before** the first mutating step | Nothing outside the run dir changed |
| `failed` | The mutating step was attempted and **nothing landed** | The remote is byte-identical to the pre-step state |
| `PARTIAL` | Something **landed**, a later step missed | A tag/merge/commit exists that no successful run would leave alone |
| `released` | Every step, including bookkeeping, landed | Nothing is left to retry |

Three rules follow from the table, and each cost a fix round on #2256:

- **Every mutating step needs a `failed`-vs-`PARTIAL` split, and an engine exit code rarely
  supplies it.** `bin/release-local.js` uses exit `1` for both "nothing written" and a named
  partial state; mapping `1` → `PARTIAL` unconditionally reports a landed release that never
  happened (ledger row 95). Split on the engine's *stderr prefix* or on a re-probe of the world,
  and say in the step which one you used.
- **A `failed` write inside a late per-record loop must reach the summary.** Define `released` over
  *all* steps, give the summary template a slot for the bookkeeping failure (`bookkeeping: {k} of
  {n} failed — {list}`), and never let Next Actions assert "the shipped records are closed"
  unconditionally (row 106).
- **Each word names its own recovery, and a re-run is almost never one.** A driver's Step 1 usually
  re-reads state, so a second invocation of a `PARTIAL` run finds an empty set and stops at
  nothing-to-do. Name the idempotent per-item writes instead (`gh issue comment`/`close`, a
  `markShipped`, `git tag … && git push`), and for a `HELD` name the command that clears the gate
  (row 107: "tag the commit that last set the manifest to `{base}`" — never the tip).

## Gating value vs shipped value

**Any value the engine, not the skill, decides has two lives.** The number the skill gated on is
the *gating* value; the number the engine returned is the *shipped* value. They are allowed to
differ — the pack never fetches, the engine reads config the pack does not, and a sibling run can
land in between (ledger rows 93, 104-105).

- Gate on the gating value; **verify and book the shipped one**, re-read from the engine after it
  acts.
- Reconcile the two **once**, at one named step, never per use site.
- Say which is which at every render: a console row, a commit subject, a `Shipped in v{x}` comment.
- The producing artifact carries the same rule from its own side — see
  `.claude/skills/run-directory-fact-packs/SKILL.md`'s "A pack proposes; it never decides".

## Provenance of every rendered premise

A driver renders recommendations from data three layers away (a fact pack, a forge API, an engine's
stdout). Before a step renders a claim, name where the value came from and what a degraded field
means there:

- **Never re-derive a value the pack already resolved.** Reading `integration-model` afresh when the
  pack carries an `engine` field is how two steps disagree about which engine ran.
- **A degraded field stops the step; it is not a falsy default.** `engine`, `unreleased` and
  `proposedVersion` each have an absent-file and an `{ok: false}` branch.
- **Check the identity of a number before trusting its type.** `gh issue view N` succeeds on a
  *pull-request* number and returns the PR's title, so a `(#N)` commit-subject suffix from a default
  squash names the PR, not a record — only an `/issues/N` payload carrying `pull_request`
  distinguishes them (row 108).
- **A gate's own evidence is weaker than a direct read.** Screen with the bulk/cached value, then
  re-confirm per item before anything destructive.

## Anti-patterns

| Anti-pattern | Instead |
|---|---|
| Reporting a landed-but-unverified mutation as `HELD` | `HELD` means nothing landed; this is `PARTIAL` |
| Mapping one engine exit code to one outcome word | Split the ambiguous code on stderr or a re-probe |
| "Re-run the skill" as the recovery for `PARTIAL` | Name the idempotent per-item writes |
| Booking the value the skill gated on | Book the value the engine returned |
| A per-record failure in the last loop with no summary slot | A `bookkeeping: {k} of {n} failed` line whenever k > 0 |

## When not to use

A skill that *implements* what it reports (a linter, a generator writing only into the run dir) has
one outcome — it worked or it threw. This taxonomy is for skills whose mutations are executed by
something else and must be described after the fact.

## Origin

Derived at wrap-up from the seven-spec run that shipped `/claude-tweaks:release` (#2251-#2258) —
ledger row 115 of `docs/plans/2026-09-11-release-skill-ledger.md`, rulings 13, 14, 19, 20 and
review rows 104-108.
