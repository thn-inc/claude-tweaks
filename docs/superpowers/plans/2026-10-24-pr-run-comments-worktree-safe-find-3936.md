# Worktree-safe PR run-comment Find step (#3936) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `_shared/pr-run-comments.md`'s Post-or-update Find step a worktree-safe form, which is a plain `gh pr view … --json comments` fetch to a file filtered by a checked-in CLI that reuses `bin/lib/issues/comment-trust.js`. Record the real refused shell shape in `_shared/scratch-worktree.md` §7.

**Architecture:** A new single-file CLI `plugin/bin/find-run-comment.js` (`run(argv, deps)` seam, pure `findRunComments` export) reads a comments JSON file and prints one JSON line `{kind, id, ids, skipped}`, using the same marker `startsWith` test and the same `isTrustedComment`/`untrustedSkipNote` rule the jq filters encode. The skill prose names it as the Find step's primary form and keeps the existing `--jq` commands as the non-isolated shortcut.

**Tech Stack:** Node 18+ (no deps), `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-10-24T063852-record-3936/work/3936-spec.md`

Scope keywords: run-comment: {kind}, find-run-comment

Premise-refs: plugin/bin/lib/issues/comment-trust.js
Premise-refs: plugin/skills/_shared/pr-run-comments.md
Premise-refs: plugin/skills/_shared/scratch-worktree.md

## Corrected premise (live probes, 2026-10-24, this worktree-isolated session, PR #4007)

The record's Current State says the Find step's `gh --jq` command and the host-qualified `--repo github.com/…` form are refused. Live probes show both **pass when run alone**, with or without the `\` line continuation. The guard refuses only when such a `gh` call is chained by `;` or `&&` onto a command with an **unquoted** `$?`. Run 3845's two refusals (transcript `6449b2f5…/subagents/agent-ad9ce5233e10e336b.jsonl`) both appended `; echo exit=$?`. Probe results:

| Command | Verdict |
|---|---|
| `gh pr view 4007 --repo github.com/thn-inc/claude-tweaks --json comments --jq '<Find jq>'` | passes |
| `gh pr view 4007 --repo thn-inc/claude-tweaks --json comments --jq '<Find jq>'; echo exit=$?` | refused: "runs gh with the text .comments[] \| select(.body \|… inside a construct too complex to verify" |
| `gh pr view 4007 --repo thn-inc/claude-tweaks --json comments --jq '<Find jq>' && echo ok` | passes |
| `gh pr view 4007 --repo thn-inc/claude-tweaks --json comments --jq '.comments \| length' && echo exit=$?` | refused |
| `gh pr view 4007 --repo thn-inc/claude-tweaks --json comments --jq '.comments[] \| .id'; echo "exit=$?"` (quoted) | passes |
| `gh pr view 4007 --repo thn-inc/claude-tweaks --json comments --jq '.comments'; echo exit=$?` (no `\|`) | passes |
| `gh pr view 4007 --repo github.com/thn-inc/claude-tweaks --json comments; echo exit=$?` | refused: "names git in a form too complex to verify" |
| `gh pr view 4007 --repo thn-inc/claude-tweaks --json comments > {scratch}/pr-comments.json; echo exit=$?` | passes |

Logged as a `premise reversed:` line in the run's `decisions.md`. The build still delivers the fetch-to-file plus CLI form, because that form survives the habit of appending an unquoted `$?` echo and the jq form does not.

**Verbatim-command run-once (plan-authoring check):** the fetch `gh pr view 3929 --repo thn-inc/claude-tweaks --json comments > {scratch}/pr-3929-comments.json` ran (exit 0). `{owner}/{repo}` is `gh repo view --json nameWithOwner`'s value, `thn-inc/claude-tweaks`.

**Real-input probe + independent count:** the documented Find jq over that real file (`jq -r '.comments[] | select(.body | startswith("<!-- run-comment: verdict -->")) | <trustedJqSelect()> | .id'`) prints exactly `IC_kwDORUwzVM8AAAABeYt58A`. The file holds two comments, both `MEMBER`: `verdict` (`IC_kwDORUwzVM8AAAABeYt58A`) and `try-it` (`IC_kwDORUwzVM8AAAABeZAdxw`). Task 1 Step 6 runs the finished CLI on this same file and must print those ids.

**Reader inventory (Reader-inventory derivation check):** these readers sit on `--json comments` call sites with a run-comment marker plus a trusted select:
- `_shared/pr-run-comments.md` Find step: in scope (Task 2).
- `tidy/scan-procedures.md` failure-tombstone row, the same `startswith(...) | select(trusted)` shape: in scope (Task 2, one parenthetical).
- `demo/entry-paths.md` PR run-comment lookup: selects bodies, not ids, and is human-present. Out of scope; it cites the Find step, so it inherits the prose.
- The `needs-decision` readers (`backlog/grant-lane-decision.md`, `specify/shaping-mode-stamping.md`, `tidy/digest-sweep.md`) use a `contains()` shape on issue comments. That is not the same shape and is out of scope.

The record names `_shared/pr-checklist-refresh.md` and `wrap-up/verification-brief.md` as copies. Grep shows neither carries a `--jq` select. `verification-brief.md` (and `review/code-mode-steps.md`, `dispatch/settle-and-merge.md`, `_shared/pr-first-merge-post-merge.md`) cite "post-or-update procedure" by reference, so they inherit the new form with no edit.

## Global Constraints

- Node 18+, no external dependencies; tests use `node:test` + `node:assert`.
- CLI entry guard: `if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);`. Never `process.exit` (pinned by `tests/bin-lib/exit-code-conformance.test.js`).
- Exit vocabulary *Payload-1/Invocation-2* (`plugin/bin/wrap-up-engine.js`'s header): 0 = answered (found or not), 1 = the `--comments-file` payload is unreadable, unparseable, or not a comments list, 2 = malformed invocation.
- Trusted set and skip-note text come only from `plugin/bin/lib/issues/comment-trust.js` (`isTrustedComment`, `untrustedSkipNote`). Never retype the association list.
- Commit message style: `{Verb} {what} — {detail}`, body `refs #3936` (never `closes`/`fixes`), ending with `Claude-Session: https://claude.ai/code/session_01BJ8z7h3gxn2kEUQfAcRyU9`.
- Every existing pin stays green: `tests/comment-trust-conformance.test.js` (AC5.1 needles, the byte-identical `gh pr view {pr-number} --repo {host}/{owner}/{repo} --json comments`, the `1. **Find.**` / `2. **Found` anchors, tidy's single `run-comment: failure` line, the AC2.1 sweep counts of 6 selects / 5 notes), `tests/pr-run-comments.test.js` lines 47/58, and `tests/scratch-worktree-shell-constraint-table.test.js`.
- Byte headroom vs `RAIL_BYTES` = 52,500: `pr-run-comments.md` 18,459 B (≈ +1.6 KB → ~20 KB, ~32 KB headroom); `scratch-worktree.md` 26,089 B (+~0.9 KB); `tidy/scan-procedures.md` 42,550 B (+~0.2 KB, ~9.7 KB headroom).

## Review Focus

1. **A `gh` failure that still leaves a file** (empty file from the redirect, or a `{"message":"Not Found"}` error object) must exit 1, never report "not found". *Task 1 tests.*
2. **A comment with a null or missing `body`** (deleted or minimized) must be skipped as a non-match, not throw. *Task 1 test.*
3. **Spec-qualified kinds** (`verdict:2589` vs `verdict:25890` vs `verdict`) must not cross-match. The marker includes ` -->`, so `startsWith` stays exact. *Task 1 test.*
4. **A `--kind` carrying marker-breaking text** (`-->`, a space, a newline, uppercase) must exit 2 rather than build a marker that matches something else. *Task 1 test.*
5. **A trusted marker comment with no `id`** (a malformed payload row) must not produce `id: "undefined"`. Drop it from `ids`. *Task 1 test.*

---

### Task 1: `find-run-comment.js` CLI

**Files:**
- Create: `plugin/bin/find-run-comment.js`
- Test: `tests/find-run-comment-cli.test.js` (sibling of `tests/compose-pr-body-cli.test.js`)
- Modify: `docs/plugin-structure.md`, adding one command-reference line next to the `compose-pr-body.js` line (~line 165), same shape: invocation, `# {purpose} (#3936) — …`, exit codes, test file.

**Interfaces:**
- Produces:
  - `findRunComments(payload: unknown, kind: string) -> { kind: string, id: string|null, ids: string[], skipped: string[] } | null`. Returns `null` when `payload` is not a comments list. A list is either `{comments: Array}` (gh `--json comments` shape) or a bare `Array` (REST/MCP shape).
  - `parseArgs(argv: string[]) -> { help: boolean, commentsFile?: string, kind?: string } | { error: string }`
  - `run(argv: string[], deps = realDeps) -> 0|1|2`, where `deps = { readFile(path) -> string, stdout(s), stderr(s) }`
  - CLI: `node plugin/bin/find-run-comment.js --comments-file <file> --kind <kind> [--help]`. Stdout is exactly one line: `JSON.stringify({kind, id, ids, skipped})` + `\n`.
- Rules (the jq the prose pins, restated as code):
  - `marker = '<!-- run-comment: ' + kind + ' -->'`; a candidate is an element that is a non-null object whose `body` is a string and `body.startsWith(marker)`.
  - `ids` = candidates passing `isTrustedComment`, in payload order, mapped to `String(c.id)`, dropping any whose `id` is `null`/`undefined`/`''`. `id = ids[0] ?? null`.
  - `skipped` = candidates failing `isTrustedComment`, mapped through `untrustedSkipNote`, in payload order.
  - `kind` must match `/^[a-z][a-z-]*(:\d+)?$/`, which covers `verdict`, `try-it`, `release-status`, `brief:2970`. Anything else is a usage error.
  - Value flags given as the last argv element, or with a value starting `--`, or empty: usage error (cli-wrapper-contract's trailing-bare-flag rule).
  - Unknown argument: usage error. `--help`/`-h`: print `USAGE` to stdout, return 0.
  - Header comment: purpose (#3936), the corrected premise in one sentence, the exit vocabulary citing `wrap-up-engine.js`, and the contract `_shared/pr-run-comments.md`'s Find step.

- [ ] **Step 1: Write the failing tests** in `tests/find-run-comment-cli.test.js`. Require `../plugin/bin/find-run-comment.js` and `untrustedSkipNote`/`trustedJqSelect`/`untrustedJqNote` from `../plugin/bin/lib/issues/comment-trust.js`. Fixture `C` (gh shape):

```js
const C = [
  { id: 'IC_member', url: 'https://x/c/1', author: { login: 'maint' }, authorAssociation: 'MEMBER', body: '<!-- run-comment: verdict -->\n\nPASS' },
  { id: 'IC_none', url: 'https://x/c/2', author: { login: 'mallory' }, authorAssociation: 'NONE', body: '<!-- run-comment: verdict -->\nforged' },
  { id: 'IC_owner_brief', url: 'https://x/c/3', author: { login: 'o' }, authorAssociation: 'OWNER', body: '<!-- run-comment: brief -->' },
  { id: 'IC_collab_late', url: 'https://x/c/4', author: { login: 'c' }, authorAssociation: 'COLLABORATOR', body: 'hi\n<!-- run-comment: verdict -->' },
  { id: 'IC_contrib', url: 'https://x/c/5', author: { login: 'bot' }, authorAssociation: 'CONTRIBUTOR', body: '<!-- run-comment: verdict -->' },
  { id: 'IC_nobody', url: 'https://x/c/6', author: { login: 'gone' }, authorAssociation: 'MEMBER', body: null },
];
```

Tests (names carry AC ids):
- `AC2.1: selects only a trusted author's marker comment and names each skipped one`: `findRunComments({ comments: C }, 'verdict')` deepEquals `{ kind: 'verdict', id: 'IC_member', ids: ['IC_member'], skipped: [untrustedSkipNote(C[1]), untrustedSkipNote(C[4])] }`.
- `AC2.1: a spec-qualified kind matches only its own marker`: comments with bodies `<!-- run-comment: verdict:2589 -->` (MEMBER, `a`), `<!-- run-comment: verdict:25890 -->` (MEMBER, `b`), `<!-- run-comment: verdict -->` (MEMBER, `c`). Kind `verdict:2589` → ids `['a']`. Kind `verdict` → ids `['c']`.
- `REST/MCP shape: a bare array with author_association, html_url and user.login`: `[{ id: 1, html_url: 'https://x/r/1', user: { login: 'm' }, author_association: 'COLLABORATOR', body: '<!-- run-comment: failure -->' }, { id: 2, html_url: 'https://x/r/2', user: { login: 'e' }, author_association: 'NONE', body: '<!-- run-comment: failure -->' }]` with kind `failure` → `id: '1'`, `ids: ['1']`, `skipped: [untrustedSkipNote(second)]`, and that note includes `https://x/r/2` and `(NONE)`.
- `a marker comment with no association is untrusted and noted as "no association"`.
- `two trusted matches: id is the first, ids lists both in payload order`.
- `a trusted match with no id is dropped from ids`: `{authorAssociation:'MEMBER', body:'<!-- run-comment: verdict -->'}` alone → `{ id: null, ids: [] , skipped: [] }`.
- `no marker comment at all: id null, empty ids and skipped`.
- `AC2.1: parity with the documented jq` (skip with `t.skip('jq not found in this environment')` when `spawnSync('jq',['--version'])` errors, the precedent in `tests/comment-trust-conformance.test.js`). Run `jq -r '.comments[] | select(.body | startswith("<!-- run-comment: verdict -->")) | ' + trustedJqSelect() + ' | .id'` and the `untrustedJqNote()` twin over `JSON.stringify({ comments: C.filter((c) => c.body !== null) })`. Assert the CLI's `ids` equals the jq id lines and `skipped` equals the jq note lines. (jq's `startswith` errors on a null body, so the parity fixture drops it; the null-body case is the CLI's own test above.)
- `findRunComments returns null for a non-list payload`: each of `null`, `42`, `'x'`, `{}`, `{ comments: 'x' }`, `{ message: 'Not Found' }`.
- `run: prints one JSON line and exits 0` via fake deps (`readFile` returns `JSON.stringify({comments: C})`). Exit 0, stdout ends with `\n`, contains exactly one line, and parses to the `AC2.1` object above. Stderr is empty.
- `run: payload failures exit 1`: `readFile` throws (ENOENT), returns `''`, returns `'{not json'`, returns `'null'`, returns `'{"message":"Not Found"}'`. Each → 1, stderr names `--comments-file`, stdout empty.
- `run: malformed invocations exit 2`: `[]`, `['--kind','verdict']`, `['--comments-file','f']`, `['--comments-file','f','--kind']`, `['--comments-file','f','--kind','']`, `['--comments-file','f','--kind','--x']`, `['--comments-file','f','--kind','Verdict']`, `['--comments-file','f','--kind','verdict -->']`, `['--comments-file','f','--kind','a b']`, `['--comments-file','f','--kind','verdict','--bogus']`. Each → 2 with `usage:` on stderr, and `readFile` is never called (assert with a counter).
- `--help exits 0 and prints usage on stdout`.
- `the real binary runs: spawn node on a tmp comments file`: write `{comments: C}` to `fs.mkdtempSync(path.join(os.tmpdir(),'frc-'))`, `spawnSync(process.execPath, [BIN, '--comments-file', file, '--kind', 'verdict'])`. Status 0, `JSON.parse(stdout).id === 'IC_member'`. Clean up in `finally`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/find-run-comment-cli.test.js`
Expected: FAIL with `Cannot find module '../plugin/bin/find-run-comment.js'`

- [ ] **Step 3: Implement `plugin/bin/find-run-comment.js`** per the Interfaces block. Shape it on `plugin/bin/compose-pr-body.js` (`FLAGS` map, `parseArgs`, `realDeps`, `usageError` helper). `run` validates both flags and `kind` before calling `deps.readFile`. Wrap `readFile` + `JSON.parse` in try/catch → 1. A `null` from `findRunComments` → 1 with `--comments-file … is not a comments list` on stderr.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/find-run-comment-cli.test.js`
Expected: PASS (all tests; the jq parity test may report `skip` only when jq is absent)

- [ ] **Step 5: Add the `docs/plugin-structure.md` command-reference line** directly after the `compose-pr-body.js` line:
`node plugin/bin/find-run-comment.js --comments-file <file> --kind <kind>   # PR run-comment Find (#3936) — reads a \`gh pr view … --json comments\` file (or a REST/MCP comment array) and prints {kind, id, ids, skipped}: the trusted \`<!-- run-comment: {kind} -->\` comment ids and one skip note per untrusted one, through bin/lib/issues/comment-trust.js — the worktree-safe form of \`_shared/pr-run-comments.md\`'s Find step. Exit 0 answered, 1 unreadable/unparseable/not-a-comments-list payload, 2 malformed invocation; tests in \`tests/find-run-comment-cli.test.js\``

- [ ] **Step 6: Real-input probe.** Run `node plugin/bin/find-run-comment.js --comments-file {scratch}/pr-3929-comments.json --kind verdict` (scratch = this session's scratchpad, where the plan-authoring probe wrote the file; re-fetch with `gh pr view 3929 --repo thn-inc/claude-tweaks --json comments > {file}` if absent).
Expected: `{"kind":"verdict","id":"IC_kwDORUwzVM8AAAABeYt58A","ids":["IC_kwDORUwzVM8AAAABeYt58A"],"skipped":[]}`. With `--kind try-it`, expected id `IC_kwDORUwzVM8AAAABeZAdxw`. Paste both outputs into the task report.

- [ ] **Step 7: Commit**

```bash
git add plugin/bin/find-run-comment.js tests/find-run-comment-cli.test.js docs/plugin-structure.md
git commit -m "Add find-run-comment.js — worktree-safe filter for PR run-comment Find (refs #3936)"
```

### Task 2: Find step prose, tidy tombstone pointer, skill-graph edge

**Files:**
- Modify: `plugin/skills/_shared/pr-run-comments.md` (Post-or-update step 1 "Find", lines ~137-164)
- Modify: `plugin/skills/tidy/scan-procedures.md:124` (the one `run-comment: failure` row)
- Modify: `docs/skill-graph.md:239` (the `/dispatch` section's `_shared/pr-run-comments.md` row; append one sentence)
- Test: `tests/pr-run-comments.test.js` (append)
- Test: `tests/comment-trust-conformance.test.js` (run only, no edit — its AC5.1 needles, tombstone-row pins and 6/5 sweep counts must stay green)

**Interfaces:**
- Consumes: Task 1's CLI path `bin/find-run-comment.js`, flags `--comments-file`, `--kind`, its output `{kind, id, ids, skipped}`, and exits 1/2.

- [ ] **Step 1: Write the failing tests** (append to `tests/pr-run-comments.test.js`; slice the Find step between `1. **Find.**` and `2. **Found`, the anchors `comment-trust-conformance.test.js` uses):
- `AC1.1: the Find step's worktree-safe form is a plain fetch plus bin/find-run-comment.js`. The slice includes `gh pr view {pr-number} --repo {owner}/{repo} --json comments > /tmp/{kind}-comments-{n}.json` and `bin/find-run-comment.js" --comments-file /tmp/{kind}-comments-{n}.json --kind {kind}`. The fetch line (the slice line containing `> /tmp/{kind}-comments-{n}.json`) contains none of `--jq`, `github.com`, `$?`, `;`, `&&`. `fs.existsSync(path.join(ROOT,'plugin','bin','find-run-comment.js'))`. Go-red: a frozen `PRE_CHANGE_FIND_STEP` const (the current step 1 text, lines 137-164 verbatim) must not contain either needle.
- `AC2.1: the worktree-safe form says it applies the same marker and Trusted authors test and relays skipped`. The collapsed slice matches `/comment-trust\.js/`, `/Trusted authors/`, `/`skipped`/`, `/exit 1/` and `/exit 2/`. The frozen pre-change step lacks `comment-trust.js` and `` `skipped` ``.
- `the Find step forbids chaining an unquoted $? onto the jq shortcut and cites scratch-worktree.md §7`. The slice contains `` `$?` `` and `_shared/scratch-worktree.md`. The frozen pre-change step lacks both.
- `tidy's tombstone row points at the worktree-safe form`. The single line of `plugin/skills/tidy/scan-procedures.md` containing `run-comment: failure` also contains `find-run-comment.js` and `--kind failure`. A frozen copy of the current row (`comment-trust-conformance.test.js`'s `PRE_CHANGE_TOMBSTONE_ROW` shape, here the current live row) lacks `find-run-comment.js`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/pr-run-comments.test.js`
Expected: FAIL on the four new tests (needles absent); every pre-existing test still passes

- [ ] **Step 3: Rewrite Find step 1 in `pr-run-comments.md`.** Keep the opening resolution sentence. Then make the worktree-safe form primary: two fenced `bash` blocks, each its own plain Bash call, with no chain, no `--jq`, and no host in `--repo`:

```bash
gh pr view {pr-number} --repo {owner}/{repo} --json comments > /tmp/{kind}-comments-{n}.json
```

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/find-run-comment.js" --comments-file /tmp/{kind}-comments-{n}.json --kind {kind}
```

Then state, in prose:
- (a) It prints one JSON line `{kind, id, ids, skipped}`. `id` is the first trusted marker comment's GraphQL node ID, or `null` (not found). `ids` lists every match, for the race case below. `skipped` holds one skip-notice line per untrusted marker comment, to relay in the output. It applies the same first-line marker `startswith` test and **Trusted authors** rule as the jq below, through `bin/lib/issues/comment-trust.js`.
- (b) Substitute the literal plugin root for `${CLAUDE_PLUGIN_ROOT}`, because a variable script operand is refused in a worktree session (§7's script-operand row).
- (c) A bare `{owner}/{repo}` resolves against `gh`'s default host `github.com`. On another host, pass `{host}/{owner}/{repo}` as in the shortcut.
- (d) Exit 1 (payload unreadable or not a comments list, e.g. an empty file left by a failed fetch) or exit 2 (malformed invocation) is a failed find. Route it to **On failure** below.

Then keep both existing jq fences byte-identical under a sentence introducing them as the shortcut outside a worktree-isolated session, still applying Trusted authors. Add: "Run each as one plain command — never chain an unquoted `$?` onto it (`; echo exit=$?`): the worktree guard refuses that shape (`_shared/scratch-worktree.md` §7)." Keep the `.id` GraphQL node ID paragraph and the "Zero or one result" paragraph. Adjust "More than one" to read on `ids` too ("`ids` has more than one entry, or the shortcut prints more than one id"). Keep the `1. **Find.**` / `2. **Found` anchors and the `gh pr view {pr-number} --repo {host}/{owner}/{repo} --json comments` text intact.

- [ ] **Step 4: Edit the tidy row** (`scan-procedures.md:124`, same line). After `(trusted authors only; name each skipped one per \`_shared/pr-run-comments.md\`'s skip notice)` insert: `— in a worktree-isolated session use that file's Find-step worktree-safe form instead (plain \`gh pr view {pr-number} --json comments > {file}\`, then \`bin/find-run-comment.js --comments-file {file} --kind failure\`; non-empty \`ids\` = tombstoned)`. The row keeps exactly one `run-comment: failure` literal, and the jq stays byte-identical.

- [ ] **Step 5: Append to `docs/skill-graph.md:239`** (end of the row's last cell, before the closing ` |`): ` The Find step's worktree-safe form filters a plain \`gh pr view --json comments\` file with \`bin/find-run-comment.js\`, which applies the Trusted authors rule through \`bin/lib/issues/comment-trust.js\`; \`/tidy\`'s failure-tombstone check names the same form (#3936).`

- [ ] **Step 6: Run the tests to verify they pass**

Run: `node --test tests/pr-run-comments.test.js tests/comment-trust-conformance.test.js tests/skill-graph-table-structure.test.js`
Expected: PASS (`comment-trust-conformance` still counts 6 selects / 5 notes; no new jq copy was added)

- [ ] **Step 7: Commit**

```bash
git add plugin/skills/_shared/pr-run-comments.md plugin/skills/tidy/scan-procedures.md docs/skill-graph.md tests/pr-run-comments.test.js
git commit -m "Make the PR run-comment Find step worktree-safe — plain fetch plus find-run-comment.js (refs #3936)"
```

### Task 3: Record the refused shape in scratch-worktree.md §7

**Files:**
- Modify: `plugin/skills/_shared/scratch-worktree.md` §7 table (insert one row after the `github.com URL argument together with a runtime variable` row, ~line 253)
- Test: `tests/scratch-worktree-shell-constraint-table.test.js` (append)

**Interfaces:** none (prose only; cites Task 1's CLI by path).

- [ ] **Step 1: Write the failing test** (append to `tests/scratch-worktree-shell-constraint-table.test.js`) `the table records the gh --jq / github.com --repo plus unquoted $? shape (#3936)`. Using the file's own `table()`/`splitRow()`, exactly one row has verdict `refused`, a Shape cell containing `--jq` and `` `$?` ``, a Last-verified cell starting `2026-10-24 (#3936)`, and a Workaround cell containing `find-run-comment.js`. Go-red: run the same row predicate over a frozen pre-change table string (the current header, separator, and the existing `github.com`/`$TMPDIR` rows) and assert zero matches.

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/scratch-worktree-shell-constraint-table.test.js`
Expected: FAIL after Step 1 (the new test only)

- [ ] **Step 3: Insert the row** (every literal `|` inside a cell escaped as `\|`; six cells):

| Shape | Example | Verdict | Refusal wording | Workaround | Last verified |
|---|---|---|---|---|---|
| `gh` with a `--jq` program containing `\|`, or a `github.com/…` `--repo` value, chained by `;` or `&&` onto an unquoted `$?` (each passes alone; a quoted `"exit=$?"`, a pipe-free `--jq`, and a plain `gh … --json comments > file; echo exit=$?` pass) | `gh pr view 1 --repo o/r --json comments --jq '.comments[] \| .id'; echo exit=$?` | refused | "runs gh with the text .comments[] \| .id inside a construct too complex to verify" (the `github.com` form: "names git in a form too complex to verify") | Run the `gh` call alone, or fetch with plain `gh pr view … --json comments > file` and filter the file — `_shared/pr-run-comments.md`'s Find step uses `bin/find-run-comment.js` | 2026-10-24 (#3936); first #3845 |

(Insert only the data row; the header shown is for orientation.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/scratch-worktree-shell-constraint-table.test.js`
Expected: PASS (shape cells unique, 6 cells, closed-vocabulary verdict, dated last-verified)

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/_shared/scratch-worktree.md tests/scratch-worktree-shell-constraint-table.test.js
git commit -m "Record the gh --jq plus unquoted \$? refusal in scratch-worktree §7 (refs #3936)"
```

## Spec coverage map

| Spec item | Task |
|---|---|
| Deliverable 1: worktree-safe Find (plain fetch + helper reusing comment-trust.js; jq kept as the non-isolated shortcut) | 1, 2 |
| Deliverable 2: record the refused `gh --jq` shape and the `--repo` host token hazard in §7 | 3 |
| Deliverable 3: check `_shared/pr-checklist-refresh.md` and `wrap-up/verification-brief.md`, and point copies at the safe form | 2 (tidy row; the two named files carry no copy, see the Reader inventory) |
| AC1.1 no wd-guard refusal running the documented Find step | 2 (prose test), plus the live re-probe at Common Step 5 |
| AC2.1 same marker + trusted selection, skipped reported | 1, 2 |
| AC3.1 `npm test` passes incl. pr-run-comments pins | Common Step 5 (full suite via verify.js) |

Waived AC3.1: the full-suite pass is the build's Common Step 5 / `/test` gate, run centrally through `verify.js`, not a per-task test step.
