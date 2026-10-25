# Pin the stripper-scan list in the helper header and parse-signal-discipline item 15 to the tree (#4008) Implementation Plan

**Goal:** The set of tests that call `tests/helpers/strip-comments.js` is restated by hand in the helper's own header comment and in `.claude/skills/parse-signal-discipline/SKILL.md` item 15; pin both prose lists to the set derived from the tree.

**Spec:** `.claude-tweaks/pipelines/2026-10-24T185217-record-4008/work/4008-spec.md` (materialized from GitHub issue #4008)

**Premise correction (logged in decisions.md):** the record says eight scans call the helper. The tree has eleven callers besides the helper's own unit suite (`tests/helpers-strip-comments.test.js`): the record's eight plus `tests/raw-markdown-read-conformance.test.js`, `tests/hooks-harness-refusal.test.js` and `tests/bin-lib/console/backfill-cli.test.js`. Both prose lists are rewritten to the eleven.

---

### Task 1: Add the twin pin and rewrite both prose lists to the tree

**Files:**
- Create: `tests/strip-comments-callers-twin.test.js`
- Modify: `tests/helpers/strip-comments.js` (header comment only, lines 3-7 — no code change)
- Modify: `.claude/skills/parse-signal-discipline/SKILL.md` (item 15, lines 289-292 only)

**Naming rule (the shared vocabulary).** A caller is named by its test-file stem: the basename with `.test.js` dropped, then a trailing `-conformance` dropped. The eleven stems today, alphabetical: `backfill-cli`, `exit-code`, `git-status-optional-locks`, `hooks-harness-refusal`, `path-containment`, `path-guard`, `porcelain-cwd-compare`, `raw-markdown-read`, `staged-id-producers`, `wall-clock-budget`, `windows-hide-spawn`.

**Prose shape (both locations).** Each list sits right after the literal anchor `by test-file stem:` and runs to the next `.`, with every name backticked, separated by commas and a final `and`. Nothing else may sit between the anchor and that `.` — so any pointer to the test file goes in its own sentence after the period, never in a parenthetical inside the list (`.test.js` contains a `.`).

Helper header — replace the current lines 3-6 sentence (`// Shared literal-aware comment stripper ... scans call it per file.`) with:

```
// Shared literal-aware comment stripper for the source-scan conformance tests
// (#3536, #3585). The tests that call it per file, by test-file stem: `backfill-cli`,
// `exit-code`, `git-status-optional-locks`, `hooks-harness-refusal`, `path-containment`,
// `path-guard`, `porcelain-cwd-compare`, `raw-markdown-read`, `staged-id-producers`,
// `wall-clock-budget` and `windows-hide-spawn`. tests/strip-comments-callers-twin.test.js
// pins this list to the tree. `raw-markdown-read` and `wall-clock-budget` (#3491) also
// call it in `literals: 'blank'` mode. Comments are blanked, never deleted:
```

and keep the rest of the header (`// every non-newline character of a comment becomes a space, ...`) unchanged. (Both `raw-markdown-read-conformance.test.js` and `wall-clock-budget-conformance.test.js` pass `literals: 'blank'` today — `grep -rln "literals: 'blank'" tests/` confirms.)

Item 15 — replace

```
    `stripComments` blanks comments to spaces before the windows-hide, git-status, path-guard,
    path-containment, porcelain-cwd-compare, staged-id producer, exit-code and wall-clock-budget
    conformance scans count tokens. It models regex literals (#3585); its residual
```

with

```
    `stripComments` blanks comments to spaces before its callers' scans count tokens. Its
    callers, by test-file stem: `backfill-cli`, `exit-code`, `git-status-optional-locks`,
    `hooks-harness-refusal`, `path-containment`, `path-guard`, `porcelain-cwd-compare`,
    `raw-markdown-read`, `staged-id-producers`, `wall-clock-budget` and `windows-hide-spawn`.
    `tests/strip-comments-callers-twin.test.js` pins this list and the helper header's to the
    tree. It models regex literals (#3585); its residual
```

Leave every other line of item 15 and of the helper untouched.

**The test (`tests/strip-comments-callers-twin.test.js`)** — `node:test` + `node:assert/strict`, CommonJS, `'use strict'`, built-ins only; match the style of neighboring `tests/*-conformance.test.js` files. It must **not** itself `require` the helper (that would make it a caller), and no string in it may form a literal `require('…strip-comments')` call the scan would match — build any such fixture text by concatenation (e.g. `'const s = req' + "uire('./helpers/strip-comments');"`).

Small pure functions, each taking its input as a parameter (default = the live repo) so every go-red control runs through the same extractor and assertion as the positive test:

1. `treeCallers(files = liveTestFiles())` — `files` is `[{ rel, text }]` for every `.js` file under `tests/` (recursive, skip `node_modules`). Before matching, drop every line whose trimmed start is `//` or `*` (a require mentioned in a comment is not a call). Match `/\brequire\(\s*(['"])([^'"\n]+)\1\s*\)/g`; for a relative spec (`.`-prefixed), resolve it against the file's directory, append `.js` when missing, and count the file when it equals `tests/helpers/strip-comments.js`. Exclude the helper itself and `tests/helpers-strip-comments.test.js` (the helper's own unit suite, not a scan). Return the stems via the naming rule, and throw (assertion) if two files map to the same stem.
2. `proseList(text, label)` — find the anchor `by test-file stem:`; assert it occurs exactly once (message names `label` and says the list could not be found — parse-signal-discipline's could-not-parse case, never an empty result); take the text from after the anchor up to the next `.`; collect the backticked names; assert the remainder, once the backticked names are removed, holds only commas, whitespace and the word `and` (so an un-backticked name cannot slip past); assert the list is non-empty. Return the names.
3. `headerText(src)` — the first contiguous run of lines starting with `//` in the helper, with the `//` prefix (and one following space) stripped, joined with single spaces.
4. `item15Text(src)` — the text from the line starting `15. ` up to (not including) the line starting `16. `; assert both lines are found.
5. `assertTwin(tree, prose, label)` — `assert.deepStrictEqual([...prose].sort(), [...tree].sort(), message)`, the message naming `label` and listing what is missing from each side (set equality both ways).

Tests:
- the tree derivation is non-empty, and the exclusion still applies to a real caller: `tests/helpers-strip-comments.test.js` exists and the require regex matches it (so the exclusion cannot go stale silently).
- helper header list equals the tree set.
- item 15 list equals the tree set.
- go-red controls (each asserts `assert.throws` through the same functions): (a) the live tree plus a scratch `{ rel: 'tests/zz-scratch.test.js', text: <concatenated require> }` fails `assertTwin` against the live header list; (b) the live header text with one backticked name removed (e.g. `` `path-guard`, `` deleted) fails `assertTwin`; (c) item 15 text with the anchor removed makes `proseList` throw; (d) a scratch file whose only require is on a `//` comment line is not counted (positive control: it adds nothing to `treeCallers`).

- [ ] **Step 1: Failing test** — write `tests/strip-comments-callers-twin.test.js` as above. Run: `node --test tests/strip-comments-callers-twin.test.js` — Expected: FAIL (both prose lists still hold the old eight names and no anchor).
- [ ] **Step 2: Implement** — rewrite the helper header and item 15 exactly as given above.
- [ ] **Step 3: Run** `node --test tests/strip-comments-callers-twin.test.js tests/helpers-strip-comments.test.js` — PASS. Then prove the acceptance criterion by hand: create a scratch `tests/zz-scratch-4008.test.js` containing `require('./helpers/strip-comments');`, re-run the twin test and see it FAIL naming `zz-scratch-4008`, then delete the scratch file and re-run to PASS. Quote both raw outputs.
- [ ] **Step 4: Commit** — one commit of the three files, message `Pin the strip-comments caller list in the helper header and parse-signal-discipline item 15 to the tree — refs #4008`.

---

## Self-review

- **Spec coverage:** Deliverable 1 (a `node --test` pin deriving the `tests/**` callers from the tree and asserting the helper header and item 15 lists match it both ways, per `prose-code-twin-pin`) is Task 1's test plus the prose rewrites. AC 1 (adding or removing a caller without updating both lists fails `npm test`, shown with a scratch require) is go-red control (a) plus Step 3's hand demonstration. AC 2 (`npm test` passes in full) is Common Step 5's full run.
- **Placeholders:** none.
