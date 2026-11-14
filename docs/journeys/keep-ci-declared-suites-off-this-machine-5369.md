---
files:
  - plugin/bin/verify.js
  - plugin/bin/lib/verify/args.js
  - plugin/bin/lib/verify/ci-source.js
  - plugin/bin/lib/verify/declaration.js
  - plugin/skills/test/ci-source.md
  - .claude-tweaks/verify-scope.json
---

# Keep CI-Declared Suites off This Machine

**Persona:** a maintainer whose project declares a `ci` source for its test suite in `.claude-tweaks/verify-scope.json`, running several pipeline sessions on one laptop, who wants the whole suite to run only in the PR's CI job.
**Goal:** a CI-declared suite never runs on this machine unless the maintainer asks for it, and a run CI cannot answer says so instead of quietly running the suite here.
**Entry point:** adding `"localRuns": "on-request"` beside the `ci` block, then any `node plugin/bin/verify.js` call.
**Success state:** a pushed branch's `--scope` run prints `CI: tests — taken from …` and runs no test here; an unpushed one exits 3 with `no verdict yet` on its first stderr line; `--local` runs the suite here on purpose.

## Steps

### 1. Opt in
- **URL:** `.claude-tweaks/verify-scope.json`
- **Action:** Add the top-level key `"localRuns": "on-request"` next to the existing `ci` block.
- **Should feel:** One line, and nothing else to configure.
- **Should understand:** The key is valid only with a `ci` block; any other value, or the key without `ci`, fails validation with an error starting `localRuns:`. A reader older than the key ignores it.
- **Red flags:** a declaration with the key and no `ci` block that still validates; the key accepted inside the `ci` block.

### 2. Verify before pushing
- **URL:** `verify.js --scope .claude-tweaks/verify-scope.json …` stdout/stderr, exit code
- **Action:** Run the scoped verification on a HEAD that is not yet the head of an open PR (or on a dirty tree).
- **Should feel:** An immediate, plain answer — no suite starts, no slot is taken, nothing heats the machine.
- **Should understand:** Exit 3 means "no verdict yet", never a test failure. Stderr line 1 names the suite and the reason (`head-not-pushed`, `dirty-tree`, …); the next two lines give the ways on: push and re-run, or re-run with `--local`. No `report.json` and no pass stamp are left behind, and later CI-declared suites are recorded `not-consulted`.
- **Red flags:** any local test process starting on an exit-3 run; a `report.json` from an earlier run still on disk after exit 3; exit 1 on an unanswered run.

### 3. Push and take the verdict from CI
- **URL:** `verify.js` stdout; the `verify` event in the run's `events.jsonl`
- **Action:** Push the branch, then run the same command again.
- **Should feel:** The same table as a local run, minutes faster, with the CPU left to sibling sessions.
- **Should understand:** A green job passes and a red job fails with its failing region from the CI log (downloaded with `--allow-escape-sequences`); a red job whose log cannot be downloaded fails the suite and names the run URL, and `--local` reproduces it here. The local flaky retry of allowlisted files still runs after a red job. The `verify` event records per suite whether CI answered and why not, and whether `--local` was passed.
- **Red flags:** a red job reported as a pass; the suite also running locally after a CI answer.

### 4. Run locally on purpose
- **URL:** `verify.js … --local`
- **Action:** Pass `--local` to reproduce a CI failure, or for a platform-specific change CI does not cover.
- **Should feel:** A deliberate choice, recorded as one.
- **Should understand:** `--local` never consults CI and runs each selected suite here (the impact subset, or the full command when selection falls back); stdout says `ran locally (local-requested)`. Without `--local`, an unscoped run or a `--stamp-suite` chunk that names a CI-declared suite exits 2 and names the flag to pass; `types`, `lint` and suites with no `ci` source run as before.
- **Red flags:** `--local` making a `gh` call; an unscoped `--cmd lint=…` run refused.

## Origin
- Created during `/claude-tweaks:build` of record #5369 (2026-11-13), from the maintainer-Mac measurement of 91 `verify` runs in which unscoped runs, unpushed HEADs and unreadable CI logs repeated whole-suite work the PR's CI job did minutes later.
- Related: `docs/journeys/take-the-full-suite-verdict-from-ci-4347.md` (the CI source without the key), `docs/journeys/run-a-plain-npm-test-on-the-impact-subset-5319.md` (the plain `npm test` half).
