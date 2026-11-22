---
files:
  - tests/helpers/git-template.js
  - tests/helpers/git-trace.js
  - tests/helpers/pinned-git.js
  - tests/fixture-identity-config-scan.test.js
---

# Place a Fixture Builder's Warm-Call Test

**Persona:** A claude-tweaks plugin maintainer who has just moved a git fixture builder onto `fromTemplate`/`fromTemplateSet` (or added a new builder variant) and now owes the test that proves a second call to it starts no git process.
**Goal:** Add that warm-call test, and any test of what a copy holds, in a place where it costs no extra template build, without restating the trace check.
**Entry point:** A builder in a fixture module under `tests/` (for example `tests/helpers/reconcile-fixtures.js`) that returns copies of a per-process template.
**Success state:** The new test passes in a test file that already builds the same template, `git init` for that file is unchanged when measured with `GIT_TRACE2_EVENT`, and `tests/helpers-git-template.test.js` still holds only the template helper's own tests.

## Steps

### 1. Find the file that already builds the template
- **URL:** the header comment of `tests/helpers/git-template.js`, then the builder's `fromTemplate(key, …)` call and the test files that call the builder.
- **Action:** Read how the builder derives its template key from its arguments, then search `tests/` for a test file whose own tests call the builder with arguments that give the same key.
- **Should feel:** Like a lookup with one right answer. The header says it plainly: a builder's warm-call test belongs in a test file that already builds that template (calls the builder with arguments giving the same key), never in `tests/helpers-git-template.test.js`.
- **Should understand:**
  - Templates are cached per test process by key alone. In a file that builds the template anyway, the warm-call test costs nothing; anywhere else it pays a whole template build (`git init` plus every setup command) for one assertion.
  - "Uses the builder" is not enough. `flakyRepo()` and `flakyRepo({ retryExit: 1 })` are different keys; #5846 first placed the `retryExit: 1` test in a file that built only the other variants and paid one build for it.
  - A variant no test file builds yet goes to the file that uses the builder's other variants, and the change names the build it adds.
- **Red flags:**
  - Adding the test to `tests/helpers-git-template.test.js`. That file tests `fromTemplate` itself; #5846 moved 78 per-fixture tests out of it, which cut its git processes from 1,365 to 129.
  - Placing a test by the fixture's name or folder instead of by key.

### 2. Write the warm-call test on the shared check
- **URL:** `tests/helpers/git-trace.js` (`warmCallStartsNoGit`).
- **Action:** At the end of the chosen file, write `test('<builder>: a second call starts no git process', (t) => { warmCallStartsNoGit(() => builder(args), { track: (r) => t.after(() => fs.rmSync(r.repo, { recursive: true, force: true })) }); });`, with the cleanup in that file's own idiom. When the test warms several variants and traces others, pass the warm-up calls as the first argument and the traced calls as `opts.traced`, and assert on the returned `{ warm, traced }` afterwards.
- **Should feel:** Like one line. The test states only which call is warmed and how its copies are cleaned up.
- **Should understand:**
  - The helper calls `warm` once, then `opts.traced` (default: `warm` again) under `GIT_TRACE2_EVENT=<fresh empty dir>`, restores only that variable, removes the trace dir, and asserts the dir held no files: every git process writes one.
  - `opts.track` gets each call's result before the assertion runs, so copies are cleaned up even when the test fails.
  - `opts.traced` must be synchronous. A callback that returns a Promise is refused with a `TypeError`, because its git would run after the variable is restored and the check would pass without proving anything.
- **Red flags:**
  - A local `mkdtemp` plus `GIT_TRACE2_EVENT` plus `readdirSync` block in the test. That is the check `warmCallStartsNoGit` holds once; a copy drifts.
  - An `async` traced callback.

### 3. Run git in a content test through the pinned runner
- **URL:** `tests/helpers/pinned-git.js` (`pinnedGit`, `pinnedGitEnv`, `EMPTY_GIT_CONFIG`).
- **Action:** For a test that checks what a copy holds (a branch, a reflog, a remote URL), read it with `pinnedGit(cwd, args)`. Bind it as `git` when the file has no `git` of its own; when it does, bind it as `pinnedGit` and use that name.
- **Should feel:** Like using the file's own helpers. Nothing about the host's git config reaches the fixture.
- **Should understand:**
  - The pinned env points `GIT_CONFIG_GLOBAL` and `GIT_CONFIG_SYSTEM` at an empty file and fixes the author and committer, and is built on every call, so keys a template build adds to `process.env` are seen.
  - `EMPTY_GIT_CONFIG` is a getter: read it as `pinned.EMPTY_GIT_CONFIG` where it is used; the file is created on first read, not when the module loads.
  - A test that reads `user.email` or `user.name` back with `git config` trips `tests/fixture-identity-config-scan.test.js` unless its file is on that scan's `ALLOWLIST` with a reason.
- **Red flags:**
  - A copied env-pinning block (`GIT_CONFIG_GLOBAL`, author variables) in the test file.
  - Redefining a file's existing `git` helper, which every other test in that file calls with its own signature.
  - The identity scan failing with a file name that is not on the allowlist.

### 4. Read a red run
- **URL:** the output of `node tools/run-tests.js <file>`.
- **Action:** When the warm-call test fails, read its assertion message.
- **Should feel:** Specific. The message says how many git processes the traced call started and their argv, for example `the traced call started 1 git process(es): [["git","rev-parse","--git-dir"]]`.
- **Should understand:** The usual cause is a builder that runs git after it copies the template (a `rev-parse`, a `config` write) instead of inside the template build. Move that command into the build callback, or write the value without git.
- **Red flags:** Loosening the assertion or retracing a different call to get back to green. The check is exact on purpose: any trace file fails it.

### 5. Measure the file
- **URL:** `GIT_TRACE2_EVENT=<absolute empty dir> node tools/run-tests.js <file>`, then count the files in that dir and the `start` events whose argv begins `git init`.
- **Action:** Measure the destination file before and after the change, back to back on the same machine.
- **Should feel:** Like confirming nothing moved: the file's `git init` count is the same as before, and its total git processes rise by at most the few the new test's assertions run.
- **Should understand:** A higher `git init` count means the test builds a template the file did not build before. Either the key differs from the file's other calls (back to step 1) or this is a new variant, which the change names.
- **Red flags:** A rise of a whole template's worth of processes (the template's `git init`, `add`, `commit`, and so on) for one new test.

## Origin
- Created during build of #5846, which added `tests/helpers/git-trace.js` and `tests/helpers/pinned-git.js`, moved every per-fixture warm-call and content test out of `tests/helpers-git-template.test.js` into the test files that already build each template, and wrote the placement rule into the header of `tests/helpers/git-template.js`. Summed over the touched files, git processes fell from 11,146 to about 10,040 with every test kept.
- Related: `run-the-suite-alongside-sibling-sessions-3969.md` (template-copied fixture repos and the runner's git template), `call-a-plugin-bin-cli-in-process-from-a-test-5374.md` (the before/after measuring habit for test-cost changes).
