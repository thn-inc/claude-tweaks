# Verify-scope previous-reader pin (#4135) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pin that the committed `.claude-tweaks/verify-scope.json` stays readable by the latest release's `declaration.js` reader.

**Architecture:** Three helpers and three tests go into the existing `tests/verify-scope-declaration.test.js`. The first helper resolves the latest reachable `v*` tag, or a skip reason. The second materializes the tag's `plugin/bin/lib/verify/declaration.js` and its relative requires (transitively, from `git show`) into a temp dir and returns its `readDeclaration`. The third holds one shared assertion function that both the positive test and its go-red control call.

**Tech Stack:** Node `node:test`, `node:assert`, `git` CLI (local objects only).

**Spec:** `.claude-tweaks/pipelines/2026-10-26T193910-record-4135/work/4135-spec.md`

## Global Constraints

- The test never reads the network. Every `git` spawn passes `env: { ...process.env, GIT_NO_LAZY_FETCH: '1' }` so a partial clone cannot lazy-fetch a missing blob.
- Every `execFileSync` passes `windowsHide: true`, matching the file's existing `git ls-files` spawn.
- With no reachable release tag (`git describe` reports "No names found" / "No tags can describe" / "cannot describe"), the test skips with a stated reason. Any other `git describe` failure throws, so a broken git call never reads as a clean skip.
- Governing skill `verify-scope-rule-kind` (verbatim, rule 2): "The committed declaration stays readable by the previous release. The installed plugin build reads this repo's committed `.claude-tweaks/verify-scope.json` with older code. … Prove it by running the previous reader over the file: `git show {base}:plugin/bin/lib/verify/declaration.js`."

## Review Focus

- A release whose `declaration.js` gains a new relative require: the transitive loader must pick it up, not fail with MODULE_NOT_FOUND.
- A go-red control that only re-asserts its own mutation: the control must call the same `assertReleaseReaderAccepts` the positive test calls.
- A skip on an unrelated `git describe` failure would silently mask breakage: only the no-tag stderr shapes skip.
- Temp dirs must be removed after each test (`fs.rmSync(dir, { recursive: true, force: true })` in `finally`).

---

### Task 1: Previous-release reader conformance test

**Role:** integration

**Files:**
- Modify: `tests/verify-scope-declaration.test.js`
- Waived `plugin/bin/lib/verify/declaration.js`: the reader whose previous release is loaded (read only, no change)
- Waived `.claude-tweaks/verify-scope.json`: the committed file under test (read only, no change)

**Interfaces (local to the test file):**
- `latestReleaseTag(cwd: string) -> { tag: string } | { skip: string }`: runs `git describe --tags --abbrev=0 --match v* HEAD` in `cwd`.
- `loadReleaseReader(tag: string, dir: string, cwd = REPO_ROOT) -> Function`: writes `git show {tag}:plugin/bin/lib/verify/declaration.js` plus every `require('./…')` / `require('../…')` it reaches (transitively, `.js` appended when absent) under `dir` at their repo-relative paths, then `require`s the materialized `declaration.js` and returns its `readDeclaration`.
- `assertReleaseReaderAccepts(readDeclaration: Function, tag: string, declPath: string) -> void`: `assert.strictEqual(r.ok, true, …)`. The message names the tag and joins the reader's own `r.errors`.

- [ ] **Step 1: Write the tests**
  - `test('AC2.1: the committed verify-scope.json parses with the latest release tag\'s declaration reader (#4135)', (t) => …)`: on `{ skip }`, `t.skip(reason)` and return. Otherwise load the reader into an `fs.mkdtempSync` dir and call `assertReleaseReaderAccepts(reader, tag, DECL)`.
  - `test('AC1.1: a rule shape the release reader rejects fails the same assertion, naming the reader\'s error text (#4135)', …)`: the go-red control. Copy the committed JSON and append the rule `{ "match": "x/**", "suites": "everything", "static": true }` (rejected by every release reader: `suites` must be `"*"` or an array). Write it to the temp dir, then `assert.throws(() => assertReleaseReaderAccepts(reader, tag, fixture), (err) => err.message.includes(\`rules[${n}].suites:\`) && err.message.includes(tag))`. The skip is the same as AC2.1's.
  - `test('AC3.1: a clone with no reachable release tag skips with its reason (#4135)', …)`: `git init` a temp repo, make one empty commit (`-c user.name=t -c user.email=t@t commit --allow-empty -m x`), then assert that `latestReleaseTag(tmp)` deep-equals `{ skip: … }` and that the reason matches `/no release tag reachable/`.

- [ ] **Step 2: Run the tests to verify they fail**
  Run: `node --test tests/verify-scope-declaration.test.js`
  Expected: FAIL. The new tests' helpers are not yet defined (ReferenceError).

- [ ] **Step 3: Implement the three helpers** above the new tests, with the signatures above. The skip reason reads `no release tag reachable from HEAD (shallow clone?): {git stderr first line}`.

- [ ] **Step 4: Run the tests to verify they pass**
  Run: `node --test tests/verify-scope-declaration.test.js`
  Expected: PASS, every test (the three new ones are not skipped in this full-history checkout).

- [ ] **Step 5: Scratch proof of the AC1 example (not committed).** Run the loader against `v6.152.0`, the last release before #4024, over the committed file with every impact rule's `"suites": "*"` removed. It must fail, naming `rules[2].suites: must be "*" or an array of declared suite names`. Record the output in the PR.

- [ ] **Step 6: Commit**
  ```bash
  git add tests/verify-scope-declaration.test.js
  git commit -m "Pin the committed verify-scope.json against the latest release's reader — refs #4135"
  ```

---

## Self-review

- **Spec coverage:** Deliverable 1 → AC2.1 test + loader. Deliverable 2 → `latestReleaseTag` skip + `GIT_NO_LAZY_FETCH`. AC1.1, AC2.1 and AC3.1 are each cited by a test name.
- **Placeholders:** none.
