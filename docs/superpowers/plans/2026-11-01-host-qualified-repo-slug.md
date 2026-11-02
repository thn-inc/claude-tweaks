# Host-qualified origin repo slug Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On a GitHub Enterprise origin, reconcile's and the claim store's `gh` calls reach the origin's host. On a github.com origin, every argv and env stays byte-identical. One host rule, the #4505 seam's, applies across the whole reconcile pass.

**Architecture:** `repo-resolve.js` gains `originGhHost(cwd)`: the seam's `resolveGhHost(cwd)`, or null when `GH_HOST` is exported. `git-exec.js` gains `repoTargetOf(repoRoot)`, which returns the bare `slug` (still the value for `repos/…` paths, GraphQL `owner`/`name` pairs, slug comparisons and cache keys) plus a `ghRepo` value for `--repo`, host-qualified only when `originGhHost` names a host. The `--repo` callers move onto `ghRepo` or a threaded `host`: the residue escalation reached from `archive-merged.js` and `reap-merged.js`, and `claim-store.js`'s `openPrListArgs` and its PR-url matcher. `release-merged.js`'s host-flagless REST calls pass `cwd: root`, so the seam reads the root's origin rather than `process.cwd()`. `post-merge.js` and `teardown-run.js` stop using `repoSpecOf`'s raw remote host. They keep `repoSpecOf` for owner/repo and take their host from `originGhHost(root)` instead.

**Tech Stack:** Node 18+ CommonJS under `plugin/bin/`, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-11-02T124602-record-4794/work/4794-spec.md` (record #4794)

**Scope keywords:** repoSlugOf, repoSpecOf, openPrListArgs, isSameRepoPrUrl, staleClaimInFlightPr, tombstoneInFlightPr, matchStaleClaimPr, ghApiDelete

## Global Constraints

- A github.com origin keeps argv and env byte-identical to today on every migrated call (spec AC2). Keep `--repo acme/widgets` bare, add no `--hostname`, and inject no `GH_HOST`.
- **Decision (spec, Reading B):** a host is qualified only when the #4505 seam already treats it as GitHub Enterprise, through `resolveGhHost(cwd)` in `plugin/bin/lib/repo-resolve.js`. Today that means `*.ghe.com` or a gh `hosts.yml` key; since #4854 an enterprise token alone admits nothing, so the spec's "enterprise token on a non-SSH remote" clause no longer applies. github.com, an SSH-alias origin (`git@github-work:acme/widgets.git`) and an unknown host (`ghe.example.com` with no `hosts.yml` key) stay bare, with no `--hostname`.
- **Decision (spec, in scope):** `post-merge.js` and `teardown-run.js` follow the same rule. An SSH-alias or unknown-host origin, which today gets `--repo github-work/acme/w` / `--hostname github-work`, now gets the bare slug and no `--hostname`. A GHE origin with `GH_HOST` exported gets no explicit host, and the user's `GH_HOST` decides (#4505 AC4). Both of these behavior changes are intended.
- Every `gh` spawn keeps routing its options through `repo-resolve.js`'s `ghOptions(args, …)`, with the site's `timeout`/`stdio`/`maxBuffer`/`windowsHide` literal inside that options object (`tests/gh-host-seam-conformance.test.js`).
- Governing skill `.claude/skills/gh-api-module-pattern/SKILL.md`, quoted verbatim:
  - "**Every `gh` spawn wraps its options in `plugin/bin/lib/repo-resolve.js`'s `ghOptions(args, …)`.** The seam injects `GH_HOST` for a GitHub Enterprise origin, so a spawn that skips it sends its call to github.com (#4505). Wrap the site's own options object and keep its `timeout`, `stdio`, `maxBuffer` and `windowsHide` literal inside it"
  - "**A `--repo` argument is a *slug*, and the slug is host-qualified — never hand-roll `` `${owner}/${repo}` `` at one.**"
  - "**Swapping one remote parser for another changes which remotes resolve — `parseRepo` returns `null` for an `ssh://` URL that `repoSlugOf` reads.** … Before calling a parser swap equivalent, run the old and the new over a `git@`, an `https://` and an `ssh://` remote."
  - "Give each call one owner for its host, and assert the flag count as well as its position."
- Governing skill `.claude/skills/bin-source-scan-conformance/SKILL.md` names `tests/gh-host-seam-conformance.test.js` as the scan these files must keep passing. No new spawn shape is added.
- `.claude/skills/mcp-agent-fetch-node-compute/SKILL.md` covers `stale-claim-pr.js --listing`. `normalizePrListing` is not changed.
- Every in-process test that reads the seam deletes `GH_HOST` and calls `_resetGhHostCache()` before and after the case (`withoutGhHost(t)` in `tests/gh-host-seam-behavior.test.js`). A case whose verdict depends on `hosts.yml` (alias, unknown host, hosts.yml-known host) also points `GH_CONFIG_DIR` at a temp dir it controls, so the developer's own `~/.config/gh/hosts.yml` cannot change the verdict. Child-process cases pass the same `GH_CONFIG_DIR` in their env.

## Review Focus

1. **SSH host-alias origin** (`git@github-work:acme/widgets.git`): every migrated caller (`--repo` value, `--hostname`, `GH_HOST`) stays bare. Pinned in Task 1 (`repoTargetOf`) and in Task 5 (post-merge, teardown).
2. **`GH_HOST` exported** (any value): `originGhHost` returns null, so nothing names a host explicitly and the user's value wins. Pinned in Task 1 and in Task 5 (post-merge hands `host: null` on a GHE origin under `GH_HOST`).
3. **Host-qualified value leaking into a comparison:** on a GHE origin, archive-merged's record check (`prClosesIssue` against `closingIssuesReferences`, which carry a host-less `owner/repo`) must still see the bare slug. Pinned in Task 3.
4. **`process.cwd()` outside the repo root:** release-merged's calls follow the root's origin. Pinned in Task 2.
5. **Cross-host and look-alike PR urls:** under host `acme.ghe.com`, `https://github.com/acme/widgets/pull/1` and `https://acmeXghe.com/acme/widgets/pull/1` (unescaped dot) are both rejected. Pinned in Task 4.

---

### Task 1: `originGhHost` and `repoTargetOf`

**Role:** integration

**Files:**
- Modify: `plugin/bin/lib/repo-resolve.js` (add `originGhHost`, export it)
- Modify: `plugin/bin/lib/hooks/git-exec.js` (add `repoTargetOf`, export it; import `originGhHost` and `repoSlug` from `../repo-resolve`)
- Test: `tests/hooks-git-exec.test.js`, `tests/bin-lib/repo-resolve.test.js`

**Interfaces:**
- Produces: `originGhHost(cwd: string, deps?: { env?, remoteUrl?, readFile?, homedir?, platform?, stderr? }) -> string | null`. Returns null when `'GH_HOST' in (deps.env || process.env)`, else `resolveGhHost(cwd, deps)`.
- Produces: `repoTargetOf(repoRoot: string, deps?: object) -> { owner: string, repo: string, slug: string, host: string | null, ghRepo: string } | null`. `slug` is exactly `repoSlugOf(repoRoot)`, and the function returns null when that is null. `owner`/`repo` are `slug` split at `/`. `host` is `originGhHost(repoRoot, deps)`. `ghRepo` is `repoSlug({ host, owner, repo })`.

- [ ] **Step 1: Write the failing tests**

In `tests/hooks-git-exec.test.js`, add `test('repoTargetOf: …')` cases. Each one makes a temp repo with that origin, deletes `GH_HOST`, resets the seam cache, and passes `deps.readFile` so no real `hosts.yml` is read:
  - `https://acme.ghe.com/acme/widgets.git` → `{ owner: 'acme', repo: 'widgets', slug: 'acme/widgets', host: 'acme.ghe.com', ghRepo: 'acme.ghe.com/acme/widgets' }`
  - `git@acme.ghe.com:acme/widgets.git` and `ssh://git@acme.ghe.com/acme/widgets.git` → the same object (the parser-swap rule's three shapes; the seam's `hostPathOf` strips the `ssh://git@` prefix before `parseRepo`)
  - `https://ghe.example.com/acme/widgets.git` with `deps.readFile` returning `'ghe.example.com:\n    user: x\n'` → `host: 'ghe.example.com', ghRepo: 'ghe.example.com/acme/widgets'`. With `deps.readFile` throwing → `host: null, ghRepo: 'acme/widgets'`
  - `https://github.com/acme/widgets.git` → `host: null, ghRepo: 'acme/widgets'`
  - `git@github-work:acme/widgets.git` with `deps.readFile` throwing → `host: null, ghRepo: 'acme/widgets'` (Review Focus 1)
  - GHE origin with `deps.env = { GH_HOST: 'mine.example' }` → `host: null, ghRepo: 'acme/widgets'` (Review Focus 2)
  - no origin remote → `null`

In `tests/bin-lib/repo-resolve.test.js`: `originGhHost` returns null under `env: { GH_HOST: '' }` even for a `*.ghe.com` `remoteUrl`, and returns `'acme.ghe.com'` with `env: {}`.

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test tests/hooks-git-exec.test.js tests/bin-lib/repo-resolve.test.js`
Expected: FAIL with `repoTargetOf is not a function` / `originGhHost is not a function`

- [ ] **Step 3: Implement both functions** with the signatures above. `git-exec.js` already requires `../repo-resolve` for `parseRepo`, and `repo-resolve.js` does not require `git-exec.js`, so the import adds no cycle. Give each a header comment stating the rule: a host is named only when the seam already knows it, so an SSH alias or unknown host stays bare.

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
- Modify: `plugin/bin/lib/reconcile/release-merged.js` (`ghApi` line 171, `ghRunner` line 184, `ghApiAsync` line 222, and their binding inside `releaseMerged` line 348)
- Test: `tests/gh-host-seam-behavior.test.js`
- Waived `plugin/bin/lib/reconcile/pr-state.js`: every `gh` spawn there already passes `cwd: repoRoot` to `ghOptions`, and `repoSlugOf` feeds only GraphQL `-f owner=`/`-f name=`, which must stay bare. Task 6 pins it with a test and does not change its code.

**Interfaces:**
- Produces: `ghApi(args: string[], cwd?: string)`, `ghApiAsync(args: string[], cwd?: string)`, `ghRunner(args: string[], cwd?: string)`. A given `cwd` goes into the `ghOptions` options object as `cwd`. With no `cwd`, behavior is unchanged. `releaseMerged` binds `root`: `api = ghApiOverride || ((a) => ghApi(a, root))`, `apiAsync = ghApiOverride ? … : ((a) => ghApiAsync(a, root))`, and it passes `(a) => ghRunner(a, root)` as `writeTombstone`'s runner (line 592). `repoSlug` stays `repoSlugOf(root)`, the bare value.

- [ ] **Step 1: Write the failing tests** in `tests/gh-host-seam-behavior.test.js`. Install a `case`-style PATH stub (as `grantGateLines` does) that logs `GH_HOST` and argv. It answers `api repos/*/git/trees/claims-registry*` with one claim entry, and answers the contents read, the issue-state read (`CLOSED`), the tombstone PUT and the label DELETEs with minimal valid JSON. Model the claim blob on `tests/bin-lib/reconcile/release-merged.test.js`'s issue-closed release fixtures. Call `releaseMerged({ cwd: repo })` in-process, with `process.cwd()` left at this checkout:
  - `test('AC1.1: releaseMerged on a *.ghe.com origin sends every gh call to the origin host, whatever process.cwd() is', …)`: `assertEveryLineReaches(lines, 'acme.ghe.com')`. Also assert that the log contains the tree listing, the issue-state read, a `--method PUT` contents write and a `--method DELETE …labels/bot%3Ain-progress` call, so all three runners are reached (Review Focus 4).
  - `test('AC2.1: releaseMerged on a github.com origin leaves GH_HOST unset and argv unchanged', …)`: every network line starts `GH_HOST=unset `, and the tree-listing argv equals `api repos/acme/widgets/git/trees/claims-registry?recursive=1 -q {…}` exactly, with the `-q` text copied from `claim-store.js`'s `listClaimEntries`.

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
- Modify: `plugin/bin/lib/reconcile/reap-merged.js:210` (its `trackReapResidue` calls)
- Test: `tests/gh-host-seam-behavior.test.js`, `tests/bin-lib/reconcile/archive-merged.test.js` (extend `fixtureOrdinaryMergedNoConsole`'s `origin` option to accept a URL string, keeping `true` as today's default)

**Interfaces:**
- Consumes: `repoTargetOf` (Task 1).
- In `archiveMerged`: `const target = repoTargetOf(root); const repoSlug = target ? target.slug : null; const residueRepo = target ? target.ghRepo : null;`. Every residue-tracking argument (`trackStuckSkip`, `finishArchiveAttempt`, `trackArchiveResult`, `archiveMergedRun`'s `repoSlug:` field, `pruneResidueFailures`) gets `residueRepo`. `recordCheck: { records, repoSlug }` and both `byNumberRecordSkip(…, repoSlug)` calls keep the bare `repoSlug`. Inside `archiveMergedRun`, its `repoSlug` parameter feeds only `trackArchiveResult`, so rename it `residueRepo` there.
- In `reapMerged`: `const target = repoTargetOf(root); const residueRepo = target ? target.ghRepo : null;`, passed to every `trackReapResidue`. Drop the `repoSlugOf` import from either file only if nothing else in it uses it.

- [ ] **Step 1: Write the failing tests**
  - In `tests/gh-host-seam-behavior.test.js`, write `test('AC1.1: archiveMerged on a *.ghe.com origin escalates structurally-stuck residue with --repo acme.ghe.com/acme/widgets', …)`. Model it on `archive-merged.test.js`'s "two dirs crossing the structurally-stuck threshold" test: seed one stuck dir one short of `RESIDUE_ESCALATE_THRESHOLD`, and inject a recording `runner` that answers `issue list` with `[]` and `issue create` with `https://acme.ghe.com/acme/widgets/issues/101`. Assert at least one call was recorded, and that every recorded argv holds `--repo`, `acme.ghe.com/acme/widgets` as adjacent elements, exactly once.
  - The github.com twin, named `AC2.1: …`, asserts every argv carries `--repo`, `acme/widgets`.
  - `test('AC1.1: reapMerged on a *.ghe.com origin escalates removal-failed residue with the host-qualified --repo', …)` and its `AC2.1` github.com twin. Model them on `reap-merged.test.js`'s "removal-failed … escalates once at the threshold" test (a locked worktree, `RESIDUE_ESCALATE_THRESHOLD` passes). Inject `prStates: { byBranch: () => ({ number: 9, state: 'MERGED', mergedAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' }) }` and the recording `runner`.
  - In `tests/bin-lib/reconcile/archive-merged.test.js`, write `test('#4794 Review Focus 3: on a *.ghe.com origin a merged run whose PR closes its record still archives (record check compares the bare slug)', …)` using `fixtureOrdinaryMergedNoConsole(…, { origin: 'https://acme.ghe.com/acme/w.git', closes: [<the run's record>] })`, with the same assertions as that helper's existing archived-with-`closes` case.

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test tests/gh-host-seam-behavior.test.js tests/bin-lib/reconcile/archive-merged.test.js`
Expected: the two GHE escalation cases FAIL (`--repo acme/widgets`). The github.com cases and Review Focus 3 pass before the change. After Step 3, prove Review Focus 3 can go red by temporarily passing `residueRepo` into `recordCheck`, then restore.

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
- Modify: `plugin/bin/lib/issues/claim-store.js` (`isSameRepoPrUrl` :645, `tombstoneInFlightPr` :663, `openPrListArgs` :688, `matchStaleClaimPr` :707, `staleClaimInFlightPr` :743)
- Modify: `plugin/bin/lib/claim-targets/claim-targets.js` (the `tombstoneInFlightPr` call at :549 and the `staleClaimInFlightPr` call at :590)
- Modify: `plugin/bin/claim-targets.js` (`realDeps.ghHost`)
- Modify: `plugin/bin/stale-claim-pr.js` (`realDeps.ghHost`, the refusal at :189-192, the header comment at :49-53)
- Test: `tests/bin-lib/issues/claim-store.test.js`, `tests/bin-lib/claim-targets/claim-targets.test.js`, `tests/stale-claim-pr-cli.test.js` (rework the test pinning `stale-claim matching supports github.com only`), `tests/gh-host-seam-behavior.test.js`

**Interfaces:**
- Consumes: `originGhHost` (Task 1).
- Produces (each `host` defaults to `null`, and `null` or `'github.com'` keeps today's exact behavior):
  - `openPrListArgs(owner, repo, host = null)`: the `--repo` value is `repoSlug({ host, owner, repo })` (import `repoSlug` from `../repo-resolve`). The other argv elements are unchanged.
  - `isSameRepoPrUrl(link, owner, repo, host = null)`: anchored `^https://{escapeRegExp(host || 'github.com')}/{owner}/{repo}/pull/\d+$`.
  - `matchStaleClaimPr(runId, prs, owner, repo, host = null)`, `tombstoneInFlightPr(content, gh, owner, repo, host = null)`, `staleClaimInFlightPr(content, gh, owner, repo, onError, host = null)`: each threads `host` into `isSameRepoPrUrl` / `openPrListArgs`.
  - `claim-targets` `run()`: `const ghHost = typeof deps.ghHost === 'function' ? deps.ghHost() : null;`, passed as the trailing `host` to both calls. `realDeps.ghHost = () => originGhHost(process.cwd())`.
  - `stale-claim-pr.js` `run()`: `realDeps.ghHost = () => originGhHost(process.cwd())`. An explicit host-qualified `--repo` uses its parsed host. A bare `--repo` is github.com, as today. On the origin path, the host is `deps.ghHost()` when it equals the parsed origin host. Any other non-github.com host keeps the failure verdict, reworded to `stale-claim matching supports github.com and known GitHub Enterprise hosts only`, with no read and no `gh` call. The resolved host goes to `openPrListArgs` and `matchStaleClaimPr`.

- [ ] **Step 1: Write the failing tests**
  - `claim-store.test.js`: `openPrListArgs('acme', 'w', 'acme.ghe.com')` deep-equals today's array with `'acme.ghe.com/acme/w'` at the `--repo` value. `openPrListArgs('acme', 'w')` and `openPrListArgs('acme', 'w', 'github.com')` deep-equal the existing pinned array (AC2.1). `isSameRepoPrUrl('https://acme.ghe.com/acme/w/pull/7', 'acme', 'w', 'acme.ghe.com') === true`. Under that host, `'https://github.com/acme/w/pull/7'` and `'https://acmeXghe.com/acme/w/pull/7'` are false (Review Focus 5). The GHE url is false with no host.
  - `claim-targets.test.js`: a stale claim with `deps.ghHost = () => 'acme.ghe.com'`, whose `gh pr list` answer holds a marked same-repo `https://acme.ghe.com/acme/w/pull/12`, is skipped as in-flight. The recorded `pr list` argv carries `--repo`, `acme.ghe.com/acme/w`.
  - `stale-claim-pr-cli.test.js`: rework the GHES-refusal test. `--repo ghe.example.com/acme/w` with a marked `https://ghe.example.com/acme/w/pull/7` listing → `{ match: true, link: 'https://ghe.example.com/acme/w/pull/7', failure: null }`. A GHES origin with `ghHost: () => 'ghe.example.com'` matches the same way, and on the gh path its `deps.calls.gh` holds `--repo ghe.example.com/acme/w`. A GHES origin with no `ghHost` (or `() => null`) keeps the failure verdict, with the new wording and no read or `gh` call.
  - `gh-host-seam-behavior.test.js`: `test('AC1.1: stale-claim-pr.js on a *.ghe.com origin lists open PRs on the origin host and matches its marked PR', …)`. Run the CLI as a child (`node(repo, …)`) in a GHE temp repo, with the fake gh answering `pr list` with a marked `https://acme.ghe.com/acme/widgets/pull/12` entry. Assert `assertEveryLineReaches(lines, 'acme.ghe.com')` and stdout `match: true`. Add `test('AC2.1: stale-claim-pr.js on a github.com origin keeps today\'s pr list argv', …)`, whose network line equals `GH_HOST=unset ARGS=pr list --repo acme/widgets --state open --json url,body,isCrossRepository --limit 1000`.

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test tests/bin-lib/issues/claim-store.test.js tests/bin-lib/claim-targets/claim-targets.test.js tests/stale-claim-pr-cli.test.js tests/gh-host-seam-behavior.test.js`
Expected: FAIL on every new GHE assertion. The AC2.1 argv pins pass before and after.

- [ ] **Step 3: Implement** the signatures and wiring from the Interfaces block. Replace `stale-claim-pr.js`'s "github.com only" header paragraph with the new rule: an explicit host-qualified `--repo` is trusted, an origin host is used only when the gh seam knows it, and anything else is the failure verdict.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/bin-lib/issues/claim-store.test.js tests/bin-lib/claim-targets/claim-targets.test.js tests/stale-claim-pr-cli.test.js tests/gh-host-seam-behavior.test.js tests/issue-claims-stale-open-pr-conformance.test.js tests/tidy-stale-claim-open-pr-conformance.test.js tests/gh-host-seam-conformance.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/issues/claim-store.js plugin/bin/lib/claim-targets/claim-targets.js plugin/bin/claim-targets.js plugin/bin/stale-claim-pr.js tests/bin-lib/issues/claim-store.test.js tests/bin-lib/claim-targets/claim-targets.test.js tests/stale-claim-pr-cli.test.js tests/gh-host-seam-behavior.test.js
git commit -m "Send claim-store PR listing and stale-claim matching to the origin host (refs #4794)"
```

### Task 5: post-merge and teardown-run take the seam's host

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/reconcile/post-merge.js:308-311` (`setupContext`: owner/repo still from `repoSpecOf(root)`, `host` from `originGhHost(root)`; update the comment at :308)
- Modify: `plugin/bin/lib/hooks/teardown-run.js:287-292` (pass `originGhHost(root)` to `ghApiDelete`, not `repoSpec.host`; update the comment at :17)
- Test: `tests/bin-lib/reconcile/post-merge.test.js` (the `host: 'github.com'` pin at :123 becomes `host: null`; rework the test at :684), `tests/hooks-teardown-run.test.js` (rework AC15 at :355; AC14's `defaultGhApiDelete` unit test is unchanged), `tests/gh-host-seam-behavior.test.js`

**Interfaces:**
- Consumes: `originGhHost` (Task 1).
- `setupContext` returns `host: originGhHost(root)` (a string or null) in place of `repoSpec.host`. Nothing else reads `repoSpec.host` there. `closeBelowFloorParents` already reads a null host as github.com: bare `--repo`, no `--hostname`.
- `teardownRun`'s Step 5 calls `ghApiDelete([`repos/${repoSpec.owner}/${repoSpec.repo}/git/refs/heads/${branch}`], originGhHost(root))`. `defaultGhApiDelete(args, host)` is unchanged and still omits `--hostname` for a null host.
- `repoSpecOf` stays exported from `git-exec.js` and re-exported from `teardown-run.js` (`tests/hooks-git-exec.test.js` pins it).

- [ ] **Step 1: Write the failing tests.** Every case sets `GH_CONFIG_DIR` to a temp dir it controls and deletes `GH_HOST` (resetting the seam cache) for its duration.
  - `post-merge.test.js`: replace the `'a GitHub Enterprise origin hands Step 4.0b its host; …'` test with `test('#4794: Step 4.0b gets the seam host — a known GHE host is named, an SSH alias, unknown host or github.com origin is not', …)`. Iterate `[origin, hostsYml, expectedHost]`:
    - `git@acme.ghe.com:acme/w.git`, none → `'acme.ghe.com'`
    - `https://acme.ghe.com/acme/w.git`, none → `'acme.ghe.com'`
    - `https://ghe.example.com/acme/w.git`, `'ghe.example.com:\n'` → `'ghe.example.com'`
    - `https://ghe.example.com/acme/w.git`, none → `null`
    - `git@github-work:acme/w.git`, none → `null` (Review Focus 1)
    - `https://github.com/acme/w.git`, none → `null`
    In every case `owner` is `'acme'` and `repo` is `'w'`. Add `test('#4794: with GH_HOST exported, Step 4.0b names no host on a GHE origin', …)`, which uses `git@acme.ghe.com:acme/w.git` and `process.env.GH_HOST = 'mine.example'` and expects `host: null` (Review Focus 2). Change the pin at :123 to `host: null`.
  - `hooks-teardown-run.test.js`: rework AC15 into `test('AC15 (#2747, #4794): teardown-run hands ghApiDelete the seam host — a hosts.yml-known GHES host is named, an SSH alias is not', …)`. With origin `git@ghe.example.com:acme/widgets.git` and `hosts.yml` `'ghe.example.com:\n'`, the call is `{ args: [...], host: 'ghe.example.com' }`. With origin `git@github-work:acme/widgets.git` and an empty config dir, it is `host: null`.
  - `gh-host-seam-behavior.test.js`: write `test('AC1.1: teardown-run on a *.ghe.com origin sends its remote-ref delete to the origin host', …)`. Use the real `defaultGhApiDelete` with the fake gh on PATH, and build the run fixture after `hooks-teardown-run.test.js`'s AC16 shape (run-state `pr.branch` set, no worktree recorded). The one network line carries `--hostname acme.ghe.com` exactly once. Write `test('#4794: teardown-run on an SSH-alias origin sends its remote-ref delete with no --hostname', …)`, whose line is `GH_HOST=unset ARGS=api --method DELETE repos/acme/widgets/git/refs/heads/<branch>`. Extend `reachesHost` so that `--hostname[ =]{host}` also counts as reaching the host.

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test tests/bin-lib/reconcile/post-merge.test.js tests/hooks-teardown-run.test.js tests/gh-host-seam-behavior.test.js`
Expected: FAIL. The alias and unknown-host cases get `'github-work'` / `'ghe.example.com'`, the github.com cases get `'github.com'`, and the `GH_HOST` case gets `'acme.ghe.com'`.

- [ ] **Step 3: Implement** the two host swaps from the Interfaces block.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/bin-lib/reconcile/post-merge.test.js tests/hooks-teardown-run.test.js tests/gh-host-seam-behavior.test.js tests/bin-lib/issues/below-floor-parent-close.test.js tests/post-merge-run-cli.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/reconcile/post-merge.js plugin/bin/lib/hooks/teardown-run.js tests/bin-lib/reconcile/post-merge.test.js tests/hooks-teardown-run.test.js tests/gh-host-seam-behavior.test.js
git commit -m "Align post-merge and teardown-run to the seam host rule (refs #4794)"
```

### Task 6: a whole reconcile pass on a GHE origin, the pr-state pin, and the stale prose

**Role:** integration

**Files:**
- Test: `tests/gh-host-seam-behavior.test.js`
- Modify: `.claude/skills/gh-api-module-pattern/SKILL.md` (paragraph :64, the `teardown-run.js` … "now imports `git-exec.js`'s `repoSpecOf` (#4603)" sentence; paragraph :66, the sentence "so a bare slug passed as `--repo` (`escalate-residue.js`'s calls, `claim-store.js`'s `openPrListArgs`) is github.com-only by inheritance" and the closing "`repoSpecOf(repoRoot)` (#4603) … `reconcile/post-merge.js` and `hooks/teardown-run.js` use it" sentence; paragraph :70, "it takes the host from `git-exec.js`'s `repoSpecOf`")
- Modify: `docs/reconcile-checks.md:706-709` (the "origin remote's host is kept (`git-exec.js`'s `repoSpecOf`)" sentence)

**Interfaces:**
- Consumes: Tasks 1-5.

- [ ] **Step 1: Write the tests**
  - `test('AC1.1: a whole reconcile pass (hooks.js reconcile) on a *.ghe.com origin sends every gh call to the origin host', …)`: a GHE temp repo with `CLAUDE.md` `work-backend: github-issues`, and a fake gh on PATH (a `case` stub answering the claims tree listing with `{"truncated":false,"entries":[]}` and anything else with `[]`). Run `node plugin/bin/hooks.js reconcile` as a child with `cwd: repo` and `childEnv()` plus `GIT_TERMINAL_PROMPT=0`. The pass may `git fetch` the `https://acme.ghe.com/…` origin, and that fetch must fail fast rather than prompt. If a network `git` call still makes the case slow or flaky, stop and report it rather than loosening the assertion. Assert `assertEveryLineReaches(lines, 'acme.ghe.com')`, whose `net.length >= 1` floor proves at least release-merged's tree listing ran.
  - `test('AC1.1: pr-state\'s bulk PR screen on a *.ghe.com origin reaches the origin host with a bare owner/name pair', …)`: `resolvePrStatesBulk(repo, ['feature'])` in-process with the fake gh. The logged line starts `GH_HOST=acme.ghe.com ` and carries `-f owner=acme -f name=widgets`.

- [ ] **Step 2: Run them**

Run: `node --test tests/gh-host-seam-behavior.test.js`
Expected: PASS (Tasks 1-5 landed). Prove the reconcile case can go red: temporarily revert Task 2's `root` binding and run the pass in-process from this checkout's cwd, then restore.

- [ ] **Step 3: Update the prose.** In the skill: the residue-escalation and `openPrListArgs` `--repo` now come from `git-exec.js`'s `repoTargetOf(...).ghRepo` or a threaded `host`, qualified only for a seam-known GHE host (`originGhHost`). `release-merged.js`'s REST calls pass `cwd: root`. `post-merge.js` and `teardown-run.js` keep `repoSpecOf` for owner/repo but take their host from `originGhHost(root)`, so an SSH alias or unknown host stays bare and one reconcile pass applies one host rule. In `docs/reconcile-checks.md`, say the host is the seam's (`originGhHost`): a known GHE origin's gate reads and writes name `host/owner/repo`, and an SSH-alias, unknown-host or github.com origin keeps the bare slug. Keep the rest of each paragraph.

- [ ] **Step 4: Run the record's acceptance command and the seam scan**

Run: `node --test tests/gh-host-seam-behavior.test.js tests/gh-host-seam-conformance.test.js`
Expected: PASS (spec AC3.1)

- [ ] **Step 5: Commit**

```bash
git add tests/gh-host-seam-behavior.test.js .claude/skills/gh-api-module-pattern/SKILL.md docs/reconcile-checks.md
git commit -m "Pin a whole GHE reconcile pass and retire the raw-host --repo prose (refs #4794)"
```

## Spec coverage

| Spec item | Task |
|---|---|
| Deliverable 1 (host-aware sibling, move reconcile callers and claim-store onto it) | 1, 2, 3, 4, 5 |
| Deliverable 2 (slug comparisons and `repos/…` paths stay consistent; github.com byte-identical) | 2, 3 (Review Focus 3), 4, 5 |
| Deliverable 3 (GHE-origin case per migrated caller in `tests/gh-host-seam-behavior.test.js`) | 2, 3, 4, 5, 6 |
| Decision: Reading B (seam-known hosts only) | 1, 4, 5 |
| Decision: align `post-merge.js` and `teardown-run.js`, SSH-alias test on each | 5 |
| AC1.1 | 2, 3, 4, 5, 6 |
| AC2.1 | 2, 3, 4, 5 (github.com twins) |
| AC3.1 | 6 Step 4 |
| Key File `pr-state.js` | Waived in Task 2, pinned by Task 6's test |
