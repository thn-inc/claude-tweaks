# Host-qualified origin repo slug Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every origin-derived repo that reconcile, the claim store and `stale-claim-pr.js` hand to `gh` goes through #4933's origin-host gate (`gateOriginRepo`, ADR 0030). On a GitHub Enterprise origin those `gh` calls reach the origin's host and PR-url matching recognises that host's PR urls. An SSH-alias or unknown origin host is refused with no `gh` call. On a github.com origin, every argv and env stays byte-identical.

**Architecture:** `git-exec.js` gains `repoTargetOf(repoRoot, gateDeps)`, built on the already-gated `repoSpecOf`: `null` (no or unparseable origin), `{ refusal }` (ADR 0030 refusal), or `{ owner, repo, slug, host, ghRepo }`. `slug` is the bare `owner/repo` (still the value for `repos/…` paths, GraphQL `owner`/`name` pairs and slug comparisons). `ghRepo` is the `--repo` value, host-qualified only when the gate names a host other than github.com. `originSlugOf(repoRoot, gateDeps)` is the gated bare slug or null, and replaces `repoSlugOf`, which is retired once no caller remains. `repo-resolve.js` gains `prUrlHost(repoHost, deps)`: the host gh's PR urls come back on (a non-empty exported `GH_HOST`, normalized, else `repoHost`). release-merged, archive-merged, reap-merged, pr-state and sibling-sessions move onto the gated helpers; release-merged's host-flagless REST calls also pass `cwd: root`. `claim-store.js`'s `openPrListArgs` takes a `--repo` host and its PR-url matcher a url host. `stale-claim-pr.js` reads its origin through `gateOriginRepo` and trusts an explicit host-qualified `--repo`. The agent-composed `stale-claim-pr.js` calls in the tidy and MCP prose drop `--repo` and fall back to a host-qualified one only when the CLI cannot read origin. post-merge and teardown already refuse through the gate on main; this plan pins the SSH-alias case there.

**Tech Stack:** Node 18+ CommonJS under `plugin/bin/`, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-11-03T163447-record-4794/work/4794-spec.md` (record #4794)

**Scope keywords:** repoSlugOf, repoSpecOf, openPrListArgs, isSameRepoPrUrl, staleClaimInFlightPr, tombstoneInFlightPr, matchStaleClaimPr, ghApiDelete

## Global Constraints

- A github.com origin keeps argv and env byte-identical to today on every migrated call (spec AC2). Keep `--repo acme/widgets` bare, add no `--hostname`, and inject no `GH_HOST`.
- **One host rule (spec Decision round 3, Q1, Reading B — ADR 0030 wins).** Every origin-derived repo this plan touches goes through `gateOriginRepo` (`plugin/bin/lib/repo-resolve.js`), reached through `repoSpecOf`/`repoTargetOf`/`originSlugOf` in `plugin/bin/lib/hooks/git-exec.js`. The gate passes github.com, a `*.ghe.com` host, a gh `hosts.yml` key, or anything when a non-empty `GH_HOST` is exported (origin host when `GH_HOST` names it, else github.com, bare). Everything else, an SSH alias (`git@github-work:acme/widgets.git`) included, is a refusal, and a refused path makes **no** `gh` call. Do not revert or weaken #4933's gate, and do not add a bare-slug fallback for a refused host (ADR 0030's rejected alternative).
- **Refusal handling per path:** release-merged returns `{ failure: 'unknown-host', detail: <refusal> }` before any gh call, and reconcile's release skip carries the `detail` the way post-merge's does. archive-merged and reap-merged treat a refusal as no slug: the record check and residue escalation already fail closed on a null slug (`no-repo-slug`, no gh call). pr-state and sibling-sessions treat it as no slug too (pr-state's bulk screen spawns nothing; the claim reader's contents-API leg is `repo-slug-unresolved`). stale-claim-pr.js prints its failure verdict. claim-targets resolves its slug through `gh repo view` and only takes its `--repo` host from the gate, so a refusal there means no host (bare), and gh's own repo resolution has already answered for that repo.
- A remote the gate cannot parse (`ssh://…`) keeps `repoSpecOf`'s #4857 fallback (host unknown, bare). #4857 owns that case; this plan pins today's behavior and does not change it.
- **Explicit `--repo` (spec Decision round 2):** a user-typed host-qualified `--repo` on `stale-claim-pr.js` is trusted for any host and is not gated (ADR 0030: "A user-typed `--repo` is not gated"). A bare `--repo owner/repo` typed by a user still means github.com. No agent-composed call relies on that default (spec round 3, Q2).
- When `GH_HOST` is exported non-empty, PR-url matching uses that host (`prUrlHost`). An exported but empty `GH_HOST` is treated as unset on every path (spec minor ruling; the gate already does this). Every host comparison goes through `normalizeHost` (case-insensitive, trailing dots ignored).
- ADR 0030: "Every new producer that derives a host from origin must call `gateOriginRepo`". `stale-claim-pr.js` moves onto the gate (Task 7), and `tests/gh-host-seam-conformance.test.js`'s rosters move with it.
- Every `gh` spawn keeps routing its options through `repo-resolve.js`'s `ghOptions(args, …)`, with the site's `timeout`/`stdio`/`maxBuffer`/`windowsHide` literal inside that options object (`tests/gh-host-seam-conformance.test.js`).
- Governing skill `.claude/skills/gh-api-module-pattern/SKILL.md`, quoted verbatim:
  - "**Every `gh` spawn wraps its options in `plugin/bin/lib/repo-resolve.js`'s `ghOptions(args, …)`.** The seam injects `GH_HOST` for a GitHub Enterprise origin, so a spawn that skips it sends its call to github.com (#4505). Wrap the site's own options object and keep its `timeout`, `stdio`, `maxBuffer` and `windowsHide` literal inside it"
  - "**A `--repo` argument is a *slug*, and the slug is host-qualified — never hand-roll `` `${owner}/${repo}` `` at one.**"
  - "Give each call one owner for its host, and assert the flag count as well as its position."
- Governing skill `.claude/skills/bin-source-scan-conformance/SKILL.md` names `tests/gh-host-seam-conformance.test.js` as the scan these files must keep passing. No new spawn shape is added.
- `.claude/skills/mcp-agent-fetch-node-compute/SKILL.md` covers `stale-claim-pr.js --listing`. `normalizePrListing` is not changed.
- Every in-process test that reads the gate or the seam deletes `GH_HOST`, calls `_resetGhHostCache()` before and after the case (`withoutGhHost(t)` in `tests/gh-host-seam-behavior.test.js`), and passes `gateDeps: { env: {}, readFile }` (or points `GH_CONFIG_DIR` at a temp dir it controls) so the developer's own `~/.config/gh/hosts.yml` cannot change the verdict. Child-process cases pass the same `GH_CONFIG_DIR` in their env.
- Rail (`RAIL_BYTES` 52500): `plugin/skills/tidy/scan-procedures.md` is 52447 bytes and `plugin/skills/_shared/issue-claims.md` is 50800 bytes (`nearCeiling`). Task 8's prose edits keep each file at or below those sizes; check `wc -c` after the edit and trim words in the same paragraphs, never elsewhere.

## Review Focus

1. **SSH host-alias origin** (`git@github-work:acme/widgets.git`): `repoTargetOf` returns the refusal (Task 1); release-merged, archive/reap residue escalation, pr-state's bulk screen, stale-claim-pr.js, post-merge and teardown make no gh call (Tasks 2, 3, 4, 7, 9).
2. **`GH_HOST` exported**: a non-empty value decides the host through the gate (origin host when it names it, else bare); `prUrlHost` returns the normalized `GH_HOST`, so matching follows where gh actually went; an empty value is no opt-in (Tasks 1, 6, 7).
3. **Host-qualified value leaking into a comparison or path:** on a GHE origin, archive-merged's record check (`prClosesIssue` against `closingIssuesReferences`, which carry a host-less `owner/repo`), release-merged's `repos/…` paths and pr-state's GraphQL `owner`/`name` must still see the bare slug (Tasks 2, 3, 4).
4. **`process.cwd()` outside the repo root:** release-merged's calls follow the root's origin (Task 2).
5. **Cross-host and look-alike PR urls:** under host `acme.ghe.com`, `https://github.com/acme/widgets/pull/1` and `https://acmeXghe.com/acme/widgets/pull/1` are rejected, while `https://ACME.ghe.com./acme/widgets/pull/1` is accepted (Task 6).
6. **`repoSlugOf` retirement:** no `plugin/bin` file names it afterwards, and no test or skill prose describes it as live (Tasks 5, 10).

---

### Task 1: `repoTargetOf`, `originSlugOf` and `prUrlHost`

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/hooks/git-exec.js` (add `repoTargetOf`, `originSlugOf`, export both; extend the existing `require('../repo-resolve')` with `normalizeHost` and `repoSlug`)
- Modify: `plugin/bin/lib/repo-resolve.js` (add `prUrlHost`, export it)
- Test: `tests/hooks-git-exec.test.js`, `tests/bin-lib/repo-resolve.test.js`

**Interfaces:**
- Produces: `repoTargetOf(repoRoot: string, gateDeps?: { env?, readFile?, … }) -> { owner, repo, slug, host: string | null, ghRepo } | { refusal: string } | null`. Calls `repoSpecOf(repoRoot, gateDeps)`. `null` → `null`; `{ refusal }` → `{ refusal }` (same text). Otherwise `slug = \`${owner}/${repo}\``, `host` is `normalizeHost(spec.host)` unless `spec.host` is null or normalizes to `github.com` (then `null`), and `ghRepo = repoSlug({ host, owner, repo })`.
- Produces: `originSlugOf(repoRoot, gateDeps?) -> string | null`: `repoTargetOf`'s `slug`, or null for `null` and for a refusal.
- Produces: `prUrlHost(repoHost: string | null, deps?: { env? }) -> string | null`. A `GH_HOST` in `(deps.env || process.env)` that is non-empty after `trim()` returns `normalizeHost(GH_HOST)`; otherwise `repoHost ? normalizeHost(repoHost) : null`. Null means github.com.

- [ ] **Step 1: Write the failing tests**

In `tests/hooks-git-exec.test.js`, add `test('repoTargetOf: …')` cases. Each makes a temp repo with that origin and passes `gateDeps` (`env: {}` unless stated, and a `readFile` that throws unless stated) so neither the real environment nor a real `hosts.yml` is read:
  - `https://acme.ghe.com/acme/widgets.git` → `{ owner: 'acme', repo: 'widgets', slug: 'acme/widgets', host: 'acme.ghe.com', ghRepo: 'acme.ghe.com/acme/widgets' }`
  - `git@acme.ghe.com:acme/widgets.git` → the same object
  - `https://ACME.ghe.com./acme/widgets.git` → `host: 'acme.ghe.com', ghRepo: 'acme.ghe.com/acme/widgets'`
  - `https://ghe.example.com/acme/widgets.git` with `readFile` returning `'ghe.example.com:\n    user: x\n'` → `host: 'ghe.example.com'`. With `readFile` throwing → `{ refusal }`, the text naming `ghe.example.com` and `export GH_HOST=ghe.example.com`
  - `https://github.com/acme/widgets.git` and `git@github.com:acme/widgets.git` → `host: null, ghRepo: 'acme/widgets'`, and `slug` equals what `repoSlugOf` returns for the same repo (AC2: the bare slug is unchanged)
  - `git@github-work:acme/widgets.git` → `{ refusal }` naming `github-work` (Review Focus 1)
  - GHE origin with `env: { GH_HOST: 'mine.example' }` → `host: null, ghRepo: 'acme/widgets'`; with `env: { GH_HOST: 'ACME.ghe.com' }` → `host: 'acme.ghe.com'` (Review Focus 2)
  - unknown origin `https://ghe.example.com/acme/widgets.git` with `env: { GH_HOST: '  ' }` → `{ refusal }` (an empty `GH_HOST` is no opt-in)
  - `ssh://git@acme.ghe.com/acme/widgets.git` → `{ owner: 'acme', repo: 'widgets', slug: 'acme/widgets', host: null, ghRepo: 'acme/widgets' }` (#4857's fallback, pinned unchanged)
  - no origin remote → `null`
  - `originSlugOf`: `'acme/widgets'` for the github.com and GHE origins, `null` for the SSH alias and for no origin.

In `tests/bin-lib/repo-resolve.test.js`: `prUrlHost(null, { env: { GH_HOST: ' MINE.example. ' } }) === 'mine.example'`; `prUrlHost('acme.ghe.com', { env: { GH_HOST: '' } }) === 'acme.ghe.com'`; `prUrlHost('ACME.ghe.com.', { env: {} }) === 'acme.ghe.com'`; `prUrlHost(null, { env: {} }) === null`.

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test tests/hooks-git-exec.test.js tests/bin-lib/repo-resolve.test.js`
Expected: FAIL with `repoTargetOf is not a function` / `prUrlHost is not a function`

- [ ] **Step 3: Implement the three functions** with the signatures above. `repo-resolve.js` does not require `git-exec.js`, so the import adds no cycle. Give `repoTargetOf` a header comment stating the rule: the host comes only from the #4933 gate, so an SSH alias or unknown host is a refusal, never a bare slug.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/hooks-git-exec.test.js tests/bin-lib/repo-resolve.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/hooks/git-exec.js plugin/bin/lib/repo-resolve.js tests/hooks-git-exec.test.js tests/bin-lib/repo-resolve.test.js
git commit -m "Add gated repoTargetOf and originSlugOf, and prUrlHost (refs #4794)"
```

### Task 2: release-merged on the gate and the repo root's host

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/reconcile/release-merged.js` (`ghApi` :171, `ghRunner` :184, `ghApiAsync` :222, `releaseMerged` :348-361 and its `writeTombstone` call at :592)
- Modify: `plugin/bin/lib/reconcile/index.js` (the release skip at :536-537)
- Test: `tests/gh-host-seam-behavior.test.js`, `tests/bin-lib/reconcile/release-merged.test.js`, `tests/reconcile.test.js`

**Interfaces:**
- Consumes: `repoTargetOf` (Task 1).
- `releaseMerged({ cwd, ghApi, prStates, gateDeps } = {})`: `const target = repoTargetOf(root, gateDeps);` `null` → today's `failure: 'no-remote'`; `target.refusal` → `{ released, skipped, failure: 'unknown-host', detail: target.refusal }`, before any gh call; else `const repoSlug = target.slug;` (the bare value, unchanged for `repos/…` paths).
- `ghApi(args, cwd?)`, `ghApiAsync(args, cwd?)`, `ghRunner(args, cwd?)`: a given `cwd` goes into the `ghOptions` options object as `cwd`; with none, behavior is unchanged. `releaseMerged` binds `root`: `api = ghApiOverride || ((a) => ghApi(a, root))`, `apiAsync = ghApiOverride ? … : ((a) => ghApiAsync(a, root))`, and passes `(a) => ghRunner(a, root)` as `writeTombstone`'s runner.
- `index.js`: `result.skipped.push({ check: 'release', reason: r.failure, ...(r.detail ? { detail: r.detail } : {}) })`, matching the post-merge line.

- [ ] **Step 1: Write the failing tests**
  - In `tests/gh-host-seam-behavior.test.js`, install a `case`-style PATH stub that logs `GH_HOST` and argv. It answers `api repos/*/git/trees/claims-registry*` with one claim entry, and answers the contents read, the issue-state read (`CLOSED`), the tombstone PUT and the label DELETEs with minimal valid JSON. Model the claim blob on `tests/bin-lib/reconcile/release-merged.test.js`'s issue-closed release fixtures. Call `releaseMerged({ cwd: repo, gateDeps: { env: {}, readFile: () => { throw new Error('ENOENT'); } } })` in-process, with `process.cwd()` left at this checkout:
    - `test('AC1.1: releaseMerged on a *.ghe.com origin sends every gh call to the origin host, whatever process.cwd() is', …)`: `assertEveryLineReaches(lines, 'acme.ghe.com')`, and the log contains the tree listing, the issue-state read, a `--method PUT` contents write and a `--method DELETE …labels/bot%3Ain-progress` call, so all three runners are reached (Review Focus 4).
    - `test('AC2.1: releaseMerged on a github.com origin leaves GH_HOST unset and argv unchanged', …)`: every network line starts `GH_HOST=unset `, and the tree-listing argv equals `api repos/acme/widgets/git/trees/claims-registry?recursive=1 -q {…}` exactly, with the `-q` text copied from `claim-store.js`'s `listClaimEntries`.
  - In `tests/bin-lib/reconcile/release-merged.test.js`: `test('#4794: an SSH-alias origin refuses before any gh call — failure unknown-host, detail names github-work', …)` with origin `git@github-work:acme/w.git`, a recording `ghApi` override and the throwing `readFile`: the result is `{ failure: 'unknown-host' }` with `detail` matching `/github-work/`, and the override saw zero calls.
  - In `tests/reconcile.test.js`, beside the #4933 post-merge detail test: `test('#4794: a release unknown-host failure carries its refusal detail into skipped and the summary line', …)`, using `reconcileWithAsyncMerge(['release'], { afterStubs })` where `afterStubs` replaces `releaseMerged` with one returning `{ released: [], skipped: [], failure: 'unknown-host', detail }`. Assert the `release` skipped entry deep-equals `{ check: 'release', reason: 'unknown-host', detail }` and the summary line reads `skipped: release — unknown-host (${detail})`.

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test tests/gh-host-seam-behavior.test.js tests/bin-lib/reconcile/release-merged.test.js tests/reconcile.test.js`
Expected: FAIL. The GHE case logs `GH_HOST=unset` (the seam read `process.cwd()`, whose origin is github.com), the SSH-alias case reaches the override, and the reconcile case drops `detail`.

- [ ] **Step 3: Implement** the gate read, the `cwd` parameters, the `releaseMerged` bindings and the `index.js` line from the Interfaces block.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/gh-host-seam-behavior.test.js tests/bin-lib/reconcile/release-merged.test.js tests/reconcile.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/reconcile/release-merged.js plugin/bin/lib/reconcile/index.js tests/gh-host-seam-behavior.test.js tests/bin-lib/reconcile/release-merged.test.js tests/reconcile.test.js
git commit -m "Gate release-merged's origin and bind its gh calls to the repo root's host (refs #4794)"
```

### Task 3: residue escalation `--repo` carries the gated origin host

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/reconcile/archive-merged.js` (:2385 and its residue call sites: `trackStuckSkip` :2407, every `finishArchiveAttempt`, `trackArchiveResult` :2525, both `archiveMergedRun({ repoSlug, … })` calls :2719/:2750, `pruneResidueFailures` :2776)
- Modify: `plugin/bin/lib/reconcile/reap-merged.js` (:210 and its `trackReapResidue` calls)
- Test: `tests/gh-host-seam-behavior.test.js`, `tests/bin-lib/reconcile/archive-merged.test.js` (extend `fixtureOrdinaryMergedNoConsole`'s `origin` option to accept a URL string, keeping `true` as today's default), `tests/bin-lib/reconcile/reap-merged.test.js`

**Interfaces:**
- Consumes: `repoTargetOf` (Task 1), imported from `../hooks/git-exec`.
- In `archiveMerged`: `const target = repoTargetOf(root, gateDeps); const ok = target && !target.refusal; const repoSlug = ok ? target.slug : null; const residueRepo = ok ? target.ghRepo : null;` (`gateDeps` is a new optional `archiveMerged` option, undefined in production). Every residue-tracking argument (`trackStuckSkip`, `finishArchiveAttempt`, `trackArchiveResult`, `archiveMergedRun`'s `repoSlug:` field, `pruneResidueFailures`) gets `residueRepo`. `recordCheck: { records, repoSlug }` and both `byNumberRecordSkip(…, repoSlug)` calls keep the bare `repoSlug`. Inside `archiveMergedRun`, its `repoSlug` parameter feeds only `trackArchiveResult`, so rename it `residueRepo` there.
- In `reapMerged`: the same `target`/`ok` derivation (new optional `gateDeps` option), `const residueRepo = ok ? target.ghRepo : null;`, passed to every `trackReapResidue`.
- A refusal leaves both values null, so the record check skips with `no-repo-slug` and escalation returns `escalation-failed: no-repo-slug`, both with no gh call (Global Constraints).
- Drop the `repoSlugOf` import from either file.

- [ ] **Step 1: Write the failing tests**
  - In `tests/gh-host-seam-behavior.test.js`, `test('AC1.1: archiveMerged on a *.ghe.com origin escalates structurally-stuck residue with --repo acme.ghe.com/acme/widgets', …)`. Model it on `archive-merged.test.js`'s "two dirs crossing the structurally-stuck threshold" test: seed one stuck dir one short of `RESIDUE_ESCALATE_THRESHOLD`, pass `gateDeps: { env: {}, readFile: () => { throw new Error('ENOENT'); } }`, and inject a recording `runner` that answers `issue list` with `[]` and `issue create` with `https://acme.ghe.com/acme/widgets/issues/101`. Assert at least one call was recorded, and every recorded argv holds `--repo`, `acme.ghe.com/acme/widgets` as adjacent elements, exactly once.
  - Its github.com twin, `AC2.1: …`, asserts every argv carries `--repo`, `acme/widgets`.
  - Its SSH-alias twin, `test('#4794: archiveMerged on an SSH-alias origin escalates nothing — the runner sees no call', …)`, origin `git@github-work:acme/widgets.git`: the recording runner saw zero calls (Review Focus 1).
  - `test('AC1.1: reapMerged on a *.ghe.com origin escalates removal-failed residue with the host-qualified --repo', …)`, its `AC2.1` github.com twin and an SSH-alias zero-call twin, modelled on `reap-merged.test.js`'s "removal-failed … escalates once at the threshold" test (a locked worktree, `RESIDUE_ESCALATE_THRESHOLD` passes), with `prStates: { byBranch: () => ({ number: 9, state: 'MERGED', mergedAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' }) }`, the same `gateDeps` and the recording `runner`.
  - In `tests/bin-lib/reconcile/archive-merged.test.js`, `test('#4794 Review Focus 3: on a *.ghe.com origin a merged run whose PR closes its record still archives (record check compares the bare slug)', …)` using `fixtureOrdinaryMergedNoConsole(…, { origin: 'https://acme.ghe.com/acme/w.git', closes: [<the run's record>] })` with the same `gateDeps`, and that helper's existing archived-with-`closes` assertions.

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test tests/gh-host-seam-behavior.test.js tests/bin-lib/reconcile/archive-merged.test.js tests/bin-lib/reconcile/reap-merged.test.js`
Expected: the GHE escalation cases FAIL (`--repo acme/widgets`) and the SSH-alias cases FAIL (the runner sees `--repo acme/widgets`). The github.com cases and Review Focus 3 pass before the change. After Step 3, prove Review Focus 3 can go red by temporarily passing `residueRepo` into `recordCheck`, then restore.

- [ ] **Step 3: Implement** the derivations and the call-site argument changes from the Interfaces block.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/gh-host-seam-behavior.test.js tests/bin-lib/reconcile/archive-merged.test.js tests/bin-lib/reconcile/reap-merged.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/reconcile/archive-merged.js plugin/bin/lib/reconcile/reap-merged.js tests/gh-host-seam-behavior.test.js tests/bin-lib/reconcile/archive-merged.test.js tests/bin-lib/reconcile/reap-merged.test.js
git commit -m "Gate archive and reap residue escalation on the origin host (refs #4794)"
```

### Task 4: pr-state and sibling-sessions read the gated slug

**Role:** integration

**Files:**
- Modify: `plugin/bin/lib/reconcile/pr-state.js` (`prNotFoundProbeArgs` :173-174, `resolvePrStatesBulk` :363)
- Modify: `plugin/bin/lib/hooks/sibling-sessions.js` (`defaultReadClaim` :206)
- Test: `tests/bin-lib/reconcile/pr-state.test.js`, `tests/gh-host-seam-behavior.test.js`

**Interfaces:**
- Consumes: `originSlugOf` (Task 1), imported from `../hooks/git-exec` / `./git-exec`.
- `prNotFoundProbeArgs(repoRoot, number)` and `resolvePrStatesBulk`'s default slug read `originSlugOf(repoRoot)` instead of `repoSlugOf(repoRoot)`. A refusal is a null slug: the probe returns null and the bulk screen returns `'network-failure'` with no spawn, exactly as for no origin today. The GraphQL `-f owner=`/`-f name=` pair stays the bare split. Every spawn already passes `cwd: repoRoot` to `ghOptions`, so the GHE host still comes from the seam.
- `defaultReadClaim`: `repoSlug: originSlugOf(cwd)`; a null slug already makes the contents-API leg `repo-slug-unresolved` with no request.
- Drop the `repoSlugOf` import from both files.

- [ ] **Step 1: Write the failing tests**
  - `pr-state.test.js`: `test('#4794: resolvePrStatesBulk on an SSH-alias origin spawns nothing and fails closed', …)`: a repo with origin `git@github-work:acme/w.git`, `GH_HOST` deleted and `GH_CONFIG_DIR` pointed at an empty temp dir, and a recording `opts.runner`: the result is `'network-failure'` and the runner saw zero calls. Same for `prNotFoundProbeArgs(repo, 7) === null`.
  - `gh-host-seam-behavior.test.js`: `test('AC1.1: pr-state\'s bulk PR screen on a *.ghe.com origin reaches the origin host with a bare owner/name pair', …)`: `resolvePrStatesBulk(repo, ['feature'])` in-process with the fake gh. The logged line starts `GH_HOST=acme.ghe.com ` and carries `-f owner=acme -f name=widgets`.

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test tests/bin-lib/reconcile/pr-state.test.js tests/gh-host-seam-behavior.test.js`
Expected: the SSH-alias cases FAIL (the runner is called with `owner=acme`); the GHE case passes before and after (it pins the bare pair).

- [ ] **Step 3: Implement** the two swaps.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/bin-lib/reconcile/pr-state.test.js tests/gh-host-seam-behavior.test.js tests/hooks-sibling-sessions.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/reconcile/pr-state.js plugin/bin/lib/hooks/sibling-sessions.js tests/bin-lib/reconcile/pr-state.test.js tests/gh-host-seam-behavior.test.js
git commit -m "Read pr-state's and sibling-sessions' origin slug through the gate (refs #4794)"
```

### Task 5: retire `repoSlugOf`

**Role:** integration

**Files:**
- Modify: `plugin/bin/lib/hooks/git-exec.js` (delete `repoSlugOf` and its export; reword `repoSpecOf`'s header and #4857 fallback comment, which name it)
- Modify: `plugin/bin/lib/reconcile/release-merged.js` (drop `repoSlugOf` from its import and its `module.exports` re-export)
- Test: `tests/hooks-git-exec.test.js` (the two `repoSlugOf` assertions at :439 and :480 compare against `repoTargetOf(repo).slug` instead; drop the import), `tests/gh-host-seam-conformance.test.js`

**Interfaces:**
- Consumes: Tasks 2-4 (no caller of `repoSlugOf` remains).

- [ ] **Step 1: Write the failing test** in `tests/gh-host-seam-conformance.test.js`: `test('#4794: no plugin/bin file names repoSlugOf — origin slugs go through the gate (repoTargetOf / originSlugOf)', …)`, walking `BIN_ROOT` with the file's existing `walk`/`readText` and the comment stripper in blank mode, asserting no file's code matches `/(?<![\w$])repoSlugOf(?![\w$])/`, with a floor on files walked as the other tests in the file do.

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/gh-host-seam-conformance.test.js`
Expected: FAIL after Step 1, naming `lib/hooks/git-exec.js` and `lib/reconcile/release-merged.js`

- [ ] **Step 3: Implement** the deletions and the two test-assertion swaps.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/gh-host-seam-conformance.test.js tests/hooks-git-exec.test.js tests/bin-lib/reconcile/release-merged.test.js tests/bin-lib/reconcile/archive-merged.test.js tests/bin-lib/reconcile/reap-merged.test.js tests/bin-lib/reconcile/pr-state.test.js tests/hooks-sibling-sessions.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/hooks/git-exec.js plugin/bin/lib/reconcile/release-merged.js tests/hooks-git-exec.test.js tests/gh-host-seam-conformance.test.js
git commit -m "Retire repoSlugOf now that every origin slug goes through the gate (refs #4794)"
```

### Task 6: claim store and claim-targets on the origin host

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/issues/claim-store.js` (`isSameRepoPrUrl` :677, `tombstoneInFlightPr` :695, `openPrListArgs` :720, `matchStaleClaimPr` :739, `staleClaimInFlightPr` :775)
- Modify: `plugin/bin/lib/claim-targets/claim-targets.js` (the `tombstoneInFlightPr` call at :566 and the `staleClaimInFlightPr` call at :607)
- Modify: `plugin/bin/claim-targets.js` (`realDeps.ghHost`, `realDeps.prUrlHost`)
- Test: `tests/bin-lib/issues/claim-store.test.js`, `tests/bin-lib/claim-targets/claim-targets.test.js`

**Interfaces:**
- Consumes: `repoTargetOf` (Task 1, from `./lib/hooks/git-exec`), `prUrlHost` (Task 1).
- Produces (each host defaults to `null`; `null` or `'github.com'` keeps today's exact behavior):
  - `openPrListArgs(owner, repo, host = null)`: the `--repo` value is `repoSlug({ host, owner, repo })` (import `repoSlug` from `../repo-resolve`). The other argv elements are unchanged.
  - `isSameRepoPrUrl(link, owner, repo, host = null)`: matches `^https://([^/]+)/{owner}/{repo}/pull/\d+$` (owner and repo escaped and exact) and requires `normalizeHost(m[1]) === normalizeHost(host || 'github.com')` (import `normalizeHost` from `../repo-resolve`).
  - `matchStaleClaimPr(runId, prs, owner, repo, host = null)` and `tombstoneInFlightPr(content, gh, owner, repo, host = null)`: thread `host` into `isSameRepoPrUrl`.
  - `staleClaimInFlightPr(content, gh, owner, repo, onError, { repoHost = null, urlHost = repoHost } = {})`: `repoHost` goes to `openPrListArgs`, `urlHost` to `matchStaleClaimPr`.
  - `claim-targets` `run()`: `const repoHost = typeof deps.ghHost === 'function' ? deps.ghHost() : null; const urlHost = typeof deps.prUrlHost === 'function' ? deps.prUrlHost(repoHost) : repoHost;`. `tombstoneInFlightPr(…, urlHost)`, `staleClaimInFlightPr(…, onError, { repoHost, urlHost })`.
  - `realDeps.ghHost = () => { const t = repoTargetOf(process.cwd()); return t && !t.refusal ? t.host : null; }` and `realDeps.prUrlHost = (repoHost) => prUrlHost(repoHost)`.

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

### Task 7: stale-claim-pr.js on the gate, explicit host trusted

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/stale-claim-pr.js` (`run()` :178-194, the header paragraph at :49-53, `realDeps` gains `gateDeps: undefined`)
- Test: `tests/stale-claim-pr-cli.test.js` (rework the test pinning `stale-claim matching supports github.com only`), `tests/gh-host-seam-behavior.test.js`, `tests/gh-host-seam-conformance.test.js`

**Interfaces:**
- Consumes: `openPrListArgs(owner, repo, host)`, `matchStaleClaimPr(…, host)` (Task 6); `gateOriginRepo`, `normalizeHost`, `prUrlHost` from `./lib/repo-resolve`.
- `run()` resolves `{ owner, repo, repoHost, urlHost }`:
  - Explicit `--repo` with three or more `/`-parts: `parseRepo` it; `repoHost = urlHost = normalizeHost(host)`, any host (round 2), and a `github.com` host normalizes to `null` so its argv stays bare.
  - Explicit bare `--repo owner/name`: github.com, as today (`repoHost = urlHost = null`).
  - No `--repo`: `const gated = gateOriginRepo(remote, deps.gateDeps)`. `gated.refusal` → write `stale-claim-pr.js: {refusal}\n` to stderr and print the failure verdict `stale-claim matching supports github.com and known GitHub Enterprise hosts only` on stdout, exit 0, with no claim read and no `gh` call. `gated.spec === null` → today's exit-3 "could not resolve owner/repo". Otherwise `repoHost` is `gated.spec.host` (null when it is `github.com`) and `urlHost = prUrlHost(repoHost, (deps.gateDeps) || {})`.
  - `repoHost` goes to `openPrListArgs`, `urlHost` to `matchStaleClaimPr`.
- Header paragraph: an explicit host-qualified `--repo` is trusted and not gated; an origin goes through `gateOriginRepo` (#4933), so only github.com, a known GitHub Enterprise host, or a `GH_HOST` opt-in is matched, and anything else is the failure verdict; PR urls are compared on the host gh answered from (`GH_HOST` when exported non-empty).
- `tests/gh-host-seam-conformance.test.js`: remove `stale-claim-pr.js` from `NOT_ORIGIN`, add it to `ORIGIN_GATED`, and lower the AC9.2 floor from 6 to 5 with the comment extended to name #4794 as a deliberate move onto the gate (the #4951/#4805 precedent in the same comment).

- [ ] **Step 1: Write the failing tests**
  - `stale-claim-pr-cli.test.js`: rework the GHES-refusal test. `--repo ghe.example.com/acme/w` with a marked `https://ghe.example.com/acme/w/pull/7` listing → `{ match: true, link: 'https://ghe.example.com/acme/w/pull/7', failure: null }`. `--repo github.com/acme/w` on the gh path lists with `--repo acme/w` (bare). A `*.ghe.com` origin (`gateDeps: { env: {} }`) matches `https://acme.ghe.com/acme/w/pull/7`, and on the gh path its `deps.calls.gh` holds `--repo acme.ghe.com/acme/w`. A `ghe.example.com` origin with `gateDeps: { env: {}, readFile: () => 'ghe.example.com:\n' }` matches the same way. A `ghe.example.com` origin and a `git@github-work:acme/w.git` origin, each with `gateDeps: { env: {}, readFile: () => { throw new Error('ENOENT'); } }`, print the failure verdict with the new wording, write the refusal to stderr, and make no claim read and no `gh` call. A `*.ghe.com` origin with `gateDeps: { env: { GH_HOST: 'mine.example' } }` lists with a bare `--repo acme/w` and matches `https://mine.example/acme/w/pull/7`.
  - `gh-host-seam-behavior.test.js`: `test('AC1.1: stale-claim-pr.js on a *.ghe.com origin lists open PRs on the origin host and matches its marked PR', …)`, running the CLI as a child (`node(repo, …)`) in a GHE temp repo with the fake gh answering `pr list` with a marked `https://acme.ghe.com/acme/widgets/pull/12` entry: `assertEveryLineReaches(lines, 'acme.ghe.com')` and stdout `match: true`. `test('AC2.1: stale-claim-pr.js on a github.com origin keeps today\'s pr list argv', …)`: the network line equals `GH_HOST=unset ARGS=pr list --repo acme/widgets --state open --json url,body,isCrossRepository --limit 1000`.

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test tests/stale-claim-pr-cli.test.js tests/gh-host-seam-behavior.test.js`
Expected: FAIL after Step 1 on every new GHE, `ghe.example.com`, `github-work` and `mine.example` assertion. The AC2.1 argv pin passes before and after.

- [ ] **Step 3: Implement** `run()`, the header paragraph and the conformance roster change.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/stale-claim-pr-cli.test.js tests/gh-host-seam-behavior.test.js tests/gh-host-seam-conformance.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/stale-claim-pr.js tests/stale-claim-pr-cli.test.js tests/gh-host-seam-behavior.test.js tests/gh-host-seam-conformance.test.js
git commit -m "Gate stale-claim-pr's origin and trust an explicit host-qualified --repo (refs #4794)"
```

### Task 8: agent-composed stale-claim-pr.js calls take their host from origin

**Role:** integration

**Files:**
- Modify: `plugin/skills/_shared/issue-claims.md` (the lock step 4 invocation at :198, and the two `https://github.com/{owner}/{repo}/pull/{number}` sentences at :187 and :525)
- Modify: `plugin/skills/tidy/scan-procedures.md` (the Step 4.7 invocation at :244)
- Test: `tests/tidy-stale-claim-open-pr-conformance.test.js` (the AC1.2 `--repo "{owner}/{repo}"` pin at :50), `tests/issue-claims-stale-open-pr-conformance.test.js`

**Interfaces:**
- Consumes: Task 7's CLI behavior (no `--repo` reads origin through the gate; exit 3 when origin does not parse).
- Both invocations (spec round 3, Q2) drop `--repo`: the CLI derives the repo and its host from origin through the gate. One added sentence at each site: exit 3 (origin does not parse, e.g. a sandbox proxy remote) → re-run adding `--repo "{host}/{owner}/{repo}"`, `{host}` being the GitHub host the record lives on (`github.com` on the GitHub MCP path), never a bare `owner/repo`. Keep the existing exit-2 → `--listing` sentence; the exit-3 re-run's `--repo` carries over to it.
- `issue-claims.md`'s two tombstone sentences read `https://{host}/{owner}/{repo}/pull/{number}`, where `{host}` is the origin's GitHub host (github.com by default, `GH_HOST` when exported), compared case-insensitively with trailing dots ignored.
- Rail: trim words in the same paragraphs so `wc -c` prints at most 50800 for `issue-claims.md` and at most 52447 for `scan-procedures.md`.

- [ ] **Step 1: Write the failing tests**
  - `tidy-stale-claim-open-pr-conformance.test.js`: replace the AC1.2 `--repo "{owner}/{repo}"` assertion with three: the first `bin/stale-claim-pr.js` invocation in `claimAuditSection()` carries no `--repo`; the section contains `--repo "{host}/{owner}/{repo}"` on an exit-3 sentence (`/[Ee]xit 3/` before it in the same sentence); and the section never contains `--repo "{owner}/{repo}"` (no agent-composed bare slug).
  - `issue-claims-stale-open-pr-conformance.test.js`: the same three assertions on `lockStep4()`, plus: `issue-claims.md` contains no `https://github.com/{owner}/{repo}/pull/{number}` and contains `https://{host}/{owner}/{repo}/pull/{number}` twice.

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test tests/tidy-stale-claim-open-pr-conformance.test.js tests/issue-claims-stale-open-pr-conformance.test.js`
Expected: FAIL after Step 1 on the no-`--repo`, exit-3 and `{host}` assertions

- [ ] **Step 3: Implement** the prose edits, then `wc -c plugin/skills/_shared/issue-claims.md plugin/skills/tidy/scan-procedures.md` must print at most 50800 and 52447.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/tidy-stale-claim-open-pr-conformance.test.js tests/issue-claims-stale-open-pr-conformance.test.js tests/context-cost.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/_shared/issue-claims.md plugin/skills/tidy/scan-procedures.md tests/tidy-stale-claim-open-pr-conformance.test.js tests/issue-claims-stale-open-pr-conformance.test.js
git commit -m "Take agent-composed stale-claim-pr hosts from origin, never a bare --repo (refs #4794)"
```

### Task 9: pin the SSH-alias origin on post-merge and teardown-run

**Role:** integration

**Files:**
- Test: `tests/bin-lib/reconcile/post-merge.test.js`, `tests/hooks-teardown-run.test.js`, `tests/gh-host-seam-behavior.test.js`
- No code change in `plugin/bin/lib/reconcile/post-merge.js` or `plugin/bin/lib/hooks/teardown-run.js`: both take their host from `repoSpecOf` → `gateOriginRepo` on main (#4933), which is the rule the spec's round-3 Decision keeps.

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
git commit -m "Pin the SSH-alias refusal on post-merge and teardown-run (refs #4794)"
```

### Task 10: a whole reconcile pass on a GHE origin, and the stale prose

**Role:** integration

**Files:**
- Test: `tests/gh-host-seam-behavior.test.js`
- Modify: `.claude/skills/gh-api-module-pattern/SKILL.md` (the paragraph saying a bare slug passed as `--repo` — `escalate-residue.js`'s calls, `claim-store.js`'s `openPrListArgs` — is github.com-only by inheritance, and any line naming `repoSlugOf`)
- Modify: `docs/reconcile-checks.md` (the residue-escalation `--repo` sentence, if it names the bare slug)
- Modify (comments only): `tests/bin-lib/reconcile/prune-remote.test.js` :58, `tests/bin-lib/reconcile/archive-branches.test.js` :161, `tests/bin-lib/reconcile/archive-merged.test.js` :2416 and :3961, `tests/bin-lib/reconcile/pr-state.test.js` :566 — each names `repoSlugOf`; reword to `originSlugOf`/`repoTargetOf`, keeping the sentence's claim.

**Interfaces:**
- Consumes: Tasks 1-9.

- [ ] **Step 1: Write the test**
  - `test('AC1.1: a whole reconcile pass (hooks.js reconcile) on a *.ghe.com origin sends every gh call to the origin host', …)`: a GHE temp repo with `CLAUDE.md` `work-backend: github-issues`, and a fake gh on PATH (a `case` stub answering the claims tree listing with `{"truncated":false,"entries":[]}` and anything else with `[]`). Run `node plugin/bin/hooks.js reconcile` as a child with `cwd: repo` and `childEnv()` plus `GIT_TERMINAL_PROMPT=0` and an empty `GH_CONFIG_DIR`. The pass may `git fetch` the `https://acme.ghe.com/…` origin, and that fetch must fail fast rather than prompt. If a network `git` call still makes the case slow or flaky, stop and report it rather than loosening the assertion. Assert `assertEveryLineReaches(lines, 'acme.ghe.com')`, whose `net.length >= 1` floor proves at least release-merged's tree listing ran.

- [ ] **Step 2: Run it**

Run: `node --test tests/gh-host-seam-behavior.test.js`
Expected: PASS (Tasks 1-7 landed). Prove the case can go red: temporarily revert Task 2's `root` binding and run the pass in-process from this checkout's cwd, then restore.

- [ ] **Step 3: Update the prose.** In the skill: origin-derived repos come from `git-exec.js`'s `repoTargetOf` (`ghRepo` for `--repo`, `slug` for `repos/…` paths and GraphQL pairs) or `originSlugOf`, both through #4933's gate, so an unknown or SSH-alias origin is refused rather than sent bare; PR-url matching uses `prUrlHost`; `release-merged.js`'s REST calls pass `cwd: root`. In `docs/reconcile-checks.md`, if it states the residue `--repo` is the bare slug, say it is host-qualified for a known GHE origin, bare for github.com, and that a refused origin escalates nothing. Reword the test comments. Keep the rest of each paragraph. Then `git grep -n repoSlugOf -- plugin .claude docs/reconcile-checks.md tests` prints nothing.

- [ ] **Step 4: Run the record's acceptance command and the seam scan**

Run: `node --test tests/gh-host-seam-behavior.test.js tests/gh-host-seam-conformance.test.js`
Expected: PASS (spec AC3.1)

- [ ] **Step 5: Commit**

```bash
git add tests/gh-host-seam-behavior.test.js .claude/skills/gh-api-module-pattern/SKILL.md docs/reconcile-checks.md tests/bin-lib/reconcile/prune-remote.test.js tests/bin-lib/reconcile/archive-branches.test.js tests/bin-lib/reconcile/archive-merged.test.js tests/bin-lib/reconcile/pr-state.test.js
git commit -m "Pin a whole GHE reconcile pass and retire the bare-slug and repoSlugOf prose (refs #4794)"
```

## Spec coverage

| Spec item | Task |
|---|---|
| Deliverable 1 (host-aware sibling, move reconcile callers and claim-store onto it) | 1, 2, 3, 4, 5, 6, 7 |
| Deliverable 2 (slug comparisons and `repos/…` paths stay consistent; github.com byte-identical) | 2, 3 (Review Focus 3), 4, 6, 7 |
| Deliverable 3 (GHE-origin case per migrated caller in `tests/gh-host-seam-behavior.test.js`) | 2, 3, 4, 7, 9, 10 |
| Decision round 1: Reading B (seam-known hosts only) | 1 (through the gate, which admits the same hosts), 3, 6, 7 |
| Decision round 1: align post-merge/teardown, SSH-alias test on each | 9 |
| Decision round 2: explicit host-qualified `--repo` trusted; `GH_HOST` value for PR-url matching; normalized host comparisons incl. the MCP prose | 1, 6, 7, 8 |
| Decision round 3, Q1: `repoSlugOf` paths through `gateOriginRepo`, one host rule per pass, SSH-alias refusals pinned | 1, 2, 3, 4, 5, 9 |
| Decision round 3, Q2: agent-composed `stale-claim-pr.js` calls take the host from origin; tidy pin updated | 8 |
| Minor rulings: empty `GH_HOST` is unset on every path; Task 1 `Review risk: high`; enterprise-token clause follows the seam | 1 (gate + `prUrlHost`), 7 |
| AC1.1 | 2, 3, 4, 7, 9, 10 |
| AC2.1 | 1, 2, 3, 6, 7 (github.com twins) |
| AC3.1 | 10 Step 4 |
| Key File `pr-state.js` | 4 |
| Key File `plugin/bin/lib/reconcile/post-merge.js` | No code change (#4933 on main); pinned by Task 9 |
