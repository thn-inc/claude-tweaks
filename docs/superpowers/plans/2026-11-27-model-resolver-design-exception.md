# Model Resolver Design-Reader Exception Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the model resolver one named, code-only exception (`design-reader`) under which a `frontier` resolution is valid in a fan-out, counted against its own limit of 22 per design session, and under which every step-down is a visible `{"stepDown":{"reason":…}}` signal with a non-zero exit instead of a silent lower tier.

**Architecture:** `profiles.js` gains a frozen one-entry `FRONTIER_EXCEPTIONS` table, an ordered `STEP_DOWN_REASONS` list, and an exception branch inside the pure `resolve()`. A new `exception-tally.js` owns the per-session tally: an existence check, then a `withLock` (fail-closed) around read → decide → append. `resolve-profile.js` gains `--exception <name>` and `--session-dir <path>`, prints the step-down signal on stdout and exits 3. Contract prose (`subagent-dispatch-core.md`, `CLAUDE.md`) lists the exception, and a pin test ties that prose to the code constants.

**Tech Stack:** Node 18+, `node:test`, no dependencies.

**Spec:** `.claude-tweaks/pipelines/2026-11-27T155237-record-6351/work/6351-spec.md`

Scope sweep (done at authoring, replacing a `Scope keywords:` field whose identifiers match ~95 unrelated files): `git grep -n -i -E "never (valid )?in a (parallel )?fan-out|never rides a fan-out|singleton-only|Frontier only at|frontier.{0,40}fan-out|fan-out.{0,40}frontier"` (history and this run's files excluded) — hits that become false and are edited in Task 3: `subagent-dispatch-core.md`:222, :232, :317 and `CLAUDE.md`:100. Hits that stay true and are not changed: `design-wrapper/modes/explore.md`:116 (its own fan-out stays Standard), `multi-agent-coordination.md`:141 and `review/step3-debate-and-refutation.md`:23/77 (singleton rule still general), `build/build-options.md`:50 and `build/dispatch.md`:9 (`profile=frontier` sequential bound), `specify/mechanical-handoff.md`:90, `wrap-up/curation-engine.md`:132, `docs/skill-graph.md`:804, `tests/review-tiebreak-step-conformance.test.js`:189.

## Decisions the spec left to the builder (recorded here; the contract prose in Task 3 repeats them)

- **Exception identifier:** `design-reader`. **Flag spelling:** `--exception design-reader`.
- **Session identity:** the design session's folder, passed as `--session-dir <path>` (the design skill's `docs/superpowers/specs/{date}-{topic}/`, per #6352). A resumed session uses the same folder and so the same count.
- **Tally path:** `{session-dir}/frontier-exception-tally.log`, one line per counted resolution: `design-reader\t{ISO timestamp}`. Lock: `{session-dir}/.frontier-exception-tally.lock` (a `file-lock.js` directory lock).
- **Missing vs absent:** a session dir that does not exist (or is not a directory), a lock that cannot be taken, an unreadable tally, or a failed append → step-down reason `tally` (fail closed). A tally *file* that does not yet exist inside an existing session dir is the fresh-session state and counts 0 — the first counted append creates it. (Interpretation of the spec's "a missing or unwritable tally fails closed": "missing" is read as the tally's location missing, since a fresh session has no tally file yet; logged as a premise reading in `decisions.md` by Task 2.)
- **Step-down reasons, in precedence order (one reported per resolution):** `tally`, `policy`, `stance`, `ceiling`, `limit`, `session-failure`. `tally` is checked by the CLI before the resolver runs; the other five follow `resolve()`'s own stage order (policy row → stance → model-ceiling → the frontier-gate stage, where `limit` replaces the run cap → session-failure).
- **Exit codes under the exception:** 0 top tier resolved; 3 step-down signal on stdout (`{"stepDown":{"reason":"<reason>"}}\n`, nothing else); 1 refusal (unknown exception, `--unattended`, a profile other than `frontier`, `--session-dir` without `--exception` or the reverse, `--run-dir` together with `--exception`, a session dir inside `.claude-tweaks/pipelines/`). Exit 1 stays this CLI's invocation-failure code (`.claude/skills/gh-api-module-pattern/run-dir-boundary-guards.md`, shape 2); 3 is new and CLI-own.
- **Session-dir boundary rule (the "own anchoring rule" the Gotchas ask for):** `--session-dir` is resolved against `deps.cwd()` (`resolveAgainst`), is accepted in the main checkout, a linked worktree, or outside any checkout (a design folder is a working-tree path its skill owns, not a shared run dir, so the run-dir main-checkout anchoring does not apply), and is refused (exit 1) when its real path lies inside a `.claude-tweaks/pipelines/` directory — a run dir's frontier spend belongs to `--run-dir`'s `frontier-tally.log`, never to the exception's tally.

## Global Constraints

- Limit: 22 top-tier resolutions per design session under the exception; `frontier-run-cap` (default 3) is never read or written under it, and the run's `frontier-tally.log` is never touched.
- The exception is one named entry in code (`FRONTIER_EXCEPTIONS`, frozen), not a setting: no policy key reads or extends it.
- Output for any call without `--exception` stays byte-identical to today (`{"model":…,"effort":…,"source":…,"effortLine":…,"launchEffort":…}`), so a run in flight on the previous release reads the same shape.
- Under the exception a step-down prints no `model` key.
- Count only successful top-tier resolutions under the exception; a refused or stepped-down call uses no slot. Read, decide and append run under one fail-closed lock so five parallel readers cannot pass 22.
- Source-scan suites over `plugin/bin/**`: `tests/path-guard-conformance.test.js` pins `resolve-profile.js` at exactly one `existsSync` — add none there; in the new module use `plugin/bin/lib/path-guard`'s `canonicalRealpath(p)` (null when unresolvable) then `lstatType(real).type === 'directory'` (`lstatType` never follows a symlink, so it is applied to the real path, letting a symlinked design folder through) and a `try`/`catch` on `ENOENT` for the tally read, never `fs.existsSync`/`fs.realpathSync` (use path-guard's `canonicalRealpath` for the pipelines check). `tests/bin-lib/cli-entry-conformance.test.js` stays satisfied (no `process.exitCode`/`process.exit(` above the entry guard).
- New contract prose must not match `tests/launch-effort-conformance.test.js`'s `MODEL_RESTATEMENT` phrasings (`` `model` parameter ``, ``returned `model` value``, ``passed as `model` `` …) outside the Dispatching paragraph, must use the `"${CLAUDE_PLUGIN_ROOT}/bin/resolve-profile.js"` placeholder (`tests/resolve-profile-invocation-conformance.test.js`), and must not contain `frontier` followed by whitespace and `--unattended` (`tests/frontier-unattended-literal.test.js`).
- Byte rail: `plugin/skills/_shared/subagent-dispatch-core.md` is 38,809 B against the 52,500 B `RAIL_BYTES`; Task 3 adds roughly 1,500 B, leaving about 12,000 B headroom.
- Project maturity `established`: "For any task modifying pre-existing behavior, write a full characterization test covering edge cases before changing it — published or external consumers may depend on them." Here: Task 2 Step 1 pins today's no-exception `frontier` CLI bytes (first call and the fourth, cap-degraded, call) before any CLI change.
- Scope and edit discipline: "Commit tests only where the task asks for them or the repo already keeps tests for this kind of change, sized like the neighboring test files; scratch checks stay scratch. Touch only what the task requires — a pre-existing bug you notice is a follow-up to report, not a fix to fold in, unless the task cannot work without it. Don't reformat or "improve" adjacent code; edit in place rather than rewrite when the result is the same."
- Quoted from `.claude/skills/lock-race-test-seam/SKILL.md` (governs Task 2's concurrency test): "A two-process "concurrent append" test stays green with the lock deleted." / "Inject a read seam into the locked function … and, from inside the seam, attempt the second write in-process." / "Delete the `withLock` wrapper (or the lock acquisition) and run the seam test: the interleaved append must succeed, the assertion on `LOCK_TIMEOUT` must fail. A race test not run against the lock-removed code has not been shown to test the lock." / Anti-pattern: "A seam that calls the second writer outside try/catch — The refusal throws out of the first call and the test never reaches its assertions".
- Quoted from `.claude/skills/gh-api-module-pattern/cli-wrapper-contract.md` (governs `resolve-profile.js`): "A relative path is resolved against `deps.cwd()`, never left to `path.resolve` or `fs`: a file path the unconverted CLI handed to `fs` as written takes an unnormalized join (`resolveAgainst(deps.cwd(), p)`, `plugin/bin/lib/health-core/io.js`)" and "`plugin/bin/lib/file-lock.js`'s lock wait reads `CLAUDE_TWEAKS_LOCK_WAIT_MS` on each acquire from the `env` passed to `withLock`/`acquireLock`" — pass `env: deps.env` to `withLock`. From the same file: "reuse `withLock` rather than hand-rolling a second mutex."
- Quoted from `.claude/skills/prose-code-twin-pin/SKILL.md` (governs Task 3): a prose restatement of a closed vocabulary that "also exists as executable code" needs "a conformance test [that] pin[s] the two equal" — the contract's exception name, limit and reason list are pinned to `FRONTIER_EXCEPTIONS` / `STEP_DOWN_REASONS`.
- No governing project skill names `CLAUDE.md`'s Subagent Contract paragraph; `.claude/skills/skill-prose-conformance-tests/SKILL.md` governs the pin style (live-corpus read of a declared contract).

Waived `plugin/skills/_shared/subagent-output-contract.md`: read by Task 3 Step 3 — it carries no Frontier or singleton clause today (`grep -n -i -e frontier -e singleton` matches nothing), so no clause becomes false; the Subagent Contract clauses that do (`subagent-dispatch-core.md`:222/232/317, `CLAUDE.md`:100) are edited in Task 3.
Waived `tests/frontier-unattended-literal.test.js`: run, not modified, in Task 3 Step 6.
Waived `tests/resolve-profile-invocation-conformance.test.js`: run, not modified, in Task 3 Step 6.
Waived AC3.3: "(Settled at filing from a red-team finding.)" is provenance, not a testable behavior.

## Review Focus

1. Five readers resolving in parallel at count 20 — at most two may get the top tier; the rest must step down with `limit` (Task 2's lock-seam test plus its two-child test).
2. A caller that reads only `model` from a step-down — the output must carry no `model` key and the exit must be non-zero, for every reason (Task 2's per-reason byte table).
3. A relative `--session-dir` from a linked-worktree cwd — resolved against the injected cwd, accepted, tally written in that folder (Task 2 test `session-dir: a relative path resolves against the injected cwd`).
4. Several gates firing at once (economy stance + ceiling + failed `fable` + limit reached) — exactly one reason, the first in precedence order (Task 1 precedence test).
5. A `max-rigor` stance or an effort-only policy row under the exception — the model stays `fable`, so it is not a step-down; source still names the exception (Task 1 test `effort-only changes are not step-downs`).

---

### Task 1: Exception table and resolver branch (`profiles.js`)

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/model-profiles/profiles.js`
- Test: `tests/bin-lib/model-profiles/resolve.test.js`
- Test: `tests/bin-lib/model-profiles/profiles.test.js`

**Interfaces:**
- Produces: `FRONTIER_EXCEPTIONS` — `Object.freeze({ 'design-reader': Object.freeze({ limit: 22 }) })`, exported.
- Produces: `STEP_DOWN_REASONS` — `Object.freeze(['tally', 'policy', 'stance', 'ceiling', 'limit', 'session-failure'])`, exported (precedence order).
- Produces: `resolve(profile, opts)` accepts `opts.exception?: string` and `opts.exceptionUsed?: number` (default 0). With `opts.exception` unset the function is unchanged. With it set it returns either `{ model: 'fable', effort, source: 'exception:design-reader', effortLine, launchEffort }` or `{ stepDown: { reason } }` (reason one of the last five `STEP_DOWN_REASONS`; `tally` is CLI-only), and throws `Error` for: an unknown name (message `unknown exception "{name}" — the one exception is "design-reader"`), a profile other than `frontier` (`the design-reader exception applies only to the frontier profile`), and `opts.unattended` (`the design-reader exception refuses an unattended call — its readers need a human present`).

- [ ] **Step 1: Write the failing tests** in `tests/bin-lib/model-profiles/resolve.test.js` (each name carries its AC id):
  - `AC1.1: under design-reader, resolutions 1 to 22 return fable with source exception:design-reader` — loop `exceptionUsed` 0..21 with `{ exception: 'design-reader' }` on `'frontier'`; each `model === 'fable'`, `source === 'exception:design-reader'`, `effort === 'high'`.
  - `AC1.2: under design-reader, resolution 23 returns stepDown limit` — `exceptionUsed: 22` → `deepStrictEqual(r, { stepDown: { reason: 'limit' } })`.
  - `AC2.1: each step-down reason is reported with no model` — table: `policy` (`policy: { 'model-profiles': { frontier: { model: 'opus' } } }`), `stance` (`stance: 'economy'`), `ceiling` (`policy: { 'model-ceiling': 'capable' }`), `session-failure` (`failedModels: new Set(['fable'])`), `limit` (`exceptionUsed: 22`); each `deepStrictEqual(r, { stepDown: { reason } })` and `!('model' in r)`.
  - `AC2.2: precedence — with every gate firing, the first reason in STEP_DOWN_REASONS order wins` — all five inputs at once → `policy`; drop policy → `stance`; drop stance → `ceiling`; drop ceiling → `limit`; drop limit → `session-failure`. Each row also proves its guard: deleting that stage's exception check turns exactly that row red.
  - `effort-only changes are not step-downs under the exception` — `stance: 'max-rigor'` → `model: 'fable'`, `effort: 'xhigh'`, source `exception:design-reader`; an effort-only policy row `{ frontier: { effort: 'medium' } }` → `fable`, `medium`, same source.
  - `AC4.1: design-reader with unattended throws the refusal` — `assert.throws(() => resolve('frontier', { exception: 'design-reader', unattended: true }), /refuses an unattended call/)`.
  - `AC6.1: an unknown exception throws naming design-reader` — `assert.throws(() => resolve('frontier', { exception: 'other' }), /unknown exception "other" — the one exception is "design-reader"/)`.
  - `the exception applies only to frontier` — `resolve('capable', { exception: 'design-reader' })` throws `/applies only to the frontier profile/`.
  - `AC5.1: without an exception the fourth frontier resolution still degrades with degraded:cap` — `resolve('frontier', { frontierUsed: 3 })` → `model: 'opus'`, `source: 'degraded:cap'` (unchanged path).
  In `tests/bin-lib/model-profiles/profiles.test.js`: `FRONTIER_EXCEPTIONS holds exactly one frozen entry, design-reader with limit 22` (keys `['design-reader']`, `limit === 22`, `Object.isFrozen` on both levels) and `STEP_DOWN_REASONS is the six-reason precedence list` (exact array, frozen).

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/bin-lib/model-profiles/resolve.test.js tests/bin-lib/model-profiles/profiles.test.js`
Expected: FAIL (`FRONTIER_EXCEPTIONS` undefined; `resolve` ignores `exception`)

- [ ] **Step 3: Implement** in `plugin/bin/lib/model-profiles/profiles.js`: add and export the two constants; in `resolve()`, validate `opts.exception` first when present (name via `Object.hasOwn(FRONTIER_EXCEPTIONS, …)`, profile, unattended — the three throws above). Track, under the exception only, the first stage that moves the model off `fable` (policy row, then stance's economy degrade, then ceiling); the frontier-gate stage under the exception checks `exceptionUsed >= limit` → `limit` and skips the run cap and the unattended degrade entirely; the session-failure stage → `session-failure` when `failedModels.has('fable')`. Return `{ stepDown: { reason } }` for the first reason found, else the normal result object with `source` overwritten to `exception:design-reader`. The `diffFacts` stage never applies (it is `capable`-only). Update the header comment's stage list to mention the exception branch. Keep the no-exception path's code untouched.

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/bin-lib/model-profiles/resolve.test.js tests/bin-lib/model-profiles/profiles.test.js tests/bin-lib/model-profiles/table-pinning.test.js`
Expected: PASS, every pre-existing case unchanged.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/model-profiles/profiles.js tests/bin-lib/model-profiles/resolve.test.js tests/bin-lib/model-profiles/profiles.test.js
git commit -m "Add the design-reader frontier exception to resolve() — own limit, visible step-down"
```

### Task 2: Session tally and CLI flags (`exception-tally.js`, `resolve-profile.js`)

**Role:** integration
**Review risk:** high

**Files:**
- Create: `plugin/bin/lib/model-profiles/exception-tally.js`
- Modify: `plugin/bin/resolve-profile.js`
- Modify: `docs/plugin-structure.md` (line 40's `model-profiles/` entry gains `exception-tally.js`; line 414's usage line gains `[--exception <name> --session-dir <path>]` and the exit-3 step-down)
- Test: `tests/bin-lib/model-profiles/cli.test.js`
- Create: `tests/bin-lib/model-profiles/exception-tally.test.js`
- Test: `tests/resolve-profile-run-dir-anchoring.test.js`

**Interfaces:**
- Consumes: `resolve`, `FRONTIER_EXCEPTIONS` from Task 1.
- Produces: `exception-tally.js` exports `TALLY_FILE = 'frontier-exception-tally.log'`, `LOCK_DIR = '.frontier-exception-tally.lock'`, `countUses(text: string, name: string): number` (lines starting `${name}\t`), and `resolveUnderTally({ sessionDir: string, name: string, decide: (used: number) => object, env: object, readTally?: (p) => string, appendTally?: (p, line) => void, now?: () => Date }) -> { ok: true, result } | { ok: false, reason: 'tally' }`. Order: `canonicalRealpath(sessionDir)` null, or `lstatType(real).type !== 'directory'` → `{ ok:false }`; `withLock(path.join(sessionDir, LOCK_DIR), fn, { failClosed: true, env, createParent: false })`, a thrown `LOCK_TIMEOUT` → `{ ok:false }`; inside: read (ENOENT → `''`, any other error → `{ ok:false }`), `decide(countUses(...))`, append `${name}\t${now().toISOString()}\n` only when the result has a `model` (append error → `{ ok:false }`, nothing counted).
- Produces: CLI `resolve-profile.js frontier --exception design-reader --session-dir <path> [--stance <s>]` → exit 0 + the normal JSON line; exit 3 + `{"stepDown":{"reason":"<reason>"}}\n` on stdout, empty stderr; exit 1 + `resolve-profile: <message>` on stderr for the refusals listed in the plan's Decisions section.

- [ ] **Step 1: Characterization first** — in `tests/bin-lib/model-profiles/cli.test.js` add `AC5.1: no-exception frontier output is byte-identical to the pre-change CLI` asserting the exact stdout of `frontier --run-dir <tmp>` on a fresh tally (`{"model":"fable","effort":"high","source":"default","effortLine":"[Effort: high — apply high-level reasoning depth to this task.]","launchEffort":null}\n`) and of the fourth call (`{"model":"opus","effort":"high","source":"degraded:cap",…}`, copy the exact bytes the pre-change CLI prints, captured by running it once). Run it: it passes on the unchanged CLI. Commit nothing yet.

- [ ] **Step 2: Write the failing tests**
  - `tests/bin-lib/model-profiles/exception-tally.test.js`: `countUses counts only name-prefixed lines`; `a missing session dir is reason tally and writes nothing`; `a stepped-down decide appends nothing`; `a successful decide appends one line`; `an unwritable tally is reason tally` (stub `appendTally` to throw); `a non-ENOENT read failure is reason tally` (stub `readTally` to throw `EACCES`); and the lock seam test per the quoted lock-race-test-seam rule — `a second resolution attempted between the first call's read and its append is refused with LOCK_TIMEOUT`: first call's `readTally` seam does the real read and then, inside try/catch, calls `resolveUnderTally` for the same dir with `env: { CLAUDE_TWEAKS_LOCK_WAIT_MS: '0' }`, capturing the result; assert the inner call returned `{ ok:false, reason:'tally' }` (its lock timed out), the outer appended exactly one line, and a retry after the outer returns sees `used === 1`. Record in the test comment that removing `withLock` turns it red, and prove it once (Step 4).
  - `tests/bin-lib/model-profiles/cli.test.js` (in-process `call`): `AC1.1, AC1.2: 22 resolutions in one session dir return fable, the 23rd exits 3 with stepDown limit`; `AC2.1, AC3.1, AC3.2: each step-down reason prints exactly {"stepDown":{"reason":…}} and exits 3` — a table over `tally` (session dir that does not exist), `policy` (policy.yml `model-profiles:` row `frontier: { model: opus }`), `stance` (`--stance economy`), `ceiling` (`model-ceiling: capable`), `limit` (pre-filled tally of 22 lines), `session-failure` (recorded `fable` failure via `CLAUDE_CODE_SESSION_ID`); each asserts `code === 3`, `stdout === '{"stepDown":{"reason":"<reason>"}}\n'`, `stderr === ''`, and that `JSON.parse(stdout).model === undefined`; `AC4.1: --exception with --unattended exits 1 naming the refusal`; `AC6.1: --exception other exits 1 naming design-reader`; `--exception without --session-dir exits 1`; `--session-dir without --exception exits 1`; `--run-dir with --exception exits 1`; `the exception never reads or appends the run's frontier-tally.log` (a run dir passed nowhere, a pre-existing `frontier-tally.log` in a sibling dir unchanged); `session-dir: a relative path resolves against the injected cwd`. One `spawnCli` smoke: `the script entry exits 3 on a step-down` (real process exit code).
  - Two-child end-to-end (CLI path, not the lock proof): `five parallel CLI processes at count 20 yield at most two fable resolutions and the tally ends at 22 lines` via `spawnCli`-style async children started together.
  - `tests/resolve-profile-run-dir-anchoring.test.js`: `session-dir: accepted in a linked worktree` (a folder under the worktree → exit 0, tally written there); `session-dir: refused inside .claude-tweaks/pipelines` (exit 1, message names `--session-dir`, nothing written); `session-dir: accepted outside any checkout` (tmp dir → exit 0).

- [ ] **Step 3: Run to verify they fail**

Run: `node --test tests/bin-lib/model-profiles/exception-tally.test.js tests/bin-lib/model-profiles/cli.test.js tests/resolve-profile-run-dir-anchoring.test.js`
Expected: FAIL (module missing; `unknown argument "--exception"`)

- [ ] **Step 4: Implement** `exception-tally.js` per the Interfaces block (use `canonicalRealpath` and `lstatType` from `../path-guard`, `withLock` from `../file-lock`; no `existsSync`), then in `resolve-profile.js`: parse `--exception` and `--session-dir` as value flags through `requireValue` (extend the usage string); reject the flag combinations before any I/O; for an exception call, check the name against `FRONTIER_EXCEPTIONS` and the unattended refusal before I/O (reuse `resolve`'s messages by calling it, or the same strings), resolve `sessionDir` with `resolveAgainst(deps.cwd(), …)`, refuse a real path inside `.claude-tweaks/pipelines` (`canonicalRealpath` then a path-segment check for consecutive `.claude-tweaks`, `pipelines`; message `--session-dir {as typed} is inside .claude-tweaks/pipelines/ — a run's frontier spend is tallied by --run-dir`), then call `resolveUnderTally` with `decide = (used) => resolve(profile, { policy, stance, failedModels, exception, exceptionUsed: used })`; print `{ stepDown: { reason: 'tally' } }` or `result` and return 3 for any `stepDown`. Leave the no-exception path, the `existsSync` count and the run tally code unchanged. Document exit 3 and the two flags in the file header. Update `docs/plugin-structure.md` lines 40 and 414. Then prove the lock test discriminates: temporarily replace the `withLock(...)` call with a direct `fn()` call, run `node --test tests/bin-lib/model-profiles/exception-tally.test.js`, confirm the seam test fails, restore, and log the result: `node "/Users/thomasholknielsen/.claude/plugins/cache/claude-tweaks-marketplace/claude-tweaks/6.180.0/bin/log-decision.js" --run "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/2026-11-27T155237-record-6351" --section "/build" --status AUTO --step "AC evidence" --text "lock seam test red with withLock removed, green restored" --reversibility n/a`. Also log the "missing vs absent tally" premise reading the same way (`--text "premise reading: a missing session dir fails closed (tally); an absent tally file in an existing session dir counts 0"`).

- [ ] **Step 5: Run to verify they pass**

Run: `node --test tests/bin-lib/model-profiles/exception-tally.test.js tests/bin-lib/model-profiles/cli.test.js tests/resolve-profile-run-dir-anchoring.test.js tests/path-guard-conformance.test.js tests/bin-lib/cli-entry-conformance.test.js`
Expected: PASS

- [ ] **Step 6: Run every pre-existing resolver suite unchanged**

Run: `node --test tests/bin-lib/model-profiles/ tests/resolve-profile-run-dir-anchoring.test.js tests/windows-hide-spawn-conformance.test.js`
Expected: PASS (AC5.1)

Proof(public-contract): Step 1 pins the pre-change bytes of `resolve-profile.js frontier` (first call, and the fourth call degrading with `source: degraded:cap`) and this step re-runs every pre-existing case in `tests/bin-lib/model-profiles/*.test.js` and `tests/resolve-profile-run-dir-anchoring.test.js` unmodified, so the no-exception output shape every installed caller reads is proven byte-identical.

- [ ] **Step 7: Commit**

```bash
git add plugin/bin/lib/model-profiles/exception-tally.js plugin/bin/resolve-profile.js docs/plugin-structure.md tests/bin-lib/model-profiles/exception-tally.test.js tests/bin-lib/model-profiles/cli.test.js tests/resolve-profile-run-dir-anchoring.test.js
git commit -m "Count design-reader resolutions in a locked per-session tally — --exception/--session-dir, exit 3 step-down"
```

### Task 3: Contract prose and its pin

**Role:** integration

**Files:**
- Modify: `plugin/skills/_shared/subagent-dispatch-core.md` (line 222 Frontier row constraint cell; line 232 **Frontier is singleton-only.** paragraph; the **The enumerated slots.** table gains a row; line 317's integration-template clause), `CLAUDE.md` (line 100's one clause)
- Test: `tests/bin-lib/model-profiles/table-pinning.test.js`

**Interfaces:**
- Consumes: `FRONTIER_EXCEPTIONS`, `STEP_DOWN_REASONS` from Task 1; exit codes and flags from Task 2.

- [ ] **Step 1: Write the failing pin tests** in `tests/bin-lib/model-profiles/table-pinning.test.js`, all reading `modelSelectionSection()`:
  - `the section names every FRONTIER_EXCEPTIONS entry with its limit` — for each `[name, { limit }]`: the section contains `` `--exception ${name}` `` and the literal `${limit}` within the same paragraph (split on `\n\n`, find the paragraph starting `**Named fan-out exception.**`).
  - `the section lists STEP_DOWN_REASONS in precedence order` — that paragraph contains the reasons as backticked literals in exactly `STEP_DOWN_REASONS` order (extract with ``/`(tally|policy|stance|ceiling|limit|session-failure)`/g`` and `deepStrictEqual` to the array).
  - `the section states the stop-and-ask rule and the exit codes` — the paragraph matches `/stops and asks/`, `/exits 3/`, ``/`\{"stepDown":\{"reason":/`` and `--session-dir`.
  - A go-red control per the Go-red control check: factor the three assertions into `assertExceptionParagraph(section)`; `the exception pin fails on a paragraph missing the limit` calls it on the section with `22` replaced by `21` and expects it to throw.
  Keep `the Frontier row states its constraints` passing (the cell keeps `Singleton-only` and `degrades to Capable`).

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/bin-lib/model-profiles/table-pinning.test.js`
Expected: FAIL (no `**Named fan-out exception.**` paragraph)

- [ ] **Step 3: Edit the prose.**
  - Line 222 cell: `Singleton-only, except the one named fan-out exception below; degrades to Capable`.
  - Line 232 paragraph: change "Frontier is never valid in a parallel fan-out" to say it is never valid in one except the single named exception below, and append no other change.
  - After the enumerated-slots table (before **`/challenge` is excluded…**), a new paragraph starting `**Named fan-out exception.**` stating, in this file's voice: the one exception is `design-reader`, for `/claude-tweaks:design`'s readers (#6352), invoked as `node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-profile.js" frontier --exception design-reader --session-dir "{design folder}"`; it is code, not a setting, and no policy key adds a second; it allows the top tier in that fan-out up to 22 resolutions per design session (the folder is the session; tallied in `{design folder}/frontier-exception-tally.log` under a lock, counting only top-tier resolutions; never in `frontier-run-cap` or the run's `frontier-tally.log`, and `--run-dir` is refused beside it); an unattended call is refused (exit 1); every step-down prints only `{"stepDown":{"reason":"…"}}` and exits 3, with the reasons in precedence order `tally`, `policy`, `stance`, `ceiling`, `limit`, `session-failure` (a missing session folder or an unwritable tally is `tally`); on exit 3 the calling skill stops and asks the maintainer and never lowers the tier itself; exit 1 also covers an unknown exception name and a `--session-dir` inside `.claude-tweaks/pipelines/`. Avoid every `MODEL_RESTATEMENT` phrasing (Global Constraints).
  - Line 317's clause: `Frontier never rides a fan-out; singleton slots only, §Model Selection` → `Frontier never rides a fan-out outside §Model Selection's one named exception; singleton slots only`.
  - `CLAUDE.md` line 100: `` `Frontier` only at contract-enumerated singleton slots, never in a fan-out `` → `` `Frontier` only at contract-enumerated singleton slots, never in a fan-out except the contract's one named exception ``.
  - Read `plugin/skills/_shared/subagent-output-contract.md` (`grep -n -i -e frontier -e singleton`) and confirm it still has no such clause (Waived line above).

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/bin-lib/model-profiles/table-pinning.test.js`
Expected: PASS

- [ ] **Step 5: Run the documented command once** (Verbatim-command run-once check): `mkdir -p` a scratch folder under the session scratchpad, then `node plugin/bin/resolve-profile.js frontier --exception design-reader --session-dir "{scratch folder}"` from the worktree root → exit 0, `source` `exception:design-reader`; again with `--stance economy` → exit 3, stdout `{"stepDown":{"reason":"stance"}}`. Record both outputs in the task report.

- [ ] **Step 6: Run the prose conformance suites**

Run: `node --test tests/launch-effort-conformance.test.js tests/resolve-profile-invocation-conformance.test.js tests/frontier-unattended-literal.test.js tests/bin-lib/model-profiles/table-pinning.test.js`
Expected: PASS. Byte check: `wc -c plugin/skills/_shared/subagent-dispatch-core.md` stays under 52,500.

- [ ] **Step 7: Commit**

```bash
git add plugin/skills/_shared/subagent-dispatch-core.md CLAUDE.md tests/bin-lib/model-profiles/table-pinning.test.js
git commit -m "List the design-reader exception in the Model Selection contract — pinned to FRONTIER_EXCEPTIONS"
```
