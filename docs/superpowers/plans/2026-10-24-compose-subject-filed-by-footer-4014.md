# compose-subject renders the record's "Filed by" footer as part of the release note (#4014) Implementation Plan

**Goal:** `compose-subject.js` stops reading a `specShapedBody` record's trailing `_Filed by … _` footer paragraph as part of its `## Release Note` section, so the squash body's `Release-Note:` line carries only the note.

**Spec:** `.claude-tweaks/pipelines/2026-10-24T210356-record-4014/work/4014-spec.md` (materialized from GitHub issue #4014)

---

### Task 1: Exclude the trailing "Filed by" footer from compose-subject's release note

**Files:**
- Modify: `plugin/bin/lib/compose-subject.js`
- Test: `tests/bin-lib/compose-subject.test.js`

Context for the implementer:
- `plugin/bin/lib/compose-subject.js` binds a local `extractSection(body, heading)` (h2-only, stop-at-next-h2, trimmed). It reads the release note at two sites inside `run()`: the "non-empty `## Release Note`" gate (`records.filter((r) => !extractSection(r.body, 'Release Note'))`) and the rendered value (`const releaseNote = extractSection(subjectRecord.body, 'Release Note');`).
- `specShapedBody` (`plugin/bin/lib/issues/record-payload.js`) emits its footer as the body's last paragraph, after `## Release Note` when there is no `### Key Files` (so no heading follows the note). Two footer shapes exist in the codebase, both an italic paragraph starting `_Filed by `: `` _Filed by `{producer}` via specShapedBody._ `` and `` _Filed by `{x}`. Close to resolve; label `wontfix` to suppress future reports of this finding._ ``.
- Do NOT change `extractSection`'s heading-bounded contract (it is re-exported and used for Overview/Current State/Breaking Change too, and the shared `issues/record.js` `extractSection` has other callers). Add a dedicated release-note reader in `compose-subject.js` instead, e.g. `releaseNoteOf(body)`: take `extractSection(body, 'Release Note')`, cut it at the first line that starts a `_Filed by ` footer (a line matching something like `/^_Filed by\b.*_[ \t]*$/m`), and trim the result. Use it at BOTH release-note sites so a section holding only a footer counts as empty for the gate, the same as it renders. Export it alongside the other helpers if the test wants to call it directly.

- [ ] **Step 1: Failing test** — in `tests/bin-lib/compose-subject.test.js`, add a record fixture (follow the existing `RECORDS`-map fixture style at the top of the file, a new unused number) whose body ends `## Release Note\n\n{note}\n\n_Filed by \`x\` via specShapedBody._` with no `### Key Files`, plus a test that runs the CLI on it via the existing `fakeDeps` helper and asserts the composed body contains `Release-Note: {note}` and does not contain `_Filed by`. Also cover the second footer shape (`_Filed by \`x\`. Close to resolve; label \`wontfix\` to suppress future reports of this finding._`) in the same or a sibling assertion. Run it and confirm it FAILS against the current code.
- [ ] **Step 2: Implement** — add the dedicated release-note reader in `plugin/bin/lib/compose-subject.js` as described above and route both release-note reads through it.
- [ ] **Step 3: Run** `node --test tests/bin-lib/compose-subject.test.js` and the merge-subject-composer conformance suite (`git grep -l merge-subject-composer -- tests` to locate it, then `node --test` that file) — all PASS.
- [ ] **Step 4: Commit** — one commit, `Exclude the "Filed by" footer from compose-subject's release note — stop the section at the footer line`, body `refs #4014`.

---

## Self-review

- **Spec coverage:** Deliverable 1 (release note excludes the trailing `_Filed by …_` footer, via a dedicated reader in compose-subject, `extractSection` untouched) → Task 1 Step 2. Deliverable 2 (test with a specShapedBody body, no Key Files, footer absent from output) → Step 1. AC 1 (`Release-Note: {note}` and no `_Filed by` text) → Step 1's assertions. AC 2 (existing compose-subject and merge-subject-composer conformance tests still pass) → Step 3.
- **Placeholders:** none.
