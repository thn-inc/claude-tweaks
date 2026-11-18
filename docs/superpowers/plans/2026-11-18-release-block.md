# Release-Block Signal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Releases stop while any open record carries the `release-block` label, naming each blocking record; `plugin/bin/release-block.js` reads (`check`) and sets (`stamp`) that state, and `/claude-tweaks:release` enforces it before any review or suite work.

**Architecture:** One gh CLI (`check`, `stamp`) on the injectable-runner seam, with a gh-free `--records-json` input for the MCP path. One new contract, `_shared/release-block.md`, holds the semantics, the release-gate procedure and the MCP equivalents. The release skill gains a Step 1.5 that runs `check` and routes on its exit code only, a Step 4 re-read rendered as a console row, and a Step 8 disposition stamp for every critical/high finding it files or declines as covered by an open record (stamping the covering record). All three are keyed on the forge (a GitHub origin), never on `work-backend` (spec `## Plan Review Clarifications`).

**Tech Stack:** Node 20+ CommonJS, `node:test`, `gh` CLI, markdown skill prose.

**Spec:** `.claude-tweaks/pipelines/2026-11-17T204803-spec-5881-5882-5883/spec-5882/work/5882-spec.md` (record #5882; parent #5838).

**Scope keywords:** release-block, release-held

## Global Constraints

- The label name is exactly `release-block`. Its bootstrap triple is `["release-block", "Release gate: releases stop while this is open — close the record or remove this label to clear", "B4006E"]` (95 characters, under GitHub's 100 cap; `B4006E` is a hue no other family uses).
- `check` exits: **0** none open, **1** blocked, **2** usage error, **3** state unreadable. `stamp` exits: **0** stamped or already stamped, **2** usage or no such record, **3** write failure. These codes and the exit-1 JSON shape `{"blocked":true,"records":[{"number":N,"title":"…","url":"…"}]}` are a stable contract that #5885 and #5887 will call. Change them only by expand-contract. The vocabulary is the spec's own domain set, not one of the four base vocabularies in `.claude/skills/gh-api-module-pattern/cli-wrapper-contract.md`. The file header says so.
- Unreadable is never reported as clear. A failed call, malformed output and a truncated list are all exit 3, never 0.
- `check`'s gh query is exactly `gh issue list --repo {slug} --label release-block --state open --limit 100 --json number,title,url,state`. It was probed read-only on 2026-11-18 with gh 2.103.3: a label that does not exist prints `[]` and exits 0, and rows carry capital `"state":"OPEN"`.
- Other probes (gh 2.103.3): `gh issue view 999999 --json number,state,labels,url` exits 1 with stderr `GraphQL: Could not resolve to an issue or pull request with the number of 999999. (repository.issue)`. `gh issue view 5894 …` (a PR) exits 0 with `"state":"MERGED"` and a `/pull/` url. `gh label list --search release-block --json name` returned two *other* labels (`fix-on-worktree-release-install-commands`, `fix-on-worktree-design-release-skill`), so the search is fuzzy. The write commands (`label create`, `issue edit --add-label`, `issue comment --body-file -`) have no read-only form and were **not** run live. Their argv copies the shipped calls in `plugin/bin/lib/claim-targets/claim-targets.js` (`ensureAndAddLabel`), `plugin/bin/lib/driver/merge.js` (`bootstrapParkedLabel`) and `plugin/bin/pr-checklist.js` (`--body-file -` on stdin).
- Run tests with `npm test -- <file>` or `node tools/run-tests.js <file>`, never a bare `node --test`, which a repo guard refuses. CI is Node 20, so use no API newer than Node 20.
- Skill prose: a skill reference in actionable text uses `/claude-tweaks:{skill}` (`tests/release-skill-reference-form.test.js`). Shell fences must pass `tests/skill-fence-guard-shapes.test.js` with no new ALLOWLIST entry, so they contain no `gh … | …` pipes and no `$VAR` inside git.
- Read-limit rail: `RAIL_BYTES` = 52,500 (`plugin/bin/lib/skill-audit/budgets.js`). `plugin/skills/release/SKILL.md` is at 50,225 B, leaving 2,275 B of headroom. **Budget for it: at most +1,700 B, so it ends at 51,925 B or less.** The remedy if Task 4 overshoots is to move the Step 1.5 routing paragraph into `_shared/release-block.md`'s "What a release does while a block is open" section and keep a two-sentence pointer plus the command in SKILL.md. Never trim another step's content. The other files touched sit far below the rail: `console.md` 12,292; `disposition.md` 12,789; `bookkeeping.md` 14,217; `execute.md` 47,865 (+≤120); `auto-mode-contract.md` 47,500 (+≤300); `autonomy-ceiling.md` 41,800 (+≤400); `work-record.md` 44,691 (+≤400); `label-bootstrap.md` 12,332. The new `_shared/release-block.md` stays at or below 10,000 B.
- Every commit message uses `{Verb} {what} — {detail} (#5882)`, followed by a blank line and then `Claude-Session: https://claude.ai/code/session_01X7gPF9abdcTSk7paDhuBhW` as its last line.
- Do not touch `docs/superpowers/plans/2026-11-17-*` or anything under `.claude-tweaks/pipelines/`.

**Governing-skill rules, quoted verbatim** (`.claude/skills/gh-api-module-pattern/SKILL.md` and `cli-wrapper-contract.md`; `.claude/skills/skill-prose-conformance-tests/SKILL.md`):

- "**Every real spawn passes `windowsHide: true` in a form `tests/windows-hide-spawn-conformance.test.js` can see.**"
- "**Every `gh` spawn wraps its options in `plugin/bin/lib/repo-resolve.js`'s `ghOptions(args, …)`.**"
- "**A CLI that takes an explicit `--repo` pins that repo's host for every gh call it makes.**"
- "A CLI that gates its origin this way joins both `ORIGIN_GATED` in `tests/gh-host-seam-conformance.test.js` and a `CLI_TABLE` row in `tests/helpers/gh-host-seam.js`"
- "Tests never touch real `gh`: fake runners branch on the `args` shape (`isGraphQL`, `isPost`-style lazy helpers) and `throw new Error('unexpected ' + args.join(' '))` on anything unhandled — a wrong endpoint fails loudly instead of passing silently."
- "**A fake `gh` that returns a fixed full row ignores the `--json` field list, so a test using it cannot see the list shrink.**"
- "**Bound every remote-contacting call on the seam; a local-only call owes no bound.**"
- "**A seam that writes a body widens to `runner(args, input)` and pipes it on stdin, instead of staging a temp file.**"
- "**Reduce `gh`'s raw `labels` and `state` to plain values where the module first reads them, never at each comparison.**"
- "**A `--repo` *consumer* must accept both shapes.**"
- "**A `gh`-absent caller hands the CLI already-fetched records as a file; the CLI never tries to reach MCP itself.**"
- "When an endpoint has no GitHub MCP equivalent, say so and name the real fallback; never invent an MCP row in `plugin/skills/_shared/github-write-transport.md`."
- "It exports `run` and `realDeps`; `argv` is `process.argv.slice(2)`, and `run` returns an integer exit code or a Promise of one. The script entry is the file's last statement: `if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);`."
- "A relative path is resolved against `deps.cwd()`, never left to `path.resolve` or `fs`"
- "freeze the bytes the change *replaced* as a fixture constant inside the test, then assert every pattern twice — it matches the live file, and it does **not** match the frozen excerpt."

**Exemplars to mirror:** `plugin/bin/list-claims.js`, for the `run` flow, the origin-or-`--repo` resolution, and `gh` absent before any call. `plugin/bin/accept-park.js`, for the entry-contract `realDeps` (`cwd`, `env` getter, `homeDir`, `gh(args, {cwd, env, stderr, homeDir})` wrapped in `ghOptions(…, injectedGhDeps(…))`, `pinGhHost(repoSpec, {env, cwd})`) and `resolveRepoSpec`, which uses `gateOriginRepo(remote, injectedGhDeps(pickInjected(deps)))`. `plugin/bin/preflight-records.js --records-json`, for the gh-free input seam.

## Review Focus

1. **A PR number passed to `stamp --record`.** `gh issue view` resolves PR numbers (probed: #5894 → `/pull/` url). Expected: exit 2, and nothing labelled. The test lives in Task 2.
2. **A project with no forge (no GitHub origin).** `check` has no repo to read there, and treating that as exit 2 or 3 would stop every release forever, which breaks AC3.1. Expected: Step 1.5 skips with a logged `SKIP` line, keyed on the forge per the spec's Plan Review Clarifications, never on `work-backend`. "Has a GitHub origin" is `_shared/forge-detection.md` check 1, `git -C "$RUN_ROOT" remote get-url origin` exits 0, the probe `release/execute.md`'s local-merge Tag bullet already keys on. A GitHub-hosted project with no `## Work records` flag (so `local-files`) still runs `check`. An origin whose host `release-block.js`'s own `gateOriginRepo` (`plugin/bin/lib/repo-resolve.js`) refuses exits 2 and stops `failed`, with the gate's `export GH_HOST=…` text: fail-closed, never a silent skip. The prose tests live in Tasks 3 and 4.
3. **A block stamped while Step 3's long review runs.** Release runs take 1.5–6 h, and #5885's rolling review can stamp during one. Expected: Step 4 re-reads `check` and holds the release before Step 5. The prose test lives in Task 5.
4. **`gh label list --search` is fuzzy** (probed above). Expected: a near-name match never counts as "label exists", so the label is created exactly when the exact name is absent. The test lives in Task 2.
5. **The MCP path spells state lowercase** (`open`/`closed`, per `_shared/github-write-transport.md`'s `issue_read` row). Expected: `--records-json` normalizes case, so a `closed` row never blocks and an `open` row does. The test lives in Task 1.

---

### Task 1: `release-block.js check` and its host-seam registration

**Role:** integration
**Review risk:** high

**Files:**
- Create: `plugin/bin/release-block.js`
- Create: `tests/release-block-cli.test.js`
- Modify: `tests/gh-host-seam-conformance.test.js` (add `'release-block.js'` to `PIN_WIRED` and to `ORIGIN_GATED`)
- Modify: `tests/helpers/gh-host-seam.js` (append a `CLI_TABLE` row: `{ cli: 'release-block.js', argv: ['check'], acceptsRepo: true, canned: { 'issue-list': '[]' } }`)

**Interfaces:**
- Produces, all exported from `plugin/bin/release-block.js`:
  - `run(argv: string[], deps) -> number`
  - `realDeps`
  - `parseArgs(argv) -> { verb, repo, recordsJson, record, finding, help } | { error }`
  - `EXIT = Object.freeze({ OK: 0, BLOCKED: 1, USAGE: 2, FAILURE: 3 })`
  - `LIST_LIMIT = 100`
  - `checkRows(text: string) -> { records: Array<{number, title, url}> } | { error: string }` — a pure validator that both input paths share.
- `realDeps` keys: `cwd()`, `env` (getter), `homeDir()`, `ghAvailable({env, cwd})`, `remoteUrl({cwd, env})`, `pinGhHost(repoSpec, {env, cwd})`, `gh(args, {cwd, env, stderr, homeDir, input})`, `readFile(p)`, `invalidateSnapshot(sessionId)` (used by Task 2), `stdout(s)`, `stderr(s)`.

- [ ] **Step 1: Write the failing tests** in `tests/release-block-cli.test.js`. Use an in-process `run(argv, fakeDeps)` in the style of `tests/list-claims-cli.test.js`. The fake `gh(args, opts)` records `{args, input}` and throws `new Error('unexpected ' + args.join(' '))` on any unhandled shape. Defaults: `remoteUrl` → `https://github.com/acme/widgets.git`; `cwd` → `/work`. `ROW7 = {number:7,title:'Fix the widget',url:'https://github.com/acme/widgets/issues/7',state:'OPEN'}`.
  - `AC1.1: one open release-block record -> exit 1 and stdout names #7 and its title`. Assert the code is 1. Assert stdout is exactly `{"blocked":true,"records":[{"number":7,"title":"Fix the widget","url":"https://github.com/acme/widgets/issues/7"}]}\n`.
  - `check: the query argv is exactly the open-state, labelled, limited list`. Assert the one gh call's args deep-equal `['issue','list','--repo','acme/widgets','--label','release-block','--state','open','--limit','100','--json','number,title,url,state']`.
  - `AC3.1: no open record -> exit 0, stdout {"blocked":false,"records":[]}`. The fake returns `[]`, which is also the missing-label case probed above.
  - `check: two open records print in ascending number order`. The fake returns rows 12 then 7. Assert the output records are `[7, 12]` by number.
  - `AC6.1: a closed record carrying the label never blocks`. The fake returns ROW7 with `state:'CLOSED'`. Assert exit 0. The argv test above pins `--state open` too.
  - `AC4.1: an auth or network failure -> exit 3, stderr says state unreadable`. Two fakes throw: one with `Object.assign(new Error('gh: HTTP 401'), {stderr:'HTTP 401: Bad credentials'})`, and one with `'error connecting to api.github.com'`. Each gives exit 3, and stderr matches `/state unreadable/`. Assert stdout is empty.
  - `AC4.3: malformed JSON -> exit 3, never 0`. Stdout is `not json`. Assert 3.
  - `AC4.4: a record without url -> exit 3`. One guard per fixture, so that only that guard decides: ROW7 minus `url` → 3. ROW7 minus `title` → 3. ROW7 minus `number` → 3. ROW7 with `number:'7'` → 3. Non-array `{}` → 3. Empty stdout → 3.
  - `AC7.1: a list that fills --limit 100 is truncated -> exit 3`. Use 100 valid OPEN rows → 3, with stderr matching `/truncated/`. Control: 99 rows → 1.
  - `check: gh absent and no --records-json -> exit 3, no gh call`. Set `ghAvailable` → false. The fake `gh` throws if called.
  - `check --records-json: no gh call and the same rules`. `readFile` is faked, and the fake `gh` throws if called. Cases: `[ROW7]` → 1 with the same stdout bytes as AC1.1. `[{...ROW7,state:'closed'}]` → 0. `[{...ROW7,state:'open'}]` → 1. `[]` → 0. `'{'` → 3. A row without `url` → 3. 100 rows → 3. A `readFile` that throws `ENOENT` → 3. A relative `recs.json` reaches `readFile` as `resolveAgainst('/work','recs.json')`; build the expected value with that same helper from `plugin/bin/lib/health-core/io.js`, so the test holds on Windows.
  - `usage -> exit 2`: no verb; verb `frobnicate`; `check --bogus`; `check --repo` with no value; `check --records-json` with no value; `check --records-json r.json --repo acme/widgets` (the two flags are mutually exclusive). Each exits 2 and makes zero gh calls.
  - `--help -> exit 0, usage on stdout, gh never probed`. A `ghAvailable` that throws must not be called.
  - `repo: --repo bare and host-qualified both reach gh as given, and the host is pinned`. `--repo acme/widgets` → argv `--repo acme/widgets`. `--repo ghe.example.com/acme/widgets` → argv `--repo ghe.example.com/acme/widgets`. `pinGhHost` is called once in each case. Without `--repo`, `pinGhHost` is never called.
  - `repo: no origin and no --repo -> exit 2`. `remoteUrl` throws. Assert stderr matches `/could not resolve owner\/repo/`.
  - `public contract: EXIT and LIST_LIMIT values`. Assert `deepStrictEqual(EXIT, {OK:0,BLOCKED:1,USAGE:2,FAILURE:3})` and `LIST_LIMIT === 100`.
  - `realDeps.gh carries the GH_TIMEOUT_MS bound`. Use `captureGhTimeout` from `tests/helpers/gh-timeout-probe.js`, with `envValue: '45000'` and `modulePaths: [require.resolve('../plugin/bin/release-block')]`. In `exercise`, set the env, re-require the module, and call `realDeps.gh(['issue','list'])`. Assert the result is `45000`.

- [ ] **Step 2: Run the tests and confirm they fail**
Run: `node tools/run-tests.js tests/release-block-cli.test.js`
Expected: FAIL with `Cannot find module '../plugin/bin/release-block'`.

- [ ] **Step 3: Implement `check` in `plugin/bin/release-block.js`**
  - The header comment states the usage line `usage: release-block.js check [--repo [host/]owner/name | --records-json <path>] | stamp --record <n> --finding "<category> at <file:line>|general" [--repo [host/]owner/name] [--help]`. It also states both verbs' exit codes as listed in Global Constraints, and that they are a stable contract.
  - `checkRows` parses the text and requires an array. If the array length is ≥ `LIST_LIMIT`, it returns the error `truncated: the list filled --limit 100`; this test runs before any filtering. Each row must have `Number.isInteger(number) && number > 0`, a string `title`, and a non-empty string `url`. If a row has a `state`, lowercase it once and drop rows whose state is not `open`. Sort the rest by number. Return the records as `{number, title, url}` only.
  - `check` flow, in this order:
    1. Parse the args. A parse error exits 2.
    2. If `--records-json` was given, read the file with `deps.readFile(resolveAgainst(deps.cwd(), p))`, then go to the routing below without any gh call. A read error exits 3.
    3. Otherwise, if `deps.ghAvailable(...)` is false, exit 3 with the stderr hint `gh not found — fetch over MCP and pass --records-json (_shared/release-block.md)`.
    4. Resolve the repo as `accept-park.js`'s `resolveRepoSpec` does. A refusal or an unresolvable repo exits 2 and prints the gate's refusal text verbatim. With `--repo`, call `deps.pinGhHost`.
    5. Pass the slug from `repoSlug(spec)` as `--repo`, and run the gh call from Global Constraints with `{cwd: deps.cwd(), env: deps.env, stderr: deps.stderr, homeDir: deps.homeDir}`. A throw exits 3.
  - Routing: if `checkRows` returns an error, exit 3 with stderr `release-block.js: state unreadable — {error}`. If there are no records, print `{"blocked":false,"records":[]}` and exit 0. Otherwise, print `{"blocked":true,"records":[…]}` and exit 1. Each output is one `JSON.stringify` line.
  - `realDeps.gh` copies `accept-park.js`'s `realDeps.gh`. The one difference is the `stdio`: use `['pipe','pipe','pipe']` and forward `input`, as `pr-checklist.js` does for its stdin body, for Task 2. Keep `timeout: GH_TIMEOUT_MS`, `maxBuffer: LARGE_MAX_BUFFER_BYTES` and `windowsHide: true` in the same literal. Use no `fs.existsSync`; read the file and catch the error.
  - The file's last statement is `if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);`.

- [ ] **Step 4: Register the CLI on the host seam.** Add `'release-block.js'` to `PIN_WIRED` and to `ORIGIN_GATED` in `tests/gh-host-seam-conformance.test.js`. Append the `CLI_TABLE` row named in Files to `tests/helpers/gh-host-seam.js`.

- [ ] **Step 5: Run the tests and confirm they pass**
Run: `node tools/run-tests.js tests/release-block-cli.test.js tests/gh-host-seam-conformance.test.js tests/gh-host-seam-behavior-origin-gate.test.js tests/gh-host-seam-behavior.test.js tests/bin-lib/exit-code-conformance.test.js tests/bin-lib/cli-entry-conformance.test.js tests/windows-hide-spawn-conformance.test.js tests/path-guard-conformance.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 6: Discrimination and real-input probe.**
  - Revert each `checkRows` guard in turn: the limit check, the `url` check, the state filter, and the integer check. Each revert must turn its named test red. Restore the code after each one.
  - Then run, from the worktree: `node plugin/bin/release-block.js check; echo "exit=$?"`. Expected: `{"blocked":false,"records":[]}` and `exit=0`, because no `release-block` label exists in this repo yet. Quote the raw output in the task report.

- [ ] **Step 7: Commit**
  ```bash
  git -C "<worktree>" add -- plugin/bin/release-block.js tests/release-block-cli.test.js tests/gh-host-seam-conformance.test.js tests/helpers/gh-host-seam.js
  git -C "<worktree>" commit -m "Add release-block.js check — open release-block records, fail-closed exit 3 (#5882)" -m "Claude-Session: https://claude.ai/code/session_01X7gPF9abdcTSk7paDhuBhW"
  ```

### Task 2: `release-block.js stamp` and the `release-block` label

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/release-block.js`
- Modify: `tests/release-block-cli.test.js`
- Modify: `plugin/bin/lib/issues/record-vocabulary.js` (add `RELEASE_BLOCK: 'release-block'` to `LABELS`; the CLI imports its label name from `LABELS` through `plugin/bin/lib/issues/record.js`)
- Modify: `plugin/skills/_shared/label-bootstrap.md` (append the Global Constraints triple to the Canonical `LABELS_JSON` fence, and raise **current value** from `10` to `11`)
- Modify: `plugin/skills/_shared/work-record.md` (add a Label taxonomy row after `Container (1)`: `| Release gate (1) | \`release-block\` | \`B4006E\` | Presence-only: releases stop while any open record carries it (\`_shared/release-block.md\`). Set by \`bin/release-block.js stamp\` or a human; cleared by closing the record or removing the label |`)

**Interfaces:**
- Consumes: Task 1's `run`, `realDeps`, `EXIT`, and repo resolution.
- Produces:
  - `LABEL = Object.freeze({ name: LABELS.RELEASE_BLOCK, description: '<the Global Constraints description>', color: 'B4006E' })`
  - `FINDING_RE = /^[^\r\n]*\S at (?:general|[^\s:][^\s]*:\d+)$/`
  - `stampCommentBody(finding: string) -> string`
- The exact comment body is fixed copy, and Task 3's contract restates it verbatim:
  ```text
  **Release block:** {finding}

  Releases stop while this record is open and carries the `release-block` label. To clear the block, close this record or remove the label.
  ```
  `stampCommentBody(f)` returns that text with `{finding}` replaced by `f` and one trailing `\n`.

- [ ] **Step 1: Write the failing tests** (append to `tests/release-block-cli.test.js`). The fake gh scripts `issue view` (default `{"number":7,"state":"OPEN","labels":[{"name":"ready"}],"url":"https://github.com/acme/widgets/issues/7"}`), `label list`, `label create`, `issue edit` and `issue comment`, and records each call's `input`. `F = 'security at plugin/skills/_shared/skill-load-gate.md:8'`.
  - `AC5.1: stamping an unlabelled record adds the label, then posts one comment naming the finding`.
    - Run `stamp --record 7 --finding F`. The call order is `issue view`, `label list`, `label create`, `issue edit`, `issue comment`.
    - The `issue edit` args are `['issue','edit','7','--repo','acme/widgets','--add-label','release-block']`.
    - The `issue comment` args are `['issue','comment','7','--repo','acme/widgets','--body-file','-']`, and its input is `=== stampCommentBody(F)`.
    - The exit code is 0, and stdout is `{"record":7,"outcome":"stamped"}\n`.
  - `stamp: the issue view argv`. The args are `['issue','view','7','--repo','acme/widgets','--json','number,state,labels,url']`.
  - `stamp: label bootstrap when missing — exact-name match over a fuzzy search`. `label list` returns `fix-on-worktree-release-install-commands\nfix-on-worktree-design-release-skill\n`, the probed fuzzy answer. Then `label create` is called once with `['label','create','release-block','--repo','acme/widgets','--color','B4006E','--description', LABEL.description]`. Control: when `label list` returns `release-block\n`, no `label create` call is made.
  - `stamp: a label create that loses a race proceeds; one that fails outright is a write failure`.
    - If create throws and the re-list shows `release-block`, the stamp proceeds to edit and comment, and exits 0.
    - If create throws and the re-list does not show it, the exit is 3, with no `issue edit` and no `issue comment` call.
  - `stamp: label before comment — a failed comment leaves the label`. `issue comment` throws. The exit is 3. The `issue edit --add-label` call came first. No call carries `--remove-label`. Stderr matches `/label stays/`.
  - `stamp: a failed label edit posts no comment`. `issue edit` throws. The exit is 3, and no `issue comment` call is made.
  - `stamp: re-stamping an already-labelled record is a no-op`. `issue view` returns labels `[{"name":"release-block"}]`, as label objects. The exit is 0, and stdout is `{"record":7,"outcome":"already-stamped"}\n`. The only gh call is `issue view`, and `invalidateSnapshot` is never called.
  - `stamp: no such record -> exit 2`. `issue view` throws with stderr `GraphQL: Could not resolve to an issue or pull request with the number of 999999. (repository.issue)`. The exit is 2.
  - `stamp: a PR number -> exit 2, nothing labelled` (Review Focus 1). `issue view` returns `url: 'https://github.com/acme/widgets/pull/7'`. The exit is 2, and the view is the only call.
  - `stamp: an unreadable view -> exit 3`. A network throw exits 3. A view answer of `not json` also exits 3.
  - `stamp: a closed record is stamped, with a stderr note that it never blocks`. The view returns `state:'CLOSED'`. The exit is 0, and stderr matches `/closed record never blocks/`.
  - `stamp: the label write invalidates the session record snapshot once`. With `env.CLAUDE_CODE_SESSION_ID = 's1'`, `invalidateSnapshot` is called with `['s1']` exactly once, after `issue edit`.
  - `stamp usage -> exit 2, zero gh calls`. Cases: no `--record`; `--record 0`; `--record abc`; `--record 7x`; a trailing `--record` with no value; no `--finding`; `--finding 'no location'`; `--finding 'security at a.js:8\nmore'`; `stamp --records-json r.json`. Two findings are accepted: `--finding 'security at general'` and `F`.
  - `stamp: gh absent -> exit 3` (the MCP path is prose), with zero gh calls.
  - `label twin: LABEL equals the canonical LABELS_JSON row and LABELS.RELEASE_BLOCK`. Parse the `## Canonical LABELS_JSON` fence of `plugin/skills/_shared/label-bootstrap.md` with the regex `tests/bin-lib/issues/labels.test.js` uses. The `release-block` row must deep-equal `[LABEL.name, LABEL.description, LABEL.color]`. `ensureLabelPayload(...row)` must not throw. `LABELS.RELEASE_BLOCK === 'release-block'`. The `current value` must be `>= 11`.

- [ ] **Step 2: Run the tests and confirm they fail**
Run: `node tools/run-tests.js tests/release-block-cli.test.js`
Expected: FAIL. The new stamp tests fail with exit 2 (`unknown verb: stamp`); the Task 1 tests still pass.

- [ ] **Step 3: Implement `stamp`**
  - Validate in this order, and exit 2 on any failure:
    1. `--record` must match `/^[1-9]\d*$/`.
    2. `--finding` must match `FINDING_RE`.
    3. No other flag may appear, except `--repo`.
  - gh absent → exit 3. Resolve the repo as Task 1 does.
  - Run `issue view`:
    - A throw whose `err.stderr || err.message` matches `/Could not resolve to an issue or pull request/` → exit 2, with stderr `no such record #N`.
    - Any other throw, or a parse failure → exit 3.
    - A `url` containing `/pull/` → exit 2, with stderr `#N is a pull request, not a record`.
  - Reduce the labels with `normalizeLabelNames` (from `plugin/bin/lib/issues/record-vocabulary.js`). If they include `release-block`: stdout `{"record":N,"outcome":"already-stamped"}`, exit 0.
  - Bootstrap the label: split the `label list … -q '.[].name'` output into lines and match the name exactly. When it is absent, create the label with `ensureLabelPayload(LABEL.name, LABEL.description, LABEL.color)`. On a create throw, re-list once; if the name is still absent, exit 3.
  - Run `issue edit --add-label`. A throw exits 3. After it succeeds, call `deps.invalidateSnapshot(deps.env.CLAUDE_CODE_SESSION_ID)`.
  - Run `issue comment … --body-file -` with `input: stampCommentBody(finding)`. A throw exits 3, with stderr `release-block.js: label added to #N but the comment failed — the label stays and the block stands; post the comment by hand`.
  - Print `{"record":N,"outcome":"stamped"}` and exit 0.
  - No record number or finding reaches gh unvalidated, and the body goes on stdin, so the argv needs no `--` separator.

- [ ] **Step 4: Add the label rows.** Edit `record-vocabulary.js`'s `LABELS`, `label-bootstrap.md`'s `LABELS_JSON` fence and `current value`, and `work-record.md`'s taxonomy row, all as named in Files.

- [ ] **Step 5: Run the tests and confirm they pass**
Run: `node tools/run-tests.js tests/release-block-cli.test.js tests/bin-lib/issues/labels.test.js tests/bin-lib/issues/record.test.js tests/work-record-needs-decision-conformance.test.js tests/bot-parked-label-conformance.test.js tests/accept-label-reader-conformance.test.js tests/plan-review-dispatch-relay-conformance.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 6: Pin the contract and prove the tests discriminate.**
  Proof(public-contract): `tests/release-block-cli.test.js` pins the contract four ways, so renumbering a code, renaming a key or reordering the writes turns these tests red:
  1. `EXIT` deep-equals `{OK:0,BLOCKED:1,USAGE:2,FAILURE:3}`.
  2. `check`'s exit-1 stdout is byte-identical to `{"blocked":true,"records":[{"number":7,"title":"Fix the widget","url":"https://github.com/acme/widgets/issues/7"}]}`, and its exit-0 stdout is `{"blocked":false,"records":[]}`.
  3. `stamp` exits 0 for both `stamped` and `already-stamped`, 2 for usage, a missing record and a PR number, and 3 for a failed label or comment write.
  4. The label-before-comment call order.

  Prove the tests discriminate by doing three reverts, one at a time:
  - Swap the edit and comment order. The ordering test must go red.
  - Remove the `/pull/` guard. The PR test must go red.
  - Replace the exact-name label match with `includes` on the raw output. The fuzzy-search test must go red.

  Restore the code after each revert.

- [ ] **Step 7: Commit**
  ```bash
  git -C "<worktree>" add -- plugin/bin/release-block.js tests/release-block-cli.test.js plugin/bin/lib/issues/record-vocabulary.js plugin/skills/_shared/label-bootstrap.md plugin/skills/_shared/work-record.md
  git -C "<worktree>" commit -m "Add release-block.js stamp and the release-block label — label before comment, idempotent re-stamp (#5882)" -m "Claude-Session: https://claude.ai/code/session_01X7gPF9abdcTSk7paDhuBhW"
  ```

### Task 3: The `_shared/release-block.md` contract and its doc rows

**Role:** integration
**Review risk:** high

**Files:**
- Create: `plugin/skills/_shared/release-block.md`
- Create: `tests/release-block-prose-conformance.test.js`
- Modify: `docs/plugin-structure.md` (in the CLI listing, add one `node plugin/bin/release-block.js …   # …` line directly above `node plugin/bin/release-bootstrap.js`, in the same one-line format as its neighbours)
- Modify: `docs/skill-graph.md` (add two rows to the `## release` table: `| \`bin/release-block.js\` | Step 1.5's check and Step 4's re-read; Step 8's disposition stamps each critical/high finding it files, and the covering record of one it declines as covered (#5882). Its exit codes are the gate's verdict, never its prose. |` and `| \`_shared/release-block.md\` | The release-block contract: what sets and clears a block, what Step 1.5 and Step 4 do while one is open, and the gh-absent (MCP) equivalents of \`check\` and \`stamp\`. |`)

**Interfaces:**
- Consumes: Task 2's `stampCommentBody`, `LABEL` and `EXIT`.
- Produces: the section headings that Tasks 4 and 5 cite, verbatim:
  - `## What sets a block`
  - `## How a block clears`
  - `## The CLI`
  - `### Stamp comment`
  - `## What a release does while a block is open`
  - `## gh-absent (MCP) path`
  - `## What this does not stop`

- [ ] **Step 1: Write the failing prose tests** in `tests/release-block-prose-conformance.test.js`. Read the live file through `tests/helpers/read-skill`'s `readText`, and apply the go-red pattern quoted in Global Constraints.
  - `contract: every section heading is present, in order`. Factor this into `assertContractSections(text)`. Go-red: run the same function on a copy with `## How a block clears` deleted, and expect it to throw.
  - `contract: sets and clears`.
    - The text names three setters: a critical or high finding that the rolling review or a release's delta review files as a record, Step 8's disposition, and a human.
    - It says Step 8 also stamps the covering record of a critical or high finding declined as `declined (covered by #{n})`.
    - It names the clearing acts, `close the record` and `remove the label`, and says no reason is required.
  - `contract: forge-keyed skip` (Review Focus 2). The release section's `SKIP` log line contains `condition: no GitHub origin (_shared/forge-detection.md check 1)`, and the whole file contains no `condition: work-backend`. Go-red: the same helper must reject a frozen copy of the superseded line, `SKIP … — Step 1.5 release-block check (skipped): condition: work-backend local-files → fallback: no forge label to read; release proceeds. Reversibility: n/a.`
  - `contract: gh detected before the bash check`. The release section names `command -v gh` before `release-block.js" check`, and states the gh-absent branch goes to `## gh-absent (MCP) path` with no new exit code (an unavailable transport is exit 3).
  - `contract: exit codes`. The `## The CLI` section states `check` 0/1/2/3 and `stamp` 0/2/3 as table rows, and quotes the exit-1 JSON shape verbatim.
  - `contract: stamp comment twin`.
    - Take the fenced `text` block under `### Stamp comment` and replace `{finding}` with `X at general`. The result must equal `stampCommentBody('X at general')` with its trailing newline trimmed.
    - Go-red: append a word to the fence copy and assert inequality through the same comparison helper.
  - `AC2.1: a held release names each blocking record in release-held.md`. The release section says that `release-held.md` names the gate `release-block`, each record as `#N {title} {url}`, the effective version and its base, and the clearing act. It also says that no autonomy ceiling lifts the block and that the next firing re-runs `check`.
  - `contract: MCP path`.
    - It names `list_issues` with labels `release-block`, state open and `perPage: 100`, and reshapes each row to `{number, title, url, state}`.
    - It runs `release-block.js" check --records-json`, and treats an unavailable or erroring MCP tool as exit 3.
    - For stamp it names `issue_read`, `issue_write` with the full merged label array (citing `_shared/github-write-transport.md`'s Full-replace hazard and `mergeLabelNames`), and `add_issue_comment`.
    - It says `label create` has no MCP row.

- [ ] **Step 2: Run the tests and confirm they fail**
Run: `node tools/run-tests.js tests/release-block-prose-conformance.test.js`
Expected: FAIL with `ENOENT … release-block.md`.

- [ ] **Step 3: Write `plugin/skills/_shared/release-block.md`** (at most 10,000 B), with the headings above in that order.
  - **Opening paragraph:** what the signal is, and that it is keyed on the forge, never on `work-backend`: it applies whenever the repository has a GitHub origin (`_shared/forge-detection.md` check 1, `git -C "$RUN_ROOT" remote get-url origin` exits 0), including a GitHub-hosted project with no `## Work records` flag.
    - With no GitHub origin there is no forge label to read, and the release logs a skip.
  - **What sets a block:** the three setters from the Step 1 test, plus Step 8's stamp on the covering record of a critical/high `declined (covered by #{n})` row.
    - #5885 (the rolling review) and #5887 (the promotion gate) will call `stamp` and `check`.
  - **How a block clears:** close the record or remove the label.
    - This is the durable form of the old interactive "Proceed".
    - A clearing comment is recommended, not required.
  - **The CLI:**
    - Both usage lines.
    - An exit-code table for each verb.
    - The exit-1 JSON shape.
    - The truncation rule: a list that fills `--limit 100` is exit 3.
    - The fact that a missing label reads as none.
    - Under `### Stamp comment`, the fixed body from Task 2 in a ```` ```text ```` fence.
  - **What a release does while a block is open:** this section is the full Step 1.5 procedure that SKILL.md points to. It holds the routing paragraph moved out of SKILL.md under Global Constraints' remedy, so SKILL.md keeps only the order, the command and a compact exit map.
    - Order, for Step 1.5 and Step 4's re-read alike: (1) the forge check — no GitHub origin → the `SKIP` line below, release proceeds; (2) detect `gh` with `command -v gh` per `_shared/github-write-transport.md`'s Detection; (3) gh present → the bash `release-block.js" check` fence; gh absent → `## gh-absent (MCP) path`'s `check`, never the fence. No new exit code: an unavailable MCP transport is exit 3.
    - Exit 0 → continue.
    - Exit 1 → stop before any review or suite work and print this line:
      `release: blocked — {n} open release-block record(s): #{N} {title}[; #{M} {title}]. Close each record or remove its release-block label, then re-run.`
      Stage `release-held.md` through `node "${CLAUDE_PLUGIN_ROOT}/bin/stage-item.js" --run "{run-dir}" --id release-held --file {composed .md file}`. Use the existing schema: the gate (`release-block`), the effective version and its base (`n/a — {proposedVersion error}` when the pack has none), the blocking records, and the clearing act. The outcome is `HELD` in every mode, with no question, and `--allow-blocking` does not lift it.
    - Exit 2 or 3 → stop and print `release: stopped — release-block state unreadable (exit {code}: {first stderr line})`. The outcome is `failed`, with reason `release-block state unreadable`.
    - The log lines, written through `log-decision.js --section "/release" --step "Step 1.5"`; the text never starts with the step name:
      `AUTO … — Step 1.5: release-block check: none open. Reversibility: n/a (read-only).`
      `STAGED … — Step 1.5: HARD-GATE release-block — {n} open record(s) {#a, #b}; release held. Stage path: staged/release-held.md. Reversibility: high.`
      `AUTO … — Step 1.5: release-block state unreadable — exit {code}: {stderr line}. Stopped before Step 2. Reversibility: n/a.`
      `SKIP … — Step 1.5 release-block check (skipped): condition: no GitHub origin (_shared/forge-detection.md check 1) → fallback: no forge label to read; release proceeds. Reversibility: n/a.`
    - The same routing applies to Step 4's re-read (`release/console.md`), whose log lines say `Step 4`.
    - No autonomy ceiling clears a block, and each firing re-runs `check`.
  - **gh-absent (MCP) path:**
    - Detection is per `_shared/github-write-transport.md`.
    - `check`:
      1. Run `list_issues` with labels `["release-block"]`, state open and `perPage: 100`.
      2. Reshape each row to `{number, title, url, state}`.
      3. Get the session-scoped path from `node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" --value release-block-records.json`, and write the array there with the Write tool.
      4. Run `node "${CLAUDE_PLUGIN_ROOT}/bin/release-block.js" check --records-json {path}`. Its exit codes are the gh path's.
      5. An unavailable or erroring `list_issues` is exit 3 without calling the CLI.
    - `stamp`:
      1. Run `issue_read` in get mode. A missing issue or a PR is the exit-2 equivalent, and an issue already carrying the label is a no-op.
      2. Run `issue_write` in update mode with the full array from `mergeLabelNames` (Full-replace hazard), then read the labels back.
      3. If the label is absent, retry once. If it is still absent, that is the exit-3 equivalent. `label create` has no row in `github-write-transport.md`, so the label must already exist; create it with `gh` or the GitHub UI.
      4. Run `add_issue_comment` with the fixed body, composed from this file's literal.
      5. A comment failure after the label landed leaves the label in place.
      6. Invalidate the snapshot per that file's Snapshot invalidation.
  - **What this does not stop:** a manual tag, or merging release-please's PR by hand. This is accepted, per the design.

- [ ] **Step 4: Add the doc rows** to `docs/plugin-structure.md` and `docs/skill-graph.md`, as named in Files.

- [ ] **Step 5: Run the tests and confirm they pass**
Run: `node tools/run-tests.js tests/release-block-prose-conformance.test.js tests/release-block-cli.test.js tests/skill-fence-guard-shapes.test.js tests/release-skill-reference-form.test.js`
Expected: PASS, 0 failures, and `wc -c plugin/skills/_shared/release-block.md` ≤ 10000.

- [ ] **Step 6: Commit**
  ```bash
  git -C "<worktree>" add -- plugin/skills/_shared/release-block.md tests/release-block-prose-conformance.test.js docs/plugin-structure.md docs/skill-graph.md
  git -C "<worktree>" commit -m "Add the release-block contract — sets, clears, release gate, MCP equivalents (#5882)" -m "Claude-Session: https://claude.ai/code/session_01X7gPF9abdcTSk7paDhuBhW"
  ```

### Task 4: Release Step 1.5 gate, the HARD-GATE registration, and the `HELD` prose sweep

**Role:** judgment
**Review risk:** high

**Files:**
- Modify: `plugin/skills/release/SKILL.md`
  - Insert a new `## Step 1.5: Release-block check` between `## Step 1: Preflight fact pack` and `## Step 2: Nothing to release`.
  - In the `--train` row of the `## Input` table, add Step 1.5's stop to the HELD stops.
  - In `## Step 8`, add it to the `HELD` outcome bullet and to the **Every exit runs the close-out** list.
  - In `## --train semantics`, add one sentence after **Two HARD-GATEs stop it before Step 5…**.
- Modify: `plugin/skills/_shared/auto-mode-contract.md` (the `HARD-GATE / BLOCKED / STOP conditions` row: right after `` `/release` Step 4's two gates (review: blocking, a major bump — release/console.md); ``, insert `` `/release` Step 1.5's release-block stop (an open record carrying the `release-block` label, or that state unreadable — `_shared/release-block.md`; re-read at Step 4, and no autonomy ceiling lifts it); ``)
- Modify: `tests/control-mode-hard-gates-conformance.test.js` (append `['release-block stop', "`/release` Step 1.5's release-block stop"]` to `GATES`)
- Modify: `plugin/skills/_shared/autonomy-ceiling.md`
  - In the `train` row, change "never does three things" to "four things". The release block is evaluated before anything merges (Step 1.5), and it is `HELD` with `release-held.md`. Re-count the row's "The two that…", "Both are evaluated…" and "The third…" so that each count and ordinal stays true.
  - In the `train (Routine firing)` row, add the release block to its `HELD` list.
- Modify: `plugin/skills/release/routine-template.yml` (`notes`: one sentence saying that an open `release-block` record holds a firing `HELD` before any review, until a human closes the record or removes the label, nothing-to-release firings included)
- Modify: `plugin/skills/release/bookkeeping.md` (line 15's **Never reached under `HELD`** list gains Step 1.5's release-block stop)
- Modify: `plugin/skills/release/execute.md` (the closing paragraph `` `HELD` is only ever a **pre-merge** word here `` changes "alongside the Step 4 HARD-GATEs that fire before this file runs at all" to "alongside Step 1.5's release-block stop and the Step 4 HARD-GATEs, which fire before this file runs at all")
- Modify: `docs/journeys/release-a-version.md` (the **Should understand** `HELD` gloss gains "at Step 1.5's release-block check")
- Modify: `plugin/bin/lib/console/resolve.js` (line 150's `STAGING_EXEMPTIONS` reason changes "surfaced by release's own Step 4 console (release/console.md)" to "surfaced by release's own Step 8 summary (release/SKILL.md; a Step 1.5 hold never renders the Step 4 console)", so the full string reads `"/claude-tweaks:release's standalone run dir; surfaced by release's own Step 8 summary (release/SKILL.md; a Step 1.5 hold never renders the Step 4 console), never by wrap-up's console-resolve.js"`. No test pins the old text (`git grep` finds it only in `resolve.js`).)
- Modify: `tests/release-block-prose-conformance.test.js`

**Interfaces:**
- Consumes: Task 3's `## What a release does while a block is open` heading, and Task 1's exit codes.

- [ ] **Step 1: Write the failing prose tests** (append them). Each claim is asserted twice: once against the live text, and once against a frozen excerpt of the pre-change text, through the same helper.
  - `AC1.1/AC1.2: Step 1.5 sits after Step 1 and before Steps 2 and 3, so no review or suite work precedes it`.
    - Factor this into `assertStepOrder(text)`. It asserts that the indexes of `## Step 1: Preflight fact pack`, `## Step 1.5: Release-block check`, `## Step 2: Nothing to release` and `## Step 3: Whole-branch review` strictly increase.
    - Go-red: run the same function on a copy where the Step 1.5 section is moved after `## Step 3:`.
  - `AC1.1: Step 1.5 runs check and routes on the exit code only`. The section body contains:
    - `` node "${CLAUDE_PLUGIN_ROOT}/bin/release-block.js" check ``
    - the routing for `0`, `1`, `2` and `3`
    - `HELD`
    - `never on the prose`
    - `_shared/release-block.md`
  - `AC4.2: an unreadable state stops the release and never proceeds`. The Step 1.5 body contains `release-block state unreadable` and `failed`.
  - `AC3.1: no GitHub origin skips with a logged reason, keyed on the forge` (Review Focus 2). The Step 1.5 body contains `remote get-url origin`, `_shared/forge-detection.md` check 1, `no GitHub origin` and `SKIP`, and contains neither `local-files` nor `` Read `work-backend` ``. Go-red: the same helper rejects a frozen excerpt reading ``Read `work-backend` as `console.md`'s Inputs does. `local-files` → log the `SKIP` line``.
  - `Step 1.5 detects gh before the bash check` (no new exit code). Factor `assertGhFirst(body)`: the indexes of `remote get-url origin`, `command -v gh`, and the fence line `` node "${CLAUDE_PLUGIN_ROOT}/bin/release-block.js" check `` strictly increase, and the text after the fence names `gh-absent (MCP)` and `never the fence`. Go-red: the same function throws on a copy where the `command -v gh` sentence is moved after the fence.
  - `AC2.1: --train holds on a block with release-held.md`.
    - The `## --train semantics` section and the `--train` Input row each name `release-block`.
    - The `HELD` outcome bullet in Step 8 names `Step 1.5`.
    - The **Every exit runs the close-out** paragraph names `Step 1.5`.
  - `HARD-GATE registry`. `auto-mode-contract.md`'s HARD-GATE row contains `` `/release` Step 1.5's release-block stop ``. The new `GATES` entry in `tests/control-mode-hard-gates-conformance.test.js` covers the control-mode half.
  - `autonomy ceiling never lifts the block`.
    - `autonomy-ceiling.md`'s `train` row and its `train (Routine firing)` row each contain `release-block`.
    - The `train` row contains `four things` and not `three things`.
  - `routine notes name the release block`. `routine-template.yml`'s `notes` contains `release-block`.
  - `HELD lists elsewhere name Step 1.5`. These four each contain `Step 1.5`:
    - `bookkeeping.md`'s **Never reached under `HELD`** paragraph
    - the closing `HELD` paragraph of `execute.md`
    - `docs/journeys/release-a-version.md`'s `HELD` gloss
    - the `release-held` reason in `plugin/bin/lib/console/resolve.js`

- [ ] **Step 2: Run the tests and confirm they fail**
Run: `node tools/run-tests.js tests/release-block-prose-conformance.test.js tests/control-mode-hard-gates-conformance.test.js`
Expected: FAIL. The Task 4 tests and the new `GATES` entry fail; the Task 3 tests still pass.

- [ ] **Step 3: Write `## Step 1.5: Release-block check`** in `plugin/skills/release/SKILL.md`. The forge check and gh detection add ~250 B, so Global Constraints' remedy is applied up front: the full routing paragraph (record naming, no question, `--allow-blocking`, log lines, `release-held.md`) lives in `_shared/release-block.md` (Task 3), and SKILL.md keeps the order, the command and a compact exit map. A draft of this shape measured 1,098 B. The section contains, in this order:
  1. One sentence saying the check runs before any review or suite work, on every path: interactive, `auto`, headless, `--train` and `--dry-run`. It runs directly after the read-only fact pack, so it precedes Step 3's tree check, `/claude-tweaks:test full` and `/claude-tweaks:review`. It also precedes any early-verify step a later change inserts after Step 1.
  2. The forge rule, never `work-backend`: when `git -C "$RUN_ROOT" remote get-url origin` fails (`_shared/forge-detection.md` check 1: no GitHub origin), log the `SKIP` line and go on to Step 2. This stays prose, not a fence, as in `release/execute.md`'s local-merge Tag bullet, so `tests/skill-fence-guard-shapes.test.js` needs no new ratchet.
  3. Detect `gh` first: `command -v gh` per `_shared/github-write-transport.md`'s Detection. Present → a bash fence holding exactly `node "${CLAUDE_PLUGIN_ROOT}/bin/release-block.js" check`. Absent → `_shared/release-block.md`'s gh-absent (MCP) `check`, never the fence. No new exit code: an unavailable transport is exit 3.
  4. A compact exit map: route on the exit code, never on the prose. **0** → Step 2, unchanged; **1** → stop `HELD`; **2** or **3** → stop `failed`, `release-block state unreadable`. On any exit but 0, read `_shared/release-block.md`'s "What a release does while a block is open" section now.

  Then make the four small SKILL.md edits named in Files. Keep the whole SKILL.md growth to +1,700 B or less, and measure it with `wc -c plugin/skills/release/SKILL.md`, which must be ≤ 51925. Over that, shorten Step 1.5's sentence 1 (never another step's content).

- [ ] **Step 4: Make the remaining edits** named in Files: `auto-mode-contract.md`, the `GATES` entry, `autonomy-ceiling.md`, `routine-template.yml`, `bookkeeping.md`, `execute.md`, the journey, and `resolve.js`'s reason string.

- [ ] **Step 5: Renumbering and behaviour-change sweep.** Run each of these from the worktree, and list every hit in the task report as edited or as no-change, with the reason:
  - `git grep -n -e "Step 1.5" -- plugin/skills/release`
  - `git grep -n -i -e "two HARD-GATEs" -e "two Step 4 HARD-GATEs" -e "Four Step 5 stops" -e "three things" -- plugin/skills/release plugin/skills/_shared/autonomy-ceiling.md`
  - `git grep -n -w -e "HELD" -- plugin/skills/release plugin/skills/_shared docs/journeys/release-a-version.md`

  Presence check: `git grep -n -F "Step 1.5's release-block" -- plugin/skills/_shared/auto-mode-contract.md` must match after Step 4. Run against the pre-change tree when this plan was written, it exited 1, so the check can tell the two trees apart.

- [ ] **Step 6: Run the tests and confirm they pass**
Run: `node tools/run-tests.js tests/release-block-prose-conformance.test.js tests/control-mode-hard-gates-conformance.test.js tests/release-run-dir-lifecycle-conformance.test.js tests/release-skill-reference-form.test.js tests/release-review-tree-check-conformance.test.js tests/standalone-run-dir-closeout-conformance.test.js tests/release-as-anchor-conformance.test.js tests/release-routine-template.test.js tests/pipelines-push-first-local-runs-conformance.test.js tests/skill-fence-guard-shapes.test.js tests/skill-size-single-source.test.js tests/bin-lib/console/resolve.test.js`
Expected: PASS, 0 failures, and `wc -c plugin/skills/release/SKILL.md` ≤ 51925.

- [ ] **Step 7: Commit**
  ```bash
  git -C "<worktree>" add -- plugin/skills/release/SKILL.md plugin/skills/_shared/auto-mode-contract.md tests/control-mode-hard-gates-conformance.test.js plugin/skills/_shared/autonomy-ceiling.md plugin/skills/release/routine-template.yml plugin/skills/release/bookkeeping.md plugin/skills/release/execute.md docs/journeys/release-a-version.md plugin/bin/lib/console/resolve.js tests/release-block-prose-conformance.test.js
  git -C "<worktree>" commit -m "Gate releases on release-block at Step 1.5 — HELD on a block, failed when unreadable, registered HARD-GATE (#5882)" -m "Claude-Session: https://claude.ai/code/session_01X7gPF9abdcTSk7paDhuBhW"
  ```

### Task 5: Step 4's release-block row and re-read, and Step 8's disposition stamp

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/skills/release/console.md`
  - `## Inputs` gains a bullet: re-run `release-block.js check` here, just before rendering, in Step 1.5's order (`_shared/release-block.md`): the forge check first (no GitHub origin → `n/a`), then `command -v gh`, then the bash `release-block.js" check` only with gh present, otherwise the MCP `check`. It is keyed on the forge, never on the `work-backend` bullet beside it.
  - `## The table` gains a `| Release block |` row after `| Review |`. Its value is `none`, or `blocked — #N {title}` (one line per record), or `unreadable — {first stderr line}`, or `n/a (no GitHub origin)`.
  - `## Gates` gains one paragraph after the two numbered gates, **The release block, re-read.** Exit 1 holds the release before Step 5 exactly as Step 1.5 does (`_shared/release-block.md`), with `HELD`, `release-held.md`, and no question in any mode. Exit 2 or 3 stops it `failed`, with reason `release-block state unreadable`.
  - The **`HELD` is mode-independent** paragraph's list of other `HELD` reasons gains SKILL.md Step 1.5's release-block stop.
  - The first `## Log lines` line gains `, release-block {none|n open|unreadable}`.
- Modify: `plugin/skills/release/SKILL.md` (Step 4's paragraph names the release-block row and its re-read in one clause)
- Modify: `plugin/skills/release/disposition.md`
  - In `## Routing table`, after the covering-record sentence, add a paragraph **Stamp the release block.** It is detailed in Step 3 below.
  - In `## Inventory`, the early-exit parenthetical "a Step 1 or Step 2 stop, a refused `--train`" gains "a Step 1.5 release-block stop".
- Modify: `tests/release-block-prose-conformance.test.js`

**Interfaces:**
- Consumes: the `stamp` contract from Task 2 (`--record`, `--finding "{category} at {file:line}|general"`, exits 0/2/3), and Task 3's MCP stamp procedure.

- [ ] **Step 1: Write the failing prose tests** (append them, using the same frozen pre-change pattern).
  - `AC8.1: Step 4's console renders the release-block state`.
    - `console.md`'s table has a row line starting `| Release block |`, with all four values named, the fourth being `n/a (no GitHub origin)`; the row contains no `local-files`.
    - Its index sits after `| Review |` and before `| CI on tip |`.
    - Go-red: run the same helper on a copy with the row removed, and on a frozen copy whose fourth value is `n/a (work-backend local-files)`.
  - `Step 4 re-reads the block before Step 5` (Review Focus 3).
    - `console.md`'s `## Inputs` names `` release-block.js" check ``.
    - Its `## Gates` contains `The release block, re-read`, `HELD`, `release-block state unreadable`, and `no question`.
  - `Step 4's re-read detects gh before the bash check`. In the `## Inputs` release-block bullet, the indexes of `no GitHub origin`, `command -v gh` and `` release-block.js" check `` strictly increase, and the bullet names the MCP `check` for the gh-absent case. Go-red: a copy with `command -v gh` moved last throws in the same helper.
  - `AC5.1: Step 8 stamps a filed critical or high finding`. `disposition.md` contains `` release-block.js" stamp --record ``, `critical`, `high`, `{category} at {file:line}`, and `at general`.
  - `AC5.1: Step 8 stamps the covering record of a critical or high finding declined as covered` (Plan Review Clarifications). The stamp paragraph contains `` `declined (covered by #{n})` `` and `the covering record`, and contains neither `Neither is a` nor `because nothing was filed`. Go-red: the same helper rejects the frozen superseded sentence ``Medium and low findings are never stamped. Neither is a `declined (covered by #{n})` row, because nothing was filed.``
  - `AC5.2: medium and low findings are not stamped`. The stamp paragraph contains `Medium and low findings are never stamped`, including when declined as covered.
  - `stamp failure counts as a disposition failure`. The stamp paragraph names the `FAILED` line shape `stamp failed:` and says it counts toward `{k} failed`.
  - `Inventory names the Step 1.5 early exit`. `disposition.md`'s Inventory contains `a Step 1.5 release-block stop`.

- [ ] **Step 2: Run the tests and confirm they fail**
Run: `node tools/run-tests.js tests/release-block-prose-conformance.test.js`
Expected: FAIL. The Task 5 tests fail; the earlier tests pass.

- [ ] **Step 3: Write the edits.** The `disposition.md` **Stamp the release block.** paragraph says:
  - Each row that this run *files* as a record at severity `critical` or `high` is then stamped with `node "${CLAUDE_PLUGIN_ROOT}/bin/release-block.js" stamp --record {n} --finding "{category} at {file:line}"`.
    - `{category}` and `{file:line}` come from the finding's own Step 3 Routing line (`… finding {category} at {file:line}`), or from its staged file's `Finding:` line.
    - When neither names a `file:line`, use `{category} at general`.
    - This covers a `confirmed`, `unconfirmed`, `contested` or `decisions.md`-only row at critical/high, and a `proposal` file whose own severity is critical/high.
  - A critical or high row resolved `declined (covered by #{n})` stamps the covering record: the same command with `--record {n}` (the covering record's number) and the same `--finding`, so its comment names this finding. A covering record that already carries the label is `already-stamped`, a no-op with no second comment.
  - Medium and low findings are never stamped, including when declined as covered.
  - The stamp follows Step 1.5's forge rule: with no GitHub origin (`_shared/forge-detection.md` check 1) nothing is stamped, never keyed on `work-backend`.
  - Exit 0 → append ` (release-block stamped)` to that row's `filed #{n}` or `declined (covered by #{n})` log line.
  - Exit 2 or 3 → write the hand-composed line `FAILED {HH:MM:SS} — Step 8 disposition: {staged path} — stamp failed: exit {code}: {stderr line}. Reversibility: n/a (write did not land).`
    - It counts toward `{k} failed`, so the summary names it and archival is skipped.
    - The filed record stays filed; a covered row stays declined.
  - The gh-absent path is `_shared/release-block.md`'s MCP stamp.
  - It runs in the same approval case that filed the row, so an `unattended` run stamps with zero clicks. A headless run below `unattended` files nothing and therefore stamps nothing.

  Make the `console.md` and SKILL.md Step 4 edits named in Files. SKILL.md stays ≤ 51,925 B in total; re-measure it.

- [ ] **Step 4: Run the tests and confirm they pass**
Run: `node tools/run-tests.js tests/release-block-prose-conformance.test.js tests/release-run-dir-lifecycle-conformance.test.js tests/release-skill-reference-form.test.js tests/skill-fence-guard-shapes.test.js tests/control-mode-hard-gates-conformance.test.js`
Expected: PASS, 0 failures, and `wc -c plugin/skills/release/SKILL.md` ≤ 51925.

- [ ] **Step 5: Whole-branch verification.**
Run: `npm test` (impact-selected locally), with the output redirected to a scratch `.txt` file outside the repository. Then read that file.
Expected: 0 failing files. A file whose failure count varies run to run is re-run in isolation with `node tools/run-tests.js <file>` before anything is concluded.

- [ ] **Step 6: Commit**
  ```bash
  git -C "<worktree>" add -- plugin/skills/release/console.md plugin/skills/release/SKILL.md plugin/skills/release/disposition.md tests/release-block-prose-conformance.test.js
  git -C "<worktree>" commit -m "Show the release block on the Step 4 console and stamp critical/high filings at Step 8 (#5882)" -m "Claude-Session: https://claude.ai/code/session_01X7gPF9abdcTSk7paDhuBhW"
  ```

## Spec coverage map

| Spec item | Task |
|---|---|
| Deliverable 1, the label in `label-bootstrap.md` | Task 2 |
| Deliverable 2, `check`: exits, origin plus `--repo`, `--limit`, missing label, auth/network failures | Task 1 |
| Deliverable 2, `stamp`: bootstrap, label before comment, idempotent, `at general` | Task 2 |
| Deliverable 3, `_shared/release-block.md` | Task 3 |
| Deliverable 4: Step 1.5 before Step 3 on every path, `--train` HELD with `release-held.md`, the HARD-GATE, Step 4 shows the state, the MCP path's exit 3 | Tasks 4, 5 (the MCP prose in Task 3, and the `--records-json` code in Task 1) |
| Deliverable 5, the disposition stamp | Task 5 |
| AC1.1, AC1.2 | Task 1 (exit 1 JSON), Task 4 (order and stop) |
| AC2.1 | Task 3 (the `release-held.md` content), Task 4 (`--train`) |
| AC3.1 | Task 1 (exit 0), Task 3 (forge-keyed `SKIP` line), Task 4 (Step 2 unchanged; no-GitHub-origin skip) |
| AC4.1, AC4.2, AC4.3, AC4.4 | Task 1 (exit 3 cases), Task 4 (the release stops) |
| AC5.1, AC5.2 | Task 2 (stamp effect), Task 5 (disposition) |
| AC6.1 | Task 1 |
| AC7.1 | Task 1 |
| AC8.1 | Task 5 |
| Key File `plugin/skills/release/SKILL.md` (run `check` before Step 3) | Task 4 |
| Plan Review Clarification 1: `check`, the Step 4 re-read and the Step 8 stamp keyed on the forge (a GitHub origin), never on `work-backend` | Task 3 (contract opening, order, `SKIP` line), Task 4 (Step 1.5), Task 5 (console Inputs and row, stamp rule) |
| Plan Review Clarification 2: a critical/high `declined (covered by #{n})` row stamps the covering record; medium/low never | Task 3 (setters), Task 5 (stamp paragraph and tests) |
| Gotchas: a stable exit contract, exit 3 kept distinct from 0, the label removal clearing a block, a manual tag not stopped, no reason needed to clear | Tasks 1–3 |
