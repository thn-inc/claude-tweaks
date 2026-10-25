# release disposition has no route for design-decision-* staged files (#4156) Implementation Plan

**Goal:** `/claude-tweaks:release` Step 8's disposition (`plugin/skills/release/disposition.md`) hand-enumerates the staged-file prefixes a release-gate review produces and fails closed on anything else, so a `staged/design-decision-*.md` (staged by `/claude-tweaks:review` Step 6.5 through `design-wrapper/modes/review.md`) leaves the release run unarchived. Route it, and derive the inventory and routing from one roster of the review's staging producers that a test keeps honest.

**Spec:** `.claude-tweaks/pipelines/2026-10-25T112219-record-4156/work/4156-spec.md` (materialized from GitHub issue #4156)

**Premise re-verified at HEAD `4535906d`:** the gap is real, and it is wider than `design-decision-*`. Release Step 3 invokes `/claude-tweaks:review base:{base}` with `$PIPELINE_RUN_DIR` set, so review resolves to **full** mode (`review/SKILL.md` "Flow-context default"). In one release run review's own pass can therefore also stage `staged/visual-review-skipped.md` / `staged/visual-review-dev-url.md` (Step 6, `visual-review/SKILL.md`), and its Step 1.5 test gate can stage `staged/test-fix-{n}.patch` (`test/fix-mode.md`) and `staged/flaky-allowlist-{slug}.md` (`test/flake-handling.md`). None of them has a route today. A roster of "the review's staging producers" that left them out would be knowingly incomplete, so they are in scope as roster rows.

---

### Task 1: Review staging roster in disposition.md + roster-vs-routing test

**Files:**
- Modify: `plugin/skills/release/disposition.md`
- Modify: `docs/skill-graph.md` (the `/release` section's edge rows, lines ~455-467: the edges this roster adds)
- Test: `tests/release-run-dir-lifecycle-conformance.test.js`

**Design (follow exactly):**

1. **One roster in `disposition.md`.** Add a `### Review staging roster` subsection inside `## Inventory`. It is the only place a staged prefix is named. Columns: `Prefix | Example | Staged by | Counted as | Route`.
   - `Prefix` is a literal filename prefix in backticks. `review-{n}` is the one placeholder form: `review-` followed by a number.
   - `Staged by` is the producer's path relative to `plugin/skills/`, in backticks, plus the review step that reaches it.
   - `Route` is one value from the closed set `confirmed | unconfirmed | contested | proposal | note | not staged by review`.
   - Rows (match a file to the row with the **longest** matching prefix):

   | Prefix | Example | Staged by | Counted as | Route |
   |---|---|---|---|---|
   | `review-{n}` | `staged/review-{n}.{md,patch}` | `review/step3-routing.md` (Step 3; a critical lands here too, because the KEPT-PROMPT row stages a patch as well as surfacing it inline) | one confirmed finding per file, its severity read from the file's `Finding: {severity} {category} — …` line | `confirmed` |
   | `review-unconfirmed-` | `staged/review-unconfirmed-{n}.md` | `_shared/multi-agent-coordination.md` (Step 3 tiebreak) | one finding per entry line | `unconfirmed` |
   | `review-contested-` | `staged/review-contested-{n}.md` | `review/step3-debate-and-refutation.md` (Step 3) | one finding per file, both verdicts side by side | `contested` |
   | `review-debate-` | `staged/review-debate-{n}.md` | `_shared/multi-agent-coordination.md` (Step 3) | same | `contested` |
   | `reflect-` | `staged/reflect-{n}.md` | `reflect/SKILL.md` (Step 4's hindsight pass) | one finding per file | `proposal` |
   | `simplify-` | `staged/simplify-{n}.md` | `simplify/SKILL.md` (Step 5) | one finding per file | `proposal` |
   | `deepen-` | `staged/deepen-{n}.md`, `staged/deepen-collapse-{n}.patch` | `deepen/SKILL.md` (any deepen candidate list) | one finding per file | `proposal` |
   | `design-decision-` | `staged/design-decision-*.md` | `design-wrapper/modes/review.md` (Step 6.5) | one finding per file | `proposal` |
   | `test-fix-` | `staged/test-fix-{n}.patch` | `test/fix-mode.md` (Step 1.5's test gate) | one finding per file | `proposal` |
   | `flaky-allowlist-` | `staged/flaky-allowlist-{slug}.md` | `test/flake-handling.md` (Step 1.5's test gate) | one finding per file | `proposal` |
   | `visual-review-` | `staged/visual-review-skipped.md`, `staged/visual-review-dev-url.md` | `visual-review/SKILL.md` (Step 6's skip notes) | not a finding | `note` |
   | `wrap-up-reflect-` | `staged/wrap-up-reflect-insights.md` | `reflect/full-mode.md` (`--source wrap-up` only) | — | `not staged by review` |
   | `specify-redteam-` | `staged/specify-redteam-{n}.md` | `_shared/multi-agent-coordination.md` (`/claude-tweaks:specify`'s red team) | — | `not staged by review` |

   The last two rows exist because the test (step 4) scans whole producer directories. They are prefixes a producer *names* but never stages during a review pass. Such a file found in a release run's `staged/` is still unrecognised.

2. **The Inventory derives from the roster.** Replace the per-prefix bullets for `review-{n}`, `review-unconfirmed-`, `review-contested-`/`review-debate-`, and `reflect-*`/`simplify-*`/`deepen-*` with one sentence. It says every staged file is matched against the roster by its longest matching prefix and counted as that row's `Counted as` column says. Keep the `decisions.md`-only `STAGED` line bullet unchanged. Extend the opening exclusion sentence so that a `note` row's file is, like `release-held.md`, not a finding: it stays in `staged/` and is archived with the run. Keep the existing phrase `every file in it except \`release-held.md\`, which is not a finding` verbatim (it is pinned). Restate the fail-closed sentence: a file matching no roster row, or only a `not staged by review` row, is unrecognised and counts as a failure (below), so the run is not archived with a finding nobody read. Add one sentence: a producer that starts staging a new prefix adds its roster row in the same change, and `tests/release-run-dir-lifecycle-conformance.test.js` fails on a staged prefix with no row.

3. **The Routing table keys on the roster's Route column, never on prefixes.** Keep the existing rows' outcomes. Re-key them, with no other change in substance:
   - `Confirmed, any severity` → the `confirmed` route. Keep the existing Defer text verbatim, including `review/step3-routing.md`, `pre-existing-outside-diff`, `_shared/materiality-floor.md` and `Digest — below floor`.
   - `unconfirmed` critical/high → the same Defer. `unconfirmed` medium/low/info → `declined (unconfirmed: one reproduction agent of the pair)`.
   - `contested` critical/high in either verdict → the same Defer, both verdicts quoted. Otherwise → `declined (contested: {verdicts})`.
   - Replace the `reflect-*`/`simplify-*`/`deepen-*` row with **a file on a `proposal` roster row** → `The same Defer path and Defer-reason`. Keep the rest of that row verbatim: the materiality floor routes a small one to the digest, and severity is read from the file when it carries one, else treated as medium for the floor test. This is where `design-decision-*` gets the same Defer path as `reflect-*` (Deliverable 1).
   - Keep `Any other staged file | No route…` and the covering-record row unchanged. The covering-record row still wins over every other row.

4. **Test — roster-vs-routing (Deliverable 3, both ACs).** Add a new section to `tests/release-run-dir-lifecycle-conformance.test.js` with pure helpers and tests:
   - `parseRoster(text)` reads the `### Review staging roster` table out of `disposition.md` into `[{prefix, stagedBy, route}]`. It throws on a missing heading, an empty table, or a Route outside the closed set. A parse failure must be distinguishable from "parsed to zero rows" (parse-signal-discipline).
   - `classify(fileName, roster)` → the matching row (longest prefix; `review-{n}` means `/^review-\d/`), or `null`.
   - `stagedNamesIn(text)` → every `staged/{name}` literal (regex over `staged/` followed by a name starting with a letter). Normalize placeholders (`{n}`/`{N}`/`{slug}` → `1`, `*` → `x`), drop a trailing `.` and expand `{md,patch}` to one form.
   - **AC1 test:** `classify('design-decision-1.md', roster).route === 'proposal'`, and the Routing table has the `proposal` row carrying `The same Defer path and Defer-reason`. Also pin `review-3.patch` → `confirmed`, `review-unconfirmed-2.md` → `unconfirmed`, `review-debate-1.md` → `contested`, `visual-review-skipped.md` → `note`, and `brand-new-1.md` → `null`.
   - **Roster-vs-routing test:** the corpus is every `.md` under `plugin/skills/review/`, plus every `.md` in each **skill directory** a roster row's `Staged by` names (`reflect/`, `simplify/`, `deepen/`, `design-wrapper/`, `test/`, `visual-review/`), plus each named `_shared/*.md` **file** (not all of `_shared/`). Every `staged/{name}` literal in that corpus must classify to a roster row. Every roster row whose route is not `not staged by review` must have its route keyed in the Routing table or, for `note`, in the Inventory's exclusion sentence. Every roster row's own `Staged by` file must actually name a `staged/` literal that classifies to that row, so a stale row goes red too.
   - **Go-red proofs**, with the helpers run on in-memory mutations of the live text. Append a fake `staged/brand-new-{n}.md` to one corpus file's text → the check reports `brand-new-1.md`. Delete the `design-decision-` roster row from the disposition text → `design-wrapper/modes/review.md`'s `staged/design-decision-*.md` is reported unrouted. Change a row's route to an unknown word → `parseRoster` throws.
   - **Update the existing pins** this rewrite moves: `DISPOSITION_SCOPE`'s `` `staged/reflect-*`, `staged/simplify-*` and `staged/deepen-*` `` pattern and `DISPOSITION_ROUTING`'s `` `reflect-*`, `simplify-*` or `deepen-*` file | The same Defer path `` pattern. Each must still pin a fact with a go-red: the roster rows for those three prefixes routed `proposal`, and the `proposal` routing row. The other pins should keep matching. If one doesn't, change the prose back rather than the pin, unless the pinned fact itself changed.

5. **`docs/skill-graph.md`:** in the `/release` section, update the `review/code-mode-steps.md` row (Steps 4-5's `reflect-*`/`simplify-*`) to point at the roster. Add an edge row for each new producer target the roster names (`design-wrapper/modes/review.md`, `visual-review/SKILL.md`, `test/fix-mode.md` + `test/flake-handling.md`), one clause each, in the existing rows' style. Do not restate edges elsewhere.

- [ ] **Step 1: Failing test** — add the step-4 tests. Run `node --test tests/release-run-dir-lifecycle-conformance.test.js` and expect FAIL: no roster section yet, and `design-decision-` is unrouted. Before changing `disposition.md`, write a characterization check of the pre-existing routing outcomes. Every existing `DISPOSITION_*` pin passes on the current text, and those pins are the characterization. Confirm they all pass first.
- [ ] **Step 2: Implement** — the `disposition.md` roster, Inventory and Routing rewrite (design 1-3), the pin updates (design 4, last bullet) and the skill-graph rows (design 5).
- [ ] **Step 3: Run** `node --test tests/release-run-dir-lifecycle-conformance.test.js` → PASS. Also run `node --test tests/bin-lib/skill-audit/` for the skill-size and anti-pattern audits over the edited skill file, plus any test that pins `docs/skill-graph.md`: find them with `grep -rl "skill-graph" tests`. Prove discrimination by reverting the `design-decision-` roster row and watching the AC1 test go red.
- [ ] **Step 4: Commit** — one commit: `Route design-decision-* and every review staging prefix through one roster in release disposition — refs #4156`.

---

## Self-review

- **Spec coverage:** Deliverable 1 is the roster row `design-decision-` → `proposal` → the reflect Defer path. Deliverable 2 is the one roster, with Inventory and Routing keyed on it. Deliverable 3 is the roster-vs-routing test. AC1 is the `classify('design-decision-1.md')` test. AC2 is the go-red proof that a fake producer prefix is reported. AC3 (`npm test` passes) is checked at Common Step 5.
- **Placeholders:** none.
