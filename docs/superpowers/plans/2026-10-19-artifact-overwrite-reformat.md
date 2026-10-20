# check-artifact-overwrite: step-markup reformat clearing test (#3341) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the multi-spec artifact-overwrite check pass a later commit that only converts journey step markup (numbered-list steps to `### N.` headers, list indentation) with zero content change, while a conversion that also drops content still HARD-GATEs.

**Architecture:** `plugin/bin/lib/flow/artifact-overwrite-check.js` judges each deleting hunk by two clearing tests (same-spec self-edit via blame, list reflow). Add a third, per-hunk, pure test — `isStepMarkupReformat(hunk)` — checked right after `isListReflow` in the hunk loop: the hunk's deleted and added lines, each passed through `normalizeStepMarkup` and with blank lines dropped, are equal sequences. Fails closed like its siblings: any content difference, or a deletion-only hunk, is not a reformat.

**Tech Stack:** Node 18+, `node --test`, git CLI (synthetic fixture repos).

**Spec:** `.claude-tweaks/pipelines/2026-10-19T203710-record-3341/work/3341-spec.md` (materialized from GitHub issue #3341)

Scope keywords: isListReflow, two independent tests, list reflow

## Global Constraints

- Normalized forms the spec names: `N. **Name** — x` and `### N. Name — x` are equal; list indentation is ignored.
- Replay `--base d81250829 --head 80e3dad2d` must exit 0 with `overwrites: []`.
- A later spec's commit that converts step markup and also deletes a step body must still exit 1, naming that commit.
- `npm test` passes.
- Commit messages: `{Verb} {what} — {detail}`, trailer `refs #3341` (never `closes`/`fixes`).

## Review Focus

1. Conversion plus a one-word edit inside a step body — must stay an overwrite (normalization must not swallow real text changes). Test in Task 1.
2. Deletion-only hunk (no added lines) — never a reformat. Test in Task 1.
3. Headers already present, only sub-bullet re-indentation changes — a reformat. Covered by the indentation half of `normalizeStepMarkup`, unit-tested in Task 1.
4. A `##`/`###` heading that is not a numbered step (e.g. `## Origin` → `### Origin`) — out of the spec's normalization; stays judged by the other two tests (fail closed). No new test; noted so the reviewer does not widen the regex.
5. Bold inside a header form (`### 1. **Name** — x`) — normalizes to the same line as both spec forms. Unit-tested in Task 1.

---

### Task 1: Step-markup reformat clearing test

**Files:**
- Modify: `plugin/bin/lib/flow/artifact-overwrite-check.js` (header comment lines 12-35; new helpers after `isListReflow` ~line 173; hunk loop ~line 269; `module.exports`)
- Test: `tests/bin-lib/flow/artifact-overwrite-check.test.js`
- Modify: `plugin/skills/flow/multispec-artifact-namespacing.md` ("Append vs. overwrite" section, lines 47-73)
- Modify: `docs/plugin-structure.md:200` (the CLI's one-line description names the clearing tests — add the third)

**Interfaces:**
- Produces: `normalizeStepMarkup(line: string) -> string`; `isStepMarkupReformat(hunk: {deletedLines: Array<{lineNo, content}>, addedLines: string[]}) -> boolean`. Both exported from `artifact-overwrite-check.js`.

- [ ] **Step 1: Write the failing tests** in `tests/bin-lib/flow/artifact-overwrite-check.test.js` (import `normalizeStepMarkup`, `isStepMarkupReformat` alongside the existing imports):

  - `normalizeStepMarkup: list-step and header-step forms normalize equal` — `normalizeStepMarkup('1. **Read the banner** — A session starts.')`, `normalizeStepMarkup('### 1. Read the banner — A session starts.')`, and `normalizeStepMarkup('### 1. **Read the banner** — A session starts.')` are all `===` each other; `normalizeStepMarkup('   - **Action:** Do it.') === normalizeStepMarkup('- **Action:** Do it.')`.
  - `normalizeStepMarkup: a non-numbered heading is left as a heading` — `normalizeStepMarkup('### Origin') !== normalizeStepMarkup('## Origin')`.
  - `parseHunks + isStepMarkupReformat: list steps converted to ### headers with flush sub-bullets is a reformat` — a `-U0` diff hunk in the real 80e3dad2d shape (two steps: `1. **A** — x` + three `   - **Action:**`-style indented bullets, blank line, `2. **B** — y` + bullets → `### 1. A — x` / flush bullets / blank / `### 2. B — y` / flush bullets) → `true`.
  - `isStepMarkupReformat: a conversion that also changes one word in a step body is not a reformat` → `false`.
  - `isStepMarkupReformat: a deletion-only hunk is not a reformat` → `false`.
  - Synthetic repo `cross-spec step-markup conversion with zero content change passes clean`: commit A (`refs #10`) adds `docs/journeys/demo.md` with frontmatter-free `# Demo`, blank, two list-form steps each with three 3-space-indented `- **Action:**/**Should feel:**/**Red flags:**` bullets separated by a blank line; commit B (`refs #12`) rewrites the same file with the two steps as `### N. Name — text` headers and flush bullets, identical text. `checkArtifactOverwrite({ base, paths: ['docs/journeys/'], cwd })` → `clean === true`, message includes `JSON.stringify(result.overwrites)`.
  - Synthetic repo `cross-spec step-markup conversion that also drops a step still HARD-GATEs (exit 1 naming the commit)`: same commit A; commit B (`refs #12`) converts step 1 and omits step 2 entirely. Library: `clean === false`, `overwrites.length === 1`, `overwrites[0].commit === <commit B sha>`. CLI: `spawnSync('node', [CLI, '--base', base, '--path', 'docs/journeys/'], { cwd, encoding: 'utf8' })` → `status === 1` and `JSON.parse(stdout).overwrites[0].commit === <commit B sha>` (CLI path: `plugin/bin/check-artifact-overwrite.js`, resolved the same way `MOD` is).
  - `the real #2702/#2727/#2776 journey reformat (d81250829..80e3dad2d) passes with no manual ruling` — same skip-guard shape as the existing AC1 test (`git cat-file -t 80e3dad2d` must print `commit`, else return), then `checkArtifactOverwrite({ base: 'd81250829', head: '80e3dad2d', paths: ['docs/journeys/', 'stories/'], cwd: repoRoot })` → `clean === true`, `overwrites` deep-equals `[]`.

- [ ] **Step 2: Run the tests to verify they fail**

  Run: `node --test tests/bin-lib/flow/artifact-overwrite-check.test.js`
  Expected: FAIL — `normalizeStepMarkup is not a function` for the unit tests; the zero-change conversion fixture and the live replay report `clean: false`. (The drop-a-step fixture already passes on the current code — it is a regression pin for Step 3, not a red test.)

- [ ] **Step 3: Implement** in `plugin/bin/lib/flow/artifact-overwrite-check.js`:

  - `normalizeStepMarkup(line)`: strip leading whitespace; drop a leading `#{1,6}` + whitespace only when followed by `\d+\.\s` (a numbered step heading); then rewrite a leading `N. **Name**` to `N. Name` (non-greedy bold span directly after the number). Return the result. Nothing else is touched.
  - `isStepMarkupReformat(hunk)`: `false` when `deletedLines` is empty; otherwise normalize every deleted `content` and every added line, drop lines that are empty after normalization, and return `true` only when the two arrays have equal length and are element-wise `===`.
  - Hunk loop: `if (isStepMarkupReformat(hunk)) continue; // Test 3 — step-markup reformat, no content change` immediately after the `isListReflow` line.
  - Header comment: "by either of two independent tests" → three; add test 3's paragraph (spec forms, indentation, blank lines ignored, per-hunk) after test 2; update the "neither test parses step headings" sentence — test 3 does recognize numbered step headings, and only to normalize them. Update the overwrite `reason` string's tail "and the deletion is not a list reflow" → "and the deletion is neither a list reflow nor a step-markup reformat".
  - Export both functions.

- [ ] **Step 4: Run the tests to verify they pass**

  Run: `node --test tests/bin-lib/flow/artifact-overwrite-check.test.js tests/bin-lib/flow/check-artifact-overwrite-cli.test.js tests/multispec-artifact-namespacing-conformance.test.js`
  Expected: PASS, 0 fail (re-run after Step 5's doc edit too).

  Run: `node plugin/bin/check-artifact-overwrite.js --base d81250829 --head 80e3dad2d --path docs/journeys/ --path stories/`
  Expected: `{"clean":true,"overwrites":[]}`, exit 0.

- [ ] **Step 5: Update the docs**

  - `plugin/skills/flow/multispec-artifact-namespacing.md`: "by two independent tests" → "by three independent tests"; add item `3. **Step-markup reformat.**` — the hunk's removed and added lines are equal once journey step markup is normalized (`N. **Name** — x` and `### N. Name — x` read the same; list indentation and blank lines are ignored), the case a review fix converting numbered-list steps to the canonical `### N.` headers (`_shared/diataxis-genre-templates.md`) produces (#3341). "failing *both* tests" → "failing *all three* tests"; add "step-markup reformat (pass and drop-a-step)" to the fixture-coverage sentence. Check `wc -c` stays far below the rail (currently 5056 bytes). Keep the literal `HARD-GATE: stop before rendering the console` and `git -C "$WORKTREE" log --name-status --diff-filter=AM` strings intact — `tests/multispec-artifact-namespacing-conformance.test.js` pins both; run that suite after the edit.
  - `docs/plugin-structure.md:200`: after the list-reflow clause, add "or are equal to the hunk's added lines once journey step markup is normalized (a step-markup reformat, #3341)".

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/lib/flow/artifact-overwrite-check.js tests/bin-lib/flow/artifact-overwrite-check.test.js plugin/skills/flow/multispec-artifact-namespacing.md docs/plugin-structure.md
git commit -m "Pass a content-preserving step-markup reformat in check-artifact-overwrite — third clearing test normalizes list/header step markup

refs #3341"
```

---

## Self-review

- **Spec coverage:** Deliverable 1 (third clearing test) → Step 3; Deliverable 2 (fixtures: zero-change conversion passes, conversion + dropped step fails) → Step 1; Deliverable 3 (namespacing doc) → Step 5. AC1 (replay exits 0, `overwrites: []`) → Step 1 live-replay test + Step 4 CLI run; AC2 (drop-a-step exits 1 naming the commit) → Step 1 CLI spawn assertion; AC3 (`npm test`) → run centrally by `/build` Common Step 5.
- **Placeholders:** none.
