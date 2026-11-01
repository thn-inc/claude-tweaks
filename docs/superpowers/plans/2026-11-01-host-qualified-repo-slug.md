# Host-qualified origin repo slug Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On a GitHub Enterprise origin, reconcile's and the claim store's `gh` calls should reach the origin's host. On a github.com origin, every argv and env should stay byte-identical.

**Architecture:** Add one host-aware sibling of `repoSlugOf`, called `repoTargetOf(repoRoot)` in `git-exec.js`. It returns the bare `owner/repo` slug, which stays the value for `repos/…` paths, GraphQL `owner`/`name` pairs, slug comparisons and cache keys. It also returns a `ghRepo` value for `--repo`, which is host-qualified only when the #4505 seam already treats the origin's host as a known GitHub Enterprise host and `GH_HOST` is not exported. The `--repo` callers move onto `ghRepo`: the residue escalation reached from `archive-merged.js` and `reap-merged.js`, and `claim-store.js`'s `openPrListArgs` together with its PR-url matcher. `release-merged.js`'s host-flagless REST calls already get `GH_HOST` from the seam. Their remaining gap is that the seam reads `process.cwd()` instead of the repo root, so they now pass `cwd: root`.

**Tech Stack:** Node 18+ CommonJS under `plugin/bin/`, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-11-01T193825-record-4794/work/4794-spec.md` (record #4794)

**Scope keywords:** repoSlugOf, openPrListArgs, isSameRepoPrUrl, staleClaimInFlightPr, tombstoneInFlightPr, matchStaleClaimPr

## Global Constraints

- A github.com origin keeps argv and env byte-identical to today on every migrated call (spec AC2). Keep `--repo acme/widgets` bare, add no `--hostname`, and inject no `GH_HOST`.
- Every `gh` spawn keeps routing its options through `repo-resolve.js`'s `ghOptions(args, …)`. Keep the site's `timeout`/`stdio`/`maxBuffer`/`windowsHide` literal inside that options object (`tests/gh-host-seam-conformance.test.js`).
- Governing skill `.claude/skills/gh-api-module-pattern/SKILL.md`, quoted verbatim:
  - "**Every `gh` spawn wraps its options in `plugin/bin/lib/repo-resolve.js`'s `ghOptions(args, …)`.** The seam injects `GH_HOST` for a GitHub Enterprise origin, so a spawn that skips it sends its call to github.com (#4505). Wrap the site's own options object and keep its `timeout`, `stdio`, `maxBuffer` and `windowsHide` literal inside it"
  - "**A `--repo` argument is a *slug*, and the slug is host-qualified — never hand-roll `` `${owner}/${repo}` `` at one.** `plugin/bin/lib/repo-resolve.js`'s `repoSlug({host, owner, repo})` (#2240) is the producer of the value `gh -R/--repo` takes: bare `owner/repo` on github.com, `host/owner/repo` on a GitHub Enterprise Server host, with a missing `host` reading as github.com"
  - "**Swapping one remote parser for another changes which remotes resolve — `parseRepo` returns `null` for an `ssh://` URL that `repoSlugOf` reads.** … Before calling a parser swap equivalent, run the old and the new over a `git@`, an `https://` and an `ssh://` remote."
  - "**Bound every remote-contacting call on the seam** … **`GH_TIMEOUT_MS` is a resolved value, not a literal — import it, never retype its default at a new call site.**"
- Governing skill `.claude/skills/bin-source-scan-conformance/SKILL.md`: it names `tests/gh-host-seam-conformance.test.js` as the scan these files must keep passing. This plan adds no new spawn shape, so none of its matcher rules change.
- `.claude/skills/mcp-agent-fetch-node-compute/SKILL.md` covers `stale-claim-pr.js --listing`. Its rule that any element which is not a PR is a failure, never a skipped entry, still holds: `normalizePrListing` is not changed.
- Use `fixtureGit`-style git calls in tests without a `process.platform` branch (`windows-checkout-test-parity`). Every in-process test that reads the seam deletes `GH_HOST` and calls `_resetGhHostCache()` before and after the case (the existing `withoutGhHost(t)` helper in `tests/gh-host-seam-behavior.test.js`).
- **Decision: the `--repo` host comes from the seam, never from the raw remote host.** `repoSpecOf`'s raw `parseRepo` host would qualify an SSH host alias (`git@github-work:acme/widgets.git` → `github-work/acme/widgets`), which `gh` cannot reach. That would break escalation and stale-claim listing for alias users, whose bare slug works today. `resolveGhHost(cwd)` admits only known enterprise hosts (`*.ghe.com`, a gh `hosts.yml` key, an enterprise token on a non-SSH remote), so an alias stays bare. `post-merge.js` and `teardown-run.js` keep their existing `repoSpecOf` (raw host) behavior. This plan leaves that divergence alone and files it as a follow-up.

## Review Focus

1. **SSH host-alias origin** (`git@github-work:acme/widgets.git`): `ghRepo` stays `acme/widgets`, exactly as today. Pinned in Task 1.
2. **`GH_HOST` exported** (any value): the user's value wins. `repoTargetOf` returns `host: null` and a bare `ghRepo`, and the bare `--repo` then follows `GH_HOST`, as it does today. Pinned in Task 1.
3. **The host-qualified value leaking into a comparison:** on a GHE origin, archive-merged's record check (`prClosesIssue` against `closingIssuesReferences`, which carry `owner/repo` with no host) must still see the bare slug. A merged run whose PR closes its record must still archive. Pinned in Task 3.
4. **Reconcile running with `process.cwd()` outside the repo root** (a test harness, or a caller passing `cwd`): release-merged's calls must follow the root's origin, not the process cwd's. Pinned in Task 2.
5. **Cross-host and look-alike PR urls:** when matching for host `acme.ghe.com`, a `https://github.com/acme/widgets/pull/1` url and a `https://acmeXghe.com/acme/widgets/pull/1` url (unescaped dot) must both be rejected. Pinned in Task 4.

---

### Task 1: `originGhHost` and `repoTargetOf`

**Role:** integration

**Files:**
- Modify: `plugin/bin/lib/repo-resolve.js` (add `originGhHost`, export it)
- Modify: `plugin/bin/lib/hooks/git-exec.js` (add `repoTargetOf`, export it; import `originGhHost` from `../repo-resolve`)
- Test: `tests/hooks-git-exec.test.js`, `tests/bin-lib/repo-resolve.test.js`

**Interfaces:**
- Produces: `originGhHost(cwd: string, deps?: { env?, remoteUrl?, readFile?, homedir?, platform?, stderr? }) -> string | null` returns null when `'GH_HOST' in (deps.env || process.env)`, and otherwise returns `resolveGhHost(cwd, deps)`.
- Produces: `repoTargetOf(repoRoot: string, deps?: object) -> { owner: string, repo: string, slug: string, host: string | null, ghRepo: string } | null`. `slug` is exactly `repoSlugOf(repoRoot)`, and the function returns null when that is null. `host` is `originGhHost(repoRoot, deps)`. `ghRepo` is `${host}/${slug}` when `host` is set, and `slug` otherwise.

- [ ] **Step 1: Write the failing tests**

In `tests/hooks-git-exec.test.js`, add `test('repoTargetOf: …')` cases. Each one makes a temp repo with that origin, deletes `GH_HOST` and resets the seam cache:
  - `https://acme.ghe.com/acme/widgets.git` → `{ owner: 'acme', repo: 'widgets', slug: 'acme/widgets', host: 'acme.ghe.com', ghRepo: 'acme.ghe.com/acme/widgets' }`
  - `git@acme.ghe.com:acme/widgets.git` and `ssh://git@acme.ghe.com/acme/widgets.git` → same `ghRepo: 'acme.ghe.com/acme/widgets'` (the parser-swap rule's three remote shapes)
  - `https://github.com/acme/widgets.git` → `host: null, ghRepo: 'acme/widgets'`
  - `git@github-work:acme/widgets.git` (SSH alias, pass `deps.readFile` throwing so no real `hosts.yml` is read) → `host: null, ghRepo: 'acme/widgets'` (Review Focus 1)
  - GHE origin with `deps.env = { GH_HOST: 'mine.example' }` → `host: null, ghRepo: 'acme/widgets'` (Review Focus 2)
  - no origin remote → `null`

In `tests/bin-lib/repo-resolve.test.js`: `originGhHost` returns null under `env: { GH_HOST: '' }` even for a `*.ghe.com` `remoteUrl`, and returns `'acme.ghe.com'` with `env: {}`.

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test tests/hooks-git-exec.test.js tests/bin-lib/repo-resolve.test.js`
Expected: FAIL with `repoTargetOf is not a function` / `originGhHost is not a function`

- [ ] **Step 3: Implement both functions** with the signatures above. `git-exec.js` already requires `../repo-resolve` for `parseRepo`, and `repo-resolve.js` does not require `git-exec.js`, so the import adds no cycle. Give each a header comment that names the alias rule from the Global Constraints decision.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/hooks-git-exec.test.js tests/bin-lib/repo-resolve.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/repo-resolve.js plugin/bin/lib/hooks/git-exec.js tests/hooks-git-exec.test.js tests/bin-lib/repo-resolve.test.js
git commit -m "Add repoTargetOf — origin slug plus a seam-qualified --repo value (refs #4794)"
```

### Task 2: release-merged follows the repo root's host

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/reconcile/release-merged.js` (`ghApi`, `ghApiAsync`, `ghRunner`, and their binding inside `releaseMerged`)
- Test: `tests/gh-host-seam-behavior.test.js`
- Waived `plugin/bin/lib/reconcile/pr-state.js`: every `gh` spawn there already passes `cwd: repoRoot` to `ghOptions`, and `repoSlugOf` feeds only GraphQL `-f owner=`/`-f name=` (must stay bare). Task 5 pins it with a test and does not change its code.

**Interfaces:**
- Produces: `ghApi(args: string[], cwd?: string)`, `ghApiAsync(args: string[], cwd?: string)`, `ghRunner(args: string[], cwd?: string)`. When `cwd` is given it goes into the `ghOptions` options object as `cwd`, and with no `cwd` the behavior is unchanged. `releaseMerged` binds `root`: `api = ghApiOverride || ((a) => ghApi(a, root))`, `apiAsync = ghApiOverride ? … : ((a) => ghApiAsync(a, root))`, and it passes `(a) => ghRunner(a, root)` as `writeTombstone`'s runner. `repoSlug` stays `repoSlugOf(root)`, the bare value for `repos/…` paths, `prClosesIssue` and `writeTombstone`'s `split('/')`.

- [ ] **Step 1: Write the failing tests** in `tests/gh-host-seam-behavior.test.js`. Install a `case`-style PATH stub (as `grantGateLines` does) that logs `GH_HOST` and argv. It answers `api repos/*/git/trees/claims-registry*` with one claim entry, and answers the contents read, the issue-state read (`CLOSED`), the tombstone PUT and the label DELETEs with minimal valid JSON. Model the claim blob on `tests/bin-lib/reconcile/release-merged.test.js`'s issue-closed release fixtures. Call `releaseMerged({ cwd: repo })` in-process, with `process.cwd()` left at this checkout:
  - `test('AC1.1: releaseMerged on a *.ghe.com origin sends every gh call to the origin host, whatever process.cwd() is', …)`: `assertEveryLineReaches(lines, 'acme.ghe.com')`. Also assert that the log contains the tree listing, the issue-state read, a `--method PUT` contents write and a `--method DELETE …labels/bot%3Ain-progress` call, so all three runners are reached (Review Focus 4).
  - `test('AC2.1: releaseMerged on a github.com origin leaves GH_HOST unset and argv unchanged', …)`: every network line starts `GH_HOST=unset `, and the tree-listing argv equals `api repos/acme/widgets/git/trees/claims-registry?recursive=1 -q {truncated: …}` exactly, with the `-q` text copied from `listClaimEntries`.

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test tests/gh-host-seam-behavior.test.js`
Expected: FAIL. The GHE case logs `GH_HOST=unset`, because the seam read `process.cwd()`, whose origin is github.com.

- [ ] **Step 3: Implement** the `cwd` parameters and the `releaseMerged` bindings from the Interfaces block.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/gh-host-seam-behavior.test.js tests/bin-lib/reconcile/release-merged.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/reconcile/release-merged.js tests/gh-host-seam-behavior.test.js
git commit -m "Bind release-merged gh calls to the repo root's host (refs #4794)"
```

### Task 3: residue escalation `--repo` carries the origin host

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/reconcile/archive-merged.js:2311` and its residue call sites (`track`'s `trackStuckSkip`, every `finishArchiveAttempt`, `trackArchiveResult`, both `archiveMergedRun({ repoSlug, … })` calls, `pruneResidueFailures`)
- Modify: `plugin/bin/lib/reconcile/reap-merged.js:210` (its three `trackReapResidue` calls)
- Waived `plugin/bin/lib/reconcile/post-merge.js`: already host-aware through `repoSpecOf` (`--repo host/owner/repo`, `--hostname`) since #4603, so no `repoSlugOf` call is left to migrate. Its raw-host-versus-seam-host divergence is filed as a follow-up.
- Test: `tests/gh-host-seam-behavior.test.js`, `tests/bin-lib/reconcile/archive-merged.test.js` (extend `fixtureOrdinaryMergedNoConsole`'s `origin` option to accept a URL string, keeping `true` as `git@github.com:acme/w.git`)

**Interfaces:**
- Consumes: `repoTargetOf` (Task 1).
- In `archiveMerged`: `const target = repoTargetOf(root); const repoSlug = target ? target.slug : null; const residueRepo = target ? target.ghRepo : null;`. Every residue-tracking argument (`trackStuckSkip`, `finishArchiveAttempt`, `trackArchiveResult`, `archiveMergedRun`'s `repoSlug:` field, `pruneResidueFailures`) gets `residueRepo`. `recordCheck: { records, repoSlug }` and both `byNumberRecordSkip(…, repoSlug)` calls keep the bare `repoSlug`. `archiveMergedRun`'s `repoSlug` parameter is used only for `trackArchiveResult` (line 2208), so rename it `residueRepo` there.
- In `reapMerged`: `const target = repoTargetOf(root); const residueRepo = target ? target.ghRepo : null;`, passed to every `trackReapResidue`. Drop the now-unused `repoSlugOf` import from both files only if nothing else in that file uses it.

- [ ] **Step 1: Write the failing tests**
  - In `tests/gh-host-seam-behavior.test.js`, write `test('AC1.1: archiveMerged on a *.ghe.com origin escalates structurally-stuck residue with --repo acme.ghe.com/acme/widgets', …)`. Model it on `archive-merged.test.js`'s "two dirs crossing the structurally-stuck threshold" test: seed one stuck dir one short of `RESIDUE_ESCALATE_THRESHOLD`, and inject a recording `runner` that answers `issue list` with `[]` and `issue create` with `https://acme.ghe.com/acme/widgets/issues/101`. Assert that at least one call was recorded and that every recorded argv contains `--repo`, `acme.ghe.com/acme/widgets` as adjacent elements.
  - In the same file, write the same test on `https://github.com/acme/widgets.git` named `AC2.1: …`, asserting every argv carries `--repo`, `acme/widgets`.
  - Write `test('AC1.1: reapMerged on a *.ghe.com origin escalates removal-failed residue with the host-qualified --repo', …)` and its `AC2.1` github.com twin. Model them on `reap-merged.test.js`'s "removal-failed … escalates once at the threshold" test (a locked worktree, `RESIDUE_ESCALATE_THRESHOLD` passes). Inject `prStates: { byBranch: () => ({ number: 9, state: 'MERGED', mergedAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' }) }` and the recording `runner`.
  - In `tests/bin-lib/reconcile/archive-merged.test.js`, write `test('#4794 Review Focus 3: on a *.ghe.com origin a merged run whose PR closes its record still archives (record check compares the bare slug)', …)` using `fixtureOrdinaryMergedNoConsole(…, { origin: 'https://acme.ghe.com/acme/w.git', closes: [<the run's record>] })` and the same assertions as that helper's existing archived-with-`closes` case. Deleting the `target.slug` half, so that `recordCheck` receives `ghRepo`, turns this red.

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test tests/gh-host-seam-behavior.test.js tests/bin-lib/reconcile/archive-merged.test.js`
Expected: the two GHE escalation cases FAIL (`--repo acme/widgets`). The github.com cases and the Review Focus 3 case pass before the change. Prove that Review Focus 3 can go red after Step 3 by temporarily passing `residueRepo` into `recordCheck`.

- [ ] **Step 3: Implement** the two derivations and the call-site argument changes from the Interfaces block.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/gh-host-seam-behavior.test.js tests/bin-lib/reconcile/archive-merged.test.js tests/bin-lib/reconcile/reap-merged.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/reconcile/archive-merged.js plugin/bin/lib/reconcile/reap-merged.js tests/gh-host-seam-behavior.test.js tests/bin-lib/reconcile/archive-merged.test.js
git commit -m "Host-qualify reconcile's residue-escalation --repo on a GHE origin (refs #4794)"
```

### Task 4: claim store and stale-claim matching on the origin host

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/issues/claim-store.js` (`openPrListArgs`, `isSameRepoPrUrl`, `matchStaleClaimPr`, `staleClaimInFlightPr`, `tombstoneInFlightPr`)
- Modify: `plugin/bin/lib/claim-targets/claim-targets.js` (`tombstoneInFlightPr` and `staleClaimInFlightPr` call sites, around lines 532 and 573)
- Modify: `plugin/bin/claim-targets.js` (`realDeps.ghHost`)
- Modify: `plugin/bin/stale-claim-pr.js` (`realDeps.ghHost`, the refusal at line 190, the header comment lines 49-53)
- Test: `tests/bin-lib/issues/claim-store.test.js`, `tests/bin-lib/claim-targets/claim-targets.test.js`, `tests/stale-claim-pr-cli.test.js` (rework the "a non-github.com host is the failure verdict" test), `tests/gh-host-seam-behavior.test.js`

**Interfaces:**
- Consumes: `originGhHost` (Task 1).
- Produces (each `host` defaults to `null`, and `null` or `'github.com'` keeps today's exact behavior):
  - `openPrListArgs(owner, repo, host = null)`: `--repo` value `repoSlug({ host, owner, repo })` (import `repoSlug` from `../repo-resolve`). The other argv elements are unchanged.
  - `isSameRepoPrUrl(link, owner, repo, host = null)`: anchored `^https://{escapeRegExp(host || 'github.com')}/{owner}/{repo}/pull/\d+$`. A null host keeps today's github.com-only behavior.
  - `matchStaleClaimPr(runId, prs, owner, repo, host = null)`, `tombstoneInFlightPr(content, gh, owner, repo, host = null)`, `staleClaimInFlightPr(content, gh, owner, repo, onError, host = null)`: each threads `host` into `isSameRepoPrUrl` / `openPrListArgs`.
  - `claim-targets` `run()`: `const ghHost = typeof deps.ghHost === 'function' ? deps.ghHost() : null;` is passed as the trailing `host` to both calls. `realDeps.ghHost = () => originGhHost(process.cwd())`.
  - `stale-claim-pr.js` `run()`: `realDeps.ghHost = () => originGhHost(process.cwd())`. Host resolution: an explicit host-qualified `--repo` uses its parsed host. A bare `--repo` is github.com (unchanged). On the origin path the host is `deps.ghHost()` when it equals the parsed origin host. Any other non-github.com host keeps the failure verdict, reworded to `stale-claim matching supports github.com and known GitHub Enterprise hosts only`, with no read and no `gh` call. The resolved host goes to `openPrListArgs` and `matchStaleClaimPr`.

- [ ] **Step 1: Write the failing tests**
  - `claim-store.test.js`: `openPrListArgs('acme', 'w', 'acme.ghe.com')` deep-equals today's array with `'acme.ghe.com/acme/w'` at the `--repo` value. `openPrListArgs('acme', 'w')` and `openPrListArgs('acme', 'w', 'github.com')` deep-equal the existing pinned array (AC2.1). `isSameRepoPrUrl('https://acme.ghe.com/acme/w/pull/7', 'acme', 'w', 'acme.ghe.com') === true`, while `'https://github.com/acme/w/pull/7'` and `'https://acmeXghe.com/acme/w/pull/7'` are false under that host (Review Focus 5). The GHE url is false with no host.
  - `claim-targets.test.js`: a stale claim on a GHE host (`deps.ghHost = () => 'acme.ghe.com'`) whose `gh pr list` answer holds a marked same-repo `https://acme.ghe.com/acme/w/pull/12` is skipped in-flight. The recorded `pr list` argv carries `--repo`, `acme.ghe.com/acme/w`.
  - `stale-claim-pr-cli.test.js`: rework the GHES-refusal test. `--repo ghe.example.com/acme/w` with a marked `https://ghe.example.com/acme/w/pull/7` listing → `{ match: true, link: 'https://ghe.example.com/acme/w/pull/7', failure: null }`. A GHES origin with `ghHost: () => 'ghe.example.com'` matches the same way, and on the gh path its `deps.calls.gh` holds `--repo ghe.example.com/acme/w`. A GHES origin with no `ghHost` (or `() => null`) keeps the failure verdict, with the new wording and no read or `gh` call.
  - `gh-host-seam-behavior.test.js`: `test('AC1.1: stale-claim-pr.js on a *.ghe.com origin lists open PRs on the origin host and matches its marked PR', …)`. Run the CLI as a child (`node(repo, …)`) in a GHE temp repo with the fake gh answering `pr list` with a marked `https://acme.ghe.com/acme/widgets/pull/12` entry. `assertEveryLineReaches(lines, 'acme.ghe.com')` and stdout `match: true`. Add `test('AC2.1: stale-claim-pr.js on a github.com origin keeps today\'s pr list argv', …)`, whose network line equals `GH_HOST=unset ARGS=pr list --repo acme/widgets --state open --json url,body,isCrossRepository --limit 1000`.

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test tests/bin-lib/issues/claim-store.test.js tests/bin-lib/claim-targets/claim-targets.test.js tests/stale-claim-pr-cli.test.js tests/gh-host-seam-behavior.test.js`
Expected: FAIL after Step 1 on every new GHE assertion. The AC2.1 argv pins pass before and after.

- [ ] **Step 3: Implement** the signatures and wiring from the Interfaces block. In `stale-claim-pr.js`'s header, replace the "github.com only" paragraph so it states the new rule: an explicit host-qualified `--repo` is trusted, an origin host is used only when the gh seam knows it, and anything else is the failure verdict.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/bin-lib/issues/claim-store.test.js tests/bin-lib/claim-targets/claim-targets.test.js tests/stale-claim-pr-cli.test.js tests/gh-host-seam-behavior.test.js tests/issue-claims-stale-open-pr-conformance.test.js tests/tidy-stale-claim-open-pr-conformance.test.js tests/gh-host-seam-conformance.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/issues/claim-store.js plugin/bin/lib/claim-targets/claim-targets.js plugin/bin/claim-targets.js plugin/bin/stale-claim-pr.js tests/bin-lib/issues/claim-store.test.js tests/bin-lib/claim-targets/claim-targets.test.js tests/stale-claim-pr-cli.test.js tests/gh-host-seam-behavior.test.js
git commit -m "Send claim-store PR listing and stale-claim matching to the origin host (refs #4794)"
```

### Task 5: a whole reconcile pass on a GHE origin, the pr-state pin, and the stale-limitation prose

**Role:** integration

**Files:**
- Test: `tests/gh-host-seam-behavior.test.js`
- Modify: `.claude/skills/gh-api-module-pattern/SKILL.md` (the `--repo`-is-a-slug paragraph, the sentence beginning "so a bare slug passed as `--repo` (`escalate-residue.js`'s calls, `claim-store.js`'s `openPrListArgs`) is github.com-only by inheritance")

**Interfaces:**
- Consumes: Tasks 1-4.

- [ ] **Step 1: Write the tests**
  - `test('AC1.1: a whole reconcile pass (hooks.js reconcile) on a *.ghe.com origin sends every gh call to the origin host', …)`: a GHE temp repo with `CLAUDE.md` `work-backend: github-issues` and a fake gh on PATH (a `case` stub answering the claims tree listing with `{"truncated":false,"entries":[]}` and anything else with `[]`). Run `node plugin/bin/hooks.js reconcile` as a child with `cwd: repo` and `childEnv()` plus `GIT_TERMINAL_PROMPT=0`. The pass may `git fetch` the `https://acme.ghe.com/…` origin, and that fetch must fail fast instead of prompting. If a network `git` call still makes the case slow or flaky, stop and report it rather than loosening the assertion. Assert `assertEveryLineReaches(lines, 'acme.ghe.com')`, whose own `net.length >= 1` floor proves at least release-merged's tree listing ran.
  - `test('AC1.1: pr-state\'s bulk PR screen on a *.ghe.com origin reaches the origin host with a bare owner/name pair', …)`: `resolvePrStatesBulk(repo, ['feature'])` in-process with the fake gh. The logged line starts `GH_HOST=acme.ghe.com ` and carries `-f owner=acme -f name=widgets`.

- [ ] **Step 2: Run them**

Run: `node --test tests/gh-host-seam-behavior.test.js`
Expected: PASS (Tasks 1-4 landed). Prove the reconcile case can go red: temporarily revert Task 3's `residueRepo` in `archive-merged.js` and seed a stuck dir at threshold, or revert Task 2's binding and run the pass in-process from this checkout's cwd. Then restore.

- [ ] **Step 3: Update the skill sentence** so it says the escalation and `openPrListArgs` `--repo` now go through `git-exec.js`'s `repoTargetOf(...).ghRepo` / a threaded `host`, qualified only for a seam-known GHE host. It should also say that `release-merged.js`'s REST calls pass `cwd: root` so the seam reads the root's origin, not `process.cwd()`. Keep the rest of the paragraph.

- [ ] **Step 4: Run the record's acceptance command and the seam scan**

Run: `node --test tests/gh-host-seam-behavior.test.js tests/gh-host-seam-conformance.test.js`
Expected: PASS (spec AC3.1)

- [ ] **Step 5: Commit**

```bash
git add tests/gh-host-seam-behavior.test.js .claude/skills/gh-api-module-pattern/SKILL.md
git commit -m "Pin a whole GHE reconcile pass and retire the github.com-only --repo note (refs #4794)"
```

## Spec coverage

| Spec item | Task |
|---|---|
| Deliverable 1 (host-aware sibling, move reconcile callers and claim-store onto it) | 1, 2, 3, 4 |
| Deliverable 2 (slug comparisons and `repos/…` paths stay consistent; github.com byte-identical) | 2, 3 (Review Focus 3), 4 |
| Deliverable 3 (GHE-origin case per migrated caller in `tests/gh-host-seam-behavior.test.js`) | 2, 3, 4, 5 |
| AC1.1 | 2, 3, 4, 5 |
| AC2.1 | 2, 3, 4 (github.com twins) |
| AC3.1 | 5 Step 4 |
| Key File `post-merge.js` | Waived `plugin/bin/lib/reconcile/post-merge.js`: already host-aware through `repoSpecOf` (`--repo host/owner/repo`, `--hostname`) since #4603. Its raw-host-versus-seam-host divergence is filed as a follow-up, not changed here |
| Key File `pr-state.js` | Waived above (Task 2), pinned by Task 5's test |
