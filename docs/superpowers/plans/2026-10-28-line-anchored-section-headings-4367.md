# Match a record section heading only when it starts its own line (#4367) Implementation Plan

**Goal:** `sectionText` (`plugin/bin/lib/issues/materialize-format.js`) stops locating a section with a substring search (`body.indexOf('## ' + name)`), so a mid-line mention of a required heading — inline code, a blockquote, prose — or a longer heading (`## Release Notes`) no longer satisfies the shape gate.

**Spec:** `.claude-tweaks/pipelines/2026-10-28T121855-record-4367/work/4367-spec.md` (materialized from GitHub issue #4367)

**Approach:** one heading rule for both readers. `extractSection` (`plugin/bin/lib/issues/record-payload.js`) already matches line-anchored whole-text headings outside fences (`^#{level}[ \t]+{heading}[ \t]*$`, CRLF-normalized). Factor its body into an exported `findSection(body, heading, opts)` that returns `null` when the heading is absent (and the section text otherwise); `extractSection` becomes `findSection(...) ?? ''` (its return shape and every caller unchanged). `sectionText(body, name)` becomes `findSection(body, name, { levelPattern: '2', stopPattern: '2', trim: true })` — level-2 heading only, stops at the next level-2 heading outside a fence, as today, and keeps its `null`-when-absent contract that `compose-record/compose.js` relies on (missing vs empty).

---

### Task 1: Make sectionText match line-anchored, whole-name headings via the shared extractSection rule

**Files:**
- Modify: `plugin/bin/lib/issues/record-payload.js` (add and export `findSection`; `extractSection` delegates to it)
- Modify: `plugin/bin/lib/issues/materialize-format.js` (`sectionText` delegates to `findSection`; drop its own substring/inFence scan)
- Test: `tests/bin-lib/issues/materialize-format.test.js`

- [ ] **Step 1: Failing test** — add to `tests/bin-lib/issues/materialize-format.test.js`:
  - `shapeGate` on a body whose only Acceptance Criteria / Release Note mention is inline code in Current State (e.g. ``Mentions the `## Acceptance Criteria` and `## Release Note` headings.``) reports both `Acceptance Criteria` and `Release Note` missing (AC1).
  - the same with the mention on a blockquote line (`> ## Acceptance Criteria`) reports Acceptance Criteria missing.
  - a body with `## Release Notes` and no `## Release Note` heading reports `Release Note` missing (AC2); `sectionText(body, 'Release Note')` is `null`.
  - `sectionText` and `extractSection(body, name, { levelPattern: '2', stopPattern: '2', trim: true })` agree (present/absent and text) on those bodies and on `SHAPED_BODY`.
  - Run: `node --test tests/bin-lib/issues/materialize-format.test.js` — Expected: FAIL (the new cases).
- [ ] **Step 2: Implement** — satisfy every `## Deliverables` checkbox against the files above.
- [ ] **Step 3: Run** `node --test tests/bin-lib/issues/materialize-format.test.js` — PASS; existing `sectionText`/`shapeGate` cases (incl. #4169 fence and CRLF cases) stay green (AC3).
- [ ] **Step 4: Commit** — one commit, `Match a record section heading only when it starts its own line — refs #4367`.

---

## Self-review

- **Spec coverage:** Deliverable 1 (line-anchored whole-name heading outside fences) and Deliverable 2 (`extractSection`/`sectionText` agree) are Step 2's shared `findSection`; Deliverable 3 and AC1-AC3 are Step 1's tests; AC4 (`npm test`) is `/build` Common Step 5.
- **Placeholders:** none.
