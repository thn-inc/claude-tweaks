# Keep tidy's open-parent [parent-gate] rows when the gh api user lookup fails (#4801) Implementation Plan

**Goal:** Tidy's `parent-gate` fetch block in `plugin/skills/_shared/github-pr-scan-acceptance.md` stops throwing on an empty `gh api user` login, so a token that cannot read `/user` keeps every open-parent `[parent-gate]` row.

**Spec:** `.claude-tweaks/pipelines/2026-11-01T212615-spec-4801/work/4801-spec.md` (materialized from GitHub issue #4801)

---

### Task 1: Degrade a failed or empty login to trusted-author close-marker matching, with a WARNING line

**Files:**
- Modify: `plugin/skills/_shared/github-pr-scan-acceptance.md` — the parent-gate fetch block's `node -e` script (the line that throws `gh api user returned no login`) and the "When this block fails" paragraph below the fence, which names the empty-login guard as a stop cause
- Test: `tests/closed-parent-acceptance-backstop.test.js` — rewrite the AC2.1 empty-login test (it pins today's throw); never delete it

- [ ] **Step 1: Failing test** — rewrite `AC2.1: the parent-gate fetch block stops, writing no parents, when the gh login is empty` into a test asserting that with an empty login file (`runFetchBlock('')`) the block exits 0 and writes the parents file; the open parents (#10, #18) and the in-window closed parents are all present (same set as the AC1.1 non-empty case); `belowFloorClose` is true only for the trusted (`MEMBER`) marker on #11, and false for #17's `NONE`-association marker, which only an identity match could have recognised; and stderr carries one `WARNING:` line containing `parent-gate.js`'s exported `IDENTITY_PROBE_FAILED_NOTE` (`identity probe failed — close marker matched against trusted authors only`). Keep the existing non-empty-login AC1.1 case unchanged. Run it: FAIL (the block still throws).
- [ ] **Step 2: Implement** — in the fetch block's script, remove the `if (!login) throw …` line; when `login` is empty, `console.error` one `WARNING:` line built from `IDENTITY_PROBE_FAILED_NOTE`, required from `${CLAUDE_PLUGIN_ROOT}/bin/lib/issues/parent-gate.js` beside the existing `isCloseMarkerComment` require, naming the cause (`gh api user` printed no login, so a marker posted by the current identity under an untrusted association reads as absent) and that open-parent rows are unaffected. `isCloseMarkerComment(c, '')` already matches trusted authors only, so the mapping line needs no change. A failed `gh api user` already leaves the redirect target empty, so the shell line needs no change either. In the "When this block fails" paragraph, drop the empty-login guard from the stop causes and add one sentence: an empty login is not a stop; the scope runs with trusted-author close-marker matching and reports the WARNING verbatim with its rows, which the "Report every warning emitted above verbatim" paragraph already requires.
- [ ] **Step 3: Run** the test file from Step 1, plus every test that reads `github-pr-scan-acceptance.md` (`tests/acceptance-scan-server-filter.test.js`, `tests/skill-fence-guard-shapes.test.js`, `tests/fetch-sub-issues-prose-conformance.test.js`, `tests/tidy-scan-dispatch-conformance.test.js`, `tests/below-floor-parent-close-conformance.test.js`, `tests/session-tmp-root-migration.test.js`) — PASS.
- [ ] **Step 4: Commit** — one commit, message drawn from the spec title, `refs #4801`.

---

## Self-review

- **Spec coverage:** Deliverable 1 (a failed or empty login degrades only close-marker recognition) and Deliverable 2 (open-parent rows kept, WARNING naming the failure) are Step 2; the Acceptance Criterion (a fixture test with an empty login still produces the open-parent rows and a warning) is Step 1; `npm test` passes is Common Step 5's verification.
- **Placeholders:** none.
- **#4770 coordination:** #4770 merged first (`51355951f`), so this run, landing second, compares wordings: the WARNING quotes `IDENTITY_PROBE_FAILED_NOTE` directly, so the scan and the parent-gate core state one rule in one string.
