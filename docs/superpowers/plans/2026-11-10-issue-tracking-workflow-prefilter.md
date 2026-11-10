# Issue-tracking workflow prefilter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the generated `track-issue-fixes.yml` from starting a billed runner on pushes that reference no issue, and from running at all on the plugin's bookkeeping branches. Give existing adopters a way to pick up the regenerated file.

**Architecture:** `plugin/bin/lib/issue-branch-tracking.js` stays the single source. It gains:
- a job-level prefilter expression built from exported stems, plus a JS model of it (`prefilterMatches`) that the tests use to prove superset-ness;
- a `!`-pattern branch exclusion built from the imported bookkeeping-branch constants;
- a classifier (`classifyExistingWorkflow`) backed by a digest list of every historical generator output.

Init Step 16's prose acts on the classifier, and this repo's checked-in workflow is regenerated and pinned.

**Tech Stack:** Node 18+ CommonJS, `node --test`, GitHub Actions expression syntax, bash/jq/GNU grep (runtime superset test only).

**Spec:** `.claude-tweaks/pipelines/2026-11-10T224532-spec-5152/work/5152-spec.md`

**Scope keywords:** track-issue-fixes, generateWorkflowYaml, issue-branch-tracking

## Global Constraints

- **Stems:** `PREFILTER_KEYWORD_STEMS` is exactly `['close', 'fix', 'resolve']`, and the prefilter also requires the literal `#`.
- **Prefilter shape:** `contains(join(github.event.commits.*.message, ' '), '<literal>')`, ANDed after the existing ref condition on the same `if:` line. The existing literal `if: github.ref != format('refs/heads/{0}', github.event.repository.default_branch)` (and its `==` twin) must remain a substring of the output, because `tests/issue-branch-tracking.test.js` pins it (spec AC10).
- **Trigger branches:** `on.push.branches` is `'**'`, then `'!claims-registry'`, then `'!health-state'`, in that order. The names are taken from `CLAIMS_BRANCH` (`plugin/bin/lib/issues/claims.js`) and `HEALTH_STATE_BRANCH` (`plugin/bin/lib/health-core/durable-state.js`), never retyped.
- **Normalisation before hashing:** `content.replace(/\n+$/, '')`.
- **`PRIOR_OUTPUT_SHA256`** holds exactly these five digests: every distinct historical output in `git log --follow` of the generator, computed on 2026-11-10. This is wider than the spec's "since it moved under plugin/" by design, because pre-move adopters exist:
  - `0b9a50e7dacd86c560626ae566a27cc4a2528acebd83b340d78596354a3127dd` (f33f9b143..5cf9073d3, also today's checked-in file)
  - `a64b869f142c07baf9477259374b00cb0aa62332cf0f699684c98f52e2876dd4` (bf59b85b0, 68074d781)
  - `a05f433b8079c9147f6750bf8ef01a3a61de6c52f3c3c5d7db6ed7c582fdc561` (70f39beef, eac1b0b87)
  - `dba131107bd1224c9ff823bc5390401ace05c2ab1e33cc7ec4fea0c96efb9138` (d8fee5356)
  - `89f9cc80110f35535fce118eb445d03de5e1c80886932a8c076138c0e270d1ae` (9e5c83a99)
- **Regeneration only:** `.github/workflows/track-issue-fixes.yml` is only ever written by `node -e "process.stdout.write(require('./plugin/bin/lib/issue-branch-tracking.js').generateWorkflowYaml()+'\n')" > .github/workflows/track-issue-fixes.yml`, never hand-edited.
- **Prose tokens:** no literal `TBD`/`TODO` in skill prose.

Waived plugin/bin/lib/issues/claims.js: read-only import of `CLAIMS_BRANCH` (Task 2); nothing in it changes.
Waived plugin/bin/lib/health-core/durable-state.js: read-only import of `HEALTH_STATE_BRANCH` (Task 2); nothing in it changes.

## Review Focus

- **YAML comment hazard:** a ` #` (whitespace then `#`) inside the plain-scalar `if:` line turns the rest into a YAML comment, silently dropping the prefilter or the ref condition. Task 1 asserts that no emitted `if:` line contains `/\s#/`.
- **Non-ASCII case folding:** `cloſes #1` (U+017F long s) is matched by `grep -P -i` in UTF-8 mode and must also pass `prefilterMatches`. Task 1's corpus includes it.
- **Reverts:** a push whose only reference is inside a revert commit (`Revert "fixes #42"`) passes the prefilter (looser) while extraction drops it. That is allowed; the reverse is not. Task 1's property test covers reverts.
- **Empty or missing commits:** `[]`, `undefined`, or a commit whose `message` is not a string must make `prefilterMatches` return false without throwing. Task 1 asserts this.
- **Adopter files with CRLF line endings:** Windows checkouts rewrite LF to CRLF, so `classifyExistingWorkflow` normalises `\r\n` to `\n` before the trailing-newline trim and hashing. Task 3 asserts that CRLF generator output classifies `current`.

---

### Task 1: Prefilter expression, JS model, and superset proof

**Files:**
- Modify: `plugin/bin/lib/issue-branch-tracking.js` (add constants and functions near `ISSUE_REF_SOURCE`; change both jobs' `if:` lines in `generateWorkflowYaml()`; extend `module.exports`)
- Test: `tests/issue-branch-tracking.test.js` (append tests; reuse `resolveGnuGrep`, `hasJq` and `runExtractStep`, never copy them)

**Interfaces:**
- Produces:
  - `PREFILTER_KEYWORD_STEMS`: frozen `string[]`, equal to `['close','fix','resolve']`.
  - `PREFILTER_EXPRESSION`: `string`, the exact text ANDed into both `if:` lines.
  - `prefilterMatches(commitMessages: unknown[] | undefined): boolean`.

- [ ] **Step 1: Write the failing tests** (append to `tests/issue-branch-tracking.test.js`; import the new names in the existing destructuring). Covers AC1.1, AC1.2 (literal test), AC2.1, AC2.2 (language test), AC3.1, AC3.2, AC3.3, AC3.4, AC3.5, AC3.6 (JS property test), AC4.1, AC4.2 (runtime test), AC5.1 (rejection test):
  - `'PREFILTER_KEYWORD_STEMS cover every word CLOSING_KEYWORD_ALTERNATION accepts'`:
    - Build candidates: each stem, plus each stem with every suffix of 1–3 letters `a`–`z`.
    - Filter them with `new RegExp('^(?:' + CLOSING_KEYWORD_ALTERNATION + ')$')`.
    - Assert that the matched set, sorted, deep-equals `['close','closed','closes','fix','fixed','fixes','resolve','resolved','resolves']`.
    - Assert that every matched word `includes` one of `PREFILTER_KEYWORD_STEMS`.
  - `'emitted if: lines carry exactly the prefilter literals'`:
    - For each of the two job `if:` lines in `generateWorkflowYaml()`, collect every `contains(join(github.event.commits.*.message, ' '), '<x>')` literal `x` via regex.
    - Assert that the sorted list deep-equals `['#', ...PREFILTER_KEYWORD_STEMS].sort()`.
    - Assert that the line `includes(PREFILTER_EXPRESSION)`.
    - Assert that the line does not match `/\s#/`.
  - `'prefilterMatches rejects pushes with no closing reference'`:
    - Assert false for `['Update README']`, `['refs #12 tidy']`, `['health-state: code-health update']`, `['fix the build']` (stem without `#`), `[]` and `undefined`.
    - Assert false for `[{}]`-shaped input coerced as `[undefined]`, and for `[42]`, without throwing.
  - `'prefilterMatches is a superset of extractIssueNumbers (seeded property test)'`:
    - Use a deterministic PRNG (mulberry32, seed `5152`) to generate 5000 commit-message arrays (1–3 messages each) from these parts:
      - a keyword form, cased lower, UPPER, Title or randomly;
      - separators drawn from `' '`, `'\t'`, `'\n'`, `'\r\n'` and runs of 1–3 of them;
      - `#` plus 1–5 digits;
      - noise words;
      - occasionally a `Revert "…"` wrapper;
      - occasionally the keyword in one message and `#N` in the next;
      - the fixed case `'cloſes #1'`.
    - For every array where `extractIssueNumbers(msgs).length > 0`, assert `prefilterMatches(msgs) === true`, with the failing input in the message.
    - Assert that at least 1000 generated arrays had a non-empty extraction, so the property is not vacuous.
  - `'prefilterMatches is a superset of the literal generated extraction script (runtime)'`:
    - Take the first 150 arrays from the same seeded generator and run `runExtractStep(t, msgs.map((m) => ({ message: m })))` for each, honouring its skip.
    - When the returned `issues` is non-empty, assert `prefilterMatches(msgs)`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/issue-branch-tracking.test.js`
Expected: FAIL — `prefilterMatches` is not a function.

- [ ] **Step 3: Implement in `plugin/bin/lib/issue-branch-tracking.js`**
  - `PREFILTER_KEYWORD_STEMS = Object.freeze(['close', 'fix', 'resolve'])`.
  - Build `PREFILTER_EXPRESSION` from the stems as `contains(J, '#') && (contains(J, 'close') || contains(J, 'fix') || contains(J, 'resolve'))`, where `J` is `join(github.event.commits.*.message, ' ')`.
  - Both jobs' `if:` lines become `if: <existing ref condition> && <PREFILTER_EXPRESSION>` on one line.
  - `prefilterMatches`: join the string messages with `' '`, upper-case it, and check that it includes `'#'` and any upper-cased stem. Non-arrays and non-string entries are treated as absent.
  - Add a short comment above the constant: why it is looser than `ISSUE_REF_SOURCE`, why upper-casing models `OrdinalIgnoreCase` (cite `actions/runner` `Contains.cs`), and that a false job `if` gets no runner.

- [ ] **Step 4: Run the tests to verify they pass** (verifies AC10.1)

Run: `node --test tests/issue-branch-tracking.test.js`
Expected: PASS, with every pre-existing test unchanged. The runtime test may report a skip on a machine without GNU grep and jq.

- [ ] **Step 5: Commit**

  ```bash
  git add plugin/bin/lib/issue-branch-tracking.js tests/issue-branch-tracking.test.js
  git commit -m "Add job-level prefilter to the generated issue-tracking workflow — superset of the in-job extraction, proven by test (#5152)"
  ```

### Task 2: Exclude the bookkeeping branches at the trigger

**Files:**
- Modify: `plugin/bin/lib/issue-branch-tracking.js` (the `on: push: branches:` lines, plus the two `require`s)
- Test: `tests/issue-branch-tracking.test.js`

**Interfaces:**
- Consumes: `CLAIMS_BRANCH` from `./issues/claims`, and `HEALTH_STATE_BRANCH` from `./health-core/durable-state`.
- Produces: no new exports.

- [ ] **Step 1: Write the failing test** (covers AC6.1) `'push trigger excludes the plugin bookkeeping branches, named from their constants'`.
  - Slice the lines between `'  push:'` and the first blank line after it.
  - Assert that the branch list items are exactly `["'**'", `'!${CLAIMS_BRANCH}'`, `'!${HEALTH_STATE_BRANCH}'`]` in that order.
  - Assert `CLAIMS_BRANCH === 'claims-registry'` and `HEALTH_STATE_BRANCH === 'health-state'`, so a rename of either constant is a visible decision.
- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/issue-branch-tracking.test.js`
Expected: FAIL after Step 1 — the branch list is only `'**'`.
- [ ] **Step 3: Implement** the require-based branch lines. Add a comment: bookkeeping pushes never carry a fix, and `!` patterns must follow `'**'`.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit**

  ```bash
  git add plugin/bin/lib/issue-branch-tracking.js tests/issue-branch-tracking.test.js
  git commit -m "Exclude claims-registry and health-state pushes from the issue-tracking workflow trigger (#5152)"
  ```

### Task 3: Classify an existing workflow file for the upgrade path

**Files:**
- Modify: `plugin/bin/lib/issue-branch-tracking.js`
- Create: `tests/fixtures/track-issue-fixes-pre-5152.yml`, with its content taken from `git show c1fa86602:.github/workflows/track-issue-fixes.yml` (byte-exact, via redirect)
- Test: `tests/issue-branch-tracking.test.js`

**Interfaces:**
- Produces:
  - `PRIOR_OUTPUT_SHA256`: frozen `string[]` holding the five Global Constraints digests.
  - `classifyExistingWorkflow(content: string): 'current' | 'prior-generated' | 'modified'`.

- [ ] **Step 1: Write the failing tests** (cover AC7.1):
  - `'classifyExistingWorkflow: current generator output'`: assert `current` for `generateWorkflowYaml()`, for the same plus `'\n'`, and for the output with every `\n` replaced by `\r\n`.
  - `'classifyExistingWorkflow: pre-5152 checked-in file is prior-generated'`: read the fixture and assert `prior-generated`.
  - `'classifyExistingWorkflow: a hand edit is modified'`: assert `modified` for the fixture with its first `# ` comment line altered by one character, and for the empty string.
  - `'PRIOR_OUTPUT_SHA256 holds five distinct digests and excludes the current output'`: assert a length of 5, that the values are distinct and 64-hex, and that the current output's digest is not in the list. That last check makes "current" and "prior-generated" disjoint.
- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/issue-branch-tracking.test.js`
Expected: FAIL after Step 1 — `classifyExistingWorkflow` is not a function.
- [ ] **Step 3: Implement.**
  - Normalise: CRLF to LF, then `replace(/\n+$/, '')`.
  - Hash with `crypto.createHash('sha256')`.
  - Return `current` when the hash equals the hash of the normalised current output, `prior-generated` when it is in `PRIOR_OUTPUT_SHA256`, and `modified` otherwise.
  - Add a comment above the digest list naming how it was derived (`git log --follow` of the generator, each revision's output normalised and hashed, 2026-11-10) and that it must be appended to whenever the generator's output changes. Task 5's pin test is what notices.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit**

  ```bash
  git add plugin/bin/lib/issue-branch-tracking.js tests/issue-branch-tracking.test.js tests/fixtures/track-issue-fixes-pre-5152.yml
  git commit -m "Classify an existing track-issue-fixes.yml as current, prior-generated or modified (#5152)"
  ```

### Task 4: Init Step 16 acts on the classification

**Files:**
- Modify: `plugin/skills/init/bootstrap/step-16-non-default-branch-issue-tracking.md` (the existence check in its second paragraph; the job descriptions; the "Re-run behavior" paragraph)
- Modify: `plugin/skills/init/SKILL.md` (the Step 16 paragraph, around line 167: replace "Idempotent: skipped silently once the workflow file exists.")

**Interfaces:**
- Consumes: `classifyExistingWorkflow` from Task 3, invoked as `node -e "const m=require('${CLAUDE_PLUGIN_ROOT}/bin/lib/issue-branch-tracking.js');console.log(m.classifyExistingWorkflow(require('fs').readFileSync('.github/workflows/track-issue-fixes.yml','utf8')))"`.

- [ ] **Step 1: Rewrite Step 16's existence check.** When the file exists, run the classifier command above. Then:
  - `current`: skip silently, as today.
  - `prior-generated`: regenerate in place with the existing generation command, with no prompt. Report one line, `track-issue-fixes.yml: regenerated (was an unmodified earlier generator output)`, and cite Step 14's silent regeneration of `scripts/claude-cloud-setup.sh` as precedent.
  - `modified`: one `AskUserQuestion`:
    - `question`: `"track-issue-fixes.yml differs from every version claude-tweaks generated, so it was edited by hand. The current generator adds a job-level prefilter (no runner on pushes that reference no issue) and skips the claims-registry and health-state bookkeeping branches. Regenerate it?"`
    - `header`: `"Tracking wf"`
    - Option 1: `"Keep my file (Recommended)"`, described as `"Leave the edited file as is."`.
    - Option 2: `"Regenerate"`, described as `"Overwrite with the current generator output — local edits are lost."`.
  - A classifier command that exits non-zero is surfaced, and Step 16 continues without writing, matching the existing Failure handling paragraph.
- [ ] **Step 2: Update the job descriptions.** Both jobs run only when the pushed commits contain `#` and a closing-keyword stem, and the trigger skips `claims-registry`/`health-state`. Replace the "Re-run behavior" paragraph with the three outcomes.
- [ ] **Step 3: Update `init/SKILL.md`'s Step 16 paragraph** to say that a re-run regenerates an unmodified earlier generator output and asks before overwriting a hand-edited one.
- [ ] **Step 4: Verify** (verifies AC9.1).
  - Run: `node "/Users/thomasholknielsen/.claude/plugins/cache/claude-tweaks-marketplace/claude-tweaks/6.164.0/bin/plan-audit.js" docs/superpowers/plans/2026-11-10-issue-tracking-workflow-prefilter.md --bytes`, then `node --test "tests/bin-lib/skill-audit/*.test.js"`.
  - Expected: no rail breach, and the suites PASS.
  - Run `git grep -n "skipped silently once the workflow file exists" -- plugin`. Expected: no output.
- [ ] **Step 5: Commit**

  ```bash
  git add plugin/skills/init/bootstrap/step-16-non-default-branch-issue-tracking.md plugin/skills/init/SKILL.md
  git commit -m "init Step 16: regenerate an unmodified earlier tracking workflow, ask before overwriting a hand-edited one (#5152)"
  ```

### Task 5: Regenerate this repo's workflow and pin it

**Files:**
- Modify: `.github/workflows/track-issue-fixes.yml` (generated from `plugin/bin/lib/issue-branch-tracking.js`'s `generateWorkflowYaml()`, regenerate rather than edit)
- Test: `tests/issue-branch-tracking.test.js`

**Interfaces:**
- Consumes: `generateWorkflowYaml()` as of Tasks 1–2.

- [ ] **Step 1: Write the failing test** (covers AC8.1) `'the checked-in .github/workflows/track-issue-fixes.yml is the generator output'`: read the file from the repo root (`path.join(__dirname, '..', '.github/workflows/track-issue-fixes.yml')`) and `strictEqual` it to `generateWorkflowYaml() + '\n'`.
- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/issue-branch-tracking.test.js`
Expected: FAIL after Step 1 — the checked-in file predates Tasks 1–2.
- [ ] **Step 3: Regenerate** with the Global Constraints command.
- [ ] **Step 4: Run** the same command. Expected: PASS. Also run `git diff --stat .github/workflows/track-issue-fixes.yml` and confirm that only the trigger branch lines and the two `if:` lines changed.
- [ ] **Step 5: Commit**

  ```bash
  git add .github/workflows/track-issue-fixes.yml tests/issue-branch-tracking.test.js
  git commit -m "Regenerate track-issue-fixes.yml from the generator and pin it by test (#5152)"
  ```
