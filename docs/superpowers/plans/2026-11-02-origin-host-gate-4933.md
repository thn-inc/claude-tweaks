# Origin-Host Gate (#4933) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An origin-derived git host reaches gh (as `--repo host/owner/repo`, `--hostname`, or a hook's REST DELETE) only on a positive GitHub signal. Any other origin host is refused, with an error naming the host and the `GH_HOST={host}` opt-in.

**Architecture:** One gate, `gateOriginRepo(remote, deps)`, in `plugin/bin/lib/repo-resolve.js`. It parses the origin with `parseRepo`, normalizes the host once (`normalizeHost`), and returns `{ spec, refusal }`. Every origin-derived producer calls it at its origin branch only, so a user-typed `--repo` keeps today's path. Downstream code (`repoSlug`, `repoResolutionNote`, the lib modules' `--hostname` threading) receives the normalized host and needs no change. The known-host test is factored out of `resolveGhSpec` into `isKnownGhHost`, which both callers share.

**Tech Stack:** Node 18+ CommonJS, `node --test`, fake `gh` on PATH (`tests/helpers/path-stub.js`).

**Spec:** `.claude-tweaks/pipelines/2026-11-02T074712-spec-4933-4951/spec-4933/work/4933-spec.md` (record #4933)

**Scope keywords:** parseRepo, repoSpecOf, repoSlug, repoResolutionNote, --hostname

## Global Constraints

- Decision (human-approved): **refuse**, never drop. An origin host with no positive signal is never passed to gh, and the CLI never falls back to a bare `owner/repo` or to `github.com`.
- Positive signals, checked in this order: an exported non-empty `GH_HOST` (Decided by the user at plan review: an exported but empty `GH_HOST` is not an opt-in, so an unknown host is refused — the gate deliberately diverges from `ghOptions`, which treats a present-but-empty `GH_HOST` as set), a normalized host of `github.com`, a host ending in `.ghe.com`, a gh `hosts.yml` key. A token in the environment is never a signal.
- An exported `GH_HOST` always wins. When it matches the origin host (after `normalizeHost`), the spec carries that host. When it names another host, the spec's host is `'github.com'`: the slug is bare, there is no `--hostname`, and gh reaches the exported host.
- A user-typed `--repo host/owner/repo` (or a bare `owner/repo`) is untouched: no gate, no normalization, and `pinExplicitRepoHost` still applies to it alone.
- A CLI that gets a refusal writes `{cli}: {refusal}` to stderr and returns the exit code it already uses when owner/repo cannot be resolved (2 for every CLI in this plan). It does this before any gh call that names a repo or host. Only the `gh --version` availability probe may precede it.
- Hook-side producers never exit or throw (the never-break-a-session invariant, `docs/hooks.md`).
- `repoSpecOf`'s `ssh://` fallback (`git-exec.js:223-227`, `host: null`) is #4857's. Do not widen it, and do not turn a null host into a refusal.
- `stuck-open-prs.js` is #4951's record and is out of scope here. Task 8's scan exempts it by name, with that reason.
- Commit subjects: `{Verb} {what} — {detail}` (imperative, no conventional prefix), each ending with the trailer `Claude-Session: https://claude.ai/code/session_01X7gPFD5pdHXnqsX9gCSXve`.
- Governing skill `gh-api-module-pattern` (`.claude/skills/gh-api-module-pattern/SKILL.md`), quoted verbatim:
  - "**A host handed to gh — `GH_HOST`, a host-qualified `--repo`, or `--hostname` — is where gh sends `GH_ENTERPRISE_TOKEN`.** Derive one from origin only on a positive GitHub signal (`*.ghe.com`, a gh `hosts.yml` key) or take it from a user-typed value, never from the raw origin host."
  - (`cli-wrapper-contract.md`) "Logic lives in an exported `run(argv, deps)`; every side effect (`runner`, `ghAvailable`, `remoteUrl`, `stdout`, `stderr`) goes through `deps` so tests inject fakes. **Every** `deps` call that can throw (e.g. `remoteUrl` outside a git repo) is try/caught into the documented exit-code contract"
  - "Tests never touch real `gh`: fake runners branch on the `args` shape … and `throw new Error('unexpected ' + args.join(' '))` on anything unhandled"
- Governing skill `bin-source-scan-conformance` (Task 8), quoted verbatim: "A scan reports `misparsed` and `unparseable` as an offender, with `STRIPPER_VERDICT_MESSAGES[verdict]` as the text."; "For a scan that matches compliant and non-compliant sites alike, assert a lower bound on matches across the tree … Set the floor to the count at the time the scan lands."; "Assert the exact flagged line numbers, not just a count, because the right count can come from the wrong lines. Run each new assertion against the code it guards with the guard removed, and watch it go red."
- Source-scan suites: every task touching `plugin/bin/` also runs `node --test tests/path-guard-conformance.test.js tests/windows-hide-spawn-conformance.test.js tests/gh-host-seam-conformance.test.js`. No new `fs.existsSync` or `fs.realpathSync`. `hosts.yml` is read through the existing `ghConfigHosts`, which goes through an injectable `readFile`.

## Review Focus

1. **`GH_HOST=` exported but empty** must count as not exported, so an unknown host is still refused (Task 1: `empty GH_HOST is no opt-in`).
2. **A `GH_HOST` spelled differently from the origin host** (`GH_HOST=Git.Corp.Invalid.`, origin `git.corp.invalid`) must match after `normalizeHost` and pass through with the normalized host (Task 1).
3. **A missing or unreadable `hosts.yml`** (readFile throws) must yield no keys: an unknown host is refused, github.com is unaffected, and nothing throws (Task 1; for hooks, Task 6).
4. **An scp-form origin** (`git@git.corp.invalid:o/r.git`) must be refused exactly like the https form (Task 1).
5. **A CLI whose current origin read sits after its first network gh call**, or that tolerates a null repo (preflight-records body-text mode, backlog-grant-gate's native branch), must still refuse before any network call. The behavior table's "zero network lines" assertion covers it (Tasks 3 and 4).

---

### Task 1: The origin-host gate in repo-resolve.js
**Role:** judgment
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/repo-resolve.js` (factor `isKnownGhHost` out of `resolveGhSpec` at :143; add `gateOriginRepo`; export both)
- Test: `tests/bin-lib/repo-resolve.test.js`

**Interfaces:**
- Produces: `isKnownGhHost(host: string /* already normalized */, deps = {}) -> boolean`, which is `host.endsWith('.ghe.com') || ghConfigHosts(deps).has(host)`. `resolveGhSpec` calls it in place of its inline expression.
- Produces: `gateOriginRepo(remote: string|null|undefined, deps = {}) -> { spec: { host: string, owner: string, repo: string } | null, refusal: string | null }`. `deps` carries the `ghConfigHosts` keys (`env`, `readFile`, `platform`, `homedir`); `env` defaults to `process.env`. Rules:
  - `parseRepo(remote)` is null (absent or unparseable) → `{ spec: null, refusal: null }`. The caller keeps its own existing "could not resolve owner/repo" path.
  - `host = normalizeHost(parsed.host)`.
  - `env.GH_HOST` non-empty after trim: `normalizeHost(env.GH_HOST) === host` → spec `{ ...parsed, host }`; otherwise spec `{ ...parsed, host: 'github.com' }`.
  - `host === 'github.com'` or `isKnownGhHost(host, deps)` → spec `{ ...parsed, host }`.
  - Otherwise → `{ spec: null, refusal }` with exactly this copy: `` `origin host ${host} is not a known GitHub host (not github.com, not *.ghe.com, not a gh hosts.yml key) — refusing to send it to gh; if it is GitHub Enterprise, export GH_HOST=${host}` ``
  - A throwing `readFile` is already absorbed by `ghConfigHosts` (no keys). `gateOriginRepo` never throws.

- [ ] **Step 1: Write the failing tests** in `tests/bin-lib/repo-resolve.test.js`. Each test injects `env` and `readFile` (never the real home):
  - `AC1.1: an unknown origin host with only GH_ENTERPRISE_TOKEN set is refused`: remote `https://git.corp.invalid/o/r.git`, env `{ GH_ENTERPRISE_TOKEN: 't' }`, readFile throws → `spec === null`; `refusal` includes `git.corp.invalid` and `GH_HOST=git.corp.invalid`.
  - `AC1.2: a *.ghe.com origin passes`: `https://acme.ghe.com/o/r.git` → spec `{ host: 'acme.ghe.com', owner: 'o', repo: 'r' }`, refusal null.
  - `AC1.3: a hosts.yml key passes`: readFile returns `'ghes.corp.invalid:\n    user: x\n'`, remote `https://ghes.corp.invalid/o/r.git` → spec host `ghes.corp.invalid`.
  - `AC1.4: GH_HOST matching the origin host passes it through`: env `{ GH_HOST: 'git.corp.invalid' }` → spec host `git.corp.invalid`.
  - `AC1.5: github.com with a trailing dot normalizes`: `https://GitHub.com./o/r.git` → spec host `github.com`.
  - `AC1.6: a mixed-case *.ghe.com with a trailing dot normalizes`: `https://ACME.ghe.com./o/r.git` → spec host `acme.ghe.com`.
  - `GH_HOST naming another host gives a github.com spec`: env `{ GH_HOST: 'github.com' }`, origin `git.corp.invalid` → spec host `github.com`, refusal null.
  - Review Focus 1, `empty GH_HOST is no opt-in`: env `{ GH_HOST: '  ' }` → refused.
  - Review Focus 2: env `{ GH_HOST: 'Git.Corp.Invalid.' }` → spec host `git.corp.invalid`.
  - Review Focus 4: `git@git.corp.invalid:o/r.git` → refused.
  - `unparseable or absent origin is neither spec nor refusal`: `null` and `'not a url'` → `{ spec: null, refusal: null }`.
  - Guard discrimination: one case per signal in which only that signal admits the host. ghe.com with no GH_HOST and readFile throwing; hosts.yml key with no GH_HOST; GH_HOST with readFile throwing. State in each test name which branch it isolates.
- [ ] **Step 2: Run, expect FAIL.** Run: `node --test tests/bin-lib/repo-resolve.test.js`. Expected: FAIL with `gateOriginRepo is not a function`.
- [ ] **Step 3: Implement** `isKnownGhHost` and `gateOriginRepo` as specified above, and switch `resolveGhSpec` to `isKnownGhHost`. Update the file's header comment to name the gate.
- [ ] **Step 4: Run, expect PASS.** Run `node --test tests/bin-lib/repo-resolve.test.js tests/gh-host-seam-behavior.test.js` plus the three source-scan suites. Expected: all pass, and every existing `resolveGhSpec`/`ghOptions` test is unchanged.
- [ ] **Step 5: Go red.** In a scratch copy, delete each signal branch in turn and show that its isolating test fails.
- [ ] **Step 6: Commit** `Add origin-host gate to repo-resolve.js — refuse an origin host with no GitHub signal (#4933)`.

### Task 2: Behavior-table harness + CLI batch A (materialize, compose-subject, release-claim, repair-claim)
**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/materialize.js` (:400-408)
- Modify: `plugin/bin/lib/compose-subject.js` (:279-284)
- Modify: `plugin/bin/release-claim.js` (:141-145)
- Modify: `plugin/bin/repair-claim.js` (:102-106)
- Test: `tests/gh-host-seam-behavior.test.js` (new table harness + rows)
- Modify, when the batch's existing suites go red: `tests/bin-lib/compose-subject.test.js`, `tests/bin-lib/release-claim/cli.test.js`, `tests/bin-lib/repair-claim/cli.test.js`, `tests/materialize-*.test.js`

**Interfaces:**
- Consumes: `gateOriginRepo` (Task 1).
- Produces, for Tasks 3–5 and 7: the CLI origin-branch shape. Each CLI requires `gateOriginRepo` from repo-resolve and replaces its `opts.repo ? parseRepo(explicit) : parseRepo(remote)` with:
  ```js
  let repoSpec;
  if (opts.repo) repoSpec = parseRepo(/* explicit form, unchanged */);
  else {
    const gated = gateOriginRepo(remote, deps.gateDeps);
    if (gated.refusal) { deps.stderr(`{cli}.js: ${gated.refusal}\n`); return 2; }
    repoSpec = gated.spec;
  }
  ```
  `deps.gateDeps` is undefined in `realDeps` (real env and hosts.yml). Tests inject `{ env, readFile }`.
- Produces, for Tasks 3–5: the table harness in `tests/gh-host-seam-behavior.test.js`. It is a `CLI_TABLE` array of `{ cli: string /* path under plugin/bin */, argv: string[], setup?: (repo) => void, acceptsRepo: boolean, typedRepoLines?: (line) => boolean }` and one `describeOriginGate(row)` function that registers these cases per row:
  - `AC2.1 refused` (with `AC3.1` in the same case): origin `https://git.corp.invalid/o/r.git`; child env without `GH_HOST`, with `GH_ENTERPRISE_TOKEN=t` and `GH_CONFIG_DIR={empty temp dir}`. Assert exit ≠ 0; stderr contains `git.corp.invalid` and `GH_HOST=git.corp.invalid`; `networkLines(log)` is empty (only `--version` may appear); no log line contains `git.corp.invalid`; no log line carries `--repo o/r` (AC3.1, no bare-slug fallback).
  - `AC4.1 pass-through ×3`: origin `https://acme.ghe.com/o/r.git`; origin `https://ghes.corp.invalid/o/r.git` with `{GH_CONFIG_DIR}/hosts.yml` = `ghes.corp.invalid:\n`; origin `git.corp.invalid` with `GH_HOST=git.corp.invalid`. Assert at least one network line, and every network line reaches the host. Widen `reachesHost` to also accept `--hostname {host}`. Any `--repo` value is `{host}/o/r`.
  - `AC5.1 other GH_HOST`: `GH_HOST=github.com`, origin `git.corp.invalid`. Not refused (stderr lacks `is not a known GitHub host`), at least one network line, no line contains `git.corp.invalid`, and any `--repo` value is `o/r`.
  - `AC6.1 typed --repo` (rows with `acceptsRepo`): argv plus `--repo git.corp.invalid/o/r`, empty `GH_CONFIG_DIR`, no `GH_HOST`. Not refused, and every network line the row's `typedRepoLines` selects (default: every network line) reaches `git.corp.invalid`. Any `--repo` value is exactly `git.corp.invalid/o/r` (literal AC: "the argv carries `--repo git.corp.invalid/o/r` exactly as typed"). backlog-grant-gate.js's typed `--repo` re-routes only its native calls (`nativeRunnerFor`), so its `gh issue list` calls keep following the origin through the seam (an existing, pinned behavior, `tests/gh-host-seam-behavior.test.js` "issue lists to the origin host"). Its row sets `typedRepoLines` to the native calls only (`api graphql`, `api --paginate repos/o/r/…`), and Deliverable 5 forbids changing that path.
  - `AC7.1 normalization`: origin `https://github.com./o/r.git` → every `--repo` value is `o/r`, no `--hostname`, no `resolved repo` on stderr, every line has `GH_HOST=unset`. `AC7.2`: origin `https://ACME.ghe.com./o/r.git` → every `--repo` value is `acme.ghe.com/o/r`, every `gh api` line carries `--hostname acme.ghe.com` or `GH_HOST=acme.ghe.com`, and when the CLI prints a `repoResolutionNote` it names `acme.ghe.com`.
  - `argv` per row: the smallest argv that passes the CLI's own input validation, read from its `USAGE` and its existing CLI test (for example `materialize.js 7 --run-dir {runDir}`, `compose-subject.js 7 --tag human-approved`). `setup` writes any input file or policy the CLI needs.

- [ ] **Step 1: Write the harness and the four rows**, test names prefixed `AC2.1`…`AC7.2` with the CLI name (for example `AC2.1 materialize.js: refused on an unknown origin host`).
- [ ] **Step 2: Run, expect FAIL.** Run: `node --test tests/gh-host-seam-behavior.test.js`. Expected: the refused cases FAIL (exit 0, or calls made with `--repo git.corp.invalid/o/r`); the AC7 `github.com.` cases FAIL (`--repo github.com./o/r`).
- [ ] **Step 3: Implement** the origin-branch shape in the four CLIs. materialize.js keeps its later `repoResolutionNote` and `ghView` calls unchanged.
- [ ] **Step 4: Run, expect PASS.** Run `node --test tests/gh-host-seam-behavior.test.js tests/bin-lib/compose-subject.test.js tests/bin-lib/release-claim/cli.test.js tests/bin-lib/repair-claim/cli.test.js` and every `tests/materialize-*.test.js`, plus the source-scan suites. A pre-existing test whose fixture origin is an unknown host (`ghe.example.com`, `git.corp.example`, `gitlab.com`) and that asserts pass-through behavior gets `gateDeps: { env: { GH_HOST: '<that host>' } }` injected, or `GH_HOST` in a spawned child's env. A test asserting behavior the decision now refuses changes to assert the refusal. Rewrite no other assertion.
- [ ] **Step 5: Inserted-guard re-proof.** The gate sits ahead of each CLI's existing `!repoSpec` message and `'.'`/`'..'` owner guard. In a scratch copy, mutate each downstream check in release-claim.js and repair-claim.js (delete the `'.'`/`'..'` guard) and show that its existing test still goes red.
- [ ] **Step 6: Commit** `Gate materialize/compose-subject/release-claim/repair-claim origin reads — refuse unknown hosts (#4933)`.

### Task 3: CLI batch B (preflight-records, parent-gate, resolved-refusal, link-records)
**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/preflight-records.js` (:167-172, `loadFromGh`)
- Modify: `plugin/bin/parent-gate.js` (:322-327)
- Modify: `plugin/bin/resolved-refusal.js` (:64-74)
- Modify: `plugin/bin/link-records.js` (:78-83)
- Test: `tests/gh-host-seam-behavior.test.js` (four `CLI_TABLE` rows)
- Modify, when red: `tests/bin-lib/preflight-records/preflight-records.test.js`, `tests/parent-gate-cli.test.js`, `tests/bin-lib/issues/resolved-refusal-cli.test.js`, and any `link-records` CLI test

**Interfaces:**
- Consumes: Task 2's origin-branch shape and `CLI_TABLE`.
- preflight-records.js: the gate runs in `loadFromGh` before `fetchIssues`, in every `work-links` mode. A refusal returns `{ code: 2 }`, with the stderr line `preflight-records.js: {refusal}`. The null-repo tolerance for an unparseable origin in body-text mode is unchanged.
- parent-gate.js takes no `--repo`, so its row has `acceptsRepo: false`. Decided by the user at plan review: only its gh path is gated. Split the shared origin read at :322-327: when `opts.factsJson === null` (the gh path) it calls `gateOriginRepo(remote, deps.gateDeps)` and a refusal exits 2 with `parent-gate.js: {refusal}`. When `--facts-json` is given (no gh call; origin read only to judge a qualified `--closing` token) it keeps `parseRepo(remote)` with the host passed through `normalizeHost` (export it from repo-resolve if it is not already), and never refuses. Add a test `facts-json path: an unknown origin host is not refused and its host is normalized` (origin `https://Git.Corp.Invalid./o/r.git`, a `--facts-json` fixture and a qualified `--closing git.corp.invalid/o/r#1` token judged same-repo; exit is the facts path's normal code, and stderr lacks `is not a known GitHub host`).

- [ ] **Step 1: Add the four rows** (`AC2.1 preflight-records.js: …`, and so on). preflight-records needs one row for `work-links: body-text` (policy file in `setup`) and one for `native`.
- [ ] **Step 2: Run, expect FAIL.** Run `node --test tests/gh-host-seam-behavior.test.js`.
- [ ] **Step 3: Implement** the shape in the four CLIs.
- [ ] **Step 4: Run, expect PASS.** Run the behavior suite, the four CLIs' existing suites and the source-scan suites. Fix fixtures by Task 2 Step 4's rule.
- [ ] **Step 5: Re-proof.** In a scratch copy, mutate parent-gate.js's and link-records.js's `'.'`/`'..'` guards and show their tests go red.
- [ ] **Step 6: Commit** `Gate preflight-records/parent-gate/resolved-refusal/link-records origin reads (#4933)`.

### Task 4: CLI batch C (fetch-sub-issues, backlog-grant-gate, apply-refine-labels, file-feedback)
**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/fetch-sub-issues.js` (:98-103)
- Modify: `plugin/bin/backlog-grant-gate.js` (:155-172)
- Modify: `plugin/bin/apply-refine-labels.js` (:172-176)
- Modify: `plugin/bin/file-feedback.js` (:110-117)
- Test: `tests/gh-host-seam-behavior.test.js` (four rows)
- Modify, when red: `tests/fetch-sub-issues-cli.test.js`, `tests/backlog-grant-gate-cli.test.js`, `tests/apply-refine-labels.test.js`, `tests/bin-lib/feedback/file-feedback.test.js`

**Interfaces:**
- Consumes: Task 2's shape and table.
- backlog-grant-gate.js reads origin only under `work-links: native`. Its row's `setup` writes the same `policy.yml` (`work-links: native`, `integration-branch: main`, `autonomy: unattended`, `grant-origination-enabled: true`) and initial commit that the existing `grantGateLines` helper uses. Before implementing, check whether any network gh call precedes line 155. If one does, move the gated origin read ahead of it, so the AC2 "zero network lines" assertion holds.
- fetch-sub-issues.js `:144` (`if (host !== 'github.com') apiArgs.push('--hostname', host)`) now receives the normalized host. No change there.

- [ ] **Step 1: Add the four rows.** apply-refine-labels and file-feedback need an input file in `setup` (shape per their USAGE).
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run, expect PASS.** Run the behavior suite, the four existing suites and the source-scan suites.
- [ ] **Step 5: Re-proof.** In a scratch copy, mutate the `'.'`/`'..'` guards in fetch-sub-issues.js and backlog-grant-gate.js and show their tests go red.
- [ ] **Step 6: Commit** `Gate fetch-sub-issues/backlog-grant-gate/apply-refine-labels/file-feedback origin reads (#4933)`.

### Task 5: CLI batch D (list-claims, number-list-cli → resolve-blockers, resolve-linked-prs)
**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/list-claims.js` (:70-78)
- Modify: `plugin/bin/lib/number-list-cli.js` (:92-109)
- Test: `tests/gh-host-seam-behavior.test.js` (rows for `list-claims.js`, `resolve-blockers.js`, `resolve-linked-prs.js`)
- Modify, when red: `tests/list-claims-cli.test.js`, `tests/bin-lib/number-list-cli.test.js`, `tests/resolve-blockers-cli.test.js`, `tests/resolve-linked-prs-cli.test.js`

**Interfaces:**
- list-claims.js injects `parseRepo` through `deps`. Its explicit branch keeps `deps.parseRepo`, and its origin branch calls `gateOriginRepo(remote, deps.gateDeps)` directly.
- number-list-cli.js's refusal line is `${name}: {refusal}`, exit 2.

- [ ] **Step 1: Add the three rows.** **Step 2:** Run, expect FAIL. **Step 3:** Implement. **Step 4:** Run the behavior suite, the four existing suites and the source-scan suites; expect PASS.
- [ ] **Step 5: Commit** `Gate list-claims and number-list-cli origin reads (#4933)`.

### Task 6: Hook side (repoSpecOf, teardown-run, post-merge)
**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/hooks/git-exec.js` (:215-228, `repoSpecOf`)
- Modify: `plugin/bin/lib/hooks/teardown-run.js` (:287-297)
- Modify: `plugin/bin/lib/reconcile/post-merge.js` (:65 header vocabulary, :308-310)
- Modify: `plugin/bin/post-merge-run.js` (:28-36 header vocabulary)
- Modify: `docs/reconcile-checks.md` (:596 failure-word list, :707 `repoSpecOf` description)
- Test: `tests/hooks-git-exec.test.js`
- Test: `tests/hooks-teardown-run.test.js`
- Test: `tests/bin-lib/reconcile/post-merge.test.js`

**Interfaces:**
- `repoSpecOf(repoRoot: string, gateDeps?: object) -> { host, owner, repo } | { refusal: string } | null`. It runs `gateOriginRepo(remote.stdout, gateDeps)`. A spec returns the spec, a refusal returns `{ refusal }`, and `{ spec: null, refusal: null }` falls through to the existing loose `ssh://` fallback, unchanged (#4857). This widens the return shape. Callers: `teardown-run.js` and `post-merge.js` (grep-verified; no third). `tests/hooks-git-exec.test.js:436` pins `ghe.example.com` as a spec. Inject `gateDeps: { env: { GH_HOST: 'ghe.example.com' } }` there, and add a refusal case for an unknown host.
- teardown-run.js Step 5: `repoSpec && repoSpec.refusal` → push `` `remote ref: skipped — ${repoSpec.refusal}` ``, with no gh call. `teardownRun` gains no new parameter. Its test drives the refusal through a real temp repo origin `https://git.corp.invalid/o/r.git`, with `GH_HOST` removed from `process.env` and `GH_CONFIG_DIR` set to an empty temp dir for the case (restored after).
- post-merge.js `setupContext`: `repoSpec && repoSpec.refusal` → `return { failure: 'unknown-host', detail: repoSpec.refusal }`. Both consumers carry `detail` through: `postMerge`'s early return (:397) becomes `{ entries, deferred, failure: ctx.failure, detail: ctx.detail }` (the key omitted when undefined), and `postMergeOne`'s `classified({ …, reason: ctx.failure })` (:465) adds `detail: ctx.detail` when set, so the `GH_HOST=…` opt-in text reaches the operator. Document `detail` beside the vocabulary. `setupContext` calls `repoSpecOf(root, deps.gateDeps)`. Add `unknown-host` to the header vocabulary at `:65` and to post-merge-run.js's failure list. Before adding it, grep `plugin/bin` and `plugin/skills` for `no-remote` readers (spec Gotcha). Each reader that enumerates failure words gets `unknown-host` beside `no-remote`, or is classified no-change in the commit message with its reason.

- [ ] **Step 1: Write the failing tests:**
  - `AC8.1 teardown: an unknown origin host issues no gh DELETE and skips with the refusal`: `ghApiDelete` fake records calls, and the lines include one starting `remote ref: skipped —` that contains `git.corp.invalid`.
  - `AC8.2 post-merge setupContext: unknown origin host → failure unknown-host, no gh call`: `deps.gh` throws `unexpected` if called; `deps.gateDeps: { env: {}, readFile: () => { throw new Error('none'); } }` isolates the case from the machine's `GH_HOST` and `hosts.yml`; `detail` contains `GH_HOST=git.corp.invalid` on the `postMerge` result and on the `postMergeOne` entry.
  - `AC8.3 neither throws`: each call is wrapped in `assert.doesNotThrow`.
  - git-exec cases: unknown host → `{ refusal }`, `GH_HOST` match → spec, `ssh://` → unchanged fallback, readFile throwing → still `{ refusal }` without throwing (Review Focus 3).
- [ ] **Step 2: Run, expect FAIL.** Run `node --test tests/hooks-git-exec.test.js tests/hooks-teardown-run.test.js tests/bin-lib/reconcile/post-merge.test.js`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run, expect PASS**, plus `tests/reconcile.test.js` and the source-scan suites.
- [ ] **Step 5: Commit** `Gate repoSpecOf origin reads — teardown skips, post-merge reports unknown-host (#4933)`.

### Task 7: wrap-up pack.js `unblocked` probe
**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/wrap-up/pack.js` (:715-725)
- Test: `tests/bin-lib/wrap-up/pack.test.js`

**Interfaces:**
- The probe calls `gateOriginRepo(git(['remote', 'get-url', 'origin']), deps.gateDeps)`. A refusal → `throw new Error(refusal)` before any gh call, so the probe reports the refusal as its failure. The throw sits **outside** the existing `try { … } catch { /* no origin remote */ }` at :721-725: only the `git(…)` read stays inside the try. A throw inside it would be swallowed, leaving `repoArgs` empty and sending a bare `gh issue list` to github.com (the rejected drop). A spec → `repoArgs = ['--repo', repoSlug(spec)]`. A null spec or a git throw → today's empty `repoArgs`. `deps.gateDeps` comes from `gatherPack`'s `deps` overrides.

- [ ] **Step 1: Write the failing test** `AC8.4 pack unblocked probe: an unknown origin host makes no gh call naming it and reports the refusal`. Use a temp repo with origin `https://git.corp.invalid/o/r.git`, a fake gh that records argv, and `deps: { gateDeps: { env: {}, readFile: () => { throw new Error('none'); } } }`. Assert that the probe's failure text contains `GH_HOST=git.corp.invalid` and that no recorded argv contains `git.corp.invalid`. Mirror the existing `unblocked` tests' fixture shape.
- [ ] **Step 2: Run, expect FAIL.** **Step 3:** Implement. **Step 4:** Run `node --test tests/bin-lib/wrap-up/pack.test.js tests/gh-host-seam-behavior.test.js` plus the source-scan suites; expect PASS.
- [ ] **Step 5: Commit** `Gate the wrap-up pack's unblocked probe origin read (#4933)`.

### Task 8: ORIGIN_GATED conformance roster, matcher self-test, and prose sweep
**Role:** judgment

**Files:**
- Modify: `tests/gh-host-seam-conformance.test.js`
- Modify: `.claude/skills/gh-api-module-pattern/SKILL.md:17` (its last clause, "the origin-derived `repoSlug` path still does, tracked in #4933", becomes a pointer to `gateOriginRepo` and its refusal) and `:66` (`repoSpecOf` now returns `{ refusal }` for an unknown host). #4952 owns the skill's wider rewrite; this edit is limited to these two sentences.

**Interfaces:**
- `originReads(raw) -> { verdict, sites: [{ line, text }] }`. Keep-mode text gives literals and blank-mode text gives argument boundaries, with `stripperVerdict` on both (as `ghSites` does). A site is a `parseRepo(` call (bare or member, `deps.parseRepo(`) whose balanced argument text matches `/\bremote\b|remoteUrl|get-url|['"]origin['"]/`. An explicit `opts.repo.split('/')` argument without those tokens is not a site.
- `NOT_ORIGIN` (exempt, with reasons): `lib/repo-resolve.js` (defines the gate); `stale-claim-pr.js` (stops on any non-github.com origin host); `parent-gate.js` count 1 (Decided by the user at plan review: its `--facts-json` path makes no gh call and keeps a normalized raw parse); `lib/wrap-up/engine-verify.js` (passes only owner/repo through the seam); `lib/reconcile/pr-state-batch.js` (pins `--hostname github.com`); `stuck-open-prs.js` (#4951 moves it onto the gate). Each entry's count is settled exactly, like `ALLOWED`. `activity-gather.js` is not listed: it reads the origin in two lines (`url = deps.remoteUrl(); … parseRepo(url)`), so it has 0 matched sites, and it stops on any non-github.com host anyway. The matcher's doc comment names that two-line shape (a local assigned from `remoteUrl()`/`get-url`, then `parseRepo(local)`) as an accepted recall gap. #4951, built next in this flow, removes `stuck-open-prs.js` from `NOT_ORIGIN` and adds it to `ORIGIN_GATED` in the same commit that gates it.
- `ORIGIN_GATED` = the files whose stripped code calls `gateOriginRepo(` (the defining file excluded): `materialize.js`, `lib/compose-subject.js`, `release-claim.js`, `repair-claim.js`, `preflight-records.js`, `parent-gate.js`, `resolved-refusal.js`, `link-records.js`, `fetch-sub-issues.js`, `backlog-grant-gate.js`, `apply-refine-labels.js`, `file-feedback.js`, `list-claims.js`, `lib/number-list-cli.js`, `lib/wrap-up/pack.js`, `lib/hooks/git-exec.js`.

- [ ] **Step 1: Write the tests:**
  - `AC9.1: the origin-read matcher flags a fresh parseRepo(remote) and ignores explicit --repo parsing`. Planted lines: `parseRepo(remote)` (flagged), `deps.parseRepo(remote)` (flagged), `parseRepo(git(['remote', 'get-url', 'origin']))` (flagged), `parseRepo(opts.repo ? x : remote)` (flagged), `parseRepo(opts.repo.split('/').length >= 3 ? opts.repo : \`github.com/${opts.repo}\`)` (ok), `// parseRepo(remote)` in a comment (ok), `'parseRepo(remote)'` in a string (ok), `parseRepo(view && view.url)` (ok). Assert the exact flagged line numbers, and add a planted mis-parse that reports as an offender.
  - `AC9.2: no plugin/bin file reads the origin through parseRepo outside NOT_ORIGIN`: walk with a files floor of 523, offenders `[]`, and a matched-site floor equal to the count at landing.
  - `AC9.3: ORIGIN_GATED is exactly the set of files calling gateOriginRepo`: `deepEqual` sorted, and every roster file calls it.
  - Go-red: in a copy of `materialize.js`'s text, replace the gate call with `parseRepo(remote)` and show `originReads` flags it.
- [ ] **Step 2: Run, expect PASS** (Tasks 2–7 landed): `node --test tests/gh-host-seam-conformance.test.js`. Then revert one CLI's gate in a scratch copy and show AC9.2 and AC9.3 go red.
- [ ] **Step 3: Prose sweep.** Run `git grep -n -i -e 'repoSpecOf' -e 'GH_ENTERPRISE_TOKEN' -e 'host-qualif' -- plugin/skills docs .claude/skills ':!docs/superpowers/plans' ':!docs/incident-log.md'`. Edit each hit that describes an origin host reaching gh without the gate. List the rest as no-change in the commit body with a one-line reason each.
- [ ] **Step 4: Commit** `Pin ORIGIN_GATED roster in gh-host-seam conformance — origin reads go through the gate (#4933)`.

### Task 9: Full verification (folded into /build Common Step 5)

- [ ] **Step 1: AC10.1** — run `node --test tests/bin-lib/repo-resolve.test.js tests/gh-host-seam-behavior.test.js tests/gh-host-seam-conformance.test.js tests/hooks-teardown-run.test.js tests/bin-lib/reconcile/post-merge.test.js tests/bin-lib/wrap-up/pack.test.js` (expected: all pass), then `npm test` via `verify.js` (expected: exit 0). Runner checks only; no new code.

## Spec coverage map

| Spec item | Task |
|---|---|
| Deliverable 1 (gate + factored known-host test) | 1 |
| Deliverable 2 (positive signals, order) | 1 |
| Deliverable 3 (every producer) | 2, 3, 4, 5, 7 |
| Deliverable 4 (hook side) | 6, 7 |
| Deliverable 5 (typed `--repo` untouched) | 2–5 (AC6 rows) |
| Deliverable 6 (normalized host everywhere) | 1, 2–5 (AC7 rows) |
| Deliverable 7 (tests) | 1, 2–8 |
| AC1 gate unit cases | 1 |
| AC2.1 refusal per CLI; AC3.1 no bare fallback | 2–5 |
| AC4.1 pass-through | 2–5 |
| AC5.1 other `GH_HOST` | 2–5 |
| AC6.1 typed `--repo` | 2–5 |
| AC7.1, AC7.2 normalization | 2–5 |
| AC8 hook side + pack | 6, 7 |
| AC9 ORIGIN_GATED | 8 |
| AC10.1 named suites + `npm test` | 9 |
| Gotcha: new failure word readers | 6 |
| Gotcha: `repoSpecOf` `ssh://` fallback untouched | 6 |
| Gotcha: #4806 rebase on fetch-sub-issues.js | 4 (re-check `git log origin/main -- plugin/bin/fetch-sub-issues.js` before editing) |
| Gotcha: exit codes kept per CLI | 2–5 (exit 2 everywhere, verified per CLI against its existing `could not resolve owner/repo` return) |
