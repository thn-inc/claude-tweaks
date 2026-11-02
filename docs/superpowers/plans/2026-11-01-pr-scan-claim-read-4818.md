# pr-scan item 10 drops claims on API errors (#4818) Implementation Plan

**Goal:** `_shared/github-pr-scan.md` item 10 (Unsettled run) reads each claim blob with one `gh api .../contents/claims/...` REST call and `2>/dev/null`, so an HTTP 403 (rate limit) reads as "no claim": a sweep reported 0 live claims when 15 were live, and spent the whole core quota. Read the claims with the batched git reader instead, and report a failed read as could-not-read, never as absent.

**Spec:** `.claude-tweaks/pipelines/2026-11-01T204641-record-4818/work/4818-spec.md` (materialized from GitHub issue #4818)

**Plan-time design note (departure from the spec's Key Files, logged in decisions.md):** the spec lists only `plugin/skills/_shared/github-pr-scan.md`. That file is 52,073 bytes against the 52,500-byte Read-limit rail (`RAIL_BYTES`, `plugin/bin/lib/skill-audit/budgets.js`) — 427 bytes of headroom. An inline `node -e` batched read (the shape `plugin/skills/tidy/issue-claims-backstops.md`'s "Batched read" section uses) plus could-not-read handling would push it over the rail. So the read moves into one small tested CLI, `plugin/bin/read-claims.js`, following the precedent of `plugin/bin/list-claims.js` (#3098 — "the fix lives in one tested place, not re-derived at each prose call site"). The prose shrinks to one CLI call, and the CLI is what the reproduction test exercises.

---

### Task 1: Read item 10's claims through the batched git reader and report unread claims as could-not-read

**Files:**
- Create: `plugin/bin/read-claims.js`
- Modify: `plugin/skills/_shared/github-pr-scan.md`
- Modify: `docs/plugin-structure.md`
- Test: `tests/read-claims-cli.test.js` (create)
- Test: `tests/sweep-backstop.test.js` (modify — item 10 section)

- [ ] **Step 1: Failing test** — write the tests below and run them before Step 2. Both must go red at base.

  `tests/read-claims-cli.test.js` (size it like `tests/list-claims-cli.test.js`, ~100-200 lines), against `run(argv, deps)` with an injected git `runner`:
  1. **Reproduction (#4818):** the registry fetch fails with a transport error (e.g. a thrown error whose text is `HTTP 403 ... rate limit`) → exit 3, and stdout carries exactly one row `{"number":null,"state":"could-not-read","reason":"transport-failure"}` — never empty output, which a consumer would read as "zero claims".
  2. `git cat-file --batch` fails → every claim the `ls-tree` listed gets a `{"number":N,"state":"could-not-read","reason":"transport-failure"}` row; exit 0.
  3. Happy path: a live blob, a stale blob, a tombstone (`released: true`) and an unparseable blob → rows with `state` `live`/`stale`/`tombstone`/`unreadable` (the `classifyClaimBlob` vocabulary, `plugin/bin/lib/issues/claims.js`), `claimedAt` present on the parsed ones; rows sorted by number.
  4. `claims-registry` missing on the remote (fetch error text `couldn't find remote ref`, `classifyGitError` kind `missing-branch`) → exit 0, no rows (an empty registry, as `list-claims.js` treats one).
  5. The scratch ref the fetch created is deleted (`update-ref -d`) on success and on a rev-parse/read failure.
  6. `--help` → exit 0 with usage; an unknown flag → exit 1.
  7. One real-git round trip with `defaultRunner`: a temp bare origin with a `claims-registry` branch holding two `claims/issue-{n}.json` blobs, a clone as cwd, the CLI spawned as a child process → two rows. (Fixture style: `tests/bin-lib/issues/claims-git-cas.test.js` lines ~88-100.)

  `tests/sweep-backstop.test.js` (item 10 section, next to the existing item 10 tests):
  - Item 10 no longer reads a blob per call: `ITEM10` contains no `contents/claims/` and names `bin/read-claims.js`.
  - Run item 10's evaluation `node -e` script (the one that reads `$PR_SCAN_UNSETTLED_CLAIMS`/`$PR_SCAN_UNSETTLED_LABELLED`/`$PR_SCAN_UNSETTLED_PRS`) against fixture files, substituting those three variable names with temp paths the way `isolateItem9` does for item 9 (longest name first), with `UNSETTLED_AGE=24` and an empty PR list (so no `gh pr view` call runs):
    - a registry-level could-not-read row plus one old `bot:in-progress`-labelled issue → output carries a `[unsettled] claims-registry could not be read` row and no `no PR found` row for the labelled issue;
    - a per-blob could-not-read row for `#N` plus `#N` labelled → a `[unsettled] #N: claim blob could not be read` row and no label-drift `no PR found` row for `#N`;
    - control: a `live` row 25h old with no PR → the existing `[unsettled] #N: no PR found` row still prints (proves the fixture discriminates).

- [ ] **Step 2: Implement**

  **`plugin/bin/read-claims.js`** — a `run(argv, deps)` CLI per `.claude/skills/gh-api-module-pattern/cli-wrapper-contract.md` (read it; `plugin/bin/list-claims.js` is the nearest model):
  - Usage: `read-claims.js [--remote <name>] [--help]` (default remote `origin`). Run from the repo checkout (git uses the cwd).
  - Fetch `CLAIMS_BRANCH` into a unique scratch ref (`refs/claims-scan-read/{pid}-{ts}-{rand}`), `rev-parse` it, delete it in a `finally` — the same dance as `readClaimBlobGit` in `plugin/bin/lib/issues/claims-git-cas.js`. Use that module's exported `defaultRunner` (it already sets `windowsHide` and the git timeout) and `classifyGitError` (`missing-branch` → empty registry, exit 0).
  - `readClaimBlobsGitBatch({ tip, runner })` with `issueNumbers` omitted (full keyspace: one `ls-tree` + one `cat-file --batch`). A top-level `failure`, a failed fetch or a failed rev-parse → print the one registry row `{"number":null,"state":"could-not-read","reason":...}` (carry `timedOut: true` when the result has it), a one-line `read-claims.js: ...` message on stderr, exit 3.
  - Per result: `failure` set → `{"number":N,"state":"could-not-read","reason":failure}`; `absent` → no row; otherwise `classifyClaimBlob(content, now)` → `{"number":N,"state":c.state}` plus `claimedAt` when the content parses as an object carrying it. One JSON object per line on stdout, sorted by number. Exit 0.
  - Exit codes: 0 read (including an empty or missing registry, and per-blob could-not-read rows), 1 malformed invocation, 3 the registry could not be read. Header comment states the contract, as `list-claims.js`'s does.

  **`plugin/skills/_shared/github-pr-scan.md` item 10:**
  - Step 1 (currently the `list-claims.js | while read -r FNAME` loop with the per-blob `gh api "repos/{owner}/{repo}/contents/claims/${FNAME}?ref=claims-registry" ... 2>/dev/null` read): replace with one call, `node "${CLAUDE_PLUGIN_ROOT}/bin/read-claims.js" > "$PR_SCAN_UNSETTLED_CLAIMS"`, and rewrite the step's comment: the batched git read (the reader tidy's Step 4.7 backstops prefer, `tidy/issue-claims-backstops.md`), live/stale kept, tombstones dropped, a blob or registry that could not be read kept as a `could-not-read` row — an unread claim is never an absent one (#4818). Keep the comment short.
  - The evaluation script: build `claimed` from rows whose `state` is `live` or `stale` (mapped to `{ number, claimedAt, source: 'claim' }`, the shape the rest of the script uses); print one `[unsettled]` row per `could-not-read` row — `[unsettled] claims-registry could not be read ({reason}) — live claims unknown, label-only candidates not judged; re-run once readable` for the registry row, `[unsettled] #{n}: claim blob could not be read ({reason}) — claim state unknown, not read as absent; re-run once readable` for a blob row; count a could-not-read number as claimed when filtering label-only candidates (it is not label-drift evidence); and when the registry row is present, judge no label-only candidates at all.
  - Update the sentence that says step 1's output "carries only `number`, `claimedAt` and `source`" to match the new row shape.
  - Output Contract's `[unsettled]` bullet: add the two could-not-read row shapes.
  - The Transport split paragraph near the top (it says item 10's claims-registry read has an MCP path via `_shared/issue-claims.md`'s "List all claims"): say the first fetch reads over git, not `gh`, and that MCP path applies only without git access to `claims-registry`. Minimal wording change.
  - **Byte ceiling:** the file must stay at or under 52,500 bytes (`wc -c`); it is 52,073 at base. Measure after editing. If over, cut wording inside item 10 only.

  **`docs/plugin-structure.md`:** add a `node plugin/bin/read-claims.js [--remote <name>]` line beside the `list-claims.js` line (~line 221) stating what it reads, its row shape and exit codes, and its test file; add `plugin/bin/read-claims.js` to the `plugin/bin/lib/issues/` paragraph's "Consumed by ..." list.

- [ ] **Step 3: Run** the Step 1 tests — PASS. Also run these neighbors in isolation (`node --test <file>`) and quote their raw summary lines: `tests/list-claims-cli.test.js`, `tests/github-pr-scan-unsettled-node-budget.test.js`, `tests/skill-size-single-source.test.js`, `tests/bin-lib/skill-audit/context-cost.test.js`, `tests/bin-lib/skill-audit/budgets.test.js`, `tests/skill-fence-guard-shapes.test.js`, `tests/windows-hide-spawn-conformance.test.js`, `tests/git-path-read-conformance.test.js`, `tests/claude-plugin-root-require-conformance.test.js`, `tests/issue-claims-pr-scan-composition.test.js`, `tests/session-tmp-root-migration.test.js`, `tests/gh-host-seam-conformance.test.js`, `tests/bin-lib/issues/claims-git-cas.test.js`. The full suite runs centrally afterwards.

- [ ] **Step 4: Commit** — one commit, `Read pr-scan item 10 claims in one git batch — a failed read is could-not-read, never absent`, body `refs #4818`.

---

## Self-review

- **Spec coverage:** Deliverable (batched git reader; failed read = could-not-read) → Step 2's CLI and item 10 edits. Acceptance Criterion (a test reproduces the behavior and passes after the change) → Step 1's reproduction test 1 and the sweep-backstop could-not-read cases, both red at base.
- **Placeholders:** none.
