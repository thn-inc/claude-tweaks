# Stale-claim matcher CLI Implementation Plan (#4596)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route `_shared/issue-claims.md`'s gh-absent stale-claim check and `/tidy` Step 4.7's stale-claim check through one Node CLI, `plugin/bin/stale-claim-pr.js`, built on the same code `bin/claim-targets.js` runs, so neither prose file restates the marker-match rule or the Resume-line grammar.

**Architecture:** `claim-store.js`'s `staleClaimInFlightPr` is split into three exported pieces it then composes (`openPrListArgs`, `staleClaimRunId`, `matchStaleClaimPr`), so a listing can be injected instead of fetched; its signature and behavior stay identical. A new pure `normalizePrListing` (sibling of `mcp-issue-shape.js`) maps MCP `list_pull_requests` entries to the gh `{url, body, isCrossRepository}` shape; `pr-body.js` gains `resumeLineUnder`/`parseResumeLine`, the parser twin of `composeResumeLine`. The CLI fetches over `gh` or reads an agent-written `--listing` file, runs the shared matcher, and prints one JSON verdict.

**Tech Stack:** Node 18+ CommonJS, `node --test`, `gh` CLI (optional — `--listing` replaces it).

**Spec:** `.claude-tweaks/pipelines/2026-10-31T005940-record-4596/work/4596-spec.md`

**Scope keywords:** staleClaimInFlightPr, claude-tweaks-run: {runId}, head.repo.full_name, composeResumeLine

## Global Constraints

- Output JSON keys, in this order: `match`, `link`, then `resume` or `resolve` (only on a match under `--resume`), then `failure` — spec Deliverable 1: "printing JSON `{match, link, resume | resolve, failure}`".
- MCP normalization source fields: `html_url` → `url`, `head.repo.full_name` → `isCrossRepository` — spec: "MCP `list_pull_requests` pages normalized to `{url, body, isCrossRepository}` from `head.repo.full_name`".
- No `owner/repo` literal in shipped code: repo comes from `--repo` or `origin` via `plugin/bin/lib/repo-resolve` (`parseRepo`, `remoteUrl`, `repoSlug`, `ghAvailable`), exactly as `plugin/bin/list-claims.js` does.
- `staleClaimInFlightPr(content, gh, owner, repo, onError)` keeps its signature, its `{ link } | null` return, and every existing test in `tests/bin-lib/claim-targets/claim-targets.test.js` green unchanged (return-shape widening check: lines 725 and 800-842 `deepEqual` against `{ link: PR_URL }`).
- Governing skill `gh-api-module-pattern` (its `cli-wrapper-contract.md`), quoted: "Logic lives in an exported `run(argv, deps)`; every side effect (`runner`, `ghAvailable`, `remoteUrl`, `stdout`, `stderr`) goes through `deps` so tests inject fakes. **Every** `deps` call that can throw … is try/caught into the documented exit-code contract" and "`require.main === module` guard sets `process.exitCode = run(...)` (never `process.exit`, which can truncate piped stdout). `--help` short-circuits before any availability probe." Read that file before Task 3.
- Governing skill `mcp-agent-fetch-node-compute`, quoted rules: "1. **Inject the reader, do not branch the computation.** The gh branch and the MCP branch call the same function; only the data source differs" · "3. **Validate the shape of every agent-written entry.** … Map such an entry to `{failure}`, never to content." · "9. **Normalise a differing field spelling once, at the pull boundary, and make the step a no-op on the other transport's shape.**"
- Source-scan lints over `plugin/bin/`: every `execFileSync` passes `windowsHide: true` (`tests/windows-hide-spawn-conformance.test.js`); no `fs.existsSync`/`fs.realpathSync` (`tests/path-guard-conformance.test.js`) — `fs.readFileSync` is fine.
- Scratch checks stay scratch; commit only the tests named below. Commit messages: `{Verb} {what} — {detail} (refs #4596)`, never `closes`/`fixes`.

## Review Focus

- An MCP entry whose `head.repo` is `null` (a deleted fork) → `isCrossRepository: true`, never a match. Test in Task 1.
- Repo-name letter case: every same-repo comparison stays exact-case, as the existing gh twin's `isSameRepoPrUrl` is (its regex has no `i` flag) — `normalizePrListing` compares `head.repo.full_name` exactly too, so the URL check and the fork check never disagree. Test in Task 1 (`Acme/W` against `acme/w` → cross-repository).
- A Resume line ending in `\r` (CRLF body) or trailing spaces still parses as `resume`; a second command after the closing backtick does not. Tests in Task 2.
- A listing file that is valid JSON but holds non-object entries (`[42]`, `[null]`) or is an object (`{}`) → `failure`, never a no-match. Test in Task 3 (AC2.1 malformed rows).
- An invalid `runId` in the claim blob → `{match:false, link:null, failure:null}` with no `gh` call and no listing read (the plain-Release path tidy depends on). Test in Task 3.

---

### Task 1: Split the stale-claim matcher out of `claim-store.js`; add the MCP listing normalizer

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/issues/claim-store.js` (lines 526-579 and `module.exports`)
- Create: `plugin/bin/lib/issues/mcp-pr-shape.js`
- Test: `tests/bin-lib/issues/claim-store.test.js`, `tests/bin-lib/issues/mcp-pr-shape.test.js` (create)

**Interfaces:**
- Produces (from `claim-store.js`, all exported):
  - `openPrListArgs(owner: string, repo: string) => string[]` — exactly `['pr','list','--repo',`${owner}/${repo}`,'--state','open','--json','url,body,isCrossRepository','--limit',String(OPEN_PR_LIST_LIMIT)]`.
  - `staleClaimRunId(content: string) => string | null` — `JSON.parse(content)` (throws on malformed JSON); returns `runId` when it is a string matching `RUN_ID_SHAPE`, else `null`.
  - `matchStaleClaimPr(runId: string, prs: unknown, owner: string, repo: string) => { url: string, body: string } | null` — throws `Error('open-PR listing is not an array')` (the existing message, kept) when `prs` is not an array, or when no entry matches and `prs.length >= OPEN_PR_LIST_LIMIT`; otherwise the first entry that is an object with a string `body`, `isCrossRepository === false`, `isSameRepoPrUrl(url, owner, repo)`, and a body line whose `.trim()` equals `claude-tweaks-run: ${runId}` or `<!-- claude-tweaks-run: ${runId} -->`.
  - `staleClaimInFlightPr` — unchanged contract; body becomes: `staleClaimRunId` → `null` return before any `gh` call → `JSON.parse(gh(openPrListArgs(owner, repo)))` → `matchStaleClaimPr` → `{ link: m.url }`; same catch/`onError` block.
- Produces (from `mcp-pr-shape.js`): `normalizePrListing(entries: unknown, owner: string, repo: string) => Array<{url, body, isCrossRepository}>` — throws `Error('open-PR listing is not an array')` when `entries` is not an array (the same message `matchStaleClaimPr` uses, so both transports report one string) and `Error('open-PR listing entry {i} is not an object')` when element `i` is not a plain object; an element carrying an `html_url` or `head` key is MCP-shaped → `{ url: html_url, body, isCrossRepository: head?.repo?.full_name !== `${owner}/${repo}` }` (exact case — see Review Focus); any other element is gh-shaped → `{ url, body, isCrossRepository }` copied unchanged. Never mutates its input.

- [ ] **Step 1: Write the failing tests**

In `tests/bin-lib/issues/claim-store.test.js` add (use `'2026-10-31T005940-record-4596'` as `RUN`, `https://github.com/acme/w/pull/7` as the PR url):
- `openPrListArgs builds the gh pr list argv staleClaimInFlightPr uses` — `deepEqual` against the literal array above for `('acme','w')`.
- `staleClaimRunId returns a shaped runId, null for a bad shape, and throws on malformed JSON` — `{runId: RUN}` → `RUN`; `{runId: '../x'}` → `null`; `{}` → `null`; `'not json'` → `assert.throws`.
- `matchStaleClaimPr returns the matched entry, null on no match, and throws on a non-array or a capped no-match listing` — plain-marker same-repo entry → `{url, body}` (assert `.url`); same entry with `isCrossRepository: true` → `null`; marker only inline (`see claude-tweaks-run: ${RUN} here`) → `null`; `{}` → throws; 1000 filler entries without the marker → throws `/1000-entry limit/`; 999 → `null`.

Create `tests/bin-lib/issues/mcp-pr-shape.test.js`:
- `normalizePrListing maps an MCP entry to the gh shape` — `{html_url: U, body: B, head: {repo: {full_name: 'acme/w'}}}` with `('acme','w')` → `[{url: U, body: B, isCrossRepository: false}]`.
- `normalizePrListing compares full_name exactly, as isSameRepoPrUrl does` — `full_name: 'Acme/W'` with `('acme','w')` → `isCrossRepository: true`.
- `normalizePrListing marks a fork or a deleted head repo cross-repository` — `full_name: 'evil/w'` → `true`; `head: {repo: null}` → `true`.
- `normalizePrListing passes a gh-shaped entry through unchanged` — `{url, body, isCrossRepository: false}` → `deepEqual` copy.
- `normalizePrListing throws on a non-array or a non-object element` — `{}`, `[42]`, `[null]`, `[[]]` each `assert.throws`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/issues/claim-store.test.js tests/bin-lib/issues/mcp-pr-shape.test.js`
Expected: FAIL — `openPrListArgs is not a function` and `Cannot find module '../../../plugin/bin/lib/issues/mcp-pr-shape'`.

- [ ] **Step 3: Implement the three `claim-store.js` exports, recompose `staleClaimInFlightPr`, and create `mcp-pr-shape.js`**

Update the `RUN_ID_SHAPE` header comment (claim-store.js ~line 526): agents no longer run it from prose in `_shared/issue-claims.md` or `tidy/scan-procedures.md` — only `flow/claim-targets.md` still restates it; those two call `bin/stale-claim-pr.js`. Header comment of `mcp-pr-shape.js` names #4596 and the two consumers (`bin/stale-claim-pr.js`; the MCP paths of `_shared/issue-claims.md` and `tidy/scan-procedures.md`).

- [ ] **Step 4: Run tests to verify they pass, including the untouched twin suite**

Run: `node --test tests/bin-lib/issues/claim-store.test.js tests/bin-lib/issues/mcp-pr-shape.test.js tests/bin-lib/claim-targets/claim-targets.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/issues/claim-store.js plugin/bin/lib/issues/mcp-pr-shape.js tests/bin-lib/issues/claim-store.test.js tests/bin-lib/issues/mcp-pr-shape.test.js
git commit -m "Split the stale-claim matcher out of staleClaimInFlightPr — injectable listing plus MCP normalizer (refs #4596)"
```

### Task 2: Resume-line parser beside `composeResumeLine`

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/flow/pr-body.js` (beside `composeResumeLine`, line 53; `module.exports`)
- Test: `tests/bin-lib/flow/pr-body.test.js`

**Interfaces:**
- Produces:
  - `resumeLineUnder(body: string) => string | null` — the first non-blank line after the first line whose `.trim()` is `### Resume`, with trailing whitespace (incl. `\r`) removed; `null` when there is no such heading or no non-blank line after it.
  - `parseResumeLine(line: string, runId: string) => { runDir: string, target: string, steps: string } | null` — matches the whole line against `` /^`PIPELINE_RUN_DIR="([^`$"\\\r\n]+)" \/claude-tweaks:flow "([^`$"\\\r\n]+)" ([a-z][a-z,-]*)`$/ `` (the exact shape `composeResumeLine` emits; `{dir}`/`{target}` free of backtick, `$`, `"`, `\` and line breaks; nothing after the closing backtick) and additionally requires `runDir.endsWith('/' + runId)`; anything else → `null`. Export the regex as `RESUME_LINE_RE`.

- [ ] **Step 1: Write the failing tests** (in `tests/bin-lib/flow/pr-body.test.js`; `RUN = '2026-10-31T005940-record-4596'`, `DIR = '/repo/.claude-tweaks/pipelines/' + RUN`)

- `parseResumeLine round-trips composeResumeLine` — `parseResumeLine(composeResumeLine({runDir: DIR, target: '#4596', nextStep: 'review,polish,wrap-up'}), RUN)` `deepEqual` `{runDir: DIR, target: '#4596', steps: 'review,polish,wrap-up'}`; same for target `'#1,#2'`.
- `AC3.1: parseResumeLine rejects a shell tail or a $( ) target` — `composeResumeLine(...) + '; rm -rf ~'` → `null`; line with `{target}` = `'#1$(touch /tmp/x)'` → `null`; line with `; rm -rf ~` inside the steps (`build; rm -rf ~`) → `null`.
- `parseResumeLine rejects the unrendered placeholder and a foreign run` — `composeResumeLine({target:'#1', nextStep:'test'})` (renders `{run-dir}`) → `null`; DIR for another run id → `null`; a backslash in the dir → `null`.
- `resumeLineUnder reads the line under ### Resume in a composed body` — `resumeLineUnder(composePrEarlyBody({runId: RUN, target: '#4596', nextStep: 'review', runDir: DIR}))` equals `composeResumeLine({runDir: DIR, target: '#4596', nextStep: 'review'})`; the same body with `\n` → `\r\n` gives the same string; a body without the heading → `null`; the heading as the last line → `null`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/flow/pr-body.test.js`
Expected: FAIL — `parseResumeLine is not a function`.

- [ ] **Step 3: Implement `RESUME_LINE_RE`, `parseResumeLine`, `resumeLineUnder` in `pr-body.js`**

A one-line comment above `RESUME_LINE_RE` says it is `composeResumeLine`'s parser twin, pinned by the round-trip test, and that its untrusted input is a PR body rendered as a paste command (#4596).

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/flow/pr-body.test.js tests/bin-lib/flow/pr-body-premise-reversal.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/flow/pr-body.js tests/bin-lib/flow/pr-body.test.js
git commit -m "Add parseResumeLine beside composeResumeLine — the PR body's Resume line, validated (refs #4596)"
```

### Task 3: `plugin/bin/stale-claim-pr.js` CLI

**Role:** integration
**Review risk:** high

**Files:**
- Create: `plugin/bin/stale-claim-pr.js`
- Test: `tests/stale-claim-pr-cli.test.js` (create; mirror `tests/list-claims-cli.test.js`'s in-process `run(argv, deps)` style)
- Modify: `docs/plugin-structure.md` (add one CLI line next to `list-claims.js`'s, ~line 212; and name `mcp-pr-shape.js` in the `plugin/bin/lib/issues/` row, line 28, beside `claim-store.js`'s `staleClaimInFlightPr` mention)

**Interfaces:**
- Consumes: Task 1's `openPrListArgs`, `staleClaimRunId`, `matchStaleClaimPr`, `normalizePrListing`; Task 2's `resumeLineUnder`, `parseResumeLine`.
- Produces: `node plugin/bin/stale-claim-pr.js --claim-file <path> [--listing <path>] [--repo owner/name] [--resume] [--help]`; exports `{ run, parseArgs, realDeps }`. `deps`: `ghAvailable, remoteUrl, parseRepo, repoSlug, gh(args) => stdout, readFile(path) => string, stdout, stderr`.
  - Exit 0 with one JSON line for every verdict, failure included: `{"match":false,"link":null,"failure":null}` · `{"match":true,"link":U,"failure":null}` · under `--resume` on a match, `"resume": "<line>"` or `"resolve": "no-resume-line" | "resume-line-shape"` between `link` and `failure` · on any failure `{"match":false,"link":null,"failure":"<message>"}`.
  - Exit 1: malformed invocation (unknown flag, a flag missing its value, no `--claim-file`) — usage on stderr. Exit 2: no `--listing` and `gh` absent — and only that (stderr names `--listing`), so a caller can route exit 2 to its MCP listing path. Exit 3: owner/repo unresolved (no `--repo`, no parseable `origin` remote) — stderr names `--repo`. No JSON on exits 1-3.
  - Order: parse → repo → read claim file + `staleClaimRunId` (null → no-match verdict, no listing read, no `gh` call) → listing (`--listing`: `readFile` + `JSON.parse`; else `ghAvailable` check then `JSON.parse(deps.gh(openPrListArgs(owner, repo)))`) → `normalizePrListing` on both paths (rule 1: one code path) → `matchStaleClaimPr`. Every throw from claim read, listing read/parse, `gh`, normalize or match becomes the failure verdict.
  - `realDeps.gh`: `execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore','pipe','pipe'], timeout: GH_TIMEOUT_MS, maxBuffer: LARGE_MAX_BUFFER_BYTES, windowsHide: true })` (`shared-primitives`, as `plugin/bin/claim-targets.js`'s `defaultGh`).

- [ ] **Step 1: Write the failing tests** (`tests/stale-claim-pr-cli.test.js`; repo `acme/w` via `remoteUrl`, claim file `{runId: RUN, claimedAt: ...}` served by a fake `readFile` keyed by path)

Fixture helpers: `ghEntry({url, body, isCrossRepository})` and `mcpEntry({url, body, fullName})` → `{html_url, body, head: {repo: fullName === null ? null : {full_name: fullName}}}`. `runBoth(entriesGh, entriesMcp, extraArgs)` runs the CLI once with a fake `deps.gh` returning `JSON.stringify(entriesGh)` and no `--listing`, and once with `--listing L` where `readFile(L)` returns `JSON.stringify(entriesMcp)` and `deps.gh` throws if called; returns both parsed stdout lines and exit codes.

- `AC2.1: gh- and MCP-shaped listings give the same verdict` — one table-driven test over five rows, asserting for each row `deepEqual(ghVerdict, mcpVerdict)`, both exit 0, and the expected verdict:
  - matching same-repo PR (body carries `claude-tweaks-run: ${RUN}` on its own line) → `{match: true, link: U, failure: null}`;
  - fork PR (gh `isCrossRepository: true`; MCP `fullName: 'evil/w'`) with the marker → `{match:false, link:null, failure:null}`;
  - inline marker mention only → `{match:false, link:null, failure:null}`;
  - 1000 entries, none marked → `match:false`, `failure` matches `/1000-entry limit/`;
  - malformed listing (both transports fed the same `{}`) → `{match:false, link:null, failure:'open-PR listing is not an array'}`.
- `a listing file with a non-object entry is a failure, never a no-match` — `--listing` file `[42]` → `failure` matches `/entry 0 is not an object/`; `[null]` likewise.
- `AC3.1: a Resume line with a shell tail or a $( ) target yields resolve, never resume` — `--resume`, matching PR whose body is `composePrEarlyBody({runId: RUN, target, nextStep:'review', runDir: DIR})` with the Resume line edited to (a) append `; rm -rf ~`, (b) target `#1$(touch x)` → each verdict has `resolve: 'resume-line-shape'` and no `resume` key.
- `--resume with the composed body yields resume equal to composeResumeLine` — unedited composed body → `resume` equals `composeResumeLine({runDir: DIR, target:'#4596', nextStep:'review'})`; a body with no `### Resume` heading but the marker → `resolve: 'no-resume-line'`; without `--resume` the verdict has neither key.
- `an invalid runId is a clean no-match and never lists PRs` — claim `{runId: '../etc'}`, `deps.gh` and listing `readFile` both throw → `{match:false, link:null, failure:null}`, exit 0.
- `gh absent without --listing exits 2; with --listing it never probes gh` — `ghAvailable: () => false` → exit 2, stderr mentions `--listing`; same deps plus `--listing` → exit 0.
- `an unresolved repo exits 3` — `remoteUrl` throws and no `--repo` → exit 3, stderr mentions `--repo`, no stdout; with `--repo acme/w` → exit 0.
- `malformed invocations exit 1` — no `--claim-file`; `--bogus`; `--listing` with no value.
- `--help prints usage and probes nothing` — exit 0, stdout matches `/usage: stale-claim-pr\.js/`, `ghAvailable` throws if called.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/stale-claim-pr-cli.test.js`
Expected: FAIL — `Cannot find module '../plugin/bin/stale-claim-pr'`.

- [ ] **Step 3: Implement `plugin/bin/stale-claim-pr.js`** per the Interfaces block; header comment states usage, the exit-code contract, and that this is the one implementation the MCP claim path and `/tidy` Step 4.7 call (#4596).

- [ ] **Step 4: Run tests, the bin-wide source scans, and one real probe**

Run: `node --test tests/stale-claim-pr-cli.test.js tests/windows-hide-spawn-conformance.test.js tests/path-guard-conformance.test.js tests/bin-lib/exit-code-conformance.test.js`
Expected: PASS.

Real-input probe (scratch, not committed): write `{"runId":"2026-10-31T005940-record-4596"}` to a scratchpad file and run `node plugin/bin/stale-claim-pr.js --claim-file {that file} --resume` from the worktree. This run's own draft PR #4658 carries the marker, so expect `"match":true`, `"link":"https://github.com/thn-inc/claude-tweaks/pull/4658"` and a `resume` key (or `resolve` if the body has no rendered run dir) — record the printed line in the task report. Independent count: `gh pr view 4658 --json body -q .body` contains the line `claude-tweaks-run: 2026-10-31T005940-record-4596`.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/stale-claim-pr.js tests/stale-claim-pr-cli.test.js docs/plugin-structure.md
git commit -m "Add stale-claim-pr.js — one stale-claim open-PR verdict over gh or an agent-fetched listing (refs #4596)"
```

### Task 4: Point both prose call sites at the CLI and re-pin their conformance tests

**Role:** integration

**Files:**
- Modify: `plugin/skills/_shared/issue-claims.md` ("The lock" step 4, the `'stale'` sentences at lines 179-188; 46,992 B, rail 52,500 B — this edit shrinks it)
- Modify: `plugin/skills/tidy/scan-procedures.md` ("**Stale claim with an open PR (#4423).**" paragraph, lines 242-261; 51,400 B — this edit shrinks it)
- Modify: `tests/issue-claims-stale-open-pr-conformance.test.js`, `tests/tidy-stale-claim-open-pr-conformance.test.js`
- Modify: `.claude/skills/prose-code-twin-pin/SKILL.md` (lines 208-213: `RUN_ID_SHAPE` is now restated in one skill file, `flow/claim-targets.md`; the two former copies call the CLI)
- Waived `plugin/skills/flow/claim-targets.md`: its `RUN_ID_SHAPE` restatement (line 279) validates a run id read from a tombstone's PR for the resume route, not the stale-claim match — out of this spec's two named files; stays pinned by the RUN_ID_SHAPE test.
- Waived `docs/journeys/act-on-a-contested-claim.md`, `docs/journeys/tidy-standalone-auto-report.md`: they describe outcomes (stop / Resume row / Manual review), which this change keeps; no wording names the prose rule.

**Interfaces:**
- Consumes: Task 3's CLI command line and JSON verdict (`match`, `link`, `resume`/`resolve`, `failure`; exit 2 = `gh` absent without `--listing`, exit 1/3 = invocation or repo failure, no JSON).

- [ ] **Step 1: Rewrite the conformance tests first** (the moved-prose pins: `git grep -n -F -e 'head.repo.full_name' -e 'trimmed line equal to' -e 'claude-tweaks-run: {runId}' -- tests plugin` hits only these two test files and the two prose files)

`tests/issue-claims-stale-open-pr-conformance.test.js`:
- Keep `lockStep4()`. Test 1 → `AC1.2: The lock step 4 names the stale-claim CLI on the MCP path` — includes `` `'stale'` blob ``, `bin/stale-claim-pr.js`, `--claim-file`, `--listing`, `mcp__github__list_pull_requests`, `staleClaimInFlightPr`.
- New `AC1.1: The lock step 4 no longer restates the marker-match rule` — step 4 does not include `claude-tweaks-run: {runId}`, `<!-- claude-tweaks-run: {runId} -->`, `head.repo.full_name`, or `RUN_ID_SHAPE.source`.
- Test 2 (fail-open) keeps its two `assert.match`es, re-worded to the new sentence: `/failure[^.]*non-zero exit[^.]*falls through to the write/` and `/after one line saying the check failed — never silently/`.
- Test 3 → `the run-id shape is restated only in flow/claim-targets.md (#4423, #4596)` — `flow/claim-targets.md` includes `RUN_ID_SHAPE.source`; `_shared/issue-claims.md` and `tidy/scan-procedures.md` do not.

`tests/tidy-stale-claim-open-pr-conformance.test.js`:
- Test 2 → `AC1.2: the stale-claim paragraph calls the CLI on both transports` — `claimAuditSection()` includes `bin/stale-claim-pr.js`, `--resume`, `--listing`, `mcp__github__list_pull_requests`.
- New `AC1.1: the stale-claim paragraph restates neither the marker rule nor the Resume grammar` — section does not include `trimmed line equal to`, `claude-tweaks-run: {runId}`, the regex source `^\d{4}-\d{2}-\d{2}T\d{6}-[a-z0-9][a-z0-9-]*$`, `` PIPELINE_RUN_DIR="{dir}/{runId}" ``, or `` `[a-z][a-z,-]*` ``.
- Test 3 drops lines 59, 62, 68, 69 (the `### Resume` heading, basename and grammar pins — the CLI owns all four now) and adds: flat section matches `/`resume`/` and `/`resolve`/`; `failed listing`/`Manual review`/`never an unchecked Release` match is kept; the 1000-entry pin becomes `/1000-entry listing with no match[^.]*Manual review/`; and `/Manual review[^.]*any other non-zero exit/`. Tests 1, 4, 5, 6 unchanged.

- [ ] **Step 2: Run the two tests to verify they fail**

Run: `node --test tests/issue-claims-stale-open-pr-conformance.test.js tests/tidy-stale-claim-open-pr-conformance.test.js`
Expected: FAIL — `bin/stale-claim-pr.js` absent from both sections; the AC1.1 negatives fail because both files still restate the rule.

- [ ] **Step 3: Rewrite the two prose passages**

`_shared/issue-claims.md` step 4, replacing from "For a `'stale'` blob, the counterpart" through "…so it is not read as no marked PR.", keeping "Otherwise, write **conditionally**" after it:

> For a `'stale'` blob, the counterpart (#4423): list the repo's open PRs once per claim run via `mcp__github__list_pull_requests` (`state: open`, `perPage: 100`, paging until exhausted), Write every page's entries as one JSON array to the path `node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" --value stale-claim-open-prs.json` prints, then run `node "${CLAUDE_PLUGIN_ROOT}/bin/stale-claim-pr.js" --claim-file "${CLASSIFY_INPUT}" --listing "{that path}" --repo "{owner}/{repo}"` — the matcher `bin/claim-targets.js` runs on the `gh` path (`claim-store.js`'s `staleClaimInFlightPr`); it validates the run id and normalizes the MCP entries itself. `"match": true` stops the claim and writes nothing, as the tombstone case does. A non-null `failure`, a non-zero exit, or a listing that could not be fetched or written, falls through to the write (fail open), after one line saying the check failed — never silently, so it is not read as no marked PR.

`tidy/scan-procedures.md`, replacing the whole "**Stale claim with an open PR (#4423).**" paragraph:

> **Stale claim with an open PR (#4423).** Before recommending Release for a `'stale'` blob, run `node "${CLAUDE_PLUGIN_ROOT}/bin/stale-claim-pr.js" --claim-file "${CLASSIFY_INPUT}" --resume` — the matcher `/claude-tweaks:flow`'s claim step runs (`claim-store.js`'s `staleClaimInFlightPr`); on the `gh` path each call lists open PRs itself, one listing per stale claim (stale claims are few). With `gh` absent (exit 2), list open PRs once per tidy run via `mcp__github__list_pull_requests` (`state: open`, paged), Write them as one JSON array to the path `node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" --value stale-claim-open-prs.json` prints, and add `--listing "{that path}"` to each call. `"match": false` with a null `failure` means plain Release. `"match": true` recommends Resume instead and routes as `step-6-auto.md`'s **Unsettled run** row: Auto (no-op, always surfaced), rendered in **Yours** as "Resume open PR #{number} ({url}) — {resume}" when the output carries `resume` (the PR body's resume line, already validated as a paste-safe command naming this same run), otherwise — it carries `resolve` — "Resolve open PR #{number} ({url}) before any release"; `{url}` is `link` and `{number}` its trailing `/pull/` number. It is never staged, so it gets no needs-decision comment, and the claim is never released. A non-null `failure` — a failed listing (on whichever transport ran — the MCP listing applies only when `gh` is absent, never after a `gh` failure) or a 1000-entry listing with no match, which may have cut the PR off — degrades to **Manual review** with one SKIP note, never an unchecked Release; so does any other non-zero exit (1 or 3, or 2 again after `--listing` was added).

Then update `.claude/skills/prose-code-twin-pin/SKILL.md` lines 208-213 to say the regex is restated in one skill file (`flow/claim-targets.md`), the gh-absent MCP path and `/tidy` now call `bin/stale-claim-pr.js` instead (#4596), and the test asserts the copy list both ways.

- [ ] **Step 4: Run tests to verify they pass, plus every suite reading these two skill files**

Run: `node --test tests/issue-claims-stale-open-pr-conformance.test.js tests/tidy-stale-claim-open-pr-conformance.test.js tests/issue-claims-pr-scan-composition.test.js tests/claim-mcp-projection-conformance.test.js`
Expected: PASS. Then `git grep -n -F -e 'trimmed line equal to' -e 'head.repo.full_name' -- plugin/skills` — expected: no output. Control (run once, record the hits): `git grep -n -F -e 'trimmed line equal to' -e 'head.repo.full_name' origin/main -- plugin/skills` lists `_shared/issue-claims.md` and `tidy/scan-procedures.md` lines.

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/_shared/issue-claims.md plugin/skills/tidy/scan-procedures.md tests/issue-claims-stale-open-pr-conformance.test.js tests/tidy-stale-claim-open-pr-conformance.test.js .claude/skills/prose-code-twin-pin/SKILL.md
git commit -m "Point the MCP claim path and /tidy at stale-claim-pr.js — no prose copy of the marker rule or Resume grammar (refs #4596)"
```
