# resolve-run-dir --spec-slug matches by substring, so spec-378 adopts a spec-3784 run (#3865) Implementation Plan

**Goal:** `newestMatch` in `plugin/bin/lib/hooks/run-dir-resolve.js` picks the newest run dir whose name `includes(specSlug)`, so `resolve-run-dir --spec-slug "spec-378"` also matches a `…-spec-3784` dir — make it match the slug as a whole name segment instead.

**Spec:** `.claude-tweaks/pipelines/2026-10-22T153351-record-3865/work/3865-spec.md` (materialized from GitHub issue #3865)

---

### Task 1: Match the spec slug as a whole name segment in `newestMatch`

**Files:**
- Modify: `plugin/bin/lib/hooks/run-dir-resolve.js`
- Test: `tests/hooks-run-dir-resolve.test.js`

- [ ] **Step 1: Failing test** — add a regression test to `tests/hooks-run-dir-resolve.test.js` where `2026-…-spec-378` and a newer `2026-…-spec-3784` (plus a newer multi-spec `2026-…-spec-3784-3790`) run dirs coexist: `resolve({ specSlug: 'spec-378' })` returns the `spec-378` dir and `resolve({ specSlug: 'spec-3784' })` returns the newest `spec-3784`-token dir; a `spec-378`-only fixture with no own dir resolves `ok: false` rather than adopting `spec-3784`.
- [ ] **Step 2: Implement** — replace `e.name.includes(specSlug)` with a whole-segment match: the slug must occur in the run-dir name bounded on the left by `-` (or start of name) and on the right by `-` or end of name — the run id's trailing `-{slug}` or a delimited token, never a substring. Update `newestMatch`'s header comment to state the divergence from the reference snippet's `*${SPEC_SLUG}*` glob.
- [ ] **Step 3: Run** `node --test tests/hooks-run-dir-resolve.test.js tests/hooks-resolve-run-dir-cli.test.js tests/hooks-archive-terminal.test.js tests/pipeline-run-dir-adoption-anchoring.test.js` — PASS.
- [ ] **Step 4: Commit** — one commit, message drawn from the spec title, `refs #3865`.

---

## Self-review

- **Spec coverage:** Deliverable 1 (whole-segment `newestMatch`) → Step 2; Deliverable 2 (coexisting `spec-378`/`spec-3784` regression test) → Step 1; AC 1 (`spec-378` never returns a `spec-3784` dir) → Step 1's assertions; AC 2 (every existing `run-dir-resolve` test still passes) → Step 3.
- **Placeholders:** none.
