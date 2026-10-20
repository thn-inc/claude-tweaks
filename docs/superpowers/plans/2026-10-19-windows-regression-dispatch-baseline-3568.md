# windows-regression: baseline workflow_dispatch runs against the integration branch (#3568) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `workflow_dispatch` run of `.github/workflows/windows-regression.yml` compares against the merge-base with the integration branch instead of `HEAD^1`; `push` runs are unchanged.

**Architecture:** Only the `windows` job's "Resolve the comparison base" step (`id: base`) changes. It branches on `github.event_name`: `workflow_dispatch` resolves `git merge-base HEAD origin/{default branch}`; `push` keeps the existing `github.event.before` logic byte-for-byte. Either path that resolves nothing usable falls through to the existing `HEAD^1` fallback. The test file gains a helper that extracts this step's literal `run:` script and executes it with `bash` against a throwaway git fixture, so the assertions exercise the exact lines a runner executes.

**Tech Stack:** GitHub Actions YAML, bash, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-10-19T185632-record-3568/work/3568-spec.md`

## Global Constraints

- No `${{ }}` inside any `run:` script body. Every Actions expression reaches the script through the step's `env:` (pinned by the existing test `no ${{ }} is interpolated into any run: script body`).
- The `push` path stays as it is: `PUSH_BEFORE`, the all-zero/`cat-file` guard, and `HEAD^1 fallback` (AC2.1).
- The step still writes `BASE=` to `$GITHUB_ENV`, `base=` to `$GITHUB_OUTPUT`, and prints `Comparison base: {sha} ({source})`.
- No `pull_request` trigger, and `workflow_dispatch: {}` takes no new inputs. The spec's optional `base` input is not added (YAGNI; the merge-base default satisfies both Deliverables).

## Review Focus

1. A dispatch on `main` itself: the merge-base equals `HEAD`, so a baseline of `HEAD` would adjudicate every failure as pre-existing. Expected: fall back to `HEAD^1` (today's behavior for a `main` dispatch). Test: `dispatch on the integration branch itself falls back to HEAD^1`.
2. A dispatch where `origin/{branch}` is absent or `merge-base` fails: expected `HEAD^1 fallback`, never an empty base. Test: `dispatch with no origin integration ref falls back to HEAD^1`.
3. A push with an all-zero `before` (new-branch push): unchanged `HEAD^1 fallback`. Test: `AC2.1: push with all-zero before falls back to HEAD^1`.
4. A CRLF checkout on windows-latest: the extracted script must have `\r` stripped before bash runs it. The helper reads `WORKFLOW` (already LF-normalized through `readText`).
5. The default-branch name comes from the event payload (`github.event.repository.default_branch`), not a hardcoded `main` in the script. The test passes `INTEGRATION_BRANCH=main` through env, the same way the runner does.

---

### Task 1: Dispatch-aware comparison base

**Files:**
- Modify: `.github/workflows/windows-regression.yml` (header comment lines 1-10; step `id: base`, lines 80-93)
- Modify: `docs/journeys/learn-of-a-windows-regression-after-merge.md:27` (the "Should understand" sentence that lists the base step's sources)
- Test: `tests/windows-regression-file-issue.test.js` (after the existing `F2:` test)

**Interfaces:**
- Consumes: the test file's existing `WORKFLOW`, `jobBlock(name)`, `stepContaining(block, marker)`, `runScripts(text)`.
- Produces: `runBaseStep(t, { repo, env })`, a test-local helper that returns `{ base, stdout }`. It extracts the `id: base` step's `run: |` body (dedented), runs `bash -c` in `repo` with `GITHUB_ENV`/`GITHUB_OUTPUT` pointed at temp files plus the caller's env, and reads `base=` from the output file. It skips when `bash --version` fails.

- [ ] **Step 1: Write the failing tests.** Add a fixture builder `fixtureRepo()` that creates a temp git repo: commit `A` on `main`, then branch `feature` with commits `B` ("fix") and `C`, checked out at `C`, plus `git update-ref refs/remotes/origin/main A`. Use `-c user.name=ci -c user.email=ci@invalid.example` on every commit. Tests:
  - `AC1.1: a workflow_dispatch run on a feature branch baselines against the merge-base with origin/main, not HEAD^1`: env `EVENT_NAME=workflow_dispatch`, `PUSH_BEFORE=''`, `INTEGRATION_BRANCH=main` → `base === A`, `base !== B`, stdout matches `/Comparison base: [0-9a-f]{40} \(merge-base with origin\/main\)/`.
  - `dispatch on the integration branch itself falls back to HEAD^1`: check out `main` after adding a second main commit `M` (and `origin/main = M`) → `base === A`, stdout includes `(HEAD^1 fallback)`.
  - `dispatch with no origin integration ref falls back to HEAD^1`: `INTEGRATION_BRANCH=nope` → `base === B`, stdout includes `HEAD^1 fallback`.
  - `AC2.1: a push run still baselines against github.event.before`: `EVENT_NAME=push`, `PUSH_BEFORE=A` (on the feature fixture) → `base === A`, stdout includes `(push event before)`.
  - `AC2.1: push with all-zero before falls back to HEAD^1`: `PUSH_BEFORE=0000000000000000000000000000000000000000` → `base === B`.
  - Extend the existing `F2:` test: the base step's `env:` carries `EVENT_NAME: ${{ github.event_name }}` and `INTEGRATION_BRANCH: ${{ github.event.repository.default_branch }}`, and the script contains `git merge-base HEAD`.

- [ ] **Step 2: Run them, expect failures.**
  Run: `node --test tests/windows-regression-file-issue.test.js`
  Expected: FAIL. The AC1.1 test gets `base === B` (HEAD^1) and the F2 extension finds no `EVENT_NAME`. The two AC2.1 tests and the `nope` test already pass, which is expected: they pin today's unchanged behavior.

- [ ] **Step 3: Implement.** In the `id: base` step add env `EVENT_NAME: ${{ github.event_name }}` and `INTEGRATION_BRANCH: ${{ github.event.repository.default_branch }}`. Wrap the existing push logic in the `else` arm of `if [ "$EVENT_NAME" = "workflow_dispatch" ]`. The dispatch arm sets `B` to `git merge-base HEAD "origin/$INTEGRATION_BRANCH"` (stderr suppressed, failure → empty) and `SOURCE="merge-base with origin/$INTEGRATION_BRANCH"`, but only when that result is non-empty and differs from `git rev-parse HEAD`. Otherwise `B` stays empty. After the `if`, one shared guard `[ -z "$B" ]` → `B=$(git rev-parse HEAD^1)`, `SOURCE="HEAD^1 fallback"`. The push arm's existing invalid-`before` test now just empties `B` so that this shared guard handles it. The `echo`/`GITHUB_ENV`/`GITHUB_OUTPUT` lines are unchanged. Update the header comment: `HEAD^1` is the fallback for a force-push or new-branch push, and a `workflow_dispatch` run uses the merge-base with the default branch (so a branch's own earlier fix is not in the base), falling back to `HEAD^1` when dispatched on the default branch itself. Update the journey line 27 parenthetical to `(push event before, merge-base with origin/main for a manual dispatch, or the HEAD^1 fallback)`.

- [ ] **Step 4: Run the tests, expect PASS.**
  Run: `node --test tests/windows-regression-file-issue.test.js`
  Expected: PASS, 0 fail. Go-red control: temporarily revert the step's `run:` body with `git show HEAD:.github/workflows/windows-regression.yml` and confirm AC1.1 fails. Then restore it.

- [ ] **Step 5: Commit.**
```bash
git add .github/workflows/windows-regression.yml tests/windows-regression-file-issue.test.js docs/journeys/learn-of-a-windows-regression-after-merge.md
git commit -m "Baseline workflow_dispatch windows-regression runs on the merge-base — HEAD^1 hid a branch's own earlier fix (refs #3568)"
```

## Self-review

- Spec coverage: Deliverable 1 (merge-base for dispatch) is Step 3's dispatch arm. Deliverable 2 (log base and source) is the `SOURCE` string plus the existing echo, asserted by AC1.1's stdout match. AC1.1 and AC2.1 are each named tests.
- Placeholders: none.
