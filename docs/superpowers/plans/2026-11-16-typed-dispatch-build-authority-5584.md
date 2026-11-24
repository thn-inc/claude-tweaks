# Typed dispatch build authority (#5584) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `/claude-tweaks:dispatch` command a person typed, naming a `ready` record, stands in for that record's `auto:build` label at the queue pull, `dispatch resume` and the driver's admission step — and nothing else does.

**Architecture:** The `UserPromptSubmit` hook writes a pointer (record → prompt id) into the session temp dir. `typed-command.js` reads that pointer and confirms, in the session's own transcript, that the prompt row is a human-marked `/claude-tweaks:dispatch` command naming the record within 30 minutes. One pure rule, `build-authority.js`'s `resolveBuildAuthority`, combines labels, environment and that answer into `label | typed | none`; the three callers call the rule and never read the pointer or transcript themselves.

**Tech Stack:** Node 18+ CommonJS, `node --test`, no new dependencies.

**Spec:** `.claude-tweaks/pipelines/2026-11-16T015923-record-5584/work/5584-spec.md` (read it whole before any task; its Technical Approach tables are normative). Probe capture: `work/5584-probe.md` and `work/5584-captured-rows.json` beside it.

## Global Constraints

- Every comparison on an environment value or transcript field is exact string equality; unset, empty, other-case, trailing-space and trailing-newline values fail their condition.
- Session/prompt id shape: `/^[A-Za-z0-9-]{1,64}$/`. Bound: `TYPED_DISPATCH_MAX_AGE_MS = 30 * 60 * 1000`. Pointer: at most 65536 bytes, regular file, never followed through a link. File name `dispatch-prompts.json` under `sessionTmpRoot(sessionId)` (`plugin/bin/lib/session-tmp.js`).
- Pointer shape: `{ "v": 1, "sessionId": "<id>", "records": { "<n>": { "promptId": "<id>", "at": "<ISO time>" } } }`, written to a temp name in the same directory and renamed.
- The reason words, exactly and in this order: `not-named`, `not-ready`, `held`, `labels-unreadable`, `entrypoint`, `not-attended`, `remote`, `hub-run`, `launcher`, `no-session-id`, `no-pointer`, `pointer-unreadable`, `pointer-other-session`, `expired`, `no-transcript`, `transcript-unreadable`, `no-prompt-row`, `not-typed`, `other-command`, `not-a-terminal`, `ci`.
- Nothing this record adds writes a label. A typed record never implies `auto:merge`.
- Everything is additive: a caller that does not pass the new flags or facts behaves byte-identically to the base commit. No exclusion reason is added to the queue pull's registry.
- Inject `env`, clock, terminal test, home/config dir, tmpdir and `fsImpl` (`.claude/skills/gh-api-module-pattern`, `.claude/skills/windows-checkout-test-parity`). A missing/unreadable input refuses with its own reason word (`.claude/skills/parse-signal-discipline`).
- Fixtures keep only `type`, `promptId`, `sessionId`, `timestamp`, `turnOrigin`, `origin`, `promptSource`, `isMeta`, `isSidechain`, `message`, plus the refusal keys a captured row carries (`scheduledTaskId`, `scheduledFireId`, `wakeupSource`, `queueSkipSlashCommands`, `queueSkipAttachments`, `queuePriority`), with fixed test ids — copy them from `work/5584-captured-rows.json`, never hand-invent a captured row's markers.
- `plugin/skills/dispatch/SKILL.md` (52,088 bytes) and `plugin/skills/dispatch/settle-and-merge.md` (50,974 bytes) end no larger than on the base commit.
- Commit message style `{Verb} {what} — {detail}`, with `refs #5584`, never `closes`/`fixes`.
- Source-scan lints over `plugin/bin/**` (`tests/path-guard-conformance.test.js`): never write the tokens `existsSync` or `realpathSync` in new code; use `fs.lstatSync`/`fs.statSync` in a `try`, or `plugin/bin/lib/path-guard`'s `lstatType`/`resolveLeaf`. Every `spawnSync`/`execFileSync` passes `windowsHide: true` (`tests/windows-hide-spawn-conformance.test.js`).
- Governing project skills each implementer reads before its task (their rules are binding and are not restated here): `.claude/skills/gh-api-module-pattern` (Tasks 6, 7, 8, 9 — the injectable runner seam and the CLI `run(argv, deps)` contract), `.claude/skills/windows-checkout-test-parity` (Tasks 2, 4, 9 — `platform`/`env` as parameters, temp-dir and path assertions), `.claude/skills/parse-signal-discipline` (Tasks 2, 4), `.claude/skills/regex-scan-linearity` (Task 4's command match), `.claude/skills/driver-step-addition` (Task 8), `.claude/skills/skill-prose-conformance-tests` and `.claude/skills/prose-code-twin-pin` (Tasks 10, 11), `.claude/skills/dispatch-queue-exclusion-addition` (Task 6 — read to confirm no exclusion reason is added).

## Review Focus

1. A pointer entry overwritten by a later scheduled/peer line for the same record → refused (`not-typed`), even though an earlier typed row for that record is still in the transcript. Test in Task 4.
2. A transcript line of 600 KB or a 100 MB file → read in chunks, never whole; a line with the prompt id inside a huge `message` still parses. Test in Task 1 (600 KB line).
3. A `/claude-tweaks:dispatch #12` typed in a session launched through `cc` (`CC_POSTURE` set, no `CC_LAUNCHED_BY`) → `none` with `launcher`, and the refusal line says the launcher must mark the session. Test in Task 3.
4. `--named 12,13` where 12 is already granted (in the pool) → 12 goes through the pool untouched, no fetch, no admit line, no `AUTO` line for it. Test in Task 6.
5. The hook on a payload whose `prompt` is not a string, or a huge prompt → writes nothing, prints nothing, exit 0, and never requires `grouping.js` unless the first line starts with `/claude-tweaks:dispatch`. Test in Task 5.

## Spec coverage map

Each test step names the clause ids it covers in its test names (`test('AC4.3: …')`).

| Clauses | Task |
|---|---|
| AC1.1, AC1.2 | Task 12 (docs/hooks.md table, fixture-vs-capture assertion in Task 4) and Task 14 (PR body) |
| AC2.1, AC2.2, AC2.3, AC2.4 | Task 5 |
| AC3.1, AC3.2, AC3.3 | Task 3 |
| AC4.1, AC4.2, AC4.3, AC4.4, AC4.5, AC4.6, AC4.7, AC4.8, AC4.9, AC4.10, AC4.11, AC4.12, AC4.13, AC4.14 | Task 2 (pointer cases) and Task 4 (`no-session-id`, `expired`) |
| AC5.1, AC5.2, AC5.3, AC6.1, AC6.2, AC6.3, AC6.4, AC7.1 | Task 6 |
| AC8.1, AC8.2, AC9.1, AC9.2, AC9.3, AC9.4 | Task 8 |
| AC10.1 | Task 7 |
| AC11.1, AC11.2 | Task 6 (queue pull fake runner) and Task 8 (driver fake runner) |
| AC12.1, AC12.2 | Task 8 |
| AC13.1, AC13.2 | Task 11 (size assertion) and the final `npm test -- --full` at Common Step 5 |
| AC14.1 | Task 14 Step 3 |
| AC15.1, AC15.2, AC15.3 | Task 3 (rule), Task 6 (queue pull), Task 7 (resume), Task 8 (driver) |
| AC16.1, AC16.2 | Task 10 |
| AC17.1, AC17.2 | Task 14 Step 2 |
| AC18.1, AC18.2, AC18.3, AC18.4, AC18.5, AC18.6, AC18.7, AC18.8, AC18.9, AC18.10, AC18.11, AC18.12, AC18.13, AC18.14, AC18.15, AC18.16, AC18.17, AC18.18, AC18.19, AC18.20, AC18.21, AC18.22, AC18.23, AC18.24, AC18.25, AC18.26, AC18.27, AC18.28, AC18.29, AC18.30, AC18.31, AC18.32, AC18.33, AC18.34, AC18.35 | Task 4 |
| AC19.1 | Task 1 |
| AC19.2 | Task 11 |
| AC20.1 | Task 9 |
| AC21.1 | Task 14 Step 1 |

---

### Task 1: Prompt-row reader in transcript.js

**Files:**
- Modify: `plugin/bin/lib/timing/transcript.js` (add one exported function)
- Test: `tests/bin-lib/timing/transcript.test.js`

**Interfaces:**
- Produces: `readPromptRows(filePath: string, promptId: string, { fsImpl = fs, chunkBytes = 65536 } = {}) -> object[]` — synchronous; calls `statTranscriptOrThrow(fsImpl, filePath)` first (same error codes as `readUsage`: `ENOENT`, `EISDIR`, …); reads with `openSync`/`readSync` in `chunkBytes` chunks, splits on `\n` across chunk boundaries, `JSON.parse`s only a line that contains `promptId` as a substring, skips lines that do not parse, returns parsed objects whose `promptId === promptId`. Never `readFileSync` the whole file. A read error after the stat propagates (Task 4 maps it to `transcript-unreadable`).

- [ ] **Step 1: Write the failing tests** in `tests/bin-lib/timing/transcript.test.js`: `readPromptRows returns only rows whose promptId matches` (three rows, two ids → two rows); `readPromptRows skips lines that do not parse` (a truncated JSON line containing the id is skipped); `readPromptRows reads a 600 KB line` (one row whose `message.content` is 600,000 chars, `chunkBytes: 4096`, row returned intact); `readPromptRows throws ENOENT for a missing file` and `throws EISDIR for a directory` (assert `err.code`, same as the existing `readUsage` tests).
- [ ] **Step 2: Run** `node --test tests/bin-lib/timing/transcript.test.js` — Expected: the five new tests FAIL (`readPromptRows is not a function`).
- [ ] **Step 3: Implement `readPromptRows`** and add it to `module.exports`.
- [ ] **Step 4: Run** `node --test tests/bin-lib/timing/transcript.test.js` — Expected: PASS, all tests.
- [ ] **Step 5: Commit** `Add readPromptRows to the transcript reader — refs #5584`.

### Task 2: Pointer writer and reader (typed-command.js, pointer part)

**Files:**
- Create: `plugin/bin/lib/issues/typed-command.js`
- Test: `tests/bin-lib/issues/typed-command.test.js`

**Interfaces:**
- Produces (exported): `POINTER_FILE = 'dispatch-prompts.json'`, `TYPED_DISPATCH_MAX_AGE_MS`, `POINTER_MAX_BYTES = 65536`, `isWellFormedId(s) -> boolean` (the `[A-Za-z0-9-]{1,64}` test);
  `writePointer({ sessionId, promptId, numbers, now, tmpdir = os.tmpdir(), fsImpl = fs }) -> boolean` — refuses (returns false, writes nothing) unless both ids are well formed and `numbers` is a non-empty array of positive integers; reads the existing pointer only when it is a regular file ≤ 64 KiB parsing to `v: 1` with the same `sessionId`, else starts empty; sets `records[String(n)] = { promptId, at: now.toISOString() }` for each number (replacing, keeping other records); `mkdirSync(root, {recursive:true})`, writes `${POINTER_FILE}.${process.pid}.tmp`, `renameSync`. Never throws (catch → false).
  `readPointer({ sessionId, number, tmpdir = os.tmpdir(), fsImpl = fs }) -> { ok: true, promptId, at } | { ok: false, reason }` — `lstat` the path under `sessionTmpRoot` (no mkdir): absent → `no-pointer`; not a regular file (symlink included, never followed) or size > 64 KiB → `pointer-unreadable`; unparseable JSON, `v !== 1`, `records` not a plain object → `pointer-unreadable`; `sessionId` mismatch → `pointer-other-session`; no entry for the number → `no-pointer`; entry's `promptId` not well formed or `Date.parse(at)` NaN → `pointer-unreadable`.
- Step order is the spec's Transcript-check table steps 2–4; step 5 (age) lives in Task 4.

- [ ] **Step 1: Write the failing tests** (AC4), one test each, every refusal asserting its exact reason word: no file; empty `records`; entry only for another record; not JSON; `v: 2`; `records` an array; entry `promptId` `"a/b"`; entry `at` `"yesterday"`; `sessionId` other than the reader's (`pointer-other-session`); a symlink resolving inside the temp dir, one outside, one dangling (all `pointer-unreadable`, and assert the target file was not read by pointing an inside-link at a valid pointer); a 65,537-byte file. Writer: round-trip writes `{v:1, sessionId, records:{"12":{promptId, at}}}`; a second write for 12 replaces 12's entry and keeps 13's; a write with session id `..`, `../x`, `a/b`, `a/`, `a%2fb`, `''`, or 65 chars writes nothing and returns false; reader with those ids returns `no-session-id` is Task 4's (here assert `isWellFormedId` false for each). Use a real temp dir per test (`fs.mkdtempSync`), real symlinks, no skip.
- [ ] **Step 2: Run** `node --test tests/bin-lib/issues/typed-command.test.js` — Expected: FAIL (module not found).
- [ ] **Step 3: Implement** the four exports above in `typed-command.js`. Header comment: what the pointer is, that it is a pointer and not a proof, that `timing/transcript.js` is required lazily inside the reader (Task 4), never at load.
- [ ] **Step 4: Run** the same command — Expected: PASS.
- [ ] **Step 5: Commit** `Add the typed-dispatch prompt pointer — refs #5584`.

### Task 3: The build-authority rule

**Review risk:** high

**Files:**
- Create: `plugin/bin/lib/issues/build-authority.js`
- Test: `tests/bin-lib/issues/build-authority.test.js`

**Interfaces:**
- Consumes: `parseExplicitIssueList` (`plugin/bin/lib/issues/grouping.js`), `parseRecordFacets`/`normalizeLabelNames` (`plugin/bin/lib/issues/record.js`).
- Produces:
  `REASONS` — frozen array, the 21 words of Global Constraints in order.
  `parseTypedDispatch(firstLine: string) -> number[] | null` — strips one trailing `\r` and trailing spaces; must start with exactly `/claude-tweaks:dispatch ` (column 0); the rest is either `resume #N` (`#` optional, one positive integer) or a list accepted by `parseExplicitIssueList` with `invalid.length === 0` and `numbers.length > 0`; anything else (`next`, `--budget`, `close-out`, `--settle-parked`, trailing extra tokens, an empty rest) → null.
  `resolveBuildAuthority({ number, labels, named, env, typedCommand, stdinIsTTY }) -> { authority: 'label'|'typed'|'none', reasons: string[] }` — the spec's state table in order: labels not an array → `labels-unreadable`; `auto:build` → `label`; `named !== true` → `not-named`; no `ready` → `not-ready`; `bot:blocked`/`bot:parked`/`parked` → `held`; in-session (`CLAUDECODE` or `CLAUDE_CODE_SESSION_ID` non-empty): collect each failed condition 1–4 (`entrypoint`, `not-attended`, `remote`, `hub-run`, `launcher`); if any, `none` with them; else call `typedCommand` (a value or a zero-arg function returning `{answer, reason}`) — `typed` → `typed`, else `none` with its reason. Out of session: collect `not-a-terminal` (`stdinIsTTY !== true`), `ci`, `remote`, `hub-run`, `launcher`; none failed → `typed` (no transcript read).
  `CONDITION 4`: when `CC_POSTURE` or `CC_LAUNCHED_BY` is non-empty, `CC_LAUNCHED_BY` must equal `user`.
  `REMEDIES` — frozen object word → one remedy sentence (`not-ready` → `run /claude-tweaks:specify #N`; `launcher` → `the launcher must export CC_LAUNCHED_BY=user (thn-inc/claude-user-config#50)`; default → `grant it with /claude-tweaks:backlog refine #N`, or type the command again for `expired`/`no-pointer`).
  `formatAuthorityLine(number, { authority, reasons }) -> string` — `typed`: `#N has no auto:build label — built on the typed /claude-tweaks:dispatch command`; `none`: `#N has no auto:build label — not built: typed command not accepted (${reasons.join(', ')}); ${remedy of the first reason} (a typed command with any other argument records nothing)`.
- Header comment carries the state table (Deliverable 8) and names the three callers.

- [ ] **Step 1: Write the failing tests** (AC3, AC15 rule part): one per state-table row; per environment condition, the unset, empty and wrong-case value (`CLI`, `cli `, `1\n`, and for condition 4 `hub`, `''`, `User`) each give `none` naming that condition; `held` once per `bot:blocked`, `bot:parked`, `parked`; `typedCommand` thunk is not called when an env condition fails or `auto:build` is present (assert call count 0); terminal path with `stdinIsTTY:true` and no session vars → `typed`, with `CI=1` → `ci`; `assert.deepStrictEqual(REASONS, [...21 words])`; `parseTypedDispatch` accepts `#12`, `#12,#13`, `12`, `resume #12`, `#12 \r`, rejects `next`, `--budget 2`, `#12 --budget 2`, `close-out #12`, `#12,`, `#x`, `` (empty), a leading space, `/claude-tweaks:dispatchx #12`; `formatAuthorityLine` for one `none` and one `typed`.
- [ ] **Step 2: Run** `node --test tests/bin-lib/issues/build-authority.test.js` — Expected: FAIL (module not found).
- [ ] **Step 3: Implement** the module.
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `Add the build-authority rule for typed dispatch commands — refs #5584`.

### Task 4: Transcript check (readTypedCommand) and row fixtures

**Files:**
- Modify: `plugin/bin/lib/issues/typed-command.js`
- Create: `tests/fixtures/typed-command/` (`captured-a.json`, `captured-g.json`, `captured-h.json` — the prompt rows of cases a, g, h copied from `work/5584-captured-rows.json`, markers byte-identical, but each case given its own fixed prompt id: `test-prompt-000a`, `test-prompt-000g`, `test-prompt-000h`; all keep `sessionId: "test-session-0001"`. The capture file uses one prompt id for every case, so copying its ids would make the overwrite test find the (a) row under the (h) id. The AC1 marker-equality assertion compares markers only, never ids.)
- Test: `tests/bin-lib/issues/typed-command.test.js`

**Interfaces:**
- Consumes: Task 1 `readPromptRows`; Task 2 `readPointer`, `isWellFormedId`; `locateTranscripts` (`plugin/bin/lib/timing/transcript.js`); `parseTypedDispatch` from Task 3 (build-authority.js).
- Produces: `readTypedCommand({ number, env, now, tmpdir = os.tmpdir(), homeDir = os.homedir(), fsImpl = fs, readRows = readPromptRows }) -> { answer: 'typed', promptId } | { answer: 'none', reason }` — `now` is a `Date` or epoch milliseconds, normalized with `new Date(now)` on entry (callers pass either); `tmpdir` is the session temp root's parent, the same value `writePointer` got (callers pass it explicitly; the default is only for the hook-equivalent process). Runs the spec's nine steps in order, first failure answers: (1) `env.CLAUDE_CODE_SESSION_ID` well formed else `no-session-id`; (2–4) `readPointer`; (5) `at` not later than `now`, not older than the bound, else `expired`; (6) `locateTranscripts({ sessionId, configDir: env.CLAUDE_CONFIG_DIR || path.join(homeDir, '.claude'), homeDir, fsImpl })` (no `cwd`) returns exactly one entry whose basename is `${sessionId}.jsonl`, else `no-transcript`; (7) `readRows` throws → `transcript-unreadable`; (8) no candidate → `no-prompt-row`; (9) row test → `typed`, or `expired` (a candidate passed markers and command), `other-command` (passed markers), else `not-typed`.
  Exported helpers: `isCandidateRow(row, { sessionId, promptId }) -> boolean`, `rowMarkersPass(row) -> boolean`, `rowCommandNames(row, number) -> boolean`.
- Candidate row, markers, command and time parts: exactly the spec's Technical Approach paragraphs "A candidate row is …" and "The row test has three parts". Command match: whole-string equality with `` `<command-message>claude-tweaks:dispatch</command-message>\n<command-name>/claude-tweaks:dispatch</command-name>\n<command-args>${ARGS}</command-args>` `` — implement as prefix/suffix `startsWith`/`endsWith` checks plus "ARGS contains no `\n`", not a backtracking regex (`.claude/skills/regex-scan-linearity`); then `parseTypedDispatch('/claude-tweaks:dispatch ' + ARGS)` must include `number`.

- [ ] **Step 1: Write the failing tests** — AC18 in full, one test per bullet item, each with a valid pointer written by `writePointer` and a temp config dir holding `projects/<slug>/<sessionId>.jsonl` built from the fixtures: `typed` (captured a; a + task-notification row + tool-result rows sharing its promptId; a with `promptSource:"typed"`; `projects` as a symlink); `not-typed` (captured g; captured h; a with `turnOrigin` absent/`"scheduled"`/`"peer"`/`"Human"`/`"human "`/`true`; `origin` absent/a string/`kind:"peer"`/`kind:"task-notification"`; `isMeta:true`; `promptSource` `"system"`/`"queued"`/`"sdk"`/`"other"`; each of the four keys added; a pointer overwritten by `writePointer` with the h row's promptId while the earlier a row stays); `other-command` (the six listed); `expired` (three); `no-prompt-row` (six); `no-transcript` (all listed link/directory/wrong-place cases); `transcript-unreadable` (inject `readRows` that throws); a working directory whose slug differs still finds the file. Also AC4's `no-session-id` for an absent id and the seven hostile ids, and `expired` for a pointer `at` in the future and one older than 30 min. AC1 fixture rule: a test asserts `captured-a.json`'s markers equal `work/5584-captured-rows.json`'s `a[0]` markers — skip that assertion only if the run dir is absent in the checkout (it is committed on this branch).
- [ ] **Step 2: Run** `node --test tests/bin-lib/issues/typed-command.test.js` — Expected: the new tests FAIL.
- [ ] **Step 3: Implement `readTypedCommand`** and the three helpers.
- [ ] **Step 4: Run** the same — Expected: PASS.
- [ ] **Step 5: Commit** `Add the transcript check for a typed dispatch command — refs #5584`.

### Task 5: The hook's second writer

**Files:**
- Modify: `plugin/bin/lib/hooks/user-prompt-submit.js`
- Test: `tests/user-prompt-submit.test.js`
- Waived `plugin/bin/lib/hooks/bash-prefilter.js`: read only — it already passes only payloads containing `claude-tweaks:` to this handler; the new writer stays behind that gate unchanged.
- Waived `plugin/bin/lib/session-tmp.js`: read only — `sessionTmpRoot` is called by Task 2's writer and reader, not changed.

**Interfaces:**
- Consumes: Task 3 `parseTypedDispatch`; Task 2 `writePointer`.
- Produces: `recordTypedDispatch(input, { now = new Date(), tmpdir = os.tmpdir() } = {}) -> boolean`, exported; `run(ctx)` calls it first, inside `try/catch`, before (and independent of) the `skill_invoked` writer and the `ownedRun` check. Gate before any require: `typeof input.prompt === 'string'` and its first line (split on `\n`, `\r` stripped) starts with `/claude-tweaks:dispatch` followed by a space or end — only then lazily `require('../issues/build-authority')` and `require('../issues/typed-command')`. Session id from `input.session_id`, prompt id from `input.prompt_id`. Never writes stdout; `run` still returns `{}`.

- [ ] **Step 1: Write the failing tests** (AC2), each with a temp `tmpdir` injected and asserting the pointer file contents or its absence: the three writing lines; the eleven non-writing ones listed in AC2; a project with no run dir still writes; an unwritable tmpdir (a file where the root dir should be) → no throw, `{}`; payloads built from captured g and h (prompt = the raw line, their own prompt ids) write the same entry shape a writes; a non-string `prompt` writes nothing; a prompt whose first line is `/claude-tweaks:help` never loads `build-authority.js` (assert via `require.cache` key absent in a child `node -e` run). Every case: the dispatcher's stdout is empty and exit 0 (run the real `plugin/bin/hooks.js user-prompt-submit` with stdin for at least the three writing cases and the unwritable case, `TMPDIR` set to the temp dir).
- [ ] **Step 2: Run** `node --test tests/user-prompt-submit.test.js` — Expected: new tests FAIL.
- [ ] **Step 3: Implement** `recordTypedDispatch` and wire it into `run`. Update the header comment: a second, independent writer; a pointer, not a proof.
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `Record named dispatch prompts in the prompt hook — refs #5584`.

### Task 6: Queue pull `--named` / `--run`

**Review risk:** high

**Files:**
- Modify: `plugin/bin/queue-pull.js` (parser, usage, `run`)
- Modify: `plugin/bin/lib/dispatch/queue-pull.js` (`makeContext`, `runFetch`, `runBlocked`'s line-425 filter, `runWriteBack`, `defaultDeps`)
- Test: `tests/bin-lib/dispatch/queue-pull.test.js` (module and CLI cases; if the CLI parser already has its own test file, `git grep -l "queue-pull.js" tests` finds it and the CLI cases go there)
- Waived `plugin/bin/lib/log-decision/append.js`: read only — `resolveTarget`/`appendEntry`/`formatEntry` are called, not changed.

**Interfaces:**
- Consumes: Task 3 `resolveBuildAuthority`, `formatAuthorityLine`; Task 4 `readTypedCommand`; `resolveTarget`, `appendEntry`, `formatEntry` (`plugin/bin/lib/log-decision/append.js`); `mainCheckoutRoot`.
- CLI: `--named <n[,m…]>` (a comma list of positive integers, `#` optional; empty or any non-numeric element → exit 1) requires `--run <id-or-path>`. Under `--transport files` it admits nothing and prints, per named number, `#N: --named admits nothing under --transport files; the auto:build label is required`; `--run` without `--named`, `--named` with `--rank`, a `--run` that resolves to no directory or that `resolveTarget` refuses → exit 1, nothing written. `--run` value: if it contains a path separator use it as a path, else `path.join(mainCheckoutRoot(cwd), '.claude-tweaks', 'pipelines', value)`; then `resolveTarget({ runDir, cwd })` must return `ok`.
- Module options: `named: number[]` (default `[]`), `runDir: string|null`. Deps: `fetchRecord(ctx, n) -> raw issue | null` (default: `gh issue view n --json number,title,body,labels,createdAt,updatedAt,state` through `ghRun`), `buildAuthority(input)` (default `resolveBuildAuthority`), `readTypedCommand` (default from typed-command.js), `appendDecision({ runDir, text })` (default `appendEntry` with `formatEntry({ status: 'AUTO', now, step: 'queue pull', text, reversibility: 'n/a' })`, section `/dispatch`).
- Behavior in `runFetch` (gh only), right after the queue file is written and before `aliasFile`: for each named number not in the fetched pool, `fetchRecord`; a failed fetch → authority `none` reasons `['labels-unreadable']`; a fetched record whose `state` is not `OPEN` → not admitted, prints `#N is {state lowercased} — not built: the queue pull takes open records only`, no `AUTO` line, the rule not called (spec's Plan Review Clarifications; AC3's 21 words stand); else `buildAuthority({ number, labels, named: true, env: optionEnv(ctx), typedCommand: () => deps.readTypedCommand({ number, env, now: deps.now(), tmpdir: ctx.options.tmpdir || envTmpdir(env) }), stdinIsTTY: false })` (`envTmpdir` from `plugin/bin/lib/session-tmp.js`; module option `tmpdir` lets a test point at its temp root); print `formatAuthorityLine` on stdout; on `typed` append the raw record to the queue file and add the number to `state.typedNumbers` (a `Set`), and append one `AUTO` line `#N admitted on a typed /claude-tweaks:dispatch command (no auto:build label)` to `decisions.md`. When `state.typedNumbers.size > 0`: skip the cache read (no hit possible) and `runWriteBack` skips the blob write. `runBlocked`'s filter becomes `(i.facets.grants.build || state.typedNumbers.has(i.number)) && …`. A named number already in the pool is untouched (no fetch, no line). No other pass changes.

- [ ] **Step 1: Write the failing tests** (AC5, AC6, AC7, AC11 queue part, Review Focus 4): with a fake runner and injected `readTypedCommand` answering `typed`, record 12 (labels `ready`, no `auto:build`) lands in `dispatch-groups.json`, stdout has the admit line, `decisions.md` gains exactly one `AUTO` line; the same record with an open body blocker → `blocked` exclusion, with an open linked PR → `open-pr`, with a non-spec-shaped body → `not-spec-shaped`; one end-to-end test with no injected answer (temp session tmp root holding a pointer from `writePointer`, temp `CLAUDE_CONFIG_DIR` with a transcript built from `captured-a.json`, env with `CLAUDE_CODE_SESSION_ID`, `CLAUDE_CODE_ENTRYPOINT=cli`, `CLAUDE_CODE_SESSION_ATTENDED=1`); refusals (no pointer, g row, h row, `CC_POSTURE=hub`, no `ready`, fetch failure, a `CLOSED` record with an accepted typed command — its line is the open-records-only line and the injected `readTypedCommand` is never called) — not in groups, refusal line names the word and remedy, `decisions.md` unchanged; `--named 12,13` with typed for 12 only; ungranted 14 sharing a Key File with 12, not named, is absent; already-granted 12 named → no `issue view` call; the fake runner records no `issue edit`/`--add-label`/`--remove-label` call in any of these; a pull with `typedNumbers` non-empty calls neither `readOrder` nor `writeOrder`. CLI: the AC7 exits (each → 1, run dir untouched). The existing parity fixtures stay green unchanged (they pass no `--named`).
- [ ] **Step 2: Run** `node --test tests/bin-lib/dispatch/queue-pull.test.js` (plus the CLI test file) — Expected: new tests FAIL.
- [ ] **Step 3: Implement** the CLI flags and the module changes above. Update the CLI header comment and `USAGE` (one line for `--named`/`--run`).
- [ ] **Step 4: Run** the queue-pull suites, then `npm test` (impact-selected; output redirected to a file in the session scratchpad) — Expected: PASS, including the queue-pull parity suites.
- [ ] **Step 5: Commit** `Admit named ungranted records on a typed dispatch command in the queue pull — refs #5584`.

### Task 7: Resume

**Files:**
- Modify: `plugin/bin/lib/dispatch/resume-eligibility.js` (the line-341 check)
- Modify: `plugin/bin/dispatch-resume.js` (`runVerdict`, `realDeps`)
- Test: `tests/bin-lib/dispatch/resume-eligibility.test.js` (verdict cases; the CLI-level held cases go in the existing dispatch-resume CLI test that `git grep -l "dispatch-resume.js" tests` finds)

**Interfaces:**
- Consumes: Task 3 `resolveBuildAuthority`; Task 4 `readTypedCommand`.
- `resumeEligibility(input)` accepts optional `buildAuthority: 'label'|'typed'|'none'` and `authorityReasons: string[]`. Effective authority: `input.buildAuthority` when given, else `labels.includes('auto:build') ? 'label' : 'none'` (unchanged behavior for every existing caller). Refuse `not-granted` when `bot:blocked` is present (as today) or effective authority is `none`; for `none` without `bot:blocked` the line is `#N lacks auto:build (typed command not accepted: ${reasons.join(', ')}) — …` when reasons are given, else today's text.
- `dispatch-resume.js`: `realDeps` gains `env: process.env` and `readTypedCommand`; `runVerdict` computes `resolveBuildAuthority({ number: issue, labels: record.labels, named: true, env: deps.env, typedCommand: () => deps.readTypedCommand({ number: issue, env: deps.env, now: new Date(deps.now()), tmpdir: envTmpdir(deps.env) }), stdinIsTTY: false })` and passes `buildAuthority`/`authorityReasons` (`deps.now` here returns epoch milliseconds, line 169).

- [ ] **Step 1: Write the failing tests** (AC10, AC15 resume part): ungranted record resumes with `buildAuthority: 'typed'`; refused `not-granted` with `'none'`; `bot:blocked` refused with `'typed'` and with `'none'`; omitted `buildAuthority` behaves as the base commit (an existing test unchanged proves it); `bot:parked` and `parked` with an accepted typed command refuse (via the rule's `held` → `none`, asserted through the CLI with an injected `readTypedCommand`).
- [ ] **Step 2: Run** `node --test tests/bin-lib/dispatch/resume-eligibility.test.js` — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the resume suites — Expected: PASS.
- [ ] **Step 5: Commit** `Let dispatch resume take a typed command as the build grant — refs #5584`.

### Task 8: Driver admission

**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/driver/admission.js`
- Modify: `plugin/bin/lib/driver/steps.js` (`admissionStep`)
- Modify: `plugin/bin/lib/driver/run.js` (`newCtx`, `driveRecord`, the named-records loop, `defaultDeps`)
- Test: `tests/bin-lib/driver/admission.test.js`
- Test: `tests/bin-lib/driver/run.test.js`

**Interfaces:**
- Read `.claude/skills/driver-step-addition` first (event fields, `result.extra`).
- `evaluateAdmission(facts)` takes one more fact, `buildAuthority`: `noBuildGrant` fires only when `!facets.grants.build && facts.buildAuthority !== 'typed'`. `ADMISSION_REASONS` keys unchanged.
- `run.js`: `newCtx(record, shared, { named = false } = {})` sets `ctx.named`; `driveRecord(record, shared, deps, steps = STEPS, { named = false } = {})`; the `parsed.records` loop passes `{ named: true }`; `runBudget`'s `driveOne` keeps the default `false`. `defaultDeps` gains `stdinIsTTY: process.stdin.isTTY === true`, `resolveBuildAuthority`, `readTypedCommand`.
- Existing callers: every test in `tests/bin-lib/driver/*.test.js` that builds fake deps without the three new members must keep passing — `admissionStep` falls back to the module's own `resolveBuildAuthority`/`readTypedCommand` when `deps` lacks them, and a missing `deps.env` reads as `{}` (a labelled record answers `label` before env is read).
- `admissionStep`: `const auth = deps.resolveBuildAuthority({ number: n, labels: ctx.issue.labels, named: ctx.named === true, env: deps.env, typedCommand: () => deps.readTypedCommand({ number: n, env: deps.env, now: deps.date(), tmpdir: envTmpdir(deps.env) }), stdinIsTTY: deps.stdinIsTTY === true })`; pass `buildAuthority: auth.authority`; the result carries `extra: { authority: auth.authority }` on ok and stop; a stop whose reasons include `record lacks auto:build` and `auth.authority === 'none'` appends `; typed command not accepted: ${auth.reasons.join(',')}` to the detail.

- [ ] **Step 1: Write the failing tests**: admission (AC8) — `ready`, no `auto:build`, `buildAuthority:'typed'` → no grant reason; `'none'`, absent, `'label'`, `'yes'` → `record lacks auto:build`; `Object.keys(ADMISSION_REASONS)` equals the base list. run (AC9, AC11, AC12, AC15 driver part): `drive.js #N` with `stdinIsTTY:true`, empty env → not refused for the grant; `stdinIsTTY:false`, `CI=1`, `CC_HUB_RUN=1`, and `--budget` → refused; in-session env with `stdinIsTTY:true` → refused unless injected `readTypedCommand` answers typed; a record with `auto:build` behaves as on base in all six; the admission event line carries `authority`; the fake gh runner sees no label edit; a typed record without `auto:merge` stops the merge step `not-authorized`; `bot:blocked`/`bot:parked`/`parked` with an accepted typed command refused.
- [ ] **Step 2: Run** `node --test tests/bin-lib/driver/admission.test.js tests/bin-lib/driver/run.test.js` — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the driver suites — Expected: PASS.
- [ ] **Step 5: Commit** `Let the driver admit a named record on a typed command — refs #5584`.

### Task 9: Probe tool

**Files:**
- Create: `tools/typed-command-probe.js`
- Test: `tests/typed-command-probe/cli.test.js` (sized like `tests/guard-refusals/cli.test.js`, ~180 lines)

**Interfaces:**
- `run(argv, deps) -> exitCode`; flags `--session <id> --record <n> [--config-dir <dir>] [--tmpdir <dir>]`; prints one JSON object: `{ pointer: <readPointer result>, candidates: [{ promptId, turnOrigin, originKind, promptSource, isMeta, keys }], answer: <readTypedCommand result> }` — never any `message` text. Calls the shipped `readTypedCommand` with `env = { CLAUDE_CODE_SESSION_ID: session, CLAUDE_CONFIG_DIR: configDir }`, `now: new Date()` and `tmpdir: flags.tmpdir || os.tmpdir()`, and the shipped `readPointer` with the same `tmpdir`. Exit 0 printed, 1 usage.

- [ ] **Step 1: Write the failing tests**: over a fixture store (pointer + transcript from `captured-a.json`) prints `answer.answer === 'typed'`; from `captured-g.json` prints `none`/`not-typed`; output never contains the string `<command-message>`; missing `--session` → exit 1.
- [ ] **Step 2: Run** `node --test tests/typed-command-probe/cli.test.js` — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `Add the typed-command probe tool — refs #5584`.

### Task 10: Settle step 6 reads live labels

**Files:**
- Modify: `plugin/skills/dispatch/settle-and-merge.md` (step 6, around line 239)
- Create: `tests/dispatch-settle-ceiling-live-labels.test.js`

- [ ] **Step 1: Write the failing test** (AC16; read `.claude/skills/skill-prose-conformance-tests` and `.claude/skills/prose-code-twin-pin` first): it extracts step 6's text and asserts it says to read the record's live labels and remove only the grant labels present (pin the exact phrases you write); a go-red control asserts the base commit's step-6 text (`git show` of the base, or an inline copy) fails the same check; `fs.statSync(file).size <= 50974`.
- [ ] **Step 2: Run** `node --test tests/dispatch-settle-ceiling-live-labels.test.js` — Expected: FAIL.
- [ ] **Step 3: Reword step 6**: read the live labels (`gh issue view {n} --json labels`), then pass only the `auto:*` grant labels actually present to one `--remove-label` each (a typed run may carry none), then add `bot:blocked`. Remove at least as many bytes elsewhere in the file as you add.
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `Read live labels before Settle's ceiling strips grants — refs #5584`.

### Task 11: Dispatch prose and the reason table

**Files:**
- Modify: `plugin/skills/dispatch/SKILL.md` (lines 82, 133, 187, 189; 412 bytes of headroom under the 52,500 rail, and AC13 caps it at its base 52,088)
- Modify: `plugin/skills/dispatch/queue-pull-notes.md` (13,059 bytes)
- Modify: `plugin/skills/dispatch/resume.md` (one sentence: a typed `resume #N` stands in for `auto:build`)
- Modify: `plugin/skills/_shared/headless-self-report.md` (lines 6–11, 94)
- Test: `tests/dispatch-typed-authority-reasons.test.js` (new: pins `queue-pull-notes.md`'s reason table first column to `REASONS`, with a go-red control, AC19.2)
- Test: `tests/dispatch-queue-pull-cutover-prose.test.js` (unchanged; must stay green — its pinned sentence is not edited)
- Test: `tests/dispatch-named-form-exclusion-reasons.test.js` (unchanged; must stay green — its pinned reason lists are kept)
- Waived `plugin/skills/dispatch/queue-pull-script.md`: read only — the spec says the retained script gets no `--named`; Step 3 leaves it untouched.
- Waived `plugin/bin/lib/skill-audit/budgets.js`: read only — `RAIL_BYTES` (52,500) is the rail Step 1's size assertions sit under.
- Behavior-change sweep (Step 3 ends with it): `git grep -n -i -e "always run with a human present" -e "currently carries \`auto:build\`" -e "no \`auto:build\` grant" -e "Naming a record on the command line is not authorization" -e "lacks auto:build" -- plugin docs` — every hit is either reworded here or in Task 12, or recorded in Task 14's notes as unchanged with a reason.

- [ ] **Step 1: Write the failing pin test**: parses the table under a `## Typed command` heading in `queue-pull-notes.md`, asserts its first-column words equal `require('plugin/bin/lib/issues/build-authority.js').REASONS`; control: the same parser over a copy with one word dropped must fail the equality; asserts `SKILL.md` size ≤ 52,088.
- [ ] **Step 2: Run** it — Expected: FAIL.
- [ ] **Step 3: Edit prose.** SKILL.md Step 2: add, in a sentence **after** the pinned `queue-pull.js" --transport gh` sentence (it must stay byte-identical — `tests/dispatch-queue-pull-cutover-prose.test.js`), that the `#N`/`#N,#M,…` forms add `--named <the numbers> --run "$RUN_ID"`. The `#N` bullet: drop "currently carries `auto:build`"; a named record absent from the pool is reported with the CLI's line (`queue-pull-notes.md`'s Typed command section). The list bullet: "no `auto:build` grant" becomes "the queue pull's typed-command line". Line 82 and headless-self-report: replace "always run with a human present" with what is now checked (the typed-command check, `queue-pull-notes.md`). Keep `tests/dispatch-named-form-exclusion-reasons.test.js`'s pinned reason lists intact. Pay every added byte in SKILL.md by trimming elsewhere in SKILL.md. queue-pull-notes.md: a `## Typed command` section — when the line prints, the reason table (word | meaning | remedy, the 21 words), and that a typed command writes no label.
- [ ] **Step 4: Run** the pin test plus `node --test tests/dispatch-*.test.js` — Expected: PASS.
- [ ] **Step 5: Commit** `Document the typed-command build authority in dispatch — refs #5584`.

### Task 12: Docs

**Files:**
- Modify: `plugin/skills/_shared/work-record.md` (see below)
- Modify: `docs/driver.md` (see below)
- Modify: `docs/superpowers/specs/2026-11-11-pipeline-driver-design.md` (see below)
- Waived `skills/hub/reference/contract.md`: lives in `thn-inc/claude-user-config`; cited by name in `docs/hooks.md`, not edited.
- Modify: `docs/hooks.md` (second writer + `dispatch-prompts.json`; the six-case probe table from `work/5584-probe.md` with Claude Code 2.1.325, each row's marker fields and verdict; the probe steps for a re-run after an upgrade; the transcript fields the check reads, "as observed on the probed versions, not a documented contract"; `CC_LAUNCHED_BY` values `user`/`hub`, owner `skills/hub/reference/contract.md` in `thn-inc/claude-user-config`; the three not-stopped cases from the spec's "What this guards against" in those terms; the launch-line sentence: "the transcript cannot tell a launch line from a typed line; condition 4 is then the only refusal for a launcher"), `docs/driver.md` (when a typed command stands in for the label, writes no label, the state table, the three callers, the launcher-must-not-give-a-terminal sentence), `plugin/skills/_shared/work-record.md` (Grant semantics: a typed command stands in for `auto:build` for that run only, writes no label; a record being built may carry no `auto:*` label), `docs/superpowers/specs/2026-11-11-pipeline-driver-design.md` (Eligibility bullet and call 8 rewritten to the new rule, citing #5584)
- Test: none new; `npm test` impact selection covers doc conformance suites.

- [ ] **Step 1: Edit** the four files as listed.
- [ ] **Step 2: Run** `npm test`, output redirected to a file in the session scratchpad — Expected: PASS.
- [ ] **Step 3: Commit** `Document typed-dispatch build authority in hooks, driver and work-record docs — refs #5584`.

### Task 13: Live probe, Part 2 (orchestrator-run)

**Files:**
- Modify: `.claude-tweaks/pipelines/2026-11-16T015923-record-5584/work/5584-probe.md`

- [ ] **Step 1: Run the live probe through the shipped code.**
Proof(auth): the typed path is accepted only for a row Claude Code 2.1.325 marks `turnOrigin: "human"` and `origin.kind: "human"` in the command form for this record within 30 minutes, inside a session whose environment passes conditions 1–4; this step re-runs cases (a), (g), (h) with the shipped hook and `readTypedCommand` and must print `typed`, `not-typed`, `not-typed`, while Tasks 3 and 4 pin every other refusal with captured rows.

Runs after Tasks 4, 5 and 9. Reuse the scratch harness in the session scratchpad (`probe5584/run-case.exp`), with `--plugin-dir <worktree>/plugin` added to the claude argv and the scratch hook removed from `--settings` (the shipped hook writes the pointer). For (a), (g), (h): run the case, then `node tools/typed-command-probe.js --session <id> --record 3 --config-dir "$CLAUDE_CONFIG_DIR" --tmpdir "$TMPDIR"`. Expected: `typed` for (a), `not-typed` for (g) and (h). Any other result → the build ends BLOCKED with the capture; never change the check to make a case pass. Append the three outputs (marker fields only) to `work/5584-probe.md` and commit `Record the Part 2 probe through the shipped hook — refs #5584`.

### Task 14: Audit, backlog report and parked record (PR artifacts)

**Files:**
- Create: `.claude-tweaks/pipelines/2026-11-16T015923-record-5584/work/5584-pr-notes.md` (in the worktree; becomes PR body sections)
- Waived `plugin/bin/lib/issues/backlog.js`: read only — Step 2 runs its list code over a fixture; the spec says report, not change.
- Waived `plugin/bin/lib/dispatch/stuck-open-pr.js`: read only — a report-only grant reader (spec Sites paragraph); audited in Step 1.
- Waived `plugin/bin/lib/record-graph/encode.js`: read only — a report-only grant reader; audited in Step 1.
- Waived `plugin/bin/lib/reconcile/release-merged.js`: read only — a removal site audited in Step 1; a defect found is filed, not fixed.
- Waived `plugin/skills/build/plan-review.md`: read only — a removal site audited in Step 1 (it reads live labels first).

- [ ] **Step 1: Grant-label audit (AC21):** run `git grep -n -E "auto:build|grants\.build" -- plugin`; list every hit that removes a grant label or acts on a claimed record, each marked `reads live labels`, `best-effort per label`, `report only` or `fixed here`; rows for `release-claim.js --remove-grants`, `plugin/bin/lib/reconcile/release-merged.js`, Settle steps 3 and 6, `plugin/skills/build/plan-review.md`. A site outside the Key Files that would fail or mislead for a claimed ungranted record → file via `/claude-tweaks:capture` with a spec-shaped body and name it.
- [ ] **Step 2: Backlog report (AC17):** run `/claude-tweaks:backlog refine` and `attention` list code (`plugin/bin/lib/issues/backlog.js`, `pending-authorization.js`) over a fixture record with `ready`, no grant and an open linked PR via `node -e`; record what each lists; if either lists it for granting or rebuilding, file a follow-up via `/claude-tweaks:capture` and name it.
- [ ] **Step 3: Parked measurement record (AC14, Deliverable 9):** file via `/claude-tweaks:capture` as a parked record carrying the probe cases (a), (g), (h), (d) to re-run with `tools/typed-command-probe.js`, the `CC_LAUNCHED_BY` check (session a person launched vs `cc hub spawn`; type `/claude-tweaks:dispatch #N` for a `ready` record with no `auto:build`, then the same line via `cc hub spawn`), the expected result (`user`/`hub`; the first builds, the second prints the refusal line) and the wake condition (both releases installed). Record its number in the notes.
- [ ] **Step 4: Record** in the notes: which of (b), (c), (i) were accepted (all three, per `5584-probe.md`), the #5232 bound observation (not observed — #5232 not landed), and every Decision-rule choice the build made.
- [ ] **Step 5: Commit** `Add the PR notes for #5584 — refs #5584`.
