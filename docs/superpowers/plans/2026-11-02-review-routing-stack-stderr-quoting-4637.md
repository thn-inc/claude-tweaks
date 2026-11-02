# Quote --stack-stderr on the review-routing-line call: raw git stderr can break out of the single quote (#4637) Implementation Plan

**Goal:** The `'\''` quoting rule in `plugin/skills/review/step3-routing.md` names only `--category` and `--at`, but `--stack-stderr` carries raw git stderr, so a repo-controlled path holding `'` closes the quote and the rest of the value runs as shell. Extend the rule to cover it.

**Spec:** `.claude-tweaks/pipelines/2026-11-02T094624-record-4637/work/4637-spec.md` (materialized from GitHub issue #4637)

---

### Task 1: Extend the single-quote rule to --stack-stderr, with a regression test

**Files:**
Modify: `plugin/skills/review/step3-routing.md`
Test: `tests/review-routing-line-prose-conformance.test.js`

- [ ] **Step 1: Failing test** — add to `tests/review-routing-line-prose-conformance.test.js`: (a) the rule paragraph (the line starting `The composer writes each`) names `--stack-stderr` alongside `--category` and `--at` as single-quoted with `'` written as `'\''`; (b) a raw stderr line holding `'` and `$(...)`, escaped by that rule and passed through a real POSIX shell, comes back byte-identical and runs nothing, and the same value reaches the logged STAGED line verbatim through `run()`. Run it before Step 2: (a) must be red at base.
- [ ] **Step 2: Implement** — in `plugin/skills/review/step3-routing.md`, widen the rule paragraph to `--stack-stderr` with its reason (raw git stderr can quote a repo-controlled path; an unescaped `'` closes the quote and the rest runs as shell). Keep the `--stack-stderr '{first stderr line}'` spans on the "Staging a patch" paragraph unchanged, since `stackedOutcomeFlags` reads them.
- [ ] **Step 3: Run** `node --test tests/review-routing-line-prose-conformance.test.js` — PASS.
- [ ] **Step 4: Commit** — one commit, message drawn from the spec title, `refs #4637`.

---

## Self-review

- **Spec coverage:** every `## Deliverables` item and every `## Acceptance Criteria` item is covered by Task 1's Files/Steps above. The other values on the call are not free text: `--conflict`, `--conflicts-with` and `--rederived-onto` must name staged patches, and `--commit` is a sha.
- **Placeholders:** none.
