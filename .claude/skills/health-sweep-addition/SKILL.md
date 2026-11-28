---
name: health-sweep-addition
description: Use when adding a health sweep (a report-only audit skill that judges, dedups and files born-ready `by:{skill}` issues, as code-health, harness-health, journey-health, docs-health and ci-health do) or a new origin to the work-record origin vocabulary — every code, shared-contract, sibling-skill, doc and conformance-test site the sweep must land in, and which of them a test pins. Keywords - health sweep, origin, by:*, ORIGINS, ORIGIN_COLORS, label-bootstrap, health-filing-gate, health-issue-index, health-filing-parity, materiality-floor ADOPTERS, timing-nested-parent-roster, five health sweeps.
---

# Health sweep addition

A sweep is a skill plus a CLI plus a `by:` origin, and the origin and the sweep count are written into a long tail of files. #5757 (`ci-health`, the fifth sweep and seventh origin) touched about forty-five files outside the sweep itself, and each task found one more roster site only when a suite or a reviewer failed. This is the walk that finds them in one pass. The sweep's own design belongs to its spec; this lists where the existing family has to learn about it.

## Code sites

| # | Site | What to add | Pinned by |
|---|---|---|---|
| 1 | `ORIGINS` in `plugin/bin/lib/issues/record-vocabulary.js` | Append the origin. Never reorder: the first six keep their positions. | `tests/bin-lib/issues/record.test.js` AC9.1 reads `ORIGINS` against sites 4 and 5. |
| 2 | `ORIGIN_COLORS` in `plugin/bin/lib/record-graph/palette.js` | A hex colour. | `tests/bin-lib/record-graph/palette.test.js`, whose origin list is hand-typed: add the name there. |
| 3 | `expectsKeyFilesSection` and `extractKeyFiles` in `plugin/bin/lib/issues/grouping.js` | A `!hasOrigin(names, '{skill}')` clause, and an early `return []` in `extractKeyFiles` when the sweep's issue header does not lead with a file path (ci-health's leads with `**Check:**`, which the bold-header extraction would return as a path). | `tests/bin-lib/issues/grouping.test.js`: add a case beside the ci-health one. |
| 4 | `_shared/label-bootstrap.md` `LABELS_JSON` | A `["by:{skill}", "Origin: filed by the {skill} skill", "BFD4F2"]` row. | AC9.1. |
| 5 | `_shared/work-record.md` | The Origin row's `(N)` count and its label list, the Health-skills producer row, and the sentence naming which sweeps carry a body-metadata line. | AC9.1 pins the count and the list. |
| 6 | `_shared/work-record-permission-matrix.md` | The Health skills row's sweep list. | Unpinned. |
| 7 | A policy key, when the sweep has one | Walk `policy-key-addition`. It also bumps the count in `tests/policy-schema.test.js`. | `tests/policy-schema.test.js`. |

## Shared contracts that enumerate the sweeps

Each names the sweeps or counts them, so each needs the new row or a new count word: `_shared/health-filing-digest.md` (and its "Keeping the N copies in sync" heading), `health-filing-gate.md` (a row in its table; a sweep with no `mark` subcommand and no decline cache joins the "Dismiss drops the finding" exception), `health-finding-shapes.md` (the type-expression copy, and the bundling rule if the sweep has none), `health-issue-index.md`, `health-recent-commit-check.md` (its list of filing call sites), `health-verify-gate.md`, `materiality-floor.md`, `learning-routing.md`, and `github-pr-scan.md` (the scope intro, the `by:` query list, the stale-issue row, the `[gh-issue]` prefix line and two severity rows). `tests/sweep-backstop.test.js` pins the two severity rows by literal text.

## Sibling skills and docs that list the sweeps

`backlog/SKILL.md` (the pipeline diagram and the `--origin` filter list), `dispatch/SKILL.md` (diagram), `flow/materialize.md` (the `origin:` enum), `flow/multispec-conflict-detection.md`, `wrap-up/summary-template.md` (origin list), `wrap-up/claude-md-curation.md` (the stamping-sweep count: a sweep that stamps no `Verified-as-of` is named as the exception, not counted), `specify/shaping-mode.md` and `specify/decomposition-mode.md`, `tidy/SKILL.md` (the Step 4.8 row), `tidy/scan-procedures.md`, `tidy/step-1-records.md`, `sweep/SKILL.md` (its not-for-audits list), `init/bootstrap/step-17-work-record-backend.md`, `help/reference-card.md` and `help/context-flow.md`, `visualize/record-graph.md` (the Origin row and its palette-size wording), and the verify-gate sibling lists in `code-health/SKILL.md` and `journey-health/SKILL.md`. Docs: `README.md`, `docs/getting-started.md`, `docs/plugin-structure.md` (the bin line, the lib directory line, the sub-file table, the CLI commands and the suite command, the Utility list), `docs/skill-graph.md` (a section for the sweep, a row in every sibling's section, and the shared-contract rows), and the count words in `CLAUDE.md`.

## Conformance tests

- `tests/health-filing-parity.test.js`: add the SKILL.md to `SOURCES`. The Subject-check paragraph, the headless D5 exception and the Component-Skill Contract must be byte-identical across the sweeps, modulo the skill name, so copy them from a sibling.
- `tests/materiality-floor-conformance.test.js`: the SKILL.md joins `ADOPTERS` and the two sweep lists.
- `tests/timing-nested-parent-roster.test.js`: this scans the shared directories for `/claude-tweaks:{skill}` citations, so a sweep cited from `_shared/policy-schema.md` or a judge file needs an `ALLOWLIST` entry with its reason. It surfaced two tasks late in #5757 because impact selection did not pick it.
- `tests/gh-host-seam-conformance.test.js`: a library file that calls `gateOriginRepo` joins `ORIGIN_GATED`.
- `tests/bin-lib/skill-audit/anti-patterns.test.js`: the pinned total of Anti-Patterns rows across shipped skills changes. Re-derive it by running the test against the tree, and rewrite the `Last bump` line above the assertion; never add a delta to the old number.
- `tests/bin-lib/health-core/skill-md-house-checks.js`: the sweep's SKILL.md test consumes it rather than copying the checks.
- A scan suite that imports `tests/helpers/strip-comments.js` joins the caller list in that file's header and in `parse-signal-discipline`'s item on stripper callers.

## Decisions a sweep owes

1. **State or none.** The four older sweeps keep a cursor, cache and retry queue on `health-state`. `ci-health` keeps none: its issue index is its only memory, so `_shared/health-filing-mechanics.md` is deliberately not applied and its Dismiss drops the finding. Decide this first, because it picks which of the shared contracts above apply.
2. **Header shape.** If the issue header does not lead with a file path, site 3 must say so, or `extractKeyFiles` returns the header's first value as a path and the cross-spec overlap map gains a false entry.
3. **Stamping.** A sweep that writes no `Verified-as-of` line changes the "four stamping sweeps" wording in `claude-md-curation.md` and `work-record.md`.
4. **Neutrality.** A sweep that promises to be project-agnostic needs its own scan. `tests/ci-health-skill-agnostic.test.js` is the shape, and `bin-source-scan-conformance` covers how to write one.

## Finding the sites

Grep the most recent sibling's literals, then read each hit: `git grep -l -F 'by:docs-health' -- plugin docs tests`. Not every hit is a roster (`named-target.js`, the queue-pull fixtures and the trust tests name docs-health for their own reasons). Then grep the count words: `git grep -n -i -P '\b(three|four|five|six) (stamping )?health' -- plugin docs tests CLAUDE.md README.md`. A count that names only the state-keeping sweeps stays four; a count of every sweep moves.

## Anti-Patterns

| Pattern | Why It Fails |
|---|---|
| Registering the sweep in code and the skill, then running the suite to find the rest | The suites pin only some sites. #5757 found `timing-nested-parent-roster` two tasks late and the prose lists only at review. |
| Bumping "four" to "five" everywhere | Some counts name only the sweeps that keep `health-state` or stamp `Verified-as-of`, and the new sweep is the exception to them. |
