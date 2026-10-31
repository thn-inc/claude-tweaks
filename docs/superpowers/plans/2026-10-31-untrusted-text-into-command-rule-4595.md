# Add an untrusted-text-into-command rule to skill authoring and review lens 3b (#4595) Implementation Plan

**Goal:** Two records shipped a shell-injection surface in skill prose that only `/claude-tweaks:review` lens 3b caught, so this plan writes the rule down and points lens 3b at it.

**Spec:** `.claude-tweaks/pipelines/2026-10-31T001707-record-4595/work/4595-spec.md` (materialized from GitHub issue #4595)

**Calibration-line placement (build-time choice the Deliverable allows: "`_shared/criteria-review-quality.md` or the lens's own row"):** the line goes in lens 3b's own checklist, `plugin/skills/review/step3-lens-dispatch.md` `### 3b: Security`. Dispatched lens agents get that checklist. They get only the CALIBRATION filter and severity scale from `_shared/criteria-review-quality.md` (`step3-lens-dispatch.md` line 113), never its per-lens Notes column. A line in that column would never reach a 3b agent. `step3-lens-dispatch.md` is 50173 bytes against a 52500-byte `RAIL_BYTES`. The ~550-byte bullet stays under the rail, so no cut is needed.

---

### Task 1: Write the untrusted-text-into-command rule and lens 3b's check, and pin both

**Files:**
- Modify: `docs/skill-authoring.md` (a new `## Untrusted text into a shell or paste command` section, inserted right after `## Reading a marker comment back from GitHub` and before `## Deriving a CLI argument from earlier prose`)
- Modify: `plugin/skills/review/step3-lens-dispatch.md` (one new bullet appended at the end of `### 3b: Security`, before `### 3c: Error Handling`)
- Waived `plugin/skills/_shared/criteria-review-quality.md`: the spec's Key Files names it, but its per-lens Notes column never reaches a dispatched 3b agent (see the placement note above), so it stays unchanged
- Test: `tests/untrusted-text-into-command-conformance.test.js` (new)

- [ ] **Step 1: Failing test.** Write `tests/untrusted-text-into-command-conformance.test.js` in the shape of `tests/specify-review-fail-closed-guard-conformance.test.js`. Use `'use strict'`, `node:test`, `node:assert/strict`, and `readText` from `./helpers/read-skill`. Reuse that file's `sliceSection` (throws on a missing end anchor) and its `expectRed` go-red helper, and mutate the live text in memory. Assertions:
  - The `docs/skill-authoring.md` section sliced from `## Untrusted text into a shell or paste command` to the next `\n## ` contains all of the following:
    - the class phrase `never reaches a shell command line`
    - `process.argv`
    - `Write`
    - `exact grammar`
    - a non-command fallback phrase
    - both record refs `#4465` and `#4423`
    - both fix SHAs `5a3494874` and `48d8c550e`
  - Lens 3b's slice, from `### 3b: Security` to the next `\n### `, contains the class phrase `untrusted text interpolated into a shell or paste command`.
  - The new section sits between `## Reading a marker comment back from GitHub` and `## Deriving a CLI argument from earlier prose`.
  - Go-red controls: removing the section, removing either record ref, removing either SHA, or removing the lens phrase each fails with that assertion's own message.

  Run: `node --test tests/untrusted-text-into-command-conformance.test.js`. Expected: FAIL, because the heading and the lens phrase do not exist yet.
- [ ] **Step 2: Implement.** Make both edits.

  **(a) `docs/skill-authoring.md`.** Insert this section verbatim, with one blank line on each side, between the two headings named above:

  ```markdown
  ## Untrusted text into a shell or paste command

  Text the plugin did not write — a human's free-text answer, a PR or issue body or comment, a record field, a branch name — never reaches a shell command line, or a command rendered for a human to paste, by interpolation. Quoting is no defense: a single-quoted `'{why}'` ends at the first `'` the text carries, and a double-quoted one still expands `$(…)` and backticks. Pass it as data instead: `Write` it to a file and feed that file on stdin or as a path argument, or hand it to a `node` program through `process.argv` (`docs/donts.md`'s `process.argv` rule is the correctness half of the same advice). A command that must be built from untrusted parts — a paste line rendered for a human — renders only when every part matches the composer's exact grammar (a fixed shape, each slot's allowed characters stated, nothing trailing), and otherwise falls back to a non-command line that names the item and the action without the untrusted text. Two worked fixes, each caught only by `/claude-tweaks:review` lens 3b after the whole-branch review had passed: #4465's tidy `record-decline` interpolated a human's free-text decline reason into a single-quoted `printf` (5a3494874 — the payload is now a `Write`-produced file fed on stdin), and #4423's tidy Step 4.7 rendered an open PR's untrusted `### Resume` line as a paste command with an unconstrained tail (48d8c550e — the line is held to `plugin/bin/lib/flow/pr-body.js`'s `composeResumeLine` shape, its `{dir}` and `{target}` free of shell metacharacters, with nothing after it, else a plain "Resolve open PR" line). This is the shell-side counterpart to "Passing untrusted content into an inline skill invocation" above: that rule stops fetched text from steering an LLM turn, and this one stops it from running as a command. Lens 3b's checklist (`plugin/skills/review/step3-lens-dispatch.md`) looks for it, and `tests/untrusted-text-into-command-conformance.test.js` pins both.
  ```

  **(b) `plugin/skills/review/step3-lens-dispatch.md`.** Append this bullet as the last line of `### 3b: Security`:

  ```markdown
  - In skill prose, does text the plugin did not write (a human's free-text answer, a PR/issue body or comment, a record field, a branch name) reach a shell command line or a rendered paste command by interpolation, instead of a `Write`-produced file (stdin or a path argument) or `process.argv`, or a paste command rendered only when every part matches its composer's exact grammar? Flag untrusted text interpolated into a shell or paste command as a security finding. (#4465, #4423 — both caught only by this lens; rule: `docs/skill-authoring.md`'s "Untrusted text into a shell or paste command".)
  ```
- [ ] **Step 3: Run.** Run `node --test tests/untrusted-text-into-command-conformance.test.js` and expect PASS. Then run the neighbouring suites that read the edited files: `node --test tests/specify-review-fail-closed-guard-conformance.test.js tests/review-dispatch-composition.test.js tests/untrusted-record-content-conformance.test.js tests/code-health-misc/criteria-fragments.test.js`. Expect PASS.
- [ ] **Step 4: Commit.** Make one commit, with message `Add an untrusted-text-into-command rule to skill authoring and review lens 3b — refs #4595`.

---

## Self-review

- **Spec coverage:**
  - Deliverable 1 and AC1 (the rule with both worked examples) are covered by Step 2(a).
  - Deliverable 2 and AC2 (lens 3b's calibration names the class) are covered by Step 2(b).
  - AC3 (a conformance test pins both files) is covered by Step 1.
- **Placeholders:** none.
