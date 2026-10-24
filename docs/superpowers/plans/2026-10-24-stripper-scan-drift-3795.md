# Fix the pre-existing stripper-scan drift found during record 3773's review (#3795) Implementation Plan

**Goal:** Fix four pieces of stripper-scan drift that predate record 3773: a missing planted mis-parse case in the path-containment scan, a stale scan list and over-broad claim in the parse-signal-discipline skill's item 15, a branch-only sha citation in that skill, and the scan list in the shared stripper helper's header.

**Spec:** `.claude-tweaks/pipelines/2026-10-24T061140-record-3795/work/3795-spec.md` (materialized from GitHub issue #3795)

**Build-time corrections to the spec (verified against this checkout):**
- The `a7790fbed` citation now sits at line 242 of `.claude/skills/parse-signal-discipline/SKILL.md` (item 12), not line 224. `a7790fbed` is reachable only from `origin/worktree-record-3023`; the squash commit on main is `5c8e2a2e0` (#3023), which carries the `close-run-state.js` `worktreeAtClose` change.
- `tests/helpers/strip-comments.js`'s header already names path-containment (added by #3491). It does not name every scan that calls the helper today. Eight conformance scans call it: windows-hide (`tests/windows-hide-spawn-conformance.test.js`), git-status (`tests/git-status-optional-locks.test.js`), path-guard (`tests/path-guard-conformance.test.js`), path-containment (`tests/path-containment-conformance.test.js`), porcelain-cwd-compare (`tests/porcelain-cwd-compare-conformance.test.js`), staged-id producers (`tests/bin-lib/console/staged-id-producers.test.js`), exit-code (`tests/bin-lib/exit-code-conformance.test.js`) and wall-clock-budget (`tests/wall-clock-budget-conformance.test.js`, `literals: 'blank'` mode). All but exit-code report `stripperVerdict`'s `misparsed`/`unparseable` as an offender; exit-code calls only `stripComments` and reports a blanked `require.main` guard through its own `guardBlankedByStripper(raw, stripped)`. (`tests/hooks-harness-refusal.test.js` also asserts `stripperVerdict(...) === 'ok'` over two named hook files, but it is a literal-spelling check, not a tree scan.)

---

### Task 1: Add the path-containment planted mis-parse case and correct the stripper-scan prose

**Files:**
- Test: `tests/path-containment-conformance.test.js`
- Modify: `tests/helpers/strip-comments.js` (header comment only — no code change)
- Modify: `.claude/skills/parse-signal-discipline/SKILL.md`

- [ ] **Step 1: Failing test** — in `tests/path-containment-conformance.test.js`:
  - Give `scanBinTree(scan)` an optional second parameter, `entries = binSources()`, and iterate `entries` instead of calling `binSources()` inside the loop. The three real-tree callers stay unchanged.
  - Add one test, named like the sibling scans' (e.g. `'a comment-stripper mis-parse is reported, not passed as a file with no hits'`), that plants one file whose stripped text no longer compiles — reuse the path-guard scan's documented fixture shape, `'if (b) /"/.test(b); const c = "//"; fs.existsSync(c);'`, or an equivalent regex-after-`)` shape that also contains a `startsWith(...)` line the stripper blanks — as `{ rel: 'plugin/bin/lib/planted.js', raw: ... }`, and asserts that BOTH `scanBinTree(scanHandRolled, [planted])` and `assertNoRelDotDot([planted])` throw with a message that names `plugin/bin/lib/planted.js` and contains `STRIPPER_VERDICT_MESSAGES.misparsed` (match the message text, not just "throws"). Confirm with `stripperVerdict(planted.raw) === 'misparsed'` as a precondition assertion inside the test so a future stripper fix that makes the fixture parse cleanly fails loudly rather than silently passing.
  - Discrimination: in a scratch copy (never by editing and restoring the shared worktree file), remove the `assert.equal(verdict, 'ok', …)` line from `scanBinTree` and from `assertNoRelDotDot` and confirm the new test FAILS; then confirm it PASSES with them present.
- [ ] **Step 2: Implement** —
  - `tests/helpers/strip-comments.js` header (lines 3-6): rewrite the scan list so it names all eight scans listed above, keeping the `#3491` / `literals: 'blank'` note for wall-clock-budget. Comment-only edit; keep the rest of the header byte-identical.
  - `.claude/skills/parse-signal-discipline/SKILL.md` item 12: replace `` `a7790fbed` `` with `` `5c8e2a2e0` (#3023) ``-style citation — the squash commit — keeping the sentence otherwise intact.
  - `.claude/skills/parse-signal-discipline/SKILL.md` item 15: (a) replace "before the path-guard, windows-hide, git-status and exit-code conformance scans count tokens" with wording that names the eight scans (or points at the helper header's list, if naming all eight inline reads badly — but the item must not undercount them); (b) replace "Each scan reports either one as an offender." with a sentence that is true: every scan except exit-code reports `stripperVerdict`'s `misparsed`/`unparseable` as an offender, while the exit-code scan never calls `stripperVerdict` and instead reports a `require.main` guard the stripper blanked through its own `guardBlankedByStripper` detector. Keep item 15's remaining sentences unchanged. Keep the edit tight — this repo's skill prose avoids narrative padding.
- [ ] **Step 3: Run** — `node --test tests/path-containment-conformance.test.js tests/helpers-strip-comments.test.js` — PASS. Then `grep -n a7790fbed .claude/skills/parse-signal-discipline/SKILL.md` prints nothing. Then run the skill-prose conformance suites that might pin this skill's text: `grep -rln "parse-signal-discipline" tests` and run each hit with `node --test`.
- [ ] **Step 4: Commit** — one commit: `Fix stripper-scan drift from record 3773's review — refs #3795` (plus the session trailer).

---

## Self-review

- **Spec coverage:** Deliverable 1 (planted mis-parse case) → Step 1. Deliverable 2 (item 15 rewording naming `guardBlankedByStripper`) → Step 2. Deliverable 3 (helper header lists path-containment) → already true; Step 2 extends it to all eight current scans per AC 3. Deliverable 4 (`a7790fbed` → `5c8e2a2e0`) → Step 2. AC 1 (planted case goes red against an `ok`-only verdict) → Step 1 discrimination. AC 2 (grep prints nothing) → Step 3. AC 3 (both describe the scans as they exist now) → Step 2. AC 4 (`npm test` passes in full) → `/build` Common Step 5.
- **Placeholders:** none.
