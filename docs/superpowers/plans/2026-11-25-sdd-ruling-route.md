# SDD Ruling Route Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route an SDD ruling the controller labels `Class: procedural` (and that defers nothing) to an audit line in `decisions.md` plus an `observation` ledger row, instead of a ratify/reverse Review Console row; everything else stays a console row (fail closed).

**Architecture:** The controller writes a `Class:` header line into each ruling's temp file. A pure function `sddRulingRoute(text)` in `plugin/bin/lib/console/sdd-ruling.js` (reusing its `readHeader`) returns `'audit'` only for a clean `Class: procedural` + `Defers: no` header; a thin CLI `plugin/bin/sdd-ruling-route.js` prints that verdict; `plugin/skills/build/dispatch.md`'s carry-forward runs the CLI and branches.

**Tech Stack:** Node 18+ CommonJS, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-11-25T092637-record-5449/work/5449-spec.md` (record #5449)

Scope keywords: sddRulingRoute, sdd-ruling-route

## Global Constraints

- Return values are exactly the strings `'audit'` and `'console'`; the CLI prints exactly `audit` or `console` (one trailing newline) and exits 0.
- CLI exits 1 when the `--file` path is unreadable, 2 on a malformed call; prints nothing to stdout in either case (AC4).
- `'audit'` only when the header (lines before the first blank line) has exactly one `Class:` line whose value is `procedural`, exactly one `Defers:` line whose value is `no`, and no `Defer-reason:` line. Every other header, and empty text, returns `'console'`.
- Header keys match case-insensitively and values compare lower-cased after trim, the same way `readHeader` already treats `Defers:`.
- The audit branch logs status `AUTO` (never `STAGED`: no staged artifact is written) and its ledger row status is `observation`.
- Governing skill `gh-api-module-pattern` / `cli-wrapper-contract.md`, quoted verbatim:
  - "It exports `run` and `realDeps`; `argv` is `process.argv.slice(2)`, and `run` returns an integer exit code or a Promise of one. The script entry is the file's last statement: `if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);`."
  - "Above the guard and in everything `run` calls there is no `process.exitCode`, `process.exit()`, `process.chdir()` or write to `process.env`. A relative path is resolved against `deps.cwd()`, never left to `path.resolve` or `fs`: a file path the unconverted CLI handed to `fs` as written takes an unnormalized join (`resolveAgainst(deps.cwd(), p)`, `plugin/bin/lib/health-core/io.js`)"
  - "Tests call the CLI through `tests/helpers/run-cli.js` (`runCli`, or `runCliSync` for a synchronous `run`), passing an absolute `cliPath`" … "each converted CLI keeps one or two `spawnCli` smoke tests for the script entry, shebang and exit code."
  - "*Payload-1/Invocation-2* (`plugin/bin/wrap-up-engine.js`, `plugin/bin/declined-learning.js`): 0 success, 1 the invocation was well-formed but the stdin/file payload was not (unparseable JSON, a payload that fails validation), 2 malformed invocation (missing/unknown flags, an unknown verb)." — this CLI joins that family (1 = unreadable `--file`); state it in the header comment and `USAGE`.
  - "A file the CLI is about to read is read directly with `ENOENT`/`ENOTDIR` caught as "absent", never checked for existence first"
- Governing skill `skill-prose-conformance-tests`, quoted verbatim: "Read governed markdown through `tests/helpers/read-skill.js`'s `readText()`, never a private `fs.readFileSync(p, 'utf8')`." and "Prove each assertion on a mutated copy of the live text instead: delete or alter only the pinned clause, then assert the shared assertion helper throws **with that assertion's own message** — `assert.throws(() => assertBlock(mutated), { message }, …)` — preceded by `assert.notEqual(mutated, original)` so a replace that matched nothing cannot pass as a control."
- Governing skill `prose-code-twin-pin`: the appendix's new `Class:` sentence restates the code's route rule; Task 3 pins the sentence's literals (`Class: behaviour`, `decisions.md`) — no table twin exists, so no equality pin applies.
- Size: `plugin/skills/build/dispatch.md` is 50,931 B against `RAIL_BYTES` 52,500 B (headroom 1,569 B). Task 3's addition must leave it at or under 52,500 B; if it lands over, cut words inside the new paragraph only. `plugin/skills/wrap-up/review-console-appendix.md` is 22,129 B (no pressure).

## Review Focus

1. A `Class:` line that appears only in the ruling body (after the first blank line) must not count — routes `console`. (Task 1 test)
2. A CRLF-terminated staged file with `Class: procedural` / `Defers: no` routes `audit` (Windows writers). (Task 1 test)
3. Mixed case and padding (`class:  Procedural `) is the same line as `Class: procedural` — routes `audit`; `Class:` with an empty value routes `console`. (Task 1 test)
4. A `Defer-reason:` header line with an empty value still forces `console`. (Task 1 test)
5. A `build-deviation-*` temp file is never routed — the prose must say the route runs for `sdd-ruling-{N}` only. (Task 3 prose pin)

---

### Task 1: `sddRulingRoute` route function

**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/console/sdd-ruling.js` (extend `readHeader`; add `sddRulingRoute`; export it)
- Modify: `plugin/bin/lib/console/resolve.js:14-16` (destructured import) and `:1074` (module.exports) — re-export `sddRulingRoute`
- Create: `tests/bin-lib/console/fixtures/sdd-ruling-route/spec-5162-sdd-ruling-9.md`, `spec-5162-sdd-ruling-16.md`, `spec-5162-sdd-ruling-31.md`, `spec-5161-sdd-ruling-3.md`
- Test: `tests/bin-lib/console/sdd-ruling-route.test.js`
- Waived `plugin/bin/lib/reconcile/console-execute.js`: Gotcha "no consumer rejects an unknown header key" — probed at plan time: it reads ruling headers only through `sdd-ruling.js`'s exports (line 41); Step 0 re-greps.
- Waived `plugin/bin/lib/wrap-up/pack.js`: same probe; its only `sdd-ruling` reference (line 535) defers to `sddRulingDeferralReason`.

**Interfaces:**
- Produces: `sddRulingRoute(text: string|null|undefined) -> 'audit'|'console'`, exported from `sdd-ruling.js` and re-exported by `resolve.js`. `readHeader(text)` additionally returns `classMatches: Array<[line, value]>` (same shape as `defersMatches`).

- [ ] **Step 0: Re-verify the Gotcha (no consumer rejects an unknown header key)**

Run: `git grep -n "sdd-ruling" -- plugin/bin/lib/reconcile/console-execute.js plugin/bin/lib/wrap-up/pack.js plugin/bin/lib/console/reference-repair.js plugin/bin/lib/console/resolve.js`
Expected: every header read of an `sdd-ruling-*` file goes through `sdd-ruling.js`'s exports (none enumerates allowed keys). If one does reject unknown keys, extend it in this task and add its file to **Files**.

- [ ] **Step 1: Copy the four fixtures verbatim from the local archive**

Sources (gitignored, maintainer machine): `/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/archive/2026-11-12T102742-spec-5160-5161-5162/spec-5162/staged/sdd-ruling-{9,16,31}.md` and `.../spec-5161/staged/sdd-ruling-3.md`. Copy bytes unchanged (`cp`) into the fixture names above. Do not add `Class:` to the files — the tests inject it.

- [ ] **Step 2: Write the failing tests** in `tests/bin-lib/console/sdd-ruling-route.test.js`

Helper: `withClass(text, line = 'Class: procedural')` inserts `line` as a new header line directly after the `Kind:` line (header = lines before the first blank line; preserve the file's line ending).

```js
test('AC1.1: the four archived procedural rulings route audit once Class: procedural is added', ...)
  // for each fixture: assert.strictEqual(sddRulingRoute(withClass(read(f))), 'audit')
test('AC1.2: the same four files without the added line route console', ...)
  // assert.strictEqual(sddRulingRoute(read(f)), 'console')
test('AC2.1: Class: procedural with Defers: yes routes console', ...)
  // fixture text with 'Defers: no' replaced by 'Defers: yes' + withClass → 'console' (assert the replace changed the text)
test('AC2.2: Class: procedural plus any Defer-reason line, two Class lines, Class: maybe, or no header routes console', ...)
  // withClass(t) + 'Defer-reason: genuinely-larger' header line → 'console'
  // withClass(withClass(t)) → 'console'; withClass(t, 'Class: procedural\nClass: behaviour') → 'console'
  // withClass(t, 'Class: maybe') → 'console'
  // '\nRuling body only\n' (no header) → 'console'; '' → 'console'; null → 'console'; undefined → 'console'
test('Class: behaviour routes console', ...)
test('a missing or duplicate Defers line routes console', ...)
  // header with Class: procedural and no Defers: line → 'console'; two 'Defers: no' lines → 'console'
test('review focus: a Class: line only in the body does not count', ...)
  // 'Kind: sdd-ruling\nDefers: no\n\nClass: procedural\n' → 'console'
test('review focus: CRLF header routes audit', ...)
  // 'Kind: sdd-ruling\r\nClass: procedural\r\nDefers: no\r\n\r\nbody\r\n' → 'audit'
test('review focus: key case and value padding are normalized; empty Class value routes console', ...)
  // 'class:  Procedural ' + 'DEFERS: No' → 'audit'; 'Class:' → 'console'
test('review focus: an empty Defer-reason header line forces console', ...)
  // withClass(t) + 'Defer-reason:' → 'console'
test('resolve.js re-exports sddRulingRoute', ...)
  // require resolve.js; assert.strictEqual(resolve.sddRulingRoute, sddRuling.sddRulingRoute)
```

- [ ] **Step 3: Run to verify they fail**

Run: `node --test tests/bin-lib/console/sdd-ruling-route.test.js`
Expected: FAIL — `sddRulingRoute is not a function`.

- [ ] **Step 4: Implement**

In `readHeader`, collect `classMatches` with `/^class:(.*)$/i` exactly as `defersMatches` is collected, and return it. Add `sddRulingRoute(text)`: `null`/`undefined`/blank → `'console'`; otherwise `'audit'` iff `classMatches.length === 1 && classMatches[0][1].toLowerCase() === 'procedural' && defersMatches.length === 1 && defersMatches[0][1].toLowerCase() === 'no' && reasons.length === 0`, else `'console'`. Add a comment naming #5449 and the prose twin (`wrap-up/review-console-appendix.md`'s `sdd-ruling-*` bullet, `build/dispatch.md`'s carry-forward). Export it; add it to `resolve.js`'s import and `module.exports`.

- [ ] **Step 5: Run to verify they pass, plus the module's existing suites**

Run: `node --test tests/bin-lib/console/sdd-ruling-route.test.js tests/bin-lib/console/sdd-ruling-ratify.test.js tests/bin-lib/console/resolve.test.js tests/build-sdd-ruling-deferral-gate.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/lib/console/sdd-ruling.js plugin/bin/lib/console/resolve.js tests/bin-lib/console/sdd-ruling-route.test.js tests/bin-lib/console/fixtures/sdd-ruling-route
git commit -m "Add sddRulingRoute — fail-closed audit/console route for SDD rulings, refs #5449"
```

### Task 2: `sdd-ruling-route.js` CLI

**Files:**
- Create: `plugin/bin/sdd-ruling-route.js`
- Test: `tests/bin-lib/console/sdd-ruling-route.test.js` (add CLI tests to Task 1's file)
- Waived `plugin/skills/_shared/auto-decision-log.md`: read only — its Status semantics fix `AUTO` (not `STAGED`) for the audit line, stated in Global Constraints.
- Waived `plugin/skills/_shared/ledger-format.md`: read only — its Writer section's `hooks.js ledger-row` is the audit row writer (Task 3), and `observation` is terminal and needs no Resolution.
- Modify: `docs/plugin-structure.md` — line 64's `sdd-ruling.js` description gains `sddRulingRoute` (#5449: `audit` only for one `Class: procedural`, one `Defers: no`, no `Defer-reason:`; else `console`); add a CLI line beside the `stage-item.js` line (~line 350): `node plugin/bin/sdd-ruling-route.js --file <path>   # SDD ruling route CLI (#5449) — prints audit or console for one staged ruling temp file (sddRulingRoute); exit 0 printed, 1 --file unreadable, 2 malformed invocation; read by build/dispatch.md's carry-forward`

**Interfaces:**
- Consumes: `sddRulingRoute` from Task 1 (`require('./lib/console/sdd-ruling')`).
- Produces: `module.exports = { run, realDeps, USAGE }`; `run(argv, deps) -> 0|1|2`; `realDeps = { stdout, stderr, cwd, readFile }` where `readFile(absPath) -> string` (`fs.readFileSync(p, 'utf8')`).

- [ ] **Step 1: Write the failing tests** (in-process via `runCliSync` from `tests/helpers/run-cli.js`, plus one `spawnCli` smoke test)

```js
test('CLI prints audit for a procedural fixture and exits 0', ...)   // write withClass(fixture) to a tmp file; stdout === 'audit\n', code 0
test('CLI prints console for an unmodified fixture and exits 0', ...) // stdout === 'console\n', code 0
test('CLI resolves a relative --file against cwd', ...)             // cwd: tmp dir, --file 'r.md'
test('AC4.1: CLI exits 1 on a missing --file path and 2 with no --file, printing nothing to stdout', ...)
  // --file <nonexistent> → code 1, stdout '', stderr non-empty
  // [] → code 2, stdout '', stderr includes 'usage:'
  // ['--file'] (no value) → 2; ['--bogus'] → 2
test('spawn smoke: script entry exits 0 and prints console', ...)    // spawnCli on an unmodified fixture
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/bin-lib/console/sdd-ruling-route.test.js`
Expected: FAIL — cannot find module `plugin/bin/sdd-ruling-route.js`.

- [ ] **Step 3: Implement `plugin/bin/sdd-ruling-route.js`**

Shebang, header comment (purpose, #5449, usage, the Payload-1/Invocation-2 exit family: 0 printed, 1 `--file` unreadable, 2 malformed), `USAGE = 'usage: sdd-ruling-route.js --file <path>\n'`. Parse: exactly one `--file <value>` (a missing value or one starting `--`, a repeated `--file`, or any other token → 2 with `USAGE` on stderr). Resolve the path with `fsPath(deps, p)` from `./lib/health-core/io` (reads `deps.cwd()` only for a relative path). Read directly in `try`; any read error → stderr `sdd-ruling-route.js: cannot read {arg}: {code}` and return 1 (no existence pre-check). Otherwise `deps.stdout(sddRulingRoute(text) + '\n')`, return 0. Last statement is the `require.main` guard quoted in Global Constraints.

- [ ] **Step 4: Run to verify they pass, plus the entry-contract scan**

Run: `node --test tests/bin-lib/console/sdd-ruling-route.test.js tests/bin-lib/cli-entry-conformance.test.js tests/path-guard-conformance.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/sdd-ruling-route.js tests/bin-lib/console/sdd-ruling-route.test.js docs/plugin-structure.md
git commit -m "Add sdd-ruling-route.js CLI — print a ruling's audit/console route, refs #5449"
```

### Task 3: Carry-forward routing prose, console prose twin, and conformance pin

**Review risk:** high

**Files:**
- Modify: `plugin/skills/build/dispatch.md` (the **Carry-forward commands (#3510).** paragraph and its fence, ~line 21-26)
- Modify: `plugin/skills/wrap-up/review-console-appendix.md` (the `apply` on an `sdd-ruling-*` item bullet, ~line 89)
- Create: `tests/build-sdd-ruling-route-carryforward.test.js`

**Interfaces:**
- Consumes: the CLI from Task 2 (`bin/sdd-ruling-route.js --file`), `bin/log-decision.js` (`--text-file`, `--step`, `--section`), `bin/hooks.js ledger-row` (`--item-file`, `--status observation`; observation needs no Resolution — `checkLedgerStatus`).

- [ ] **Step 1: Write the failing conformance test** `tests/build-sdd-ruling-route-carryforward.test.js`

Read both files with `readText` (`tests/helpers/read-skill.js`). Slice dispatch.md's carry-forward block from `**Carry-forward commands (#3510).**` to the end of the following fenced block. One helper `assertCarryForward(block)` with one message per assertion:

```js
test('AC5.1: the carry-forward names the route CLI, the console branch stage-item call and the audit branch log-decision AUTO call', ...)
  // block matches /bin\/sdd-ruling-route\.js" --file/            message 'route CLI'
  // block matches /bin\/stage-item\.js" .*--id "sdd-ruling-\{N\}"/ message 'console branch stage-item'
  // block matches /bin\/log-decision\.js" .*--status AUTO/        message 'audit branch log-decision'
  // block matches /ledger-row .*--status observation/             message 'audit branch ledger row'
  // block states the rubric: 'Class: procedural', 'Class: behaviour', and 'when in doubt' (ws-tolerant)
  // block states the route runs for sdd-ruling only (Review Focus 5): /`sdd-ruling-\{N\}` file/
  // block states the audit-failure fallback (plan review): ws('If either exits non-zero, run the `sdd-ruling-{N}` line unchanged')  message 'audit fallback'
test('AC5.1: each pinned clause can go red', ...)
  // for each of the first three: mutate the block (remove that token), assert.notEqual(mutated, block),
  // assert.throws(() => assertCarryForward(mutated), { message: '<that message>' })
test('console prose twin: the appendix sdd-ruling bullet names Class: behaviour and the decisions.md audit route', ...)
  // APPENDIX matches ws('`Class: behaviour`') and ws('never reach the console') and ws('`decisions.md`')
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/build-sdd-ruling-route-carryforward.test.js`
Expected: FAIL — `route CLI`.

- [ ] **Step 3: Edit `dispatch.md`'s carry-forward** — append to the paragraph, before the fence, this text (exact, it is the rubric the spec fixes):

> **Route procedural rulings (#5449).** Before staging an `sdd-ruling-{N}` file (never a `build-deviation-*` one), write one `Class:` line into its temp file's header: `Class: procedural` for dispatch sequencing, commit packing, fix-round placement, or implementer handoff or model choice, when the ruling changes nothing that ships and defers nothing; `Class: behaviour` for anything else, and when in doubt. Then run the route command (first line below). On `console` or any non-zero exit, run the `sdd-ruling-{N}` line unchanged. On `audit`, stage nothing: write `SDD ruling (procedural) carried as audit, not staged: {one-liner}` to `{line file}` with the Write tool, then run the last two lines — an `AUTO` decision and an `observation` ledger row. If either exits non-zero, run the `sdd-ruling-{N}` line unchanged.

and extend the fence to (route first, the two existing lines unchanged, then the two audit lines):

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/sdd-ruling-route.js" --file "{tmp}.md"
<existing sdd-ruling-{N} stage-item line, unchanged>
<existing build-deviation-{N} stage-item line, unchanged>
node "${CLAUDE_PLUGIN_ROOT}/bin/log-decision.js" --run "$PIPELINE_RUN_DIR" --status AUTO --section "/build" --text-file "{line file}"
node "${CLAUDE_PLUGIN_ROOT}/bin/hooks.js" ledger-row --run "$PIPELINE_RUN_DIR" --ledger "{ledger path}" --phase build --item-file "{line file}" --status observation
```

(The log-decision call is the spec's command exactly, no `--step`; `formatEntry` renders its default location, `AUTO {time} — log-decision: SDD ruling (procedural) carried as audit, not staged: {one-liner}. Reversibility: n/a.`)

Then run `wc -c plugin/skills/build/dispatch.md`; it must print ≤ 52500. Over → trim words inside the new paragraph only.

- [ ] **Step 4: Edit the appendix bullet** — after its first sentence ("… classified by `bin/lib/console/sdd-ruling.js`'s `sddRulingRatifyAction` (#3942):" keep the list intact), insert before the list a sentence: `A staged ruling's header may also carry `Class: behaviour`; a ruling the carry-forward labels `Class: procedural` (with `Defers: no` and no `Defer-reason:`) is never staged, so procedural rulings never reach the console — they are logged in `decisions.md` as an `AUTO` line and an `observation` ledger row (#5449, `sddRulingRoute`).`

- [ ] **Step 5: Run to verify it passes, plus neighbouring prose pins and the rail**

Run: `node --test tests/build-sdd-ruling-route-carryforward.test.js tests/build-sdd-ruling-deferral-gate.test.js tests/sdd-ruling-ratify-files-record-conformance.test.js tests/build-sdd-ledger-residue-carryforward.test.js`
Expected: PASS, 0 failures. Then `git grep -n -l "build/dispatch.md\|review-console-appendix.md" -- tests` and run every listed file not already run; expected PASS.

- [ ] **Step 6: Commit**

```bash
git add plugin/skills/build/dispatch.md plugin/skills/wrap-up/review-console-appendix.md tests/build-sdd-ruling-route-carryforward.test.js
git commit -m "Route procedural SDD rulings to an audit line in the carry-forward, refs #5449"
```

### Task 4: AC3 one-time archive check (scratch, evidence to the run dir)

**Files:**
- Waived `.claude-tweaks/pipelines/archive/2026-11-12T102742-spec-5160-5161-5162/`: read-only input (gitignored); nothing committed — AC3.3 says the check is not a committed test.

- [ ] **Step 1: Run the CLI over all 71 unmodified rulings (AC3.1)** — a scratchpad node script (not committed) that, for each `spec-516{0,1,2}/staged/sdd-ruling-*.md` under the archive, calls `node plugin/bin/sdd-ruling-route.js --file <path>` and tallies stdout/exit. Expected: 71 files, 71 × `console`, all exit 0.

- [ ] **Step 2: Injected copy (AC3.2)** — the same script copies each file to a scratch dir with `Class: procedural` inserted after `Kind:`, runs the CLI, and asserts every file whose header has `Defers: yes` prints `console`. Report counts: total, `Defers: yes` count, `audit` count.

- [ ] **Step 3: Record evidence (AC3.3)** — `mkdir -p "$PIPELINE_RUN_DIR/evidence"`; redirect the script's full output to `$PIPELINE_RUN_DIR/evidence/ac3-archive-replay.txt` (plain Bash redirect, absolute path); write one line (AC3 id + wording, command shape, counts) with the Write tool to a session temp file and log it via `log-decision.js --run "$PIPELINE_RUN_DIR" --section "/build" --status AUTO --step "AC evidence" --text-file {file}`, citing the evidence path. Append the counts to the PR body below the fixes block (AC3.3: "quoted in the PR body").

Waived AC3.1: scratch check by design (archive is gitignored) — Task 4 Step 1, evidence in the run dir.
Waived AC3.2: scratch check by design — Task 4 Step 2, evidence in the run dir.
Waived AC3.3: Task 4 Step 3 records the result and quotes it in the PR body; no committed test by the criterion's own terms.
Waived AC6.1: covered by build Common Step 5 and /test's full-suite verification, not a plan task.
