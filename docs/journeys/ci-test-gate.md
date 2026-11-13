---
files:
  - .github/workflows/test.yml
  - .github/workflows/test-impact-map.yml
  - tools/run-tests.js
  - tools/merge-shard-logs.js
  - tools/test-durations.json
---

# CI Test Gate on Pull Requests and Main

**Persona:** claude-tweaks maintainer or Claude session opening or updating a pull request, or merging one to `main`.
**Goal:** Every PR runs the full `npm test` suite before it can merge, fast enough that a pipeline's phase pushes are not waiting on it, and every push to `main` runs the full suite once more, so a red suite is visible on the PR or the commit instead of depending on someone remembering to run it locally.
**Entry point:** Opening or updating a pull request; merging to `main`.
**Success state:** On a PR, four `shard i/4` checks and one `test` check go green; on `main`, the `test-impact-map` run goes green. A failing suite turns the same checks red with the failing assertions in their logs.

## Steps

### 1. Open or update a PR — terminal
- **Action:** Push a branch with an open pull request against `main`.
- **Expect:** The `test` workflow starts within seconds with four `shard i/4` jobs in parallel. A superseded run on the same ref is cancelled automatically (`concurrency` group) rather than queueing behind it.

### 2. Read the shards — GitHub UI or `gh pr checks`
- **Action:** Open the PR's checks panel.
- **Expect:** Each shard job runs Node 20 with no install step (the plugin ships zero npm dependencies, and `node --test` is built in). Its log starts with a `run-tests.js: shard i/4 — N of M files, estimated Xs of Ys` line on stderr: the files are dealt across shards by `tools/test-durations.json`, so the shards finish at about the same time. Every shard runs to the end even when another is red (`fail-fast: false`).

### 3. Read the merged log — the `test` job
- **Action:** Open the `test` job, which starts once every shard has finished.
- **Expect:** Its "Print the whole suite's log" step shows every shard's TAP output followed by one summary (`# tests`, `# pass`, `# fail`) that sums them. This is the log `verify.js --scope` takes the suite's verdict from (`.claude-tweaks/verify-scope.json`'s `ci` source). The job is red when any shard is red, and a `# merge-shard-logs:` line before the summary names any shard whose log is missing, so partial counts never read as a full run.

### 4. If it's red — read the log, don't rerun blindly
- **Action:** Find the `not ok` block in the `test` job's log (or the red shard's own log); it names the failing assertion and file.
- **Expect:** A genuine failure reproduces locally with `npm test -- --full` (or `node --test <file>`), because a plain `npm test` runs only the impact-selected subset and may not select the failing file. A failure that passes locally and only flaps under load is the #104 class: surface it on that issue rather than retrying until green, so the gate stays trustworthy.

### 5. Merge to `main` — the post-merge run
- **Action:** Merge the PR.
- **Expect:** `test.yml` does not run again; `test-impact-map.yml` runs the full suite once under the read tracer and turns red when the suite is red, so a commit that breaks `main` still shows on the commit. `windows-regression.yml` runs the suite on Windows separately.

### 6. Keep the shards balanced — after adding or splitting slow test files
- **Action:** `node tools/run-tests.js --record-durations tools/test-durations.json` on a quiet machine, then commit the file.
- **Expect:** The file maps each test file to its measured time. A file it does not list weighs the median measured file, and the shard line on stderr counts how many were unmeasured; `tests/run-tests-shard.test.js` fails when the file names a test file that no longer exists.

## Origin
- Updated during build of #5319: step 4 now reproduces a CI failure with `npm test -- --full`, because a plain local `npm test` runs only the impact-selected subset (`run-a-plain-npm-test-on-the-impact-subset-5319.md`). CI runs the whole suite on every PR and is what catches a test the map failed to select.
