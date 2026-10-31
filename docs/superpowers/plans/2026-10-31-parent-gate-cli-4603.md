# Parent-Gate CLI Implementation Plan (#4603)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Parent-Gate Procedure's Resolve / Enumerate / Self-inclusion / Evaluate steps and the below-floor close's idempotence check run as one tested CLI, `plugin/bin/parent-gate.js`, that prints one JSON verdict; `wrap-up/verification-brief-parent-gate.md` keeps prose only for routing that verdict.

**Architecture:** A pure module `plugin/bin/lib/issues/parent-gate.js` turns already-gathered facts into the verdict (reusing `parentGateState`, `maxRiskTier`, `exceedsOversightFloor`, `isTrustedComment`). A thin CLI `plugin/bin/parent-gate.js` gathers those facts through an injectable `gh` runner — parent resolution, paginated sub-issue enumeration through `plugin/bin/fetch-sub-issues.js`'s exported `run` in-process, per-sub-issue `gh issue view`, the parent's own view, and the current `gh` login only when the close is reachable — and, under `--backend local-files`, through `local-store.js`. The skill prose and `_shared/pr-first-merge-post-merge.md` Step 4.0b call the CLI and route on its fields.

**Tech Stack:** Node 18+ CommonJS, zero npm deps, `node --test`; Markdown skill prose.

**Spec:** `.claude-tweaks/pipelines/2026-10-31T094619-record-4603/work/4603-spec.md` (record #4603)

Scope keywords: parentGateState, Enumerate the parent's sub-issues, sub_issues

Check B sweep (2026-10-31): every unplanned hit is no-change — `sub_issues`/`parentGateState` hits are independent readers (`engine-verify.js`, tidy's scans, `link.js`, `backlog-grant-gate`) that this record does not route through the CLI; the `Enumerate the parent's sub-issues` hits (`tidy/actions-*.md`, `wrap-up/verification-brief.md`, `docs/skill-graph.md`) cite the section by name, and Task 4 keeps every section heading.

## Global Constraints

- **Verdict shape** (byte-identical field names in every task):
  `{ parent, state, exceeds, closeReason, idempotence, maxTier, riskFloor, parentIssue, needs, held, subIssues, skipped }`
  - `parent`: number, or `null` when no parent resolves.
  - `state`: `'no-parent' | 'incomplete' | 'gated' | 'resolved' | 'due'` (the last four are `parentGateState`'s own values).
  - `exceeds`: boolean when `state === 'due'`, else `null`.
  - `closeReason`: `'completed' | 'not planned'` when `state === 'due' && exceeds === false`, else `null`. `'completed'` iff at least one sub-issue has `stateReason === 'COMPLETED'` or is a member of the effective closing set; otherwise `'not planned'`.
  - `idempotence`: when `state === 'due' && exceeds === false`, one of `'already-closed'` (parent `CLOSED`), `'reopened'` (parent `OPEN` with `stateReason === 'REOPENED'`), `'close-only'` (a counted comment carries the heading), `'comment-and-close'`; else `null`. Checked in that order.
  - `maxTier`: `maxRiskTier(...)` result or `null` (when `undefined`). `riskFloor`: the resolved floor string.
  - `parentIssue`: `true` iff the parent's labels include `parent-issue` (local-files: `facets.isParentIssue === true`).
  - `needs`: the parent's labels starting with `needs:`, in label order (local-files: `[]`).
  - `held`: enumerated sub-issue numbers that appear in `--held`, ascending.
  - `subIssues`: one `{ number, title, state, stateReason, pr }` per enumerated sub-issue, ascending by number, `state` as given to the gate (closing-set members already `'CLOSED'`); `pr` = `--merging-pr` for an effective-closing-set member when given, else the `number` of the **last** `closedByPullRequestsReferences` entry whose `repository.owner.login`/`repository.name` equal this repo (case-insensitive), else `null`.
  - `skipped`: `untrustedSkipNote(c)` for each comment carrying the heading that was not counted, in comment order.
- **Heading:** `## Closed below the oversight floor`, matched line-anchored: `/^## Closed below the oversight floor[ \t]*\r?$/m`. A comment counts iff `isTrustedComment(c)` or `c.author && c.author.login === currentLogin` (non-empty login).
- **Oversight floor:** `exceedsOversightFloor({ risk: maxRiskTier(subIssues.map((s) => parseRecordFacets(s.labels))) }, { riskFloor, sizeFloor: null })` — `sizeFloor` is the literal `null`.
- **Effective closing set:** `--closing` tokens, each `N` or `owner/repo#N`; a token naming another repo (case-insensitive compare) is dropped. `--sub-issue N` with no `--closing` defaults to `{N}`, never `{}`. `--parent` with no `--closing` is `{}`. The set overrides `state` to `'CLOSED'` only for sub-issues the enumeration returned; it never adds sub-issues.
- **CLI exit codes (Split-1/2 vocabulary, `fetch-sub-issues.js`'s):** 0 verdict printed (every `state`, `no-parent` included); 1 malformed invocation; 2 `gh` absent or owner/repo unresolvable; 3 a `gh` call failed (stderr names the call). Status-as-data: a verdict is never an exit code.
- **Governing skill `gh-api-module-pattern`** — read `.claude/skills/gh-api-module-pattern/SKILL.md` and `cli-wrapper-contract.md` in full before Task 2. Quoted rules:
  - "The module takes `runner(args)`, invoked as if `gh ${args.join(' ')}`, returning stdout; a throw is a failed call. Export `defaultRunner` = `execFileSync('gh', args, { encoding: 'utf8' })` — always an argv array, never a shell string (no injection surface, no quoting bugs)."
  - "**Every real spawn passes `windowsHide: true` in a form `tests/windows-hide-spawn-conformance.test.js` can see.**"
  - "Logic lives in an exported `run(argv, deps)`; every side effect (`runner`, `ghAvailable`, `remoteUrl`, `stdout`, `stderr`) goes through `deps` so tests inject fakes. **Every** `deps` call that can throw (e.g. `remoteUrl` outside a git repo) is try/caught into the documented exit-code contract"
  - "`require.main === module` guard sets `process.exitCode = run(...)` (never `process.exit`, which can truncate piped stdout). `--help` short-circuits before any availability probe."
  - "Every malformed-input class must actually reach its malformed code — `Number('') === 0` passes `Number.isInteger`, so validate positivity and pair-structure explicitly."
- **Governing skill `skill-prose-conformance-tests`** (Task 4) — quoted rules:
  - "Anchor on a literal token the skill already uses — a filename pattern, a fenced heading, a table-row prefix — never a paraphrase."
  - "copy the pinned literal out of the edit's own replacement text, never from memory of what that edit says."
  - "**Retargeting existing pins: diff the assertion inventory, not the plan's prose anchor list.** … enumerate every assertion literal in the *replaced* tests and give each one an explicit verdict — moved, retargeted (naming the new literal), or retired (with its own stated reason)."
  - "Apply the whitespace-collapsed control scan to **both** directions of a migration suite — absence assertions need it more than presence ones."
  - "Prove the assertion can go red before trusting its green"
- **Commits:** subject `{Verb} {what} — refs #4603` (never `closes`/`fixes`), body ending with the line `Claude-Session: https://claude.ai/code/session_01YPgdwRbmhnsV1HHKVuy4KZ`. Run git as `git -C "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude/worktrees/dispatch-record-4603" …`, one plain command per Bash call. Never `git stash`.
- **Scope and edit discipline:** "Commit tests only where the task asks for them or the repo already keeps tests for this kind of change, sized like the neighboring test files; scratch checks stay scratch. Touch only what the task requires — a pre-existing bug you notice is a follow-up to report, not a fix to fold in, unless the task cannot work without it. Don't reformat or "improve" adjacent code; edit in place rather than rewrite when the result is the same."
- **Test runs:** targeted suites only (`node --test <file>`); the full suite runs centrally.

## Review Focus

1. **A just-merged sub-issue still reads `OPEN`.** Expected: as a `--closing` member it counts `CLOSED` and `COMPLETED`; the gate reads `due`. Pinned in Task 1 (`closing member counts CLOSED and completed`).
2. **Running the close twice** (a heading comment from the plugin's own non-member bot identity, then a failed close). Expected: `close-only`, never a second comment. Pinned in Task 1 (`own-login heading comment counts`).
3. **A planted heading from an untrusted commenter.** Expected: `comment-and-close`, with that comment named in `skipped`. Pinned in Task 1.
4. **An unscored sibling** (no `risk:*`). Expected: `maxTier: null`, `exceeds: true`, no close. Pinned in Task 1.
5. **A `gh` failure mid-gather** (one sub-issue view throws). Expected: exit 3, nothing on stdout, so the prose fails open. Pinned in Task 2.

## Spec coverage map

| Spec item | Task |
|---|---|
| Deliverable 1 (CLI, resolve native/`Parent: #N`, paginated enumeration with `stateReason`, self-inclusion, floor, JSON verdict) | Tasks 1, 2, 3 |
| Deliverable 2 (prose calls the CLI, routing only) | Task 4 |
| AC1.1 (> 30 sub-issues) | Task 2 |
| AC1.2 (all closed not-planned) | Tasks 1, 2 |
| AC1.3 (cross-repo closing reference) | Tasks 1, 2 |
| AC1.4 (human-reopened parent) | Tasks 1, 2 |
| AC1.5 (parent without `parent-issue`) | Tasks 1, 2 |
| AC1.6 (each case gets the prose's verdict) | Tasks 1, 2 |
| AC2.1 (`issues/$PARENT_NUM/sub_issues` gone from the gate file) | Task 4 |
| Key File `pr-first-merge-post-merge.md` Step 4.0b (a caller) | Task 4 |

---

### Task 1: Pure verdict module

**Role:** judgment
**Review risk:** high

**Files:**
- Create: `plugin/bin/lib/issues/parent-gate.js`
- Test: `tests/bin-lib/issues/parent-gate.test.js`
- Waived `plugin/bin/lib/issues/acceptance.js`: read only — `parentGateState` is reused unchanged (Step 3).

**Interfaces:**
- Consumes: `parentGateState` (`./acceptance`), `maxRiskTier`/`exceedsOversightFloor` (`./oversight-floor`), `parseRecordFacets` (`./record`), `isTrustedComment`/`untrustedSkipNote` (`./comment-trust`).
- Produces:
  - `CLOSE_HEADING_RE` (the regex in Global Constraints).
  - `parseParentLine(body: string) -> number|null` — first line-anchored `/^Parent: #(\d+)\b/m` match.
  - `parseClosingTokens(tokens: string[], { owner, repo }) -> { numbers: number[] } | { error: string }` — `N` or `owner/repo#N`; foreign repo dropped; anything else (including `0`, `''`, `#5`, `a/b#x`) is `{ error }`.
  - `evaluateParentGate(input) -> verdict`, `input` = `{ parent: number, parentLabels: string[], parentState: string, parentStateReason: string, parentComments: object[], currentLogin: string|null, subIssues: [{ number, title, state, stateReason, labels: string[], closedBy: [{ number, repository: { name, owner: { login } } }] }], closingSet: number[], held: number[], mergingPr: number|null, owner: string, repo: string, riskFloor: string }`. optional `parentBody: string` — when a string (the local-files backend), the heading test runs on it alone and `parentComments`/`currentLogin` are ignored (`close-only` iff it matches `CLOSE_HEADING_RE`). `parentComments`/`currentLogin` are read only when the idempotence branch is reached. Returns the verdict shape from Global Constraints (`state` never `'no-parent'` here).

- [ ] **Step 1: Write the failing tests** in `tests/bin-lib/issues/parent-gate.test.js` (style: `tests/bin-lib/issues/acceptance.test.js`). A `base()` helper builds an input with parent `#10`, labels `['parent-issue']`, `OPEN`/`''`, two `CLOSED`/`COMPLETED` sub-issues `#11`, `#12` labelled `risk:low`, owner/repo `o/r`, `riskFloor: 'high'`, `closingSet: []`, `held: []`, `mergingPr: null`, `currentLogin: 'bot'`, `parentComments: []`. Tests:
  - `AC1.2: all sub-issues closed not-planned close the parent as not planned` — both `stateReason: 'NOT_PLANNED'` → `{ state: 'due', exceeds: false, closeReason: 'not planned', idempotence: 'comment-and-close' }`.
  - `AC1.2: one completed sub-issue closes the parent completed` — `#11` `NOT_PLANNED`, `#12` `COMPLETED` → `closeReason: 'completed'`.
  - `closing member counts CLOSED and completed` — `#12` `OPEN`/`''`, `#11` `NOT_PLANNED`, `closingSet: [12]` → `state: 'due'`, `closeReason: 'completed'`, `subIssues[1].state === 'CLOSED'`.
  - `closing set never adds sub-issues` — `closingSet: [99]`, `#12` `OPEN` → `state: 'incomplete'`, `subIssues.length === 2`.
  - `AC1.4: a human-reopened parent is never re-closed` — `parentStateReason: 'REOPENED'` → `idempotence: 'reopened'`.
  - `an already-closed parent is a no-op` — `parentState: 'CLOSED'` → `idempotence: 'already-closed'`.
  - `trusted heading comment means close only` — one comment `{ authorAssociation: 'MEMBER', author: { login: 'x' }, body: 'intro\n## Closed below the oversight floor\n' }` → `'close-only'`, `skipped: []`.
  - `own-login heading comment counts` — `authorAssociation: 'NONE'`, `author.login: 'bot'` → `'close-only'`.
  - `untrusted heading comment is skipped and named` — `authorAssociation: 'NONE'`, login `'eve'`, `url: 'u1'` → `'comment-and-close'`, `skipped.length === 1`, `skipped[0]` includes `'u1'`.
  - `parentBody replaces the comment scan` — `parentBody: 'x\n## Closed below the oversight floor\n'` with an untrusted heading comment present → `'close-only'`, `skipped: []`; `parentBody: 'x'` with a trusted heading comment → `'comment-and-close'`.
  - `a heading mentioned mid-line does not count` — trusted body `'see ## Closed below the oversight floor'` → `'comment-and-close'`.
  - `AC1.5: a parent without parent-issue is reported` — `parentLabels: ['needs:human']` → `parentIssue: false`, `needs: ['needs:human']`.
  - `unscored sibling fails closed` — `#12` labels `[]` → `maxTier: null`, `exceeds: true`, `closeReason: null`, `idempotence: null`.
  - `above-floor risk exceeds` — `#12` `risk:high` → `exceeds: true`, `maxTier: 'high'`.
  - `gated and resolved parents are no-ops` — `demo:pending` → `state: 'gated'`; `demo:approved` → `'resolved'`; both `exceeds: null`.
  - `held lists enumerated held sub-issues only` — `held: [12, 99]` → `held: [12]`.
  - `AC1.3: pr prefers merging PR for closing members, else last same-repo reference` — `#11` closedBy `[{number:5, repo o/r}, {number:7, repository other/x}]` → `subIssues[0].pr === 5`; `#12` in `closingSet`, `mergingPr: 40` → `pr === 40`; a sub-issue with only a foreign reference → `pr === null`.
  - `AC1.3: parseClosingTokens drops a cross-repo closing reference` — `parseClosingTokens(['12', 'other/r#11', 'O/R#13'], { owner: 'o', repo: 'r' })` → `{ numbers: [12, 13] }`; `['0']`, `['']`, `['#5']`, `['a/b#x']` each → `{ error }`.
  - `parseParentLine reads a line-anchored Parent: #N` — `'x\nParent: #42\n'` → `42`; `'see Parent: #42'` → `null`; `''` → `null`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/issues/parent-gate.test.js`
Expected: FAIL — `Cannot find module '../../../plugin/bin/lib/issues/parent-gate'`

- [ ] **Step 3: Implement `plugin/bin/lib/issues/parent-gate.js`** with the exports above. Header comment names #4603 and the eight #4466 defects it replaces in prose. Order inside `evaluateParentGate`: apply the closing set to `state`; `parentGateState`; if `due`, the floor; if `due && !exceeds`, `closeReason` then idempotence.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/issues/parent-gate.test.js tests/bin-lib/issues/acceptance.test.js`
Expected: PASS, 0 failures

- [ ] **Step 5: Commit** both files: `Add the parent-gate verdict module — refs #4603`

---

### Task 2: `bin/parent-gate.js` CLI (github-issues)

**Role:** integration
**Review risk:** high

**Files:**
- Create: `plugin/bin/parent-gate.js`
- Modify: `docs/plugin-structure.md` — one CLI line beside `fetch-sub-issues.js`'s (line ~219): usage, verdict fields, exit codes, test file.
- Test: `tests/parent-gate-cli.test.js` (style: `tests/fetch-sub-issues-cli.test.js`)
- Waived `plugin/bin/fetch-sub-issues.js`: read only — its exported `run` is called in-process, unchanged (Step 3).

**Interfaces:**
- Consumes: Task 1's exports; `run` from `plugin/bin/fetch-sub-issues.js` (called in-process with `['{parent}', '--repo', '{owner}/{repo}', '--resolve-retries']` and `deps` = this CLI's `ghAvailable`/`runner`/`stderr` plus a capturing `stdout`; its exit 4 → one REST call `['api', '--paginate', 'repos/{o}/{r}/issues/{p}/sub_issues', '--jq', '.[].number']`; any other non-zero → exit 3); `fetchNativeParent` (`lib/issues/native-dependencies`); `parseSubIssues` (`lib/issues/record`); `parseRepo`/`ghAvailable`/`remoteUrl` (`lib/repo-resolve`); `resolvePolicyKeys` (`lib/policy-schema`).
- Produces: `run(argv, deps) -> exitCode`, `parseArgs(argv)`. Usage:
  `parent-gate.js (--sub-issue <n> | --parent <n>) [--closing <tok>[,<tok>…]] [--held <n>[,<n>…]] [--merging-pr <n>] [--repo owner/name] [--work-links native|body-text] [--risk-floor low|medium|high|always] [--backend github-issues|local-files] [--records-dir <dir>] [--help]`
  Exactly one of `--sub-issue`/`--parent`. `--work-links`/`--risk-floor` default to `.claude-tweaks/policy.yml` at the repo root (`git rev-parse --show-toplevel`, cwd outside a repo) via `resolvePolicyKeys(['work-links', 'risk-floor'], { policyRaw })`. `deps`: `ghAvailable`, `remoteUrl`, `runner`, `repoRoot`, `readPolicyRaw`, `stdout`, `stderr` (Task 3 adds the local-store reads). `--backend local-files` is rejected with exit 1 until Task 3.
  Gather calls (github-issues), each through `deps.runner`:
  - native parent: `fetchNativeParent({ number, owner, repo, runner })`; body-text parent: `['issue', 'view', '{n}', '--json', 'body']` → `parseParentLine`.
  - native enumeration: as Consumes above; body-text: `['issue', 'view', '{p}', '--json', 'body']` → `parseSubIssues`.
  - each sub-issue: `['issue', 'view', '{n}', '--json', 'number,title,state,stateReason,labels,closedByPullRequestsReferences']` (labels mapped to names).
  - parent: `['issue', 'view', '{p}', '--json', 'state,stateReason,labels,comments']`.
  - login, only when the verdict reaches the idempotence branch with the parent `OPEN` and not `REOPENED`: `['api', 'user', '--jq', '.login']`.
  No parent → print `{ parent: null, state: 'no-parent', …every other field null or [] }`, exit 0.

- [ ] **Step 1: Write the failing tests.** A fake runner keyed on argv answers each gather call from a fixture map; `ghAvailable: () => true`, `remoteUrl: () => 'git@github.com:o/r.git'`, `readPolicyRaw: () => 'work-links: native\nrisk-floor: high\n'`. Tests:
  - `AC1.1: a parent with more than 30 sub-issues is enumerated in full` — `--parent 10`; the GraphQL sub-issue answer lists 35 numbers (100-134), all `CLOSED`/`COMPLETED`/`risk:low` except #130 `OPEN` → `state: 'incomplete'`, `subIssues.length === 35`. Same fixture with #130 closed → `state: 'due'`.
  - `AC1.1: the REST fallback paginates when the subIssues field is unavailable` — schema probe reports the field absent (fetch-sub-issues exit 4) → the runner sees `['api', '--paginate', 'repos/o/r/issues/10/sub_issues', '--jq', '.[].number']`; 35 numbers back → `subIssues.length === 35`.
  - `AC1.2: all closed not-planned` — `--sub-issue 11 --closing 11`, #11 `OPEN`, #12 `NOT_PLANNED` → `closeReason: 'completed'` (closing member); same with #11 `NOT_PLANNED` and `--parent 10` → `'not planned'`.
  - `AC1.3: a cross-repo closing token does not close this repo's sub-issue` — `--sub-issue 12 --closing other/r#11,12`, #11 `OPEN` → `state: 'incomplete'`.
  - `AC1.4: a human-reopened parent` — parent `stateReason: 'REOPENED'` → `idempotence: 'reopened'`, and the runner never sees `['api', 'user', …]`.
  - `AC1.5: a parent without parent-issue` — parent labels `[]` → `parentIssue: false`, exit 0.
  - `body-text resolves Parent: #N and the parent's task list` — `--work-links body-text`, #11 body `'Parent: #10'`, #10 body `'- [x] #11\n- [x] #12'` → `parent: 10`, `subIssues.length === 2`.
  - `no resolvable parent prints no-parent` — native parent `null` → `{ parent: null, state: 'no-parent' }`, exit 0.
  - `--sub-issue without --closing counts itself closed` — #11 `OPEN`, #12 `CLOSED` → `state: 'due'`.
  - exit codes: no args / both selectors / `--sub-issue 0` / `--closing a/b#x` / `--risk-floor bogus` → 1; `ghAvailable: () => false` → 2; one sub-issue view throws → 3 with empty stdout and stderr naming `#12`; `--help` → 0 before `ghAvailable` is called.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/parent-gate-cli.test.js`
Expected: FAIL — `Cannot find module '../plugin/bin/parent-gate'`

- [ ] **Step 3: Implement `plugin/bin/parent-gate.js`** — header comment carries the usage, the verdict fields and the exit codes; real `runner` = `execFileSync('gh', args, { encoding: 'utf8', timeout: 30000, windowsHide: true })`; `require.main` guard sets `process.exitCode`. Add the `docs/plugin-structure.md` line.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/parent-gate-cli.test.js tests/bin-lib/issues/parent-gate.test.js tests/fetch-sub-issues-cli.test.js tests/windows-hide-spawn-conformance.test.js tests/bin-lib/exit-code-conformance.test.js`
Expected: PASS, 0 failures

- [ ] **Step 5: Real-input probe** (record each printed line in the task report). From the worktree:
  - `node plugin/bin/parent-gate.js --parent 3374` — expect `state` `gated`/`resolved`/`due` and `subIssues.length === 8`; independent count: `node plugin/bin/fetch-sub-issues.js 3374 --resolve-retries` lists 8.
  - `node plugin/bin/parent-gate.js --sub-issue 3375` — expect `parent: 3374`.
  - `node plugin/bin/parent-gate.js --parent 3972` — expect `state: 'incomplete'`, `subIssues.length === 7`, `parentIssue: true`.
  - `node plugin/bin/parent-gate.js --sub-issue 4603` — expect `state: 'no-parent'`.
  A mismatch is a defect to fix before committing, not a number to adjust.

- [ ] **Step 6: Commit** the three files: `Add bin/parent-gate.js — the Parent-Gate Procedure's gather and evaluate as one CLI — refs #4603`

---

### Task 3: local-files backend

**Role:** integration

**Files:**
- Modify: `plugin/bin/parent-gate.js`, `docs/plugin-structure.md` (its line from Task 2)
- Test: `tests/parent-gate-cli.test.js` (append)

**Interfaces:**
- Consumes: `queryRecords`/`DEFAULT_DIR` (`lib/issues/local-store`).
- Produces: `--backend local-files [--records-dir <dir>]` (default `DEFAULT_DIR`, relative to the repo root). No `gh` call, no `ghAvailable` check. Sub-issue record: the open+closed listing entry with `id === n`; parent = its `facets.parent` (`null` → `no-parent`). Sub-issues: `[...queryRecords(dir, { parent }), ...queryRecords(dir, { parent, closed: true })]` → `{ number: r.id, title: r.title, state: r.facets.closed ? 'CLOSED' : 'OPEN', stateReason: r.facets.closed ? (r.facets.notPlanned ? 'NOT_PLANNED' : 'COMPLETED') : '', labels: [] plus 'risk:{r.facets.risk}' when set, closedBy: [] }`. Parent record: `parentLabels` = `r.facets.acceptance ? ['demo:' + r.facets.acceptance] : []`, plus `'parent-issue'` when `facets.isParentIssue === true`; `parentState` from `facets.closed`, `parentStateReason: ''`; idempotence via Task 1's `parentBody` input (the parent record's body; no comments, no login). `closeReason` is computed exactly as for github-issues. A filesystem error → exit 3. `deps` gains `queryRecords` (default the real one) so tests use a temp dir via the real store.

- [ ] **Step 1: Write the failing tests** — build records in a temp dir with `createRecord`/`closeRecord` (the real writers, never hand-written files): parent with `is-parent-issue`, two sub-issues with `parent` facets and `risk: low`.
  - `local-files: all sub-issues not planned closes not planned` — both closed with `notPlanned: true` → `closeReason: 'not planned'`.
  - `local-files: due below the floor closes completed` — both closed → `{ state: 'due', exceeds: false, closeReason: 'completed', idempotence: 'comment-and-close', parentIssue: true }`.
  - `local-files: closing set counts the sub-issue in hand` — one open, `--sub-issue {that id}` → `state: 'due'`.
  - `local-files: a body heading means close only; a closed parent is a no-op` — parent body ends with the heading → `'close-only'`; closed parent → `'already-closed'`.
  - `local-files: acceptance facet gates` — parent `acceptance: 'pending'` → `state: 'gated'`.
  - `local-files: never calls gh` — `ghAvailable` throws if called; exit 0.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/parent-gate-cli.test.js`
Expected: FAIL after Step 1 — the new tests only (exit 1, `--backend local-files` rejected).

- [ ] **Step 3: Implement** the backend branch; update the docs line.

- [ ] **Step 4: Run** `node --test tests/parent-gate-cli.test.js tests/bin-lib/issues/parent-gate.test.js` — Expected: PASS, 0 failures.

- [ ] **Step 5: Commit** the three files: `Teach bin/parent-gate.js the local-files backend — refs #4603`

---

### Task 4: Route the Parent-Gate Procedure through the CLI

**Role:** judgment
**Review risk:** high

**Files:**
- Modify: `plugin/skills/wrap-up/verification-brief-parent-gate.md`
  - New section `## Run the gate CLI`, placed right before `## Resolve the parent`: the one invocation per entry shape (sub-issue side: `node "${CLAUDE_PLUGIN_ROOT}/bin/parent-gate.js" --sub-issue {n} --closing {$CLOSING_SUB_ISSUES, comma-joined}`; Step 4.0b adds `--held {…}` and `--merging-pr {pr}` when non-empty; parent side: `--parent {n}`; `--backend local-files` under that driver), the verdict fields (Global Constraints, one line each), and exit codes 2/3 → the existing **Fail open on every `gh` call** paragraph (unchanged).
  - `## Resolve the parent`, `## Enumerate the parent's sub-issues`, `## Self-inclusion rule`, `## Evaluate the gate`: keep every heading (other files cite them by name) and the rules they state — the self-inclusion table and its default-set rule stay, since callers size `$CLOSING_SUB_ISSUES` from it — but delete every fenced snippet (`WORK_LINKS=…`, the `gh api --paginate …/sub_issues` fence with its body-text half, the local-files `queryRecords` fence, the parent-labels `gh issue view` fence, the `resolve-policy.js --values risk-floor size-floor` fence, the `exceedsOversightFloor(…)` fence) and every sentence instructing an agent to fetch or compute; each section says, in one or two sentences, what the CLI does for it. `## Evaluate the gate` routes on `state`, `exceeds`, `parentIssue`, `needs` and `held`; keep the literal "no `demo:pending`, no brief" and "end-to-end variant" in the `**`exceeds: false`**` bullet (pinned by `tests/try-it-contract-conformance.test.js:170-171`).
  - `## Close the parent below the floor` step 1: replace the two `gh` fences and the comment-counting rules with routing on `idempotence` (`already-closed`/`reopened` → no-op, `reopened` reported in the output; `close-only` → step 3's close call only; `comment-and-close` → steps 2-3) and on `skipped` (each named in the output). Step 2 takes `{maxTier}`, `{riskFloor}` and each listing line's `{title}`/`{pr}` from the verdict (`subIssues[].pr`, `null` → no suffix); step 3 closes with `--reason "{closeReason}"`. Leave steps 4-5 and every later section as they are.
- Modify: `plugin/skills/_shared/pr-first-merge-post-merge.md` Step 4.0b — the per-record sentence runs the CLI (`--sub-issue {n} --closing {$CLOSING_SUB_ISSUES} --held {each reopened[], pendingClose[] and failed[] issue} [--merging-pr {pr-number}]`) and routes: `held` non-empty → skip and name; `parentIssue: false` → no-op, named; `needs` non-empty → skip and name; `due` + `exceeds: false` → **Close the parent below the floor**. Keep the pinned sentences quoted by `tests/below-floor-parent-close-conformance.test.js` lines 257-344 byte-identical unless a sentence instructs an agent to fetch; retarget any such pin.
- Modify: `tests/below-floor-parent-close-conformance.test.js` — inventory every assertion literal reading `verification-brief-parent-gate.md`'s Resolve/Enumerate/Self-inclusion/Evaluate sections and Close step 1, and Step 4.0b; give each a verdict in the commit body (moved / retargeted to `{new literal}` / retired: `{reason — behavior now unit-tested in tests/parent-gate-cli.test.js or tests/bin-lib/issues/parent-gate.test.js}`). Known now: lines 130, 132, 135, 136-141, 142 (Close step 1 literals) and 152-153 (Enumerate literals) retire to the unit tests; add `AC2.1: the gate file no longer composes the sub-issue enumeration` asserting the collapsed file text lacks `issues/$PARENT_NUM/sub_issues` and includes `bin/parent-gate.js`, with a go-red control over the frozen pre-change Enumerate fence (`git show d4d40c982:plugin/skills/wrap-up/verification-brief-parent-gate.md`, the test's existing `preChangeGate` pattern).
- Modify: `tests/skill-fence-guard-shapes.test.js:156` — drop the `'# work-links: native'` ratchet entry once that fence is gone (keep line 157's).
- Check (no change expected): `tests/comment-trust-conformance.test.js` (its `PARENT_GATE` pin is the **Apply the gate** brief paragraph, untouched), `tests/session-tmp-root-migration.test.js` (lists the file; the `wrapup-parent-body.md` resolve leaves with the fence), `tests/try-it-contract-conformance.test.js`, `tests/demo-full-verification-pointer.test.js`, `tests/verify-json-acceptance-guard-conformance.test.js`.

**Interfaces:**
- Consumes: Task 2/3's usage, verdict fields and exit codes, verbatim.

- [ ] **Step 1: Write the failing test** `AC2.1: the gate file no longer composes the sub-issue enumeration` (above), plus `the gate file and Step 4.0b invoke bin/parent-gate.js` asserting the collapsed text of `## Run the gate CLI` includes `bin/parent-gate.js" --sub-issue` and `--parent`, and Step 4.0b's collapsed section includes `bin/parent-gate.js" --sub-issue` and `--held`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/below-floor-parent-close-conformance.test.js`
Expected: FAIL after Step 1 — on the two new tests only.

- [ ] **Step 3: Edit the two skill files and retarget the pins** as listed. Then the AC check:

Run: `grep -F "issues/\$PARENT_NUM/sub_issues" plugin/skills/wrap-up/verification-brief-parent-gate.md`
Expected: no output, exit 1.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/below-floor-parent-close-conformance.test.js tests/skill-fence-guard-shapes.test.js tests/comment-trust-conformance.test.js tests/session-tmp-root-migration.test.js tests/try-it-contract-conformance.test.js tests/demo-full-verification-pointer.test.js tests/verify-json-acceptance-guard-conformance.test.js tests/fetch-sub-issues-prose-conformance.test.js tests/closing-links-prose-conformance.test.js`
Expected: PASS, 0 failures. Then `git -C "{worktree}" grep -n -F -e 'wrapup-parent-body' -e 'Enumerate the parent' -- plugin tests docs` and confirm every remaining hit still reads true.

- [ ] **Step 5: Commit** the changed files: `Route the Parent-Gate Procedure through bin/parent-gate.js — refs #4603`, body carrying the pin inventory verdicts.
