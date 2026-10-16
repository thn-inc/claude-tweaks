# Skill size limits guard platform limits only — design

**Origin record:** #3230
**Supersedes:** #2020's decision (hard per-`SKILL.md` gate) and `[IL-153]`'s removal condition
**Related:** #1987, #1990, #2020, #2868, #3085, #3086, `[IL-140]`, `[IL-153]`

## Problem

One constant, `CEILING_BYTES` (`plugin/bin/lib/skill-audit/context-cost.js`), drives the hard
per-`SKILL.md` gate, the composed-bundle gate, `merge-size-probe.js`, plan-audit's headroom
check, `bloat.js`, and ~15 conformance tests' per-file assertions. Tighter per-file pins live
beside it (`SPECIFY_SUBFILE_CEILING_BYTES` 28 KB, `STUB_CEILING_BYTES` demo 30 KB / feedback
34 KB, an inline `28 * 1024` on `specify/record-creation-subissues.md`). Description ceilings
(`DESCRIPTION_CEILING_CHARS` 260, `DESCRIPTION_TOTAL_CEILING_CHARS` 8,700) follow the same shape.

Two failures, one cause:

1. **Merge-red.** On 2026-10-16, #3085, #3086 and #2868 each passed CI under 45 KB and merged
   together to 46,138 B on `dispatch/SKILL.md`. Any absolute limit checked per branch can be
   jointly overshot by two green branches (`[IL-140]`); `merge-size-probe.js`'s own header says it
   "narrows the race, it does not close it". `main` has no branch protection, no required checks,
   no merge queue, and took 89 merges in the 7 days to 2026-10-16.
2. **The cliff became a target and drove fragmentation.** The ceiling was raised 40 → 45 → 50 KB;
   19 skill files are at or over 40,960 B, 12 of them at or over 44,000 B (largest 46,248 B). Skill `.md` files went 128 (1.1 MB, 2026-07-01) → 177
   (2.2 MB) → 391 (4.5 MB) → 471 (5.6 MB today) while the 39 `SKILL.md` files stayed ~960 KB.
   The 2026-09-06 footprint audit counted ~165 commits in 5 weeks of ceiling-tax work. A
   "read `x.md` now" split moves bytes without cutting them, and the per-file cap rewards it.

## Goals

A replacement serves four goals (platform safety split into its two surfaces), each with its own
mechanism:

| Goal | Mechanism | Blocks CI |
|---|---|---|
| Platform safety — files | Estimated-token rail below the Read tool's cap | **Yes** |
| Platform safety — descriptions | Per-description cap from the CLI's listing max | **Yes** (per description); total is reported |
| Per-invocation cost | Floor/closure load model; PR delta in `/review`; transcript-measured truth in `/harness-health` | No |
| Instruction efficacy | Evals and the session judge (`_shared/feedback-objectives.md`) — unchanged, never a size proxy | No |
| Coherence smell | `bloat.js` signals plus a corpus-relative size-outlier signal, filed by `/harness-health` | No |

**Principle:** a size limit blocks only where it guards a real platform limit. Every other size
concern is measured and made visible, never a cliff work races toward.

**Success:** `main` never goes red on skill size from concurrent merges; a limit changes only when
the platform's number changes, in one line; splitting a file earns no credit unless the split is
genuinely lazy.

## Non-goals

- A merge queue or required checks on `main`. That closes the whole byte-pinned merge-red class
  (reference card, changelog coverage), but it changes `_shared/pr-first-merge.md`'s synchronous
  `gh pr merge` path that every consumer's `/flow` and `/dispatch` rely on — an integration-model
  change, out of scope here.
- The CLAUDE.md line budget (`tests/claude-md-budget.test.js`) — a different artifact.
- `tests/design-wrapper-review-surface-gate-prose.test.js`'s 35 KB check — it proves a fixture
  discriminates prompt shape; it is not a skill-file ceiling.
- Declaring loads in a structured manifest, or parsing prose conditionality. Considered and
  rejected (see Alternatives).

## Platform facts (verified 2026-10-16, Claude Code 2.1.283 installed binary)

- **Read cap:** `yLr=25000` — a file over 25,000 tokens fails Read with "File content (N tokens)
  exceeds maximum allowed tokens (25000). Use offset and limit parameters…". Overridable per user
  via `CLAUDE_CODE_FILE_READ_MAX_OUTPUT_TOKENS`; the default is what the rail targets.
- **Skill listing budget:** `contextWindowTokens × 4 × skillListingBudgetFraction (0.01)`,
  overridable via `SLASH_COMMAND_TOOL_CHAR_BUDGET` — 8,000 chars at a 200k window, shared with
  every installed plugin's skills; overflow is tracked as `budgetTruncatedSkills`. Per-description
  max `skillListingMaxDescChars` defaults to 1,536.
- Largest shipped skill file today: 46,248 B (`dispatch/queue-pull-script.md`), ≈12k tokens.

## Design

### 1. `plugin/bin/lib/skill-audit/budgets.js` — the single source of truth

Exports, each with a comment naming its platform source and CLI version:

- `READ_TOKEN_CAP = 25000`
- `RAIL_TOKENS = Math.floor(0.8 * READ_TOKEN_CAP)`
- `BYTES_PER_TOKEN` — calibrated once, during the unit that adds this file, against the CLI's own
  counter: Read a deliberately oversized concatenation of the shipped skill corpus and take N from
  the error message; ratio = bytes / N, rounded down. Method, date, CLI version and the measured
  N recorded in the comment.
- `RAIL_BYTES = RAIL_TOKENS * BYTES_PER_TOKEN` (derived, never a literal)
- `DESCRIPTION_MAX_CHARS = 1536`
- `listingBudgetChars(contextTokens)` = `contextTokens * 4 * 0.01`

No other file in `plugin/` or `tests/` may hold a skill-size number; consumers import from here.

### 2. Rail check (`tests/bin-lib/skill-audit/context-cost.test.js`)

Hard assertions:
- every shipped `plugin/skills/**/*.md` file's `measuredBytes` ≤ `RAIL_BYTES`;
- every compose call site's maximum composed bundle ≤ `RAIL_BYTES` (a bundle is consumed by a
  single Read of `$PIPELINE_RUN_DIR/context/*.md`, so the Read cap binds it the same way);
- every skill description ≤ `DESCRIPTION_MAX_CHARS`.

Reported, never failing: total description characters against `listingBudgetChars(200000)`.

### 3. Load model — `plugin/bin/lib/skill-audit/load.js` and `plugin/bin/load-delta.js`

Per entry point (each `plugin/skills/*/SKILL.md`):

- **floor** = the `SKILL.md`'s `measuredBytes`;
- **closure** = floor + `measuredBytes` of every file reachable by citation, transitively,
  cycle-guarded, each file counted once;
- **files** = the closure's member list; **unresolved** = citations that could not be resolved.

A citation is a backticked `*.md` token, resolved in order against: the citing file's own
directory; `plugin/skills/_shared/`; `${CLAUDE_PLUGIN_ROOT}/skills/…` paths; and, when the
citation's line says "in that skill's directory" (or "in the … skill's directory"), the directory
of the nearest preceding `/claude-tweaks:{name}` token on the same line — no such token on the line
→ `unresolved`. Compose call sites contribute their source files.
A token that resolves nowhere goes to `unresolved` — never silently dropped, never counted as 0 B
(`parse-signal-discipline`).

`load-delta` compares HEAD against the merge-base with the integration branch, reading base files
via `git show <base>:<path>` (no checkout). Output per entry point whose floor or closure changed:
both values and both deltas, plus any new `unresolved` entries. No merge-base → status
`no-baseline`, never a zero delta. CLI follows the `gh-api-module-pattern` seam
(`run(argv, deps)`, injectable git runner).

A move-not-cut split reads honestly:

```
/build  floor   45.5 KB  (−10.1)
        closure 388.0 KB (+0.1)   ← split, not a cut
```

### 4. `/review` integration

When the reviewed diff touches the skill corpus (`corpusDir()`'s resolution: `plugin/skills/` or a
consumer's `skills/`), `/review`'s code-mode step runs `load-delta` and renders its table,
replacing today's ceiling-headroom prose. A project with no skill corpus gets a one-line
"no skill corpus — load delta skipped" note, not a silent skip. Non-blocking.

### 5. Coherence — `bloat.js` and `/harness-health`

`bloat.js` drops `overCeiling` / `headroom` and the `ceiling` parameter. It adds `sizeOutlier`:
a file whose bytes exceed the corpus's p95, computed over the corpus `auditCorpus` is given (so a
consumer project is judged against its own distribution). `_shared/harness-health-analysis.md`
and `harness-health/judge-procedure.md` are updated to weigh `sizeOutlier` as evidence with the
other three signals. This changes `/harness-health` findings for consumer projects — named in the
release note.

### 6. Transcript-measured load — `/harness-health`

A new read-only gatherer reuses `plugin/bin/lib/timing/transcript.js`'s parsing over recent
session transcripts (main and subagent). Per skill invocation: bytes of skill prose actually
loaded — the injected skill body plus `Read` calls on skill-corpus paths, attributed to the most
recent `Skill` invocation. Reports, per skill: median and max actual load, and the gap where
actual reads exceed the static closure (a citation the load model misses). No transcripts → `no
data`, never zero. Findings feed `/harness-health`'s existing record filing.

## Migration (expand-contract)

**Expand** (units A–D below) adds `budgets.js`, the rail, the load model, `sizeOutlier`, and the
transcript gatherer while `CEILING_BYTES` still exists.

**Contract** (unit E) migrates every consumer and removes:

- `CEILING_BYTES`, `WARN_RATIO`, `nearCeiling`, `overCeilingWarnings`, `headroom` in
  `context-cost.js`;
- `COMPOSED_STEP_EXCEPTIONS` and `overComposedCeiling` (folded into the rail check);
- `SPECIFY_SUBFILE_CEILING_BYTES` and its legacy exceptions; `STUB_CEILING_BYTES`; the inline
  `28 * 1024` pin in `tests/untrusted-record-content-conformance.test.js`;
- the `<= CEILING_BYTES` / `< CEILING_BYTES` size assertions in every conformance test that has
  one (content assertions in those tests stay);
- `DESCRIPTION_CEILING_CHARS` and `DESCRIPTION_TOTAL_CEILING_CHARS`;
- `plugin/bin/merge-size-probe.js`, `plugin/bin/lib/merge-size-probe.js`, their tests, and the
  probe step in `_shared/pr-checklist-refresh.md` — bin and prose ship together in one release,
  so no installed build has one without the other.

plan-audit's headroom check (`plugin/bin/lib/plan-audit/checks.js`, `build/plan-audit.md`)
retargets to `RAIL_BYTES`: flag a `Modify:` file within 10% of the rail.

**Prose sweep:** every hit of `CEILING_BYTES`, `51,200`, `50 KB`, `45 KB`, `40 KB`, `40,960`,
`merge-size-probe`, `ceiling-headroom`, and paraphrases ("byte ceiling", "composed-bytes ceiling")
across `plugin/`, `docs/`, and `tests/` — including `docs/donts.md` (the three ceiling rules),
`build/plan-authoring-checks.md`'s byte-pin check, `specify/decomposition-mode.md`'s
ceiling-headroom flag, `specify/collapse-decision.md`, `review/code-mode-steps.md`,
`review/focus-criterion-passes.md`, `backlog/refine-record.md`, `tidy/digest-sweep.md`,
`_shared/session-tmp-root.md`, `_shared/worktree-setup.md`'s "composed-bytes ceiling" reference,
and `docs/plugin-structure.md`. Each rule is rewritten to the new model or deleted, never left
citing a removed constant.

**Decision record:** `docs/decisions/{next-free}-skill-size-limits-guard-platform-limits-only.md`,
superseding #2020. `[IL-153]` in `docs/incident-log.md` gets a one-line pointer to it; its
history stays as written.

## Error handling

- Unresolvable citations: explicit `unresolved` list in every load report.
- No merge-base: `no-baseline` status.
- No transcripts: `no data` status.
- Calibration impossible at build time (CLI unavailable): the unit stops and reports; it never
  falls back to a guessed ratio.

## Testing

- Rail: a fixture over `RAIL_BYTES` must fail, proven by flipping the fixture under the rail and
  seeing green (red-then-green discrimination).
- `RAIL_BYTES` pinned to its derivation formula, not a literal.
- Load model fixture corpora: a move-not-cut split (floor drops, closure gains only the pointer
  line's bytes); a citation cycle; a cross-skill citation; an unresolvable citation.
- `load-delta`: injected git runner; `no-baseline` path; a changed `_shared` file showing up in
  every entry point whose closure contains it.
- `sizeOutlier`: fixture corpus with a known p95.
- Transcript gatherer: fixture transcripts (main + subagent), including an empty set.
- Negative sweep after unit E: no `CEILING_BYTES`, `merge-size-probe`, or retired constant name
  remains repo-wide (`git grep`, with the whitespace-spanning and paraphrase forms).

## Work units

| Unit | Scope | Depends on |
|---|---|---|
| A | `budgets.js` with calibration; rail check (files, bundles, descriptions); total-description report | — |
| B | `load.js`, `load-delta` CLI, `/review` code-mode integration | — |
| C | `bloat.js` `sizeOutlier`; `/harness-health` analysis + judge prose | — |
| D | Transcript-measured load gatherer in `/harness-health` | B (closure for the gap report) |
| E | Contract: plan-audit retarget, `merge-size-probe` retirement, removal of every constant and pin, prose sweep, decision record, `[IL-153]` pointer | A, B, C |

## Alternatives considered

- **Over-budget = frozen ratchet** (per-file budgets; a file over budget may not grow, judged
  against the merge-base). Compositional, but keeps a per-file budget as the unit — still rewards
  move-not-cut splits.
- **Merge queue.** Closes the whole merge-red class; out of scope (Non-goals).
- **Hard per-PR load-delta gate with an acknowledgment line.** Compositional, but adds a mid-flow
  stop `/flow` must handle in `auto` mode; rejected in favour of a visible, non-blocking delta.
- **Absolute per-entry-point load budgets.** Same non-compositional cliff in a different unit.
- **Declared load manifest** (`always` / `when:` per cited file). Precise, but a contract change
  across 39 skills plus a manifest↔prose twin that can drift.
- **Heuristic prose-conditionality parsing.** No contract change, but misclassifies; the
  floor/closure range is honest without it.

## Accepted trade-off

With no cliff, nothing forces a slim-down. Creep is stopped only by attention to `/review`'s
delta and `/harness-health`'s filed records. This is deliberate: the cliff's cost (merge-red,
ceiling-tax, fragmentation) was measured; the creep risk is the price, and the transcript
measure exists to make it visible.
