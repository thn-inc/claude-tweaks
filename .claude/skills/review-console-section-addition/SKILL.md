---
name: review-console-section-addition
description: Use when adding a section to the Wrap-Up Review Console, moving a staged-id prefix into a different section, or changing a section's default (its stance) — every code and prose site the section must land in so the unattended resolver, the interactive render, the multi-spec render and the approval executor agree, and which of those sites a test pins. Keywords - Review Console, console section, SECTIONS, SECTION_MAP, CANONICAL_PREFIXES, SECTION_STANCES, ENGINE_ROW_SECTIONS, SECTION_SPECS, console-template, Resolution-to-step mapping, staged prefix, stance.
---

# Review Console section addition

`plugin/skills/wrap-up/review-console.md` owns what the console does. This skill owns the build procedure for adding a section, or moving a prefix between sections: every site the change must land in. #3926 (`Reflection insights`) landed the code sites and the appendix mapping in its build and missed the interactive render (sites 8 and 9 below) until its final whole-branch review, and the PR render (site 9a) until the run's ledger gate.

## The registration set

A section is not shipped until every applicable row lands in the same change. Sites 1–5 are in code; 6–11 are prose.

| # | Site | What to add | Pinned by |
|---|---|---|---|
| 1 | `SECTIONS` in `plugin/bin/lib/console/resolve.js` | The section name exactly as the console renders it. | The source every other site keys on. |
| 2 | `SECTION_MAP` in the same file | A row routing the section's staged-id prefix(es). Rows are ordered and the first match wins, so no earlier, broader row may catch the prefix. An optional third element (a reason) resolves every match to `pending` whatever the stance. | `tests/bin-lib/console/resolve.test.js`'s "classifyStagedItem maps every known prefix" table — hand-typed, so add a case for the new prefix. |
| 2a | `SHADOW_DUP_OUTCOMES` in the same file | Only for a section a `.shadow-dup` outcome feeds: that outcome's `section`. `classifyStagedItem` matches the `SHADOW_DUP_RE` suffix before any `SECTION_MAP` row, so these items never reach sites 2–3. | `resolve.test.js`'s AC4.1 tests, one per outcome. |
| 3 | `CANONICAL_PREFIXES` in the same file | Every alternative of the new row, with its trailing `-` (a `(-\|\b)` row still lists the `-` form). `stage-item.js`'s unmapped-prefix refusal suggests from this list. | The #3370 tests in `resolve.test.js` expand each row's regex and fail on a missing alternative. |
| 4 | `SECTION_STANCES` in the same file | `{ resolution, reason }` — the default `consoleAutoResolve` applies under `unattended`. | "SECTION_STANCES names a stance for every section the console renders" — its section list is hand-typed, not read from `SECTIONS`, so add the name there too or a missing stance stays green. |
| 5 | `ENGINE_ROW_SECTIONS` (resolve.js) and `SECTION_SPECS` (`plugin/bin/lib/wrap-up/engine-render.js`) | Only for a section a curation registry row feeds. | "every ENGINE_ROW_SECTIONS row classifies a staged finding into its own console section". |
| 6 | `plugin/skills/wrap-up/review-console.md` "On approval" | The numbered step that executes an approved row. | Unpinned. |
| 7 | `plugin/skills/wrap-up/review-console-appendix.md` Resolution-to-step mapping | The section under its resolution's bullet (`approve`, `apply`, `filed`, …) with site 6's step number, so no resolved row is unrouted. | Per section only: the `Reflection insights` → step 10 test covers that one section, so a new section needs its own. |
| 8 | `plugin/skills/wrap-up/console-template.md` | A `#### {Section} ({default})` heading with its table, and the section in the "Every section below" sentence under the console heading. | The heading: `tests/reflect-wrap-up-insights-staging-conformance.test.js`'s "console-template.md renders a #### heading for every section console-resolve.js names" reads `SECTIONS`, so a missing heading goes red. The "Every section below" sentence is unpinned. |
| 9 | `plugin/skills/wrap-up/review-console-interactive.md` Numbering rules | Whether the section's rows join the global `#N` sequence or carry their own prefix (`Q#`/`M#`/`U#`/`R#`). | Per section only: the `R#` test in the same file covers Reflection insights, so a new per-item section needs its own. |
| 9a | `plugin/skills/_shared/console-on-pr.md` Item ID scheme | A `{kind}` for a per-item section (`q`, `m`, `u`, `r`), so the PR-rendered console can tick its rows. | Unpinned. |
| 10 | `plugin/skills/flow/multispec-console-template.md`, plus `flow/multispec-review-console.md`'s step-2 read list and its Canonical render order | The multi-spec console's own heading, when a multi-spec run can stage the section's prefix, and the section in both of that file's lists — engine-rendered or not (#3946's `Dismissed duplicates` is not). | Per section only: `tests/console-shadow-dup-outcomes-conformance.test.js` pins `Dismissed duplicates`' heading and both lists, and `tests/reflect-wrap-up-insights-staging-conformance.test.js` pins `Reflection insights`' heading, both lists and its `R#` handling (#4063), so a new section needs its own. |
| 11 | `plugin/skills/wrap-up/SKILL.md`'s Review Console paragraph | Only for a named batch section: its parenthesized section list. | Unpinned. |

**A new prefix in an existing section is a smaller change.** The section, its stance and its templates already exist, so only sites 2 and 3 move, plus the known-prefix case in `resolve.test.js`. #4029 added `efficiency-budget-` to the Queue writes row that way: two lines in `resolve.js` and one in the test.

Find the prose sites by grep rather than from this table alone: `git grep -l -F 'Reference repairs' -- plugin docs tests` lists every file that enumerates the sections. Add the new section to each hit that lists its siblings.

## Decisions each section owes

1. **Batch or per-item?** A batch section's rows share the global `#N` sequence and resolve under Approve all to the section default. A per-item section (`Q#`/`M#`/`U#`) is drilled under Override through `_shared/batched-item-drill.md` or `_shared/upstream-feedback-batch.md`. Site 9 states the choice; sites 4 and 8 must agree with it.
2. **Same default in both renders.** The stance (site 4) is what `unattended` applies; the heading's parenthetical (site 8) is what a human is told Approve all does. Word them as one default.
3. **Does a prefix move?** When the section takes a prefix another row matched (`wrap-up-reflect-insights` moved from Queue writes in #3926), delete the old `SECTION_MAP` row or alternative and its `CANONICAL_PREFIXES` entry in the same change, then grep `plugin/skills/` for the staged filename to find prose that still names the old section.

## Pinning the unpinned sites

Sites 6, 9a and 11, site 10 for every section but `Dismissed duplicates` and `Reflection insights`, and the template's "Every section below" sentence, are prose with no pin, which is how a section ships half-rendered with every suite green. When you touch them, prefer adding the pin to relying on this list. The site 8 heading test (it reads `SECTIONS` rather than a hand-typed list) is the shape to copy. Build the test and its go-red control the way `prose-code-twin-pin` and `skill-prose-conformance-tests` describe.
