# Ledger-row CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the open-items ledger a sanctioned `hooks.js ledger-row` verb that appends one row or settles one row by number, under the ledger lock with a re-read and an atomic write, and point the build/review/wrap-up prose at it.

**Architecture:** The locked read-modify-write lives in `plugin/bin/lib/stage-item/ledger.js` beside `carryForward` (same `{run-dir}/.ledger.lock`, same `writeFileAtomic`, same table parser). `plugin/bin/hooks.js` gains a thin `ledger-row` verb that resolves the run dir (delete-ledger's unambiguous-only path), resolves/confines the ledger path (`resolveLedgerPath`), validates, and calls the lib. Prose names the verb once in `_shared/ledger-format.md`'s new Writer section and cites it from the writing sites.

**Tech Stack:** Node 18+ CommonJS, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-10-28T210237-record-4439/work/4439-spec.md`

**Scope keywords:** ledger-row, appendLedgerRow, ledgerLockPath

## Global Constraints

- Statuses: the closed enum is exactly `open`, `fixed`, `deferred`, `accepted`, `acknowledged`, `observation` (`_shared/ledger-format.md`); `resolved` and every other value is refused.
- Resolution-text requirements (spec, Deliverable 2): "`fixed` needs a commit or file ref; `deferred` needs origin, files and trigger".
- AC1 command, verbatim: `node plugin/bin/hooks.js ledger-row --ledger <path> --phase build --item "a | b" --status open` — no `--run`, so the verb must resolve the run implicitly from a linked worktree.
- Governing skill `hooks-js-verb-registration` (quoted): "A verb is not shipped until every row lands in the same change." Sites: "`VERBS` table in `plugin/bin/hooks.js` | One entry"; "`KNOWN_FLAGS` in `plugin/bin/hooks.js` | Only for a flag-strict verb … its declared flags. Update the two comments that describe the table's membership."; "`tests/hooks-help-guard.test.js` | Add the verb to the `runAccepting` list"; "`docs/hooks.md` | The anchored-`--run` paragraph: bump the spelled-out count … and insert the verb in the list. If the verb exits 1 on refusal, name it in the exit-code exception sentence beside `close-run` and `resolve-console`."; "`docs/plugin-structure.md`'s `plugin/bin/hooks.js` line | Add the verb to the subcommand list"; "`docs/hooks.md`'s implicit-resolution sentence … Only for a verb that resolves an omitted `--run` through `resolveRunArg`'s `unambiguousOnly` path: name it there." Decisions: "If a skill parses it, stdout carries only the machine-readable result. Notices … go to stderr through `reportWorktreeLocalFallback(runDir, flag, process.stderr)`."; "Flush before returning. `await new Promise((resolve) => process.stdout.write(line, resolve))`".
- Source-scan lint: no new `existsSync` / `realpathSync` token anywhere under `plugin/bin/` (`tests/path-guard-conformance.test.js` counts tokens per file against an exact allowlist). Read files with `fs.readFileSync` inside try/catch instead.
- Pipe rule pins (`tests/ledger-pipe-escape-rule-conformance.test.js`): `ledger/SKILL.md` and `review/step3-routing.md` must keep a line citing "`_shared/ledger-format.md`'s Format section" with a `` `|` `` on it, must never name `escapeLedgerCell`; `review/step3-routing.md`'s sentence " A finding whose text quotes a `|` is escaped per `_shared/ledger-format.md`'s Format section before its row is appended." stays byte-identical; `ledger-format.md` states the bold pipe rule exactly once.
- Rail: `plugin/skills/build/SKILL.md` is 50,160 B against `RAIL_BYTES` 52,500 (95.5%) — its edit adds under 120 B. Others have ample headroom (`ledger-format.md` 36,275; `review/step3-routing.md` 31,631; `ledger/SKILL.md` 14,355; `wrap-up/nothing-left-behind.md` 6,730; `build/operational-checklist.md` 4,875; `build/docs-sync.md` 2,567).

## Review Focus

1. A refused call (bad status, missing labels, unresolvable run, held lock) must leave the ledger byte-unchanged — Task 2's refusal tests compare bytes.
2. A `--item`/`--resolution` value with a raw newline must stay one table row (the lib collapses it, as `ledgerCell` already does) — Task 1 test `appendRow collapses a newline`.
3. `--row` naming a missing row, or a ledger whose table has duplicate numbers, refuses with nothing written — Task 1 tests.
4. A `--ledger` outside the run dir and worktree (or not named `*-ledger.md`/`ledger.md`) is refused, never written — Task 2 test `rejects a --ledger outside the run and worktree`.
5. A lock held by a live process makes the verb refuse (exit 1) rather than write unlocked — Task 2 test `AC1.1 lock`.

---

### Task 1: Locked append/settle in the ledger lib

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/stage-item/ledger.js`
- Test: `tests/bin-lib/stage-item/ledger.test.js`

**Interfaces:**
- Produces (all exported from `plugin/bin/lib/stage-item/ledger.js`):
  - `LEDGER_STATUSES: string[]` = `['open', ...TERMINAL_STATUSES]` (import `TERMINAL_STATUSES` from `../wrap-up/ledger-write`).
  - `ledgerLockPath(runDir: string): string` → `path.join(runDir, '.ledger.lock')`; `carryForward` switches to it (single source).
  - `checkLedgerStatus(status: string, resolution: string|null|undefined): string|null` → `null` when valid, else a refusal message. Rules: status not in `LEDGER_STATUSES` → message containing `invalid status '{status}'` and the enum joined by `, `; `fixed` → resolution must match a commit sha `/\b[0-9a-f]{6,40}\b/` or a file reference (a token containing `/`, or `name.ext` — `/[\w.-]+\/[\w./-]+|\b[\w-]+\.[A-Za-z][A-Za-z0-9]{0,5}\b/`), else message naming "a commit sha or file reference"; `deferred` → resolution must carry the case-insensitive labels `origin:`, `files:`, and `trigger:` or `revisit:`, else a message listing each missing label; `accepted` / `acknowledged` → non-empty resolution (a stated reason); `open` / `observation` → any.
  - `appendLedgerRow(ledgerText, { phase, item, status, resolution })` — existing function gains an optional `resolution` (default `—`), written through the existing `ledgerCell` (escapes `|`, collapses newlines); empty/blank resolution writes `—`. Existing callers unchanged.
  - `appendRow({ runDir, ledgerPath, phase, item, status, resolution }): { number }` — under `withLock(ledgerLockPath(runDir), fn, { failClosed: true })`: read the ledger (`fs.readFileSync`), `appendLedgerRow`, `writeFileAtomic`. Throws on unreadable ledger, no table, `LEDGER_UNSAFE`, or `LOCK_TIMEOUT`.
  - `settleRow({ runDir, ledgerPath, row, status, resolution }): { number }` — same lock/read/atomic write around `flipLedgerRow(text, { item: row, status, resolution })` (import from `../wrap-up/ledger-write`); throws what `flipLedgerRow` throws (missing row, non-terminal status, duplicates, malformed row).
  - Neither function calls `checkLedgerStatus` — the CLI validates first; the lib stays a writer.

- [ ] **Step 1: Write the failing tests** in `tests/bin-lib/stage-item/ledger.test.js` (reuse the file's `LEDGER_HEAD`; write ledgers into a `fs.mkdtempSync` dir whose `run/` subdir is the `runDir`):
  - `checkLedgerStatus refuses an out-of-enum status, naming the enum` — `checkLedgerStatus('resolved', 'x')` matches `/invalid status 'resolved'/` and `/open, fixed, deferred, accepted, acknowledged, observation/`.
  - `checkLedgerStatus fixed needs a commit sha or file ref` — `null` for `'abc123'`, `'Fixed in plugin/bin/x.js'`, `'see ledger.js'`; non-null for `'done'` and `''`.
  - `checkLedgerStatus deferred needs origin, files and trigger labels` — `null` for `'origin: SDD Task 1; files: a.js; trigger: when X ships'` and for `revisit:` in place of `trigger:`; for `'origin: x; files: y'` the message matches `/trigger:/` and not `/origin:/`.
  - `checkLedgerStatus accepted/acknowledged need a reason; open/observation do not` — `checkLedgerStatus('accepted', '')` non-null; `checkLedgerStatus('open', undefined)` and `checkLedgerStatus('observation', '')` are `null`.
  - `appendRow appends the next row with an escaped pipe and a resolution` — on a ledger holding `PRIOR_ROW`, `appendRow({ … phase: 'build', item: 'a | b', status: 'open' })` returns `{ number: 2 }`; the file's row 2 is `| 2 | build | a \| b | open | — |`; row 1 unchanged; `{runDir}/.ledger.lock` does not exist afterwards.
  - `appendRow collapses a newline in item and resolution` — item `'x\ny'`, status `fixed`, resolution `'abc1234\nmore'` → one line `| 2 | build | x y | fixed | abc1234 more |`.
  - `appendRow refuses a held lock (failClosed)` — create `{runDir}/.ledger.lock/.owner` containing `${process.pid}-held`, set `process.env.CLAUDE_TWEAKS_LOCK_WAIT_MS = '30'` (restore in `finally`), assert `appendRow` throws with `code === 'LOCK_TIMEOUT'` and the ledger bytes are unchanged.
  - `settleRow rewrites only the named row's Status and Resolution` — three-row ledger; `settleRow({ row: 3, status: 'fixed', resolution: 'abc123' })` → row 3 is `| 3 | {phase} | {item} | fixed | abc123 |`, rows 1–2 and the heading byte-identical.
  - `settleRow throws for a missing row and writes nothing` — `row: 9` throws `/no ledger row for item #9/`, bytes unchanged.
  - `carryForward locks ledgerLockPath(runDir)` — `assert.equal(ledgerLockPath('/r'), path.join('/r', '.ledger.lock'))`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/bin-lib/stage-item/ledger.test.js`
Expected: FAIL — `checkLedgerStatus is not a function` (and the other new names undefined).

- [ ] **Step 3: Implement** the Produces list above in `plugin/bin/lib/stage-item/ledger.js`; update the header comment to say the module also exports the plain-row writer behind `hooks.js ledger-row`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/bin-lib/stage-item/ledger.test.js`
Expected: PASS (all existing `carryForward` tests still pass).

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/stage-item/ledger.js tests/bin-lib/stage-item/ledger.test.js
git commit -m "Add locked appendRow/settleRow to the ledger lib — refs #4439"
```

### Task 2: `hooks.js ledger-row` verb and its registration set

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/hooks.js` (`VERBS`, `KNOWN_FLAGS` + its membership comment, `VALUE_FLAGS`, new `runLedgerRow`)
- Modify: `tests/hooks-help-guard.test.js:80` (`runAccepting` gains `'ledger-row'`)
- Modify: `docs/hooks.md:27` (count "fourteen" → "fifteen", list gains `ledger-row`; exit-code exception sentence gains `ledger-row`, which exits 1 on any refusal so its caller reads a refusal as a stop), `docs/hooks.md:56` (implicit-resolution sentence names `ledger-row`)
- Modify: `docs/plugin-structure.md:17` (subcommand list + one clause describing the verb) and `:39` (stage-item `ledger.js` entry names `appendRow`/`settleRow`/`checkLedgerStatus`)
- Create: `tests/hooks-ledger-row.test.js`

**Interfaces:**
- Consumes: Task 1's `checkLedgerStatus`, `appendRow`, `settleRow`, `LEDGER_STATUSES`; `resolveLedgerPath` from `./lib/wrap-up/ledger-write`; hooks.js's `resolveRunArg`, `renderCandidateRefusal`, `reportWorktreeLocalFallback`, `flagVal`, `ctxLib.readRunState`.
- Produces: `VERBS['ledger-row'] = { usage: 'ledger-row [--run <dir>] [--ledger <path>] (--phase <phase> --item <text> --status <status> [--resolution <text>] | --row <n> --status <status> --resolution <text>)', run: runLedgerRow }`; `KNOWN_FLAGS['ledger-row'] = ['--run', '--ledger', '--phase', '--item', '--status', '--resolution', '--row']`; `VALUE_FLAGS` gains `'--item'`, `'--resolution'`, `'--row'` (`--phase`, `--status`, `--ledger` are already there).
- CLI contract: stdout on success is exactly one line, `claude-tweaks: ledger-row: appended row #{n} to {ledger path}` or `claude-tweaks: ledger-row: settled row #{n} in {ledger path}`, exit 0. Every refusal writes one `claude-tweaks: ledger-row: … — nothing written` line (or the run-resolution refusals below) to **stderr**, nothing to stdout, and exits **1**; the ledger is never touched on a refusal.

`runLedgerRow(argv)` order (async, returns the exit code):
1. `resolveRunArg(argv.slice(3), process.cwd(), process.env, { unambiguousOnly: true, callerIdentity })`; `reportWorktreeLocalFallback(runDir, worktreeLocalFallback, process.stderr)`. `invalidRunArg` → `claude-tweaks: --run path rejected: {x} — nothing written`; `candidates` → `renderCandidateRefusal('ledger-row', candidates)`; no `runDir` → `claude-tweaks: no pipeline run dir found — nothing written`. Each exits 1.
2. Mode: `--row` present → settle (requires `^\d+$` row and `--status`; refuses `--phase`/`--item` alongside it); else append (requires non-empty `--phase`, `--item`, `--status`). A flag given with no value refuses.
3. `checkLedgerStatus(status, resolution)` → its message as the refusal. In settle mode, `open` refuses: `--row settles to a terminal status; open is not one`.
4. `worktree = ctxLib.readRunState(runDir)?.worktree || process.cwd()`; `resolveLedgerPath({ runDir, worktree, explicit: ledgerArg ? path.resolve(process.cwd(), ledgerArg) : null })`; `!ok` → refusal naming `reason`, `detail` and candidates.
5. `appendRow` / `settleRow` in try; a thrown error → `claude-tweaks: ledger-row: {message} — nothing written`, exit 1 (`LOCK_TIMEOUT` message adds `— retry`).
6. Flush stdout with `await new Promise((resolve) => process.stdout.write(line, resolve))`.

- [ ] **Step 1: Write the failing tests** in `tests/hooks-ledger-row.test.js` — spawn `node plugin/bin/hooks.js` with `spawnSync` (`env: { ...process.env, PIPELINE_RUN_DIR: '' }`), assert `status`, `stdout`, `stderr` separately. Fixture helper: a temp git repo (`git init -q --initial-branch=main`, one seed commit, like `tests/delete-ledger-verb.test.js`'s `gitRoot`), a linked worktree `git worktree add -q {tmp}/wt -b feat`, a run dir `{root}/.claude-tweaks/pipelines/2026-10-28T000000-spec-1/` whose `run-state.json` is written by the real writer — `node plugin/bin/hooks.js record-worktree --run {runDir} {wt}` after seeding `{"status":"active"}` — and a ledger at `{wt}/docs/plans/2026-10-28-x-ledger.md` holding `LEDGER_HEAD`.
  - `AC1.1: from a linked worktree, ledger-row appends one row keeping the escaped pipe` — cwd `{wt}`, args `['ledger-row', '--ledger', ledger, '--phase', 'build', '--item', 'a | b', '--status', 'open']` (no `--run`); exit 0; stdout `claude-tweaks: ledger-row: appended row #1 to …`; ledger's only row is `| 1 | build | a \| b | open | — |`.
  - `AC1.1 lock: a held ledger lock refuses and writes nothing` — pre-create `{runDir}/.ledger.lock/.owner` = `${process.pid}-held`, env `CLAUDE_TWEAKS_LOCK_WAIT_MS=30`; exit 1, stderr matches `/lock/`, stdout empty, ledger bytes unchanged.
  - `AC2.1: --row 3 --status fixed --resolution abc123 rewrites only row 3's Status and Resolution` — three open rows seeded; args `['ledger-row', '--run', runDir, '--ledger', ledger, '--row', '3', '--status', 'fixed', '--resolution', 'abc123']`; exit 0; row 3 = `| 3 | build | three | fixed | abc123 |`; every other line byte-identical.
  - `AC2.2: --status resolved exits non-zero naming the enum` — append args with `--status resolved`; exit 1; stderr matches `/open, fixed, deferred, accepted, acknowledged, observation/`; ledger unchanged.
  - `AC3.1: two concurrent appends from two child processes take distinct row numbers` — launch two `spawn` children together (each `--run runDir --ledger ledger --phase build --item item-{i} --status open`), await both `close` events; both exit 0; the ledger holds exactly rows `1` and `2`, one per item.
  - `refuses deferred without origin/files/trigger labels` — exit 1, stderr names the missing label(s), ledger unchanged.
  - `rejects a --ledger outside the run and worktree` — a `*-ledger.md` in another `mkdtemp` dir; exit 1; that file unchanged.
  - `refuses --row together with --item` — exit 1, ledger unchanged.
  - `--help prints the usage line` — `['ledger-row', '--help']` exit 0, stdout contains `ledger-row [--run <dir>]`.
  Also add `'ledger-row'` to `runAccepting` in `tests/hooks-help-guard.test.js:80`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/hooks-ledger-row.test.js`
Expected: FAIL — the AC1.1 test sees exit 1 with `unknown subcommand`-style usage output instead of an appended row.

- [ ] **Step 3: Implement** `runLedgerRow` and the registration rows above in `plugin/bin/hooks.js`; update the two `KNOWN_FLAGS` membership comments to name `ledger-row` among the flag-strict verbs; edit `docs/hooks.md` and `docs/plugin-structure.md` as listed in Files.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/hooks-ledger-row.test.js tests/hooks-help-guard.test.js tests/hooks-dispatcher.test.js tests/delete-ledger-verb.test.js tests/path-guard-conformance.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/hooks.js tests/hooks-ledger-row.test.js tests/hooks-help-guard.test.js docs/hooks.md docs/plugin-structure.md
git commit -m "Add hooks.js ledger-row verb for plain ledger appends and settles — refs #4439"
```

### Task 3: Name the writer and point the writing prose at it

**Role:** integration

**Files:**
- Modify: `plugin/skills/_shared/ledger-format.md` — new `### Writer` subsection between "### De-duplication on Append" and "## Status Lifecycle"; one sentence appended to the Resolve Gate's "### Phase 3 — Apply user decisions" opening paragraph: every status update in this phase is written with `ledger-row --row {N}` (this file's Writer section).
- Modify: `plugin/skills/ledger/SKILL.md` — Add Item: one line naming the verb; Pipes bullet keeps its citation line and adds that `hooks.js ledger-row` escapes the pipe itself, so pass it raw text; Update Item: one sentence naming `ledger-row --row {N}`.
- Modify: `plugin/skills/build/SKILL.md:262` — "(see `/claude-tweaks:ledger`)" → "(`hooks.js ledger-row`, `_shared/ledger-format.md`'s Writer section)".
- Modify: `plugin/skills/build/operational-checklist.md:22`, `plugin/skills/build/docs-sync.md:19` — the append instruction names `hooks.js ledger-row` (Writer section).
- Modify: `plugin/skills/review/step3-routing.md:63` (append "before composing the staged patch" names the verb, whose stdout carries the row number the patch's `Ledger:` field needs) and `:154` (writes and the `fixed` update go through `ledger-row`); the pinned pipe sentence on line 67 untouched.
- Modify: `plugin/skills/wrap-up/nothing-left-behind.md:51` — "update status to `acknowledged`" names `ledger-row --row {N}`.
- Create: `tests/ledger-row-writer-conformance.test.js`

Writer section content (the implementer words it; it must carry each of these):
- the two command shapes, with `node "${CLAUDE_PLUGIN_ROOT}/bin/hooks.js" ledger-row` and every flag of `VERBS['ledger-row'].usage`;
- that it runs under `{run-dir}/.ledger.lock`, re-reads the ledger and writes it atomically, and that Item/Resolution text is passed raw (the verb escapes `|`; pre-escaping double-escapes);
- that it refuses (exit 1, nothing written) a status outside the closed enum and a Resolution missing its requirement: `fixed` a commit sha or file path, `deferred` the `origin:`, `files:` and `trigger:` (or `revisit:`) labels, `accepted`/`acknowledged` a reason;
- that an omitted `--ledger` resolves per this file's resolution rule, and a row paired with a staged proposal goes through `bin/stage-item.js --ledger` instead.
It must not restate the bold pipe rule (pinned to appear once) and must not exceed one paragraph plus the two command lines.

**Interfaces:**
- Consumes: Task 2's `VERBS['ledger-row'].usage` (the conformance test reads it via `require('../plugin/bin/hooks.js').VERBS`).

- [ ] **Step 1: Write the failing conformance test** `tests/ledger-row-writer-conformance.test.js` with one shared helper `assertWriterSites({ format, ledgerSkill, build, routing, wrapUp })` that asserts: `format` has a `### Writer` heading whose section contains `hooks.js" ledger-row` and every `--flag` token parsed from `VERBS['ledger-row'].usage`, plus `.ledger.lock`; each of `ledgerSkill`, `build`, `routing`, `wrapUp` contains `ledger-row`. Tests: `writer section names the verb with its full flag set and the citing sites point at it` (real files); go-red control `helper throws when --resolution is removed from a copy of the Writer section` (same helper, mutated `format`, `assert.throws` with `/--resolution/`).

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/ledger-row-writer-conformance.test.js`
Expected: FAIL — no `### Writer` section in `ledger-format.md`.

- [ ] **Step 3: Edit the prose** as listed in Files. Before editing, `git grep -n -F '{phrase}' -- tests plugin` two distinctive phrases from each edited sentence; a hit in `tests/` is a pin to keep satisfied.

- [ ] **Step 4: Run the affected suites**

Run: `node --test tests/ledger-row-writer-conformance.test.js tests/ledger-pipe-escape-rule-conformance.test.js tests/skill-size-single-source.test.js`
Expected: PASS. Then `wc -c plugin/skills/build/SKILL.md` prints a value below 52500.

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/_shared/ledger-format.md plugin/skills/ledger/SKILL.md plugin/skills/build/SKILL.md plugin/skills/build/operational-checklist.md plugin/skills/build/docs-sync.md plugin/skills/review/step3-routing.md plugin/skills/wrap-up/nothing-left-behind.md tests/ledger-row-writer-conformance.test.js
git commit -m "Point ledger-writing prose at hooks.js ledger-row — refs #4439"
```

Waived AC4.1: `npm test` passes — covered by `/build` Common Step 5's full-suite verification and the `/test` gate, not by a task test.
