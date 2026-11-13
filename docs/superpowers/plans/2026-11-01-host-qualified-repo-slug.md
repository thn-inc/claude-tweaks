# Host-qualified origin repo slug Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every origin-derived repo that reconcile, the claim store and `stale-claim-pr.js` hand to `gh` goes through #4933's origin-host gate (`gateOriginRepo`, ADR 0030). On a GitHub Enterprise origin those `gh` calls reach the origin's host, and each command takes its `--repo` and its PR-url host from one resolved host value. A refused origin (an SSH alias or an unknown host) makes no `gh` call and reports `unknown-host` with the gate's refusal text, and an SSH origin's text never names its own host as a `GH_HOST` value (round 6, Q4): it gives the alias advice (the real host the alias maps to) and the generic GitHub Enterprise opt-in. On a github.com origin, every argv and env stays byte-identical, whether or not `GH_HOST` is exported (round 5, Q1). The gate judges an origin only by its normalized host (userinfo, port and scheme dropped, the seam's read), so a credentialed, ported or `ssh://` `*.ghe.com` origin reaches one host on every path, and the same spelling on an unknown host or an SSH alias is refused exactly as its plain spelling is (round 6, Q1); no cloud sandbox proxy remote parses under that read, so its fallback is unchanged. `pr-state-batch.js` does not run when a non-empty `GH_HOST` names another host (round 6, Q3), and the agent-composed MCP `--listing` calls name the MCP's host (round 6, Q2). An exported but empty `GH_HOST` is unset on every path, `ghOptions` included (round 5, Q2). claim-targets refuses a gated origin with `unknown-host` like every other gated path.

**Architecture:** `repo-resolve.js` gains `resolveRepoTarget({ owner, repo, explicitHost, originHost }, deps)`, the one host resolver: a typed host-qualified `--repo` host, else a non-empty exported `GH_HOST`, else the caller's origin host, else `github.com`. It returns `{ host, ghRepo }`, `ghRepo` being the `--repo` value: bare whenever the host equals gh's default host (a non-empty exported `GH_HOST`, else github.com), host-qualified otherwise. `gateOriginRepo` judges `parseRepo(hostPathOf(remote))` alone (Task 1), and `ghOptions`/`explicitRepoGhHost` read an empty `GH_HOST` as unset (Task 17). `git-exec.js` gains `repoTargetOf(repoRoot, gateDeps)` on top of the already-gated `repoSpecOf`: `null`, `{ refusal }`, or `{ owner, repo, slug, host, ghRepo }` (`slug` stays the bare `owner/repo` for `repos/…` paths, GraphQL pairs and slug comparisons). `repoSlugOf` is retired once no caller remains. An SSH remote's refusal text gains the alias advice and names no host as a `GH_HOST` value. release-merged, archive-merged, reap-merged, pr-state, prune-remote, archive-branches and sibling-sessions move onto `repoTargetOf` and report a refusal as `unknown-host` with the refusal text; residue escalation carries a refused origin as a `{ refusal }` residue repo that escalates nothing. `claim-store.js`'s listing and matching take one `{ host, ghRepo }` target; claim-targets gates its origin first (a refusal exits 2, `unknown-host`, before any gh call) and builds the target from the gh seam's host, and `stale-claim-pr.js` builds it from the gate (origin) or a typed `--repo`. The agent-composed `stale-claim-pr.js` calls drop `--repo`, with one `{host}` definition for the fallback, github.com when origin does not parse, and their MCP `--listing` re-run passes `--repo "github.com/{owner}/{repo}"`. post-merge and teardown already refuse through the gate on main; this plan pins the SSH-alias case there. Task 18 updates the claim-targets exit-2 prose and the gate's CLI roster. Task 19 skips `pr-state-batch.js` under a `GH_HOST` naming another host, and Task 20 fixes the one other split site the widened sweep found (`engine-verify.js`'s `upstream-feedback` check) the same way, by not running it. Tasks 21 and 22 move the two raw-parse origin refusals outside the gate (`activity-gather.js`, `parent-gate.js --facts-json`) onto the seam's normalized read (blanket rule 1).

**Tech Stack:** Node 18+ CommonJS under `plugin/bin/`, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-11-04T100347-record-4794/work/4794-spec.md` (record #4794)

**Scope keywords:** repoSlugOf, repoSpecOf, openPrListArgs, isSameRepoPrUrl, staleClaimInFlightPr, tombstoneInFlightPr, matchStaleClaimPr, ghApiDelete, gateOriginRepo, fetchBatch

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
- **SSH advice (spec round 4, Q1; round 6, Q4, Reading A).** Fixed once, in `gateOriginRepo`'s refusal text (Task 1). Every SSH remote gets one text, whatever its host looks like (an alias, a dotted name, an IP address): the alias advice (export `GH_HOST` as the real host the alias maps to, e.g. `export GH_HOST=github.com`, not the alias name) plus the generic "if it is GitHub Enterprise, export GH_HOST as that server's host". It never names its own host as a `GH_HOST` value. An SSH remote is scp-style (`git@host:o/r`, `host:o/r`) or an `ssh://`, `git+ssh://` or `ssh+git://` URL: Reading A now refuses the URL forms on their normalized host, and their host resolves through `~/.ssh/config` exactly as an scp host does, so an `ssh://git@github-work/…` alias must not be told `GH_HOST=github-work` either (blanket rule 3; `tests/bin-lib/repo-resolve.test.js` :269 already names `git+ssh://alias/o/r` and `ssh+git://alias/o/r` as alias shapes). Any other remote (HTTPS, `http://`, `git://`) keeps today's text byte-identical, `export GH_HOST=${host}` included. The round-5 plan's separate DNS-shaped scp text and its helper are dropped. Refusal-text test sweep: `git grep -n -E "git@[a-z0-9.-]*(invalid|example|corp|work)[a-z0-9.-]*:" -- tests` prints 19 lines; only `tests/hooks-git-exec.test.js` :446 (the #4933 loop's scp origin) and `tests/bin-lib/repo-resolve.test.js` :484 (`review focus 4`) are refused scp origins whose text a test pins, both flipped in Task 1. Every other hit opts in through `GH_HOST`, is the seam's or `parseRepo`'s own case, is not the gate (`activity/gather-cli`, `pr-state-batch`), or is reworked by Task 13 (`stale-claim-pr-cli` :353). Every other test that asserts `GH_HOST=git.corp.invalid` text (`stuck-open-pr`, `post-merge`, `release-claim/cli`, `repair-claim/cli`, `wrap-up/pack`, `hooks-teardown-run`, `gh-host-seam-behavior`'s `UNKNOWN_HOST` rows) uses an HTTPS origin, whose text is unchanged.
- **Blanket rule (spec, round 6), checked against every task.** (1) Whether an origin is refused depends only on its normalized host (`normalizeHost` of `parseRepo(hostPathOf(remote))`'s host), never on how its URL is spelled. (2) Every `gh` call and host comparison within one command or one reconcile pass uses one resolved host. (3) No refusal text tells the user to set `GH_HOST` to an alias or an unverified host name. Per task: Task 1 makes (1) and (3) true at the gate, and every path that refuses (Tasks 3-9, 12, 13, 15) relays that one text unchanged, so they inherit both; Task 2's `resolveRepoTarget` is the single host per command for (2), consumed by Tasks 4, 5, 9, 11, 12 and 13; Task 14 makes the agent-composed listing and match share the MCP's host; Task 17 stops an empty `GH_HOST` splitting `ghOptions` from the gate; Task 19 stops `pr-state-batch.js` reading github.com while the per-item calls read `GH_HOST`; Task 20 fixes `engine-verify.js`'s `upstream-feedback` split; Tasks 10, 16 and 18 change no host and refuse nothing. Outside the gate, two raw `parseRepo` origin readers *refuse* (exit 2) an `ssh://`, credentialed or ported spelling of an origin whose plain spelling they accept: `activity-gather.js` ("origin remote is not a GitHub URL", which also hits `ssh://git@github.com/o/r`) and `parent-gate.js --facts-json` ("could not resolve owner/repo from the origin remote"). Rule 1 covers any origin refusal (plan review, spec: "If the build finds another site or case these cover, it applies the rule there without asking."), so Tasks 21 and 22 move both onto the normalized read. Three more raw readers refuse nothing — `engine-verify.js`'s carrier-commit check (degrades to its textual `fail`) and reference-repairs check (`unknown`), and `pr-state-batch.js`'s `githubOrigin` (a skipped accelerator, the per-item path answers) — so rule 1 does not reach them; wrap-up files one backlog record for that spelling gap (`/claude-tweaks:capture`, spec-shaped body, `Defer-reason:` per `_shared/deferral-gate.md`).
- **One host per command (spec round 4, Q2 and "Whole family").** Any command that both calls `gh` and compares a host takes both from one `resolveRepoTarget` result, never from two separately derived values. Precedence: a typed host-qualified `--repo` host, then a non-empty (after `trim()`) exported `GH_HOST`, then the caller's origin host, then `github.com`. A bare typed `--repo owner/repo` therefore means github.com only when `GH_HOST` is unset or empty. The `--repo` value is host-qualified only when that host differs from gh's default host (round 5, Q1), so the listing's argv stays today's whenever gh already reaches the host. Split sites found at planning time and fixed here: claim-targets (Task 12) and stale-claim-pr.js (Task 13) listing vs matching, the MCP/tidy prose `{host}` and the MCP `--listing` leg (Task 14), `pr-state-batch.js` (Task 19, round 6 Q3) and `engine-verify.js`'s `upstream-feedback` check (Task 20). Two sweeps were run for others:
  - `git grep -n -l -F -e 'github\.com' -e 'github\\.com' -e isSameRepoPrUrl -- plugin/bin` (the regex-literal and string-escaped spellings): claim-store.js and stale-claim-pr.js (fixed here), mcp-pr-shape.js (a comment), the statusline's and `release-local/changelog.js`'s origin parses and `release-preflight/pack.js`'s bot-email test (no host compared against a gh call), `wrap-up/engine-verify.js`'s `upstream-feedback` check (a split site, Task 20, below), and `plugin/bin/lib/log-decision/claim-log.js`'s `resume-pr:` regex. claim-log.js reads `decisions.md` and calls no `gh`, so it is not a split site under the rule; its github.com-only `resume-pr` shape is filed as a backlog record at wrap-up (`/claude-tweaks:capture`, spec-shaped body), not fixed here.
  - Widened (round 6 Q3), plain string literals: `git grep -n -F -e "'github.com'" -e '"github.com"' -- plugin/bin` prints 35 lines in 18 files. Verdicts:
    - `lib/repo-resolve.js` (7: :66, :79, :150, :152, :178, :275, :276): the seam, the gate and the slug producer that define the host rule.
    - `stale-claim-pr.js` :190: the github.com-only stop Task 13 removes.
    - `lib/reconcile/pr-state-batch.js` :143 (`GITHUB_HOST`): **split site.** The batch pins `--hostname github.com` while the per-item `gh pr view`/`gh pr list` calls it stands in for infer their host through gh, which follows an exported `GH_HOST`; under `GH_HOST=mine.example` on a github.com origin one reconcile pass reads PR state from two hosts. Task 19.
    - `lib/wrap-up/engine-verify.js` :1190: **split site.** `repoSlug({ host: 'github.com', owner, repo })` is the bare `owner/repo`, which gh sends to an exported `GH_HOST`, while the check's URL regex (:1186) matched `github.com`; the round-5 plan's "already one fixed host" verdict was wrong. Task 20 fixes it by round 6 Q3's rule (the call does not run under a `GH_HOST` naming another host; the argv of every call that still runs is unchanged), not by qualifying the argv.
    - `activity-gather.js` :109, :120: every `--repo` entry is pinned to github.com, and an origin on another host stops the CLI; it compares no host taken from a gh answer, so each run uses one host. Not a split site (its raw origin parse, a rule-1 refusal, is Task 21; `parent-gate.js --facts-json`'s is Task 22).
    - `--hostname` argv builders, each threading the one host its command already resolved (the gate's or a typed `--repo`'s) and comparing no host from a gh answer: `fetch-sub-issues.js` :89, :166; `lib/backlog-grant-gate/backlog-grant-gate.js` :129; `lib/compose-subject.js` :246; `lib/hooks/teardown-run.js` :29, :36; `lib/issues/cross-repo-states.js` :124, :137; `lib/issues/link.js` :53, :68, :92; `lib/issues/linked-prs.js` :37, :47; `lib/issues/native-dependencies.js` :38, :49; `lib/issues/parent-gate.js` :131, :242; `lib/issues/resolved-refusal.js` :165; `lib/preflight-records/blocker-landing.js` :126, :251; `lib/release-claim/release.js` :54, :92; `materialize.js` :230. Not split sites.
  If the build finds another split site, it applies the rule there without asking (spec).
- An exported but empty (or whitespace-only) `GH_HOST` is treated as unset on every path (spec minor ruling and round 5, Q2): the gate and `resolveRepoTarget` already do, and Task 17 changes `ghOptions` and `explicitRepoGhHost` (#4505) to match, so one reconcile pass never splits across hosts. Every host comparison goes through `normalizeHost` (case-insensitive, trailing dots ignored).
- **One origin read, one verdict per host (the reviewer's high defect, spec "Review defects"; round 6, Q1, Reading A).** The seam reads origin as `parseRepo(hostPathOf(url))`; the gate read `parseRepo(remote)`, which rejects a `*.ghe.com` origin with userinfo (`https://oauth2@acme.ghe.com/acme/w.git`), a port, or an `ssh://` scheme, so `repoTargetOf` fell back to github.com while the seam injected `GH_HOST=acme.ghe.com`. Task 1 makes the gate judge that normalized read alone, `parseRepo(hostPathOf(remote))`, its only parse. The round-5 plan's raw-read branch (an origin only the normalized read parsed, on a refused host, kept the unparseable verdict: "never a new refusal") is gone: a credentialed, ported or `ssh://` origin on an unknown host or an SSH alias now reports the same `unknown-host` refusal its plain spelling does (`ssh://git@git.corp.invalid/acme/w.git` refused as `git@git.corp.invalid:acme/w.git` is, `https://oauth2@git.corp.invalid/acme/w.git` as `https://git.corp.invalid/acme/w.git` is, `ssh://git@github-work/acme/w.git` as `git@github-work:acme/w.git` is).
  - **Cloud sandbox proxy remotes do not parse under that read, so no carve-out is needed.** The repo's own code names no proxy shape (`git grep -n -i -e proxy -e 127.0.0.1 -e localhost -- plugin/bin/lib/repo-resolve.js plugin/bin/lib/hooks/git-exec.js tests/bin-lib/repo-resolve.test.js tests/hooks-git-exec.test.js` prints nothing, and #4857's body names only `ssh://git@ghe.example/o/r.git`). The shape recorded in this machine's session transcripts is `http://local_proxy@127.0.0.1:{port}/git/{owner}/{repo}` (seen as `…:43210/git/thn-inc/claude-tweaks` and `…:43215/git/acme/w`). `hostPathOf` reduces it to `127.0.0.1/git/{owner}/{repo}`, three path segments, which `parseRepo` rejects; with `.git`, a trailing `/`, no `local_proxy@`, or `localhost` for `127.0.0.1` it is rejected the same way (probed at plan time against this tree's `parseRepo`). It stays `{ spec: null, refusal: null }`, so `repoSpecOf`'s #4857 fallback, claim-targets' `gh repo view` path and `stale-claim-pr.js`'s exit-3 `--repo` re-run are unchanged. Task 1 pins those shapes, plus one contrast: `http://local_proxy@127.0.0.1:43215/acme/w` (no `/git/` segment; not a shape any sandbox was seen using) does parse, host `127.0.0.1`, and is refused like any unknown host. That pin keeps the boundary visible: a carve-out is needed only if a sandbox ever drops the `/git/` segment.
  - **Test flips.** `git grep -n -E "ssh://|git\+ssh://|https?://[^/'\" ]*@|https?://[^/'\" ]+:[0-9]+/" -- tests` finds two gated origins, both in Task 1: `tests/hooks-git-exec.test.js` :471 (`ssh://git@git.corp.invalid/acme/w.git`: was the loose fallback `{ host: null, … }`, now `{ refusal }`, the same text its scp spelling gets) and :477 (`ssh://git@github.com/acme/w.git`: was `host: null`, now `host: 'github.com'`). Every other hit is the seam's own cases (`tests/bin-lib/repo-resolve.test.js` :269-395, unchanged) or a URL that is not an origin or not read by the gate (`pr-state-batch`, `release-local`, `statusline`, `packet-render`, `packet-links`, `acceptance-packet-cli`, `acceptance-packet-contract-conformance`, `resolve-policy-control-mode`, `visual-decide`, `qa-prompts-step-origin`). The `file://` origins in `tests/bin-lib/docs-health/` and `tests/bin-lib/verify/cli-baseline-verdicts.test.js` reduce to an absolute path that neither read parses. The 18 gated files other than `lib/repo-resolve.js` (`git grep -n -l gateOriginRepo -- plugin/bin`, 19 lines) have no test with a gated `ssh://`, userinfo or ported origin on an unknown host, so none of them flips.
- **Explicit `--repo` (spec round 2):** a typed host-qualified `--repo` on `stale-claim-pr.js` is trusted for any host and is not gated (ADR 0030: "A user-typed `--repo` is not gated"). No agent-composed call relies on a bare `--repo` (spec round 3, Q2).
- A remote the normalized read does not parse (a cloud sandbox proxy remote, `http://local_proxy@127.0.0.1:{port}/git/{owner}/{repo}`; a local path; a `file://` URL) keeps `repoSpecOf`'s #4857 fallback (owner/repo from the last two path segments, host unknown): its target host is `GH_HOST` or github.com, which is also where the seam sends it, so the pass does not split. #4857 owns that case; Task 2 pins it with the proxy shape. An `ssh://` origin no longer reaches the fallback: the gate admits or refuses it on its host.
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
- Fixture sweep for origins the gate now refuses (`git grep -n -o -E "'(https?://|git@)[^' ]+'" -- tests/bin-lib/reconcile 'tests/reconcile*.test.js' tests/hooks-sibling-sessions.test.js`): every reconcile-module fixture uses `git@github.com:acme/w.git` or a local path, except `https://example.invalid/…` in `tests/bin-lib/reconcile/prune-remote.test.js` :316 (fixed in Task 7) and in `tests/reconcile.test.js`, `tests/reconcile-preflight-fetch.test.js` and `tests/reconcile-archive-residue.test.js` (pre-split `tests/reconcile.test.js` :148, :1426, :2360, :3850), which run only mirror or origin-head (no gated check) and stay unchanged.
- A test that compares a refusal compares it to the gate's own string computed in the test (`gateOriginRepo(remote, gateDeps).refusal`), never a hand-copied literal, except Task 1's exact-copy pins.
- Rail (`RAIL_BYTES` 52500, `plugin/bin/lib/skill-audit/budgets.js`), measured on this tree: `plugin/skills/tidy/scan-procedures.md` 52447 bytes (53 headroom), `plugin/skills/_shared/issue-claims.md` 50800 bytes by `wc -c` (plan-audit's rail measurement, `when:` lines stripped: 50191). The composed `claims` bundle that draws on issue-claims.md measures 50338 at its four call sites (`dispatch/task-prompt.md` :107/:109, `flow/claim-targets.md` :223, `tidy/scan-procedures.md` :212). Task 14 keeps each file at or below today's size, so neither the files nor that bundle grow; check `wc -c` after the edit and trim words in the same paragraphs, never elsewhere. Task 18 edits `plugin/skills/flow/claim-targets.md` (39278 bytes, 13222 headroom) and no other governed-corpus file.
- Empty-`GH_HOST` fixture sweep (Task 17, `git grep -n -F -e "GH_HOST: ''" -- tests`): `tests/helpers/git-fixtures.js` :114, `tests/bin-lib/phase-exit/phase-exit.test.js` :777, `tests/merge-verification.test.js` :220 and `tests/resolve-policy-cli.test.js` :377 set it only to mask a developer's own `GH_HOST`, over local-path or github.com origins where the seam injects nothing either way: unchanged. The three `tests/bin-lib/repo-resolve.test.js` pins of "empty wins" (:157-163 `AC4.1`, :309-314 `explicitRepoGhHost AC4`, :330-338 `#4795 … empty string included`) flip in Task 17, each with its own verdict there.

## Review Focus

1. **SSH host-alias origin** (`git@github-work:acme/widgets.git`, and its `ssh://` spelling): the refusal tells the user `export GH_HOST=github.com`-style advice plus the generic GitHub Enterprise opt-in, and never `GH_HOST=github-work`; an SSH origin on a dotted host (`git@git.corp.invalid:…`, `git@10.0.0.5:…`) never names its own host as a value either (Task 1, round 6 Q4); release, archive, reap, pr-state, prune-remote, archive-branches, sibling-sessions, stale-claim-pr.js, post-merge and teardown make no gh call and report `unknown-host` with that text (Tasks 4-9, 13, 15).
2. **`GH_HOST` exported:** a non-empty value is the host for both the listing and the PR-url match (claim-targets, stale-claim-pr.js), including over a GHE origin and over a bare typed `--repo`; a typed host-qualified `--repo` beats it; an empty value is no opt-in (Tasks 2, 11, 12, 13).
3. **Host-qualified value leaking into a comparison or path:** on a GHE origin, archive-merged's record check (`prClosesIssue` against `closingIssuesReferences`, which carry a host-less `owner/repo`), release-merged's `repos/…` paths and pr-state's GraphQL `owner`/`name` must still see the bare slug (Tasks 4, 5, 6).
4. **`process.cwd()` outside the repo root:** release-merged's calls follow the root's origin (Task 4).
5. **Cross-host and look-alike PR urls:** under host `acme.ghe.com`, `https://github.com/acme/widgets/pull/1` and `https://acmeXghe.com/acme/widgets/pull/1` are rejected, while `https://ACME.ghe.com./acme/widgets/pull/1` is accepted (Task 11).
6. **A refused origin never loops through escalation:** a structurally-stuck `unknown-host` run escalates through a `{ refusal }` residue repo that files nothing and calls no gh (Tasks 3, 5).
7. **`GH_HOST` exported on a github.com origin (round 5, Q1):** every `--repo` stays bare (`acme/widgets`); only the PR-url match host follows `GH_HOST` (Tasks 2, 12, 13).
8. **One origin read, verdict by host alone (round 5 review defect; round 6 Q1):** `https://oauth2@acme.ghe.com/…`, `https://acme.ghe.com:8443/…` and `ssh://git@acme.ghe.com/…` reach `acme.ghe.com` on both the gate's and the seam's paths in one pass; `ssh://git@git.corp.invalid/…`, `https://oauth2@git.corp.invalid/…` and `ssh://git@github-work/…` are refused with exactly the text their plain spellings get; and no cloud sandbox proxy remote (`http://local_proxy@127.0.0.1:{port}/git/{owner}/{repo}`) parses, so its #4857 fallback and `stale-claim-pr.js`'s exit 3 are unchanged (Tasks 1, 2, 13, 16).
9. **Empty `GH_HOST` on a GHE origin (round 5, Q2):** `ghOptions` injects the seam host over the empty value, so release-merged and residue escalation reach the same host (Task 17).
10. **claim-targets on an SSH-alias origin:** exit 2, `unknown-host` with the alias advice, and no gh call at all (Task 12).
11. **`GH_HOST` naming another host on a github.com origin (round 6 Q3, blanket rule 2):** `pr-state-batch.js` spawns nothing (no git, no gh) and every key goes to the per-item calls, whose argv is unchanged; `engine-verify.js`'s `upstream-feedback` issue view carries `--repo github.com/{owner}/{repo}`, and stays bare when `GH_HOST` is unset, empty or github.com (Tasks 19, 20).
12. **The MCP `--listing` leg names the MCP's host (round 6 Q2):** both agent-composed listing re-runs add `--repo "github.com/{owner}/{repo}"`, and the `gh`-path calls carry no `--repo` (Task 14).

---

### Task 1: the gate judges the normalized host alone, and an SSH origin's refusal names no host value

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/repo-resolve.js` (`gateOriginRepo` :137-157, the refusal at :153-156; the header :12-17)
- Modify: `docs/decisions/0030-unknown-origin-hosts-are-refused-not-degraded.md` (the Decision paragraph at :33-37, the Consequences bullet :76-77)
- Test: `tests/bin-lib/repo-resolve.test.js` (`refusalOf` :443, `review focus 4` :483-485), `tests/hooks-git-exec.test.js` (the import at :10-12, the #4933 refusal test :443-454, the `ssh://` tests :471-481), `tests/gh-host-seam-conformance.test.js` (`NOT_ORIGIN`'s `lib/repo-resolve.js` reason at :399; its count stays 1)

**Interfaces (normalized read; spec round 6, Q1, Reading A):**
- `gateOriginRepo(remote, deps)` keeps its signature and return shape. It reads origin once, the seam's way: `const parsed = parseRepo(hostPathOf(remote));` (`hostPathOf` is already in this file, :162; a hoisted function declaration). That is still the file's only `parseRepo(` call naming `remote`, so `tests/gh-host-seam-conformance.test.js`'s `NOT_ORIGIN` count for `lib/repo-resolve.js` stays 1, and its reason text is updated to name `parseRepo(hostPathOf(remote))` as the parse the gate judges. Then, unchanged in order: `!parsed` → `{ spec: null, refusal: null }`; `host = normalizeHost(parsed.host)`; a non-empty `GH_HOST` → `{ spec: { ...parsed, host: <as today> }, refusal: null }`; github.com or `isKnownGhHost` → `{ spec: { ...parsed, host }, refusal: null }`; otherwise the refusal below. There is no second, raw read and no "never a new refusal" branch: whether an origin is refused depends only on its normalized host (blanket rule 1), so a credentialed, ported or `ssh://` origin on an unknown host or an SSH alias gets the refusal its plain spelling gets. The header comment (:12-17) gains one sentence: the gate judges `parseRepo(hostPathOf(remote))` alone (userinfo, port and scheme dropped), so its verdict depends only on the host; a remote that read does not parse, such as a cloud sandbox's `http://local_proxy@127.0.0.1:{port}/git/{owner}/{repo}` proxy remote, is neither admitted nor refused.
- No carve-out: no cloud sandbox proxy-remote shape parses under that read (Global Constraints, "One origin read"); the proxy fixtures below prove it.

**Interfaces (SSH advice; spec round 4, Q1 and round 6, Q4, Reading A):**
- Its refusal, with `host` the normalized host and `PREFIX` = `` `origin host ${host} is not a known GitHub host (not github.com, not *.ghe.com, not a gh hosts.yml key) — refusing to send it to gh` ``:
  - not an SSH remote (HTTPS, `http://`, `git://`, a scheme-less `host/owner/repo`): `` `${PREFIX}; if it is GitHub Enterprise, export GH_HOST=${host}` `` (today's text, byte-identical).
  - an SSH remote, any host: `` `${PREFIX}; if it is an SSH host alias, export GH_HOST as the real host it maps to (e.g. export GH_HOST=github.com), not the alias name; if it is GitHub Enterprise, export GH_HOST as that server's host` ``. It never interpolates `host` after `GH_HOST=`.
- SSH remote: the trimmed remote is scp-style, matching `/^(?:[^@\s/:]+@)?[^@\s/:]+:(?!\/)/`, or an SSH URL, matching `/^(?:ssh|git\+ssh|ssh\+git):\/\//i`. One module-private helper, `isSshRemote(remote)`; the round-5 plan's DNS-shaped test is not written. The header comment on `gateOriginRepo` states the two texts and why: an SSH host may be an alias that resolves only through `~/.ssh/config`, whatever its shape (`github.com-work` and `git.corp.invalid` look alike), so its name is never offered as a `GH_HOST` value; an HTTPS host is a real DNS name the remote already reaches.

- [ ] **Step 1: Write the failing tests**
  - `tests/bin-lib/repo-resolve.test.js`: keep `refusalOf` (the HTTPS text) and add one `sshRefusalOf(host)` built from the SSH copy above. New and changed tests, each with `noHosts` (`env: {}`, throwing `readFile`) unless stated:
    - `test('#4794: an SSH origin gets the alias advice and the generic GHE opt-in, never its own host as a GH_HOST value', …)`: for `git@github-work:o/r.git`, `github-work:o/r.git`, `git@github.com-work:o/r.git`, `git@git.corp.invalid:o/r.git`, `git@10.0.0.5:o/r.git`, `ssh://git@github-work/o/r.git`, `ssh://git@git.corp.invalid:2222/o/r.git`, `git+ssh://git@github-work/o/r.git` and `ssh+git://github-work/o/r`, `gateOriginRepo(remote, noHosts)` deep-equals `{ spec: null, refusal: sshRefusalOf(<the normalized host>) }`; the refusal matches `/export GH_HOST=github\.com/` and `/export GH_HOST as that server's host/`, and does not match `new RegExp('GH_HOST=' + <the host, regex-escaped>)`.
    - `test('#4794: a non-SSH origin keeps the refusal text byte-identical, credentials, ports and a dotless host included', …)`: `https://git.corp.invalid/o/r.git`, `https://oauth2@git.corp.invalid/o/r.git`, `https://x:tok@git.corp.invalid:8443/o/r.git` and `http://git.corp.invalid/o/r.git` → `{ spec: null, refusal: refusalOf('git.corp.invalid') }`; `https://github-work/o/r.git` → `refusalOf('github-work')`. No refusal carries `oauth2`, `tok` or `8443`.
    - `test('#4794 blanket rule 1: every spelling of one origin gets its plain spelling\'s verdict', …)`: for each group, every member's `gateOriginRepo(member, deps)` deep-equals the first member's, once with `noHosts` and once with `{ ...noHosts, env: { GH_HOST: 'git.corp.invalid' } }`: [`git@git.corp.invalid:acme/w.git`, `ssh://git@git.corp.invalid/acme/w.git`, `ssh://git@git.corp.invalid:22/acme/w.git`, `git+ssh://git@git.corp.invalid/acme/w.git`]; [`https://git.corp.invalid/acme/w.git`, `https://oauth2@git.corp.invalid/acme/w.git`, `https://git.corp.invalid:8443/acme/w.git`]; [`git@github-work:acme/w.git`, `ssh://git@github-work/acme/w.git`]; [`git@acme.ghe.com:acme/w.git`, `ssh://git@acme.ghe.com/acme/w.git`, `https://oauth2@acme.ghe.com/acme/w.git`]. With `noHosts` the first three groups are refusals and the fourth is `{ spec: { host: 'acme.ghe.com', owner: 'acme', repo: 'w' }, refusal: null }`; with the `GH_HOST` env the first two are `{ spec: { host: 'git.corp.invalid', owner: 'acme', repo: 'w' }, refusal: null }`.
    - `test('#4794: no cloud sandbox proxy remote parses under the normalized read — the gate neither admits nor refuses it', …)`: for `http://local_proxy@127.0.0.1:43210/git/thn-inc/claude-tweaks`, `http://local_proxy@127.0.0.1:43215/git/acme/w`, `http://local_proxy@127.0.0.1:43215/git/acme/w.git`, `http://local_proxy@127.0.0.1:43215/git/acme/w/`, `http://127.0.0.1:43215/git/acme/w` and `http://local_proxy@localhost:43215/git/acme/w`, `gateOriginRepo(url, deps)` deep-equals `{ spec: null, refusal: null }` with `noHosts` and with `env: { GH_HOST: 'github.com' }`. Contrast, in the same test: `http://local_proxy@127.0.0.1:43215/acme/w` (no `/git/` segment, not a sandbox shape) deep-equals `{ spec: null, refusal: refusalOf('127.0.0.1') }`, so the null verdict above comes from the `/git/` segment, not from the loopback host.
    - Normalized read: `test('#4794: the gate reads a credentialed, ported or ssh:// origin the way the seam does', …)`: for `https://oauth2@acme.ghe.com/acme/w.git`, `https://x:tok@acme.ghe.com/acme/w.git`, `https://acme.ghe.com:8443/acme/w.git`, `ssh://git@acme.ghe.com/acme/w.git` and `ssh://git@acme.ghe.com:22/acme/w.git`, `gateOriginRepo(url, noHosts)` deep-equals `{ spec: { host: 'acme.ghe.com', owner: 'acme', repo: 'w' }, refusal: null }` and `gateOriginRepo(url, noHosts).spec.host === resolveGhHost('/n-' + i, { ...ghe, remoteUrl: () => url })` (one host for the gate and the seam; `_resetGhHostCache()` per url); `ssh://git@github.com/acme/w.git` → `spec.host === 'github.com'`.
    - Change `review focus 4` (:483-485) to expect `sshRefusalOf('git.corp.invalid')`.
  - `tests/hooks-git-exec.test.js` (add `const { gateOriginRepo } = require('../plugin/bin/lib/repo-resolve');` beside the import at :10-12):
    - The #4933 loop :443-454 is **changed**, per url: `https://git.corp.invalid/acme/w.git` keeps `assert.match(got.refusal, /export GH_HOST=git\.corp\.invalid/, url)`; `git@git.corp.invalid:acme/w.git` instead asserts `got.refusal === gateOriginRepo(url, gateDeps).refusal`, a match on `/export GH_HOST as that server's host/` and no match on `/GH_HOST=git\.corp\.invalid/` (round 6 Q4: no scp refusal names its own host). Both keep the `Object.keys` and "is not a known GitHub host" assertions. Its title gains "(#4794: an scp origin's names no host value)".
    - Add `test('repoSpecOf (#4794): an SSH-alias origin returns { refusal } advising the real host, never the alias', …)`: origin `git@github-work:acme/w.git`, the test's `gateDeps` → `Object.keys(got)` is `['refusal']`, `got.refusal` matches `/origin host github-work is not a known GitHub host/`, `/export GH_HOST=github\.com/` and `/export GH_HOST as that server's host/`, and does not match `/GH_HOST=github-work/`.
    - The `ssh://` pins: :471 (`ssh://git@git.corp.invalid/acme/w.git`) is **flipped**: `Object.keys(got)` is `['refusal']`, `got.refusal === gateOriginRepo('git@git.corp.invalid:acme/w.git', gateDeps).refusal` (its scp spelling's text) and it does not match `/GH_HOST=git\.corp\.invalid/`; retitled `repoSpecOf (#4794): an ssh:// origin on an unknown host is refused exactly as its scp spelling is`. :477 (`ssh://git@github.com/acme/w.git`) is **flipped**: `repoSpecOf(repo)` now deep-equals `{ host: 'github.com', owner: 'acme', repo: 'w' }` (the gate reads it), retitled `repoSpecOf (#4794): an ssh:// github.com origin is read by the gate, host github.com`; its `repoSlugOf(repo) === 'acme/w'` line stays until Task 10.
  - `tests/gh-host-seam-conformance.test.js`: `NOT_ORIGIN['lib/repo-resolve.js'].reason` (:399) is reworded to "defines the gate: gateOriginRepo's own `parseRepo(hostPathOf(remote))` is the one parse the gate judges. resolveGhSpec's `parseRepo(hostPathOf(url))` names no token and is unmatched; harmless, since this file is the seam"; `count` stays 1.

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test tests/bin-lib/repo-resolve.test.js tests/hooks-git-exec.test.js`
Expected: FAIL after Step 1 — every scp case gets today's `export GH_HOST=<host>` text (the alias cases, `review focus 4`, and the #4933 loop's scp origin); the `ssh://`, `git+ssh://` and `ssh+git://` refusal cases and the credentialed and ported HTTPS cases on `git.corp.invalid` get `{ spec: null, refusal: null }`; the blanket-rule groups differ from their first member; every admitted normalized-read case gets `{ spec: null, refusal: null }`; the flipped :471 case gets the loose fallback and :477 gets `host: null`. The proxy-shape cases pass before and after (they pin an unchanged verdict): after Step 3, prove they can go red by temporarily replacing the `!parsed` return with a refusal for every remote, see them fail, then restore.

- [ ] **Step 3: Implement** the single normalized read, `isSshRemote` and the two texts in `gateOriginRepo`, and the conformance reason. Then add one sentence to ADR 0030's Decision paragraph after "naming the host and the `export GH_HOST={host}` opt-in": "An SSH origin (scp-style, or an `ssh://`, `git+ssh://` or `ssh+git://` URL) is instead told to export `GH_HOST` as the real host an SSH alias maps to (e.g. `GH_HOST=github.com`), not the alias name, or, if it is GitHub Enterprise, as that server's host: it never names its own host as a value, since an SSH host may be an alias that resolves only through `~/.ssh/config` (#4794)." Reword the Consequences bullet :76-77 to: "The gate judges the normalized host (`parseRepo(hostPathOf(remote))`: userinfo, port and scheme dropped, #4794), so a credentialed, ported or `ssh://` origin is admitted or refused exactly as its plain spelling is. A remote that read does not parse (a cloud sandbox's `http://local_proxy@127.0.0.1:{port}/git/{owner}/{repo}` proxy remote, a local path) is neither; #4857 owns that case." Behavior-change prose sweep, re-run for round 6 Q4 (`git grep -n -e 'GH_HOST={host}' -e 'GH_HOST=<host>' -- plugin docs .claude ':!docs/superpowers/plans'`, 16 lines): ADR 0030 :34 gets the sentence above; every other hit (`.claude/skills/driver-skill-outcome-taxonomy/SKILL.md` :107, `docs/journeys/opt-in-an-unknown-origin-host-with-gh-host-4933.md` :33, `docs/journeys/review-backlog-attention-queue.md` :31, `docs/journeys/run-a-pipeline-on-a-ghe-origin-without-gh-host-4505.md` :65, `docs/plugin-structure.md` :140/:197/:231, `docs/reconcile-checks.md` :599, `plugin/bin/materialize.js` :26, `post-merge-run.js` :40, `release-claim.js` :40, `repair-claim.js` :16, `stuck-open-prs.js` :32/:53, `plugin/skills/backlog/attention-mode.md` :103) names the `GH_HOST` opt-in mechanism with a placeholder, generically or for the 4933 journey's HTTPS persona, and none describes an scp or `ssh://` origin being told its own host: no change (the spec fixes the advice "once, in the shared gate refusal text"). A second sweep for prose about SSH origins and `GH_HOST` (`git grep -n -i -E "(scp|ssh|git@[A-Za-z0-9.-]+:|alias).{0,120}GH_HOST|GH_HOST.{0,120}(scp|ssh|git@[A-Za-z0-9.-]+:|alias)" -- plugin docs .claude ':!docs/superpowers/plans'`) prints only `docs/journeys/run-a-pipeline-on-a-ghe-origin-without-gh-host-4505.md` :47/:48, which describe the seam's injection, not a refusal text: no change.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/bin-lib/repo-resolve.test.js tests/hooks-git-exec.test.js tests/gh-host-seam-conformance.test.js tests/gh-host-seam-behavior.test.js tests/bin-lib/reconcile/post-merge.test.js tests/reconcile*.test.js tests/hooks-teardown-run.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/repo-resolve.js docs/decisions/0030-unknown-origin-hosts-are-refused-not-degraded.md tests/bin-lib/repo-resolve.test.js tests/hooks-git-exec.test.js tests/gh-host-seam-conformance.test.js
git commit -m "Judge origin by its normalized host in the gate, and name no host value in an SSH refusal (refs #4794)"
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
    - `git@github-work:acme/widgets.git` → `{ refusal }` (Review Focus 1); `ssh://git@github-work/acme/widgets.git` → deep-equals that same `{ refusal }` (blanket rule 1)
    - GHE origin with `env: { GH_HOST: 'mine.example' }` → `host: 'mine.example', ghRepo: 'acme/widgets'`; with `env: { GH_HOST: 'ACME.ghe.com' }` → `host: 'acme.ghe.com', ghRepo: 'acme/widgets'` (Review Focus 2, 7: gh's default host is `GH_HOST`)
    - `https://github.com/acme/widgets.git` with `env: { GH_HOST: 'mine.example' }` → `host: 'mine.example', ghRepo: 'acme/widgets'` (AC2 with `GH_HOST` exported, Review Focus 7)
    - `https://ghe.example.com/acme/widgets.git` with `env: { GH_HOST: '  ' }` → `{ refusal }`
    - `ssh://git@acme.ghe.com/acme/widgets.git`, `https://oauth2@acme.ghe.com/acme/widgets.git` and `https://acme.ghe.com:8443/acme/widgets.git` → `{ owner: 'acme', repo: 'widgets', slug: 'acme/widgets', host: 'acme.ghe.com', ghRepo: 'acme.ghe.com/acme/widgets' }` (Task 1's normalized read, Review Focus 8)
    - `ssh://git@git.corp.invalid/acme/widgets.git` → deep-equals `{ refusal: gateOriginRepo('git@git.corp.invalid:acme/widgets.git', gateDeps).refusal }` (round 6 Q1: refused as its scp spelling is, no longer #4857's fallback)
    - `http://local_proxy@127.0.0.1:43215/git/acme/widgets` (a cloud sandbox proxy remote) → `{ owner: 'acme', repo: 'widgets', slug: 'acme/widgets', host: 'github.com', ghRepo: 'acme/widgets' }` (#4857's fallback: the normalized read does not parse it, so the gate neither admits nor refuses it); with `env: { GH_HOST: 'mine.example' }` → `host: 'mine.example', ghRepo: 'acme/widgets'`
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

Run: `node --test tests/bin-lib/reconcile/escalate-residue.test.js tests/bin-lib/reconcile/cache.test.js tests/bin-lib/reconcile/reap-merged.test.js tests/bin-lib/reconcile/archive-merged.test.js tests/bin-lib/reconcile/archive-merged-record-guards.test.js`
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

Run: `node --test tests/gh-host-seam-behavior.test.js tests/bin-lib/reconcile/release-merged.test.js tests/reconcile*.test.js`
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
- Test: `tests/gh-host-seam-behavior.test.js`, `tests/bin-lib/reconcile/archive-merged.test.js` and `tests/bin-lib/reconcile/archive-merged-record-guards.test.js` (extend `fixtureOrdinaryMergedNoConsole`, now in `tests/bin-lib/reconcile/archive-merged-helpers.js`, pre-split `archive-merged.test.js:3967-4018`: `origin` accepts a URL string, `true` keeping today's `git@github.com:acme/w.git`, and a new `gateDeps` option forwarded to `archiveMerged`; reword the `repoSlugOf` comments at :2416 and :3961 to `repoTargetOf`, keeping each sentence's claim), `tests/bin-lib/reconcile/reap-merged.test.js`

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
  - `archive-merged-record-guards.test.js`:
    - `test('#4794 Review Focus 3: on a *.ghe.com origin a merged run whose PR closes its record still archives (record check compares the bare slug)', …)`: `fixtureOrdinaryMergedNoConsole(…, { origin: 'https://acme.ghe.com/acme/w.git', closes: [<the run's record>], gateDeps })` and the helper's existing archived-with-`closes` assertions.
    - `test('#4794: an SSH-alias origin skips the record check unknown-host with the refusal as hint, never no-repo-slug', …)`: `{ origin: 'git@github-work:acme/w.git', closes: [3503], gateDeps }` → not archived, the skip's `reason === 'unknown-host'`, `hint === gateOriginRepo('git@github-work:acme/w.git', gateDeps).refusal`; with `staleMs: STRUCTURALLY_STUCK_TTL_MS * 2` the run accumulates a `structurally-stuck` residue entry (as the F3 test :4737 asserts for `no-repo-slug`).
    - `test('#4794 decideArchiveCore: a refused origin skips unknown-host ahead of no-repo-slug', …)`: `decideArchiveCore(<merged PR>, null, false, { records: [1], repoSlug: null, repoRefusal: 'R' })` deep-equals `{ action: 'skip', reason: 'unknown-host', hint: 'R' }`.
    - Extend `STRUCTURALLY_STUCK_REASONS includes …` (:4416) with `assert.ok(STRUCTURALLY_STUCK_REASONS.has('unknown-host'))`.

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test tests/gh-host-seam-behavior.test.js tests/bin-lib/reconcile/archive-merged.test.js tests/bin-lib/reconcile/archive-merged-record-guards.test.js tests/bin-lib/reconcile/reap-merged.test.js`
Expected: FAIL after Step 1 — the GHE escalation cases see `--repo acme/widgets`, the SSH-alias cases see a runner call, the alias record check skips `no-repo-slug`. The github.com cases and Review Focus 3 pass before the change; after Step 3, prove Review Focus 3 can go red by temporarily passing `residueRepo` into `recordCheck`, then restore.

- [ ] **Step 3: Implement** the derivations, the record-check refusal and the call-site argument changes.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/gh-host-seam-behavior.test.js tests/bin-lib/reconcile/archive-merged.test.js tests/bin-lib/reconcile/archive-merged-record-guards.test.js tests/bin-lib/reconcile/reap-merged.test.js tests/bin-lib/reconcile/escalate-residue.test.js tests/reconcile*.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/reconcile/archive-merged.js plugin/bin/lib/reconcile/reap-merged.js tests/gh-host-seam-behavior.test.js tests/bin-lib/reconcile/archive-merged.test.js tests/bin-lib/reconcile/archive-merged-record-guards.test.js tests/bin-lib/reconcile/archive-merged-helpers.js tests/bin-lib/reconcile/reap-merged.test.js
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
- Test: `tests/bin-lib/reconcile/prune-remote.test.js` (reword the `repoSlugOf` comment at :58; the `skipFetch=true` test at :312-321), `tests/bin-lib/reconcile/archive-branches.test.js` (reword the `repoSlugOf` comment at :161), `tests/gh-host-seam-behavior.test.js` (the AC1.1/AC2.1 GHE-origin cases for both callers, spec "Plan defect, in scope")

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
  - `gh-host-seam-behavior.test.js` (spec "Plan defect, in scope": a GHE-origin case per migrated caller, Deliverable 3). Each case calls `withoutGhHost(t)`, builds its repo with `makeRepo(t, origin)`, makes one commit, installs the file's fake gh (`installFakeGh(t)`; the bulk screen's `api graphql` key is unanswered, so it reads empty stdout, which is enough: only the spawn's host and argv are asserted), and passes `gateDeps: { env: {}, readFile: () => { throw new Error('ENOENT'); } }`, in-process with `process.cwd()` left at this checkout:
    - `test('AC1.1: prune-remote on a *.ghe.com origin screens its in-scope remote branches on the origin host with a bare owner/name pair', …)`: origin `https://acme.ghe.com/acme/widgets.git`, an in-scope remote ref made locally (`git update-ref refs/remotes/origin/worktree-x HEAD`), `pruneRemote({ cwd: repo, integration: 'main', skipFetch: true, dryRun: true, gateDeps })` → `assertEveryLineReaches(lines, 'acme.ghe.com')`, and the one `api graphql` line carries `-f owner=acme -f name=widgets` and no `acme.ghe.com/acme/widgets`.
    - `test('AC2.1: prune-remote on a github.com origin leaves GH_HOST unset and its screen argv unchanged', …)`: origin `git@github.com:acme/widgets.git`, the same fixture → every network line starts `GH_HOST=unset ` and the `api graphql` line carries `-f owner=acme -f name=widgets`.
    - `test('AC1.1: archive-branches on a *.ghe.com origin screens its candidate branches on the origin host with a bare owner/name pair', …)`: origin `https://acme.ghe.com/acme/widgets.git`, an in-scope local branch (`git branch worktree-x`), `archiveBranches({ cwd: repo, integration: 'main', dryRun: true, gateDeps })` → `assertEveryLineReaches(lines, 'acme.ghe.com')`, and the `api graphql` line carries `-f owner=acme -f name=widgets`.
    - `test('AC2.1: archive-branches on a github.com origin leaves GH_HOST unset and its screen argv unchanged', …)`: origin `git@github.com:acme/widgets.git`, the same fixture → every network line starts `GH_HOST=unset `, `-f owner=acme -f name=widgets`.

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test tests/bin-lib/reconcile/prune-remote.test.js tests/bin-lib/reconcile/archive-branches.test.js tests/gh-host-seam-behavior.test.js`
Expected: FAIL after Step 1 — the recording screens are called and no `unknown-host` appears. The four `gh-host-seam-behavior.test.js` cases are append-shaped: they pass before and after this task, since `resolvePrStatesBulk`'s runner already spawns through `ghOptions` with `cwd: repoRoot` (`defaultBulkRunner`, `plugin/bin/lib/reconcile/pr-state.js` :346-348) and its owner/name pair is the bare one. After Step 3, prove each AC1.1 case can go red by temporarily passing `process.cwd()` instead of `root` to `resolveBulk` in that module, see it log `GH_HOST=unset`, then restore.

- [ ] **Step 3: Implement** both pre-gates.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/bin-lib/reconcile/prune-remote.test.js tests/bin-lib/reconcile/archive-branches.test.js tests/gh-host-seam-behavior.test.js tests/reconcile*.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/reconcile/prune-remote.js plugin/bin/lib/reconcile/archive-branches.js tests/bin-lib/reconcile/prune-remote.test.js tests/bin-lib/reconcile/archive-branches.test.js tests/gh-host-seam-behavior.test.js
git commit -m "Gate prune-remote's and archive-branches' PR screen — unknown-host with the refusal (refs #4794)"
```

### Task 8: reconcile carries the release and remote-prune refusal detail

**Role:** integration

**Files:**
- Modify: `plugin/bin/lib/reconcile/index.js` (the release skip :536-537, the remote-prune skip :615-616)
- Test: `tests/reconcile-dispatch.test.js`

**Interfaces:**
- Consumes: Task 4's and Task 7's `{ failure: 'unknown-host', detail }`.
- Both lines become `result.skipped.push({ check: '<check>', reason: r.failure, ...(r.detail ? { detail: r.detail } : {}) })`, matching the post-merge line :560. archive's per-run `hint` and archive-branches' per-entry `detail` already pass through unchanged.

- [ ] **Step 1: Write the failing tests** beside `#4933: a post-merge unknown-host failure carries its refusal detail …` (:1851), using `reconcileWithAsyncMerge(checks, { afterStubs })`:
  - `test('#4794: a release unknown-host failure carries its refusal detail into skipped and the summary line', …)`: `afterStubs` sets `releaseMod.releaseMerged` to return `{ released: [], skipped: [], failure: 'unknown-host', detail }`; the `release` skipped entry deep-equals `{ check: 'release', reason: 'unknown-host', detail }` and the summary line reads `` `skipped: release — unknown-host (${detail})` ``.
  - `test('#4794: a remote-prune unknown-host failure carries its refusal detail into skipped', …)`: `afterStubs` replaces `require('../plugin/bin/lib/reconcile/prune-remote').pruneRemote` with one returning `{ entries: [], failure: 'unknown-host', detail }` (restored in a `finally`), checks `['remote-prune']`; the `remote-prune` skipped entry deep-equals `{ check: 'remote-prune', reason: 'unknown-host', detail }`. A failure without `detail` still pushes `{ check, reason }` only.

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test tests/reconcile-dispatch.test.js`
Expected: FAIL after Step 1 — both entries drop `detail`

- [ ] **Step 3: Implement** the two lines.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/reconcile-dispatch.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/reconcile/index.js tests/reconcile-dispatch.test.js
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
- Modify: `plugin/bin/lib/hooks/git-exec.js` (delete `repoSlugOf` :205-213 and its export at :233; reword `repoSpecOf`'s header :215-219 and its #4857 fallback comment :226-228, which name it; the fallback comment's "an `ssh://` URL, say" example becomes "a cloud sandbox's `http://local_proxy@127.0.0.1:{port}/git/{owner}/{repo}` proxy remote, or a local path", since after Task 1 the gate admits or refuses an `ssh://` origin on its host)
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

Run: `node --test tests/gh-host-seam-conformance.test.js tests/hooks-git-exec.test.js tests/bin-lib/reconcile/release-merged.test.js tests/bin-lib/reconcile/archive-merged.test.js tests/bin-lib/reconcile/archive-merged-record-guards.test.js tests/bin-lib/reconcile/reap-merged.test.js tests/bin-lib/reconcile/pr-state.test.js tests/hooks-sibling-sessions.test.js`
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
- **Gate (spec round 5, "No claim-targets exception").** `run()`, after the skip guard and before the first gh call: `const gate = typeof deps.gateOrigin === 'function' ? deps.gateOrigin() : null;` `if (gate && gate.refusal) { deps.stderr(\`claim-targets: unknown-host — ${gate.refusal}\n\`); return 2; }`. Run-level, so it returns 2 with or without `--keep-going` (claim-targets-stop-addition decision 1), before any claim read or write, label, or claim-log line ("never claimed" holds for every target). A `null` gate or a `{ spec: null, refusal: null }` verdict (no origin, an unparseable one such as a cloud sandbox's `http://local_proxy@127.0.0.1:{port}/git/{owner}/{repo}` proxy remote) changes nothing: `gh repo view` resolves the repo as today. `USAGE` and the header name the new cause: "exit 2 = malformed invocation or missing dependency (an origin host the origin-host gate refuses, `unknown-host`, included)".
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
- `tests/gh-host-seam-conformance.test.js`: remove `stale-claim-pr.js` from `NOT_ORIGIN` (:400), add it to `ORIGIN_GATED` (:407-409, beside Task 12's `claim-targets.js`), and lower the AC9.2 floor from 6 to 5 (:466-471), extending the comment to name #4794 as a deliberate move onto the gate (the #4951/#4805 precedent in that comment). Task 1 keeps `lib/repo-resolve.js` at one matched site (its one read, `parseRepo(hostPathOf(remote))`, replaces `parseRepo(remote)` and still names `remote`), so the floor moves only here.

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
    - a `ssh://git@github-work/acme/w.git` origin with the throwing `readFile` → the same verdict, byte for byte, as `git@github-work:acme/w.git` above, and no gh call (round 6 Q1).
    - a `http://local_proxy@127.0.0.1:43215/git/acme/w` origin (a cloud sandbox proxy remote) and no `--repo` → exit 3, stderr names `--repo`, no stdout, `deps.calls.gh` empty (round 6 Q1: the proxy remote keeps its exit-3 re-run path; Task 14's prose re-runs with `--repo "{host}/{owner}/{repo}"`).
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
- Modify: `plugin/skills/_shared/issue-claims.md` (the lock step 4 tombstone sentence at :186-188, its invocation at :198, its exit-2 `--listing` re-run at :200-205, and the gh-path sentence at :524-526)
- Modify: `plugin/skills/tidy/scan-procedures.md` (the Step 4.7 invocation at :244, its `--listing` sentence at :247-250, and its paragraph :243-251)
- Test: `tests/tidy-stale-claim-open-pr-conformance.test.js` (the AC1.2 `--repo "{owner}/{repo}"` pin at :50), `tests/issue-claims-stale-open-pr-conformance.test.js` (`lockStep4()` :22, AC1.2 :31)

**Interfaces:**
- Consumes: Task 13's CLI behavior (no `--repo` reads origin through the gate; exit 3 when origin does not parse; `unknown-host: …` failure for a refused origin).
- Both invocations (spec round 3, Q2) drop `--repo`. One added sentence at each site: exit 3 (origin does not parse, e.g. a sandbox proxy remote) → re-run adding `--repo "{host}/{owner}/{repo}"`, never a bare `owner/repo`.
- **The MCP `--listing` leg (spec round 6, Q2, Reading B).** At each site the exit-2 → `--listing` sentence also adds `--repo "github.com/{owner}/{repo}"`, as its own code span so the existing `` `--listing "{that path}"` `` span stays whole: issue-claims.md's "re-run it adding `--listing "{that path}"`" becomes "re-run it adding `--listing "{that path}"` and `--repo "github.com/{owner}/{repo}"` (the MCP's host, so listing and match share one host)", and scan-procedures.md's "add `--listing "{that path}"` to each call" becomes "add `--listing "{that path}"` and `--repo "github.com/{owner}/{repo}"` to each call". The listing came from the GitHub MCP, whose host is github.com, so the CLI's match host must be github.com too (Task 13: a host-qualified `--repo` names the match host), whatever origin or `GH_HOST` says. That `--repo` replaces an exit-3 re-run's `--repo "{host}/…"` on the listing leg, and only the listing leg carries it: the `gh`-path calls take their host from origin. Round 6 Q2 names the MCP path in `_shared/issue-claims.md`; tidy's Step 4.7 listing leg has the same split (an MCP listing matched on origin's host), so blanket rule 2 applies it there too.
- **One `{host}` definition** (the reviewer's defect), written once in each file with the same words, in issue-claims.md at its first use (lock step 4) and in scan-procedures.md beside the exit-3 sentence: "`{host}` is the GitHub host the record lives on: `github.com` on the GitHub MCP path; on the `gh` path an exported non-empty `GH_HOST`, else the origin's host when it is `github.com` or a known GitHub Enterprise host, else `github.com`." The closing "else `github.com`" is the round-5 low defect (spec "Review defects"): exit 3 means origin does not parse, so on the `gh` path with `GH_HOST` unset the exit-3 re-run's `{host}` is `github.com`, explicitly, per the round-4 precedence. issue-claims.md's two tombstone sentences read `https://{host}/{owner}/{repo}/pull/{number}`, compared case-insensitively with trailing dots ignored, the gh-path one referring back to that definition rather than restating it.
- Rail: trim words in the same paragraphs so `wc -c` prints at most 50800 for `issue-claims.md` and at most 52447 for `scan-procedures.md` (today's sizes; `RAIL_BYTES` 52500).

- [ ] **Step 1: Write the failing tests** — assertion inventory per the governing skill: the AC1.2 `--repo "{owner}/{repo}"` literal (`tests/tidy-stale-claim-open-pr-conformance.test.js` :50) is **retired** (round 3 drops `--repo` from agent calls) and replaced by the assertions below; `tests/issue-claims-stale-open-pr-conformance.test.js` :48's `` /re-run it adding `--listing "\{that path\}"`/ `` is **kept** unchanged (the new `--repo` is a second code span after it, so the regex still matches); every other assertion in both files is unchanged.
  - Both files share one test-local constant `HOST_DEFINITION` holding the definition sentence above, and each test asserts `HOST_DEFINITION.endsWith('else `github.com`.')` beside its containment assertion, so the exit-3 fallback cannot be trimmed out of the constant and the prose together unnoticed (the round-5 pin).
  - Both files share one test-local constant `MCP_LISTING_REPO` = `` '`--listing "{that path}"` and `--repo "github.com/{owner}/{repo}"`' `` (round 6 Q2).
  - `tidy-stale-claim-open-pr-conformance.test.js`: the first `bin/stale-claim-pr.js` invocation in `claimAuditSection()` carries no `--repo`; the section contains `--repo "{host}/{owner}/{repo}"` in a sentence with `/[Ee]xit 3/` before it; the section never contains `--repo "{owner}/{repo}"`; the section contains `HOST_DEFINITION` once; the whitespace-flattened section contains `MCP_LISTING_REPO` exactly once, after `mcp__github__list_pull_requests`, and contains `"github.com/{owner}/{repo}"` exactly once (only the listing leg carries it).
  - `issue-claims-stale-open-pr-conformance.test.js`: the same invocation and listing assertions on the whitespace-flattened `lockStep4()`; `issue-claims.md` contains no `https://github.com/{owner}/{repo}/pull/{number}`, contains `https://{host}/{owner}/{repo}/pull/{number}` twice, and contains `HOST_DEFINITION` exactly once.

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test tests/tidy-stale-claim-open-pr-conformance.test.js tests/issue-claims-stale-open-pr-conformance.test.js`
Expected: FAIL after Step 1 on the no-`--repo`, exit-3, `{host}`, definition and `MCP_LISTING_REPO` assertions

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
Expected: PASS (they pin main's behavior with Task 1's text). Prove each SSH-alias case can go red: temporarily make `gateOriginRepo` return `{ spec: { ...parsed, host }, refusal: null }` for every host (`parsed` being Task 1's one normalized read), see both fail, then restore.

- [ ] **Step 3: Commit**

```bash
git add tests/bin-lib/reconcile/post-merge.test.js tests/hooks-teardown-run.test.js tests/gh-host-seam-behavior.test.js
git commit -m "Pin the SSH-alias refusal and its advice on post-merge and teardown-run (refs #4794)"
```

### Task 16: a whole reconcile pass on a GHE origin, and the stale prose

**Role:** integration

**Files:**
- Test: `tests/gh-host-seam-behavior.test.js`
- Modify: `.claude/skills/gh-api-module-pattern/SKILL.md` (:65-73: the `repoSlugOf` paragraph and the bare-slug `--repo` limitation it states — `escalate-residue.js`'s calls, `claim-store.js`'s `openPrListArgs`; and the :73 parser-swap paragraph, whose "`repoSpecOf` now falls back to the looser parse" sentence gains: the gate itself now judges origin by `parseRepo(hostPathOf(remote))`, as the seam reads it, so an `ssh://`, credentialed or ported origin is admitted or refused on its host exactly as its plain spelling is, and the loose fallback is left for a remote that read does not parse, such as a cloud sandbox's `http://local_proxy@127.0.0.1:{port}/git/{owner}/{repo}` proxy remote (#4794))
- Modify: `docs/reconcile-checks.md` (the record check's skip-reason list :210-219, the `no-repo-slug` note :405-407, and the post-merge bullet's closing sentence :725-726, "A remote the gate cannot read (an `ssh://` URL) keeps the bare slug it always resolved to (#4857).")

**Interfaces:**
- Consumes: Tasks 1-15.

- [ ] **Step 1: Write the test**
  - `test('AC1.1: a whole reconcile pass (hooks.js reconcile) on a *.ghe.com origin sends every gh call to the origin host', …)`: a GHE temp repo with `CLAUDE.md` `work-backend: github-issues`, a fake gh on PATH (a `case` stub answering the claims tree listing with `{"truncated":false,"entries":[]}` and anything else with `[]`), `node plugin/bin/hooks.js reconcile` as a child with `cwd: repo`, `childEnv()` plus `GIT_TERMINAL_PROMPT=0` and an empty `GH_CONFIG_DIR`. The pass may `git fetch` the `https://acme.ghe.com/…` origin, which must fail fast rather than prompt; if a network `git` call still makes the case slow or flaky, stop and report it rather than loosening the assertion. Assert `assertEveryLineReaches(lines, 'acme.ghe.com')`, whose `net.length >= 1` floor proves at least release-merged's tree listing ran. Factor the case into a `reconcilePassLines(t, { origin, env })` helper (Task 17 reuses it).
  - `test('AC1.1: a whole reconcile pass on a credentialed https://oauth2@acme.ghe.com origin sends every gh call to the origin host', …)` (the reviewer's high defect, Review Focus 8): the same helper with `origin: 'https://oauth2@acme.ghe.com/acme/widgets.git'` and the same assertion; the seam and the gate both read `acme.ghe.com`, so no line falls back to github.com.

- [ ] **Step 2: Run it**

Run: `node --test tests/gh-host-seam-behavior.test.js`
Expected: PASS (Tasks 1-13 landed). Prove the case can go red: temporarily revert Task 4's `root` binding and run the pass in-process from this checkout's cwd, then restore. Prove the credentialed case can go red: temporarily make `gateOriginRepo` judge `parseRepo(remote)` alone (Task 1's old read), see a line without `acme.ghe.com`, then restore.

- [ ] **Step 3: Update the prose.** Skill: origin-derived repos come from `git-exec.js`'s `repoTargetOf` (`ghRepo` for `--repo`, `slug` for `repos/…` paths, GraphQL pairs and slug comparisons) through #4933's gate, so an unknown or SSH-alias origin is refused (`unknown-host` with the refusal text), never sent bare; a command that calls gh and compares a host takes both from one `resolveRepoTarget` result; `release-merged.js`'s REST calls pass `cwd: root`. `docs/reconcile-checks.md`: the record check gains a fourth skip reason, `unknown-host` (a refused origin; the refusal rides as the skip's `hint`; tracked like `no-repo-slug`, and its escalation files nothing because the residue repo is a refusal), so "Three skip reasons" becomes "Four"; the :405 note names `unknown-host` beside `no-repo-slug` as never filed into the record; the :725-726 sentence becomes "An `ssh://`, credentialed or ported origin is judged on its host like its plain spelling (#4794); a remote the gate cannot read at all (a cloud sandbox's proxy remote, a local path) keeps the bare slug it always resolved to (#4857)." Keep the rest of each paragraph. Then `git grep -n repoSlugOf -- plugin .claude docs/reconcile-checks.md tests` prints nothing. Control, run at plan time against this plan's base commit: `git grep -n repoSlugOf 70ae36cb9 -- plugin/bin/lib/hooks/git-exec.js` printed four lines, the first `70ae36cb9:plugin/bin/lib/hooks/git-exec.js:208:function repoSlugOf(repoRoot) {`, so the search can match its target.

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
- The journey's :41 list gains claim-targets, "Sixteen" becoming "Seventeen" (count the names after the edit and use that number); :76 becomes: "The gate reads an `ssh://`, credentialed or ported origin the way the seam does (#4794), so it is admitted or refused on its host exactly as its plain spelling is; a remote that read does not parse (a cloud sandbox's proxy remote, a local path) falls back to the loose reader (#4857), which never names an unknown host either."

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

### Task 19: `pr-state-batch.js` does not run under a `GH_HOST` naming another host

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/reconcile/pr-state-batch.js` (`fetchBatch` :166-202 and its comment :159-165, the `GITHUB_HOST` comment :139-142; extend the `require('../repo-resolve')` at :20 with `normalizeHost`)
- Test: `tests/bin-lib/reconcile/pr-state-batch.test.js` (a new case after `fetchBatch: an origin off github.com (or unparseable) makes zero runner calls` :238-256; the batching cases :189, :215, :238's github.com control, :258 and :265 gain `env: {}` in their options so a developer's own exported `GH_HOST` cannot skip their batch)

**Interfaces:**
- `fetchBatch(root, { numbers, heads } = {}, { runner, env } = {})` (spec round 6, Q3, Reading B): after the `keys.length === 0` return and before `githubOrigin(root)`, `const ghHost = String((env || process.env).GH_HOST || '').trim(); if (ghHost && normalizeHost(ghHost) !== GITHUB_HOST) return { byNumber, byHead };`. Nothing is spawned, git included. `env` is undefined in production (`pr-state-cache.js` :152 calls `live.fetchBatch(root, { numbers: batchNumbers, heads: batchHeads })`, no options), so it reads `process.env`. An empty or whitespace-only `GH_HOST` is unset (spec minor ruling), and `GH_HOST=github.com` (any case, trailing dot) still batches.
- Why: the batch pins `--hostname github.com`, while the per-item `gh pr view`/`gh pr list` calls it stands in for infer their host through gh, which follows an exported `GH_HOST`. With `GH_HOST=mine.example` on a github.com origin one reconcile pass read PR state from two hosts (blanket rule 2). Empty maps route every key to `pr-state-cache.js`'s per-item twins, already pinned by `prefetch: an empty or malformed fetchBatch result degrades to per-item` (`tests/bin-lib/reconcile/pr-state-cache.test.js` :421-430). The argv of every call that still runs is unchanged: the batch's `api graphql --hostname github.com -f owner= -f name= -f query=` when it runs, and every per-item argv always.
- The comments at :139-142 and :159-165 gain: the batch talks only to github.com, so it runs only when gh's default host is github.com too (`GH_HOST` unset, empty, or github.com); under any other `GH_HOST` it spawns nothing and the per-item path answers (#4794).

- [ ] **Step 1: Write the failing test** in `tests/bin-lib/reconcile/pr-state-batch.test.js`, plus the `env: {}` additions above: `test('#4794: a non-empty GH_HOST naming another host skips the batch; unset, empty and github.com still batch with today\'s argv', …)`, over `SLUG_REPO` (origin `https://github.com/thn-inc/claude-tweaks.git`) with keys `{ numbers: [1], heads: ['b'] }` and a recording runner returning `'{}'`:
  - `env: { GH_HOST: 'mine.example' }` and `env: { GH_HOST: ' ACME.ghe.com ' }` → zero runner calls, and `out.byNumber.size + out.byHead.size === 0`.
  - `env: {}`, `{ GH_HOST: '' }`, `{ GH_HOST: '  ' }` and `{ GH_HOST: 'GitHub.com.' }` → exactly one runner call, whose argv deep-equals `['api', 'graphql', '--hostname', 'github.com', '-f', 'owner=thn-inc', '-f', 'name=claude-tweaks', '-f', 'query=' + buildBatchQuery({ numbers: [1], heads: ['b'] })]`.

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/bin-lib/reconcile/pr-state-batch.test.js`
Expected: FAIL after Step 1 — the `mine.example` and `ACME.ghe.com` envs each see one runner call (the `env` option is ignored). The unset, empty and github.com envs pass before and after.

- [ ] **Step 3: Implement** the `env` option, the guard and the two comments.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/bin-lib/reconcile/pr-state-batch.test.js tests/bin-lib/reconcile/pr-state-cache.test.js tests/gh-host-seam-conformance.test.js tests/reconcile*.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/reconcile/pr-state-batch.js tests/bin-lib/reconcile/pr-state-batch.test.js
git commit -m "Skip the github.com-pinned PR batch when GH_HOST names another host (refs #4794)"
```

### Task 20: `engine-verify.js`'s `upstream-feedback` check does not run under a `GH_HOST` naming another host

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/wrap-up/engine-verify.js` (the `upstream-feedback` check :1178-1196; extend the `require('../repo-resolve')` at :27-29 with `normalizeHost`)
- Modify: `.claude/skills/gh-api-module-pattern/SKILL.md` (:67: the paragraph's closing sentence on the `upstream-feedback` check)
- Test: `tests/bin-lib/wrap-up/engine-verify.test.js` (a new case after `upstream-feedback check passes via gh issue view when recorded url resolves` :3492-3499)

**Interfaces (plan review, spec round 6 Q3 and AC2, Reading A):**
- The check's URL regex (:1186) matches `github.com` alone, so github.com is its one host (blanket rule 2). Round 6 Q3's rule for a split site: "The argv of every call that still runs is unchanged", and the site does not run when a non-empty `GH_HOST` names another host. So, after the `!entries.length` skip and **before** `ghAvailable(deps, cwd)` (which spawns `gh --version`): `const env = (deps.gateDeps && deps.gateDeps.env) || process.env; const ghHost = String(env.GH_HOST || '').trim(); if (ghHost && normalizeHost(ghHost) !== 'github.com') return { result: 'unknown', detail: \`GH_HOST is ${ghHost}, but upstream-feedback issue URLs are on github.com — check not run, so this command keeps one host (#4794)\` };`. No gh call of any kind is made then. `deps.gateDeps` already reaches every check (:1229-1231) and is undefined in production, so it reads `process.env`. The detail names the exported value only as what is set; it never tells the user to set `GH_HOST` to anything (blanket rule 3).
- When it runs (`GH_HOST` unset, empty or whitespace-only, or github.com in any case with a trailing dot), the `gh issue view` argv stays exactly today's: `['issue', 'view', number, '--repo', repoSlug({ host: 'github.com', owner, repo }), '--json', 'number']` (AC2, round 5 Q1). `repoSlug` stays the producer.
- SKILL.md :67: the closing sentence becomes: "`lib/wrap-up/engine-verify.js`'s `upstream-feedback` check passes `repoSlug({ host: 'github.com', owner, repo })` (#4505), a fixed host because its URL regex matches `github.com` alone, and returns `unknown` without calling gh when an exported `GH_HOST` names another host (#4794), since gh would send that bare slug there; widening that regex means passing the matched host into `repoSlug` too, or #2425 returns." The producer list's parenthetical is unchanged.

- [ ] **Step 1: Write the failing test** in `tests/bin-lib/wrap-up/engine-verify.test.js`: `test('#4794: upstream-feedback makes no gh call under a GH_HOST naming another host, and keeps today\'s argv otherwise', …)`: expectations `upstream: [{ url: 'https://github.com/org/repo/issues/42' }]`, a recording `fakeGh` answering `--version` with `gh version 2.0.0` and anything else with `{"number":42}`, `runVerify({ runDir, base: 'main', deps: { git: () => '', gh: fakeGh, gateDeps } })`:
  - `gateDeps: { env: { GH_HOST: 'mine.example' } }` and `{ env: { GH_HOST: ' ACME.ghe.com ' } }` → `fakeGh` recorded no call carrying `issue` and no `--version` call made by this check (assert on the calls recorded while this check ran, or run it alone via the check registry if `runVerify` exposes one), the `upstream-feedback` row is `unknown`, and its detail matches `/check not run/` and does not match `/export GH_HOST/`.
  - `gateDeps: { env: {} }`, `{ env: { GH_HOST: '' } }`, `{ env: { GH_HOST: '  ' } }` and `{ env: { GH_HOST: 'GitHub.com.' } }` → the recorded `issue` call deep-equals `['issue', 'view', '42', '--repo', 'org/repo', '--json', 'number']` (today's argv) and the row is `pass`.

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/bin-lib/wrap-up/engine-verify.test.js`
Expected: FAIL after Step 1 — the `mine.example` and `ACME.ghe.com` cases record an `issue view` call and a `pass` row. The other four pass before and after.

- [ ] **Step 3: Implement** the guard and the SKILL.md sentence.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/bin-lib/wrap-up/engine-verify.test.js tests/bin-lib/verify-expectations/cli.test.js tests/gh-host-seam-conformance.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/wrap-up/engine-verify.js .claude/skills/gh-api-module-pattern/SKILL.md tests/bin-lib/wrap-up/engine-verify.test.js
git commit -m "Skip upstream-feedback's github.com issue view when GH_HOST names another host (refs #4794)"
```

### Task 21: `activity-gather.js` refuses an origin by its host, not its spelling

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/repo-resolve.js` (export `hostPathOf` :162-168 in `module.exports` :290-294)
- Modify: `plugin/bin/activity-gather.js` (the origin read :118-119; add `hostPathOf` to the `require` at :30)
- Test: `tests/bin-lib/activity/gather-cli.test.js`
- Test: `tests/gh-host-seam-conformance.test.js` (the `activity-gather.js` notes :374 and :396-397)

**Interfaces (plan review; spec blanket rule 1: "whether an origin is refused depends only on its normalized host, never on how its URL is spelled ... If the build finds another site or case these cover, it applies the rule there without asking."):**
- `repo-resolve.js` exports the existing `hostPathOf(url)` unchanged (userinfo, port and scheme dropped; a non-URL returned as-is). Task 22 consumes it too.
- `activity-gather.js` :118: `const spec = parseRepo(hostPathOf(url));`. Its "not a GitHub URL" stop and its "on {host}, not github.com" stop are otherwise unchanged, so `ssh://git@github.com/o/r.git`, `https://oauth2@github.com/o/r.git` and `https://github.com:443/o/r.git` reach the repo exactly as `git@github.com:o/r.git` does, and `ssh://git@acme.ghe.com/o/r.git` gets the same "on acme.ghe.com, not github.com" stop as `git@acme.ghe.com:o/r.git`. Its github.com pinning, its gh calls and every argv are unchanged.
- The conformance notes at :374 and :396-397 change the quoted shape `parseRepo(url)` to `parseRepo(hostPathOf(url))`; activity-gather stays out of `NOT_ORIGIN` (its two-line read is still the recall gap).

- [ ] **Step 1: Write the failing test** in `tests/bin-lib/activity/gather-cli.test.js`: `test('#4794: an ssh://, credentialed or ported github.com origin is read like its scp spelling, and an ssh:// GHE origin gets the same off-host stop', …)`, using that suite's existing deps-injection shape for `remoteUrl`, `ghAvailable` and `ghAuthOk`: for `ssh://git@github.com/o/r.git`, `https://oauth2@github.com/o/r.git` and `https://github.com:443/o/r.git` the run does not stop with "not a GitHub URL" and resolves the repo `o/r` exactly as `git@github.com:o/r.git` does (compare the two runs' recorded gh argv); `ssh://git@acme.ghe.com/o/r.git` exits 2 with stderr matching `/origin remote is on acme\.ghe\.com, not github\.com/`, identical to the `git@acme.ghe.com:o/r.git` run's stderr. Plus the two conformance-note rewordings (prose only; the scan and its counts are unchanged).

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/bin-lib/activity/gather-cli.test.js`
Expected: FAIL after Step 1 — the `ssh://`, credentialed and ported github.com origins stop with "not a GitHub URL", and the `ssh://` GHE origin gets "not a GitHub URL" instead of the off-host stop.

- [ ] **Step 3: Implement** the export and the read.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/bin-lib/activity/gather-cli.test.js tests/gh-host-seam-conformance.test.js tests/bin-lib/repo-resolve.test.js tests/activity-never-invent-conformance.test.js tests/path-guard-conformance.test.js tests/windows-hide-spawn-conformance.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/repo-resolve.js plugin/bin/activity-gather.js tests/bin-lib/activity/gather-cli.test.js tests/gh-host-seam-conformance.test.js
git commit -m "Read activity-gather's origin the seam's way, so its stop depends on the host alone (refs #4794)"
```

### Task 22: `parent-gate.js --facts-json` reads origin by its host, not its spelling

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/parent-gate.js` (the `--facts-json` origin read :340-341; add `hostPathOf` to the `require` at :89)
- Test: `tests/parent-gate-cli.test.js` (after `facts-json path: the facts path is not refused for an unknown origin host` :612)
- Test: `tests/gh-host-seam-conformance.test.js` (`NOT_ORIGIN['parent-gate.js'].reason` :401)

**Interfaces (plan review; spec blanket rule 1, as Task 21):**
- Consumes: `hostPathOf` exported by Task 21.
- `parent-gate.js` :340: `repoSpec = parseRepo(hostPathOf(remote));` (host still normalized at :341). The facts path stays ungated and makes no gh call (#4933's user decision, kept): only the parse changes, so `ssh://git@github.com/o/r.git` judges a qualified `--closing o/r#11` token exactly as `git@github.com:o/r.git` does instead of exiting 2 "could not resolve owner/repo from the origin remote". This is still one `parseRepo(` call whose argument names `remote`, so the conformance count for `parent-gate.js` stays 1; its `reason` text is reworded from "keeps a raw `parseRepo(remote)`" to "keeps an ungated `parseRepo(hostPathOf(remote))` (the seam's normalized read, #4794)".

- [ ] **Step 1: Write the failing test** in `tests/parent-gate-cli.test.js`: `test('#4794: the facts path reads an ssh:// or credentialed origin like its scp spelling', …)`: with `--sub-issue 11 --closing o/r#11,o/r#12 --facts-json {file}` and `NO_GH`, `remoteUrl: () => 'ssh://git@github.com/o/r.git'` and `() => 'https://x:tok@github.com/o/r.git'` each give the same exit code and stdout as `() => 'git@github.com:o/r.git'`, and neither stderr matches `/could not resolve owner\/repo/`. Plus the conformance `reason` rewording (prose only).

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/parent-gate-cli.test.js`
Expected: FAIL after Step 1 — both origins exit 2 with "could not resolve owner/repo from the origin remote".

- [ ] **Step 3: Implement** the read.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/parent-gate-cli.test.js tests/gh-host-seam-conformance.test.js tests/parent-gate-repo-flag-conformance.test.js tests/path-guard-conformance.test.js tests/windows-hide-spawn-conformance.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/parent-gate.js tests/parent-gate-cli.test.js tests/gh-host-seam-conformance.test.js
git commit -m "Read the parent-gate facts path's origin the seam's way (refs #4794)"
```

Waived plugin/bin/lib/reconcile/post-merge.js: read only — it already reaches the origin host and refuses through `repoSpecOf` → `gateOriginRepo` on main (#4933); Task 15 pins its SSH-alias refusal and Task 1 changes the shared text it prints.

## Spec coverage

| Spec item | Task |
|---|---|
| Deliverable 1 (host-aware sibling, move reconcile callers and claim-store onto it) | 2, 4, 5, 6, 7, 9, 10, 11, 12, 13 |
| Deliverable 2 (slug comparisons and `repos/…` paths stay consistent; github.com byte-identical) | 4, 5 (Review Focus 3), 6, 11, 12, 13 |
| Deliverable 3 (GHE-origin case per migrated caller in `tests/gh-host-seam-behavior.test.js`) | 4, 5, 6, 7 (prune-remote and archive-branches), 9 (sibling-sessions), 12 (claim-targets' real wiring), 13, 15, 16 |
| Decision round 1: Reading B (seam-known hosts only) | 2 (through the gate, which admits the same hosts), 5, 12, 13 |
| Decision round 1: align post-merge/teardown, SSH-alias test on each | 15 |
| Decision round 2: explicit host-qualified `--repo` trusted; `GH_HOST` value for PR-url matching; normalized host comparisons incl. the MCP prose | 2, 11, 12, 13, 14 |
| Decision round 3, Q1: `repoSlugOf` paths through `gateOriginRepo`, one host rule per pass, SSH-alias refusals pinned | 2, 4, 5, 6, 7, 9, 10, 15 |
| Decision round 3, Q2: agent-composed `stale-claim-pr.js` calls take the host from origin; tidy pin updated | 14 |
| Minor rulings: empty `GH_HOST` is unset on every path; Task 1 `Review risk: high`; enterprise-token clause follows the seam | 2 (`resolveRepoTarget`), 13; the old plan's Task 1 is this plan's Task 2, marked high |
| Decision round 4, Q1: every gated path reports `unknown-host` with the refusal text, never `no-repo-slug`/`network-failure` | 3, 4, 5, 6, 7, 8, 9, 13, 15 |
| Decision round 4, Q1: alias advice fixed once in the shared refusal text, pinned by a test | 1 (pins), 4, 13, 15 (assert the alias text on real paths) |
| Decision round 4, Q2: `stale-claim-pr.js` resolves one host for listing and matching, precedence typed `--repo` > `GH_HOST` > github.com | 2, 13 |
| Decision round 4, Whole family: one resolved host for gh + host comparison (listing vs matching, tombstone checks, MCP path) | 2, 11, 12, 13, 14, 19, 20; sweeps and the claim-log.js classification in Global Constraints |
| Decision round 4, Plan markers: old Tasks 4 and 8 `Review risk: high`; the reviewer's 3 medium defects applied | old Task 4 → Tasks 6 and 9, old Task 8 → Task 14, all marked high; defects: Task 10's swaps list all three sites incl. the `gateDeps` loop and Task 2's comparison; Tasks 9 and 12 add the GHE sibling-sessions and claim-targets real-wiring cases; Task 14 has one `{host}` definition; Tasks 4 (now 6, 9) and 8 (now 14) marked high |
| Decision round 5, Q1: AC2 holds whatever `GH_HOST` is; `--repo` bare whenever the host is gh's default host, the match host following `GH_HOST` | 2 (formula and cases), 12, 13 (github.com origin and bare `--repo` under `GH_HOST`) |
| Decision round 5, Q2: empty `GH_HOST` unset in `ghOptions` too | 17 (and `explicitRepoGhHost`, so an explicit `--repo` cannot split either) |
| Review defect (high): one normalized origin read for credentials, port and `ssh://` | 1 (gate), 2 (`repoTargetOf` cases), 13 (stale-claim-pr), 16 (whole pass), 18 (journey) |
| Review defect (low): sibling-sessions' claim read bound to the hook's `cwd` | 9 (`defaultGhApi` cwd, AC1.1 from an outside `process.cwd()`) |
| Review defect (low): exit-3 re-run `{host}` falls back to github.com, pinned | 14 |
| No claim-targets exception: `unknown-host` with the corrected text, no gh call | 12 (stop and tests), 18 (exit-2 prose) |
| Decision round 6, Q1 (Reading A): the gate refuses on the normalized host; no cloud sandbox proxy-remote shape parses (no carve-out needed) | 1 (one normalized read, spelling-invariance and proxy fixtures, the flipped :471/:477 pins), 2 (`repoTargetOf`'s `ssh://` refusal and proxy fallback), 13 (`ssh://` alias verdict, proxy exit 3), 10, 16, 18 (prose and comments that named the `ssh://` fallback) |
| Decision round 6, Q2 (Reading B): the MCP `--listing` leg passes `--repo "github.com/{owner}/{repo}"`, pinned in conformance tests | 14 (issue-claims.md, and tidy's listing leg under blanket rule 2) |
| Decision round 6, Q3 (Reading B): `pr-state-batch.js` does not run under a `GH_HOST` naming another host; split-site sweep widened to plain `'github.com'` literals | 19; the widened sweep and its verdicts in Global Constraints ("One host per command"); 20 (the `engine-verify.js` split site it found, fixed by the same rule: no call under a `GH_HOST` naming another host, today's argv otherwise — plan review, Reading A) |
| Decision round 6, Q4 (Reading A): no scp refusal names its own host as a `GH_HOST` value; HTTPS text byte-identical | 1 (one SSH text for every SSH host, the `ssh://` family included; HTTPS cases; `review focus 4` and the :443-454 loop flipped); 4, 12, 13, 15 (alias assertions on real paths) |
| Blanket rule (round 6): refusal by normalized host only; one host per command or pass; no alias or unverified host as a `GH_HOST` value | Global Constraints (per-task check); 1 (rules 1 and 3); 21, 22 (rule 1 at the two raw-parse refusals outside the gate — plan review, Reading A); 2, 11, 12, 13, 14, 17, 19, 20 (rule 2) |
| Plan defect: Task 7's GHE-origin cases (AC1.1, AC2.1) for `prune-remote` and `archive-branches` in `tests/gh-host-seam-behavior.test.js` | 7 |
| AC1.1 | 4, 5, 6, 7, 9, 12, 13, 15, 16, 17 |
| AC2.1 | 2, 4, 5, 7, 11, 12, 13, 17, 19, 20, 21 (github.com twins; 19 and 20 keep today's argv with `GH_HOST` unset, empty or github.com, and make no call otherwise; 21 keeps activity-gather's argv for every github.com spelling) |
| AC3.1 | 16 Step 4 |
| Key File `plugin/bin/lib/hooks/git-exec.js` | 2, 10 (Task 1 changes only its tests) |
| Key File `plugin/bin/lib/issues/claim-store.js` | 9, 11 |
| Key File `plugin/bin/lib/reconcile/release-merged.js` | 4, 10 |
| Key File `plugin/bin/lib/reconcile/pr-state.js` | 6 |
| Key File `plugin/bin/lib/reconcile/post-merge.js` | No code change (#4933 on main); pinned by Task 15 (waiver above) |
| Key File `tests/gh-host-seam-behavior.test.js` | 4, 5, 6, 7, 9, 12, 13, 15, 16, 17 |
