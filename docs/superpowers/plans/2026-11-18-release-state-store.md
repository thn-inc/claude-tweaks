# Release-State Branch Store Implementation Plan

**Goal:** A `release-state` branch holds small JSON state files written compare-and-set on both transports, and its first file, `reviewed-through.json`, is a marker that only moves forward along the integration branch's first-parent line, read and moved by `plugin/bin/release-state.js marker read|advance|init|reset`.

**Architecture:** `plugin/bin/lib/release-state/store.js` is the one writer of every file on the branch: git compare-and-swap first (`--force-with-lease` on the branch tip), the contents API (PUT carrying the blob sha) when git cannot, the branch created from the default branch tip when missing. `plugin/bin/lib/release-state/marker.js` holds the marker's shape, the first-parent descent check (local clone first, the compare API without one) and the three operations over an injected store and history. The CLI resolves the repo, wires the transports, and has a gh-free emit mode for the MCP path, where the agent reads and writes through MCP and the CLI computes. `plugin/skills/_shared/release-state.md` is the contract.

**Tech Stack:** Node 20+ CommonJS, `node:test`, `git`, `gh api`, markdown contract prose.

**Spec:** `.claude-tweaks/pipelines/2026-11-17T204803-spec-5881-5882-5883/spec-5883/work/5883-spec.md` (record #5883; parent #5838; #5884 builds the merge-pause flag on this store).

**Scope keywords:** release-state, reviewed-through, readStateFile, writeStateFile, advanceMarker

## Global Constraints

- **Frozen public contract** (spec Gotchas): the branch name `release-state`, the file name `reviewed-through.json`, the marker shape and the CLI exit codes. The marker's `version` field is the expand-contract seam. Exit codes, as numbers: **0** ok, **1** refused, **2** usage, **3** unreadable, **4** contested, **5** insufficient-history, **6** orphaned. `EXIT = Object.freeze({ OK: 0, REFUSED: 1, USAGE: 2, UNREADABLE: 3, CONTESTED: 4, INSUFFICIENT_HISTORY: 5, ORPHANED: 6 })`. Exit 3 also covers a write that failed for a non-contest reason (a refused push and contents-API PUT, an uncreatable branch), the same overload `release-block.js` documents for its exit 3. This is the spec's own domain vocabulary, not one of the four base vocabularies in `.claude/skills/gh-api-module-pattern/cli-wrapper-contract.md`. The CLI header says so. Change any of it only by expand-contract.
- The marker file is exactly `JSON.stringify({ version: 1, sha, advancedAt, run }, null, 2) + '\n'`. `sha` is 40 lowercase hex. `advancedAt` is `new Date().toISOString()` (ISO-8601 UTC). `run` is the caller's run id, or `"init"` for `marker init`. A reader requires those four keys, ignores any others, and reads every other shape as unreadable: never absent, never a marker.
- **Never write state to `main`** (spec Gotchas). Every push refspec names `refs/heads/release-state`, and every contents-API write carries `branch=release-state`. The state push passes `--no-verify`: the branch carries no code, so a consumer's pre-push suite must not run on every marker write. This is a deliberate difference from `claims-git-cas.js`.
- Every commit message written to `release-state` is one line, at most 200 characters, with no `#`. The store refuses any other message with `{ok:false, failure:'invalid-message'}`. The reason: the generated `track-issue-fixes.yml` job prefilter fires only on a `#` together with a closing keyword (`PREFILTER_EXPRESSION`, `plugin/bin/lib/issue-branch-tracking.js:74`). A reset reason such as `fix #12` would otherwise label issue #12 `fix-on-release-state`.
- No extraction from `claim-store.js`. Its read, write and bootstrap functions are bound to `CLAIMS_BRANCH` and `claimPath(issueNumber)`, so lifting them changes a signature on the fleet's most-contended write path, which is not the pure move the spec allows. `store.js` imports these exports unchanged: `classifyGhApiError`, `refusalText`, `casBackoffMs`, `defaultSleep` and `isWellFormedClaimContent` from `plugin/bin/lib/issues/claim-store.js`, and `classifyGitError` and `errText` from `plugin/bin/lib/issues/claims-git-cas.js`. It mirrors the algorithm of `readClaimBlob`, `writeClaimBlob`, `readClaimsBranch` and `ensureClaimsBranch`, parameterized on file name. Each mirrored function's header names its twin: "mirrors claim-store.js's X; if either changes, check the other". `lib-module-split` therefore does not apply, and the claims-registry tests are untouched.
- `store.js`'s text, comments included, never contains `claimPath(`, `claimFilePath(` or `claims/issue-`. `tests/claims-single-write-path.test.js` treats any `plugin/bin` file that holds `'PUT'`, an interpolated `contents/${…}` path and one of those strings as a second claims writer.
- REST paths use the bare `owner/repo` slug, never `repoSlug(spec)`. A host-qualified slug inside a REST path is the open defect #4988 (`tests/helpers/gh-host-seam.js:158`). The host travels as a trailing `--hostname {host}` on every `gh api` call when the host is not `github.com`. Facts from read-only probes run against `thn-inc/claude-tweaks` with gh 2.103.3 on 2026-11-18:
  - `gh api "repos/thn-inc/claude-tweaks/contents/reviewed-through.json?ref=release-state"` exits 1 with `No commit found for the ref release-state (HTTP 404)`.
  - A missing file on an existing ref exits 1 with `Not Found (HTTP 404)`.
  - `repos/thn-inc/claude-tweaks/branches/release-state` exits 1 with `Branch not found (HTTP 404)`.
  - `classifyGhApiError` maps all three to `{failure:null, status:404}`, and an inaccessible repo returns the same 404. A contents 404 is therefore absent only once the branch read (and, for a 404 there, a `repos/{slug} -q .full_name` read) confirms it.
- Compare API, read-only probes on the same date:
  - `repos/thn-inc/claude-tweaks/compare/e97c8ab6390db6dff021ae0937dffa4a7201603d...fb5f4a6a9b0c8f496f56cc0d1e3fad79622ff784?per_page=2&page=1` with `-q '{status, total_commits, commits: [.commits[] | {sha, parents: [.parents[].sha]}]}'` returned `status:"ahead"`, `total_commits:3` and 2 commits, oldest first, each with its parents. `page=2` returned the third.
  - The reversed range returned `status:"behind"`, `total_commits:0`.
  - An unknown base sha exits 1 with `Not Found (HTTP 404)`.
- First-parent descent (merge-shape-landed-proof): membership comes from `git rev-list --first-parent --end-of-options {tip} --`, and direction from `git merge-base --is-ancestor --end-of-options {a} {b}`. Both were probed with git 2.56.0. **This repo's own checkout is shallow**: `git rev-parse --is-shallow-repository` printed `true`, with one boundary in `.git/shallow` and 4,530 first-parent commits on `origin/main`. So a shallow clone answers every question whose shas it holds, and only a miss there is `undetermined` (exit 5). A shallow clone is never answered "refused" or "orphaned" on a miss. A blanket "shallow means exit 5" rule would fail every advance on the maintainer's machine.
- The integration branch is `--branch <name>`, default `main`, validated by `plugin/bin/lib/branch-name.js`'s `isValidBranchName` (consumer-portability: a test runs with `--branch trunk`). The marker file does not record the branch. A marker read against another branch reads as orphaned, which is the safe answer.
- `run` ids match `/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/`, and `init` is reserved for `marker init`. A reset `--reason` matches `/^[^\r\n#]{1,200}$/`.
- Run tests only with `node tools/run-tests.js <files>`. CI runs Node 20, so use no API newer than Node 20. Every commit message is `{Verb} {what} — {detail} (#5883)`, then a blank line, then `Claude-Session: https://claude.ai/code/session_01QXpjcUQkbENmsccXLYNwCm` as the last line.
- Size: `plugin/skills/_shared/release-state.md` ≤ 10,000 B. That is far under `RAIL_BYTES` = 52,500 (`plugin/bin/lib/skill-audit/budgets.js`), so the file keeps more than 42,000 B of headroom. No other skill file grows.
- Do not touch `docs/superpowers/plans/2026-11-17-*`, `2026-11-18-release-block.md`, anything under `.claude-tweaks/pipelines/`, `claim-store.js`, `claims-git-cas.js`, or their tests.

**Governing-skill rules, quoted verbatim.** `single-source-constant-guard` does not apply: no file here defines a skill-size number. `lib-module-split` does not apply: nothing is extracted (see above).

- gh-api-module-pattern (`SKILL.md`):
  - "**Every real spawn passes `windowsHide: true` in a form `tests/windows-hide-spawn-conformance.test.js` can see.**"
  - "**Every `gh` spawn wraps its options in `plugin/bin/lib/repo-resolve.js`'s `ghOptions(args, …)`.**"
  - "**A CLI that takes an explicit `--repo` pins that repo's host for every gh call it makes.**"
  - "A CLI that gates its origin this way joins both `ORIGIN_GATED` in `tests/gh-host-seam-conformance.test.js` and a `CLI_TABLE` row in `tests/helpers/gh-host-seam.js`"
  - "Tests never touch real `gh`: fake runners branch on the `args` shape (`isGraphQL`, `isPost`-style lazy helpers) and `throw new Error('unexpected ' + args.join(' '))` on anything unhandled — a wrong endpoint fails loudly instead of passing silently."
  - "**A module may carry two runner seams, and they have opposite failure contracts.**"
  - "**Bound every remote-contacting call on the seam; a local-only call owes no bound.**"
  - "**A read whose output scales with a range the module does not bound owes `maxBuffer: LARGE_MAX_BUFFER_BYTES` too, not only a push.**"
  - "**Creating a ref race-safely is a create-only write whose rejection is settled by a re-read, on each transport.**"
  - "**An outcome added to a seam with two transports is specified and tested per transport; an "X holds on the git transport only" deviation needs proof the other leg cannot reach it.**"
  - "**Any `-f`/`-F` field flips `gh api`'s default method from `GET` to `POST`.**"
  - "**A ref name interpolated into a REST path is encoded per segment.**"
  - "**A REST call with no `--repo`/`-R` flag needs `--hostname` instead, from the same `parseRepo` host field.**"
  - "**A `gh`-absent caller hands the CLI already-fetched records as a file; the CLI never tries to reach MCP itself.**"
  - "When an endpoint has no GitHub MCP equivalent, say so and name the real fallback; never invent an MCP row in `plugin/skills/_shared/github-write-transport.md`."
- gh-api-module-pattern (`git-seam.md`):
  - "**An argv array stops shell injection, not flag injection.**"
  - "**`--end-of-options` alone never resolves a revision — it needs `--verify` alongside it.**"
  - "**Every git call in a module that changes a repository (a `mv`, an `add`, a commit) runs under `repoPinnedEnv()`, including when the module takes an injected `env`.**"
  - "A module that builds commits on a scratch `GIT_INDEX_FILE` (`read-tree`, `apply --cached`, `write-tree`, `commit-tree`) layers the index onto `repoPinnedEnv()`, never onto `process.env`"
- gh-api-module-pattern (`cli-wrapper-contract.md`):
  - "It exports `run` and `realDeps`; `argv` is `process.argv.slice(2)`, and `run` returns an integer exit code or a Promise of one. The script entry is the file's last statement: `if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);`."
  - "A relative path is resolved against `deps.cwd()`, never left to `path.resolve` or `fs`"
  - "**Passing `tests/bin-lib/cli-entry-conformance.test.js` is not meeting the entry contract.**"
  - "**Codes above the base vocabulary are per-CLI domain outcomes and are not portable.**"
  - "**A value-taking flag given as the last argv element reads `undefined`, and a `!== null` presence check treats that as supplied.**"
  - "Every malformed-input class must actually reach its malformed code"
  - "**Filesystem reads in a new `plugin/bin/` CLI follow two rules no review is guaranteed to catch.**"
- lock-race-test-seam:
  - "Inject a read seam into the locked function (`appendRow({ readLedger })` in `plugin/bin/lib/stage-item/ledger.js`) and, from inside the seam, attempt the second write in-process."
  - "A race test not run against the lock-removed code has not been shown to test the lock."
  - "| Asserting two spawned children get distinct numbers and calling that the lock test | Serial execution also yields distinct numbers; the test passes without the lock |"
- merge-shape-landed-proof:
  - "A tip that is an ancestor of `origin/{integration-branch}` but absent from `git rev-list --first-parent origin/{integration-branch}` was merged by a merge commit."
  - "Make the failed lookup a distinct signal."
  - "Every failure resolves to "unproven", never to "proven"."
- git-ground-truth-test-env:
  - "**Prove both under the runner.** Run `node tools/run-tests.js --files-from <list>`, never only a bare `node --test`: the runner's env is part of the test's input."
  - "A fixture that needs a commit identity does not run `git config user.name` and `git config user.email`"
- mcp-agent-fetch-node-compute:
  - "**Inject the reader, do not branch the computation.**"
  - "**Validate the shape of every agent-written entry.**"
  - "**Distinguish the entry states explicitly.**"
- windows-checkout-test-parity:
  - "A test reads a tracked text file through `tests/helpers/read-skill.js`'s `readText`, never a raw `fs.readFileSync(p, 'utf8')`"
  - The anti-pattern row "Passing `os.devNull` to git as a config path": "Use the literal `/dev/null`". The fixtures use `tests/helpers/pinned-git.js`'s empty config file instead.
- bin-source-scan-conformance:
  - The anti-pattern row "An array literal of strings that starts with `'status'`". Keep `status` inside the one jq string, never as an array element.

## Review Focus

1. **A competitor's advance lands past our fetched `main` snapshot.** After a lost compare-and-set, the fresh marker names a commit newer than the history the CLI fetched. Expected: one refresh of the snapshot, then `at-or-past`, never `orphaned`. The test lives in Task 3.
2. **A contents-API 404 from an inaccessible repo.** Expected: unreadable (exit 3), never absent. The test lives in Task 1.
3. **`--repo` names a repo other than the cwd clone's origin.** Expected: no git call reaches `origin` (no fetch, no push), the store runs on the contents API only, and descent uses the compare API. The test lives in Task 5.
4. **A reset reason or a run id carrying `#`, a newline, or a leading `-`.** Expected: usage, exit 2, with no write. The tests live in Tasks 4 and 5.
5. **An MCP read the agent recorded wrongly** (an error object, `{content}` without `sha`, a bare string). Expected: exit 3, never absent and never a marker. The test lives in Task 5.

---

### Task 1: `store.js` reads and branch bootstrap

**Role:** integration
**Review risk:** high

**Files:**
- Create: `plugin/bin/lib/release-state/store.js`
- Create: `tests/bin-lib/release-state/fixtures.js` (template-copy git fixtures; no test runner import, in the same shape as `tests/bin-lib/issues/claims-git-cas-fixtures.js`)
- Test: `tests/bin-lib/release-state/store.test.js`

Waived `plugin/bin/lib/issues/claim-store.js`: read only. This task imports its exported primitives unchanged and mirrors `readClaimBlob`, `readClaimsBranch` and `ensureClaimsBranch`.
Waived `plugin/skills/_shared/issue-claims.md`: read only. It is the precedent contract that Task 6's MCP procedure follows ("The lock", "Bootstrap the branch").

**Interfaces:**
- Produces, all exported from `store.js`:
  - `RELEASE_STATE_BRANCH = 'release-state'`, `STATE_FILE_RE = /^[a-z0-9][a-z0-9-]*\.json$/`, `MAX_CAS_ATTEMPTS = 3`.
  - `readStateFile(deps, slug, name)` returns one of:
    - `{ state:'absent', lease: string|null, via:'git'|'contents-api', branchMissing: boolean }`
    - `{ state:'present', content, value, lease, via }`
    - `{ state:'unreadable', failure, reason, content?, lease?, via? }`. The last three keys appear only when the bytes were read but are not a JSON object (`failure` `'malformed-json'` or `'not-an-object'`). They let Task 4's forced reset carry a lease.
  - `classifyStateContent(content, { lease, via })` is the pure content step. It returns `{ state:'present', content, value, lease, via }`, or `{ state:'unreadable', failure:'malformed-json'|'not-an-object', reason, content, lease, via }`. Both `readStateFile` legs and Task 5's emit adapter call it, so the two transports classify bytes one way.
  - `ensureReleaseStateBranch(deps, slug)` returns `{ok:true, created, via}`, `{ok:false, reason}` or `{ok:false, reason, transient:true, failure}`, the shape of `ensureClaimsBranch`.
- `deps = { ghApi, gitRunner?, sleep? }`:
  - `ghApi(args) -> {stdout, failure, status, error?}` never throws (the claim-store contract). The caller has already appended any `--hostname`.
  - `gitRunner(args, { input, extraEnv } = {}) -> string` throws on failure. The runner owns its cwd and its repo-pinned env, and layers `extraEnv` on top of them.
- `slug` is a bare `owner/repo`. A host-qualified slug or a `name` failing `STATE_FILE_RE` throws `TypeError` (a caller bug).
- `lease`: on the git leg, the branch tip commit sha (null when the branch is missing); on the contents-API leg, the blob sha. It is never carried across transports.
- Fixtures (`fixtures.js`), each built once per process with `fromTemplate` and copied per call:
  - `makeLine({ branch = 'main' } = {})` returns `{ root, originDir, cloneA, cloneB, branch, P1, P2, P3, P4, P5, S }`. It builds a bare origin whose `{branch}` first-parent line is P1←P2←P3←P4←P5, with `{branch}` as the origin's default branch (`init --bare -b {branch}`). P4 is a `--no-ff` merge whose second parent is the side commit S. There is no `release-state` branch. Clones A and B carry identity written through `writeIdentity`. The template key includes the branch, so `main` and `trunk` are separate templates.
  - `commitRawState(fx, clone, name, text)` writes `text` byte for byte as `{name}` on `release-state` with plain git (hash-object, an index commit on the branch tip, or on the default tip when the branch is missing, then push), bypassing the store. It is the only way to plant content `createStateFile` refuses (`[]`, `null`, `'x'`, a raw `{`), and it returns the new tip sha.
  - `realRunner(cwd)` returns `(args, {input, extraEnv} = {}) => execFileSync('git', args, { cwd, env: { ...repoPinnedEnv(pinnedGitEnv()), ...extraEnv }, input, encoding:'utf8', stdio:['pipe','pipe','pipe'], windowsHide:true })`.
  - `rewriteMain(fx)` force-pushes `main` to P1←P2←P3′ and returns P3′.
  - `pushMainCommit(fx, clone)` returns a new first-parent tip P6.
  - `shallowClone(fx, depth)` runs `git clone --depth {depth} {pathToFileURL(originDir).href}`.

- [ ] **Step 1: Write the failing tests** in `store.test.js`. Contents-API leg: a fake `ghApi` that records args and throws `unexpected …` on any other shape, with no `gitRunner`. Git leg: `makeLine()` with `realRunner(cloneA)` and a throwing fake `ghApi`.
  - `AC4.1: a branchless remote reads absent with branchMissing, on both legs`.
    - Git: fetch fails with `couldn't find remote ref`. Expect `{state:'absent', branchMissing:true, via:'git', lease:null}` and zero `ghApi` calls.
    - Contents: the contents call 404s, the branch read 404s, and `repos/o/r -q .full_name` answers `o/r`. Expect `branchMissing:true`.
  - `AC4.1: a missing file on an existing branch reads absent without branchMissing`. Contents 404, then branch read answers `release-state`.
  - `AC5.1: an inaccessible repo is unreadable, never absent`. Contents 404, branch 404, repo 404. Expect `state:'unreadable', failure:'repo-unconfirmed'` (Review Focus 2).
  - `AC5.1: auth, 5xx, rate limit and gh-absent are unreadable`. Contents answers `{failure:'permission-denied', status:403}`, `{failure:'network-failure'}`, `{failure:'secondary-rate-limit', status:403}` and `{failure:'gh-absent'}`. Each is unreadable with that failure, and no branch read follows.
  - `AC8.2: malformed JSON and a non-object are unreadable but keep the lease`. Contents stdout `{"content":"{","sha":"<40 hex>"}` gives `failure:'malformed-json'`, `content:'{'` and `lease` = that sha. Content `[1]` gives `'not-an-object'`. The git leg gives the same after `commitRawState(fx, cloneB, 'reviewed-through.json', '{')`.
  - `store: a present file returns content, parsed value and lease on both legs`. Git lease = tip; contents lease = blob sha.
  - `store: a git transport failure falls back to the contents API`. The git runner throws `fatal: unable to access` on fetch, so the contents API is called once.
  - `store: argv`.
    - The contents read is exactly `['repos/o/r/contents/reviewed-through.json?ref=release-state', '-q', '{content: (.content | @base64d), sha: .sha}']`. No arg is `-f`/`-F`.
    - The branch read is `['repos/o/r/branches/release-state', '-q', '.name']`.
    - The git fetch is `['fetch', '-q', 'origin', 'release-state:refs/release-state-cas/…']`, matched by regex, and the scratch ref is deleted afterwards.
  - `store: a host-qualified slug or a bad file name throws TypeError`. Cases: `ghe.example.com/o/r`, `../x.json`, `a/b.json`, `main`.
  - `ensureReleaseStateBranch: creates the branch from the default tip`.
    - Git: the origin gains `release-state` at P5. The push argv carries `--no-verify` and `--force-with-lease=refs/heads/release-state:`.
    - Contents: `repos/o/r -q .default_branch`, then `repos/o/r/git/ref/heads/main -q .object.sha`, then `--method POST repos/o/r/git/refs -f ref=refs/heads/release-state -f sha=…`.
    - A 422 whose branch re-read is clean is `{ok:true, created:false}`.
    - A 422 whose re-read 404s is a refusal.
  - `store: no push ever names main`. Over every git call recorded in this file, each `push` argv's refspec ends `:refs/heads/release-state`.

- [ ] **Step 2: Run the tests and confirm they fail**
Run: `node tools/run-tests.js tests/bin-lib/release-state/store.test.js`
Expected: FAIL. The test file and the module do not exist yet.

- [ ] **Step 3: Implement `readStateFile`, `ensureReleaseStateBranch` and `fixtures.js`.**
  - Mirror the twins named in Global Constraints. The scratch refs are `refs/release-state-cas/{pid}-{Date.now()}-{random}`, deleted in `finally`.
  - The git read runs `show {tip}:{name}`. `classifyGitError`'s `missing-path` means absent at that tip.
  - Parse content with `JSON.parse`; a plain object is present.
  - Bootstrap push: `['push', '--no-verify', 'origin', `${base}:refs/heads/release-state`, '--force-with-lease=refs/heads/release-state:']`. A `contested` rejection is a lost race only when `ls-remote --heads origin refs/heads/release-state` lists the branch.
  - The contents leg encodes the default-branch ref per segment.
  - The module spawns nothing itself. Both runners are injected.

- [ ] **Step 4: Run the tests and confirm they pass**
Run: `node tools/run-tests.js tests/bin-lib/release-state/store.test.js tests/claims-single-write-path.test.js tests/windows-hide-spawn-conformance.test.js tests/path-guard-conformance.test.js tests/git-status-optional-locks.test.js tests/git-path-read-conformance.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 5: Discrimination.** Do three reverts, one at a time, restoring the code after each:
  - Make the contents 404 return absent directly. `AC5.1: an inaccessible repo…` must go red.
  - Drop the repo confirmation read. The same test must go red.
  - Make malformed JSON read as absent. `AC8.2` must go red.

- [ ] **Step 6: Commit**
  ```bash
  git -C "<worktree>" add -- plugin/bin/lib/release-state/store.js tests/bin-lib/release-state/fixtures.js tests/bin-lib/release-state/store.test.js
  git -C "<worktree>" commit -m "Add the release-state store's reads and branch bootstrap — absent only when confirmed, unreadable keeps the lease (#5883)" -m "Claude-Session: https://claude.ai/code/session_01QXpjcUQkbENmsccXLYNwCm"
  ```

### Task 2: `store.js` compare-and-set writes

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/release-state/store.js`
- Test: `tests/bin-lib/release-state/store.test.js`

**Interfaces:**
- Consumes: Task 1's `readStateFile`, `ensureReleaseStateBranch` and the fixtures.
- Produces:
  - `writeStateFile(deps, slug, name, { content, lease, via, expectedContent, message })` returns `{ok:true, via, commitSha?}`, `{ok:false, conflict:true}`, `{ok:false, branchMissing:true}` or `{ok:false, failure, reason}`. It is the conditional update of a file a read saw present, with `expectedContent` = that read's `content`.
  - `createStateFile(deps, slug, name, { content, message })` returns `{ok:true, created:true, via}`, `{ok:false, exists:true}` or `{ok:false, failure, reason}`. It is create-if-not-exists with no prior read of the file (spec Deliverable 1), and it creates a missing branch first.
  - Both refuse a `content` that `isWellFormedClaimContent` rejects (`failure:'invalid-content'`) and a `message` outside `/^[^\r\n#]{1,200}$/` (`failure:'invalid-message'`), before any call.

- [ ] **Step 1: Write the failing tests** (append them).
  - `AC4.1: the first write on a branchless remote creates the branch, then the file`.
    - Git leg: `createStateFile` on `makeLine()` returns `ok`.
    - The origin's `release-state` tip holds `reviewed-through.json` byte-equal to `content`.
    - Its first parent is P5, the default-branch tip.
    - The tip's message is the given message.
  - `createStateFile: an existing file is {exists:true} on both legs`.
    - Git: check `cat-file -e {tip}:{name}` before building the commit.
    - Contents: a PUT without `sha` that 422s, whose re-read is present with other content.
  - `createStateFile: a 422 whose re-read equals our content is ok (self-write)`.
  - `writeStateFile: a stale lease after an unrelated file changed retries and lands`.
    - Inject a `gitRunner` wrapper: on the first `push`, it first commits `merge-pause.json` to the origin from clone B.
    - Expect `ok`, two pushes, `sleep` called once (an injected fake), and both files present at the end.
  - `writeStateFile: a stale lease after this file changed is {conflict:true}`. Clone B rewrites `reviewed-through.json` first.
  - `writeStateFile: a git transport failure falls back to a contents-API PUT carrying the fresh blob sha, never the git tip`.
    - The PUT args contain `-f sha=<blob sha from the contents re-read>`, `-f branch=release-state` and `--method PUT`.
    - A re-read whose content differs from `expectedContent` is `{conflict:true}`, with no PUT.
  - `writeStateFile: contents-API 409/422 settle by re-read`. Our content gives `ok`. Other content gives `conflict`. A re-read that comes back `permission-denied` gives that failure. Absent with the branch missing gives `branchMissing`.
  - `store: invalid content and message are refused before any call`. Cases: content `'undefined'`, `'[]'`; message `'fix #12'`, `'a\nb'`, 201 chars.
  - `store: every PUT carries branch=release-state and every push refspec names release-state`. This extends Task 1's check over this task's calls.

- [ ] **Step 2: Run the tests and confirm they fail**
Run: `node tools/run-tests.js tests/bin-lib/release-state/store.test.js`
Expected: FAIL. `writeStateFile is not a function`; the Task 1 tests still pass.

- [ ] **Step 3: Implement `writeStateFile` and `createStateFile`.**
  - Mirror `writeClaimBlob`. The git leg uses `hash-object -w --stdin` (`input`), then `read-tree {lease}`, `update-index --add --cacheinfo 100644,{blob},{name}`, `write-tree`, and `commit-tree {tree} -p {lease} -m {message}`. Each of those calls uses `extraEnv: { GIT_INDEX_FILE: <os.tmpdir() scratch> }`, removed in `finally` with `fs.rmSync(…, {force:true})`.
  - Push with `['push', '--no-verify', 'origin', `${commit}:refs/heads/release-state`, `--force-with-lease=refs/heads/release-state:${lease}`]`.
  - On a `contested` rejection, read the file fresh through the git leg. Unchanged means retry on the fresh tip, up to `MAX_CAS_ATTEMPTS`, with `(deps.sleep || defaultSleep)(casBackoffMs(attempt))`. Changed means conflict.
  - A non-contest git failure goes to the contents API with a fresh contents read (the C1 rule).
  - `createStateFile`'s git leg checks absence at the leased tip. Its contents leg sends no `sha`.

- [ ] **Step 4: Run the tests and confirm they pass**
Run: `node tools/run-tests.js tests/bin-lib/release-state/store.test.js tests/claims-single-write-path.test.js tests/windows-hide-spawn-conformance.test.js tests/path-guard-conformance.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 5: Discrimination.** Do these reverts, one at a time, restoring the code after each:
  - Treat every rejection as a conflict, with no fresh read. The unrelated-file test must go red.
  - Reuse the git tip as the PUT `sha`. The fallback test must go red.
  - Drop the absence check in the git `createStateFile`. The `{exists:true}` git case must go red.

- [ ] **Step 6: Commit**
  ```bash
  git -C "<worktree>" add -- plugin/bin/lib/release-state/store.js tests/bin-lib/release-state/store.test.js
  git -C "<worktree>" commit -m "Add the release-state store's compare-and-set writes — per-file lease on both transports, create-if-not-exists without a prior read (#5883)" -m "Claude-Session: https://claude.ai/code/session_01QXpjcUQkbENmsccXLYNwCm"
  ```

### Task 3: `marker.js` shape and first-parent descent

**Role:** judgment
**Review risk:** high

**Files:**
- Create: `plugin/bin/lib/release-state/marker.js`
- Test: `tests/bin-lib/release-state/marker.test.js`

**Interfaces:**
- Produces, all exported from `marker.js`:
  - Constants: `MARKER_FILE = 'reviewed-through.json'`, `MARKER_VERSION = 1`, `SHA_RE = /^[0-9a-f]{40}$/`, `RUN_RE`, `REASON_RE` (both as in Global Constraints), `INIT_RUN = 'init'`, `ISO_UTC_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/`.
  - `parseMarker(value) -> { marker: {version, sha, advancedAt, run} } | { error: string }`. It also requires `Date.parse(advancedAt)` to be finite and `run` to match `RUN_RE` or equal `INIT_RUN`.
  - `serializeMarker({ sha, advancedAt, run }) -> string`.
  - `VERDICTS = ['descendant','same','backward','off-line','orphaned','undetermined']`.
  - `descentVerdict(from, to, { line: Set<string>, complete: boolean, isAncestor: (a,b) => true|false|'undetermined' }) -> { verdict, reason }`. The checks run in this order:
    1. `from` is not in `line`: `orphaned` when complete, else `undetermined`.
    2. `to === from`: `same`.
    3. `to` is not in `line`: `off-line` when complete, else `undetermined`.
    4. `isAncestor(from, to)`: true is `descendant`, false is `backward`, anything else is `undetermined`.
  - `compareVerdict(from, to, { tip, compare })` and `compareOnLine(sha, { tip, compare })`. `compare` is `{ notFound: true }` or `{ status, total_commits, commits: [{sha, parents}] }` for `{base}...{tip}`.
    - `identical` (base equals tip, `total_commits: 0`, an empty listing) is checked first and never walked. `compareOnLine` returns true. `compareVerdict(from, to)` returns `same` when `to === from`, otherwise `off-line`, because nothing newer than the tip is on the line. This is the common case for init at the current tip, and for a marker that already sits at the tip.
    - `behind`, `diverged` or `notFound` on the marker's range means `orphaned` (for `compareOnLine`, false).
    - Fewer commits than `total_commits` means `undetermined`.
    - Otherwise walk `parents[0]` from `tip` through the listed commits. Leaving the set before reaching `from` means `orphaned`. `to` on the walked path is `descendant`. `to` elsewhere is `off-line`.
  - `createLocalHistory({ git, branch = 'main' })` and `createCompareHistory({ ghApi, slug, branch = 'main' })`. Each returns `{ verdict(from, to) -> {verdict, reason}, onLine(sha) -> { onLine: boolean } | { undetermined: string } }`.
  - `createHistory({ local?, compare? })` is the ladder: the local answer, unless it is `undetermined` and `compare` exists. With neither, it returns `undetermined` with `no local clone and gh unavailable`.
- Local history:
  - Fetch: `['fetch', '-q', '--no-tags', 'origin', `+refs/heads/${branch}:${scratch}`]`. A throw makes every answer `undetermined: fetch failed — …`, which is the stale case.
  - Then `['rev-parse', '--verify', '--end-of-options', scratch]`, `['rev-parse', '--is-shallow-repository']` (`complete = out !== 'true'`), and `['rev-list', '--first-parent', '--end-of-options', tip, '--']`.
  - Ancestry: `['merge-base', '--is-ancestor', '--end-of-options', a, b]`. Exit 0 is true, `err.status === 1` is false, anything else is undetermined.
  - A membership miss refetches once per history object (Review Focus 1).
- Compare history:
  - Tip: `repos/{slug}/git/ref/heads/{branch encoded per segment} -q .object.sha`.
  - Pages: `repos/{slug}/compare/{base}...{tip}?per_page=100&page={n}` with `-q '{status, total_commits, commits: [.commits[] | {sha, parents: [.parents[].sha]}]}'`, `n` from 1, stopping at `total_commits` or an empty page. Past 100 pages is `undetermined`.
  - A 404 is `notFound`. Any other failure is `undetermined`.

- [ ] **Step 1: Write the failing tests** in `marker.test.js`.
  - `AC8.2/AC8.3: each malformed marker shape is an error, never a marker`. Factor this as `assertRejected(value)`. Cases:
    - no `sha`; a 39-hex sha; an uppercase sha; a non-hex sha;
    - `version: 2`; `version: '1'`; no `version`;
    - `advancedAt: '2026-11-18T10:00:00+01:00'`; `advancedAt: 'yesterday'`;
    - `run: ''`; `run: 'a b'`;
    - `[]`, `null`, `'x'`.
    - Control: a valid marker plus an extra key `note` parses.
  - `marker: serializeMarker bytes are pinned`. `serializeMarker({sha:'a'.repeat(40), advancedAt:'2026-11-18T10:00:00.000Z', run:'r1'})` must `===` `'{\n  "version": 1,\n  "sha": "aaaa…(40)",\n  "advancedAt": "2026-11-18T10:00:00.000Z",\n  "run": "r1"\n}\n'`.
  - `descentVerdict: the decision table`, with a synthetic `line`. One row per verdict:
    - `from` missing with complete → orphaned; with incomplete → undetermined;
    - same;
    - `to` missing with complete → off-line; with incomplete → undetermined;
    - isAncestor true → descendant; false → backward; `'undetermined'` → undetermined.
  - `compareVerdict: walks parents[0] only`. Use fixtures in the probe's shape. A merge commit's second-parent commit S listed in the range is `off-line`; a walk that never reaches `from` is `orphaned`; `behind` is `orphaned`; 2 of `total_commits: 3` is `undetermined`; `notFound` is `orphaned`. `identical` with `total_commits: 0` and `commits: []` gives: `compareOnLine(tip)` true; `compareVerdict(tip, tip)` `same`; `compareVerdict(tip, X)` `off-line`. Go-red for the identical rows: drop the `identical` branch. The empty walk then reads `orphaned`, and both rows must go red.
  - `createCompareHistory: argv and pagination`. The fake `ghApi` serves page 1 with 100 commits and page 2 with 1 (`total_commits: 101`). Assert the exact args of the tip read and both page reads, and that no arg is `-f`/`-F`. `--branch release/v1#x` encodes as `release/v1%23x`.
  - Local history on real git (`makeLine()`, `realRunner(cloneA)`):
    - `AC1.1 (descent): P1→P3 descendant`.
    - `AC2.1 (descent): P3→P1 backward; P1→S off-line`. S is an ancestor of `main`, but not on its first-parent line.
    - `AC7.1 (descent): P2→P2 same`.
    - `AC8.4/AC8.5 (descent): after rewriteMain, P3→P3′ is orphaned`.
    - `AC8.1 (descent): a shallow clone answers what it holds and is undetermined on a miss, never refused or orphaned`. Use `shallowClone(fx, 2)`: P4→P5 is descendant; P1→P5 is undetermined; `onLine(P1)` is undetermined.
    - `AC8.1 (descent): a failed fetch is undetermined`. Repoint clone A's `origin` to a missing path.
    - `history: a membership miss refreshes the snapshot once` (Review Focus 1). Take a verdict, then `pushMainCommit` from clone B, then `verdict(P5, P6)` on the same history object is descendant. Prove it with a counting runner: two fetches, not three.
    - `history: consumer branch name`. Use `makeLine({ branch: 'trunk' })` (Task 1's fixture parameter). `createLocalHistory({ branch: 'trunk' })` answers P1→P3 descendant, and `createLocalHistory()` (default `main`) answers `undetermined`, because the fetch of a missing `main` fails.
    - `createHistory: local undetermined falls to compare; neither gives undetermined`.

- [ ] **Step 2: Run the tests and confirm they fail**
Run: `node tools/run-tests.js tests/bin-lib/release-state/marker.test.js`
Expected: FAIL. The test file and `marker.js` do not exist yet.

- [ ] **Step 3: Implement the shape, the verdict functions and both histories** with the signatures above. Use one memoized snapshot per history object, with the scratch ref `refs/release-state-history/{pid}-{ts}-{rand}` deleted in `finally`. The runner's `maxBuffer` covers the `rev-list` read; that is Task 5's `realDeps.git`.

- [ ] **Step 4: Run the tests and confirm they pass**
Run: `node tools/run-tests.js tests/bin-lib/release-state/marker.test.js tests/git-path-read-conformance.test.js tests/git-status-optional-locks.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 5: Discrimination and real-input probe.**
  - Do these reverts, one at a time, restoring the code after each:
    - Drop the `complete` flag, so a miss is always orphaned or off-line. `AC8.1` must go red.
    - Replace the `parents[0]` walk with "listed in the range". The S row of `compareVerdict` must go red.
    - Remove the refresh. The refresh test must go red.
  - Then, from the worktree, run a scratch script (Write it under the scratchpad; never `node -e` in a worktree) calling `createLocalHistory({ git: <runner bound to the worktree> }).verdict('e97c8ab6390db6dff021ae0937dffa4a7201603d', 'fb5f4a6a9b0c8f496f56cc0d1e3fad79622ff784')`.
    - Expected: `descendant`, on this shallow checkout.
    - Independent count: `git rev-list --first-parent origin/main` lists both shas, `fb5f4a6a…` first.
    - Quote both outputs in the task report.

- [ ] **Step 6: Commit**
  ```bash
  git -C "<worktree>" add -- plugin/bin/lib/release-state/marker.js tests/bin-lib/release-state/marker.test.js
  git -C "<worktree>" commit -m "Add the reviewed-through marker shape and first-parent descent — local clone first, compare API without one, shallow misses undetermined (#5883)" -m "Claude-Session: https://claude.ai/code/session_01QXpjcUQkbENmsccXLYNwCm"
  ```

### Task 4: Marker operations — advance, init, reset

**Role:** judgment
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/release-state/marker.js`
- Test: `tests/bin-lib/release-state/marker.test.js`

**Interfaces:**
- Consumes: Task 2's store functions, through the facade below, and Task 3's history and shape.
- Produces:
  - `OUTCOMES = ['ok','refused','unreadable','contested','insufficient-history','orphaned']`.
  - `ctx = { store: { read() -> readResult, write({content, lease, via, expectedContent, message}) -> writeResult, create({content, message}) -> createResult }, history, now: () => Date }`. `storeFacade(deps, slug, name = MARKER_FILE)` binds Task 1 and Task 2's functions into `ctx.store`.
  - `advanceMarker(ctx, { to, run }) -> { outcome, advanced?, from?, to?, sha?, reason? }`.
  - `initMarker(ctx, { to }) -> { outcome, initialized?, sha?, reason? }`.
  - `resetMarker(ctx, { to, run, force, reason }) -> { outcome, reset?, from: string|null, to?, basis?: 'orphaned'|'forced', reason? }`.
  - Arguments that fail `SHA_RE`, `RUN_RE` (or `run === 'init'`), or `REASON_RE` when `force` is set, throw `TypeError` (the CLI validates first).
  - Commit messages:
    - advance: `Advance reviewed-through to {to[0..12]} from {from[0..12]} — run {run}`
    - init: `Initialize reviewed-through at {sha[0..12]}`
    - reset: `Reset reviewed-through from {from[0..12]|unreadable} to {to[0..12]} — run {run} — {orphaned|forced: {reason}}`
- `advanceMarker`, in this order:
  1. Read. Unreadable gives `unreadable`. Absent gives `refused` (`no marker — run marker init`).
  2. Parse. A shape error gives `unreadable`.
  3. Up to two passes. Each pass takes `history.verdict(cur.sha, to)`:
     - `orphaned` → `orphaned`; `undetermined` → `insufficient-history`.
     - `same` → `ok` with `advanced:false`, `reason:'same'`, and no write.
     - `backward` or `off-line` → `refused`.
     - `descendant` → write.
  4. A write `conflict` re-reads. A fresh marker that equals `to`, or is a first-parent descendant of it (`history.verdict(to, fresh.sha)` gives descendant), is `ok` with `advanced:false`, `reason:'at-or-past'`. Otherwise the second pass re-validates against the fresh marker.
  5. A second conflict gives `contested`. Any other write failure gives `unreadable`.
- `initMarker`: `history.onLine(to)` (undetermined → `insufficient-history`, false → `refused`), then `store.create`. `exists` gives `refused` (`a marker already exists`).
- `resetMarker`:
  - Read. Absent gives `refused`. Transport-unreadable gives `unreadable`.
  - Content- or shape-unreadable gives `unreadable` without `force` (with the hint `--force --reason`), and `basis:'forced'` with it.
  - A parsed marker: on the line without `force` is `refused` (`not orphaned`); off the line is `basis:'orphaned'`.
  - The target must be `onLine` (else `refused`; undetermined → `insufficient-history`).
  - One write. A conflict gives `contested`, with no retry.

- [ ] **Step 1: Write the failing tests** (append them). The scenario tests use the real store on `makeLine()` via `storeFacade({ gitRunner: realRunner(cloneX), ghApi: throwing }, 'o/r')`, the real local history, and a fixed `now`.
  - `AC1.1: init at P1, advance to P3, read prints P3`. Assert the outcome `ok` with `advanced:true, from:P1, to:P3`. Assert that `parseMarker(JSON.parse(read().content))` yields `sha === P3` and `run === 'r1'`.
  - `AC2.1: advancing backward or off the first-parent line is refused and writes nothing`. The marker is at P3; targets P1 and S. Each gives `refused`, and the origin's `release-state` tip sha is unchanged.
  - `AC7.1: advancing to the marker's own sha is ok and writes nothing`. The tip is unchanged.
  - `AC8.5: an orphaned marker gives orphaned, not refused`. Marker at P3, then `rewriteMain`, then advance to P3′.
  - `AC8.1: a shallow clone with the marker below the boundary gives insufficient-history`. Run from `shallowClone(fx, 2)` with the marker at P1.
  - `AC5.1: an unreadable read gives unreadable and never refused`. A facade whose `read` returns `{state:'unreadable'}`.
  - `AC8.3: a stored marker of each malformed shape gives unreadable`. Loop over `assertRejected`'s shapes, then advance. Object-shaped ones (a bad sha, `version: 2`, a bad `advancedAt`, …) are written through `createStateFile`. The non-object ones (`[]`, `null`, `'x'`, a raw `{`) are written with `commitRawState`, because `createStateFile` refuses them as `invalid-content` (Task 2).
  - `AC3.1/AC3.2: a concurrent advance seen through the injected read seam`. This follows lock-race-test-seam: never two processes.
    - Wrap clone A's `ctx.store.read`. On its first call, take the real read, then run `advanceMarker(ctxB, { to: P5, run: 'rb' })` from clone B in-process and assert it `ok`. Return the stale first read.
    - `advanceMarker(ctxA, { to: P3, run: 'ra' })` must give `ok`, `advanced:false`, `reason:'at-or-past'`.
    - The origin's `release-state` has exactly two commits past its base (init, B's advance), and the marker reads P5 with run `rb`.
    - A sibling case where B advances to P3 (equal) gives the same result.
  - `AC3.1: a competitor behind our target makes us retry once and land`. B advances to P2 inside the seam; A targets P3. A gives `advanced:true, from:P2`.
  - `AC3.1: the retry re-validates against the fresh marker`. Inside the seam, B rewrites the marker to an off-line sha: `commitRawState` with `serializeMarker({ sha: S, … })`. A's second pass calls `verdict(S, P3)`, and check 1 (`from` not on the line of a complete clone) gives `orphaned`. Expect `orphaned`, which is exit 6, with no write: a blind write would land `advanced:true`. A fresh marker on the line can never give `refused` here. Being behind the target makes it the retry-and-land case above, and being at or past it gives `at-or-past`.
  - `AC3.1: a second conflict is contested`. Use a fake in-memory facade whose `write` always returns `{ok:false, conflict:true}` and whose `read` returns an older marker each time.
  - `AC6.1: init refuses when a marker exists`. Also: init on a branchless remote creates the branch with `run: 'init'`; init at S is refused with no branch created.
  - `AC8.6/AC8.7/AC8.8/AC8.9: reset only under its guards, and the commit message logs it`. Cases:
    - An orphaned marker plus an on-line target gives `ok, basis:'orphaned'`. The tip message ends `— orphaned`.
    - Not orphaned and no force gives `refused`.
    - `force` with reason `history rewritten by hand` gives `ok, basis:'forced'`. The message contains `forced: history rewritten by hand`.
    - An off-line target gives `refused`.
    - No marker gives `refused`.
    - A raw `{` marker (planted with `commitRawState`) without force gives `unreadable`; with force it gives `ok`, `from:null`.
  - `marker: TypeError on bad arguments` (Review Focus 4). Cases: `run: 'init'` on advance, `run: '-x'`, reason `fix #12`, reason `'a\nb'`.

- [ ] **Step 2: Run the tests and confirm they fail**
Run: `node tools/run-tests.js tests/bin-lib/release-state/marker.test.js`
Expected: FAIL. `advanceMarker is not a function`; the Task 3 tests still pass.

- [ ] **Step 3: Implement `storeFacade`, `advanceMarker`, `initMarker` and `resetMarker`** as specified above.

- [ ] **Step 4: Run the tests and confirm they pass**
Run: `node tools/run-tests.js tests/bin-lib/release-state/marker.test.js tests/bin-lib/release-state/store.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 5: Prove the race test goes red** (lock-race-test-seam). Do these reverts, one at a time, restoring the code after each:
  - Delete the at-or-past re-read branch. The P5 race case must go red (it then reports `refused`).
  - Replace the second pass's re-validation with a blind write on the fresh lease. The re-validation case must go red (it then reports `ok`, `advanced:true` instead of `orphaned`).
  - Make `resetMarker` skip the orphan check. The not-orphaned case must go red.

- [ ] **Step 6: Commit**
  ```bash
  git -C "<worktree>" add -- plugin/bin/lib/release-state/marker.js tests/bin-lib/release-state/marker.test.js
  git -C "<worktree>" commit -m "Add the marker's advance, init and reset — forward-only, at-or-past after a lost race, one re-validated retry, guarded reset (#5883)" -m "Claude-Session: https://claude.ai/code/session_01QXpjcUQkbENmsccXLYNwCm"
  ```

### Task 5: `release-state.js` CLI and its host-seam registration

**Role:** integration
**Review risk:** high

**Files:**
- Create: `plugin/bin/release-state.js`
- Create: `tests/bin-lib/release-state/cli.test.js`
- Modify: `tests/gh-host-seam-conformance.test.js` (add `'release-state.js'` to `PIN_WIRED` and `ORIGIN_GATED`)
- Modify: `tests/helpers/gh-host-seam.js`. Append a `CLI_TABLE` row: `{ cli: 'release-state.js', argv: ['marker', 'read'], acceptsRepo: true, canned: { 'api-repos/o/r/contents/reviewed-through.json?ref=release-state': JSON.stringify({ content: JSON.stringify({ version: 1, sha: 'a'.repeat(40), advancedAt: '2026-11-18T10:00:00.000Z', run: 'r1' }), sha: 'b'.repeat(40) }) } }`. The git leg's fetch fails under the table's `GIT_ALLOW_PROTOCOL=file`, so the read reaches the contents API.

**Interfaces:**
- Consumes: Task 4's operations and `storeFacade`; Task 3's histories; Task 1's `readStateFile` and `classifyStateContent`.
- Produces, all exported from `plugin/bin/release-state.js`:
  - `run(argv, deps) -> number`, `realDeps`, `parseArgs(argv)`, `EXIT` (Global Constraints), and `OUTCOME_EXIT = { ok: 0, refused: 1, unreadable: 3, contested: 4, 'insufficient-history': 5, orphaned: 6 }`.
  - `USAGE`:
    ```text
    usage: release-state.js marker read [--repo [host/]owner/name | --marker-json <path>]
           release-state.js marker advance --to <sha> --run <id> [--branch <name>] [--repo [host/]owner/name | --marker-json <path>]
           release-state.js marker init --to <sha> [--branch <name>] [--repo [host/]owner/name | --emit]
           release-state.js marker reset --to <sha> --run <id> [--force --reason <text>] [--branch <name>] [--repo [host/]owner/name | --marker-json <path>]
           release-state.js [--help]
    ```
    It is followed by one line per exit code.
- `realDeps` keys:
  - `cwd()`, `env` (getter), `homeDir()`, `remoteUrl({cwd, env})`, `pinGhHost(spec, {env, cwd})`.
  - `gh(args, {cwd, env, stderr, homeDir})`: throwing; the options are `ghOptions(args, {encoding:'utf8', windowsHide:true, stdio:['ignore','pipe','pipe'], timeout: GH_TIMEOUT_MS, maxBuffer: LARGE_MAX_BUFFER_BYTES, cwd, env}, injectedGhDeps({env, stderr, homeDir}))`.
  - `git(args, {cwd, env, input, extraEnv})`: throwing; `execFileSync('git', args, { cwd, env: { ...repoPinnedEnv(env), ...extraEnv }, input, encoding:'utf8', stdio:['pipe','pipe','pipe'], timeout: GIT_TIMEOUT_MS, maxBuffer: LARGE_MAX_BUFFER_BYTES, windowsHide: true })`.
  - `readFile(p)`, `now()`, `sleep(ms)`, `stdout(s)`, `stderr(s)`.
  - There is no `ghApi` key. `run` builds the never-throwing adapter from `deps.gh`, so `FAIL_CLOSED_KEYS` (`tests/helpers/run-cli.js:62`) covers it unchanged. The adapter wraps the result in `classifyGhApiError` and appends `--hostname {host}` when `normalizeHost(host)` is not `github.com`.
- Flow, gh path:
  1. Parse. `--marker-json`/`--emit` together with `--repo`, `--force` without `--reason`, or `--reason` without `--force` gives exit 2.
  2. Resolve the repo as `release-block.js`'s `resolveRepoOrFail` does, giving exit 2 with the gate's text. `--repo` pins the host.
  3. Use the local clone only when `git rev-parse --is-inside-work-tree` prints `true` and the origin gates to the same host, owner and repo. Read the origin through `deps.remoteUrl`, the same dep step 2 uses, never through a separate git call. Otherwise give no `gitRunner` and no local history (Review Focus 3).
  4. The history ladder: local, then compare.
  5. Run the operation, print one JSON line, and exit `OUTCOME_EXIT[outcome]`.
  6. A `gh-absent` failure adds the stderr hint `gh not found — read over MCP and pass --marker-json (_shared/release-state.md)`.
- Emit mode (`--marker-json` for read/advance/reset, `--emit` for init): no gh call, no repo resolution, local history only.
  - The file is `null` (absent), `{content: string, sha: 40-hex}` (read), or `{failure: string}`. Any other shape, an unreadable file or an unparseable handoff file is exit 3.
  - A `{content, sha}` entry goes through Task 1's `classifyStateContent(content, { lease: sha, via: 'contents-api' })`, exactly as `readStateFile` does. A marker whose *content* is malformed JSON or a non-object is therefore an unreadable read that still carries `content` and `lease` = the blob `sha`. `marker reset --force --reason` can overwrite it on the MCP path as on the gh path (Task 6's Recovery).
  - `ctx.store.write`/`create` capture the write instead of making it.
  - The write prints `{"write":{"branch":"release-state","path":"reviewed-through.json","content":"…","sha":"<blob sha>"|null,"message":"…"}}` and exits 0.
- Stdout on exit 0, one line each:
  - `read`: `{"absent":true}`, or the marker as `{"version":1,"sha":"…","advancedAt":"…","run":"…"}`.
  - `advance`: `{"advanced":true,"from":"…","to":"…"}` or `{"advanced":false,"sha":"…","reason":"same"|"at-or-past"}`.
  - `init`: `{"initialized":true,"sha":"…"}`.
  - `reset`: `{"reset":true,"from":"…"|null,"to":"…","basis":"orphaned"|"forced"}`.
  - A non-zero exit prints nothing on stdout and one stderr line: `release-state.js: {outcome} — {reason}`.

- [ ] **Step 1: Write the failing tests** in `cli.test.js`. In-process cases go through `runCliSync` from `tests/helpers/run-cli.js` with an absolute `cliPath`. The fake `gh` records `{args}` and throws `unexpected …` on any other shape. The fake `git` records too. Fixed `now`.
  - `public contract: EXIT and OUTCOME_EXIT values`. Assert `deepStrictEqual(EXIT, {OK:0,REFUSED:1,USAGE:2,UNREADABLE:3,CONTESTED:4,INSUFFICIENT_HISTORY:5,ORPHANED:6})`. Assert that `OUTCOME_EXIT` covers exactly `OUTCOMES`.
  - `AC1.1: marker read prints the marker after an advance`. This runs in-process through `runCliSync` on the real-git fixture, with no `--repo` and no `gh`. The fixture's `origin` is a bare local path, which `parseRepo` cannot read (`plugin/bin/lib/repo-resolve.js:29-33`). A `url.insteadOf` rewrite does not help, because `git remote get-url` expands insteadOf. So the test injects these deps:
    - `remoteUrl: () => 'https://github.com/o/r.git'`, so the gate resolves `o/r` and Flow step 3 sees the same repo.
    - `cwd: () => cloneA`.
    - `git` left as the real `realDeps.git`. It is a git-only seam, deliberately not on `FAIL_CLOSED_KEYS`, and runs against the real clone and its file-path `origin`.
    - `env` as `{ ...cleanGitEnv(), ...pinnedGitEnv() }` (`tests/helpers/git-fixtures.js`, `tests/helpers/pinned-git.js`).
    - `gh` as a fake that throws `unexpected …`, so no gh call is allowed.

    Run `marker init --to P1`, then `marker advance --to P3 --run r1`, then `marker read`. Assert the exit codes are 0, 0, 0, that read's stdout `sha` is P3, and that the fake `gh` was never called. One `spawnCli` smoke test covers the script entry: `--help` exits 0 with the usage on stdout.
  - `AC2.1 / AC7.1 / AC8.5 / AC8.1 / AC6.1 / AC5.1 / AC8.3: each outcome maps to its exit code`. Use a fake-deps table with one operation result per row. Exits: refused 1, same 0 with `reason:"same"`, orphaned 6, insufficient-history 5, init-exists 1, unreadable 3, and malformed marker 3. Each non-zero exit leaves stdout empty and stderr matching `/^release-state\.js: /`.
  - `AC4.1: read on a branchless remote prints {"absent":true}`. This is the contents leg with the confirmation reads faked.
  - `usage -> exit 2, zero gh and git calls`. Cases:
    - no verb; `marker frobnicate`; `marker advance` without `--to`; `--to` given as 39 hex;
    - a trailing `--run`; `--run '-x'`; `--run init`;
    - `--force` without `--reason`; `--reason` without `--force`; `--reason 'fix #12'`;
    - `--branch 'a..b'`; `--marker-json x --repo o/r`; `--emit` on `advance`;
    - an unknown flag.
  - `emit mode: no gh call, a write descriptor, and the agent's file shapes` (Review Focus 5).
    - `{content:<marker at P1>, sha:'b'.repeat(40)}` plus `advance --to P3` prints the `write` descriptor with `sha` = `'b'.repeat(40)`, `content` === `serializeMarker(…)`, and the commit message.
    - `null` plus `advance` gives exit 1.
    - These shapes each give exit 3: `{failure:'x'}`, `{content:'…'}` without `sha`, `'str'`, `[]`, a missing file and `not json`.
    - `init --emit` prints `sha:null`.
    - `AC8.6: a malformed marker is recoverable on the MCP path`.
      - Use `{content:'{', sha:'c'.repeat(40)}`. `reset --to P3 --run r1 --force --reason "history rewritten by hand"` prints a `write` descriptor whose `sha` is `'c'.repeat(40)`, whose `content` is `serializeMarker({sha:P3, …, run:'r1'})`, and whose `message` ends `forced: history rewritten by hand`.
      - The same file without `--force` exits 3.
      - Go-red: point the adapter at a copy that maps malformed content to `{failure}`. The `--force` case must go red.
    - Build file keys with `path.join(root, …)` and reach them through a relative path under an injected `cwd`.
  - `repo: --repo other/x with origin acme/widgets uses no local git` (Review Focus 3). The recorded git calls hold no `fetch`/`push`, and the compare tip read runs.
  - `repo: --hostname rides every gh api call off github.com, never on github.com`. `--repo ghe.example.com/o/r` puts the trailing `--hostname ghe.example.com` on every call. A bare `--repo o/r` has none. `pinGhHost` is called once with `--repo` only.
  - `--branch trunk reaches the history fetch and the compare tip read`.
  - `realDeps.gh carries the GH_TIMEOUT_MS bound`. Use `captureGhTimeout` (`tests/helpers/gh-timeout-probe.js`) with `envValue: '45000'`. Expect 45000.

- [ ] **Step 2: Run the tests and confirm they fail**
Run: `node tools/run-tests.js tests/bin-lib/release-state/cli.test.js`
Expected: FAIL. The test file and `plugin/bin/release-state.js` do not exist yet.

- [ ] **Step 3: Implement `plugin/bin/release-state.js`.**
  - The header states the usage, the exit table, the frozen-contract sentence, and the vocabulary note from Global Constraints.
  - Read files with `deps.readFile(resolveAgainst(deps.cwd(), p))` and catch the error. Never call `fs.existsSync`.
  - The last statement is `if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);`.
  - Make the two test-file edits named in Files.

- [ ] **Step 4: Run the tests and confirm they pass**
Run: `node tools/run-tests.js tests/bin-lib/release-state/cli.test.js tests/gh-host-seam-conformance.test.js tests/gh-host-seam-behavior-origin-gate.test.js tests/gh-host-seam-behavior.test.js tests/bin-lib/exit-code-conformance.test.js tests/bin-lib/cli-entry-conformance.test.js tests/windows-hide-spawn-conformance.test.js tests/path-guard-conformance.test.js tests/claims-single-write-path.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 5: Pin the contract and probe real input.**
  Proof(public-contract): `tests/bin-lib/release-state/cli.test.js` deep-equals `EXIT` to `{OK:0,REFUSED:1,USAGE:2,UNREADABLE:3,CONTESTED:4,INSUFFICIENT_HISTORY:5,ORPHANED:6}`. It also pins each operation outcome to its exit number through the fake-deps table, and pins the exit-0 stdout shapes (`{"absent":true}`, the marker object, the `write` descriptor) byte for byte. Task 4 pins `serializeMarker`'s bytes, and Task 6 pins the contract's exit table both directions against `EXIT`. Renumbering a code, renaming a key or reshaping the marker file turns these red.
  - Revert `OUTCOME_EXIT.orphaned` to 1. The table test must go red. Restore it.
  - Then run, from the worktree: `node plugin/bin/release-state.js marker read`. Expected: `{"absent":true}` and exit 0. `release-state` does not exist on `thn-inc/claude-tweaks` (probed above), and this is a read with no write. Quote the raw output in the task report.

- [ ] **Step 6: Commit**
  ```bash
  git -C "<worktree>" add -- plugin/bin/release-state.js tests/bin-lib/release-state/cli.test.js tests/gh-host-seam-conformance.test.js tests/helpers/gh-host-seam.js
  git -C "<worktree>" commit -m "Add release-state.js marker read, advance, init and reset — frozen exits 0-6, gh-free emit mode for the MCP path (#5883)" -m "Claude-Session: https://claude.ai/code/session_01QXpjcUQkbENmsccXLYNwCm"
  ```

### Task 6: The `_shared/release-state.md` contract and the structure doc

**Role:** integration
**Review risk:** high

**Files:**
- Create: `plugin/skills/_shared/release-state.md`
- Create: `tests/release-state-contract-conformance.test.js`
- Modify: `docs/plugin-structure.md`
  - Directly after the `plugin/bin/lib/release-tip/` entry (line 55), add one entry, in the same arrow format: `plugin/bin/lib/release-state/     → store.js (the one writer of every file on the release-state branch — git compare-and-swap, contents-API fallback, branch bootstrap; #5883) and marker.js (reviewed-through.json's shape, first-parent descent, advance/init/reset)`.
  - Between the `node plugin/bin/release-preflight.js` line (405) and the `node plugin/bin/release-tip-check.js` line (406), add one command line in the format of its neighbours: the four usage forms, plus `# Release-state CLI (#5883) — reads and moves the reviewed-through marker; exits 0 ok, 1 refused, 2 usage, 3 unreadable, 4 contested, 5 insufficient-history, 6 orphaned; _shared/release-state.md`.

**Interfaces:**
- Consumes: `EXIT`, `RELEASE_STATE_BRANCH`, `MARKER_FILE`, `parseMarker` and `serializeMarker`.
- Produces these section headings, verbatim and in this order. #5884 and #5885 will cite them:
  - `## The branch and its files`
  - `## reviewed-through.json`
  - `## Writer rules`
  - `## The CLI`
  - `### Exit codes`
  - `## gh-absent (MCP) path`
  - `## Recovery: an orphaned or malformed marker`

- [ ] **Step 1: Write the failing tests** in `tests/release-state-contract-conformance.test.js`. Read through `readText` from `tests/helpers/read-skill.js`. Every go-red control runs the same helper the positive test runs, on a mutated copy, and expects it to throw.
  - `contract: sections in order`. Factor this as `assertSections(text)`. Go-red: a copy with `## Writer rules` deleted.
  - `contract: the exit table equals EXIT, both directions`. Factor this as `assertExitTable(text)`. Parse each `| {n} | \`{name}\` |` row under `### Exit codes`, then deep-equal the parsed rows to `Object.entries(EXIT)` with names lowercased and `_` replaced by `-`. Go-red: a copy with the `6` row dropped, and a copy with the row renumbered to `7`.
  - `contract: names and the marker example match the code`.
    - The text contains `` `release-state` `` and `` `reviewed-through.json` ``, equal to the constants.
    - Take the fenced `json` block under `## reviewed-through.json`. Its text must equal `serializeMarker(m)` with the trailing newline trimmed, where `m` is the parse of that same block.
    - A CRLF copy built with `.replace(/\n/g, '\r\n')` from the `readText` result must still yield the fence.
  - `contract: MCP path`.
    - It names `get_file_contents`, `create_branch`, `create_or_update_file`, `--marker-json` and `--emit`.
    - It states the confirm-before-absent ladder.
    - It states the retry-once-then-contested rule.
    - It says the descent check needs a local clone, because no compare tool is used on the MCP path.
  - `contract: the reset reason and commit-message rule names # and its reason`. Search for `track-issue-fixes`.

- [ ] **Step 2: Run the tests and confirm they fail**
Run: `node tools/run-tests.js tests/release-state-contract-conformance.test.js`
Expected: FAIL. The contract file does not exist yet (`ENOENT`).

- [ ] **Step 3: Write `plugin/skills/_shared/release-state.md`** (≤ 10,000 B), with the headings above.
  - **The branch and its files.**
    - The branch is `release-state`, created on first write from the default branch tip, as `claims-registry` is (`_shared/issue-claims.md`'s Bootstrap the branch), so it carries that history underneath.
    - Files sit flat at the root and match `[a-z0-9][a-z0-9-]*\.json`.
    - The CAS is per file. The store is the sole writer API: `reviewed-through.json` today, and #5884's merge-pause flag next.
    - It never writes to `main`.
  - **reviewed-through.json.**
    - The `json` example and the four keys.
    - The `version` field is the expand-contract seam. A reader ignores unknown keys, and any unknown version reads as unreadable.
    - The frozen-contract sentence.
  - **Writer rules.**
    - Forward-only along the first-parent line of the `--branch` (default `main`).
    - The same sha is a no-op.
    - A lost CAS re-reads: at or past the target is success, otherwise one re-validated retry, then contested.
    - Init is create-if-not-exists.
    - The commit-message rule and its `track-issue-fixes` reason.
  - **The CLI.**
    - The four usage forms.
    - `### Exit codes` as a `| code | name | meaning |` table, rows 0 through 6.
    - The exit-0 stdout shapes.
    - Exit 5 is never exit 1: a shallow or stale clone answers what it holds.
  - **gh-absent (MCP) path.** Detection is per `_shared/github-write-transport.md`'s Detection, and the conditional write is that file's conditional-write pattern.
    1. Read: `get_file_contents` of `reviewed-through.json` at ref `release-state`. Write `{content, sha}`, `null` or `{failure}` to the path from `node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" --value release-state-marker.json`, with the Write tool.
       - A not-found counts as `null` only after `get_file_contents` of the root on `release-state` succeeds (the file is missing), or that fails and the root on the default branch succeeds (the branch is missing). Otherwise it is `{failure}`.
    2. Run `node "${CLAUDE_PLUGIN_ROOT}/bin/release-state.js" marker advance --to {sha} --run {id} --marker-json "{tmp-marker-json}"` from the checkout of the same repository. Route on its exit code.
    3. On exit 0 with `write`, call `create_or_update_file` with `branch`, `path`, `content`, `message`, and `sha` (omitted when null).
    4. A sha-mismatch or exists rejection goes back to step 1 and re-runs the same call once. A second rejection is the exit-4 equivalent.
    - Init: `--emit`, then `create_branch` (name `release-state`, from the default branch; tolerate "already exists"), then `create_or_update_file` without `sha`. An exists rejection is the exit-1 equivalent.
    - The compare API has no MCP row, so the descent check needs the local clone. Without one, the CLI exits 5.
  - **Recovery.**
    - `marker reset --to {sha} --run {id}` for an orphaned marker.
    - `--force --reason "{text}"` for any other marker, the malformed one included.
    - The reset is logged in the `release-state` commit message.
    - The target must be on the first-parent line.

  Then make both `docs/plugin-structure.md` edits named in Files.

- [ ] **Step 4: Run the tests and confirm they pass**
Run: `node tools/run-tests.js tests/release-state-contract-conformance.test.js tests/skill-fence-guard-shapes.test.js tests/session-tmp-placeholder-quoting-conformance.test.js tests/skill-prose-plugin-root-invocations.test.js tests/node-e-snippet-syntax.test.js tests/raw-markdown-read-conformance.test.js`
Expected: PASS, 0 failures, and `wc -c plugin/skills/_shared/release-state.md` ≤ 10000.

- [ ] **Step 5: Whole-branch verification.** Run `node tools/run-tests.js` over the impact-selected set (`npm test`), with the output redirected to a scratch `.txt` file outside the repository. Then read that file. Expected: 0 failing files. A file whose failure count varies run to run is re-run alone before anything is concluded.

- [ ] **Step 6: Commit**
  ```bash
  git -C "<worktree>" add -- plugin/skills/_shared/release-state.md tests/release-state-contract-conformance.test.js docs/plugin-structure.md
  git -C "<worktree>" commit -m "Add the release-state contract — branch, marker shape, writer rules, exits, MCP procedure (#5883)" -m "Claude-Session: https://claude.ai/code/session_01QXpjcUQkbENmsccXLYNwCm"
  ```

## Plan-authoring checks run

**Return-shape widening:** No existing function's return shape grows. Every function is new; `claim-store.js` and `claims-git-cas.js` are imported unchanged.

**Blocking-verification downgrade:** None. The contents, branch and compare endpoints were probed live, read-only (Global Constraints). The PUT, the POST `git/refs` and `git push` have no read-only form. They copy the shipped argv of `claim-store.js` and `claims-git-cas.js`, plus `--no-verify`, and Tasks 1 and 2 exercise the git leg against a real bare origin.

**Deictic re-resolution:** No prose is reordered.

**Ordering-fix location:** No ordering fix.

**Verbatim-command run-once:** Run read-only for the contents, branches, compare (both directions, page 2, an unknown sha), `merge-base --is-ancestor --end-of-options`, `rev-list --first-parent --end-of-options … --` and `--is-shallow-repository` calls. The outputs are recorded in Global Constraints. The PUT, POST and push are flagged as unverified live; they are tested against a real bare origin and a fake `ghApi`.

**Degrade-clause convention:** The gh-absent clause cites `_shared/github-write-transport.md`'s Detection and conditional-write pattern, and `_shared/issue-claims.md`'s bootstrap. No MCP row is invented for compare.

**Copied-config re-derivation:** Nothing is copied that carries a grant.

**Renumbering-completeness:** No numbered structure changes.

**Batched-plan marker:** Not batched. Each task leaves code to write.

**Adjacent-task merge:** Tasks 1 and 2 share `store.test.js`, but writes are separately reviewable (CAS semantics). Tasks 3 and 4 share `marker.test.js`, but the operations carry the race logic that a reviewer judges apart from descent. They stay separate.

**Behavioral-claim:** "the first write creates the branch" is produced by `createStateFile` calling `ensureReleaseStateBranch` (Task 2, tested). "A reset is logged" is produced by the commit message (Task 4, asserted).

**Already-satisfied ruling:** None.

**Byte-pin:** The only skill-tree file is the new `_shared/release-state.md`, at ≤ 10,000 B against the 52,500 B rail, leaving at least 42,500 B of headroom.

**Consumer-timing:** The descent snapshot is fetched in the same call that decides, and refreshed once on a miss (Review Focus 1).

**Step-position:** Not a late-lifecycle step.

**Gate-over-producers:** The new readers read only files this store writes. The MCP-path producer (the agent) is shape-guarded (Review Focus 5).

**Sole-site:** "`store.js` is the sole writer of the branch" is pinned in Tasks 1 and 2 by the recorded-calls check (every push refspec and PUT branch). A second writer would have to bypass the module. `git grep -n -F "release-state" -- plugin/bin` returns no hits on the pre-change tree (run while authoring).

**Real-input probe:** Task 3 Step 5 checks descent on this shallow checkout, with an independent `rev-list` count. Task 5 Step 5 runs `marker read` against this repo.

**Independent-count:** Task 3 Step 5 pairs the verdict with a raw `git rev-list --first-parent` listing.

**Consumer-portability:** `main` is the `--branch` default only. Tests run `--branch trunk` (Tasks 3 and 5). `origin` is the remote the precedent uses; the CLI uses it only when the origin gates to the target repo.

**Source-scan lint:**
- No `fs.existsSync` or `fs.realpathSync`; reads catch `ENOENT`.
- Every spawn literal carries `windowsHide`.
- Every `gh` spawn goes through `ghOptions`.
- No argv array leads with `'status'`.
- No `ls-tree` or `ls-files` read, so `-z` is not owed.
- `store.js` avoids the three claims-path strings (`claims-single-write-path`).

**Real-writer fixture:** Marker states in the operation tests are written by the real `createStateFile`/`writeStateFile`. A malformed marker is written as a real commit on the branch: through `createStateFile` when it is object-shaped, and through `commitRawState` when it is not. It is never hand-built JSON in a fake.

**Moved-prose pin / Prose-held pin:** No prose is moved.

**Derived-value probe:** The `marker read` probe uses the CLI's own origin resolution. The descent probe uses the runner bound to the worktree.

**Empty-value probe:** `--branch ''` is rejected by `isValidBranchName` (usage test). An empty `--run` or `--to` value is a usage case.

**New-skill suite-set:** No new skill.

**Reachability:** The retry path is reached by real lease rejections (Task 4's seam tests). The page-2 compare path is reached with `total_commits: 101`. The refresh is reached by a real `main` push.

**Guard-branch discrimination / Inserted-guard re-proof:** Each guard has an isolating input and a named revert (Tasks 1–5, Step 5).

**Mirror-surface enumeration:** No skill flag changes.

**Inline self-consistency / Go-red control:** No step inlines both a full test and a full implementation. Each go-red control runs the positive helper on a mutated copy (Task 6).

**Absence-grep control:** The only absence grep is the sole-site check above. It ran on the live tree and exited 1. The positive form `git grep -n -F "release-block" -- plugin/bin` matches, so the search can match.

**Cross-boundary:** The MCP agent is the external producer. Its file shape is guarded, and the contract documents it (Upstream-schema premise: the `get_file_contents` and `create_or_update_file` semantics are taken from `github-write-transport.md`'s conditional-write pattern).

**Consumer-enumeration / Dependency-caller enumeration / Reader-inventory:** There are no existing consumers. #5884 and #5885 are future consumers that cite the Task 6 headings.

**Retirement-sweep / Behavior-change sweep:** Nothing is retired or changed.

**AC clause ids:** Cited in test names (Tasks 1–5). The spec-coverage map follows.

**Verify-then-maybe-change:** `claim-store.js` and `issue-claims.md` are waived as read-only in Task 1.

**AC-evidence persistence:** Every AC is covered by a committed test. No scratch-only check carries an AC.

**Prohibition-vs-mandate / Trust-vs-distrust / Dispatcher-voice / Pairing-loop:** Not applicable.

**Per-task markers:** `Role` and `Review risk` set on each task.

**Governing-skill quote:** Global Constraints, verbatim.

## Follow-up (out of scope, explicit)

The generated `track-issue-fixes.yml` excludes `claims-registry` and `health-state` by name (`plugin/bin/lib/issue-branch-tracking.js:138-139`) but not `release-state`. Each marker push therefore creates one skipped workflow run in every repo carrying that workflow. The `#`-free message rule keeps the job from running. Adding `'!release-state'` changes a generated, digest-tracked workflow (`PRIOR_OUTPUT_SHA256`, `tests/issue-branch-tracking.test.js:571`), so it belongs in its own record. This run's wrap-up files it via `/claude-tweaks:capture`, with a spec-shaped body.

## Spec coverage map

| Spec item | Task |
|---|---|
| Deliverable 1: store; three read outcomes; absent only when confirmed; per-file CAS; create-if-not-exists init; sole writer | Tasks 1, 2 |
| Deliverable 2: marker, forward-only, at-or-past, retry once, init, same-sha no-op, re-validation, `version: 1`, ISO UTC, 40-hex, `run: "init"`, fetched history, insufficient-history, compare API | Tasks 3, 4 |
| Deliverable 3: CLI `marker read`/`advance`/`init`, documented exits | Task 5 |
| Deliverable 4: `_shared/release-state.md`, including the MCP procedure | Task 6 |
| AC1.1 | Tasks 3, 4, 5 |
| AC2.1 | Tasks 3, 4, 5 |
| AC3.1, AC3.2 | Task 4 (injected read seam, real git) |
| AC4.1 | Tasks 1, 2, 5 |
| AC5.1 | Tasks 1, 4, 5 |
| AC6.1 | Tasks 4, 5 |
| AC7.1 | Tasks 3, 4, 5 |
| AC8.1 | Tasks 3, 4, 5 |
| AC8.2, AC8.3 (malformed marker shapes are unreadable; the spec's bare lines parse as clauses of item 8) | Tasks 1, 3, 4, 5 |
| AC8.4–AC8.9 (orphaned exit; guarded, logged `marker reset`) | Tasks 3, 4, 5 |
| Gotchas: never write to `main`; a real gh-absent path; frozen contract with the `version` seam; claims tests stay green | Global Constraints; Tasks 1, 2, 5, 6 |
