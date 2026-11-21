# Deferral Route CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A read-only CLI, `plugin/bin/deferral-route.js`, over one pure function that decides whether a legitimately-deferred item is filed as a record or appended to the digest, reproducing `plugin/skills/_shared/materiality-floor.md`'s rule exactly.

**Architecture:** `plugin/bin/lib/deferral-route/route.js` exports a pure `routeDeferral(input)` evaluating six ordered clauses; the CLI parses flags, refuses malformed input as data, calls the function, prints one JSON line. A test pins the function to an independent oracle over every combination, and byte-pins the floor and override prose so the two cannot drift.

**Tech Stack:** Node 18+ CommonJS, `node --test`, no dependencies.

**Spec:** `.claude-tweaks/pipelines/2026-11-19T070031-spec-5930-5931-5932-5933/spec-5930/work/5930-spec.md`

Scope keywords: deferral-route, routeDeferral

## Global Constraints

- Verdicts are exactly `file`, `digest`, `refused`. Rules are exactly `refused`, `human`, `severity`, `tangential`, `not-low`, `floor`, evaluated in exactly that order; the first that applies decides. `digest` is only ever `floor`.
- `digest` only when the item is agent-raised, all three axes are `low`, the reason is not `tangential` and the severity is neither `high` nor `critical`; otherwise `file`.
- An axis value that is absent or not one of `low`, `medium`, `high` counts as not low, never as refused. Only the exact string `low` is low (`Low` is not low).
- An absent `--severity` is valid and counts as not high. A `--severity` present but not exactly one of `critical`, `high`, `medium`, `low`, `info` is refused.
- Import `DEFER_REASONS` from `plugin/bin/lib/issues/record.js`; never retype the list. Import `SEVERITIES` from `plugin/bin/lib/tiebreak.js` (the code twin of `plugin/skills/review/step3-tiebreak.md` line 57); never retype it.
- `clearsFloor` in `plugin/bin/lib/issues/autonomy.js` is a different floor. Do not merge the two or reuse its name.
- The CLI writes nothing and makes no `gh` call. Output keys, `verdict`/`rule` vocabularies and exit codes only grow.
- Exit codes: 0 for `file` and `digest` (and `--help`); 2 for `refused`, whose JSON is also on stdout. No exit 1. State this in the file header comment and `USAGE`.
- Governing skill `.claude/skills/gh-api-module-pattern/cli-wrapper-contract.md`, quoted verbatim:
  - "Logic lives in an exported `run(argv, deps)`; every side effect (`runner`, `ghAvailable`, `remoteUrl`, `stdout`, `stderr`) goes through `deps` so tests inject fakes."
  - "It exports `run` and `realDeps`; `argv` is `process.argv.slice(2)`, and `run` returns an integer exit code or a Promise of one. The script entry is the file's last statement: `if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);`."
  - "`require.main === module` guard sets `process.exitCode = run(...)` (never `process.exit`, which can truncate piped stdout). `--help` short-circuits before any availability probe."
  - "A value-taking flag given as the last argv element reads `undefined`, and a `!== null` presence check treats that as supplied." — validate the value inside `parseArgs`.
  - "Every malformed-input class must actually reach its malformed code".
- Governing skill `.claude/skills/skill-prose-conformance-tests/SKILL.md`, quoted verbatim:
  - "Read governed markdown through `tests/helpers/read-skill.js`'s `readText()`, never a private `fs.readFileSync(p, 'utf8')`."
  - "Slice with `tests/helpers/conformance-asserts.js`'s `sectionOf(text, '## Heading')` and `lineStartingWith(text, prefix)` instead of writing another local copy".
  - Decision Framework row: "A table or list that restates a data structure living in code | Read it live and pin it against that structure; say so in a header comment, citing `[IL-80]` and why this is the carve-out".
  - "Prove the assertion can go red before trusting its green: negate the prose and assert the regex *fails*, one claim per test."
- No other `.claude/skills/` rule names these files; `docs/plugin-structure.md` entries wrap onto continuation lines (`tests/helpers/plugin-structure-entry.js`) — keep the new command line one entry.

## Review Focus

1. A value-taking flag as the last argv token (`... --agent-raised --size`) → `refused`, reason `--size needs a value`, exit 2; never a throw.
2. A value token that is itself a flag (`--size --risk low`) → `refused`, `--size needs a value` (a value starting with `--` is a missing value).
3. An axis value differing only in case (`--risk Low`) → `file`, rule `not-low`; never `digest`, never refused.
4. Empty values: `--defer-reason ""` → `refused`; `--severity ""` → `refused`; `--size ""` → `file`/`not-low`.
5. A repeated bare flag (`--agent-raised --agent-raised`) → `refused`, `--agent-raised given more than once`.

---

### Task 1: The routing function and its exhaustive rule test

**Role:** judgment
**Review risk:** high

**Files:**
- Create: `plugin/bin/lib/deferral-route/route.js`
- Test: `tests/bin-lib/deferral-route/route.test.js`

**Interfaces:**
- Produces: `routeDeferral({ deferReason, severity, size, priority, risk, agentRaised }) -> { verdict: 'file'|'digest'|'refused', rule: string, reason?: string }` (`reason` present only on `refused`); exported constants `VERDICTS` (frozen `['file','digest','refused']`), `RULES` (frozen `['refused','human','severity','tangential','not-low','floor']`).
- Consumes: `DEFER_REASONS` from `plugin/bin/lib/issues/record.js`; `SEVERITIES` from `plugin/bin/lib/tiebreak.js`.

Clause semantics, in order:
1. `refused` — `deferReason` missing (`undefined`/`null`), or not in `DEFER_REASONS`; or `agentRaised` not a boolean; or `severity` neither `undefined`/`null` nor in `SEVERITIES`. Reasons (exact text): `--defer-reason is required; one of: {list}`, `--defer-reason "{value}" is not one of: {list}`, `exactly one of --agent-raised or --human is required`, `--severity "{value}" is not one of: {list}` — `{list}` is the array joined with `, `. Check order within the clause: reason, origin, severity (first failing check names the reason).
2. `human` — `agentRaised === false` → `file`.
3. `severity` — severity `high` or `critical` → `file`.
4. `tangential` — `deferReason === 'tangential'` → `file`.
5. `not-low` — any of `size`, `priority`, `risk` `!== 'low'` → `file`.
6. `floor` → `digest`.

- [ ] **Step 1: Write the failing tests** in `tests/bin-lib/deferral-route/route.test.js`:
  - `AC7.1 exhaustive: every combination matches the oracle and stays in the three verdicts` — enumerate the seven `DEFER_REASONS` (assert `DEFER_REASONS.length === 7` first) × `agentRaised` `true`/`false` × each axis in `['low', 'medium', 'high', undefined]` × severity in `[...SEVERITIES, undefined]` (7×2×64×6 = 5376 cases; assert the count). For each, `assert.deepStrictEqual(routeDeferral(c), oracle(c))` comparing `verdict` and `rule`, and assert `VERDICTS.includes(result.verdict)`. `oracle` is written in the test from the prose, never by importing or copying `route.js`: compute `const digestible = c.agentRaised && c.size === 'low' && c.priority === 'low' && c.risk === 'low' && c.deferReason !== 'tangential' && !['high','critical'].includes(c.severity)`; verdict is `digestible ? 'digest' : 'file'`; rule is `'digest' → 'floor'`, else the first of `!c.agentRaised → 'human'`, high/critical → `'severity'`, tangential → `'tangential'`, else `'not-low'`.
  - `vocabularies: SEVERITIES is the five finding severities` — `assert.deepStrictEqual([...SEVERITIES], ['critical','high','medium','low','info'])`.
  - `AC10.1 rule order: tangential at severity high reports severity` — `{deferReason:'tangential', severity:'high', size:'low', priority:'low', risk:'low', agentRaised:true}` → `{verdict:'file', rule:'severity'}`.
  - `AC10.2 rule order: a bad reason is refused before severity` — same input with `deferReason:'not-a-reason'` → `verdict:'refused', rule:'refused'`, reason contains `"not-a-reason"` and `pre-existing-outside-diff`.
  - `AC10.3 rule order: human with a bad reason is refused` — `agentRaised:false, deferReason:'not-a-reason'` → `refused`.
  - `refused: missing reason, non-boolean agentRaised, bad severity` — three cases, each asserting the exact reason text from the clause list above (`High` and `urgent` for severity; `''` too).
  - `not-low: case-variant and garbage axis values file` — `risk:'Low'` and `risk:'zzz'` with other axes low → `{verdict:'file', rule:'not-low'}`.
  - `prose pin: floor and overrides sentences are byte-equal to materiality-floor.md` — header comment cites `[IL-80]`: `route.js` is the authority and the prose its explanation, so reading the live file is the carve-out. Read `plugin/skills/_shared/materiality-floor.md` with `readText`; take `sectionOf(text, '## The floor')` and `sectionOf(text, '## Overrides')`; assert each equals a frozen constant in the test copied verbatim from the file at base commit `05a65b7353` (lines 11-20 for `## The floor` including the heading, lines 22-32 for `## Overrides`; reproduce `sectionOf`'s exact slice boundaries — print them once to get the bytes). Factor the comparison into `assertProsePinned(text)`.
  - `prose pin go-red: deleting the risk axis from the floor fails the pin` — mutate the live text in memory (`text.replace('AND `risk:low`', '')`, assert the replace changed something) and `assert.throws(() => assertProsePinned(mutated))`; a second control deletes the `tangential` override bullet's first line and asserts the same throw.

- [ ] **Step 2: Run and see it fail**

Run: `node --test tests/bin-lib/deferral-route/route.test.js`
Expected: FAIL — `Cannot find module '../../../plugin/bin/lib/deferral-route/route'`.

- [ ] **Step 3: Implement `routeDeferral` and the two constants** in `plugin/bin/lib/deferral-route/route.js`, a pure module (no `fs`, no `process`, no `child_process`), header comment naming the clause order and that `materiality-floor.md` is its explanation.

- [ ] **Step 4: Run and see it pass**

Run: `node --test tests/bin-lib/deferral-route/route.test.js`
Expected: PASS, every test.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/deferral-route/route.js tests/bin-lib/deferral-route/route.test.js
git commit -m "Add the deferral routing function — one code home for the materiality floor (#5930)"
```

### Task 2: The CLI, its tests, and its docs entry

**Role:** integration
**Review risk:** high

**Files:**
- Create: `plugin/bin/deferral-route.js`
- Test: `tests/deferral-route-cli.test.js`
- Modify: `docs/plugin-structure.md` (the `node plugin/bin/...` command list, beside the `resolve-blockers.js`/`materialize.js` lines around 376-408)

**Interfaces:**
- Consumes: `routeDeferral`, from Task 1.
- Produces: `run(argv, deps) -> 0|2`, `realDeps` (`{ stdout, stderr }` only), `parseArgs(argv)`, `USAGE`. Output: one JSON line on stdout, keys `verdict`, `rule`, `reason` (refused only), `input` — `{deferReason, severity, size, priority, risk, agentRaised}`, absent values `null`, `agentRaised` `true` for `--agent-raised`, `false` for `--human`, `null` when neither or both. On `refused` also one stderr line: the `reason` text.

Flag rules (`parseArgs`): value flags `--defer-reason --severity --size --priority --risk` take exactly the next token; a missing next token or one starting with `--` → reason `--{flag} needs a value`. Bare flags `--agent-raised`, `--human`. A flag seen twice → `--{flag} given more than once`. Both `--agent-raised` and `--human` → `exactly one of --agent-raised or --human is required` (the same text the function uses for neither). Any other token → `unknown flag {token}; accepted: --defer-reason, --severity, --size, --priority, --risk, --agent-raised, --human, --help`. `--help`/`-h` prints `USAGE` to stdout and exits 0 before anything else. A parse refusal prints `{verdict:'refused', rule:'refused', reason, input}` with whatever was parsed so far, exit 2. Otherwise call `routeDeferral` with absent flags as `undefined` and print.

- [ ] **Step 1: Write the failing tests** in `tests/deferral-route-cli.test.js`, in-process through `tests/helpers/run-cli.js`'s `runCliSync` (absolute CLI path), parsing the single stdout line as JSON:
  - `AC1.1 floor digests` — `--defer-reason pre-existing-outside-diff --size low --priority low --risk low --agent-raised` → exit 0, `digest`/`floor`, and `input` equals `{deferReason:'pre-existing-outside-diff', severity:null, size:'low', priority:'low', risk:'low', agentRaised:true}` (the spec's example line).
  - `AC2.1 risk medium files` → `file`/`not-low`; `AC2.2 priority omitted files` → `file`/`not-low`.
  - `AC3.1 tangential files` → `file`/`tangential`.
  - `AC4.1 severity high files`, `AC4.2 severity critical files` → `file`/`severity`; `AC4.3 severity medium digests` → `digest`/`floor`.
  - `AC5.1 human files whatever the flags` — `--human` with all axes low and a valid reason → `file`/`human`.
  - `AC6.1 unknown reason refused` — `--defer-reason not-a-reason --agent-raised` → exit 2, `refused`, `reason` names `"not-a-reason"` and contains every `DEFER_REASONS` entry; stderr is that reason line.
  - `AC9.1 severity typo refused` — `--severity High` and `--severity urgent` → exit 2, `refused`, reason names the value and `critical, high, medium, low, info`; `AC9.2 severity omitted is valid` → exit 0.
  - `AC10.1`/`AC10.2`/`AC10.3` — the three rule-order calls from the spec's AC10 → `file`/`severity`, `refused`, `refused`.
  - Review Focus 1-5 above, one test each, asserting exit code, verdict and exact reason text.
  - `refusals: both origins, neither origin, unknown flag` — each exit 2 with its exact reason.
  - `--help prints usage and exits 0`.
  - `AC8.1 writes nothing and calls no gh` — `spawnCli` (real process) with `cwd` a fresh `scratchDir()` (`tests/helpers/tmp-dir.js`) and PATH prefixed by an `installStub('gh', …)` stub (`tests/helpers/path-stub.js`) that touches a marker file; run a digest call and a refused call; assert the cwd's `readdirSync` is still empty and the marker absent. `skip: STUB_SKIP` (win32), as `path-stub.js` documents.
  - `AC8.2 in-process deps are stdout and stderr only` — `assert.deepStrictEqual(Object.keys(realDeps).sort(), ['stderr','stdout'])`.

- [ ] **Step 2: Run and see it fail**

Run: `node --test tests/deferral-route-cli.test.js`
Expected: FAIL — cannot find `plugin/bin/deferral-route.js`.

- [ ] **Step 3: Implement `plugin/bin/deferral-route.js`** — header comment with usage, the output shape, the exit codes (0 a verdict or `--help`, 2 refused — no 1), and that it writes nothing; last statement `if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);`. `USAGE`: `usage: deferral-route.js --defer-reason <reason> (--agent-raised | --human) [--severity <critical|high|medium|low|info>] [--size <v>] [--priority <v>] [--risk <v>] [--help]`.

- [ ] **Step 4: Add the docs entry** to `docs/plugin-structure.md`'s command list as one line:
  `node plugin/bin/deferral-route.js --defer-reason <reason> (--agent-raised | --human) [--severity <s>] [--size <v>] [--priority <v>] [--risk <v>]   # Deferral route CLI (#5930) — decides in code whether a legitimately-deferred item files as a record or appends to the digest, reproducing _shared/materiality-floor.md's floor and overrides (plugin/bin/lib/deferral-route/route.js's routeDeferral, pure); prints one JSON line {verdict: file|digest|refused, rule: refused|human|severity|tangential|not-low|floor, reason (refused only), input}; writes nothing, no gh call; exit 0 file or digest, 2 refused (an unknown reason, both or neither origin flag, a bad --severity, a flag without its value, a repeated or unknown flag) with the JSON still on stdout (tests in tests/bin-lib/deferral-route/route.test.js and tests/deferral-route-cli.test.js)`
  Then grep `docs/plugin-structure.md` for the `plugin/bin/lib/` tree list (e.g. `plugin/bin/lib/phase-exit/        →`) and add `plugin/bin/lib/deferral-route/   → deferral-route.js — routeDeferral (#5930): the materiality floor's route verdict as one pure function` in the same alphabetical position style.

- [ ] **Step 5: Run the new tests and the bin conformance scans**

Run: `node --test tests/deferral-route-cli.test.js tests/bin-lib/deferral-route/route.test.js tests/bin-lib/cli-entry-conformance.test.js tests/bin-lib/exit-code-conformance.test.js tests/path-guard-conformance.test.js tests/windows-hide-spawn-conformance.test.js`
Expected: PASS, every file. Then `git grep -l "plugin-structure" -- tests | head` and run any suite there that checks every `plugin/bin/*.js` is listed.

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/deferral-route.js tests/deferral-route-cli.test.js docs/plugin-structure.md
git commit -m "Add the deferral-route CLI — one JSON verdict line, refuses malformed input as data (#5930)"
```

## Spec coverage

| Spec item | Task |
|---|---|
| Deliverable 1 (route.js), 3 (verdict rule), 4 (closed rule), 5 (rule order) | Task 1 |
| Deliverable 6 (exhaustive + prose pin) | Task 1 |
| Deliverable 2 (CLI flags/output), 7 (docs) | Task 2 |
| AC1-AC6, AC8-AC10 | Task 2 tests (AC10 also Task 1) |
| AC7 | Task 1 exhaustive test |
