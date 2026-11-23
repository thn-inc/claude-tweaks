# Planning-Answer Read-back CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move `/specify` planning-answer's `## Read-back and outcome` assertions and outcome/Next-Actions selection out of prose into a unit-tested `planning-hold.js readback` verb that prints one JSON verdict.

**Architecture:** A pure `readBack(input)` function joins `plugin/bin/lib/issues/planning-hold.js` (same module as the hold reader it reuses). `plugin/bin/planning-hold.js` gains a `readback` verb that reads files, validates argv and prints `readBack`'s result. The bare `--comments-file` form is kept unchanged so a session running the previous release's prose keeps working. `planning-answer.md` then calls the verb and renders its `outcome` and `next`, so it no longer states the per-branch label assertions.

**Tech Stack:** Node 18+ CommonJS, `node --test`, no dependencies.

**Spec:** `.claude-tweaks/pipelines/2026-11-23T052633-spec-6100/work/6100-spec.md` (record #6100)

## Global Constraints

- Deliverable 1, verbatim: "A `plugin/bin/` CLI (or a verb on `bin/planning-hold.js`) that takes the re-fetched read-back file, the branch taken (answered / re-held / kept), the expected `Plan:` line and the resolved comment ids, and prints one JSON verdict: each assertion's pass/fail and the outcome string to render." This plan takes the verb option.
- Expand-contract (CLAUDE.md): `planning-hold.js --comments-file <f>` (no verb) keeps its exact current behavior, exit codes and JSON line. `readback` is additive.
- Exit vocabulary for the verb is the file's existing *Payload-1/Invocation-2* family: 0 the verdict was printed (pass **or** fail), 1 a payload file unreadable / not JSON / wrong shape, 2 a malformed argv.
- Governing skill `.claude/skills/gh-api-module-pattern/cli-wrapper-contract.md`, quoted:
  - "Logic lives in an exported `run(argv, deps)`; every side effect (`runner`, `ghAvailable`, `remoteUrl`, `stdout`, `stderr`) goes through `deps` so tests inject fakes."
  - "A relative path is resolved against `deps.cwd()`, never left to `path.resolve` or `fs` … (`resolveAgainst(deps.cwd(), p)`, `plugin/bin/lib/health-core/io.js`)". "Read `deps.cwd()` only where a relative path or a child process needs it".
  - "A new CLI's own test therefore carries what the scan cannot see: its in-process cases go through `runCli`/`runCliSync`, and each path-taking flag gets a relative-path case under an injected `cwd` that differs from the real one."
  - "**Adding a verb to an existing multi-verb CLI needs the same sweep: every list of the CLI's verbs, and every list of the input files they read, must gain the new entry.** … Grep for an existing sibling instead". Sibling grep result (run at plan time): `git grep -n -F 'planning-hold.js --comments-file' -- plugin docs .claude/skills` → `docs/plugin-structure.md:425` (CLI command line) and `plugin/skills/specify/planning-answer.md:68` (rewritten in Task 3). `docs/journeys/answer-a-record-held-for-planning-questions-6059.md` lists the two files in `files:` (unchanged paths) — `/claude-tweaks:journeys` owns it.
  - "*Payload-1/Invocation-2* … 0 success, 1 the invocation was well-formed but the stdin/file payload was not …, 2 malformed invocation". `--help`/`-h` anywhere in argv short-circuits (existing L3 test).
  - Why the "promises to write nothing" in-process fs trap does not apply: the verb's header makes no write promise and its only effects are `deps.readFile`/`stdout`/`stderr`; it is not added.
- Governing skill `.claude/skills/prose-code-twin-pin/SKILL.md`, quoted: "If a twin exists, does a conformance test pin the two equal? … a test only asserting that individual literal strings are *present* somewhere is not". Applied in Task 3 to the `next` vocabulary (code `NEXT_ACTIONS` ↔ the four Next Actions bullet labels, set equality both ways).
- Governing skill `.claude/skills/skill-prose-conformance-tests/SKILL.md`, quoted: "**Retargeting existing pins: diff the assertion inventory, not the plan's prose anchor list.** … enumerate every assertion literal in the *replaced* tests and give each one an explicit verdict — moved, retargeted (naming the new literal), or retired". Task 3 carries that inventory. Also: "Apply the whitespace-collapsed control scan to **both** directions … absence assertions need it more than presence ones." — the AC2 absence test collapses whitespace.
- Scope keywords: readBack, planning-hold.js readback, Read-back and outcome

## Review Focus

1. **Comment id shapes differ by transport** — gh `--json comments` gives `id: "IC_…"`; REST/MCP gives numeric `id` plus `node_id`. `{hold-file}`'s `comment.id` comes from `ref()` (`node_id ?? id`). A resolved-id must match either `String(ref(c).id)` or `String(c.id)`. Test in Task 1 (`resolved: matches a REST comment by node_id or numeric id`).
2. **Labels as strings or objects** — gh gives `[{name}]`, an MCP labels file may be `["ready"]`. Both must work. Test in Task 2 (`labels file as strings and readback object labels as {name}`).
3. **A `Plan:` line inside a code fence** in the body must not count toward "exactly one". Test in Task 1 (`plan-line: a fenced Plan: line is not counted`).
4. **A crashed `plan-store.js check`** (empty or non-JSON stdout file) must yield a failed `plan-check` assertion, never exit 1 and never a pass. Test in Task 2 (`plan-check file empty or not JSON → failed assertion, exit 0`).
5. **CRLF / trailing whitespace** in body and in the printed line must not fail an otherwise equal `Plan:` line. Test in Task 1 (`plan-line: CRLF and trailing spaces tolerated`).

---

### Task 1: `readBack` in the planning-hold lib

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/issues/planning-hold.js`
- Test: `tests/bin-lib/issues/planning-hold-readback.test.js` (new, beside `planning-hold.test.js`)

**Interfaces:**
- Consumes: `readPlanningHold(comments)` and the private `bodyOf`, `ref`, `RESOLVED` of the same module; `parsePlanLine(line)` from `./plan-line` (`{ok, commit, …}`); `fencedLineMask(lines)` from `../markdown-blocks`.
- Produces (exported from `plugin/bin/lib/issues/planning-hold.js`):
  - `readBack(input) -> { ok: boolean, branch: string, assertions: Array<{id: string, pass: boolean, detail: string}>, failed: string[], outcome: string, next: string }`
  - `READBACK_BRANCHES = ['answered', 'kept', 're-held']`
  - `NEXT_ACTIONS = ['ready', 'still-needs-decision', 'kept-needs-decision', 'held-or-failed']`
  - `OUTCOME_TEMPLATES` — object of the six placeholder-form strings below (keys `ready`, `still`, `kept`, `reheld`, `failedAfterReHold`, `failedAfterWrite`).

`input` fields (TypeError on any violation, message naming the field):
- `record` — positive integer `{n}`
- `branch` — one of `READBACK_BRANCHES`
- `labels` — string[] (label names)
- `body` — string, the re-fetched record body
- `comments` — array (gh camelCase or REST/MCP snake_case comment objects)
- `planLine` — string, the line `plan-store.js write` printed
- `planCheck` — any value; only an object with `valid === true` passes
- `resolvedIds` — string[] (the answered hold comment id and each `supersededHolds` id)
- `answered` — integer ≥ 0 (`{k}` for answered/kept; `{j}` for re-held)
- `otherUnresolved` — integer ≥ 0, required iff `branch === 'answered'`, must be absent otherwise
- `reheldQuestions` — non-empty string[], required iff `branch === 're-held'`, must be absent otherwise

Assertions, always in this order (`rehold` only on `re-held`):
- `labels` — `answered` with `otherUnresolved === 0`: `ready` present and `needs:decision` absent. Every other case (`answered` with `otherUnresolved > 0`, `kept`, `re-held`): `needs:decision` present and `ready` absent.
- `rehold` — `readPlanningHold(comments).verdict === 'held'` and its question texts, sorted, deep-equal `reheldQuestions` trimmed and sorted (same length, multiset).
- `resolved` — `resolvedIds` non-empty, and for each id some comment with `String(ref(c).id) === id || String(c.id) === id` whose body (CRLF-normalized) includes `**Resolved:**`. Detail names each missing or unresolved id.
- `plan-line` — `parsePlanLine(planLine).ok`; and the body's unfenced lines (CRLF→LF, trailing `[ \t]` stripped) that start with `Plan:` number exactly one, equal to `planLine` with trailing `[ \t\r]` stripped.
- `plan-check` — `planCheck` is a non-null object with `valid === true`.

Outcome and `next` (exact copy — `{n}` is `record`, `{what}` is `failed.join(', ')`, `{short commit}` is the first 7 chars of `parsePlanLine(planLine).commit`):

| Case | `outcome` | `next` |
|---|---|---|
| ok, answered, otherUnresolved 0 | `answered — {k} planning question(s), ready (Plan: {short commit})` | `ready` |
| ok, answered, otherUnresolved m > 0 | `answered — {k} planning question(s); still needs:decision ({m} other decision comment(s))` | `still-needs-decision` |
| ok, kept | `answered — {k} planning question(s); needs:decision kept (decision comments could not be re-read)` | `kept-needs-decision` |
| ok, re-held | `held — {j} answered, {k} re-held` (`{j}` = `answered`, `{k}` = `reheldQuestions.length`) | `held-or-failed` |
| not ok, re-held | `failed — read-back ({what}); re-run /claude-tweaks:specify #{n}` | `held-or-failed` |
| not ok, answered or kept | `failed — read-back ({what}); check the decision comments and remove needs:decision by hand once none is unresolved` | `kept-needs-decision` |

`OUTCOME_TEMPLATES` holds these six strings with the placeholders literally as written above (`{k}`, `{m}`, `{j}`, `{n}`, `{what}`, `{short commit}`); `readBack` renders by substitution from them, so Task 3's twin pin reads the same constants.

- [ ] **Step 1: Write the failing tests** in `tests/bin-lib/issues/planning-hold-readback.test.js`. Fixture helpers: `PLAN = 'Plan: refs/claude-tweaks/plans/7 ' + 'a'.repeat(40) + ' spec-sha256:' + 'b'.repeat(64)`; `body(planLines = [PLAN])` = `'Overview text\n' + planLines.join('\n') + '\n\n## Overview\nx\n'`; a resolved hold comment `{ id: 'IC_h', body: '**Resolved:** answered via /claude-tweaks:specify — 2026-11-23\n<!-- needs-decision: specify -->…', authorAssociation: 'OWNER', createdAt: … }`; a re-held fresh hold built like `planning-hold.test.js`'s `hold()` helper (copy that helper). One `base(overrides)` returns a fully passing `answered` input (`labels: ['ready']`, `otherUnresolved: 0`, `answered: 2`, `resolvedIds: ['IC_h']`, `planCheck: { valid: true, failed: null }`). Tests (names are the assertions):
  - `AC1.1: answered → ready` — `ok: true`, `failed: []`, `outcome === 'answered — 2 planning question(s), ready (Plan: aaaaaaa)'`, `next === 'ready'`, assertion ids `['labels','resolved','plan-line','plan-check']`.
  - `AC1.1: answered with other unresolved → still needs:decision` — labels `['needs:decision']`, `otherUnresolved: 3` → `outcome === 'answered — 2 planning question(s); still needs:decision (3 other decision comment(s))'`, `next === 'still-needs-decision'`.
  - `AC1.1: kept → needs:decision kept` — branch `kept`, no `otherUnresolved`, labels `['needs:decision']` → kept outcome string exactly, `next === 'kept-needs-decision'`.
  - `AC1.1: re-held → held` — branch `re-held`, labels `['needs:decision']`, comments = resolved old hold + fresh unresolved hold holding `Retry?`, `reheldQuestions: ['Retry?']`, `answered: 1` → `outcome === 'held — 1 answered, 1 re-held'`, `next === 'held-or-failed'`, ids include `rehold` second.
  - `AC1.1: each assertion mis-decided goes red` — one sub-case per assertion, each mutating one input from a passing case and asserting `ok: false`, `failed` equal to exactly that one id: answered+`labels: ['ready','needs:decision']` → `['labels']`; answered m=0 + `labels: []` → `['labels']`; kept + `labels: ['ready']` → `['labels']`; re-held with `reheldQuestions: ['Other?']` → `['rehold']`; re-held where the fresh hold is resolved (no held verdict) and labels still `needs:decision` → `['rehold']`; `resolvedIds: ['IC_missing']` → `['resolved']`; the hold comment without `**Resolved:**` → `['resolved']`; `resolvedIds: []` → `['resolved']`; body with two `Plan:` lines → `['plan-line']`; body with zero → `['plan-line']`; body's line differing in commit from `planLine` → `['plan-line']`; `planLine: 'Plan: nonsense'` with the same text in body → `['plan-line']`; `planCheck: { valid: false, failed: 'hash' }` → `['plan-check']`; `planCheck: null` → `['plan-check']`; `planCheck: { valid: 'true' }` → `['plan-check']`.
  - `AC1.1: failed outcome keys its guidance on the branch` — failed answered → `'failed — read-back (plan-check); check the decision comments and remove needs:decision by hand once none is unresolved'`, `next 'kept-needs-decision'`; failed kept → same string shape; failed re-held → `'failed — read-back (rehold); re-run /claude-tweaks:specify #7'`, `next 'held-or-failed'`; two failures → `{what}` is `'labels, plan-line'` (assertion order).
  - `resolved: matches a REST comment by node_id or numeric id` — comment `{ id: 4242, node_id: 'IC_r', body: '**Resolved:** …' }` passes for `resolvedIds: ['IC_r']` and for `['4242']`.
  - `plan-line: a fenced Plan: line is not counted` — body with the real line plus a second identical line inside a ```` ``` ```` fence → passes.
  - `plan-line: CRLF and trailing spaces tolerated` — body joined with `\r\n` and the line suffixed `'  '`, `planLine + ' \r'` → passes.
  - `input validation throws TypeError` — bad branch, `record: 0`, `answered: -1`, `answered: 1.5`, answered without `otherUnresolved`, kept with `otherUnresolved: 0`, re-held without `reheldQuestions`, re-held with `[]`, answered with `reheldQuestions`, `labels: 'ready'` — each `assert.throws(…, TypeError)`.
  - `OUTCOME_TEMPLATES and NEXT_ACTIONS are the documented constants` — `assert.deepEqual(OUTCOME_TEMPLATES, { …the six strings from the table… })`, `assert.deepEqual(NEXT_ACTIONS, ['ready','still-needs-decision','kept-needs-decision','held-or-failed'])`, `assert.deepEqual(READBACK_BRANCHES, ['answered','kept','re-held'])`.

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/bin-lib/issues/planning-hold-readback.test.js`
Expected: FAIL — `readBack is not a function` (or undefined export).

- [ ] **Step 3: Implement `readBack(input)` and the three constants in `plugin/bin/lib/issues/planning-hold.js`**; extend the header comment with one paragraph naming `readBack` (#6100) as the read-back of `specify/planning-answer.md`'s `## Read-back and outcome`, its assertion order, and that it is pure. Add `readBack, READBACK_BRANCHES, NEXT_ACTIONS, OUTCOME_TEMPLATES` to `module.exports`. Require `parsePlanLine` from `./plan-line` and `fencedLineMask` from `../markdown-blocks` (both are plain `plugin/bin/lib` modules; no path-guard API involved).

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/bin-lib/issues/planning-hold-readback.test.js tests/bin-lib/issues/planning-hold.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 5: Go-red proof** — temporarily invert the `labels` predicate for `kept` (expect `ready` present) and rerun the new file: the kept-branch tests must fail; restore. Repeat once for the fence mask (drop `mask[i]` skip): `a fenced Plan: line is not counted` must fail; restore.

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/lib/issues/planning-hold.js tests/bin-lib/issues/planning-hold-readback.test.js
git commit -m "Add readBack to the planning-hold lib — read-back assertions and outcome for #6100"
```

### Task 2: `planning-hold.js readback` verb

**Role:** integration

**Files:**
- Modify: `plugin/bin/planning-hold.js`
- Modify: `docs/plugin-structure.md:425` (add the verb's command line under the existing one)
- Test: `tests/planning-hold-cli.test.js`

**Interfaces:**
- Consumes: `readBack`, `READBACK_BRANCHES` (Task 1).
- Produces: CLI grammar, exact:
  `planning-hold.js readback --record <n> --branch <answered|kept|re-held> --readback-file <f> --body-file <f> [--labels-file <f>] --plan-line-file <f> --plan-check-file <f> --resolved-ids <id[,id…]> --answered <k> [--other-unresolved <m>] [--reheld-file <f>]`
  stdout (exit 0): one JSON line, `readBack`'s result. `USAGE` becomes two lines: the existing `usage: planning-hold.js --comments-file <file> [--help]` and `       planning-hold.js readback …` (the grammar above).

Behavior (decisions the implementer cannot make alone):
- Verb detection: `argv[0] === 'readback'` selects the verb; anything else is the existing `--comments-file` path, byte-for-byte unchanged. `--help`/`-h` anywhere still short-circuits first (both forms).
- Argv (exit 2): unknown flag, a value missing/empty/starting `--`, a repeated flag, a missing required flag, `--branch` outside `READBACK_BRANCHES`, `--record` not a positive integer, `--answered`/`--other-unresolved` not a non-negative integer, `--resolved-ids` with an empty element, `--other-unresolved` given unless branch `answered` or missing when it is, `--reheld-file` given unless branch `re-held` or missing when it is. Message prefix `planning-hold.js: ` then `USAGE`.
- Payload (exit 1), each read through `deps.readFile(resolveAgainst(deps.cwd(), f))`, stderr naming the flag and its argument spelling as typed: `--readback-file` unreadable / not JSON / neither a comments array nor an object with a `comments` array; `--body-file` unreadable; `--plan-line-file` unreadable or empty after trimming trailing newlines; `--labels-file` unreadable / not JSON / not an array; labels absent from both `--labels-file` and the readback object (`labels` array) → exit 1 `no labels`; `--reheld-file` unreadable / not JSON / not an array of strings.
- Labels: from `--labels-file` when given, else the readback object's `labels`; each element a string or an object with string `name`, mapped to names; any other element → exit 1.
- `--plan-check-file`: unreadable, empty or non-JSON is **not** exit 1 — it passes `planCheck: null` (a failed `plan-check` assertion). Rationale: plan-store's own contract reads anything undeterminable as invalid.
- `--plan-line-file`: one line, trailing `\r?\n` trimmed.

- [ ] **Step 1: Write the failing tests** appended to `tests/planning-hold-cli.test.js` (use the file's `call`/`jsonFile` helpers; add a `textFile(s)` twin): 
  - `readback: gh-shape readback file, answered → ready verdict, exit 0` — readback file `{ labels: [{name:'ready'}], body: '…', comments: [resolved hold IC_h] }`, body file with the one `Plan:` line, plan-check file `{"valid":true,"failed":null}` → `code 0`, `JSON.parse(stdout).next === 'ready'`, one stdout line.
  - `readback: a failed assertion still exits 0` — plan-check `{"valid":false,"failed":"hash"}` → `code 0`, `ok false`, `failed ['plan-check']`.
  - `labels file as strings and readback object labels as {name}` — MCP form: readback file is a comments array, `--labels-file` `["needs:decision"]`, branch kept → `ok true`; and a readback object without `labels` and no `--labels-file` → `code 1`, stderr matches `/no labels/`.
  - `plan-check file empty or not JSON → failed assertion, exit 0` — empty file and `'{oops'` → `code 0`, `failed` includes `'plan-check'`.
  - `readback: relative paths resolve against the injected cwd` — every file flag passed as `path.basename(...)` with `cwd: TMP` → `code 0`.
  - `readback: unreadable payload files exit 1 naming the argument spelling` — one sub-case per flag (`--readback-file`, `--body-file`, `--plan-line-file`, `--labels-file`, `--reheld-file`) pointing at `no-such-file.json` → `code 1`, stderr matches `/--{flag}: no-such-file\.json/`.
  - `readback: argv errors exit 2` — missing `--record`; `--branch bogus`; `--record 0`; `--answered -1`; `--resolved-ids 'a,,b'`; `--other-unresolved 1` with kept; answered without `--other-unresolved`; re-held without `--reheld-file`; `--reheld-file` with answered; repeated `--body-file`; unknown `--bogus` → each `code 2`.
  - `readback: --help anywhere prints both usage lines` — `['readback', '--help']` and `['readback', '--record', '-h']` → `code 0`, stdout matches `/planning-hold\.js readback --record/` and `/--comments-file <file>/`.
  - `real process: readback prints the JSON line` — `spawnCli(BIN, ['readback', …])` → `code 0`, parsed `branch`.
  - Existing tests unchanged; they pin the bare form.

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/planning-hold-cli.test.js`
Expected: FAIL — the new readback cases (verb unknown → exit 2 `unknown argument: readback`).

- [ ] **Step 3: Implement** in `plugin/bin/planning-hold.js`: a `parseReadbackArgs(argv)` beside `parseArgs`, a `runReadback(o, deps)` that loads payloads and calls `readBack`, dispatch on `argv[0] === 'readback'` inside `run` after the `--help` check. Update the header comment: the two forms, the readback flags, stdout, and that both forms share the Payload-1/Invocation-2 codes. Add under `docs/plugin-structure.md:425` one line in the same style: `node plugin/bin/planning-hold.js readback --record <n> --branch <answered|kept|re-held> … # Planning-answer read-back (#6100) — asserts labels, re-hold, resolved comments, the Plan: line and plan-store's check verdict, and prints the outcome and Next Actions bullet`.

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/planning-hold-cli.test.js tests/bin-lib/cli-entry-conformance.test.js tests/bin-lib/exit-code-conformance.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 5: Real-input probe** (plan-authoring Real-input probe check — real gh payload shape, not a fixture). Save `gh issue view 6100 --repo thn-inc/claude-tweaks --json labels,body,comments` to `$PIPELINE_RUN_DIR/evidence/readback-probe-6100.json` (create `evidence/` with `mkdir -p` first, absolute path under the main-checkout run dir), write its `.body` to a sibling `.md`, a `Plan:` line file with `PLAN` from Task 1, a plan-check file `{"valid":false,"failed":"ref"}`, then run `readback --record 6100 --branch kept --answered 0 --resolved-ids none …` and redirect stdout to `$PIPELINE_RUN_DIR/evidence/readback-probe-6100.out`. Expected exact verdict: `ok: false`, `failed: ["labels","resolved","plan-line","plan-check"]` (labels carry `ready`/`bot:in-progress`, not `needs:decision`; no comment id `none`; body has no `Plan:` line). Independent count: `jq '[.labels[].name] | index("needs:decision")'` prints `null` and `jq '.comments | length'` equals the count of comments the CLI parsed (add `--resolved-ids` of the first real comment's id to show it is found: `resolved` detail then names it as unresolved, not missing). Log one `AC evidence` line per the AC-evidence persistence check (`log-decision.js --text-file`).

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/planning-hold.js tests/planning-hold-cli.test.js docs/plugin-structure.md
git commit -m "Add planning-hold.js readback verb — one JSON verdict for the planning-answer read-back (#6100)"
```

### Task 3: `planning-answer.md` reads the verdict

**Role:** judgment

**Files:**
- Modify: `plugin/skills/specify/planning-answer.md` (`## Read-back and outcome` only)
- Modify: `tests/specify-planning-answer-conformance.test.js`

**Interfaces:**
- Consumes: the Task 2 grammar; `NEXT_ACTIONS`, `OUTCOME_TEMPLATES` (Task 1).
- Produces: nothing consumed later.

Prose decisions for `## Read-back and outcome` (keep the first paragraph's fetch sentences — gh form, gh-absent form, `{readback-body}`, `{readback-labels}` — and "Write the printed `line` to `{plan-line-file}`" verbatim; replace from "then assert:" through the sentence ending "or the `## Write` or `## Re-hold` outcome above;"):
1. Run `plan-store.js check --line-file "{plan-line-file}" --spec-file "{readback-body}" --base {base} > "{plan-check-file}"` (`--value specify-answer-plan-check-{n}.json`), its exit ignored — the verb reads the verdict.
2. When the branch is `re-held`, write the re-held question texts as a JSON array with the Write tool to `{reheld-file}` (`--value specify-answer-reheld-{n}.json`).
3. Then one call, shown as a fenced block with the literal plugin-root form used elsewhere in the file (`"${CLAUDE_PLUGIN_ROOT}/bin/planning-hold.js" readback`): `--record {n} --branch {answered|kept|re-held} --readback-file "{readback-file}" --body-file "{readback-body}" [--labels-file "{readback-labels}"] --plan-line-file "{plan-line-file}" --plan-check-file "{plan-check-file}" --resolved-ids {ids} --answered {k} [--other-unresolved {m}] [--reheld-file "{reheld-file}"]`.
4. Which branch and values to pass (this is state the agent holds, not an assertion): `answered` after `## Write` with the fresh `otherUnresolved` as `--other-unresolved`; `kept` on the kept branch; `re-held` after `## Re-hold` with `{j}` as `--answered`. `--resolved-ids`: the answered hold comment's id and each `supersededHolds` comment's (`{hold-fresh}`'s on the `## Write` path, `{hold-file}`'s on the kept branch and after `## Re-hold`), comma-joined. `--labels-file` only on the gh-absent path.
5. Exit 0: render the verdict's `outcome` — pass or fail; the Detail adds `review re-ran: yes|no` and, on a re-plan, `re-planned: {failed check}` (keep). Exit 1 or 2, or stdout that is not one JSON line: render `failed — read-back (verdict unreadable); …` with the branch's guidance — `re-run /claude-tweaks:specify #{n}` after `## Re-hold`, the by-hand guidance after `## Write` (it resolved the hold comment).
6. Keep the Logging sentence verbatim.
7. "Next Actions splits four ways:" becomes "Next Actions takes the bullet the verdict's `next` names — `ready`, `still-needs-decision`, `kept-needs-decision` or `held-or-failed`; an outcome rendered before the read-back (a `held — …` with nothing written, a `failed — …` from `## Write` or `## Re-hold`, a verdict-unreadable failure) takes the bullet its outcome describes:". The four bullets stay byte-for-byte (the Fix round 1 test pins them).

Assertion inventory for the replaced pins (verdict per literal, per the governing skill):
- AC1.1 test, read-back pins:
  - `` `gh issue view {n} --json labels,body,comments > "{readback-file}"` (`--value specify-answer-readback-{n}.json` `` — **kept**.
  - `` `ready` present and `needs:decision` absent `` — **retired** from prose (AC2.1), **moved** to Task 1's `AC1.1: answered → ready` / labels sub-cases; becomes an absence pin.
  - `the answered hold comment carries **Resolved:**, as does each supersededHolds comment (…)` — **retargeted** to `` `--resolved-ids`: the answered hold comment's id and each `supersededHolds` comment's (`{hold-fresh}`'s on the `## Write` path, `{hold-file}`'s on the kept branch and after `## Re-hold`) ``.
  - `the body has exactly one Plan: line equal to the printed line` — **retired** from prose, **moved** to Task 1's plan-line sub-cases; absence pin.
  - `` against the re-fetched body and `{base}` prints `{"valid": true}` `` — **retargeted** to `` --base {base} > "{plan-check-file}" ``; the decision **moved** to Task 1's plan-check sub-cases.
  - `` `answered — {k} planning question(s), ready (Plan: {short commit})` `` — **moved** to `OUTCOME_TEMPLATES.ready` (Task 1 constants test); absence pin in the section.
  - `` ready` outcome, recommend `/claude-tweaks:flow #{n}` `` — **kept**.
- L13 test: `` `planning-hold.js --comments-file "{readback-file}"` `` — **retargeted** to `` planning-hold.js" readback `` and `` --readback-file "{readback-file}" ``; `` `{readback-body}` (`--value specify-answer-readback-body-{n}.md`) `` — **kept**; `` plan-store.js check --line-file "{plan-line-file}" --spec-file "{readback-body}" --base {base} `` — **kept**; add `` `{plan-check-file}` (`--value specify-answer-plan-check-{n}.json`) `` and `` `{reheld-file}` (`--value specify-answer-reheld-{n}.json`) ``.
- Fix round 4 test, read-back half (`failureStrings(sec('## Read-back and outcome'), …)` with the two `failed — read-back ({what})` strings) — **retired** from prose, **moved** to Task 1's `failed outcome keys its guidance on the branch` and the `OUTCOME_TEMPLATES` constants test; replaced by a pin on the verdict-unreadable fallback sentence (both qualifiers, run through the existing `failureStrings` swap so placement is proven). The Re-hold half of that test is **kept** unchanged.
- L15, L11, Fix round 1 (Next Actions), heading order — **kept** unchanged.

- [ ] **Step 1: Write the failing tests** in `tests/specify-planning-answer-conformance.test.js`:
  - Edit the AC1.1 and L13 `pinned` lists per the inventory (retargeted literals in; retired ones out).
  - Replace the Fix round 4 read-back `failureStrings` call with one over the new fallback sentence's two strings: `` after `## Re-hold`, `failed — read-back (verdict unreadable); re-run /claude-tweaks:specify #{n}` `` and `` after `## Write`, `failed — read-back (verdict unreadable); check the decision comments and remove needs:decision by hand once none is unresolved` `` (exact wording the prose must use).
  - New `AC2.1: the read-back names the CLI and states no per-branch label assertion` — `pinned(sec('## Read-back and outcome'), [f('planning-hold.js" readback'), f('--branch {answered|kept|re-held}'), f('Next Actions takes the bullet the verdict\'s `next` names')])`; then, on whitespace-collapsed haystack and needles, assert absence of each retired clause: `` `ready` present and `needs:decision` absent ``, `` `needs:decision` present and no `ready` ``, `` the body has exactly one `Plan:` line ``, `` reads `held` with exactly the re-held questions ``, `` `answered — {k} planning question(s), ready (Plan: {short commit})` ``, `- **Answered:**`, `- **Re-held:**`, `- **Both:**`. Control: each absence needle is found in a frozen `PRE_CHANGE_READBACK` constant (the current section's three bullets, copied verbatim into the test) so the absence check can go red.
  - New `twin: the Next Actions bullet labels equal NEXT_ACTIONS` — map labels ``- **`ready`:**`` → `ready`, `- **Still needs:decision:**` → `still-needs-decision`, `- **Kept needs:decision:**` → `kept-needs-decision`, `- **Held or failed:**` → `held-or-failed`; collect the section's `- **…:**` bullet labels through that map (an unmapped label → test failure naming it) and `assert.deepEqual(sorted, [...NEXT_ACTIONS].sort())`; go-red: a mutated region with the Held bullet deleted fails, and `[...NEXT_ACTIONS, 'extra']` fails.
  - New `twin: the Write and Re-hold outcomes equal readBack's templates` — `OUTCOME_TEMPLATES.still` and `.kept` each appear in `sec('## Write')`, `.reheld` with `{j}` and `{k}` appears in `sec('## Re-hold')` as `` `held — {j} answered, {k} re-held` ``; go-red by mutating one character of each template.

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/specify-planning-answer-conformance.test.js`
Expected: FAIL — the AC2.1, retargeted and fallback pins (prose not yet changed).

- [ ] **Step 3: Rewrite `## Read-back and outcome`** per the prose decisions 1-7 above. Size: the file is 13,278 B against the 52,500 B rail (`RAIL_BYTES`); the rewrite is roughly size-neutral — record `wc -c` after.

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/specify-planning-answer-conformance.test.js tests/specify-planning-conformance.test.js tests/bin-lib/issues/planning-hold-readback.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 5: Prose-held pin sweep** (Moved-prose / Prose-held pin checks) — `git grep -n -F -e '`ready` present and' -e 'exactly one `Plan:` line equal to the printed' -e 'failed — read-back ({what})' -e 'with exactly the re-held questions' -- tests plugin docs ':!docs/superpowers/plans' ':!docs/plans/*-ledger.md' ':!.claude-tweaks/pipelines'`. Expected: hits only in `plugin/skills/specify/planning.md` (its own, different read-back — `exactly one \`Plan:\` line equal to the \`line\` \`plan-store.js write\` printed`, untouched) and in the new test's frozen `PRE_CHANGE_READBACK` constant. Control (absence-grep control check): the same command run against `git show HEAD~:plugin/skills/specify/planning-answer.md` (piped through `grep -F`) matches all four phrases.

- [ ] **Step 6: Commit**

```bash
git add plugin/skills/specify/planning-answer.md tests/specify-planning-answer-conformance.test.js
git commit -m "Read the planning-answer read-back verdict from planning-hold.js readback — no prose label assertions (#6100)"
```

## Spec coverage map

| Spec item | Task |
|---|---|
| Deliverable 1 (CLI / verb, JSON verdict) | 1, 2 |
| Deliverable 2 (`planning-answer.md` reads the verdict) | 3 |
| Deliverable 3 (unit tests for every branch + failed assertion) | 1 |
| AC1.1 | Task 1 tests named `AC1.1: …` |
| AC2.1 | Task 3 test `AC2.1: …` |
| AC3.1 (`npm test` passes) | `/build` Common Step 5 verification — Waived AC3.1: verified by the build's final verification run, not a task test |
| Key File `tests/specify-planning-answer-conformance.test.js` | 3 |
