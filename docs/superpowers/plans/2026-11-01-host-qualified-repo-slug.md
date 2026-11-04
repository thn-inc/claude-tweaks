# Host-qualified origin repo slug Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every origin-derived repo that reconcile, the claim store and `stale-claim-pr.js` hand to `gh` goes through #4933's origin-host gate (`gateOriginRepo`, ADR 0030). On a GitHub Enterprise origin those `gh` calls reach the origin's host, and each command takes its `--repo` and its PR-url host from one resolved host value. A refused origin (an SSH alias or an unknown host) makes no `gh` call and reports `unknown-host` with the gate's refusal text, and that text tells an SSH-alias user to set `GH_HOST` to the real host, never to the alias name. On a github.com origin, every argv and env stays byte-identical, whether or not `GH_HOST` is exported (round 5, Q1). The gate reads an origin the way the seam does (userinfo, port and `ssh://` scheme dropped), so a credentialed, ported or `ssh://` `*.ghe.com` origin reaches one host on every path. An exported but empty `GH_HOST` is unset on every path, `ghOptions` included (round 5, Q2). claim-targets refuses a gated origin with `unknown-host` like every other gated path.

**Architecture:** `repo-resolve.js` gains `resolveRepoTarget({ owner, repo, explicitHost, originHost }, deps)`, the one host resolver: a typed host-qualified `--repo` host, else a non-empty exported `GH_HOST`, else the caller's origin host, else `github.com`. It returns `{ host, ghRepo }`, `ghRepo` being the `--repo` value: bare whenever the host equals gh's default host (a non-empty exported `GH_HOST`, else github.com), host-qualified otherwise. `gateOriginRepo` judges `parseRepo(hostPathOf(remote))` (Task 1), and `ghOptions`/`explicitRepoGhHost` read an empty `GH_HOST` as unset (Task 17). `git-exec.js` gains `repoTargetOf(repoRoot, gateDeps)` on top of the already-gated `repoSpecOf`: `null`, `{ refusal }`, or `{ owner, repo, slug, host, ghRepo }` (`slug` stays the bare `owner/repo` for `repos/…` paths, GraphQL pairs and slug comparisons). `repoSlugOf` is retired once no caller remains. The gate's refusal text gains SSH-alias advice. release-merged, archive-merged, reap-merged, pr-state, prune-remote, archive-branches and sibling-sessions move onto `repoTargetOf` and report a refusal as `unknown-host` with the refusal text; residue escalation carries a refused origin as a `{ refusal }` residue repo that escalates nothing. `claim-store.js`'s listing and matching take one `{ host, ghRepo }` target; claim-targets gates its origin first (a refusal exits 2, `unknown-host`, before any gh call) and builds the target from the gh seam's host, and `stale-claim-pr.js` builds it from the gate (origin) or a typed `--repo`. The agent-composed `stale-claim-pr.js` calls drop `--repo`, with one `{host}` definition for the fallback, github.com when origin does not parse. post-merge and teardown already refuse through the gate on main; this plan pins the SSH-alias case there. Task 18 updates the claim-targets exit-2 prose and the gate's CLI roster.

**Tech Stack:** Node 18+ CommonJS under `plugin/bin/`, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-11-04T061219-record-4794/work/4794-spec.md` (record #4794)

**Scope keywords:** repoSlugOf, repoSpecOf, openPrListArgs, isSameRepoPrUrl, staleClaimInFlightPr, tombstoneInFlightPr, matchStaleClaimPr, ghApiDelete

## Global Constraints

- A github.com origin keeps argv and env byte-identical to today on every migrated call (spec AC2), whether or not `GH_HOST` is exported (spec round 5, Q1). Keep `--repo acme/widgets` bare, add no `--hostname`, and inject no `GH_HOST`. With `GH_HOST` exported the `--repo` value stays bare too: gh sends a bare `-R` to `GH_HOST`, so the host reached is unchanged, and the PR-url match uses that same `GH_HOST` host.
- **One host rule (spec round 3, Q1, Reading B — ADR 0030 wins).** Every origin-derived repo this plan touches goes through `gateOriginRepo` (`plugin/bin/lib/repo-resolve.js`), reached through `repoSpecOf`/`repoTargetOf` in `plugin/bin/lib/hooks/git-exec.js` or, in `stale-claim-pr.js`, called directly. The gate passes github.com, a `*.ghe.com` host, a gh `hosts.yml` key, or anything when a non-empty `GH_HOST` is exported. Everything else, an SSH alias (`git@github-work:acme/widgets.git`) included, is a refusal, and a refused path makes **no** `gh` call. Do not revert or weaken #4933's gate, and add no bare-slug fallback for a refused host (ADR 0030's rejected alternative).
- **Refused origin reports `unknown-host` with the refusal text (spec round 4, Q1, Reading B).** None reports `no-repo-slug`, `repo-slug-unresolved` or `network-failure` for a gated origin. Per path:
  - release-merged: `{ failure: 'unknown-host', detail: <refusal> }` before any gh call; reconcile's release skip carries `detail` (Tasks 4, 8).
  - archive-merged record check: per-run skip `reason: 'unknown-host'`, `hint: <refusal>` (the existing per-run remedy field that `skippedEntry` and `reconcile/index.js` already carry). `unknown-host` joins `STRUCTURALLY_STUCK_REASONS` (Task 5).
  - archive and reap residue escalation/resolution: the residue repo is `{ refusal }`, and escalate-residue returns `escalation-failed`/`resolution-failed` with `reason: 'unknown-host'` and `detail`, with no gh call; cache.js records `unknown-host (<refusal>)` (Tasks 3, 5).
  - pr-state's bulk screen: `'unknown-host'` with no spawn (Task 6). prune-remote: check failure `unknown-host` with `detail` (Tasks 7, 8). archive-branches: per-branch skip `unknown-host` with `detail`, and its gh-independent tag-aging sweep still runs (Task 7).
  - sibling-sessions' claim reader: the contents-API leg fails `unknown-host` with `detail`, no request (Task 9).
  - stale-claim-pr.js: stderr `stale-claim-pr.js: {refusal}` and the verdict `{"match":false,"link":null,"failure":"unknown-host: {refusal}"}`, exit 0, no claim read, no gh call (Task 13).
  - claim-targets.js (spec round 5, "No claim-targets exception"): stderr `claim-targets: unknown-host — {refusal}`, exit 2 (its existing "non-timeout repo-slug resolution failure" code, a hard stop at `/flow` Step 2.8), with or without `--keep-going`, before slug resolution: no gh call, no claim read or write, no label, no claim-log line (Task 12).
  - post-merge already returns `unknown-host` + `detail` (#4933); pinned in Task 15. teardown prints `remote ref: skipped — {refusal}`: it is a hook line with no reason vocabulary, like every other line it prints, so it keeps that form (pinned in Task 15).
  - A genuinely absent or unparseable origin keeps `no-repo-slug` / `no-remote` / `network-failure` / `repo-slug-unresolved` exactly as today.
  - pr-state's `prNotFoundProbeArgs` is a confirm-after-failure probe: a refused origin confirms nothing and spawns nothing, so the by-number resolver returns what its own seam call returned. The by-number resolvers' primary `gh pr view N` infers its repo through gh itself (the seam), not from an origin-derived slug, so they do not gain an `unknown-host` word in this record.
- **Alias advice (spec round 4, Q1).** Fixed once, in `gateOriginRepo`'s refusal text (Task 1). An HTTPS remote keeps today's text byte-identical. An scp-style SSH remote whose host is not DNS-shaped is an SSH alias: the text says to export `GH_HOST` as the real host the alias maps to (e.g. `export GH_HOST=github.com`) and never names the alias as the value. An scp-style SSH remote with a DNS-shaped host could be either, so the text names both cases, the alias case without the alias name as a value.
- **One host per command (spec round 4, Q2 and "Whole family").** Any command that both calls `gh` and compares a host takes both from one `resolveRepoTarget` result, never from two separately derived values. Precedence: a typed host-qualified `--repo` host, then a non-empty (after `trim()`) exported `GH_HOST`, then the caller's origin host, then `github.com`. A bare typed `--repo owner/repo` therefore means github.com only when `GH_HOST` is unset or empty. The `--repo` value is host-qualified only when that host differs from gh's default host (round 5, Q1), so the listing's argv stays today's whenever gh already reaches the host. Split sites found at planning time and fixed here: claim-targets (Task 12) and stale-claim-pr.js (Task 13) listing vs matching, and the MCP/tidy prose `{host}` (Task 14). Sweep run for others (`git grep -n -l -F -e 'github\.com' -e 'github\\.com' -e isSameRepoPrUrl -- plugin/bin`, which matches both the regex-literal and the string-escaped spellings): claim-store.js and stale-claim-pr.js (fixed here), mcp-pr-shape.js (a comment), the statusline's and `release-local/changelog.js`'s origin parses and `release-preflight/pack.js`'s bot-email test (no host compared against a gh call), `wrap-up/engine-verify.js`'s `upstream-feedback` check (already one fixed host, github.com, for both its URL regex and its `repoSlug`), and `plugin/bin/lib/log-decision/claim-log.js`'s `resume-pr:` regex. claim-log.js reads `decisions.md` and calls no `gh`, so it is not a split site under the rule; its github.com-only `resume-pr` shape is filed as a backlog record at wrap-up (`/claude-tweaks:capture`, spec-shaped body), not fixed here. If the build finds another split site, it applies the rule there without asking (spec).
- An exported but empty (or whitespace-only) `GH_HOST` is treated as unset on every path (spec minor ruling and round 5, Q2): the gate and `resolveRepoTarget` already do, and Task 17 changes `ghOptions` and `explicitRepoGhHost` (#4505) to match, so one reconcile pass never splits across hosts. Every host comparison goes through `normalizeHost` (case-insensitive, trailing dots ignored).
- **One origin read (the reviewer's high defect, spec "Review defects").** The seam reads origin as `parseRepo(hostPathOf(url))`; the gate read `parseRepo(remote)`, which rejects a `*.ghe.com` origin with userinfo (`https://oauth2@acme.ghe.com/acme/w.git`), a port, or an `ssh://` scheme, so `repoTargetOf` fell back to github.com while the seam injected `GH_HOST=acme.ghe.com`. Task 1 makes the gate judge the normalized read too. It only ever admits more: an origin that only the normalized read parses, on a host the gate would refuse, keeps today's unparseable verdict (`{ spec: null, refusal: null }`) and so `repoSpecOf`'s #4857 fallback. No remote that parses as unreadable today becomes a refusal, so a cloud sandbox's proxy remote keeps its exit-3 / `--repo` re-run path. The ~20 other gated CLIs (`git grep -n -l gateOriginRepo -- plugin/bin`) gain the same admission for those remote shapes; their tests hold no gated `ssh://` or userinfo origin (`git grep -n -e 'ssh://' -e '@acme' -e 'oauth2@' -- tests`: `tests/hooks-git-exec.test.js` :471 (kept) and :477 (flipped) in Task 1; every other hit is the seam's own cases in `tests/bin-lib/repo-resolve.test.js` :269-395, which this does not change, or a suite whose parser is not the gate — `pr-state-batch`, `release-local`, `statusline`, `packet-render`, `acceptance-packet-contract-conformance`).
- **Explicit `--repo` (spec round 2):** a typed host-qualified `--repo` on `stale-claim-pr.js` is trusted for any host and is not gated (ADR 0030: "A user-typed `--repo` is not gated"). No agent-composed call relies on a bare `--repo` (spec round 3, Q2).
- A remote neither read parses into an admitted spec (`ssh://git@git.corp.invalid/…`, a local path) keeps `repoSpecOf`'s #4857 fallback (owner/repo parsed, host unknown): its target host is `GH_HOST` or github.com, which is also where the seam sends it, so the pass does not split. #4857 owns that case; this plan pins it.
- ADR 0030: "Every new producer that derives a host from origin must call `gateOriginRepo`". `stale-claim-pr.js` moves onto the gate (Task 13), with `tests/gh-host-seam-conformance.test.js`'s rosters. claim-targets (spec round 5) calls the gate to refuse only: its repo still comes from `gh repo view` and its host from the gh seam's `resolveGhHost(cwd)` (positive signals only, #4854), the same host its inferred calls already reach, and for an admitted origin that is the gate's host too (both read `hostPathOf`). It joins `ORIGIN_GATED` but not `CLI_TABLE` in `tests/gh-host-seam-behavior.test.js`: that table's AC4.1/AC5.1/AC7 cases assert an origin-derived slug in the argv, which claim-targets never sends, so Task 12 pins its refusal in dedicated cases instead (the gh-api-module-pattern skill's "joins both" rule assumes an origin-derived repo).
- Every `gh` spawn keeps routing its options through `repo-resolve.js`'s `ghOptions(args, …)`, with the site's `timeout`/`stdio`/`maxBuffer`/`windowsHide` literal inside that options object (`tests/gh-host-seam-conformance.test.js`).
- Governing skill `.claude/skills/gh-api-module-pattern/SKILL.md`, quoted verbatim:
  - "**Every `gh` spawn wraps its options in `plugin/bin/lib/repo-resolve.js`'s `ghOptions(args, …)`.** The seam injects `GH_HOST` for a GitHub Enterprise origin, so a spawn that skips it sends its call to github.com (#4505). Wrap the site's own options object and keep its `timeout`, `stdio`, `maxBuffer` and `windowsHide` literal inside it"
  - "**A `--repo` argument is a *slug*, and the slug is host-qualified — never hand-roll `` `${owner}/${repo}` `` at one.**"
  - "Give each call one owner for its host, and assert the flag count as well as its position."
- Governing skill `.claude/skills/bin-source-scan-conformance/SKILL.md` names `tests/gh-host-seam-conformance.test.js` as the scan these files must keep passing. No new spawn shape is added.
- Governing skill `.claude/skills/skill-prose-conformance-tests/SKILL.md` (Task 14 retargets prose pins), quoted verbatim: "**Retargeting existing pins: diff the assertion inventory, not the plan's prose anchor list.** When a migration moves pinned prose from one file to another, enumerate every assertion literal in the *replaced* tests and give each one an explicit verdict — moved, retargeted (naming the new literal), or retired (with its own stated reason)."
- `.claude/skills/claim-targets-stop-addition/SKILL.md` applies in part: no exit code is added, but Task 12 adds a new cause to the existing exit 2 ("a non-timeout repo-slug resolution failure"), a run-level stop that returns directly with or without `--keep-going`. Rows taken: 1 (the stop, `USAGE`'s exit-2 line, Task 12), 2 (the header's exit list, Task 12), 4 (`flow/claim-targets.md`'s exit-2 bullet and its transport limit, Task 18), 7 (`docs/plugin-structure.md`'s command line, Task 18; the journey and the gh-api-module-pattern skill restate no claim-targets exit-2 cause: `git grep -n -E 'claim-targets.{0,80}exit 2|exit 2.{0,80}claim-targets' -- docs/journeys .claude/skills` prints nothing). Not taken, with the decisions: exit 2 already stops `/flow` before the Manifesto (row 5's Step 2.8 sentence, "else a hard stop", stays true); it fires before any claim read or write, so "never claimed" holds for a singleton and for a bundle alike (the gate runs once, before the first target) and Settle's existing exit-2 handling, the release call and Section E need nothing (rows 8, 11); the record is not at fault and the cause is the repo's origin, which every record of the repo shares, but `preflight-records.js` already exits 2 on the same refusal under `work-links: native` (`/flow` Step 2.7b) with no firing-stop wiring, so this stop follows that precedent (rows 10, 12, 13 not taken); it carries no forge text (decision 6); the gh-absent MCP claim procedure does not reach it, stated in row 4's bullet (decision 2). `.claude/skills/mcp-agent-fetch-node-compute/SKILL.md` covers `stale-claim-pr.js --listing`; `normalizePrListing` is not changed.
- Every in-process test that reads the gate or the seam deletes `GH_HOST`, calls `_resetGhHostCache()` before and after the case (`withoutGhHost(t)` in `tests/gh-host-seam-behavior.test.js`), and passes `gateDeps: { env: {}, readFile: () => { throw new Error('ENOENT'); } }` (or points `GH_CONFIG_DIR` at a temp dir it controls) so the developer's own `~/.config/gh/hosts.yml` and `GH_HOST` cannot change the verdict. Child-process cases build their env the way `runGated` does (no `GH_HOST`, an empty per-case `GH_CONFIG_DIR`, `GIT_ALLOW_PROTOCOL=file`).
- Fixture sweep for origins the gate now refuses (`git grep -n -o -E "'(https?://|git@)[^' ]+'" -- tests/bin-lib/reconcile tests/reconcile.test.js tests/hooks-sibling-sessions.test.js`): every reconcile-module fixture uses `git@github.com:acme/w.git` or a local path, except `https://example.invalid/…` in `tests/bin-lib/reconcile/prune-remote.test.js` :316 (fixed in Task 7) and in `tests/reconcile.test.js` :148, :1426, :2360, :3850, which run only mirror or origin-head (no gated check) and stay unchanged.
- A test that compares a refusal compares it to the gate's own string computed in the test (`gateOriginRepo(remote, gateDeps).refusal`), never a hand-copied literal, except Task 1's exact-copy pins.
- Rail (`RAIL_BYTES` 52500, `plugin/bin/lib/skill-audit/budgets.js`), measured on this tree: `plugin/skills/tidy/scan-procedures.md` 52447 bytes (53 headroom), `plugin/skills/_shared/issue-claims.md` 50800 bytes by `wc -c` (plan-audit's rail measurement, `when:` lines stripped: 50191). The composed `claims` bundle that draws on issue-claims.md measures 50338 at its four call sites (`dispatch/task-prompt.md` :107/:109, `flow/claim-targets.md` :223, `tidy/scan-procedures.md` :212). Task 14 keeps each file at or below today's size, so neither the files nor that bundle grow; check `wc -c` after the edit and trim words in the same paragraphs, never elsewhere. Task 18 edits `plugin/skills/flow/claim-targets.md` (39278 bytes, 13222 headroom) and no other governed-corpus file.
- Empty-`GH_HOST` fixture sweep (Task 17, `git grep -n -F -e "GH_HOST: ''" -- tests`): `tests/helpers/git-fixtures.js` :114, `tests/bin-lib/phase-exit/phase-exit.test.js` :777, `tests/merge-verification.test.js` :220 and `tests/resolve-policy-cli.test.js` :377 set it only to mask a developer's own `GH_HOST`, over local-path or github.com origins where the seam injects nothing either way: unchanged. The three `tests/bin-lib/repo-resolve.test.js` pins of "empty wins" (:157-163 `AC4.1`, :309-314 `explicitRepoGhHost AC4`, :330-338 `#4795 … empty string included`) flip in Task 17, each with its own verdict there.

## Review Focus

1. **SSH host-alias origin** (`git@github-work:acme/widgets.git`): the refusal tells the user `export GH_HOST=github.com`-style advice and never `GH_HOST=github-work` (Task 1); release, archive, reap, pr-state, prune-remote, archive-branches, sibling-sessions, stale-claim-pr.js, post-merge and teardown make no gh call and report `unknown-host` with that text (Tasks 4-9, 13, 15).
2. **`GH_HOST` exported:** a non-empty value is the host for both the listing and the PR-url match (claim-targets, stale-claim-pr.js), including over a GHE origin and over a bare typed `--repo`; a typed host-qualified `--repo` beats it; an empty value is no opt-in (Tasks 2, 11, 12, 13).
3. **Host-qualified value leaking into a comparison or path:** on a GHE origin, archive-merged's record check (`prClosesIssue` against `closingIssuesReferences`, which carry a host-less `owner/repo`), release-merged's `repos/…` paths and pr-state's GraphQL `owner`/`name` must still see the bare slug (Tasks 4, 5, 6).
4. **`process.cwd()` outside the repo root:** release-merged's calls follow the root's origin (Task 4).
5. **Cross-host and look-alike PR urls:** under host `acme.ghe.com`, `https://github.com/acme/widgets/pull/1` and `https://acmeXghe.com/acme/widgets/pull/1` are rejected, while `https://ACME.ghe.com./acme/widgets/pull/1` is accepted (Task 11).
6. **A refused origin never loops through escalation:** a structurally-stuck `unknown-host` run escalates through a `{ refusal }` residue repo that files nothing and calls no gh (Tasks 3, 5).
7. **`GH_HOST` exported on a github.com origin (round 5, Q1):** every `--repo` stays bare (`acme/widgets`); only the PR-url match host follows `GH_HOST` (Tasks 2, 12, 13).
8. **One origin read (round 5 review defect):** `https://oauth2@acme.ghe.com/…`, `https://acme.ghe.com:8443/…` and `ssh://git@acme.ghe.com/…` reach `acme.ghe.com` on both the gate's and the seam's paths in one pass, and no remote that is unparseable today becomes a refusal (Tasks 1, 2, 16).
9. **Empty `GH_HOST` on a GHE origin (round 5, Q2):** `ghOptions` injects the seam host over the empty value, so release-merged and residue escalation reach the same host (Task 17).
10. **claim-targets on an SSH-alias origin:** exit 2, `unknown-host` with the alias advice, and no gh call at all (Task 12).

---

### Task 1: SSH-alias advice in the gate's refusal text, and the gate's normalized origin read

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/repo-resolve.js` (`gateOriginRepo` :137-157, the refusal at :153-156; the header :12-17)
- Modify: `docs/decisions/0030-unknown-origin-hosts-are-refused-not-degraded.md` (the Decision paragraph at :33-35, the Consequences bullet :76-77)
- Test: `tests/bin-lib/repo-resolve.test.js` (`refusalOf` :443, `review focus 4` :483-485), `tests/hooks-git-exec.test.js` (the #4933 refusal test :443-454, the `ssh://` tests :471-481)

**Interfaces (normalized read, the reviewer's high defect):**
- `gateOriginRepo(remote, deps)` keeps its signature. It reads origin twice: `const parsed = parseRepo(remote);` (today's read, the only `parseRepo(` call naming `remote`, so `tests/gh-host-seam-conformance.test.js`'s `NOT_ORIGIN` count for this file stays 1) and `const hostPath = hostPathOf(remote); const normalized = parseRepo(hostPath);` (the seam's read; `hostPathOf` is already in this file). Then: `!normalized` → `{ spec: null, refusal: null }`; `host = normalizeHost(normalized.host)`; a non-empty `GH_HOST` → `{ spec: { ...normalized, host: <as today> }, refusal: null }`; github.com or `isKnownGhHost` → `{ spec: { ...normalized, host }, refusal: null }`; **`!parsed` → `{ spec: null, refusal: null }`** (an origin only the normalized read parses, on a host that would be refused, keeps today's unparseable verdict: never a new refusal); otherwise the refusal below. The header comment (:12-17) gains one sentence naming the two reads and that rule.

**Interfaces (alias advice):**
- Produces: `gateOriginRepo(remote, deps)` keeps its signature and return shape. Its refusal, with `host` the normalized host and `PREFIX` = `` `origin host ${host} is not a known GitHub host (not github.com, not *.ghe.com, not a gh hosts.yml key) — refusing to send it to gh` ``:
  - not scp-style (HTTPS, `host/owner/repo`): `` `${PREFIX}; if it is GitHub Enterprise, export GH_HOST=${host}` `` (today's text, byte-identical).
  - scp-style and the host is not DNS-shaped (an SSH alias): `` `${PREFIX}; it looks like an SSH host alias, so export GH_HOST as the real host the alias maps to (e.g. export GH_HOST=github.com), not the alias name` ``.
  - scp-style and the host is DNS-shaped: `` `${PREFIX}; if it is GitHub Enterprise, export GH_HOST=${host}; if it is an SSH host alias, export GH_HOST as the real host it maps to instead (e.g. export GH_HOST=github.com)` ``.
- scp-style: the trimmed remote matches `/^(?:[^@\s/:]+@)?[^@\s/:]+:(?!\/)/`. DNS-shaped: the normalized host matches `/\.(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/` or is a dotted IPv4 address (`/^\d{1,3}(?:\.\d{1,3}){3}$/`). Two small module-private helpers; header comment on `gateOriginRepo` states the three texts and why (an SSH alias resolves only through `~/.ssh/config`, so its name is never a gh host; `github.com-work` is the common dotted alias shape and its last label is not a TLD).

- [ ] **Step 1: Write the failing tests**
  - `tests/bin-lib/repo-resolve.test.js`: keep `refusalOf` (the HTTPS text) and add `aliasRefusalOf(host)` and `sshDottedRefusalOf(host)` built from the copy above. New tests:
    - `test('#4794: an scp-style SSH alias origin is told to export GH_HOST as the real host, never the alias name', …)`: for `git@github-work:o/r.git`, `github-work:o/r.git` and `git@github.com-work:o/r.git`, `gateOriginRepo(remote, noHosts)` deep-equals `{ spec: null, refusal: aliasRefusalOf(<host>) }`, the refusal matches `/export GH_HOST=github\.com/` and does not match `new RegExp('GH_HOST=' + escaped host)`.
    - `test('#4794: an scp-style origin on a DNS-shaped unknown host names both the GHE and the alias opt-in', …)`: `git@git.corp.invalid:o/r.git` → `sshDottedRefusalOf('git.corp.invalid')`; `git@10.0.0.5:o/r.git` → `sshDottedRefusalOf('10.0.0.5')`.
    - `test('#4794: an HTTPS origin keeps the refusal text byte-identical, a dotless HTTPS host included', …)`: `https://git.corp.invalid/o/r.git` → `refusalOf('git.corp.invalid')`; `https://github-work/o/r.git` → `refusalOf('github-work')` (an HTTPS host is never an SSH alias).
    - Change `review focus 4` (:483-485) to expect `sshDottedRefusalOf('git.corp.invalid')`.
  - `tests/hooks-git-exec.test.js`: add `test('repoSpecOf (#4794): an SSH-alias origin returns { refusal } advising the real host, never the alias', …)`: origin `git@github-work:acme/w.git`, the test's `gateDeps` → `Object.keys(got)` is `['refusal']`, `got.refusal` matches `/origin host github-work is not a known GitHub host/` and `/export GH_HOST=github\.com/`, and does not match `/GH_HOST=github-work/`. The existing :443-454 loop keeps passing unchanged (its scp origin is DNS-shaped and still names `export GH_HOST=git.corp.invalid`).
  - `tests/bin-lib/repo-resolve.test.js`, normalized read: `test('#4794: the gate reads a credentialed, ported or ssh:// origin the way the seam does', …)` with `noHosts` (`env: {}`, throwing `readFile`): for `https://oauth2@acme.ghe.com/acme/w.git`, `https://x:tok@acme.ghe.com/acme/w.git`, `https://acme.ghe.com:8443/acme/w.git`, `ssh://git@acme.ghe.com/acme/w.git` and `ssh://git@acme.ghe.com:22/acme/w.git`, `gateOriginRepo(url, noHosts)` deep-equals `{ spec: { host: 'acme.ghe.com', owner: 'acme', repo: 'w' }, refusal: null }` and `gateOriginRepo(url, noHosts).spec.host === resolveGhHost('/n-' + i, { ...ghe, remoteUrl: () => url })` (one host for the gate and the seam; `_resetGhHostCache()` per url); `ssh://git@github.com/acme/w.git` → `spec.host === 'github.com'`; `ssh://git@git.corp.invalid/acme/w.git`, `https://oauth2@git.corp.invalid/acme/w.git` and `ssh://git@github-work/acme/w.git` → `{ spec: null, refusal: null }` (never a new refusal); the same unknown-host `ssh://` url with `env: { GH_HOST: 'git.corp.invalid' }` → `spec.host === 'git.corp.invalid'`. No `refusal` string in any case carries `oauth2`, `tok` or `8443`.
  - `tests/hooks-git-exec.test.js`, the `ssh://` pins: :471 (`ssh://git@git.corp.invalid/acme/w.git` → the loose fallback `{ host: null, owner: 'acme', repo: 'w' }`) is **kept** unchanged, its title gaining "(never a refusal, #4794)"; :477 (`ssh://git@github.com/acme/w.git`) is **flipped**: `repoSpecOf(repo)` now deep-equals `{ host: 'github.com', owner: 'acme', repo: 'w' }` (the gate reads it), retitled `repoSpecOf (#4794): an ssh:// github.com origin is read by the gate, host github.com`; its `repoSlugOf(repo) === 'acme/w'` line stays until Task 10.

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test tests/bin-lib/repo-resolve.test.js tests/hooks-git-exec.test.js`
Expected: FAIL after Step 1 — the alias cases get today's `export GH_HOST=github-work` text, `review focus 4` gets the HTTPS text, every admitted normalized-read case gets `{ spec: null, refusal: null }`, and the flipped :477 case gets `host: null`. The never-a-new-refusal cases pass before and after; after Step 3, prove them able to go red by temporarily deleting the `!parsed` line, see them get a refusal, then restore.

- [ ] **Step 3: Implement** the normalized read and the three texts in `gateOriginRepo`. Then add one sentence to ADR 0030's Decision paragraph after "naming the host and the `export GH_HOST={host}` opt-in": an scp-style SSH origin whose host is not DNS-shaped (an SSH alias) is instead told to export `GH_HOST` as the real host the alias maps to, never the alias name, and a DNS-shaped scp host gets both opt-ins (#4794). Reword the Consequences bullet :76-77 to: "The gate reads origin the way the seam does (userinfo, port and scheme dropped, #4794), so a credentialed, ported or `ssh://` origin on a passing host passes. A remote only that read parses, on a host that would be refused, is not turned into a refusal here; #4857 owns that case." Behavior-change prose sweep (`git grep -n -e 'GH_HOST={host}' -e 'GH_HOST=<host>' -- plugin docs .claude ':!docs/superpowers/plans'`): every other hit (`.claude/skills/driver-skill-outcome-taxonomy/SKILL.md`, `docs/journeys/opt-in-an-unknown-origin-host-with-gh-host-4933.md`, `docs/journeys/review-backlog-attention-queue.md`, `docs/journeys/run-a-pipeline-on-a-ghe-origin-without-gh-host-4505.md`, `docs/plugin-structure.md` :140/:197/:231, `docs/reconcile-checks.md` :599, `plugin/bin/materialize.js`, `post-merge-run.js`, `release-claim.js`, `repair-claim.js`, `stuck-open-prs.js`, `plugin/skills/backlog/attention-mode.md`) describes the opt-in for an HTTPS or DNS-shaped unknown host, which both texts still name: no change (the spec fixes the advice "once, in the shared gate refusal text").

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/bin-lib/repo-resolve.test.js tests/hooks-git-exec.test.js tests/gh-host-seam-behavior.test.js tests/bin-lib/reconcile/post-merge.test.js tests/reconcile.test.js tests/hooks-teardown-run.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/repo-resolve.js docs/decisions/0030-unknown-origin-hosts-are-refused-not-degraded.md tests/bin-lib/repo-resolve.test.js tests/hooks-git-exec.test.js
git commit -m "Read origin the seam's way in the gate and advise the real host, never the alias name (refs #4794)"
```

### Task 2: `resolveRepoTarget` and `repoTargetOf`

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/repo-resolve.js` (add `resolveRepoTarget`, export it at :290-294)
- Modify: `plugin/bin/lib/hooks/git-exec.js` (add `repoTargetOf` after `repoSpecOf` :215-231, export it at :233; extend the `require('../repo-resolve')` at :15 with `resolveRepoTarget`)
- Test: `tests/bin-lib/repo-resolve.test.js`, `tests/hooks-git-exec.test.js`

**Interfaces:**
- Produces: `resolveRepoTarget({ owner, repo, explicitHost = null, originHost = null }, deps = {}) -> { host: string, ghRepo: string }`. `env = deps.env || process.env`; `ghHost = String(env.GH_HOST || '').trim()`. `host` is the first of: `normalizeHost(explicitHost)` when `explicitHost` is non-empty; `normalizeHost(ghHost)` when `ghHost` is non-empty; `normalizeHost(originHost)` when `originHost` is non-empty; `'github.com'`. `defaultHost = ghHost ? normalizeHost(ghHost) : 'github.com'` (gh's own default host for a bare `-R`). `ghRepo` is `` `${owner}/${repo}` `` when `host === defaultHost`, else `` `${host}/${owner}/${repo}` `` (spec round 5, Q1: a bare `-R` already reaches `defaultHost`, so qualifying it would change a github.com origin's argv under an exported `GH_HOST` for no change in the host reached). Never reads origin.
- Produces: `repoTargetOf(repoRoot: string, gateDeps?) -> { owner, repo, slug, host, ghRepo } | { refusal: string } | null`. Calls `repoSpecOf(repoRoot, gateDeps)`: `null` → `null`; `{ refusal }` → `{ refusal }` (same text); otherwise `slug = \`${owner}/${repo}\`` and `{ host, ghRepo } = resolveRepoTarget({ owner, repo, originHost: spec.host }, gateDeps || {})`. Header comment: the host comes only from the #4933 gate (or `GH_HOST`), so an SSH alias or unknown host is a refusal, never a bare slug.

- [ ] **Step 1: Write the failing tests**
  - `tests/bin-lib/repo-resolve.test.js`, `test('#4794: resolveRepoTarget — one host: typed --repo host, then GH_HOST, then the origin host, then github.com', …)` with `T = (o, env) => resolveRepoTarget({ owner: 'acme', repo: 'w', ...o }, { env })`:
    - `T({}, {})` → `{ host: 'github.com', ghRepo: 'acme/w' }`
    - `T({ originHost: 'ACME.ghe.com.' }, {})` → `{ host: 'acme.ghe.com', ghRepo: 'acme.ghe.com/acme/w' }`
    - `T({ originHost: 'acme.ghe.com' }, { GH_HOST: ' MINE.example. ' })` → `{ host: 'mine.example', ghRepo: 'acme/w' }` (the host is `GH_HOST`, gh's default, so the slug stays bare — round 5 Q1)
    - `T({ originHost: 'acme.ghe.com' }, { GH_HOST: '  ' })` → `{ host: 'acme.ghe.com', ghRepo: 'acme.ghe.com/acme/w' }` (empty is unset)
    - `T({ explicitHost: 'github.com' }, { GH_HOST: 'mine.example' })` → `{ host: 'github.com', ghRepo: 'github.com/acme/w' }` (a qualified `-R` beats `GH_HOST` in gh, so it must stay qualified)
    - `T({ explicitHost: 'mine.example' }, { GH_HOST: 'MINE.example' })` → `{ host: 'mine.example', ghRepo: 'acme/w' }`
    - `T({}, { GH_HOST: 'mine.example' })` → `{ host: 'mine.example', ghRepo: 'acme/w' }` (a bare typed `--repo` follows `GH_HOST` for matching, spec round 4 Q2, and keeps today's bare argv)
    - `T({ originHost: 'github.com' }, { GH_HOST: 'mine.example' })` → `{ host: 'mine.example', ghRepo: 'acme/w' }` (AC2 with `GH_HOST` exported: today's bare argv, round 5 Q1)
    - `T({ originHost: 'github.com' }, { GH_HOST: 'github.com' })` → `{ host: 'github.com', ghRepo: 'acme/w' }`
    - `T({ explicitHost: 'GHE.Example.com' }, {})` → `{ host: 'ghe.example.com', ghRepo: 'ghe.example.com/acme/w' }`
  - `tests/hooks-git-exec.test.js`, `test('repoTargetOf (#4794): …')` cases, each a temp repo with that origin and `gateDeps` (`env: {}` unless stated, `readFile` throwing unless stated):
    - `https://acme.ghe.com/acme/widgets.git` and `git@acme.ghe.com:acme/widgets.git` → `{ owner: 'acme', repo: 'widgets', slug: 'acme/widgets', host: 'acme.ghe.com', ghRepo: 'acme.ghe.com/acme/widgets' }`
    - `https://ACME.ghe.com./acme/widgets.git` → `host: 'acme.ghe.com', ghRepo: 'acme.ghe.com/acme/widgets'`
    - `https://ghe.example.com/acme/widgets.git` with `readFile` returning `'ghe.example.com:\n    user: x\n'` → `host: 'ghe.example.com'`; with `readFile` throwing → deep-equals `{ refusal: gateOriginRepo(url, gateDeps).refusal }`
    - `https://github.com/acme/widgets.git` and `git@github.com:acme/widgets.git` → `host: 'github.com', ghRepo: 'acme/widgets'`, `slug === 'acme/widgets'` and `slug === repoSlugOf(repo)` (AC2.1: the bare slug is unchanged)
    - `git@github-work:acme/widgets.git` → `{ refusal }` (Review Focus 1)
    - GHE origin with `env: { GH_HOST: 'mine.example' }` → `host: 'mine.example', ghRepo: 'acme/widgets'`; with `env: { GH_HOST: 'ACME.ghe.com' }` → `host: 'acme.ghe.com', ghRepo: 'acme/widgets'` (Review Focus 2, 7: gh's default host is `GH_HOST`)
    - `https://github.com/acme/widgets.git` with `env: { GH_HOST: 'mine.example' }` → `host: 'mine.example', ghRepo: 'acme/widgets'` (AC2 with `GH_HOST` exported, Review Focus 7)
    - `https://ghe.example.com/acme/widgets.git` with `env: { GH_HOST: '  ' }` → `{ refusal }`
    - `ssh://git@acme.ghe.com/acme/widgets.git`, `https://oauth2@acme.ghe.com/acme/widgets.git` and `https://acme.ghe.com:8443/acme/widgets.git` → `{ owner: 'acme', repo: 'widgets', slug: 'acme/widgets', host: 'acme.ghe.com', ghRepo: 'acme.ghe.com/acme/widgets' }` (Task 1's normalized read, Review Focus 8)
    - `ssh://git@git.corp.invalid/acme/widgets.git` → `{ owner: 'acme', repo: 'widgets', slug: 'acme/widgets', host: 'github.com', ghRepo: 'acme/widgets' }` (#4857's fallback, never a refusal)
    - no origin remote → `null`

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test tests/hooks-git-exec.test.js tests/bin-lib/repo-resolve.test.js`
Expected: FAIL after Step 1 with `repoTargetOf is not a function` / `resolveRepoTarget is not a function`

- [ ] **Step 3: Implement** both functions with the signatures above. `repo-resolve.js` does not require `git-exec.js`, so the import adds no cycle.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/hooks-git-exec.test.js tests/bin-lib/repo-resolve.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/repo-resolve.js plugin/bin/lib/hooks/git-exec.js tests/hooks-git-exec.test.js tests/bin-lib/repo-resolve.test.js
git commit -m "Add resolveRepoTarget and the gated repoTargetOf — one host per command (refs #4794)"
```

### Task 3: residue escalation reports a refused origin as `unknown-host`

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/reconcile/escalate-residue.js` (`findOrCreateIssue` :242-245, `findHitForResolve` :268-271, `escalateResidue` :349-353)
- Modify: `plugin/bin/lib/reconcile/cache.js` (`unresolvedReason` :292-295, `trackResidue`'s escalation-failed branch :371-373)
- Test: `tests/bin-lib/reconcile/escalate-residue.test.js` (`UNFILEABLE_STUCK_REASONS` :299-303), `tests/bin-lib/reconcile/cache.test.js`

**Interfaces:**
- Produces: a **residue repo** is `string` (the `--repo` value), `null` (no origin), or `{ refusal: string }` (a gated origin). Every intermediate residue function (`trackResidue`, `clearResidue`, `pruneResidueFailures`, archive-merged's and reap-merged's trackers) passes it through untouched; only escalate-residue reads it.
- escalate-residue: a module-private `refusalOf(repo)` returns `repo.refusal` when `repo` is an object whose `refusal` is a string, else null. `findOrCreateIssue` and `escalateResidue` return `{ status: 'escalation-failed', reason: 'unknown-host', detail: <refusal> }`, and `findHitForResolve` returns `{ status: 'resolution-failed', reason: 'unknown-host', detail: <refusal> }`, ahead of their `!repo` checks and before any runner call. The `!repo` → `no-repo-slug` lines stay for `null`.
- cache.js: a module-private `failureText(result)` = `result.detail ? \`${result.reason} (${result.detail})\` : result.reason`; `trackResidue` records `failureText(result) || 'status escalation-failed'`, and `unresolvedReason` returns `failureText(resolved) || \`status ${resolved.status}\``. `boundedError`'s 200-character bound still applies to the stored text.

- [ ] **Step 1: Write the failing tests**
  - `escalate-residue.test.js`: `test('#4794: a refused residue repo escalates and resolves nothing — unknown-host with the refusal, runner never called', …)`: with a recording runner, `escalateResidue({ repo: { refusal: 'R' }, reason: 'move-failed', targetPath: '/x/a', count: 3, runner })` and the same with `reason: 'structurally-stuck'` each deep-equal `{ status: 'escalation-failed', reason: 'unknown-host', detail: 'R' }`; `resolveResidue` for both reasons deep-equals `{ status: 'resolution-failed', reason: 'unknown-host', detail: 'R' }`; the runner saw zero calls. `escalateResidue({ repo: null, … })` still returns `reason: 'no-repo-slug'`. Add `'unknown-host'` to `UNFILEABLE_STUCK_REASONS`, extending its comment: a refused origin's escalation files nothing either (#4794).
  - `cache.test.js`: `test('#4794: a refused residue repo records unknown-host (refusal) on the escalate and resolve failures', …)`: drive `trackResidue(root, { refusal: 'R' }, 'move-failed', '/x/a', { failed: true, lastError: 'e' }, { runner })` with the real `escalateResidue` to `RESIDUE_ESCALATE_THRESHOLD` → the entry's `lastResidueError.reason === 'unknown-host (R)'` and the runner saw zero calls; an escalated entry on a gone path through `pruneResidueFailures(root, { refusal: 'R' }, { runner })` → `failures` deep-equals `[{ reason: 'move-failed', path: <path>, op: 'resolve', error: 'unknown-host (R)' }]`; `clearResidue` on an escalated entry with `{ refusal: 'R' }` leaves `lastResidueError.reason === 'unknown-host (R)'`.

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test tests/bin-lib/reconcile/escalate-residue.test.js tests/bin-lib/reconcile/cache.test.js`
Expected: FAIL after Step 1 — the runner is called with `--repo [object Object]` and the recorded errors lack `unknown-host`

- [ ] **Step 3: Implement** the guards and `failureText`, with a header note in escalate-residue naming the residue-repo type.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/bin-lib/reconcile/escalate-residue.test.js tests/bin-lib/reconcile/cache.test.js tests/bin-lib/reconcile/reap-merged.test.js tests/bin-lib/reconcile/archive-merged.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/reconcile/escalate-residue.js plugin/bin/lib/reconcile/cache.js tests/bin-lib/reconcile/escalate-residue.test.js tests/bin-lib/reconcile/cache.test.js
git commit -m "Escalate nothing through a refused origin and record unknown-host with its refusal (refs #4794)"
```

### Task 4: release-merged on the gate and the repo root's host

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/reconcile/release-merged.js` (`ghApi` :171, `ghRunner` :184, `ghApiAsync` :222, `releaseMerged` :348-361 and its `writeTombstone` call at :592; add `repoTargetOf` to the `require('../hooks/git-exec')` at :15)
- Test: `tests/gh-host-seam-behavior.test.js`, `tests/bin-lib/reconcile/release-merged.test.js`

**Interfaces:**
- Consumes: `repoTargetOf` (Task 2).
- `releaseMerged({ cwd, ghApi, prStates, gateDeps } = {})`: `const target = repoTargetOf(root, gateDeps);` `null` → today's `failure: 'no-remote'`; `target.refusal` → `{ released, skipped, failure: 'unknown-host', detail: target.refusal }`, before any gh call; else `const repoSlug = target.slug;` (bare, unchanged for `repos/…` paths).
- `ghApi(args, cwd?)`, `ghApiAsync(args, cwd?)`, `ghRunner(args, cwd?)`: a given `cwd` goes into the `ghOptions` options object as `cwd`; with none, behavior is unchanged. `releaseMerged` binds `root`: `api = ghApiOverride || ((a) => ghApi(a, root))`, `apiAsync = ghApiOverride ? … : ((a) => ghApiAsync(a, root))`, and passes `(a) => ghRunner(a, root)` as `writeTombstone`'s runner.
- `repoSlugOf` stays imported and re-exported until Task 10.

- [ ] **Step 1: Write the failing tests**
  - `tests/gh-host-seam-behavior.test.js`: install a `case`-style PATH stub that logs `GH_HOST` and argv, answers `api repos/*/git/trees/claims-registry*` with one claim entry, and answers the contents read, the issue-state read (`CLOSED`), the tombstone PUT and the label DELETEs with minimal valid JSON (model the claim blob on `release-merged.test.js`'s issue-closed release fixtures). Call `releaseMerged({ cwd: repo, gateDeps: { env: {}, readFile: () => { throw new Error('ENOENT'); } } })` in-process, `process.cwd()` left at this checkout:
    - `test('AC1.1: releaseMerged on a *.ghe.com origin sends every gh call to the origin host, whatever process.cwd() is', …)`: `assertEveryLineReaches(lines, 'acme.ghe.com')`, and the log holds the tree listing, the issue-state read, a `--method PUT` contents write and a `--method DELETE …labels/bot%3Ain-progress` call, so all three runners are reached (Review Focus 4).
    - `test('AC2.1: releaseMerged on a github.com origin leaves GH_HOST unset and argv unchanged', …)`: every network line starts `GH_HOST=unset `, and the tree-listing argv equals `api repos/acme/widgets/git/trees/claims-registry?recursive=1 -q {…}` exactly, the `-q` text copied from `claim-store.js`'s `listClaimEntries`.
  - `release-merged.test.js`: `test('#4794: an SSH-alias origin refuses before any gh call — failure unknown-host, detail the gate refusal', …)` with origin `git@github-work:acme/w.git`, a recording `ghApi` override and the throwing `readFile`: the result has `failure: 'unknown-host'` and `detail === gateOriginRepo('git@github-work:acme/w.git', gateDeps).refusal`, `detail` matches `/GH_HOST=github\.com/` and not `/GH_HOST=github-work/`, and the override saw zero calls.

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test tests/gh-host-seam-behavior.test.js tests/bin-lib/reconcile/release-merged.test.js`
Expected: FAIL after Step 1 — the GHE case logs `GH_HOST=unset` (the seam read `process.cwd()`), and the SSH-alias case reaches the override.

- [ ] **Step 3: Implement** the gate read, the `cwd` parameters and the `releaseMerged` bindings.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/gh-host-seam-behavior.test.js tests/bin-lib/reconcile/release-merged.test.js tests/reconcile.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/reconcile/release-merged.js tests/gh-host-seam-behavior.test.js tests/bin-lib/reconcile/release-merged.test.js
git commit -m "Gate release-merged's origin and bind its gh calls to the repo root's host (refs #4794)"
```

### Task 5: archive and reap on the gate — record check and residue repo

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/reconcile/archive-merged.js` (`decideArchiveCore` :470-509, `STRUCTURALLY_STUCK_REASONS` :1862-1884, `byNumberRecordSkip` :2206-2211, `archiveMergedRun` :2245-2275, `archiveMerged` :2368-2385 and its residue call sites: `track` :2407, every `finishArchiveAttempt` (:2441, :2457, :2496, :2604, :2681, :2709), `trackArchiveResult` :2525, `byNumberRecordSkip` calls :2675/:2702, both `archiveMergedRun` calls :2719/:2750, `pruneResidueFailures` :2776; drop `repoSlugOf` from the `require('./release-merged')` at :31)
- Modify: `plugin/bin/lib/reconcile/reap-merged.js` (:210 and its `trackReapResidue` calls :259/:285/:291; replace the `require('./release-merged')` at :29 with `repoTargetOf` from `../hooks/git-exec`)
- Test: `tests/gh-host-seam-behavior.test.js`, `tests/bin-lib/reconcile/archive-merged.test.js` (extend `fixtureOrdinaryMergedNoConsole` :3967-4018: `origin` accepts a URL string, `true` keeping today's `git@github.com:acme/w.git`, and a new `gateDeps` option forwarded to `archiveMerged`; reword the `repoSlugOf` comments at :2416 and :3961 to `repoTargetOf`, keeping each sentence's claim), `tests/bin-lib/reconcile/reap-merged.test.js`

**Interfaces:**
- Consumes: `repoTargetOf` (Task 2), the residue-repo contract (Task 3).
- `archiveMerged` gains an optional `gateDeps` (undefined in production): `const target = repoTargetOf(root, gateDeps); const repoRefusal = target && target.refusal ? target.refusal : null; const repoSlug = target && !repoRefusal ? target.slug : null; const residueRepo = repoRefusal ? { refusal: repoRefusal } : (target ? target.ghRepo : null);`
- Every residue-tracking argument (`track`/`trackStuckSkip`, `finishArchiveAttempt`, `trackArchiveResult`, `archiveMergedRun`'s `repoSlug:` field, `pruneResidueFailures`) gets `residueRepo`. Inside `archiveMergedRun` that parameter feeds only `trackArchiveResult`, so rename it `residueRepo` there.
- Record check: `recordCheck: { records, repoSlug, repoRefusal }`; `byNumberRecordSkip(root, dir, byNumber, consoleState, records, repoSlug, repoRefusal)` builds the same object. `decideArchiveCore`, after the empty-records return and before the `!recordCheck.repoSlug` line: `if (recordCheck.repoRefusal) return { action: 'skip', reason: 'unknown-host', hint: recordCheck.repoRefusal };` — `hint` already rides `skippedEntry` and `reconcile/index.js`'s archive mapping. `recordCheck.repoSlug` stays bare (Review Focus 3).
- Add `'unknown-host'` to `STRUCTURALLY_STUCK_REASONS`, with a comment beside the `no-repo-slug` one: it never self-resolves (the user must export `GH_HOST` or fix the origin), and its escalation goes through the `{ refusal }` residue repo, which files nothing and calls no gh (Review Focus 6).
- `reapMerged` gains an optional `gateDeps`: the same `target`/`residueRepo` derivation, `residueRepo` passed to every `trackReapResidue`.

- [ ] **Step 1: Write the failing tests**
  - `gh-host-seam-behavior.test.js`, archive (model on `archive-merged.test.js`'s "two dirs crossing the structurally-stuck threshold" test :2413: one stuck dir one short of `RESIDUE_ESCALATE_THRESHOLD`, `gateDeps: { env: {}, readFile: () => { throw new Error('ENOENT'); } }`, a recording `runner` answering `issue list` with `[]` and `issue create` with `https://acme.ghe.com/acme/widgets/issues/101`):
    - `test('AC1.1: archiveMerged on a *.ghe.com origin escalates structurally-stuck residue with --repo acme.ghe.com/acme/widgets', …)`: at least one call, and every argv holds `--repo`, `acme.ghe.com/acme/widgets` as adjacent elements, exactly once.
    - `test('AC2.1: archiveMerged on a github.com origin escalates with --repo acme/widgets', …)`.
    - `test('#4794: archiveMerged on an SSH-alias origin escalates nothing — the runner sees no call', …)`, origin `git@github-work:acme/widgets.git`.
  - Same file, reap (model on `reap-merged.test.js`'s "removal-failed … escalates once at the threshold" test :304: a locked worktree, `RESIDUE_ESCALATE_THRESHOLD` passes, `prStates: { byBranch: () => ({ number: 9, state: 'MERGED', mergedAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' }) }`, the same `gateDeps` and recording `runner`): `test('AC1.1: reapMerged on a *.ghe.com origin escalates removal-failed residue with the host-qualified --repo', …)`, its `AC2.1` github.com twin, and `test('#4794: reapMerged on an SSH-alias origin escalates nothing and records unknown-host', …)`: zero runner calls, and the `removal-failed` cache entry's `lastResidueError.reason` starts with `'unknown-host ('`.
  - `archive-merged.test.js`:
    - `test('#4794 Review Focus 3: on a *.ghe.com origin a merged run whose PR closes its record still archives (record check compares the bare slug)', …)`: `fixtureOrdinaryMergedNoConsole(…, { origin: 'https://acme.ghe.com/acme/w.git', closes: [<the run's record>], gateDeps })` and the helper's existing archived-with-`closes` assertions.
    - `test('#4794: an SSH-alias origin skips the record check unknown-host with the refusal as hint, never no-repo-slug', …)`: `{ origin: 'git@github-work:acme/w.git', closes: [3503], gateDeps }` → not archived, the skip's `reason === 'unknown-host'`, `hint === gateOriginRepo('git@github-work:acme/w.git', gateDeps).refusal`; with `staleMs: STRUCTURALLY_STUCK_TTL_MS * 2` the run accumulates a `structurally-stuck` residue entry (as the F3 test :4737 asserts for `no-repo-slug`).
    - `test('#4794 decideArchiveCore: a refused origin skips unknown-host ahead of no-repo-slug', …)`: `decideArchiveCore(<merged PR>, null, false, { records: [1], repoSlug: null, repoRefusal: 'R' })` deep-equals `{ action: 'skip', reason: 'unknown-host', hint: 'R' }`.
    - Extend `STRUCTURALLY_STUCK_REASONS includes …` (:4416) with `assert.ok(STRUCTURALLY_STUCK_REASONS.has('unknown-host'))`.

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test tests/gh-host-seam-behavior.test.js tests/bin-lib/reconcile/archive-merged.test.js tests/bin-lib/reconcile/reap-merged.test.js`
Expected: FAIL after Step 1 — the GHE escalation cases see `--repo acme/widgets`, the SSH-alias cases see a runner call, the alias record check skips `no-repo-slug`. The github.com cases and Review Focus 3 pass before the change; after Step 3, prove Review Focus 3 can go red by temporarily passing `residueRepo` into `recordCheck`, then restore.

- [ ] **Step 3: Implement** the derivations, the record-check refusal and the call-site argument changes.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/gh-host-seam-behavior.test.js tests/bin-lib/reconcile/archive-merged.test.js tests/bin-lib/reconcile/reap-merged.test.js tests/bin-lib/reconcile/escalate-residue.test.js tests/reconcile.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/reconcile/archive-merged.js plugin/bin/lib/reconcile/reap-merged.js tests/gh-host-seam-behavior.test.js tests/bin-lib/reconcile/archive-merged.test.js tests/bin-lib/reconcile/reap-merged.test.js
git commit -m "Gate archive's record check and archive/reap residue escalation on the origin host (refs #4794)"
```

### Task 6: pr-state's bulk screen and not-found probe on the gate

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/reconcile/pr-state.js` (`prNotFoundProbeArgs` :173-184, `resolvePrStatesBulk` :350-365 and its header; replace `repoSlugOf` in the `require('../hooks/git-exec')` at :25 with `repoTargetOf`)
- Test: `tests/bin-lib/reconcile/pr-state.test.js` (reword the `repoSlugOf` comment at :566 to `repoTargetOf`), `tests/gh-host-seam-behavior.test.js`

**Interfaces:**
- Consumes: `repoTargetOf` (Task 2).
- `resolvePrStatesBulk(repoRoot, branches, opts = {})` gains `opts.gateDeps`. With no `opts.repoSlug`: `const target = repoTargetOf(repoRoot, opts.gateDeps);` a refusal returns `'unknown-host'` with no spawn; `null` keeps `'network-failure'`; else `slug = target.slug`. The return vocabulary becomes `Map | 'gh-absent' | 'network-failure' | 'unknown-host'` (header updated). The GraphQL `-f owner=`/`-f name=` pair stays the bare split. Task 7 makes both callers pass `opts.repoSlug` after gating themselves.
- `prNotFoundProbeArgs(repoRoot, number)`: `const target = repoTargetOf(repoRoot);` `null` or a refusal returns `null` (no probe, no confirm). Comment: a refused origin confirms nothing, so the by-number resolver's own seam answer stands.

- [ ] **Step 1: Write the failing tests**
  - `pr-state.test.js`:
    - `test('#4794: resolvePrStatesBulk on an SSH-alias origin spawns nothing and returns unknown-host', …)`: origin `git@github-work:acme/w.git`, `opts.gateDeps` throwing `readFile` with `env: {}`, a recording `opts.runner` → `'unknown-host'`, zero runner calls. A repo with no origin still returns `'network-failure'`.
    - `test('#4794: a refused origin runs no not-found probe; an admitted one still does', …)`: a PATH-stub gh that fails every call and logs argv, `GH_HOST` deleted and `GH_CONFIG_DIR` an empty temp dir; `resolvePrStateByNumber(repo, 7)` on `git@github-work:acme/w.git` returns `'network-failure'` and the log holds no `api graphql` line; on `git@github.com:acme/w.git` the log holds one `api graphql` line carrying `-f owner=acme -f name=w`.
  - `gh-host-seam-behavior.test.js`: `test('AC1.1: pr-state\'s bulk PR screen on a *.ghe.com origin reaches the origin host with a bare owner/name pair', …)`: `resolvePrStatesBulk(repo, ['feature'], { gateDeps })` in-process with the fake gh → the logged line starts `GH_HOST=acme.ghe.com ` and carries `-f owner=acme -f name=widgets`.

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test tests/bin-lib/reconcile/pr-state.test.js tests/gh-host-seam-behavior.test.js`
Expected: FAIL after Step 1 — the alias bulk case reaches the runner with `owner=acme`, and the alias probe case logs an `api graphql` line. The GHE case passes before and after (it pins the bare pair).

- [ ] **Step 3: Implement** the two reads.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/bin-lib/reconcile/pr-state.test.js tests/gh-host-seam-behavior.test.js tests/bin-lib/reconcile/prune-remote.test.js tests/bin-lib/reconcile/archive-branches.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/reconcile/pr-state.js tests/bin-lib/reconcile/pr-state.test.js tests/gh-host-seam-behavior.test.js
git commit -m "Read pr-state's origin through the gate — unknown-host from the bulk screen, no probe on a refusal (refs #4794)"
```

### Task 7: prune-remote and archive-branches gate before the screen

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/reconcile/prune-remote.js` (`pruneRemote` :82-125)
- Modify: `plugin/bin/lib/reconcile/archive-branches.js` (`archiveBranches` :143-180)
- Test: `tests/bin-lib/reconcile/prune-remote.test.js` (reword the `repoSlugOf` comment at :58; the `skipFetch=true` test at :312-321), `tests/bin-lib/reconcile/archive-branches.test.js` (reword the `repoSlugOf` comment at :161)

**Interfaces:**
- Consumes: `repoTargetOf` (Task 2, imported from `../hooks/git-exec`), `resolvePrStatesBulk`'s `opts.repoSlug` (existing).
- `pruneRemote({ …, gateDeps })`: when `inScopeBranches.length > 0`, `const target = repoTargetOf(root, gateDeps);` a refusal returns `{ entries, failure: 'unknown-host', detail: target.refusal }` before the screen; otherwise the screen is `resolveBulk(root, inScopeBranches, { preferOpen: true, ...(target ? { repoSlug: target.slug } : {}) })`. No in-scope branch means no gh call and no refusal (`failure: null`, as today).
- `archiveBranches({ …, gateDeps })`: when `candidates.length > 0` and `repoTargetOf(root, gateDeps)` is a refusal, push `{ name, kind: 'branch', action: 'skip', reason: 'unknown-host', detail: <refusal> }` per candidate instead of screening (the same per-branch degrade shape as `gh-absent`), then run the tag-aging sweep unchanged and return `{ entries, failure: null }`. An admitted target passes `{ repoSlug: target.slug }` to `resolveBulk`.

- [ ] **Step 1: Write the failing tests**
  - `prune-remote.test.js`:
    - `test('#4794: an SSH-alias origin fails the check unknown-host with the refusal and screens nothing', …)`: an in-scope remote branch, origin set to `git@github-work:acme/w.git` after the fetch, `skipFetch: true`, the throwing-`readFile` `gateDeps`, a recording `resolvePrBulk` → `failure: 'unknown-host'`, `detail === gateOriginRepo('git@github-work:acme/w.git', gateDeps).refusal`, `resolvePrBulk` never called, the remote branch still exists.
    - `test('#4794: with no in-scope branch a refused origin is not a failure (no gh call needed)', …)` → `failure: null`.
    - The `skipFetch=true` test points origin at `https://example.invalid/nope.git`, which the gate now refuses: pass `gateDeps: { env: { GH_HOST: 'example.invalid' }, readFile: () => { throw new Error('ENOENT'); } }` there so the case still tests "no second fetch".
  - `archive-branches.test.js`: `test('#4794: an SSH-alias origin skips every candidate unknown-host with the refusal, screens nothing, and still ages archive tags', …)`: candidate branches plus an `archive/*` tag older than `TAG_AGE_DAYS`, the alias origin and `gateDeps`, a recording `resolvePrBulk` → each candidate entry deep-equals `{ name, kind: 'branch', action: 'skip', reason: 'unknown-host', detail: <refusal> }`, `resolvePrBulk` never called, the tag entry is `aged-out`, `failure: null`.

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test tests/bin-lib/reconcile/prune-remote.test.js tests/bin-lib/reconcile/archive-branches.test.js`
Expected: FAIL after Step 1 — the recording screens are called and no `unknown-host` appears

- [ ] **Step 3: Implement** both pre-gates.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/bin-lib/reconcile/prune-remote.test.js tests/bin-lib/reconcile/archive-branches.test.js tests/reconcile.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/reconcile/prune-remote.js plugin/bin/lib/reconcile/archive-branches.js tests/bin-lib/reconcile/prune-remote.test.js tests/bin-lib/reconcile/archive-branches.test.js
git commit -m "Gate prune-remote's and archive-branches' PR screen — unknown-host with the refusal (refs #4794)"
```

### Task 8: reconcile carries the release and remote-prune refusal detail

**Role:** integration

**Files:**
- Modify: `plugin/bin/lib/reconcile/index.js` (the release skip :536-537, the remote-prune skip :615-616)
- Test: `tests/reconcile.test.js`

**Interfaces:**
- Consumes: Task 4's and Task 7's `{ failure: 'unknown-host', detail }`.
- Both lines become `result.skipped.push({ check: '<check>', reason: r.failure, ...(r.detail ? { detail: r.detail } : {}) })`, matching the post-merge line :560. archive's per-run `hint` and archive-branches' per-entry `detail` already pass through unchanged.

- [ ] **Step 1: Write the failing tests** beside `#4933: a post-merge unknown-host failure carries its refusal detail …` (:1851), using `reconcileWithAsyncMerge(checks, { afterStubs })`:
  - `test('#4794: a release unknown-host failure carries its refusal detail into skipped and the summary line', …)`: `afterStubs` sets `releaseMod.releaseMerged` to return `{ released: [], skipped: [], failure: 'unknown-host', detail }`; the `release` skipped entry deep-equals `{ check: 'release', reason: 'unknown-host', detail }` and the summary line reads `` `skipped: release — unknown-host (${detail})` ``.
  - `test('#4794: a remote-prune unknown-host failure carries its refusal detail into skipped', …)`: `afterStubs` replaces `require('../plugin/bin/lib/reconcile/prune-remote').pruneRemote` with one returning `{ entries: [], failure: 'unknown-host', detail }` (restored in a `finally`), checks `['remote-prune']`; the `remote-prune` skipped entry deep-equals `{ check: 'remote-prune', reason: 'unknown-host', detail }`. A failure without `detail` still pushes `{ check, reason }` only.

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test tests/reconcile.test.js`
Expected: FAIL after Step 1 — both entries drop `detail`

- [ ] **Step 3: Implement** the two lines.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/reconcile.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/reconcile/index.js tests/reconcile.test.js
git commit -m "Carry the release and remote-prune refusal detail into reconcile's skipped entries (refs #4794)"
```

### Task 9: sibling-sessions' claim reader reports a refused origin

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/hooks/sibling-sessions.js` (`defaultReadClaim` :200-210; replace `repoSlugOf` in the `require('./git-exec')` at :33 with `repoTargetOf`)
- Modify: `plugin/bin/lib/issues/claim-store.js` (`defaultGhApi` :202-214, `createClaimReader` :366-390)
- Test: `tests/bin-lib/issues/claim-store.test.js`, `tests/gh-host-seam-behavior.test.js`

**Interfaces:**
- Consumes: `repoTargetOf` (Task 2).
- `defaultGhApi(args, opts = {})`: a given `opts.cwd` goes into the `ghOptions` options object as `cwd` (`ghOptions(ghArgs, { ...(opts.cwd ? { cwd: opts.cwd } : {}), encoding: 'utf8', stdio: [...], timeout: GH_TIMEOUT_MS, windowsHide: true })`, the literals kept inside); with none, behavior is unchanged. Every existing caller passes one argument (`git grep -n -E "ghApi\([^)]*,[^)]*\)" -- plugin/bin/lib/issues/claim-store.js` prints only `[…]` array-literal single arguments), so none changes.
- `createClaimReader(opts)` gains `opts.repoRefusal` (string, optional). When set, the contents-API leg is a module-private `refusedOriginGhApi` returning `{ stdout: null, failure: 'unknown-host', status: null }` (no request), and `read(n)` returns `{ failure: 'unknown-host', detail: opts.repoRefusal }` when that leg is the answer. The git leg runs first as today. Without `repoRefusal`, a null slug keeps `repo-slug-unresolved`.
- `defaultReadClaim(cwd)` (the reviewer's low defect, spec "Review defects"): `const t = repoTargetOf(cwd);` passes `repoSlug: t && !t.refusal ? t.slug : null`, for a refusal `repoRefusal: t.refusal`, and `ghApi: (args) => defaultGhApi(args, { cwd })`, so the contents read's host follows the hook's `cwd`, not `process.cwd()` (the gate decision and the request then read one origin). `findLiveClaim` still reads any failure as null (fail open).

- [ ] **Step 1: Write the failing tests**
  - `claim-store.test.js`: `test('#4794: createClaimReader with a repoRefusal fails the contents leg unknown-host with the refusal and makes no request', …)`: `gitRunner` failing, a recording `ghApi`, `{ repoSlug: null, repoRefusal: 'R' }` → `read(7)` deep-equals `{ failure: 'unknown-host', detail: 'R' }`, the `ghApi` saw zero calls; `{ repoSlug: null }` alone still reads `{ failure: 'repo-slug-unresolved' }`.
  - `claim-store.test.js`: `test('#4794: defaultGhApi passes a given cwd to the seam and none otherwise', …)` through a PATH-stub gh that logs `GH_HOST` and `pwd`, `GH_HOST` deleted, `_resetGhHostCache()` around it: from this checkout's cwd, `defaultGhApi(['repos/acme/widgets'], { cwd: <a *.ghe.com temp repo> })` logs `GH_HOST=acme.ghe.com` and that repo as `pwd`; `defaultGhApi(['repos/acme/widgets'])` logs `GH_HOST=unset`.
  - `gh-host-seam-behavior.test.js`: factor `runGated`'s env construction into a `gatedEnv(t, { ghHost, hostsYml })` helper (`runGated` calls it) and add a `nodeEval(t, cwd, script, envOpts)` spawning `process.execPath -e` with that env. The script prints `JSON.stringify(require(<sibling-sessions path>).findLiveClaim('#7', { cwd: <the repo path, a literal>, sessionId: 'other' }))`, and the child's own `cwd` is a fresh temp dir **outside** the repo (no origin), so a reader that follows `process.cwd()` instead of the hook's `cwd` reaches the wrong host. Let `installFakeGh` create a canned key's parent directories (`fs.mkdirSync(path.dirname(file), { recursive: true })`) so a key can name a `gh api repos/…` path; the contents read `api-repos/acme/widgets/contents/claims/issue-7.json?ref=claims-registry` answers `{"content": <a live claim blob>, "sha": "s1"}`.
    - `test('AC1.1: sibling-sessions\' claim read on a *.ghe.com origin reaches the origin host from any process.cwd()', …)`: `assertEveryLineReaches(lines, 'acme.ghe.com')` and stdout names the claim's `runId`.
    - `test('#4794: sibling-sessions on an SSH-alias origin sends no gh call', …)`: origin `git@github-work:acme/widgets.git` → `networkLines(lines)` is empty and stdout is `null`.

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test tests/bin-lib/issues/claim-store.test.js tests/gh-host-seam-behavior.test.js`
Expected: FAIL after Step 1 — the `repoRefusal` case reads `repo-slug-unresolved` via a `ghApi` call, the `defaultGhApi` cwd case logs `GH_HOST=unset`, the AC1.1 case logs `GH_HOST=unset` (the read followed the child's own cwd), and the SSH-alias case logs a contents read

- [ ] **Step 3: Implement** the option and the reader wiring.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/bin-lib/issues/claim-store.test.js tests/gh-host-seam-behavior.test.js tests/hooks-sibling-sessions.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/hooks/sibling-sessions.js plugin/bin/lib/issues/claim-store.js tests/bin-lib/issues/claim-store.test.js tests/gh-host-seam-behavior.test.js
git commit -m "Report a refused origin as unknown-host in sibling-sessions' claim reader (refs #4794)"
```

### Task 10: retire `repoSlugOf`

**Role:** integration

**Files:**
- Modify: `plugin/bin/lib/hooks/git-exec.js` (delete `repoSlugOf` :205-213 and its export at :233; reword `repoSpecOf`'s header :215-219 and its #4857 fallback comment :226-228, which name it)
- Modify: `plugin/bin/lib/reconcile/release-merged.js` (drop `repoSlugOf` from the import at :15 and the `module.exports` re-export at :619)
- Test: `tests/hooks-git-exec.test.js`, `tests/gh-host-seam-conformance.test.js`

**Interfaces:**
- Consumes: Tasks 4, 5, 6 and 9 (no caller of `repoSlugOf` remains).
- `tests/hooks-git-exec.test.js` swaps, all three: :439 (inside the `for` loop that passes `gateDeps`) becomes `assert.strictEqual(repoTargetOf(repo, gateDeps).slug, 'acme/w', url)`; :480 becomes `assert.strictEqual(repoTargetOf(repo).slug, 'acme/w')`; Task 2's `slug === repoSlugOf(repo)` comparison is removed, keeping its `slug === 'acme/widgets'` literal. Drop `repoSlugOf` from the import at :11 and reword the two test titles (:430, :477) that name it.

- [ ] **Step 1: Write the failing test** in `tests/gh-host-seam-conformance.test.js`: `test('#4794: no plugin/bin file names repoSlugOf — origin slugs go through the gate (repoTargetOf)', …)`, walking `BIN_ROOT` with the file's existing `walk`/`readText` and the comment stripper in blank mode, asserting no file's code matches `/(?<![\w$])repoSlugOf(?![\w$])/`, with the same walked-files floor the AC9.2 test uses.

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/gh-host-seam-conformance.test.js`
Expected: FAIL after Step 1, naming `lib/hooks/git-exec.js` and `lib/reconcile/release-merged.js`

- [ ] **Step 3: Implement** the deletions and the test swaps.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/gh-host-seam-conformance.test.js tests/hooks-git-exec.test.js tests/bin-lib/reconcile/release-merged.test.js tests/bin-lib/reconcile/archive-merged.test.js tests/bin-lib/reconcile/reap-merged.test.js tests/bin-lib/reconcile/pr-state.test.js tests/hooks-sibling-sessions.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/hooks/git-exec.js plugin/bin/lib/reconcile/release-merged.js tests/hooks-git-exec.test.js tests/gh-host-seam-conformance.test.js
git commit -m "Retire repoSlugOf now that every origin slug goes through the gate (refs #4794)"
```

### Task 11: claim store — one repo target for listing and matching

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/issues/claim-store.js` (`isSameRepoPrUrl` :677-682, `tombstoneInFlightPr` :684-707, `openPrListArgs` :718-723, `matchStaleClaimPr` :739, `staleClaimInFlightPr` :753-788; extend the `require('../repo-resolve')` at :52 with `repoSlug` and `normalizeHost`)
- Test: `tests/bin-lib/issues/claim-store.test.js`, `tests/bin-lib/claim-targets/claim-targets.test.js` (its `staleClaimInFlightPr` unit tests, :707-860)

**Interfaces:**
- Consumes: the `{ host, ghRepo }` shape of `resolveRepoTarget` (Task 2).
- Produces (a `null` target or host keeps today's exact behavior):
  - `openPrListArgs(owner, repo, target = null)`: the `--repo` value is `target ? target.ghRepo : repoSlug({ owner, repo })`; the other argv elements are unchanged.
  - `isSameRepoPrUrl(link, owner, repo, host = null)`: matches `^https://([^/]+)/{owner}/{repo}/pull/\d+$` (owner and repo escaped and exact) and requires `normalizeHost(m[1]) === normalizeHost(host || 'github.com')`.
  - `matchStaleClaimPr(runId, prs, owner, repo, host = null)` and `tombstoneInFlightPr(content, gh, owner, repo, host = null)`: thread `host` into `isSameRepoPrUrl`.
  - `staleClaimInFlightPr(content, gh, owner, repo, onError, target = null)`: lists with `openPrListArgs(owner, repo, target)` and matches with `target ? target.host : null` — one value for both (spec round 4, Q2 and Whole family).

- [ ] **Step 1: Write the failing tests**
  - `claim-store.test.js`: `openPrListArgs('acme', 'w', { host: 'acme.ghe.com', ghRepo: 'acme.ghe.com/acme/w' })` deep-equals today's array with `'acme.ghe.com/acme/w'` at the `--repo` value; `openPrListArgs('acme', 'w')` deep-equals the existing pinned array (AC2.1). `isSameRepoPrUrl('https://acme.ghe.com/acme/w/pull/7', 'acme', 'w', 'acme.ghe.com') === true`, and so is `'https://ACME.ghe.com./acme/w/pull/7'`; under that host `'https://github.com/acme/w/pull/7'` and `'https://acmeXghe.com/acme/w/pull/7'` are false (Review Focus 5); the GHE url is false with no host.
  - `claim-targets.test.js`: `test('#4794: staleClaimInFlightPr lists and matches on one target host', …)`: with target `{ host: 'mine.example', ghRepo: 'mine.example/acme/w' }`, the recorded `pr list` argv carries `--repo`, `mine.example/acme/w`, a marked same-repo `https://mine.example/acme/w/pull/3` returns `{ link }`, and a marked `https://github.com/acme/w/pull/3` under the same target returns null (Review Focus 2).

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test tests/bin-lib/issues/claim-store.test.js tests/bin-lib/claim-targets/claim-targets.test.js`
Expected: FAIL after Step 1 on every GHE and `mine.example` assertion; the AC2.1 argv pin passes before and after

- [ ] **Step 3: Implement** the signatures. Update `tombstoneInFlightPr`'s doc comment: the link is validated as a well-formed `https://{host}/{owner}/{repo}/pull/{number}` url for the same owner/repo, its host compared normalized against the run's one resolved host (github.com by default).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/bin-lib/issues/claim-store.test.js tests/bin-lib/claim-targets/claim-targets.test.js tests/issue-claims-stale-open-pr-conformance.test.js tests/tidy-stale-claim-open-pr-conformance.test.js tests/stale-claim-pr-cli.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/issues/claim-store.js tests/bin-lib/issues/claim-store.test.js tests/bin-lib/claim-targets/claim-targets.test.js
git commit -m "List and match stale-claim PRs on one resolved repo target (refs #4794)"
```

### Task 12: claim-targets gates its origin and builds its one repo target from the gh seam

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/claim-targets/claim-targets.js` (`USAGE`'s exit-2 line :48; a gate check after the `--steps` skip guard :320-332 and before the slug resolution :342; after the slug split at :372; the `tombstoneInFlightPr` call at :566 and the `staleClaimInFlightPr` call at :607)
- Modify: `plugin/bin/claim-targets.js` (the header's exit-2 clause :6-7; `realDeps` :39-49; extend the `require('./lib/repo-resolve')` at :27 with `resolveRepoTarget`, `resolveGhHost`, `gateOriginRepo` and `originUrl`)
- Test: `tests/bin-lib/claim-targets/claim-targets.test.js`, `tests/gh-host-seam-behavior.test.js`, `tests/gh-host-seam-conformance.test.js` (`ORIGIN_GATED` :407-409)

**Interfaces:**
- Consumes: Task 11's signatures, `resolveRepoTarget` (Task 2), Task 1's gate, `resolveGhHost` and `originUrl` (existing).
- **Gate (spec round 5, "No claim-targets exception").** `run()`, after the skip guard and before the first gh call: `const gate = typeof deps.gateOrigin === 'function' ? deps.gateOrigin() : null;` `if (gate && gate.refusal) { deps.stderr(\`claim-targets: unknown-host — ${gate.refusal}\n\`); return 2; }`. Run-level, so it returns 2 with or without `--keep-going` (claim-targets-stop-addition decision 1), before any claim read or write, label, or claim-log line ("never claimed" holds for every target). A `null` gate or a `{ spec: null, refusal: null }` verdict (no origin, an unparseable one) changes nothing: `gh repo view` resolves the repo as today. `USAGE` and the header name the new cause: "exit 2 = malformed invocation or missing dependency (an origin host the origin-host gate refuses, `unknown-host`, included)".
- `realDeps.gateOrigin = () => { let remote = null; try { remote = originUrl(process.cwd()); } catch { remote = null; } return gateOriginRepo(remote); }` (`originUrl` carries the git timeout; `remoteUrl` has none).
- `run()`: `const repoTarget = typeof deps.repoTarget === 'function' ? deps.repoTarget(repoOwner, repoName) : null;` computed once after the slug split; `tombstoneInFlightPr(content, cachedPrReadGh, repoOwner, repoName, repoTarget ? repoTarget.host : null)` and `claimStore.staleClaimInFlightPr(content, cachedPrReadGh, repoOwner, repoName, onError, repoTarget)`.
- `realDeps.repoTarget = (owner, repo) => resolveRepoTarget({ owner, repo, originHost: resolveGhHost(process.cwd()) })`: the seam's host is the one `defaultGh`'s inferred calls (`gh repo view`, `gh pr view`) already reach, so the listing, the tombstone check and the stale match share it; for an admitted origin it equals the gate's host (both read `hostPathOf`, Task 1). No new exit code.
- `tests/gh-host-seam-conformance.test.js`: add `'claim-targets.js'` to `ORIGIN_GATED` (AC9.3: exactly the files calling `gateOriginRepo`). No `CLI_TABLE` row (Global Constraints: its repo is gh-inferred, so the table's slug-in-argv cases do not apply); the refusal cases below pin it instead.

- [ ] **Step 1: Write the failing tests**
  - `claim-targets.test.js`:
    - `test('#4794: a refused origin exits 2 unknown-host before any gh call, with or without --keep-going', …)`: `deps.gateOrigin = () => ({ spec: null, refusal: 'R' })` with recording `gh`, `ghApi`, `gitRunner` and `appendClaimLog` → exit 2, stderr exactly `claim-targets: unknown-host — R\n`, all four recorders saw zero calls, stdout empty; the same with `--keep-going`. With `--steps review,wrap-up` the skip guard still answers first (exit 0, `skipGuard`) and `gateOrigin` is never called. `deps.gateOrigin = () => ({ spec: null, refusal: null })` claims as today.
    - A stale claim with `deps.repoTarget = () => ({ host: 'acme.ghe.com', ghRepo: 'acme.ghe.com/acme/w' })`, whose `gh pr list` answer holds a marked same-repo `https://acme.ghe.com/acme/w/pull/12`, stops in flight (exit 3, `inFlight`), and the recorded `pr list` argv carries `--repo`, `acme.ghe.com/acme/w` exactly once. A `pr-opened:` tombstone linking `https://acme.ghe.com/acme/w/pull/12` under the same target reaches `gh pr view` and stops in flight when it answers `OPEN`. With `deps.repoTarget = () => ({ host: 'mine.example', ghRepo: 'acme/w' })` (what Task 2's resolver returns under `GH_HOST=mine.example`, Review Focus 7) the listing carries today's bare `--repo`, `acme/w`, a marked `https://mine.example/acme/w/pull/12` is in flight and a marked `https://github.com/acme/w/pull/12` is not. With no `deps.repoTarget` the listing argv is today's bare `--repo acme/w`.
  - `gh-host-seam-behavior.test.js` (claim-targets' real wiring, a child process through `runGated` with a row `{ cli: 'claim-targets.js', argv: ['--run-id', '2026-11-04T000002-record-7', '--targets', '7'], canned }`): `repo-view` answers `acme/widgets`; the contents read key (Task 9's nested-key support) answers `{"content": <a TTL-expired claim blob for RUN_ID>, "sha": "s1"}`; `pr-list` answers a marked same-repo PR on the case's host. `GIT_ALLOW_PROTOCOL=file` makes the git-CAS leg fail fast so the read takes the contents API.
    - `test('AC1.1: claim-targets.js on a *.ghe.com origin lists open PRs on the origin host and stops the stale claim in flight', …)`: exit 3, `assertEveryLineReaches(r.lines, 'acme.ghe.com')`, and the `pr list` line carries `--repo acme.ghe.com/acme/widgets`.
    - `test('AC2.1: claim-targets.js on a github.com origin keeps today\'s pr list argv', …)`: every line starts `GH_HOST=unset `, and the `pr list` line's argv is `pr list --repo acme/widgets --state open --json url,body,isCrossRepository --limit 1000`. A second case with `ghHost: 'github.com'` keeps the same argv (Review Focus 7).
    - `test('#4794: claim-targets.js on an unknown or SSH-alias origin exits 2 unknown-host and calls no gh', …)`: for `https://git.corp.invalid/o/r.git` and `git@github-work:acme/widgets.git` → exit 2, `networkLines(r.lines)` empty (no `repo view` either), stderr starts `claim-targets: unknown-host — ` and contains `gateOriginRepo(origin, { env: {}, readFile: () => { throw new Error('ENOENT'); } }).refusal`; the alias stderr matches `/GH_HOST=github\.com/` and not `/GH_HOST=github-work/` (Review Focus 10). With `ghHost: 'git.corp.invalid'` the unknown-host origin is not refused.

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test tests/bin-lib/claim-targets/claim-targets.test.js tests/gh-host-seam-behavior.test.js tests/gh-host-seam-conformance.test.js`
Expected: FAIL after Step 1 on every GHE, `mine.example` and refusal assertion, and AC9.3 names `claim-targets.js`; the github.com twins pass before and after

- [ ] **Step 3: Implement** the gate check, `USAGE` and header text, the `run()` wiring, `realDeps.gateOrigin` and `realDeps.repoTarget`, and the roster entry.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/bin-lib/claim-targets/claim-targets.test.js tests/bin-lib/claim-targets/cli.test.js tests/gh-host-seam-behavior.test.js tests/gh-host-seam-conformance.test.js tests/flow-claim-preflight.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/claim-targets/claim-targets.js plugin/bin/claim-targets.js tests/bin-lib/claim-targets/claim-targets.test.js tests/gh-host-seam-behavior.test.js tests/gh-host-seam-conformance.test.js
git commit -m "Gate claim-targets' origin and send its stale-claim listing and matching to one seam host (refs #4794)"
```

### Task 13: stale-claim-pr.js on the gate, one host for listing and matching

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/stale-claim-pr.js` (`run()` :178-194, the header paragraph :45-53, `realDeps` :116-127 gains `gateDeps: undefined`, the require at :73)
- Modify: `docs/plugin-structure.md` (the `stale-claim-pr.js` command line :224: its "a non-github.com repo host is one, since `isSameRepoPrUrl` knows github.com urls only" clause)
- Test: `tests/stale-claim-pr-cli.test.js` (rework `a non-github.com host is the failure verdict …` :346-372; `fakeDeps` :41-60 gains `gateDeps: { env: {}, readFile: () => { throw new Error('ENOENT'); } }` so a developer's `GH_HOST` cannot reach the existing cases), `tests/gh-host-seam-behavior.test.js`, `tests/gh-host-seam-conformance.test.js`

**Interfaces:**
- Consumes: `openPrListArgs(owner, repo, target)`, `matchStaleClaimPr(…, host)` (Task 11); `gateOriginRepo`, `resolveRepoTarget` from `./lib/repo-resolve`.
- `run()` resolves `{ owner, repo }` and one `target`:
  - Explicit `--repo` with three or more `/`-parts: `parseRepo` it; `target = resolveRepoTarget({ owner, repo, explicitHost: spec.host }, deps.gateDeps || {})` — any host (round 2).
  - Explicit bare `--repo owner/name`: `target = resolveRepoTarget({ owner, repo }, deps.gateDeps || {})` (github.com unless `GH_HOST` is exported non-empty, round 4 Q2).
  - No `--repo`: `const gated = gateOriginRepo(remote, deps.gateDeps);` `gated.refusal` → stderr `stale-claim-pr.js: {refusal}\n` and stdout `noMatch(\`unknown-host: ${gated.refusal}\`)`, exit 0, no claim read, no gh probe, no gh call; `gated.spec === null` → today's exit 3; else `target = resolveRepoTarget({ owner, repo, originHost: gated.spec.host }, deps.gateDeps || {})`.
  - `deps.gh(openPrListArgs(owner, repo, target))` and `matchStaleClaimPr(runId, prs, owner, repo, target.host)`.
- Header paragraph: a typed host-qualified `--repo` is trusted and not gated; an origin goes through `gateOriginRepo` (#4933), and a refused one is the failure `unknown-host: {refusal}`; listing and matching share one host — the typed `--repo` host, else an exported non-empty `GH_HOST`, else the origin's host, else github.com.
- `docs/plugin-structure.md` :224: replace the github.com-only clause with "an origin host the gate refuses is one (`unknown-host: {refusal}`); the listing and the PR-url match share one host (a host-qualified `--repo`, else an exported non-empty `GH_HOST`, else the origin's, else github.com)".
- `tests/gh-host-seam-conformance.test.js`: remove `stale-claim-pr.js` from `NOT_ORIGIN` (:400), add it to `ORIGIN_GATED` (:407-409, beside Task 12's `claim-targets.js`), and lower the AC9.2 floor from 6 to 5 (:466-471), extending the comment to name #4794 as a deliberate move onto the gate (the #4951/#4805 precedent in that comment). Task 1 adds no matched site (its normalized read's `parseRepo(hostPath)` names no `ORIGIN_ARG` token, like `resolveGhSpec`'s), so the floor moves only here.

- [ ] **Step 1: Write the failing tests**
  - `stale-claim-pr-cli.test.js`, replacing the github.com-only test with:
    - `--repo ghe.example.com/acme/w` with a marked `https://ghe.example.com/acme/w/pull/7` listing → `{ match: true, link: 'https://ghe.example.com/acme/w/pull/7', failure: null }`.
    - `--repo github.com/acme/w` on the gh path lists with `--repo acme/w`; with `gateDeps: { env: { GH_HOST: 'mine.example' } }` it lists with `--repo github.com/acme/w` and still matches a marked `https://github.com/acme/w/pull/7` (a qualified `-R` beats `GH_HOST`, so it stays qualified).
    - bare `--repo acme/w` with `gateDeps: { env: { GH_HOST: 'mine.example' } }` lists with today's `--repo acme/w` (gh sends it to `mine.example`, round 5 Q1) and matches `https://mine.example/acme/w/pull/7`, not `https://github.com/acme/w/pull/7` (spec round 4 Q2).
    - a github.com origin with `gateDeps: { env: { GH_HOST: 'mine.example' } }` lists with `--repo acme/w` (AC2 with `GH_HOST` exported) and matches `https://mine.example/acme/w/pull/7`.
    - a `*.ghe.com` origin matches `https://acme.ghe.com/acme/w/pull/7`, and on the gh path `deps.calls.gh` holds `--repo acme.ghe.com/acme/w`; a `ghe.example.com` origin with `readFile: () => 'ghe.example.com:\n'` matches the same way.
    - a `ghe.example.com` origin and a `git@github-work:acme/w.git` origin, each with the throwing `readFile` → verdict `{ match: false, link: null, failure: \`unknown-host: ${gateOriginRepo(remote, gateDeps).refusal}\` }`, stderr holds the refusal, `deps.calls.readFile`, `deps.calls.gh` empty and `deps.calls.ghAvailable === 0`; the alias verdict matches `/GH_HOST=github\.com/` and not `/GH_HOST=github-work/`.
    - a `*.ghe.com` origin with `gateDeps: { env: { GH_HOST: 'mine.example' } }` lists with `--repo acme/w` and matches `https://mine.example/acme/w/pull/7`, not `https://acme.ghe.com/acme/w/pull/7`.
    - a `https://oauth2@acme.ghe.com/acme/w.git` origin lists with `--repo acme.ghe.com/acme/w` and matches `https://acme.ghe.com/acme/w/pull/7` (Task 1's normalized read, Review Focus 8).
  - `gh-host-seam-behavior.test.js`: `test('AC1.1: stale-claim-pr.js on a *.ghe.com origin lists open PRs on the origin host and matches its marked PR', …)`, the CLI run as a child through `runGated` in a GHE temp repo with `pr-list` answering a marked `https://acme.ghe.com/acme/widgets/pull/12`: `assertEveryLineReaches(r.lines, 'acme.ghe.com')` and stdout `match: true`. `test('AC2.1: stale-claim-pr.js on a github.com origin keeps today\'s pr list argv', …)`: the network line equals `GH_HOST=unset ARGS=pr list --repo acme/widgets --state open --json url,body,isCrossRepository --limit 1000`.

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test tests/stale-claim-pr-cli.test.js tests/gh-host-seam-behavior.test.js`
Expected: FAIL after Step 1 on every GHE, `ghe.example.com`, `github-work` and `mine.example` assertion; the AC2.1 argv pin passes before and after

- [ ] **Step 3: Implement** `run()`, the header paragraph, the doc line and the conformance roster change.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/stale-claim-pr-cli.test.js tests/gh-host-seam-behavior.test.js tests/gh-host-seam-conformance.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/stale-claim-pr.js docs/plugin-structure.md tests/stale-claim-pr-cli.test.js tests/gh-host-seam-behavior.test.js tests/gh-host-seam-conformance.test.js
git commit -m "Gate stale-claim-pr's origin and list and match on one host (refs #4794)"
```

### Task 14: agent-composed stale-claim-pr.js calls take their host from origin

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/skills/_shared/issue-claims.md` (the lock step 4 tombstone sentence at :186-188, its invocation at :198, and the gh-path sentence at :524-526)
- Modify: `plugin/skills/tidy/scan-procedures.md` (the Step 4.7 invocation at :244 and its paragraph :243-251)
- Test: `tests/tidy-stale-claim-open-pr-conformance.test.js` (the AC1.2 `--repo "{owner}/{repo}"` pin at :50), `tests/issue-claims-stale-open-pr-conformance.test.js` (`lockStep4()` :22, AC1.2 :31)

**Interfaces:**
- Consumes: Task 13's CLI behavior (no `--repo` reads origin through the gate; exit 3 when origin does not parse; `unknown-host: …` failure for a refused origin).
- Both invocations (spec round 3, Q2) drop `--repo`. One added sentence at each site: exit 3 (origin does not parse, e.g. a sandbox proxy remote) → re-run adding `--repo "{host}/{owner}/{repo}"`, never a bare `owner/repo`; keep the existing exit-2 → `--listing` sentence (the exit-3 re-run's `--repo` carries over to it).
- **One `{host}` definition** (the reviewer's defect), written once in each file with the same words, in issue-claims.md at its first use (lock step 4) and in scan-procedures.md beside the exit-3 sentence: "`{host}` is the GitHub host the record lives on: `github.com` on the GitHub MCP path; on the `gh` path an exported non-empty `GH_HOST`, else the origin's host when it is `github.com` or a known GitHub Enterprise host, else `github.com`." The closing "else `github.com`" is the round-5 low defect (spec "Review defects"): exit 3 means origin does not parse, so on the `gh` path with `GH_HOST` unset the exit-3 re-run's `{host}` is `github.com`, explicitly, per the round-4 precedence. issue-claims.md's two tombstone sentences read `https://{host}/{owner}/{repo}/pull/{number}`, compared case-insensitively with trailing dots ignored, the gh-path one referring back to that definition rather than restating it.
- Rail: trim words in the same paragraphs so `wc -c` prints at most 50800 for `issue-claims.md` and at most 52447 for `scan-procedures.md` (today's sizes; `RAIL_BYTES` 52500).

- [ ] **Step 1: Write the failing tests** — assertion inventory per the governing skill: the AC1.2 `--repo "{owner}/{repo}"` literal is **retired** (round 3 drops `--repo` from agent calls) and replaced by the assertions below; every other assertion in both files is unchanged.
  - Both files share one test-local constant `HOST_DEFINITION` holding the definition sentence above, and each test asserts `HOST_DEFINITION.endsWith('else `github.com`.')` beside its containment assertion, so the exit-3 fallback cannot be trimmed out of the constant and the prose together unnoticed (the round-5 pin).
  - `tidy-stale-claim-open-pr-conformance.test.js`: the first `bin/stale-claim-pr.js` invocation in `claimAuditSection()` carries no `--repo`; the section contains `--repo "{host}/{owner}/{repo}"` in a sentence with `/[Ee]xit 3/` before it; the section never contains `--repo "{owner}/{repo}"`; the section contains `HOST_DEFINITION` once.
  - `issue-claims-stale-open-pr-conformance.test.js`: the same three invocation assertions on `lockStep4()`; `issue-claims.md` contains no `https://github.com/{owner}/{repo}/pull/{number}`, contains `https://{host}/{owner}/{repo}/pull/{number}` twice, and contains `HOST_DEFINITION` exactly once.

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test tests/tidy-stale-claim-open-pr-conformance.test.js tests/issue-claims-stale-open-pr-conformance.test.js`
Expected: FAIL after Step 1 on the no-`--repo`, exit-3, `{host}` and definition assertions

- [ ] **Step 3: Implement** the prose edits, then `wc -c plugin/skills/_shared/issue-claims.md plugin/skills/tidy/scan-procedures.md` must print at most 50800 and 52447.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/tidy-stale-claim-open-pr-conformance.test.js tests/issue-claims-stale-open-pr-conformance.test.js tests/bin-lib/skill-audit/context-cost.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/_shared/issue-claims.md plugin/skills/tidy/scan-procedures.md tests/tidy-stale-claim-open-pr-conformance.test.js tests/issue-claims-stale-open-pr-conformance.test.js
git commit -m "Take agent-composed stale-claim-pr hosts from origin, one {host} definition (refs #4794)"
```

### Task 15: pin the SSH-alias origin on post-merge and teardown-run

**Role:** integration

**Files:**
- Test: `tests/bin-lib/reconcile/post-merge.test.js`, `tests/hooks-teardown-run.test.js`, `tests/gh-host-seam-behavior.test.js`
- No code change in `plugin/bin/lib/reconcile/post-merge.js` or `plugin/bin/lib/hooks/teardown-run.js`: both take their host from `repoSpecOf` → `gateOriginRepo` on main (#4933), the rule the spec's round-3 Decision keeps, and Task 1 changed the shared refusal text they print.

**Interfaces:**
- Consumes: main's `repoSpecOf(repoRoot, gateDeps)`, `setupContext`'s `deps.gateDeps`, Task 1's alias text.

- [ ] **Step 1: Write the tests** (each passes `gateDeps` or sets `GH_CONFIG_DIR` to a temp dir it controls, and deletes `GH_HOST` for its duration):
  - `post-merge.test.js`: `test('#4794: an SSH-alias origin refuses Step 4.0b — failure unknown-host, the alias advice, no gh call', …)`, origin `git@github-work:acme/w.git`, modelled on `AC8.2 post-merge setupContext (#4933)` (:822): `failure: 'unknown-host'`, `detail === gateOriginRepo('git@github-work:acme/w.git', NO_GH_HOSTS).refusal`, `detail` matches `/GH_HOST=github\.com/` and does **not** match `/GH_HOST=github-work/` (round 4 flips the old plan's assertion), and the recording deps saw no call.
  - `hooks-teardown-run.test.js`: `test('#4794: teardown-run on an SSH-alias origin issues no gh DELETE and skips with the alias advice', …)`, modelled on `AC8.1 teardown (#4933)` (:389), origin `git@github-work:acme/widgets.git`: the remote-ref line is `remote ref: skipped — ${refusal}`, matching `/GH_HOST=github\.com/` and not `/GH_HOST=github-work/`, and no DELETE was issued.
  - `gh-host-seam-behavior.test.js`: `test('AC1.1: teardown-run on a *.ghe.com origin sends its remote-ref delete to the origin host', …)`, the real `defaultGhApiDelete` with the fake gh on PATH and a run fixture after `hooks-teardown-run.test.js`'s AC16 shape (:412: run-state `pr.branch` set, no worktree recorded): the one network line reaches `acme.ghe.com` and carries `--hostname acme.ghe.com` exactly once.

- [ ] **Step 2: Run them**

Run: `node --test tests/bin-lib/reconcile/post-merge.test.js tests/hooks-teardown-run.test.js tests/gh-host-seam-behavior.test.js`
Expected: PASS (they pin main's behavior with Task 1's text). Prove each SSH-alias case can go red: temporarily make `gateOriginRepo` return `{ spec: { ...parsed, host }, refusal: null }` for every host, see both fail, then restore.

- [ ] **Step 3: Commit**

```bash
git add tests/bin-lib/reconcile/post-merge.test.js tests/hooks-teardown-run.test.js tests/gh-host-seam-behavior.test.js
git commit -m "Pin the SSH-alias refusal and its advice on post-merge and teardown-run (refs #4794)"
```

### Task 16: a whole reconcile pass on a GHE origin, and the stale prose

**Role:** integration

**Files:**
- Test: `tests/gh-host-seam-behavior.test.js`
- Modify: `.claude/skills/gh-api-module-pattern/SKILL.md` (:65-73: the `repoSlugOf` paragraph and the bare-slug `--repo` limitation it states — `escalate-residue.js`'s calls, `claim-store.js`'s `openPrListArgs`; and the :73 parser-swap paragraph, whose "`repoSpecOf` now falls back to the looser parse" sentence gains: the gate itself now reads origin through `hostPathOf` as the seam does, so an `ssh://` origin on a passing host resolves with its host, and the loose fallback is left for one whose host would be refused (#4794))
- Modify: `docs/reconcile-checks.md` (the record check's skip-reason list :210-219, the `no-repo-slug` note :405-407)

**Interfaces:**
- Consumes: Tasks 1-15.

- [ ] **Step 1: Write the test**
  - `test('AC1.1: a whole reconcile pass (hooks.js reconcile) on a *.ghe.com origin sends every gh call to the origin host', …)`: a GHE temp repo with `CLAUDE.md` `work-backend: github-issues`, a fake gh on PATH (a `case` stub answering the claims tree listing with `{"truncated":false,"entries":[]}` and anything else with `[]`), `node plugin/bin/hooks.js reconcile` as a child with `cwd: repo`, `childEnv()` plus `GIT_TERMINAL_PROMPT=0` and an empty `GH_CONFIG_DIR`. The pass may `git fetch` the `https://acme.ghe.com/…` origin, which must fail fast rather than prompt; if a network `git` call still makes the case slow or flaky, stop and report it rather than loosening the assertion. Assert `assertEveryLineReaches(lines, 'acme.ghe.com')`, whose `net.length >= 1` floor proves at least release-merged's tree listing ran. Factor the case into a `reconcilePassLines(t, { origin, env })` helper (Task 17 reuses it).
  - `test('AC1.1: a whole reconcile pass on a credentialed https://oauth2@acme.ghe.com origin sends every gh call to the origin host', …)` (the reviewer's high defect, Review Focus 8): the same helper with `origin: 'https://oauth2@acme.ghe.com/acme/widgets.git'` and the same assertion; the seam and the gate both read `acme.ghe.com`, so no line falls back to github.com.

- [ ] **Step 2: Run it**

Run: `node --test tests/gh-host-seam-behavior.test.js`
Expected: PASS (Tasks 1-13 landed). Prove the case can go red: temporarily revert Task 4's `root` binding and run the pass in-process from this checkout's cwd, then restore. Prove the credentialed case can go red: temporarily make `gateOriginRepo` judge `parseRepo(remote)` alone (Task 1's old read), see a line without `acme.ghe.com`, then restore.

- [ ] **Step 3: Update the prose.** Skill: origin-derived repos come from `git-exec.js`'s `repoTargetOf` (`ghRepo` for `--repo`, `slug` for `repos/…` paths, GraphQL pairs and slug comparisons) through #4933's gate, so an unknown or SSH-alias origin is refused (`unknown-host` with the refusal text), never sent bare; a command that calls gh and compares a host takes both from one `resolveRepoTarget` result; `release-merged.js`'s REST calls pass `cwd: root`. `docs/reconcile-checks.md`: the record check gains a fourth skip reason, `unknown-host` (a refused origin; the refusal rides as the skip's `hint`; tracked like `no-repo-slug`, and its escalation files nothing because the residue repo is a refusal), so "Three skip reasons" becomes "Four"; the :405 note names `unknown-host` beside `no-repo-slug` as never filed into the record. Keep the rest of each paragraph. Then `git grep -n repoSlugOf -- plugin .claude docs/reconcile-checks.md tests` prints nothing. Control, run at plan time against this plan's base commit: `git grep -n repoSlugOf 70ae36cb9 -- plugin/bin/lib/hooks/git-exec.js` printed four lines, the first `70ae36cb9:plugin/bin/lib/hooks/git-exec.js:208:function repoSlugOf(repoRoot) {`, so the search can match its target.

- [ ] **Step 4: Run the record's acceptance command and the seam scan**

Run: `node --test tests/gh-host-seam-behavior.test.js tests/gh-host-seam-conformance.test.js`
Expected: PASS (spec AC3.1)

- [ ] **Step 5: Commit**

```bash
git add tests/gh-host-seam-behavior.test.js .claude/skills/gh-api-module-pattern/SKILL.md docs/reconcile-checks.md
git commit -m "Pin a whole GHE reconcile pass and retire the bare-slug and repoSlugOf prose (refs #4794)"
```

### Task 17: an exported but empty `GH_HOST` is unset in the gh seam too

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/repo-resolve.js` (`ghOptions` :234-264 and its comment, `explicitRepoGhHost` :266-277, the header :3-17)
- Modify: `docs/decisions/0030-unknown-origin-hosts-are-refused-not-degraded.md` (the ruling bullet :41-43, the rejected alternative :56-58)
- Modify: `docs/journeys/opt-in-an-unknown-origin-host-with-gh-host-4933.md` (:41's "here the gate deliberately differs from the gh host seam, which treats an empty value as set")
- Test: `tests/bin-lib/repo-resolve.test.js` (:157, :309, :330), `tests/gh-host-seam-behavior.test.js`

**Interfaces:**
- Consumes: Task 16's `reconcilePassLines`.
- A module-private `ghHostIn(env)` = `String((env || {}).GH_HOST || '').trim()` (the gate's own test, :148). `ghOptions`: `if (ghHostIn(base)) return opts;` replaces `if ('GH_HOST' in base) return opts;`; every injection after it writes `GH_HOST` over the empty value in the call's own env copy (`{ ...base, GH_HOST: … }` already does), and with nothing to inject it still returns `opts` itself, the empty value untouched (a github.com origin's env stays byte-identical, AC2). `explicitRepoGhHost`: `if (!repoSpec || ghHostIn(env)) return null;` replaces `'GH_HOST' in env`, so an explicit `--repo` under an empty `GH_HOST` still pins its host and its host-less calls do not take the seam's origin host (the split this ruling exists to stop). The comment on `ghOptions` (:234-248) and the header's "An empty GH_HOST is no opt-in" sentence say the seam and the gate now read an empty value the same way (spec round 5, Q2).
- Assertion inventory for the three flipped pins (each **retargeted**, none retired):
  - :157 `AC4.1 … empty string included`: the `other.example` half is kept; the `o2` half becomes `ghOptions(['api', 'graphql'], { cwd: '/r', env: { GH_HOST: '' } }, ghe).env.GH_HOST === 'acme.ghe.com'` (the `ghe` deps' origin, :142), retitled `AC4.1: an exported non-empty GH_HOST is never overwritten; an empty one is unset (#4794)`, plus `{ GH_HOST: '  ' }` the same way.
  - :309 `explicitRepoGhHost AC4`: `mine.example` still returns null; `''` and `'  '` now return `'github.com'` for the github.com spec on the GHE origin, retitled to say so.
  - :330 `#4795 … empty string included`: `mine.example` still beats the pin; `{ GH_HOST: '' }` now gets the recorded pin (`env.GH_HOST === 'github.com'`), retitled.

- [ ] **Step 1: Write the failing tests** — the three retargets above, and in `gh-host-seam-behavior.test.js`: `test('#4794: a whole reconcile pass on a *.ghe.com origin with GH_HOST exported empty sends every gh call to the origin host', …)`: `reconcilePassLines(t, { origin: 'https://acme.ghe.com/acme/widgets.git', env: { GH_HOST: '' } })` → `assertEveryLineReaches(lines, 'acme.ghe.com')` (Review Focus 9: release-merged's seam-wrapped calls and the host-qualified residue `--repo` agree). In `repo-resolve.test.js`, `test('#4794 AC2.1: a github.com origin with GH_HOST exported empty keeps its env untouched', …)`: `_resetGhHostCache()`, then `const o = { cwd: '/d', env: { GH_HOST: '' } }; assert.strictEqual(ghOptions(['pr', 'list'], o, dotcom), o)` (the file's `dotcom` deps, :295).

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test tests/bin-lib/repo-resolve.test.js tests/gh-host-seam-behavior.test.js`
Expected: FAIL after Step 1 — the retargeted halves get the old "empty wins" answers, and the reconcile pass logs `GH_HOST=` lines without `acme.ghe.com`. The github.com case passes before and after.

- [ ] **Step 3: Implement** `ghHostIn` and the two guards. Then reword ADR 0030 :41-43 to: "An exported but **empty** (or whitespace-only) `GH_HOST` is not an opt-in, so an unknown origin host is still refused. Since #4794 `ghOptions` reads an empty value as unset too, so the gate and the seam agree." and :56's alternative to name it "(the seam's behavior before #4794)". Reword the journey's :41 clause to "the gh host seam reads an empty value the same way (#4794)". Sweep for other restatements of the old seam rule: `git grep -n -i -E "empty.{0,40}GH_HOST|GH_HOST.{0,60}empty" -- plugin docs .claude/skills ':!docs/superpowers'` — every hit other than these three and the gate's own text needs a verdict in the commit body.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/bin-lib/repo-resolve.test.js tests/gh-host-seam-behavior.test.js tests/gh-host-seam-conformance.test.js tests/bin-lib/phase-exit/phase-exit.test.js tests/merge-verification.test.js tests/resolve-policy-cli.test.js`
Expected: PASS (the last three set `GH_HOST: ''` over non-GHE origins: Global Constraints' fixture sweep)

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/repo-resolve.js docs/decisions/0030-unknown-origin-hosts-are-refused-not-degraded.md docs/journeys/opt-in-an-unknown-origin-host-with-gh-host-4933.md tests/bin-lib/repo-resolve.test.js tests/gh-host-seam-behavior.test.js
git commit -m "Read an exported but empty GH_HOST as unset in the gh seam too (refs #4794)"
```

### Task 18: claim-targets' refusal and the gate's normalized read in the prose

**Role:** integration

**Files:**
- Modify: `plugin/skills/flow/claim-targets.md` (the exit-2 bullet :372-375)
- Modify: `docs/plugin-structure.md` (the origin-host gate roster :140; the `claim-targets.js` command line :223)
- Modify: `docs/journeys/opt-in-an-unknown-origin-host-with-gh-host-4933.md` (:41's CLI list, :76's `ssh://` line)
- Test: `tests/flow-claim-preflight.test.js`

**Interfaces:**
- Consumes: Task 12's stop, Task 1's normalized read.
- `flow/claim-targets.md` exit-2 bullet gains, inside its parenthesis: "or an origin host the origin-host gate refuses (`claim-targets: unknown-host — {refusal}`, #4794)", and one sentence after "Treat as a hard stop.": "The gh-absent MCP claim procedure does not reach that refusal; it claims on the GitHub MCP's host." (claim-targets-stop-addition decision 2).
- `docs/plugin-structure.md` :223's exit-2 clause gains the same cause; :140's roster gains `claim-targets (#4794, which refuses only: its repo still comes from gh)`.
- The journey's :41 list gains claim-targets, "Sixteen" becoming "Seventeen" (count the names after the edit and use that number); :76 becomes: "The gate reads an `ssh://`, credentialed or ported origin the way the seam does (#4794); one only that read parses, on a host that would be refused, falls back to the loose reader (#4857), which never names an unknown host either."

- [ ] **Step 1: Write the failing test** in `tests/flow-claim-preflight.test.js`: `test('#4794: the exit-2 bullet names the unknown-host refusal and its transport limit', …)` slicing the bullet from `- **2** —` to the next `**On exit`: it contains `unknown-host` and `does not reach that refusal`.

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/flow-claim-preflight.test.js`
Expected: FAIL after Step 1 — the bullet names neither

- [ ] **Step 3: Implement** the three prose edits.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/flow-claim-preflight.test.js tests/dispatch-resume-prose.test.js tests/bin-lib/skill-audit/context-cost.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/flow/claim-targets.md docs/plugin-structure.md docs/journeys/opt-in-an-unknown-origin-host-with-gh-host-4933.md tests/flow-claim-preflight.test.js
git commit -m "Name claim-targets' unknown-host refusal and the gate's normalized read in the prose (refs #4794)"
```

Waived plugin/bin/lib/reconcile/post-merge.js: read only — it already reaches the origin host and refuses through `repoSpecOf` → `gateOriginRepo` on main (#4933); Task 15 pins its SSH-alias refusal and Task 1 changes the shared text it prints.

## Spec coverage

| Spec item | Task |
|---|---|
| Deliverable 1 (host-aware sibling, move reconcile callers and claim-store onto it) | 2, 4, 5, 6, 7, 9, 10, 11, 12, 13 |
| Deliverable 2 (slug comparisons and `repos/…` paths stay consistent; github.com byte-identical) | 4, 5 (Review Focus 3), 6, 11, 12, 13 |
| Deliverable 3 (GHE-origin case per migrated caller in `tests/gh-host-seam-behavior.test.js`) | 4, 5, 6, 9 (sibling-sessions), 12 (claim-targets' real wiring), 13, 15, 16 |
| Decision round 1: Reading B (seam-known hosts only) | 2 (through the gate, which admits the same hosts), 5, 12, 13 |
| Decision round 1: align post-merge/teardown, SSH-alias test on each | 15 |
| Decision round 2: explicit host-qualified `--repo` trusted; `GH_HOST` value for PR-url matching; normalized host comparisons incl. the MCP prose | 2, 11, 12, 13, 14 |
| Decision round 3, Q1: `repoSlugOf` paths through `gateOriginRepo`, one host rule per pass, SSH-alias refusals pinned | 2, 4, 5, 6, 7, 9, 10, 15 |
| Decision round 3, Q2: agent-composed `stale-claim-pr.js` calls take the host from origin; tidy pin updated | 14 |
| Minor rulings: empty `GH_HOST` is unset on every path; Task 1 `Review risk: high`; enterprise-token clause follows the seam | 2 (`resolveRepoTarget`), 13; the old plan's Task 1 is this plan's Task 2, marked high |
| Decision round 4, Q1: every gated path reports `unknown-host` with the refusal text, never `no-repo-slug`/`network-failure` | 3, 4, 5, 6, 7, 8, 9, 13, 15 |
| Decision round 4, Q1: alias advice fixed once in the shared refusal text, pinned by a test | 1 (pins), 4, 13, 15 (assert the alias text on real paths) |
| Decision round 4, Q2: `stale-claim-pr.js` resolves one host for listing and matching, precedence typed `--repo` > `GH_HOST` > github.com | 2, 13 |
| Decision round 4, Whole family: one resolved host for gh + host comparison (listing vs matching, tombstone checks, MCP path) | 2, 11, 12, 13, 14; sweep and the claim-log.js classification in Global Constraints |
| Decision round 4, Plan markers: old Tasks 4 and 8 `Review risk: high`; the reviewer's 3 medium defects applied | old Task 4 → Tasks 6 and 9, old Task 8 → Task 14, all marked high; defects: Task 10's swaps list all three sites incl. the `gateDeps` loop and Task 2's comparison; Tasks 9 and 12 add the GHE sibling-sessions and claim-targets real-wiring cases; Task 14 has one `{host}` definition; Tasks 4 (now 6, 9) and 8 (now 14) marked high |
| Decision round 5, Q1: AC2 holds whatever `GH_HOST` is; `--repo` bare whenever the host is gh's default host, the match host following `GH_HOST` | 2 (formula and cases), 12, 13 (github.com origin and bare `--repo` under `GH_HOST`) |
| Decision round 5, Q2: empty `GH_HOST` unset in `ghOptions` too | 17 (and `explicitRepoGhHost`, so an explicit `--repo` cannot split either) |
| Review defect (high): one normalized origin read for credentials, port and `ssh://` | 1 (gate), 2 (`repoTargetOf` cases), 13 (stale-claim-pr), 16 (whole pass), 18 (journey) |
| Review defect (low): sibling-sessions' claim read bound to the hook's `cwd` | 9 (`defaultGhApi` cwd, AC1.1 from an outside `process.cwd()`) |
| Review defect (low): exit-3 re-run `{host}` falls back to github.com, pinned | 14 |
| No claim-targets exception: `unknown-host` with the corrected text, no gh call | 12 (stop and tests), 18 (exit-2 prose) |
| AC1.1 | 4, 5, 6, 9, 12, 13, 15, 16, 17 |
| AC2.1 | 2, 4, 5, 11, 12, 13, 17 (github.com twins) |
| AC3.1 | 16 Step 4 |
| Key File `plugin/bin/lib/hooks/git-exec.js` | 2, 10 (Task 1 changes only its tests) |
| Key File `plugin/bin/lib/issues/claim-store.js` | 9, 11 |
| Key File `plugin/bin/lib/reconcile/release-merged.js` | 4, 10 |
| Key File `plugin/bin/lib/reconcile/pr-state.js` | 6 |
| Key File `plugin/bin/lib/reconcile/post-merge.js` | No code change (#4933 on main); pinned by Task 15 (waiver above) |
| Key File `tests/gh-host-seam-behavior.test.js` | 4, 5, 6, 9, 12, 13, 15, 16 |
