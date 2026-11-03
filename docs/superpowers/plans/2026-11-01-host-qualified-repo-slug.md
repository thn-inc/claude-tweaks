# Host-qualified origin repo slug Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On a GitHub Enterprise origin, reconcile's and the claim store's `gh` calls reach the origin's host, and stale-claim PR matching recognises that host's PR urls. On a github.com origin, every argv and env stays byte-identical.

**Architecture:** `repo-resolve.js` gains `originGhHost(cwd)` (the seam's `resolveGhHost(cwd)`, or null when `GH_HOST` is exported) and `originPrUrlHost(cwd)` (the host gh's PR urls come back on: an exported non-empty `GH_HOST`, normalized, else `originGhHost`). `git-exec.js` gains `repoTargetOf(repoRoot)`: the bare `slug` (still the value for `repos/…` paths, GraphQL `owner`/`name` pairs and slug comparisons) plus a `ghRepo` value for `--repo`, host-qualified only when `originGhHost` names a host. The residue escalation reached from `archive-merged.js` and `reap-merged.js` moves onto `ghRepo`. `claim-store.js`'s `openPrListArgs` takes a `--repo` host, and its PR-url matcher takes a url host compared through `normalizeHost`. `claim-targets` threads both hosts. `release-merged.js`'s host-flagless REST calls pass `cwd: root`, so the seam reads the root's origin rather than `process.cwd()`. `stale-claim-pr.js` reads its origin through `gateOriginRepo` (#4933) and trusts an explicit host-qualified `--repo`. `post-merge.js` and `teardown-run.js` already take their host from the #4933 gate on main; this plan changes no code there and pins the SSH-alias case on each.

**Tech Stack:** Node 18+ CommonJS under `plugin/bin/`, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-11-03T083002-record-4794/work/4794-spec.md` (record #4794)

**Scope keywords:** repoSlugOf, repoSpecOf, openPrListArgs, isSameRepoPrUrl, staleClaimInFlightPr, tombstoneInFlightPr, matchStaleClaimPr, ghApiDelete

## Global Constraints

- A github.com origin keeps argv and env byte-identical to today on every migrated call (spec AC2). Keep `--repo acme/widgets` bare, add no `--hostname`, and inject no `GH_HOST`.
- **Decision (spec, Reading B, round 1):** an origin-derived host is qualified only when the #4505 seam already treats it as GitHub Enterprise, through `resolveGhHost(cwd)` in `plugin/bin/lib/repo-resolve.js`. Since #4854 that means `*.ghe.com` or a gh `hosts.yml` key (`isKnownGhHost`); an enterprise token alone admits nothing, so the spec's "enterprise token on a non-SSH remote" clause no longer applies. On the `repoSlugOf` paths (residue escalation, claim store, release-merged), github.com, an SSH-alias origin (`git@github-work:acme/widgets.git`) and an unknown host (`ghe.example.com` with no `hosts.yml` key) stay bare, with no `--hostname`.
- **Decision (spec, round 2):** a host-qualified `--repo`, typed by the user or derived from origin, names the host every `gh` call and every PR-url match uses. An explicit host-qualified `--repo` on `stale-claim-pr.js` is trusted for any host, including one the seam does not know. A bare `--repo owner/repo` typed by the user still means github.com. When `GH_HOST` is exported (non-empty) on the origin path, PR-url matching uses that `GH_HOST` value. Every host comparison (PR-url matching, tombstone url checks including the MCP path in `plugin/skills/_shared/issue-claims.md`) goes through `normalizeHost` (case-insensitive, trailing dots ignored).
- **On main since this plan was first written: #4933 and ADR `docs/decisions/0030-unknown-origin-hosts-are-refused-not-degraded.md`.** `repoSpecOf` now routes through `gateOriginRepo`. `post-merge.js` returns the `unknown-host` failure and `teardown-run.js` prints `remote ref: skipped — {refusal}` for an origin host with no positive GitHub signal, an SSH alias included. With `GH_HOST` exported, the gate names the origin host when `GH_HOST` names it and otherwise gives `github.com` (bare, no `--hostname`), so the user's `GH_HOST` decides. This plan does not revert that: an accepted ADR's code is outside one record's remit, and its refusal already stops those two paths sending gh calls to an alias name gh cannot reach (the spec's stated aim for them). **Open for plan review:** the spec's round-1 Decision says SSH-alias and unknown hosts "stay bare" on post-merge and teardown too, and asks for "one reconcile pass applies one host rule". With the refusal kept there and Reading B kept on the `repoSlugOf` paths, a pass on an SSH-alias origin refuses in post-merge/teardown and stays bare in residue escalation and the claim store.
- ADR 0030: "Every new producer that derives a host from origin must call `gateOriginRepo`". `stale-claim-pr.js`'s origin read moves onto the gate (Task 5). `repoTargetOf`/`originGhHost` read the host only through `resolveGhHost`, which names no host without a positive signal, so no unknown host can reach gh through them.
- Every `gh` spawn keeps routing its options through `repo-resolve.js`'s `ghOptions(args, …)`, with the site's `timeout`/`stdio`/`maxBuffer`/`windowsHide` literal inside that options object (`tests/gh-host-seam-conformance.test.js`).
- Governing skill `.claude/skills/gh-api-module-pattern/SKILL.md`, quoted verbatim:
  - "**Every `gh` spawn wraps its options in `plugin/bin/lib/repo-resolve.js`'s `ghOptions(args, …)`.** The seam injects `GH_HOST` for a GitHub Enterprise origin, so a spawn that skips it sends its call to github.com (#4505). Wrap the site's own options object and keep its `timeout`, `stdio`, `maxBuffer` and `windowsHide` literal inside it"
  - "**A `--repo` argument is a *slug*, and the slug is host-qualified — never hand-roll `` `${owner}/${repo}` `` at one.**"
  - "Give each call one owner for its host, and assert the flag count as well as its position."
- Governing skill `.claude/skills/bin-source-scan-conformance/SKILL.md` names `tests/gh-host-seam-conformance.test.js` as the scan these files must keep passing. No new spawn shape is added.
- `.claude/skills/mcp-agent-fetch-node-compute/SKILL.md` covers `stale-claim-pr.js --listing`. `normalizePrListing` is not changed.
- Every in-process test that reads the seam deletes `GH_HOST` and calls `_resetGhHostCache()` before and after the case (`withoutGhHost(t)` in `tests/gh-host-seam-behavior.test.js`). A case whose verdict depends on `hosts.yml` also points `GH_CONFIG_DIR` at a temp dir it controls (or passes `deps.readFile` / `gateDeps.readFile`), so the developer's own `~/.config/gh/hosts.yml` cannot change the verdict. Child-process cases pass the same `GH_CONFIG_DIR` in their env.
- `plugin/skills/_shared/issue-claims.md` is 50800 bytes against the 52500-byte `RAIL_BYTES` rail (`nearCeiling`). Task 5's prose edit replaces text in place and stays byte-neutral or smaller; check `wc -c` after the edit.

## Review Focus

1. **SSH host-alias origin** (`git@github-work:acme/widgets.git`): `repoTargetOf` stays bare (Task 1); post-merge and teardown refuse, with no gh call (Task 6).
2. **`GH_HOST` exported**: `originGhHost` returns null, so no `--repo` names a host and the user's value wins; `originPrUrlHost` returns the normalized `GH_HOST`, so matching follows where gh actually went (Tasks 1, 4, 5).
3. **Host-qualified value leaking into a comparison:** on a GHE origin, archive-merged's record check (`prClosesIssue` against `closingIssuesReferences`, which carry a host-less `owner/repo`) must still see the bare slug (Task 3).
4. **`process.cwd()` outside the repo root:** release-merged's calls follow the root's origin (Task 2).
5. **Cross-host and look-alike PR urls:** under host `acme.ghe.com`, `https://github.com/acme/widgets/pull/1` and `https://acmeXghe.com/acme/widgets/pull/1` are rejected, while `https://ACME.ghe.com./acme/widgets/pull/1` is accepted (Task 4).

---

### Task 1: `originGhHost`, `originPrUrlHost` and `repoTargetOf`

**Role:** integration

**Files:**
- Modify: `plugin/bin/lib/repo-resolve.js` (add `originGhHost`, `originPrUrlHost`, export both)
- Modify: `plugin/bin/lib/hooks/git-exec.js` (add `repoTargetOf`, export it; extend the existing `require('../repo-resolve')`, which now imports `gateOriginRepo`, with `originGhHost` and `repoSlug`)
- Test: `tests/hooks-git-exec.test.js`, `tests/bin-lib/repo-resolve.test.js`

**Interfaces:**
- Produces: `originGhHost(cwd: string, deps?: { env?, remoteUrl?, readFile?, homedir?, platform?, stderr? }) -> string | null`. Returns null when `'GH_HOST' in (deps.env || process.env)`, else `resolveGhHost(cwd, deps)` (already normalized).
- Produces: `originPrUrlHost(cwd, deps?) -> string | null`. An exported `GH_HOST` that is non-empty after `trim()` returns `normalizeHost(GH_HOST)`; an exported empty one returns null (gh then uses github.com); no `GH_HOST` returns `resolveGhHost(cwd, deps)`. Null means github.com.
- Produces: `repoTargetOf(repoRoot: string, deps?: object) -> { owner, repo, slug, host: string | null, ghRepo } | null`. `slug` is exactly `repoSlugOf(repoRoot)`, and the function returns null when that is null. `owner`/`repo` are `slug` split at `/`. `host` is `originGhHost(repoRoot, deps)`. `ghRepo` is `repoSlug({ host, owner, repo })`.

- [ ] **Step 1: Write the failing tests**

In `tests/hooks-git-exec.test.js`, add `test('repoTargetOf: …')` cases. Each makes a temp repo with that origin, deletes `GH_HOST`, resets the seam cache, and passes `deps.readFile` so no real `hosts.yml` is read:
  - `https://acme.ghe.com/acme/widgets.git` → `{ owner: 'acme', repo: 'widgets', slug: 'acme/widgets', host: 'acme.ghe.com', ghRepo: 'acme.ghe.com/acme/widgets' }`
  - `git@acme.ghe.com:acme/widgets.git` and `ssh://git@acme.ghe.com/acme/widgets.git` → the same object
  - `https://ACME.ghe.com./acme/widgets.git` → `host: 'acme.ghe.com', ghRepo: 'acme.ghe.com/acme/widgets'`
  - `https://ghe.example.com/acme/widgets.git` with `deps.readFile` returning `'ghe.example.com:\n    user: x\n'` → `host: 'ghe.example.com'`. With `deps.readFile` throwing → `host: null, ghRepo: 'acme/widgets'`
  - `https://github.com/acme/widgets.git` → `host: null, ghRepo: 'acme/widgets'`
  - `git@github-work:acme/widgets.git` with `deps.readFile` throwing → `host: null, ghRepo: 'acme/widgets'` (Review Focus 1)
  - GHE origin with `deps.env = { GH_HOST: 'mine.example' }` → `host: null, ghRepo: 'acme/widgets'` (Review Focus 2)
  - no origin remote → `null`

In `tests/bin-lib/repo-resolve.test.js`: `originGhHost` returns null under `env: { GH_HOST: '' }` even for a `*.ghe.com` `remoteUrl`, and `'acme.ghe.com'` with `env: {}`. `originPrUrlHost` returns `'mine.example'` under `env: { GH_HOST: ' MINE.example. ' }`, null under `env: { GH_HOST: '' }`, `'acme.ghe.com'` with `env: {}` and a `*.ghe.com` remote, and null with `env: {}` and a github.com remote.

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test tests/hooks-git-exec.test.js tests/bin-lib/repo-resolve.test.js`
Expected: FAIL with `repoTargetOf is not a function` / `originGhHost is not a function`

- [ ] **Step 3: Implement the three functions** with the signatures above. `repo-resolve.js` does not require `git-exec.js`, so the import adds no cycle. Give each a header comment stating the rule: a host is named only when the seam already knows it, so an SSH alias or unknown host stays bare on these paths.

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
- Modify: `plugin/bin/lib/reconcile/release-merged.js` (`ghApi` :171, `ghRunner` :184, `ghApiAsync` :222, and their binding inside `releaseMerged` :348-361, the `writeTombstone` call at :592)
- Test: `tests/gh-host-seam-behavior.test.js`
- Waived `plugin/bin/lib/reconcile/pr-state.js`: every `gh` spawn there already passes `cwd: repoRoot` to `ghOptions`, and `repoSlugOf` feeds only GraphQL `-f owner=`/`-f name=`, which must stay bare. Task 7 pins it with a test and does not change its code.

**Interfaces:**
- Produces: `ghApi(args, cwd?)`, `ghApiAsync(args, cwd?)`, `ghRunner(args, cwd?)`. A given `cwd` goes into the `ghOptions` options object as `cwd`. With no `cwd`, behavior is unchanged. `releaseMerged` binds `root`: `api = ghApiOverride || ((a) => ghApi(a, root))`, `apiAsync = ghApiOverride ? … : ((a) => ghApiAsync(a, root))`, and passes `(a) => ghRunner(a, root)` as `writeTombstone`'s runner. `repoSlug` stays `repoSlugOf(root)`, the bare value.

- [ ] **Step 1: Write the failing tests** in `tests/gh-host-seam-behavior.test.js`. Install a `case`-style PATH stub that logs `GH_HOST` and argv. It answers `api repos/*/git/trees/claims-registry*` with one claim entry, and answers the contents read, the issue-state read (`CLOSED`), the tombstone PUT and the label DELETEs with minimal valid JSON. Model the claim blob on `tests/bin-lib/reconcile/release-merged.test.js`'s issue-closed release fixtures. Call `releaseMerged({ cwd: repo })` in-process, with `process.cwd()` left at this checkout:
  - `test('AC1.1: releaseMerged on a *.ghe.com origin sends every gh call to the origin host, whatever process.cwd() is', …)`: `assertEveryLineReaches(lines, 'acme.ghe.com')`, and the log contains the tree listing, the issue-state read, a `--method PUT` contents write and a `--method DELETE …labels/bot%3Ain-progress` call, so all three runners are reached (Review Focus 4).
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
- Modify: `plugin/bin/lib/reconcile/archive-merged.js` (:2385 and its residue call sites: `trackStuckSkip` :2407, every `finishArchiveAttempt`, `trackArchiveResult` :2525, both `archiveMergedRun({ repoSlug, … })` calls :2719/:2750, `pruneResidueFailures` :2776)
- Modify: `plugin/bin/lib/reconcile/reap-merged.js` (:210 and its `trackReapResidue` calls)
- Test: `tests/gh-host-seam-behavior.test.js`, `tests/bin-lib/reconcile/archive-merged.test.js` (extend `fixtureOrdinaryMergedNoConsole`'s `origin` option to accept a URL string, keeping `true` as today's default)

**Interfaces:**
- Consumes: `repoTargetOf` (Task 1).
- In `archiveMerged`: `const target = repoTargetOf(root); const repoSlug = target ? target.slug : null; const residueRepo = target ? target.ghRepo : null;`. Every residue-tracking argument (`trackStuckSkip`, `finishArchiveAttempt`, `trackArchiveResult`, `archiveMergedRun`'s `repoSlug:` field, `pruneResidueFailures`) gets `residueRepo`. `recordCheck: { records, repoSlug }` and both `byNumberRecordSkip(…, repoSlug)` calls keep the bare `repoSlug`. Inside `archiveMergedRun`, its `repoSlug` parameter feeds only `trackArchiveResult`, so rename it `residueRepo` there.
- In `reapMerged`: `const target = repoTargetOf(root); const residueRepo = target ? target.ghRepo : null;`, passed to every `trackReapResidue`. Drop the `repoSlugOf` import from either file only if nothing else in it uses it.

- [ ] **Step 1: Write the failing tests**
  - In `tests/gh-host-seam-behavior.test.js`, `test('AC1.1: archiveMerged on a *.ghe.com origin escalates structurally-stuck residue with --repo acme.ghe.com/acme/widgets', …)`. Model it on `archive-merged.test.js`'s "two dirs crossing the structurally-stuck threshold" test: seed one stuck dir one short of `RESIDUE_ESCALATE_THRESHOLD`, and inject a recording `runner` that answers `issue list` with `[]` and `issue create` with `https://acme.ghe.com/acme/widgets/issues/101`. Assert at least one call was recorded, and every recorded argv holds `--repo`, `acme.ghe.com/acme/widgets` as adjacent elements, exactly once.
  - The github.com twin, `AC2.1: …`, asserts every argv carries `--repo`, `acme/widgets`.
  - `test('AC1.1: reapMerged on a *.ghe.com origin escalates removal-failed residue with the host-qualified --repo', …)` and its `AC2.1` github.com twin, modelled on `reap-merged.test.js`'s "removal-failed … escalates once at the threshold" test (a locked worktree, `RESIDUE_ESCALATE_THRESHOLD` passes), with `prStates: { byBranch: () => ({ number: 9, state: 'MERGED', mergedAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' }) }` and the recording `runner`.
  - In `tests/bin-lib/reconcile/archive-merged.test.js`, `test('#4794 Review Focus 3: on a *.ghe.com origin a merged run whose PR closes its record still archives (record check compares the bare slug)', …)` using `fixtureOrdinaryMergedNoConsole(…, { origin: 'https://acme.ghe.com/acme/w.git', closes: [<the run's record>] })`, with that helper's existing archived-with-`closes` assertions.

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

### Task 4: claim store and claim-targets on the origin host

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/issues/claim-store.js` (`isSameRepoPrUrl` :677, `tombstoneInFlightPr` :695, `openPrListArgs` :720, `matchStaleClaimPr` :739, `staleClaimInFlightPr` :775)
- Modify: `plugin/bin/lib/claim-targets/claim-targets.js` (the `tombstoneInFlightPr` call at :566 and the `staleClaimInFlightPr` call at :607)
- Modify: `plugin/bin/claim-targets.js` (`realDeps.ghHost`, `realDeps.prUrlHost`)
- Test: `tests/bin-lib/issues/claim-store.test.js`, `tests/bin-lib/claim-targets/claim-targets.test.js`

**Interfaces:**
- Consumes: `originGhHost`, `originPrUrlHost` (Task 1).
- Produces (each host defaults to `null`; `null` or `'github.com'` keeps today's exact behavior):
  - `openPrListArgs(owner, repo, host = null)`: the `--repo` value is `repoSlug({ host, owner, repo })` (import `repoSlug` from `../repo-resolve`). The other argv elements are unchanged.
  - `isSameRepoPrUrl(link, owner, repo, host = null)`: matches `^https://([^/]+)/{owner}/{repo}/pull/\d+$` (owner and repo escaped and exact) and requires `normalizeHost(m[1]) === normalizeHost(host || 'github.com')` (import `normalizeHost` from `../repo-resolve`).
  - `matchStaleClaimPr(runId, prs, owner, repo, host = null)` and `tombstoneInFlightPr(content, gh, owner, repo, host = null)`: thread `host` into `isSameRepoPrUrl`.
  - `staleClaimInFlightPr(content, gh, owner, repo, onError, { repoHost = null, urlHost = repoHost } = {})`: `repoHost` goes to `openPrListArgs`, `urlHost` to `matchStaleClaimPr`.
  - `claim-targets` `run()`: `const repoHost = typeof deps.ghHost === 'function' ? deps.ghHost() : null; const urlHost = typeof deps.prUrlHost === 'function' ? deps.prUrlHost() : repoHost;`. `tombstoneInFlightPr(…, urlHost)`, `staleClaimInFlightPr(…, onError, { repoHost, urlHost })`. `realDeps.ghHost = () => originGhHost(process.cwd())`, `realDeps.prUrlHost = () => originPrUrlHost(process.cwd())`.

- [ ] **Step 1: Write the failing tests**
  - `claim-store.test.js`: `openPrListArgs('acme', 'w', 'acme.ghe.com')` deep-equals today's array with `'acme.ghe.com/acme/w'` at the `--repo` value; `openPrListArgs('acme', 'w')` and `openPrListArgs('acme', 'w', 'github.com')` deep-equal the existing pinned array (AC2.1). `isSameRepoPrUrl('https://acme.ghe.com/acme/w/pull/7', 'acme', 'w', 'acme.ghe.com') === true`, and so is `'https://ACME.ghe.com./acme/w/pull/7'`. Under that host, `'https://github.com/acme/w/pull/7'` and `'https://acmeXghe.com/acme/w/pull/7'` are false (Review Focus 5). The GHE url is false with no host. `staleClaimInFlightPr` with `{ repoHost: null, urlHost: 'mine.example' }` lists with `--repo acme/w` and matches a marked `https://mine.example/acme/w/pull/3` (Review Focus 2).
  - `claim-targets.test.js`: a stale claim with `deps.ghHost = () => 'acme.ghe.com'`, whose `gh pr list` answer holds a marked same-repo `https://acme.ghe.com/acme/w/pull/12`, is skipped as in-flight, and the recorded `pr list` argv carries `--repo`, `acme.ghe.com/acme/w`. A `pr-opened:` tombstone linking `https://acme.ghe.com/acme/w/pull/12` under the same `ghHost` reaches `gh pr view` and stops as in-flight when it answers `OPEN`. With `deps.ghHost = () => null` and `deps.prUrlHost = () => 'mine.example'`, the listing argv carries `--repo`, `acme/w` and a marked `https://mine.example/acme/w/pull/12` is in-flight.

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test tests/bin-lib/issues/claim-store.test.js tests/bin-lib/claim-targets/claim-targets.test.js`
Expected: FAIL after Step 1 on every new GHE and `mine.example` assertion. The AC2.1 argv pins pass before and after.

- [ ] **Step 3: Implement** the signatures and wiring from the Interfaces block. Update `tombstoneInFlightPr`'s doc comment: the link is validated as a well-formed `https://{host}/{owner}/{repo}/pull/{number}` url for the same owner/repo, its host compared normalized against the run's PR-url host (github.com by default).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/bin-lib/issues/claim-store.test.js tests/bin-lib/claim-targets/claim-targets.test.js tests/issue-claims-stale-open-pr-conformance.test.js tests/tidy-stale-claim-open-pr-conformance.test.js tests/gh-host-seam-conformance.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/issues/claim-store.js plugin/bin/lib/claim-targets/claim-targets.js plugin/bin/claim-targets.js tests/bin-lib/issues/claim-store.test.js tests/bin-lib/claim-targets/claim-targets.test.js
git commit -m "Send claim-store PR listing and in-flight matching to the origin host (refs #4794)"
```

### Task 5: stale-claim-pr.js on the gate, explicit host trusted, MCP prose

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/stale-claim-pr.js` (`run()` :178-194, the header paragraph at :49-53, `realDeps` gains `gateDeps: undefined`)
- Modify: `plugin/skills/_shared/issue-claims.md` (the two `https://github.com/{owner}/{repo}/pull/{number}` sentences, :187 and :525)
- Test: `tests/stale-claim-pr-cli.test.js` (rework the test pinning `stale-claim matching supports github.com only`), `tests/gh-host-seam-behavior.test.js`, `tests/gh-host-seam-conformance.test.js`

**Interfaces:**
- Consumes: `openPrListArgs(owner, repo, host)`, `matchStaleClaimPr(…, host)` (Task 4); `gateOriginRepo`, `normalizeHost` from `./lib/repo-resolve`.
- `run()` resolves `{ owner, repo, repoHost, urlHost }`:
  - Explicit `--repo` with three or more `/`-parts: `parseRepo` it; `repoHost = urlHost = normalizeHost(host)`, any host (round 2).
  - Explicit bare `--repo owner/name`: github.com, as today (`repoHost = urlHost = null`).
  - No `--repo`: `const gated = gateOriginRepo(remote, deps.gateDeps)`. `gated.refusal` → write `stale-claim-pr.js: {refusal}\n` to stderr and print the failure verdict `stale-claim matching supports github.com and known GitHub Enterprise hosts only` on stdout, exit 0, with no claim read and no `gh` call. `gated.spec === null` → today's exit-3 "could not resolve owner/repo". Otherwise `repoHost = gated.spec.host`, and `urlHost` is the normalized exported `GH_HOST` (read from `(deps.gateDeps && deps.gateDeps.env) || process.env`, non-empty after `trim()`) or else `repoHost`.
  - `repoHost` goes to `openPrListArgs`, `urlHost` to `matchStaleClaimPr`.
- Header paragraph: an explicit host-qualified `--repo` is trusted; an origin goes through `gateOriginRepo` (#4933), so only github.com, a known GitHub Enterprise host, or a `GH_HOST` opt-in is matched, and anything else is the failure verdict; PR urls are compared on the host gh answered from (`GH_HOST` when exported).
- `tests/gh-host-seam-conformance.test.js`: remove `stale-claim-pr.js` from `NOT_ORIGIN`, add it to `ORIGIN_GATED`, and lower the AC9.2 floor from 8 to 7 with a comment naming #4794 as a deliberate move onto the gate (the #4951 precedent in the same comment).
- `issue-claims.md`: both sentences read `https://{host}/{owner}/{repo}/pull/{number}`, where `{host}` is the origin's known GitHub host (github.com by default, `GH_HOST` when exported), compared case-insensitively with trailing dots ignored. Trim words elsewhere in the same two paragraphs so the file does not grow.

- [ ] **Step 1: Write the failing tests**
  - `stale-claim-pr-cli.test.js`: rework the GHES-refusal test. `--repo ghe.example.com/acme/w` with a marked `https://ghe.example.com/acme/w/pull/7` listing → `{ match: true, link: 'https://ghe.example.com/acme/w/pull/7', failure: null }`. A `*.ghe.com` origin (`gateDeps: { env: {} }`) matches `https://acme.ghe.com/acme/w/pull/7`, and on the gh path its `deps.calls.gh` holds `--repo acme.ghe.com/acme/w`. A `ghe.example.com` origin with `gateDeps: { env: {}, readFile: () => 'ghe.example.com:\n' }` matches the same way. A `ghe.example.com` origin with `gateDeps: { env: {}, readFile: () => { throw new Error('ENOENT'); } }` prints the failure verdict with the new wording, writes the refusal to stderr, and makes no read and no `gh` call. A `*.ghe.com` origin with `gateDeps: { env: { GH_HOST: 'mine.example' } }` lists with a bare `--repo acme/w` and matches `https://mine.example/acme/w/pull/7`.
  - `gh-host-seam-behavior.test.js`: `test('AC1.1: stale-claim-pr.js on a *.ghe.com origin lists open PRs on the origin host and matches its marked PR', …)`, running the CLI as a child (`node(repo, …)`) in a GHE temp repo with the fake gh answering `pr list` with a marked `https://acme.ghe.com/acme/widgets/pull/12` entry: `assertEveryLineReaches(lines, 'acme.ghe.com')` and stdout `match: true`. `test('AC2.1: stale-claim-pr.js on a github.com origin keeps today\'s pr list argv', …)`: the network line equals `GH_HOST=unset ARGS=pr list --repo acme/widgets --state open --json url,body,isCrossRepository --limit 1000`.

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test tests/stale-claim-pr-cli.test.js tests/gh-host-seam-behavior.test.js`
Expected: FAIL after Step 1 on every new GHE, `ghe.example.com` and `mine.example` assertion. The AC2.1 argv pin passes before and after.

- [ ] **Step 3: Implement** `run()`, the header paragraph, the conformance roster change and the `issue-claims.md` edit. Then `wc -c plugin/skills/_shared/issue-claims.md` must print at most 50800.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/stale-claim-pr-cli.test.js tests/gh-host-seam-behavior.test.js tests/gh-host-seam-conformance.test.js tests/issue-claims-stale-open-pr-conformance.test.js tests/tidy-stale-claim-open-pr-conformance.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/stale-claim-pr.js plugin/skills/_shared/issue-claims.md tests/stale-claim-pr-cli.test.js tests/gh-host-seam-behavior.test.js tests/gh-host-seam-conformance.test.js
git commit -m "Gate stale-claim-pr's origin and trust an explicit host-qualified --repo (refs #4794)"
```

### Task 6: pin the SSH-alias origin on post-merge and teardown-run

**Role:** integration

**Files:**
- Test: `tests/bin-lib/reconcile/post-merge.test.js`, `tests/hooks-teardown-run.test.js`, `tests/gh-host-seam-behavior.test.js`
- No code change in `plugin/bin/lib/reconcile/post-merge.js` or `plugin/bin/lib/hooks/teardown-run.js`: both take their host from `repoSpecOf` → `gateOriginRepo` on main (#4933). See Global Constraints for the open plan-review question.

**Interfaces:**
- Consumes: main's `repoSpecOf(repoRoot, gateDeps)` and `setupContext`'s `deps.gateDeps`.

- [ ] **Step 1: Write the tests** (each sets `GH_CONFIG_DIR` to a temp dir it controls, or passes `gateDeps`, and deletes `GH_HOST` for its duration):
  - `post-merge.test.js`: `test('#4794: an SSH-alias origin refuses Step 4.0b — failure unknown-host, no gh call', …)` with origin `git@github-work:acme/w.git`, modelled on `AC8.2 post-merge setupContext (#4933)`: `failure: 'unknown-host'`, `detail` names `github-work` and `GH_HOST=github-work`, and the recording runner saw no call.
  - `hooks-teardown-run.test.js`: `test('#4794: teardown-run on an SSH-alias origin issues no gh DELETE and skips with the refusal', …)`, modelled on `AC8.1 teardown (#4933)`, origin `git@github-work:acme/widgets.git`.
  - `gh-host-seam-behavior.test.js`: `test('AC1.1: teardown-run on a *.ghe.com origin sends its remote-ref delete to the origin host', …)`, using the real `defaultGhApiDelete` with the fake gh on PATH and a run fixture after `hooks-teardown-run.test.js`'s AC16 shape (run-state `pr.branch` set, no worktree recorded). The one network line reaches `acme.ghe.com` (`reachesHost` already accepts `--hostname`) and carries `--hostname acme.ghe.com` exactly once.

- [ ] **Step 2: Run them**

Run: `node --test tests/bin-lib/reconcile/post-merge.test.js tests/hooks-teardown-run.test.js tests/gh-host-seam-behavior.test.js`
Expected: PASS (they pin main's behavior). Prove each can go red: temporarily make `gateOriginRepo` return `{ spec: { ...parsed, host }, refusal: null }` for every host, see the two SSH-alias cases fail, then restore.

- [ ] **Step 3: Commit**

```bash
git add tests/bin-lib/reconcile/post-merge.test.js tests/hooks-teardown-run.test.js tests/gh-host-seam-behavior.test.js
git commit -m "Pin the SSH-alias origin on post-merge and teardown-run (refs #4794)"
```

### Task 7: a whole reconcile pass on a GHE origin, the pr-state pin, and the stale prose

**Role:** integration

**Files:**
- Test: `tests/gh-host-seam-behavior.test.js`
- Modify: `.claude/skills/gh-api-module-pattern/SKILL.md` (the paragraph saying a bare slug passed as `--repo` — `escalate-residue.js`'s calls, `claim-store.js`'s `openPrListArgs` — is github.com-only by inheritance)
- Modify: `docs/reconcile-checks.md` (the residue-escalation `--repo` sentence, if it names the bare slug)

**Interfaces:**
- Consumes: Tasks 1-5.

- [ ] **Step 1: Write the tests**
  - `test('AC1.1: a whole reconcile pass (hooks.js reconcile) on a *.ghe.com origin sends every gh call to the origin host', …)`: a GHE temp repo with `CLAUDE.md` `work-backend: github-issues`, and a fake gh on PATH (a `case` stub answering the claims tree listing with `{"truncated":false,"entries":[]}` and anything else with `[]`). Run `node plugin/bin/hooks.js reconcile` as a child with `cwd: repo` and `childEnv()` plus `GIT_TERMINAL_PROMPT=0`. The pass may `git fetch` the `https://acme.ghe.com/…` origin, and that fetch must fail fast rather than prompt. If a network `git` call still makes the case slow or flaky, stop and report it rather than loosening the assertion. Assert `assertEveryLineReaches(lines, 'acme.ghe.com')`, whose `net.length >= 1` floor proves at least release-merged's tree listing ran.
  - `test('AC1.1: pr-state\'s bulk PR screen on a *.ghe.com origin reaches the origin host with a bare owner/name pair', …)`: `resolvePrStatesBulk(repo, ['feature'])` in-process with the fake gh. The logged line starts `GH_HOST=acme.ghe.com ` and carries `-f owner=acme -f name=widgets`.

- [ ] **Step 2: Run them**

Run: `node --test tests/gh-host-seam-behavior.test.js`
Expected: PASS (Tasks 1-5 landed). Prove the reconcile case can go red: temporarily revert Task 2's `root` binding and run the pass in-process from this checkout's cwd, then restore.

- [ ] **Step 3: Update the prose.** In the skill: the residue-escalation and `openPrListArgs` `--repo` now come from `git-exec.js`'s `repoTargetOf(...).ghRepo` or a threaded host, qualified only for a seam-known GHE host (`originGhHost`); PR-url matching uses `originPrUrlHost`; `release-merged.js`'s REST calls pass `cwd: root`. In `docs/reconcile-checks.md`, if it states the residue `--repo` is the bare slug, say it is host-qualified for a known GHE origin and bare otherwise. Keep the rest of each paragraph.

- [ ] **Step 4: Run the record's acceptance command and the seam scan**

Run: `node --test tests/gh-host-seam-behavior.test.js tests/gh-host-seam-conformance.test.js`
Expected: PASS (spec AC3.1)

- [ ] **Step 5: Commit**

```bash
git add tests/gh-host-seam-behavior.test.js .claude/skills/gh-api-module-pattern/SKILL.md docs/reconcile-checks.md
git commit -m "Pin a whole GHE reconcile pass and retire the bare-slug --repo prose (refs #4794)"
```

## Spec coverage

| Spec item | Task |
|---|---|
| Deliverable 1 (host-aware sibling, move reconcile callers and claim-store onto it) | 1, 2, 3, 4, 5 |
| Deliverable 2 (slug comparisons and `repos/…` paths stay consistent; github.com byte-identical) | 2, 3 (Review Focus 3), 4, 5 |
| Deliverable 3 (GHE-origin case per migrated caller in `tests/gh-host-seam-behavior.test.js`) | 2, 3, 5, 6, 7 |
| Decision round 1: Reading B (seam-known hosts only) | 1, 4, 5 |
| Decision round 1: align post-merge/teardown, SSH-alias test on each | 6 (pins #4933's refusal; open plan-review question in Global Constraints) |
| Decision round 2: explicit host-qualified `--repo` trusted; `GH_HOST` value for PR-url matching; normalized host comparisons incl. the MCP prose | 1, 4, 5 |
| AC1.1 | 2, 3, 5, 6, 7 |
| AC2.1 | 2, 3, 4, 5 (github.com twins) |
| AC3.1 | 7 Step 4 |
| Key File `pr-state.js` | Waived in Task 2, pinned by Task 7's test |
| Key File `plugin/bin/lib/reconcile/post-merge.js` | No code change (#4933 on main); pinned by Task 6 |
