# Control Mode Console Carry Implementation Plan

> **For agentic workers:** execute task-by-task (SDD or executing-plans, as the controller decides). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Under `control-mode: on`, the Review Console resolves what policy can, carries every item a human must decide into the acceptance packet's "Decisions left for you" section, run-end residue reaches a terminal state, and memory writes are automatic and revertable. With control mode off, nothing changes.

**Architecture:** Control mode joins the autonomy ceiling's precedence below any explicit `autonomy` value (`bin/lib/issues/autonomy.js`), and both ceiling readers (`console-resolve.js` and the pre-tool-use console gate) share one helper. `resolveAll` gains a `controlMode` input that rewrites every unresolved item to a new terminal resolution, `carried`, and returns decision facts. `console-resolve.js` owns every write: it merges the facts into `{runDir}/packet-facts/decisions.json`, and three new read/write shapes cover the effective-ceiling query, residue convergence and memory writes. The packet gather reads that file by default. The fact constants live in a leaf module, pinned to a new table in `_shared/acceptance-packet.md`.

**Tech Stack:** Node 18+ CommonJS, `node --test`, no external dependencies; markdown skill prose.

**Spec:** `.claude-tweaks/pipelines/2026-11-16T000749-record-4620/work/4620-spec.md`

**Scope keywords:** resolveAll, bookkeepingPermissions, resolveCeiling, effectiveCeiling, readConsoleCeiling, readPolicy, console-resolve, decisions.json, packet-facts, decision-items, passThroughFacts, UNRESOLVED_RESOLUTIONS, pendingFilings, rewriteItemResolution, settleOpenDecisions, convergeResidue, isControlModeOn, control-mode, keep-staged, carried

## Global Constraints

- **Outside control mode nothing changes.** Every new branch is gated on `controlMode === true`, and `controlMode` comes only from `isControlModeOn` (`bin/lib/policy.js`, "the one comparison site (exactly `on`)").
- **AC5 baseline, made checkable:** the pre-existing console, resolve and wrap-up suites stay unmodified. New tests go in new files. The Key File `tests/bin-lib/console/resolve.test.js` is extended by a sibling, `tests/bin-lib/console/resolve-control-mode.test.js`, so the original stays byte-unmodified. `tests/hooks-pre-tool-use.test.js` takes one appended test, because its run fixtures are local to it. Task 12 checks this with `git diff --numstat`: zero deleted lines in every pre-existing test file except `tests/resolve-policy-control-mode.test.js`, which drops one `NOT_YET_USED` entry by rule (Task 10).
- **No new Review Console section.** `carried` is a new *resolution*, not a section. Sites 1–5 and 8–11 of the `review-console-section-addition` table do not move; only site 7 (the appendix Resolution-to-step mapping) gains a `carried` bullet.
- **No new mid-flow stop** (spec Gotcha): "if something truly needs a human it goes into the packet; the packet is the one acceptance control point."
- **STAGED vocabulary** (spec Gotcha): "Staged items need a staged artifact; a decision-log line saying STAGED without one is a vocabulary violation". Every line this plan logs is `AUTO` (or `SKIP` for a degrade).
- **Below-floor items go to the digest, not the backlog** (`_shared/materiality-floor.md`). A digest entry is terminal.
- **Byte rail:** `RAIL_BYTES` = 52,500 B (`plugin/bin/lib/skill-audit/budgets.js`). The flag line is 47,250 B. Measured headroom is recorded per task.
- **Commit style:** `{Verb} {what} — {detail}`, with `refs #4620` and the session trailer line `Claude-Session: https://claude.ai/code/session_01UwjosJSm8aiVW5CKsEkB4N`.
- **Test runs:** per task, `node --test <file>` only. The impact-selected `npm test` and `npm test -- --full` run once, in Task 12.

### Governing-skill rules (quoted verbatim)

`prose-code-twin-pin` (Task 2's fact table, Task 11's `carried` bullet):
- "Assert set equality both ways — a prose row with no code twin drifts as much as the reverse."
- "A citation sweep never fails when a new case is added to one side and not the other — only a full `assert.deepEqual` over both sides (imported, or parsed from prose) catches that"
- "Pin each column against the prose or against observed behaviour, and cross-check any literal derived from the registry elsewhere"

`skill-prose-conformance-tests` (every prose pin in Tasks 2, 6, 8, 9, 10, 11):
- "When the pinned prose is added in the same change, there is no frozen excerpt to use as a control. Prove each assertion on a mutated copy of the live text instead: delete or alter only the pinned clause, then assert the shared assertion helper throws **with that assertion's own message**"
- "Before adding text to a file other suites pin, grep `tests/` for the file and each suite's slice anchors; keep the new text outside the slice, or re-prove that suite's go-red controls on the edited slice."
- "Prove the assertion can go red before trusting its green: negate the prose and assert the regex *fails*, one claim per test."

`gh-api-module-pattern` → `cli-wrapper-contract.md` (every `console-resolve.js` change, Tasks 1, 5, 6, 8, 9):
- "**Codes above the base vocabulary are per-CLI domain outcomes and are not portable.** … Spell each one out in that CLI's own `USAGE` and in the prose that branches on it; never assume a number carries its meaning across CLIs."
- "**Adding a verb to an existing multi-verb CLI needs the same sweep: every list of the CLI's verbs, and every list of the input files they read, must gain the new entry.**"
- "**A guard added to an existing `run(argv, deps)` reaches the environment through `deps` too.**"
- "An existence or type check goes through `plugin/bin/lib/path-guard`'s `lstatType`, never a bare `fs.existsSync` — `tests/path-guard-conformance.test.js` (AC3.1) flags the token in any new `plugin/bin/lib/` file. A file the CLI is about to read is read directly with `ENOENT`/`ENOTDIR` caught as \"absent\", never checked for existence first"
- "**Changing an existing CLI's exit code is a contract change — sweep every statement of the old code before calling it done.**"

`policy-key-addition` (Tasks 1 and 10):
- "The record that wires a key's first consumer drops the marker and the list entry in the same commit."
- "a malformed value arrives as `source: 'default'` with `invalid: true`, never as a non-default source, so a `source !== 'default'` guard never sees it. Key such a guard on `invalid`, and build its test fixture from a real `resolvePolicyKeys` reply rather than a hand-written one"
- "**A key joining a family reaches only the callers that list it.**"

`review-console-section-addition` (Task 11), site 7: "The section under its resolution's bullet (`approve`, `apply`, `filed`, …) with site 6's step number, so no resolved row is unrouted."

`parse-signal-discipline` (Task 7's `decisions.json` read, Task 6's `--ceiling` query): "When the check hits an input it cannot confidently parse, that outcome must be distinguishable from \"this input legitimately does not need this check\""

`bin-source-scan-conformance`: no task adds a suite that scans `plugin/bin` as text, so its rules do not apply. The path-guard scan it governs still walks the new `plugin/bin/lib/console/*.js` files; the path-guard rule above covers that.

## Review Focus

1. **A malformed `autonomy` value with `control-mode: on`** (`autonomy: supervsed`). The person meant a lower tier, so the implication must not raise them to `unattended`. Pinned in Task 1 (`invalid-autonomy` source → `supervised`).
2. **A carried item whose id has spaces or `#`** (a coordination `decision:- STAGED …#hash` item). The fact id must survive `encodeFactKey` in the gather and render one line. Pinned in Task 7.
3. **A second console-resolve run on the same run dir** (re-render or re-run). `decisions.json` must not double its facts. Dedupe by id is pinned in Task 5.
4. **A memory target written through a symlink or `..` path out of the memory dir.** It must be refused before any write. Pinned in Task 9.
5. **An unreadable `decisions.json`** (truncated by a crash). The packet must say it could not read the file, never render the run as having no decisions. Pinned in Task 7.

## Stated choices for the PR body

- **Explicit ceiling = a non-default, non-invalid `autonomy` entry.** An `invalid: true` autonomy entry blocks the control-mode implication and resolves `supervised` (Review Focus 1). This refines the controller's `entry.source !== 'default'` rule, per `policy-key-addition`'s "Key such a guard on `invalid`".
- **One shared helper, `effectiveCeiling`, in `autonomy.js`.** Both ceiling readers call it, so the parity they must keep is structural. `readConsoleCeiling` keeps returning a plain ceiling string (no return-shape widening). `readPolicy` gains `controlMode` and `ceilingSource` fields; the only test reading it compares `.ceiling` (`tests/hooks-pre-tool-use.test.js:1747`).
- **The carry set is `pending`, `keep-staged` and `refused`.** `refused` (no Defer-reason) is a gate rejection, and the spec carries those into the packet. `stale` patches and `filed` can't-tell items are not carried: the first is re-derived and the second already files.
- **`UNRESOLVED_RESOLUTIONS` is unchanged.** `carried` is terminal. So a control-mode console leaves no console residue. The existing reconcile check is the wiring: `plugin/bin/lib/reconcile/archive-merged.js`'s `readConsoleState`, which `archiveMerged` and `hooks.js archive-run`'s `console-residue` refusal both read, delegates to `console/residue.js`'s `readRunResidue`, and Task 5 pins that it reads `'resolved'` for a console with `carried` items. That is how archived-run residue converges: new runs never leave any. Runs already archived before control mode keep their residue; that is out of scope.
- **Every decision fact in an approved packet is open.** No answer producer exists, so `settleOpenDecisions` has no `answer` predicate: an approve files all of them, and nothing is silently ratified. This is the reading the spec's Decision rule selects.
- **One route for a failed or refused `ledger-record-*` or Queue-write item:** `--set-item {id} --resolution carried [--ledger …]`. With `--ledger`, the call settles the ledger row `deferred` with `carried to the acceptance packet as {factId}`. This needs two narrow shared-module edits: `pack.js`'s `LEDGER_CARRIED_RE` counts that text as a complete deferral, and `settleRow` permits exactly a staged-pointer `deferred` → carried transition, which it refuses today.
- **Decision facts keep the spec's fields in the packet.** A decision-specific gather mapping copies them, and the renderer shows `suggestedResolution`. A decision without the field renders today's line.
- **Ledger residue converges through `console-resolve.js --converge`, called from `_shared/ledger-format.md`'s Phase 2 under control mode.** This is a prose edit outside Key Files. AC2's "zero unresolved ledger residue rows" cannot be met without it: `ledgerRouteRemainder` routes only floor-clearing items, and every other item falls to the per-item drill.
- **The other prose sites that read `bookkeepingPermissions(ceiling)` stay unedited:** `summary-template.md`, `auto-merge-short-circuit.md` ("as `review-console.md`'s Auto-resolution short-circuit does"), `multispec-review-console.md`, `nothing-left-behind.md`, `leftover-routing.md` and `ledger-narrowing-auto-file.md`. Each says to resolve the ceiling per `_shared/autonomy-ceiling.md`'s precedence ladder, or the way `review-console.md` does. Task 10 adds the control-mode rung to that ladder and names `console-resolve.js --ceiling` as its query. #4624 composes the rest of the implied set.
- **Record filing authorization is `queueWriteAutoFile`.** It is the record-filing capability, `trusted`+, and therefore included at `unattended` (`_shared/autonomy-ceiling.md`'s Bookkeeping capabilities table). `ledgerRouteRemainder` is ledger routing, not filing.
- **`auto-mode-contract.md` is not edited.** Its "does NOT silence" table already lists "Resolution of merge conflicts in worktree finishing" as its own row. The file is at 47,500 B, past the 47,250 B flag line.
- **The `control-mode` "Not yet used" marker is dropped.** This record is its first behavioral consumer (`policy-key-addition` item 7).
- **No verdict handler exists yet** (`accept-verdict.js` L162: "No caller yet: #4614's verdict handler is the consumer"). `settleOpenDecisions` ships exported and documented. The one-line call from the approve branch is #4614's.
- **Memory writes are a new `console-resolve.js` shape, not a new CLI.** That avoids a new entry in the self-logging roster `tests/phase-exit-call-sites-conformance.test.js` pins; `console-resolve.js --set-item` already logs off that roster. The diff is one whole-file hunk: no diff library ships, and a single hunk is trivially reversible with `git apply -R`.
- **Packet wiring sits outside Key Files.** `acceptance-packet.js`, `verification-brief.md` and `docs/plugin-structure.md` are required for AC1's "present in the packet", and by `cli-wrapper-contract`'s verb-list sweep.

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `plugin/bin/lib/issues/autonomy.js` | control mode in `resolveCeiling`/`bookkeepingPermissions`; new `effectiveCeiling` | 1 |
| `plugin/bin/lib/hooks/pre-tool-use.js` | `readConsoleCeiling` via `effectiveCeiling` | 1 |
| `plugin/bin/lib/console/decision-facts.js` (new) | fact constants, `decisionFactFor`, `settleOpenDecisions` | 2, 3 |
| `plugin/bin/lib/console/resolve.js` | `resolveAll({ controlMode })` carry route | 4 |
| `plugin/bin/lib/console/residue.js` | `pendingFilings` skips a `carried` item | 5 |
| `plugin/bin/lib/console/item-resolution.js` | `REWRITE_FROM.carried` | 5 |
| `plugin/bin/console-resolve.js` | facts sink, exit 6, `--set-item` carry, `--ceiling`, `--converge`, `--memory-write` | 1, 5, 6, 8, 9 |
| `plugin/bin/lib/stage-item/ledger.js`, `plugin/bin/lib/wrap-up/pack.js` | staged-pointer → carried ledger row transition; carried text counts as a complete deferral | 5 |
| `plugin/bin/acceptance-packet.js` | gather reads `{runDir}/packet-facts/decisions.json` | 7 |
| `plugin/bin/lib/wrap-up/packet-gather.js`, `packet-validate.js`, `packet-render.js` | decision facts keep origin/summary/evidenceRef/suggestedResolution; render shows suggestedResolution | 7 |
| `plugin/bin/lib/console/residue-convergence.js` (new) | `convergeResidue` | 8 |
| `plugin/bin/lib/console/memory-write.js` (new) | `planMemoryWrite`, `wholeFileDiff` | 9 |
| `plugin/bin/lib/policy-schema.js` | drop the `control-mode` marker | 10 |
| prose (`review-console.md`, appendix, `autonomy-ceiling.md`, `acceptance-packet.md`, `ledger-format.md`, `verification-brief.md`, `policy-schema-read-path.md`, `docs/plugin-structure.md`) | the control-mode branch | 2, 6, 7, 8, 9, 10, 11 |

Waived plugin/skills/wrap-up/residue-sweep.md: read only. Task 8 reads its `remedy: record` Defer-reason mapping and its materiality-floor relabel, and reuses both in `--converge`'s input contract. Its prose needs no edit, because the ledger Phase 2 drill it hands to is where Task 8's control-mode branch lands.
Waived plugin/skills/_shared/materiality-floor.md: read only. Task 8 cites it for the `digested` state (the floor test stays the agent's judgment, passed in as `belowFloor`).
Waived plugin/skills/_shared/auto-mode-contract.md: read only. Task 10's AC6 test reads its "does NOT silence" table live. Not edited (stated choice above).
Waived plugin/skills/_shared/deferral-gate.md: read only. Task 8's filed state checks `deferReasonProblem` against its vocabulary.
Waived plugin/skills/_shared/auto-decision-log.md: read only. Every new log line uses its `AUTO` schema through `formatEntry`.
Waived tests/bin-lib/console/resolve.test.js: kept byte-unmodified for AC5. Task 4's control-mode cases live in the sibling `tests/bin-lib/console/resolve-control-mode.test.js`, which copies its run-dir and deps fixture helpers.

The spec cites `flow/manifesto.md`'s failure card. The card itself is `flow/failure-cards.md`'s "Generic gate failure", which Tasks 8, 10 and 11 name.

---

### Task 1: Ceiling composition

**Role:** integration
**Review risk:** high (decision logic, two readers that must agree)

**Files:**
- Modify: `plugin/bin/lib/issues/autonomy.js` (`resolveCeiling`, `bookkeepingPermissions`, new `effectiveCeiling`, exports)
- Modify: `plugin/bin/console-resolve.js:119-130` (`readPolicy`)
- Modify: `plugin/bin/lib/hooks/pre-tool-use.js:831-844` (`readConsoleCeiling`)
- Test: `tests/bin-lib/issues/autonomy-control-mode.test.js` (new)
- Test: `tests/hooks-pre-tool-use.test.js` (append one test after line 1759; no existing line changes)

**Interfaces:**
- Produces: `resolveCeiling({ cliArg, runConfig, policy, controlMode }) -> 'supervised'|'trusted'|'unattended'`. Order: first recognized of `cliArg`, `runConfig`, `policy`; else `controlMode === true` → `'unattended'`; else `'supervised'`.
- Produces: `bookkeepingPermissions(ceiling, { controlMode } = {})`. The tier is `isCeiling(ceiling) ? ceiling : (controlMode === true ? 'unattended' : 'supervised')`. One-argument calls are unchanged.
- Produces: `effectiveCeiling({ cliArg, autonomyEntry, controlModeEntry }) -> { ceiling, controlMode: boolean, source: 'cli'|'explicit'|'control-mode'|'invalid-autonomy'|'default' }`. The entries are `resolvePolicyKeys` entries (`{ value, source, invalid?, error? }`). An entry with `error` counts as absent. `explicit` = an autonomy entry with `source !== 'default'` and no `invalid`. `invalid-autonomy` = an entry with `invalid: true`: the implication is suppressed and the ceiling is `'supervised'`. `controlMode` = `isControlModeOn(controlModeEntry.value)` (required from `../policy`). `controlMode` reports the switch even when an explicit value wins.
- Produces: `readPolicy(...) -> { ceiling, controlMode, ceilingSource, vetoWindowHours, sensitivePaths }`. It resolves the keys `['autonomy', 'control-mode', 'grant-veto-window-hours', 'merge-sensitive-paths']`.
- Produces: `readConsoleCeiling(runDir, cwd) -> string`. It resolves `['autonomy', 'control-mode']`, returns `effectiveCeiling(...).ceiling`, and keeps its throw-on-git-failure.

- [ ] **Step 1: Write the failing tests**

`tests/bin-lib/issues/autonomy-control-mode.test.js`. Build every entry from a real `resolvePolicyKeys(keys, { policyRaw, runConfigRaw })` reply (`plugin/bin/lib/policy-schema.js`), never hand-written:

```js
const { resolvePolicyKeys } = require('../../../plugin/bin/lib/policy-schema');
const { effectiveCeiling, bookkeepingPermissions, resolveCeiling } = require('../../../plugin/bin/lib/issues/autonomy');
const eff = (policyRaw, runConfigRaw = null) => {
  const r = resolvePolicyKeys(['autonomy', 'control-mode'], { policyRaw, runConfigRaw });
  return effectiveCeiling({ autonomyEntry: r.autonomy, controlModeEntry: r['control-mode'] });
};
test('AC4.10: control-mode on alone gives the unattended capability set', () => {
  const e = eff('control-mode: on\n');
  assert.deepStrictEqual(e, { ceiling: 'unattended', controlMode: true, source: 'control-mode' });
  assert.deepStrictEqual(bookkeepingPermissions(e.ceiling), bookkeepingPermissions('unattended'));
});
test('AC4.11: control-mode on with explicit autonomy supervised gives supervised capabilities', () => {
  const e = eff('control-mode: on\nautonomy: supervised\n');
  assert.deepStrictEqual(e, { ceiling: 'supervised', controlMode: true, source: 'explicit' });
  assert.deepStrictEqual(bookkeepingPermissions(e.ceiling), bookkeepingPermissions('supervised'));
});
test('AC4.12: control-mode on with explicit autonomy trusted gives trusted capabilities', () => { /* ceiling 'trusted', source 'explicit' */ });
test('AC4.13: control-mode off is unchanged', () => {
  for (const policy of ['', 'control-mode: off\n', 'autonomy: trusted\n', 'autonomy: unattended\ncontrol-mode: off\n']) {
    const e = eff(policy);
    assert.strictEqual(e.ceiling, resolveCeiling({ runConfig: /autonomy: (\w+)/.exec(policy)?.[1] }));
    assert.strictEqual(e.controlMode, false);
  }
});
```

Add these tests to the same file:
- `'AC4.11: a run-config autonomy beats a policy.yml control-mode'`: policy `control-mode: on`, run config `autonomy: supervised` → `supervised`, source `explicit`.
- `'invalid autonomy with control mode on resolves supervised, never the implication'`: policy `control-mode: on\nautonomy: supervsed\n` → `{ ceiling: 'supervised', controlMode: true, source: 'invalid-autonomy' }`. Go-red: deleting the invalid check makes it `unattended`.
- `'bookkeepingPermissions(ceiling, { controlMode }) composes for a missing ceiling only'`: `(null, {controlMode:true})` deep-equals `('unattended')`; `('supervised', {controlMode:true})` deep-equals `('supervised')`; `(undefined, {})` deep-equals `('supervised')`.
- `'resolveCeiling: controlMode sits below every explicit source'`: `{controlMode:true}` → `unattended`; `{policy:'trusted', controlMode:true}` → `trusted`; `{cliArg:'bogus', controlMode:true}` → `unattended`.

Append this test to `tests/hooks-pre-tool-use.test.js`, reusing its `consoleRun`/`repoOfRun`/`withPolicy` helpers:
- `'#4620 AC4.10: readConsoleCeiling matches readPolicy() under control mode'`: loop over these policy.yml contents: `control-mode: on`; `control-mode: on` plus `autonomy: supervised`; `control-mode: on` plus `autonomy: trusted`; `control-mode: off`; `control-mode: on` plus `autonomy: supervsed`. For each, assert `pre.readConsoleCeiling(dir, repo) === readPolicy(...).ceiling`. Then assert that the first case denies a `Review Console` question (`permissionDecision === 'deny'`), which proves the gate reads control mode.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/issues/autonomy-control-mode.test.js`
Expected: FAIL (`effectiveCeiling is not a function`)

- [ ] **Step 3: Implement** `resolveCeiling`, `bookkeepingPermissions` and `effectiveCeiling` in `autonomy.js`, then route `readPolicy` and `readConsoleCeiling` through `effectiveCeiling` (pass `{ autonomyEntry: result.autonomy, controlModeEntry: result['control-mode'] }`). Update the comment above `readConsoleCeiling` ("Same fold … parity pinned by a test") to name `effectiveCeiling` as the shared fold.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/issues/autonomy-control-mode.test.js tests/bin-lib/issues/autonomy.test.js tests/hooks-pre-tool-use.test.js tests/bin-lib/console/cli.test.js tests/review-console-header-conformance.test.js`
Expected: PASS, all files

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/issues/autonomy.js plugin/bin/console-resolve.js plugin/bin/lib/hooks/pre-tool-use.js tests/bin-lib/issues/autonomy-control-mode.test.js tests/hooks-pre-tool-use.test.js
git commit -m "Compose control mode into the autonomy ceiling — explicit autonomy wins, refs #4620"
```

### Task 2: Decision-fact constants and their schema table

**Role:** integration

**Files:**
- Create: `plugin/bin/lib/console/decision-facts.js`
- Modify: `plugin/skills/_shared/acceptance-packet.md` (new `### Decision facts` subsection at the end of `## Facts and claims`, before `## Validation policy`)
- Test: `tests/bin-lib/console/decision-facts.test.js` (new)

**Interfaces:**
- Consumes: `runIdOf(runDir)` from `./resolve` (require it lazily inside `decisionFactFor`, because `resolve.js` will require this module in Task 4). `SECTIONS` too: compare against the literal section names through a lazy require.
- Produces: `DECISION_FACT_KIND = 'decision'`, `DECISION_ORIGINS = Object.freeze(['console', 'review', 'upstream'])`, `DECISION_FACT_FIELDS = Object.freeze(['id', 'kind', 'origin', 'summary', 'evidenceRef', 'suggestedResolution'])`.
- Produces: `decisionOrigin(section) -> 'review'|'upstream'|'console'`: `review` for `Low-confidence findings` and `Contested findings`, `upstream` for `Upstream feedback`, `console` otherwise.
- Produces: `decisionFactFor(item, { runDir, staged: boolean }) -> { id, kind, origin, summary, evidenceRef, suggestedResolution, text }`. `item` is `{ id, section, resolution, reason }` (its pre-carry resolution). `id` = `` `decision:${origin}:${item.id}` ``. `evidenceRef` = `` `.claude-tweaks/pipelines/${runIdOf(runDir)}/staged/${item.id}` `` when `staged`, else `` `.claude-tweaks/pipelines/${runIdOf(runDir)}/decisions.md` `` (POSIX separators always). `summary` = `` `${item.section}: ${item.id} — ${item.reason}` `` with whitespace collapsed to one line. `text` = `summary`, the field the gather renders. `suggestedResolution` comes from `DECISION_SUGGESTIONS[item.resolution]`: `pending` → `'review it, then apply or decline'`; `keep-staged` → `'decide whether the finding holds; fix it or decline'`; `refused` → `'supply a Defer-reason, or decline'`. Any other resolution → `'decide, then apply or decline'`.

Prose table to add (the schema's single owner):

```markdown
### Decision facts

A control-mode run's Review Console writes one entry per item it could not resolve to `{run-dir}/packet-facts/decisions.json` (a JSON array, deduplicated by `id`), and `gather` reads that file when no `--decision-items` is passed. Each entry renders one line under Decisions left for you, from its `text`. Code twin: `bin/lib/console/decision-facts.js`.

| Field | Value |
|---|---|
| `id` | `decision:{origin}:{slug}`, `{slug}` the console item's id |
| `kind` | `decision` |
| `origin` | `console`, `review` or `upstream` |
| `summary` | one line naming the section, the item and why it was carried |
| `evidenceRef` | a repo-relative path: the item's `staged/` file, else the run's `decisions.md` |
| `suggestedResolution` | what the reader is asked to decide |

`settleOpenDecisions(packetFacts)` (same module) files every decision the packet lists when an `approved` verdict arrives, so an accept never silently ratifies one, and never blocks a merge. The verdict handler (#4614) calls it.
```

- [ ] **Step 1: Write the failing tests**

```js
const { DECISION_FACT_KIND, DECISION_ORIGINS, DECISION_FACT_FIELDS, decisionFactFor, decisionOrigin } = require('../../../plugin/bin/lib/console/decision-facts');
// Live prose read: the table is the schema's single owner and the module is its code twin [IL-80 carve-out].
function factTable(text) { /* slice from '### Decision facts' to the next '## ', parse `| `field` | value |` rows into Map */ }
function assertTableMatchesCode(text) {
  const rows = factTable(text);
  assert.deepStrictEqual([...rows.keys()].sort(), [...DECISION_FACT_FIELDS].sort(), 'field set');
  assert.ok(rows.get('kind').includes(`\`${DECISION_FACT_KIND}\``), 'kind value');
  assert.deepStrictEqual([...rows.get('origin').matchAll(/`([a-z]+)`/g)].map((m) => m[1]).sort(), [...DECISION_ORIGINS].sort(), 'origin set');
  assert.ok(rows.get('id').includes('`decision:{origin}:{slug}`'), 'id shape');
}
test('AC1.1: the acceptance-packet.md Decision facts table equals the code constants both ways', () => assertTableMatchesCode(PACKET));
test('go-red: dropping an origin from the prose fails the origin assertion', () => {
  const m = PACKET.replace('`console`, `review` or `upstream`', '`console` or `review`');
  assert.notStrictEqual(m, PACKET);
  assert.throws(() => assertTableMatchesCode(m), { message: /origin set/ });
});
test('go-red: an extra prose field fails the field-set assertion', () => { /* insert `| `answer` | x |` row → throws /field set/ */ });
test('AC7.1: decisionOrigin maps review sections to review, upstream to upstream, an sdd-ruling to console', () => {
  assert.strictEqual(decisionOrigin('Contested findings'), 'review');
  assert.strictEqual(decisionOrigin('Low-confidence findings'), 'review');
  assert.strictEqual(decisionOrigin('Upstream feedback'), 'upstream');
  assert.strictEqual(decisionOrigin('Pending review'), 'console');
});
test('decisionFactFor: a staged item cites its staged path, a coordination item cites decisions.md', () => {
  const runDir = path.join('/r', '.claude-tweaks', 'pipelines', '2026-11-16T000749-record-4620');
  const f = decisionFactFor({ id: 'review-contested-1.md', section: 'Contested findings', resolution: 'keep-staged', reason: 'debate\ninconclusive' }, { runDir, staged: true });
  assert.deepStrictEqual(Object.keys(f).sort(), [...DECISION_FACT_FIELDS, 'text'].sort());
  assert.strictEqual(f.id, 'decision:review:review-contested-1.md');
  assert.strictEqual(f.evidenceRef, '.claude-tweaks/pipelines/2026-11-16T000749-record-4620/staged/review-contested-1.md');
  assert.strictEqual(f.summary, 'Contested findings: review-contested-1.md — debate inconclusive');
  assert.strictEqual(f.text, f.summary);
  assert.strictEqual(f.suggestedResolution, 'decide whether the finding holds; fix it or decline');
});
```

Add one more case: a `spec-3` run dir's `evidenceRef` names `{parent}/spec-3`.

- [ ] **Step 2: Run to verify failure**

Run: `node --test tests/bin-lib/console/decision-facts.test.js`
Expected: FAIL (`Cannot find module …/decision-facts`)

- [ ] **Step 3: Implement** `decision-facts.js` (leaf: `path` only, plus the lazy `./resolve` require) and add the prose table. Byte check: `wc -c plugin/skills/_shared/acceptance-packet.md` — 30,975 B before, about 32,300 B after, about 20,200 B of headroom against the rail. Record the measured number in the commit body.

- [ ] **Step 4: Run to verify pass**

Run: `node --test tests/bin-lib/console/decision-facts.test.js tests/acceptance-packet-contract-conformance.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/console/decision-facts.js plugin/skills/_shared/acceptance-packet.md tests/bin-lib/console/decision-facts.test.js
git commit -m "Add the decision-fact schema and its code twin — Decisions left for you entries, refs #4620"
```

### Task 3: settleOpenDecisions

**Role:** integration

**Files:**
- Modify: `plugin/bin/lib/console/decision-facts.js`
- Test: `tests/bin-lib/console/decision-facts.test.js` (same new file)

**Interfaces:**
- Consumes: `fingerprintFromBasis` (`../health-core/fingerprint`), and `specShapedBody`, `recordPayload`, `fencedBlock`, `defuse`, `LABELS` (`../issues/record`), as `finding-filing.js`'s `composeFindingProposal` does.
- Produces: `settleOpenDecisions(packetFacts) -> Array<{ factId, fingerprint, title, proposal }>`. `packetFacts` is a facts document `{ facts: [...] }` or a bare array; anything else returns `[]`. Every `kind === 'decision'` fact counts as open: nothing produces an answer today, so there is no `answer` predicate, and an approve files every decision listed (nothing is silently ratified). `fingerprint` = `fingerprintFromBasis('packetdecision', [fact.id])`. `title` = `` `Packet decision left open: ${capped one-line text}` `` (80-char cap, word boundary). `proposal` = a `Title:`/`Type: task`/`Labels: needs:definition`/`Defer-reason: needs-human-decision` header plus the `recordPayload`/`specShapedBody` body: `currentState` quotes the fact `text` in a fenced block, with `deliverables`, `acceptanceCriteria`, `releaseNote: 'No user-visible change.'` and `filedBy: 'acceptance-packet'`. Pure: no I/O. The return carries no merge-gating field.

- [ ] **Step 1: Write the failing tests**

```js
const { validateShaped } = require('../../../plugin/bin/lib/compose-record/compose');
const facts = { facts: [
  // The ids gather really produces: `:` is a safe character in encodeFactKey, so it is not escaped.
  { id: 'decision:review:review-contested-1.md', kind: 'decision', status: 'passed', source: 'decision-items', text: 'Contested findings: review-contested-1.md — debate inconclusive' },
  { id: 'decision:console:sdd-ruling-2.md', kind: 'decision', status: 'passed', source: 'decision-items', text: 'Pending review: sdd-ruling-2.md — sdd-ruling-needs-human-decision' },
  { id: 'change:a.js', kind: 'change', status: 'passed', source: 'git' },
] };
test('AC4.8: settleOpenDecisions files one spec-shaped record per decision in an approved packet', () => {
  const plans = settleOpenDecisions(facts);
  assert.deepStrictEqual(plans.map((p) => p.factId), ['decision:review:review-contested-1.md', 'decision:console:sdd-ruling-2.md']);
  for (const p of plans) {
    const body = p.proposal.split('\n\n').slice(1).join('\n\n');
    assert.deepStrictEqual(validateShaped(body), { ok: true, gaps: [] });
    assert.match(p.proposal, /^Defer-reason: needs-human-decision$/m);
  }
});
test('AC4.8: a decision carrying a stray answer field is still filed — no answer predicate', () => {
  assert.strictEqual(settleOpenDecisions([{ ...facts.facts[1], answer: 'drop it' }]).length, 1);
});
test('AC4.8: settleOpenDecisions files nothing when the packet holds no decision', () => {
  assert.deepStrictEqual(settleOpenDecisions({ facts: [facts.facts[2]] }), []);
  assert.deepStrictEqual(settleOpenDecisions([]), []);
  assert.deepStrictEqual(settleOpenDecisions(null), []);
});
test('AC4.9: an unanswered decision never blocks a merge — plans only, no gating field', () => {
  for (const p of settleOpenDecisions(facts)) assert.deepStrictEqual(Object.keys(p).sort(), ['factId', 'fingerprint', 'proposal', 'title']);
});
test('settleOpenDecisions is stable: the same fact id gives the same fingerprint', () => { /* two calls, equal fingerprints */ });
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test tests/bin-lib/console/decision-facts.test.js`
Expected: FAIL (`settleOpenDecisions is not a function`)

- [ ] **Step 3: Implement** `settleOpenDecisions` and export it.

- [ ] **Step 4: Run to verify pass**

Run: `node --test tests/bin-lib/console/decision-facts.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/console/decision-facts.js tests/bin-lib/console/decision-facts.test.js
git commit -m "Add settleOpenDecisions — an approved packet files its open decisions, refs #4620"
```

### Task 4: The carry route in resolveAll

**Role:** integration
**Review risk:** high (decision logic in the resolver)

**Files:**
- Modify: `plugin/bin/lib/console/resolve.js:968-980` (`resolveAll`), plus the export list
- Test: `tests/bin-lib/console/resolve-control-mode.test.js` (new sibling of `resolve.test.js`, which stays unmodified)

**Interfaces:**
- Consumes: `UNRESOLVED_RESOLUTIONS` from `./residue` (do not restate it), and `decisionFactFor` from `./decision-facts`.
- Produces: `CARRIED_RESOLUTION = 'carried'` and `CARRY_FROM = Object.freeze([...UNRESOLVED_RESOLUTIONS, 'refused'])` (exported).
- Produces: `resolveAll({ runDir, policy, deps, controlMode }) -> { …existing keys, decisionFacts }`. When `controlMode === true`, the carry rewrite runs after the existing `tiebreak → filed` map. Each item whose resolution is in `CARRY_FROM` becomes `{ ...item, resolution: 'carried', carriedFrom: item.resolution, reason: `carried to the acceptance packet as ${fact.id} — ${item.reason}` }`, and its fact (built from the pre-rewrite item, `staged` = `stagedIds.has(item.id)`) is pushed to `decisionFacts`. When `controlMode` is not `true`, `decisionFacts` is `[]` and every other key is unchanged (`deepStrictEqual` against a call without the argument). `planFilings` runs on the rewritten items; it reads only `filed` items, so nothing changes there.

- [ ] **Step 1: Write the failing tests** (copy `resolve.test.js`'s run-dir and deps fixture helpers into the new file)

- `'#4620 AC1.1: control mode resolves the policy item and carries the contested finding'`. Fixture: staged `skills-1.md` and staged `review-contested-1.md` (legacy shape, no tiebreak), with `controlMode: true`. Assert `skills-1.md` → `approve`; `review-contested-1.md` → `carried`, `carriedFrom: 'keep-staged'`. Assert `decisionFacts` is exactly one fact with id `decision:review:review-contested-1.md`. Assert `items.filter((i) => UNRESOLVED_RESOLUTIONS.has(i.resolution))` is `[]`.
- `'#4620 AC7.1: a needs-human-decision sdd ruling is carried, never applied'`. A staged `sdd-ruling-1.md` whose header makes `sddRulingDeferralReason` return `SDD_RULING_REASONS.NEEDS_HUMAN_DECISION` (copy the header shape from `tests/build-sdd-ruling-deferral-gate.test.js`'s needs-human-decision fixture) → `carried`, `carriedFrom: 'pending'`, fact origin `console`. Assert no item is `apply`.
- `'#4620 AC2.1: unmapped, refused and coordination items are all carried'`. Fixture: an unmapped-prefix staged file (`pending`); a `REFUSED` line naming a staged `leftover-1.md` (`refused`); a `- STAGED` low-confidence coordination line with no staged file (`keep-staged`). All three → `carried`. Three facts; the coordination fact's `evidenceRef` ends `/decisions.md`; the refused one's `suggestedResolution` is `'supply a Defer-reason, or decline'`.
- `'#4620 AC2.1: an unattended can\'t-tell item still resolves filed under control mode'`. A tiebreak `console` verdict item → `filed`, not `carried`; `filings` length 1.
- `'#4620 AC5.1: without controlMode resolveAll is byte-identical and decisionFacts is []'`. Fixture as in the first test. Assert `deepStrictEqual` of `items`, `merge`, `filings` and `table` with and without `controlMode: false`, plus `decisionFacts: []`. Go-red: forcing the gate to always-on makes this fail.

- [ ] **Step 2: Run to verify failure**

Run: `node --test tests/bin-lib/console/resolve-control-mode.test.js`
Expected: FAIL (`decisionFacts` undefined / resolution `keep-staged`)

- [ ] **Step 3: Implement** the rewrite in `resolveAll`. `renderRows` already prints any resolution word; leave it alone.

- [ ] **Step 4: Run to verify pass**

Run: `node --test tests/bin-lib/console/resolve-control-mode.test.js tests/bin-lib/console/resolve.test.js tests/bin-lib/console/decision-facts.test.js tests/bin-lib/console/cli.test.js tests/bin-lib/console/residue.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/console/resolve.js tests/bin-lib/console/resolve-control-mode.test.js
git commit -m "Carry undecidable console items under control mode — resolveAll returns decision facts, refs #4620"
```

### Task 5: The facts sink, exit 6, and failed-execution carry

**Role:** integration
**Review risk:** high (writes shared run-dir state; a failure must never drop an item)

**Files:**
- Modify: `plugin/bin/console-resolve.js` (header comment, `USAGE`, the resolve path at L322-370, `nothingToRevert`, `setItem`)
- Modify: `plugin/bin/lib/console/item-resolution.js:24` (`REWRITE_FROM`)
- Modify: `plugin/bin/lib/console/residue.js` (`pendingFilings`)
- Modify: `plugin/bin/lib/stage-item/ledger.js` (`settleRow`: the staged-pointer → carried transition)
- Modify: `plugin/bin/lib/wrap-up/pack.js` (`LEDGER_CARRIED_RE`, `isDeferredUnstaged`)
- Consumes (no edit): `plugin/bin/lib/reconcile/archive-merged.js` (`readConsoleState`, test only)
- Test: `tests/bin-lib/console/ledger-carry.test.js` (new). Cases:
  - `settleRow` moves a staged-pointer `deferred` row to the carried text.
  - It still refuses that row → any other `deferred` text, and → `fixed`.
  - `parseLedger` reports the carried row as neither open nor deferred-unstaged.
  - A carried text with no `decision:` id is still unstaged.
  - Each guard gets its own red-on-deletion case.
- Test: `tests/bin-lib/console/control-mode-cli.test.js` (new; copy `cli.test.js`'s `mainCheckoutWithRun`/`fakeExec`/`baseDeps` helpers verbatim, then pass `policyExtra: 'control-mode: on\n'` with `autonomy: null` so no explicit autonomy is written; if the helper cannot omit `autonomy`, add a `writeAutonomy` option to the copy)

**Interfaces:**
- Consumes: `resolveAll({ …, controlMode })` (Task 4), `readPolicy().controlMode` (Task 1), `writeFileAtomic` (`./lib/atomic-write`), `withLock` (`./lib/file-lock`), `CONSOLE_LOCK` (`./lib/console/item-resolution`).
- Produces: `EXIT_CARRY_FAILED = 6` (exported). `writeDecisionFacts(runDir, facts) -> { path, added: number }`: it reads `{runDir}/packet-facts/decisions.json` directly (ENOENT/ENOTDIR = empty; unparseable or not an array → throw, never overwrite), merges by `id` (the first copy wins), creates `packet-facts/` with `mkdirSync({ recursive: true })`, and writes through `writeFileAtomic` under `withLock(path.join(runDir, 'packet-facts', '.decisions.lock'))`. Exported for Task 8.
- Resolve path under control mode, not `--dry-run`: call `writeDecisionFacts` **before** the decisions block and `console.json`. On a throw, print `console-resolve.js: could not carry {n} item(s) to the acceptance packet ({message}) — {id}, {id}, …` to stderr, naming every carried item id, write nothing else, and return 6. On success, the header line says `at unattended (control mode)` when `ceilingSource === 'control-mode'`, and each carried item's line is the existing per-item line, whose reason already names the fact id. `nothingToRevert` gains `'carried'` (reversibility `n/a`). `console.json` records `controlMode: true` and `decisionFacts: <count>` only when control mode is on, so off-mode JSON stays byte-identical. Under `--dry-run`, nothing is written and `--json` carries `decisionFacts` (the array).
- `--set-item` under control mode (read through `readPolicy`; a read that throws counts as off): a requested `keep-staged` or `pending` rewrite is stored as `carried`, and its fact is written through `writeDecisionFacts` first. A fact-write failure returns 6 and leaves the stored item unchanged. `REWRITE_FROM` gains `carried: ['apply', 'approve', 'filed']` (`filed` covers a can't-tell filing whose create failed). `--resolution carried` is accepted explicitly too.
- **The one route for a failed or refused `ledger-record-*` or Queue-write item under control mode** is `--set-item {id} --resolution carried --reason {why} [--ledger {ledger path}]`. `--ledger` is accepted only with `--set-item` (else exit 2). For a `ledger-record-*` id with `--ledger` given, the call:
  1. Writes the fact.
  2. Finds the one ledger row whose Resolution cell names `staged/{id}`, and settles it through `settleRow({ status: 'deferred', resolution: 'carried to the acceptance packet as {factId}' })`. The row never goes back to `open`, and never keeps the stale `staged/` pointer.

  Verified at authoring: today's `settleRow` refuses this transition. A `deferred` row naming `staged/…` is terminal, because `isDeferredUnstaged` is false for it. A carried resolution would also read as an incomplete deferral, since it names neither a `staged/` path nor a record. Two narrow edits make the transition legal:
  - **`plugin/bin/lib/wrap-up/pack.js`:** export `LEDGER_CARRIED_RE = /\bcarried to the acceptance packet as decision:\S+/`, and make `isDeferredUnstaged` return false when it matches, so a carried row counts as a complete deferral, like a record reference.
  - **`plugin/bin/lib/stage-item/ledger.js`'s `settleRow`:** allow exactly `deferred` (resolution matching `LEDGER_DEFERRED_STAGED_RE`) → `deferred` with a resolution matching `LEDGER_CARRIED_RE`, the way the refused-proposal reopen is allowed. Every other terminal guard stays as it is.
  3. Only then rewrites the stored console item.

  No row naming `staged/{id}` → exit 5 (`no ledger row names staged/{id}`), nothing rewritten. A `settleRow` throw → exit 3, the console item unchanged (the fact write is idempotent by id). A stored item that is **already** `carried` (resolveAll carried it at resolve time) still runs steps 1–2, and its exit 0 reports `already carried; ledger row #{N} settled`. A row already reading the carried text is left as it is. That is how a resolve-time carry of a refused `ledger-record-*` reaches its ledger row: the prose (Task 11) runs this call once per carried `ledger-record-*` item.
- `pendingFilings(consoleJson, decisions)` skips an entry whose console item resolution is `carried`. `UNRESOLVED_RESOLUTIONS` stays exactly `pending`/`keep-staged`.

- [ ] **Step 1: Write the failing tests** (`tests/bin-lib/console/control-mode-cli.test.js`)

- `'AC1.1: control mode resolves and logs the policy item, carries the contested finding, prints no Needs a human block'`. Fixture: staged `skills-1.md` and `review-contested-1.md`, policy `control-mode: on`. Exit 0. `console.json` items: `skills-1.md` `approve`, `review-contested-1.md` `carried`. `decisions.md` holds one `Console item skills-1.md (Skill updates): approve` line and one `Console item review-contested-1.md (Contested findings): carried — carried to the acceptance packet as decision:review:review-contested-1.md` line. `packet-facts/decisions.json` parses to one entry with that id and a `text` field. Stdout has no `Needs a human`.
- `'AC2.1: a control-mode console.json with carried items passes the archival reconcile check as having no open items'`. After the run above, `readConsoleState(runDir)` from `plugin/bin/lib/reconcile/archive-merged.js` returns `'resolved'`, not `'residue'`. That is the function `archiveMerged`'s decision and `hooks.js archive-run`'s `console-residue` refusal both read (docs/reconcile-checks.md, "Console residue (#3949)"). `readRunResidue(runDir).consoles` (`console/residue.js`, the predicate it delegates to) is `[]`. Control: the same fixture resolved with control mode off reads `'residue'`, because the contested item is `keep-staged`.
- `'AC2.1: a refused ledger-record item under control mode ends with its ledger row deferred to the packet'`. Build the fixture's ledger with the real `appendRow`/`settleRow` writers (`plugin/bin/lib/stage-item/ledger.js`; a real-writer fixture). One row, `deferred`, Resolution `→ backlog, staged/ledger-record-1.md`. Add a staged `ledger-record-1.md` and a `REFUSED` decisions line naming it. Run the resolve (the item reads `carried`), then `--set-item ledger-record-1.md --resolution carried --reason 'refused: no Defer-reason' --ledger {ledger}`. Assert exit 0. The row's Status is `deferred` and its Resolution is `carried to the acceptance packet as decision:console:ledger-record-1.md`, with no `staged/` left in it. `decisions.json` holds that one fact. Controls: `--ledger` naming a ledger with no matching row exits 5 with the ledger byte-identical. A row already settled is left unchanged on a second call.
- `'AC2.1: a failed Queue-write create is carried, never reopened'`. A stored `leftover-1.md` at `apply` → `--set-item leftover-1.md --resolution carried --reason 'gh issue create failed'` → stored `carried`, one fact, no ledger touched.
- `'AC4.6: a forced carry failure exits 6, names every item, writes no console.json'`. Pre-create `packet-facts/decisions.json` holding `not json`. Exit 6; stderr matches `/could not carry 1 item\(s\).*review-contested-1\.md/`; `console.json` absent; the facts file is unchanged.
- `'a re-run never doubles a fact'`. Run, delete `console.json`, run again: `decisions.json` still holds one entry.
- `'AC5.1: control mode off writes no packet-facts file and an identical console.json'`. Same fixture without `control-mode`: no `packet-facts` directory, `console.json` has no `controlMode` key, and exit 4 when no autonomy is set (the existing supervised default).
- `'AC4.11: control-mode on with explicit autonomy supervised still exits 4'`.
- `'--set-item keep-staged under control mode stores carried and writes the fact'`. A resolved `console.json` with a Queue-write item `leftover-1.md` at `apply`; `--set-item leftover-1.md --resolution keep-staged --reason 'gh issue create failed'` → stored `carried`, one fact, exit 0. The same call with control mode off stores `keep-staged` (unchanged behavior).
- `'a failed can\'t-tell filing rewritten carried is no longer filing-pending'`. A `console.json` with a `filings` entry and no filed line: `consoleResidueItems` lists it; after `--set-item {item} --resolution carried`, `consoleResidueItems` is `[]`.

- [ ] **Step 2: Run to verify failure**

Run: `node --test tests/bin-lib/console/control-mode-cli.test.js`
Expected: FAIL (exit 4, or no `packet-facts` file)

- [ ] **Step 3: Implement** the sink, exit 6, the `setItem` carry, `REWRITE_FROM.carried` and the `pendingFilings` skip. Update the header comment and `USAGE` with exit 6, and with `carried` in the `--set-item` resolution list.

- [ ] **Step 4: Run to verify pass**

Run: `node --test tests/bin-lib/console/control-mode-cli.test.js tests/bin-lib/console/ledger-carry.test.js tests/bin-lib/console/cli.test.js tests/bin-lib/console/item-resolution.test.js tests/bin-lib/console/residue.test.js tests/bin-lib/console/residue-cli.test.js tests/bin-lib/wrap-up/pack.test.js tests/hooks-ledger-row.test.js tests/review-console-unattended-no-ask-conformance.test.js tests/path-guard-conformance.test.js`
Expected: PASS

- [ ] **Step 5: Real-input probe (Real-input probe and Independent-count checks).** Pick one archived run with console residue: `node plugin/bin/console-residue.js --all` lists them, from the main checkout. Run `resolveAll({ runDir: '<that archive dir>', policy: 'console-auto', deps: <console-resolve's resolverDeps with readGrants stubbed to {}> , controlMode: true })` through a scratchpad `node` script (never committed). Print `items.filter(i => i.resolution === 'carried').length` and `decisionFacts.length`. Reconcile both against an independent count: the `pending`/`keep-staged` items `console-residue.js --run <dir>` lists for the same dir, plus any `refused` items in its `console.json`. Record the three numbers in the run's `decisions.md` per the AC-evidence persistence check (`--step "AC evidence"`, full output under `$PIPELINE_RUN_DIR/evidence/carry-probe.txt`).

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/console-resolve.js plugin/bin/lib/console/item-resolution.js plugin/bin/lib/console/residue.js plugin/bin/lib/stage-item/ledger.js plugin/bin/lib/wrap-up/pack.js tests/bin-lib/console/control-mode-cli.test.js tests/bin-lib/console/ledger-carry.test.js
git commit -m "Write carried decisions to packet-facts/decisions.json — exit 6 on a failed carry, refs #4620"
```

### Task 6: The effective-ceiling query and the pre-check switch

**Role:** integration
**Review risk:** high (decides whether the console stops for a human)

**Files:**
- Modify: `plugin/bin/console-resolve.js` (`parseArgs`, `run`, `USAGE`, header)
- Modify: `plugin/skills/wrap-up/review-console.md:79` (the "Resolve the ceiling once" sentence)
- Modify: `docs/plugin-structure.md:187` area (add the `--ceiling` line beside `--check-repair`'s)
- Test: `tests/bin-lib/console/control-mode-cli.test.js`
- Test: `tests/control-mode-console-prose.test.js` (new)

**Interfaces:**
- Produces the shape `console-resolve.js --run <dir> --ceiling`. It takes no other flag (anything else is exit 2), needs no ceiling, writes nothing, and runs after the anchoring check (exit 3 when unanchored). It prints exactly one line, `console-resolve.js: ceiling {tier} consoleAutoResolve {true|false} control-mode {on|off} source {cli|explicit|control-mode|invalid-autonomy|default}`, and exits 0. A policy read that throws prints `console-resolve.js: ceiling unreadable ({message})` and exits 3, so an unreadable policy never reads as `supervised`.
- New `review-console.md` L79 sentence (replacing the `resolve-policy.js --values … autonomy` form): resolve the ceiling once with `node "${CLAUDE_PLUGIN_ROOT}/bin/console-resolve.js" --run "$PIPELINE_RUN_DIR" --ceiling` (it folds run config over project policy and control mode under any explicit `autonomy`, as the resolve below does) and read its `consoleAutoResolve` word. `true` is the granted branch. Any non-zero exit is not granted: proceed to "Present a real stop". Keep the literal `bookkeepingPermissions(ceiling).consoleAutoResolve` in the sentence. Do not use the word `AskUserQuestion` anywhere in this section (`tests/review-console-unattended-no-ask-conformance.test.js` pins exactly two occurrences).

- [ ] **Step 1: Write the failing tests**

CLI cases in `control-mode-cli.test.js`:
- `'AC4.10: --ceiling reports unattended from control mode alone'`: stdout equals `console-resolve.js: ceiling unattended consoleAutoResolve true control-mode on source control-mode\n`; exit 0; the run dir is byte-identical before and after.
- `'AC4.11: --ceiling reports supervised and source explicit when autonomy is set'`.
- `'AC4.13: --ceiling with control mode off reports source default and control-mode off'`.
- `'--ceiling refuses any other flag'`: `--ceiling --dry-run` → exit 2.
- `'--ceiling: a relative --run resolves against deps.cwd()'`: the `cli-wrapper-contract` relative-path case.

`tests/control-mode-console-prose.test.js`, reading live prose (`[IL-80]` carve-out: the section is the declared contract `console-resolve.js` executes):
- `'AC1.1: the short-circuit pre-check resolves the ceiling through console-resolve.js --ceiling'`: the `## Auto-resolution short-circuit` section contains `console-resolve.js" --run "$PIPELINE_RUN_DIR" --ceiling` and no longer contains `resolve-policy.js" --values --run "$PIPELINE_RUN_DIR" autonomy`. Go-red: restoring the old command on a mutated copy throws with the assertion's own message.

- [ ] **Step 2: Run to verify failure**

Run: `node --test tests/bin-lib/console/control-mode-cli.test.js tests/control-mode-console-prose.test.js`
Expected: FAIL (`--ceiling` unknown flag, exit 2)

- [ ] **Step 3: Implement** the shape, the prose sentence and the `docs/plugin-structure.md` line. Byte check: `review-console.md` is 36,813 B before; this sentence changes it by under +200 B.

- [ ] **Step 4: Run to verify pass**

Run: `node --test tests/bin-lib/console/control-mode-cli.test.js tests/control-mode-console-prose.test.js tests/review-console-unattended-no-ask-conformance.test.js tests/console-resolve-conformance.test.js tests/wrap-up-merge-mode-conformance.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/console-resolve.js plugin/skills/wrap-up/review-console.md docs/plugin-structure.md tests/bin-lib/console/control-mode-cli.test.js tests/control-mode-console-prose.test.js
git commit -m "Add console-resolve.js --ceiling — the effective ceiling the console pre-check reads, refs #4620"
```

### Task 7: The packet gather reads the carried decisions

**Role:** integration

**Files:**
- Modify: `plugin/bin/acceptance-packet.js` (`gatherToFile`, around L674; a decision-specific `isDecisionEntryList` for `--decision-items` and the run-dir file)
- Modify: `plugin/bin/lib/wrap-up/packet-gather.js:546` (replace `passThroughFacts('decision', …)` with `decisionFacts(entries)`)
- Modify: `plugin/bin/lib/wrap-up/packet-validate.js:35` (`OPTIONAL_TEXT_FIELDS` gains the four decision fields)
- Modify: `plugin/bin/lib/wrap-up/packet-render.js:370` (the `decisions` renderer shows `suggestedResolution`)
- Modify: `plugin/skills/_shared/acceptance-packet.md:91-92` (the facts-document sentence lists the four decision fields as optional render fields)
- Modify: `plugin/skills/wrap-up/verification-brief.md:329` (add one sentence **after** the pinned sentence; do not edit the pinned sentence, `tests/acceptance-packet-wrap-up-conformance.test.js:894`)
- Test: `tests/control-mode-packet-gather.test.js` (new)

**Interfaces:**
- Consumes: the `decisions.json` that Task 5's `writeDecisionFacts` writes; `DECISION_FACT_FIELDS` (Task 2).
- Produces: `decisionFacts(entries)` in `packet-gather.js`. Same id encoding and `status: 'passed'`/`source: 'decision-items'` as `passThroughFacts('decision', 'decision-items', …)` today. It also copies each of `origin`, `summary`, `evidenceRef` and `suggestedResolution` that is a string onto the fact; absent fields stay absent. An entry carrying only `{ id, text }` therefore yields exactly today's fact, which keeps `tests/bin-lib/wrap-up/packet-gather.test.js:1029` green unmodified. `passThroughFacts` itself is unchanged for its other kinds.
- Produces: `OPTIONAL_TEXT_FIELDS` gains `origin`, `summary`, `evidenceRef` and `suggestedResolution` (string-typed when present). `isDecisionEntryList` = `isEntryList` plus those four as optional strings; `--decision-items` uses it too.
- Produces: the `decisions` renderer prints `- {text}`, then ` — decide: {suggestedResolution}` when that field is present. Both pass through `screenedInline` (`_shared/acceptance-packet.md`'s `## Untrusted content`: decision text renders). A fact without the field renders today's line byte for byte.
- Produces: in `gatherToFile`, when `opts.decisionItems === undefined` and `runDir !== null`, read `{runDir}/packet-facts/decisions.json` directly. ENOENT/ENOTDIR → `undefined` (section omitted, as today). Any other read error, a parse error, or a value failing `isDecisionEntryList` → `undefined`, plus a partial note `could not read {runDir}/packet-facts/decisions.json — carried decisions not shown`. A named `--decision-items` file still wins and keeps its existing `notReadNote` behavior.
- Prose sentence to add: "Under control mode the Review Console writes its carried decisions to `{run-dir}/packet-facts/decisions.json`, and `gather` reads that file itself whenever `--run` is passed with no `--decision-items`; a file it cannot read is stated as partial, never shown as no decisions."

- [ ] **Step 1: Write the failing tests**

- `'AC1.1: a contested finding carried by console-resolve.js appears under Decisions left for you'`. Build the run with the real `console-resolve.js` `run()` (Task 5's fixture shape; real-writer fixture), then call `acceptance-packet.js`'s `run(['gather', '--record', '7', '--out', out, '--run', runDir], deps)`. Assert exit 0. `facts.facts` holds exactly one `kind: 'decision'` fact, with id `decision:review:review-contested-1.md` (`:` is a safe character in `encodeFactKey`), `source: 'decision-items'`, `origin: 'review'`, `evidenceRef` ending `/staged/review-contested-1.md`, `suggestedResolution: 'decide whether the finding holds; fix it or decline'`, and `text` starting `Contested findings: review-contested-1.md`. `validateFactsShape(facts).errors` is `[]`. Then `render` it and assert that the line under the `Decisions left for you` heading is that text followed by ` — decide: decide whether the finding holds; fix it or decline`.
- `'a decision fact without suggestedResolution renders today\'s line unchanged'`, via `packet-render.js` directly.
- `'acceptance-packet.md lists each decision field as an optional render field, and OPTIONAL_TEXT_FIELDS carries each'`. Iterate the four fields against both, with a mutated-copy control that drops `suggestedResolution` from the prose.
- `'AC4.5: a carried coordination item with spaces and # in its id renders one line'`. Hand-write `decisions.json` with id `decision:review:decision:- STAGED 09:59:00 — x#ab12cd34` and text `t`. The gathered id matches `/^decision:[A-Za-z0-9._\/#:@%-]+$/`, and the render has exactly one line `t` under the heading.
- `'an unreadable decisions.json is stated as partial, never silence'`. File content `{`: `partial` includes the could-not-read note, and no decision fact exists. Go-red: making the reader return `undefined` silently fails the partial assertion.
- `'AC5.1: no decisions.json omits the section and adds no partial note'`.
- `'a named --decision-items wins over the run-dir file'`.
- Prose pin: `'verification-brief names the run-dir decisions.json read'`. The Step 4 slice contains the new sentence's `packet-facts/decisions.json` and `with no \`--decision-items\`` phrases, with a mutated-copy control.

- [ ] **Step 2: Run to verify failure**

Run: `node --test tests/control-mode-packet-gather.test.js`
Expected: FAIL (no decision fact)

- [ ] **Step 3: Implement** the default read and the sentence. Byte check: `verification-brief.md` is 37,090 B before, about +330 B after.

- [ ] **Step 4: Run to verify pass**

Run: `node --test tests/control-mode-packet-gather.test.js tests/acceptance-packet-cli.test.js tests/acceptance-packet-wrap-up-conformance.test.js tests/acceptance-packet-contract-conformance.test.js tests/bin-lib/wrap-up/packet-gather.test.js tests/bin-lib/wrap-up/packet-render.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/acceptance-packet.js plugin/bin/lib/wrap-up/packet-gather.js plugin/bin/lib/wrap-up/packet-validate.js plugin/bin/lib/wrap-up/packet-render.js plugin/skills/_shared/acceptance-packet.md plugin/skills/wrap-up/verification-brief.md tests/control-mode-packet-gather.test.js
git commit -m "Read carried decisions into the acceptance packet — gather defaults to the run's decisions.json, refs #4620"
```

### Task 8: Residue convergence

**Role:** judgment
**Review risk:** high (decides terminal states; a wrong state silently drops work)

**Files:**
- Create: `plugin/bin/lib/console/residue-convergence.js`
- Modify: `plugin/bin/console-resolve.js` (new `--converge <items.json>` shape)
- Modify: `plugin/skills/_shared/ledger-format.md` (one paragraph at the end of `#### Ledger narrowing`, before the Phase 2 table)
- Modify: `plugin/skills/wrap-up/review-console.md` (one sentence in "On approval" step 10)
- Modify: `docs/plugin-structure.md` (the `--converge` line)
- Test: `tests/bin-lib/console/residue-convergence.test.js` (new)
- Test: `tests/bin-lib/console/control-mode-cli.test.js`
- Test: `tests/control-mode-console-prose.test.js`

**Interfaces:**
- Consumes: `validateShaped` (`../compose-record/compose`), `deferReasonProblem` (`./reflect-destination`), `specShapedBody`/`recordPayload` (`../issues/record`), `decisionFactFor` (`./decision-facts`), and `writeDecisionFacts` plus `EXIT_CARRY_FAILED` (Task 5).
- Produces: `RESIDUE_STATES = Object.freeze(['resolved', 'filed', 'digested', 'carried'])` and `RESIDUE_FAILED = 'failed'`.
- Produces: `convergeResidue(items, { compose, carry }) -> Array<{ id, state, proposal?, fact?, error? }>`. `items` are `{ id, source: 'ledger'|'insight', text, status, deferReason?, belowFloor?, filingFailed? }`. `compose(item) -> proposal text` and `carry(item) -> fact` are injected, so tests can force failures. Decision order per item:
  1. `status` is anything but `open` → `resolved`.
  2. `belowFloor === true` → `digested`.
  3. Not `filingFailed`, and `compose` returns a proposal whose body passes `validateShaped(body).ok` and whose `Defer-reason:` header value passes `deferReasonProblem({ deferReason }) === null` → `filed` with `proposal`.
  4. Otherwise `carry(item)` → `carried` with `fact`.
  5. `carry` throws → `failed` with `error`.

  Every input item appears exactly once in the output.
- Produces: `composeResidueProposal(item) -> string`, the default `compose`. A `Title:`/`Type: task`/`Labels:`/`Defer-reason: {item.deferReason}` header plus `specShapedBody` (`currentState` quoting `item.text` fenced, a deliverable to settle it, `acceptanceCriteria`, `releaseNote: 'No user-visible change.'`, `filedBy: 'wrap-up'`). With no `deferReason`, the header carries none, so step 3 fails and the item carries.
- Produces the shape `console-resolve.js --run <dir> --converge <items.json>` (anchored `--run`, needs no ceiling grant). It reads a JSON array (a malformed file or element → exit 2) and runs `convergeResidue` with `carry` = `decisionFactFor({ id: item.id, section: item.source === 'insight' ? 'Reflection insights' : 'Ledger residue', resolution: 'pending', reason: item.text }, { runDir, staged: false })`. It writes every carried fact through `writeDecisionFacts` and prints `{ items: [{ id, state, proposal?, factId? }], failed: [ids] }` as JSON. Exit 0. A fact-write failure turns every carried item into `failed`, prints the JSON, names every such item on stderr, and exits 6. It logs one `AUTO` line per item (`Residue {id} ({source}): {state}`), with reversibility `n/a` for `carried`/`digested` and `high` for `filed`. `--dry-run` is not accepted for this shape (exit 2).
- `ledger-format.md` paragraph (cite, do not restate): under control mode (`console-resolve.js --ceiling` printing `control-mode on`), no remaining item reaches the drill below. Write every item still `open` as `{ id: 'ledger-{N}', source: 'ledger', text, status: 'open', deferReason, belowFloor }` to a session-temp JSON file, judging `belowFloor` per `_shared/materiality-floor.md` and `deferReason` per `wrap-up/residue-sweep.md`'s `remedy: record` mapping (absent when no mapping applies). Run `node "${CLAUDE_PLUGIN_ROOT}/bin/console-resolve.js" --run "$PIPELINE_RUN_DIR" --converge "{file}"`. Then, per item, by `state`:
  - `filed`: stage the printed proposal as Phase 3's `Keep` branch does, and write the row `deferred`.
  - `digested`: append the digest entry per `_shared/materiality-floor.md`, and write the row `deferred` (`→ digest`).
  - `carried`: write the row `deferred` with Resolution `carried to the acceptance packet as {factId}`.

  The `carried` row text matches Task 5's `LEDGER_CARRIED_RE`, so `pack.js` counts it as a complete deferral. Once a `filed` item is staged, it is a `ledger-record-*` console item. If the console later refuses it, or its create fails, it takes the one route Task 5 defines (`--set-item {id} --resolution carried --ledger …`), never `--converge` again. `filingFailed: true` is reserved for an item whose stage-item write itself failed before any staged file existed, which only `--converge` can still see. Exit 6, or any `failed` entry, stops with `flow/failure-cards.md`'s Generic gate failure card naming each item, never a question.
- `review-console.md` step 10 sentence: under control mode, a row the `refused-proposals.md` check refuses, or whose create fails, is not left refused. Converge it with `--converge`, as `source: 'insight'` with `filingFailed: true` for a failed create, through the same call and per-state handling `_shared/ledger-format.md`'s control-mode paragraph gives. An insights row is a row inside one staged file, not a console item, so `--set-item` cannot reach it.

- [ ] **Step 1: Write the failing tests**

`residue-convergence.test.js`:

```js
const items = [
  { id: 'ledger-1', source: 'ledger', text: 'fixed already', status: 'fixed' },
  { id: 'ledger-2', source: 'ledger', text: 'typo in a comment', status: 'open', deferReason: 'tangential', belowFloor: true },
  { id: 'ledger-3', source: 'ledger', text: 'locked worktree held by a live session', status: 'open', deferReason: 'blocked-external', belowFloor: false },
  { id: 'insight-4', source: 'insight', text: 'a convention to capture', status: 'open', belowFloor: false },
];
const carry = (it) => ({ id: `decision:console:${it.id}` });
test('AC2.1 AC2.2: every ledger row and insight ends resolved, filed, digested or carried — none left open', () => {
  const out = convergeResidue(items, { compose: composeResidueProposal, carry });
  assert.deepStrictEqual(out.map((o) => [o.id, o.state]), [['ledger-1', 'resolved'], ['ledger-2', 'digested'], ['ledger-3', 'filed'], ['insight-4', 'carried']]);
  assert.ok(out.every((o) => RESIDUE_STATES.includes(o.state)));
});
test('AC3.1: a filed residue record is spec-shaped and its Defer-reason passes the deferral gate', () => {
  const filed = convergeResidue([items[2]], { compose: composeResidueProposal, carry })[0];
  const [header, ...rest] = filed.proposal.split('\n\n');
  assert.deepStrictEqual(validateShaped(rest.join('\n\n')), { ok: true, gaps: [] });
  assert.strictEqual(deferReasonProblem({ deferReason: /^Defer-reason: (.+)$/m.exec(header)[1] }), null);
});
test('AC3.1 go-red: a proposal failing the shape check is never filed', () => {
  const bad = convergeResidue([items[2]], { compose: () => 'Title: x\nDefer-reason: blocked-external\n\nno sections', carry })[0];
  assert.strictEqual(bad.state, 'carried');
});
test('AC4.5: a gate rejection (unknown Defer-reason) carries the item as a decision fact', () => { /* deferReason 'because' → carried with fact */ });
test('AC4.5: a stage or create failure seen by --converge (filingFailed) carries the item', () => { /* filingFailed: true on items[2] → carried */ });
test('AC4.6: a failed carry reports failed with the error, never drops the item', () => {
  const out = convergeResidue([items[3]], { compose: composeResidueProposal, carry: () => { throw new Error('disk full'); } });
  assert.deepStrictEqual(out, [{ id: 'insight-4', state: 'failed', error: 'disk full' }]);
});
test('AC4.7: a below-floor item is digested and counts as terminal', () => { /* items[1] → digested; RESIDUE_STATES includes it */ });
test('every input item appears exactly once', () => { /* 4 in, 4 out, ids equal */ });
```

CLI (`control-mode-cli.test.js`):
- `'AC4.5: --converge writes carried items to decisions.json and prints each state'`.
- `'AC4.6: --converge with an unwritable decisions.json exits 6, marks the carried items failed and names them'`: pre-seed `packet-facts/decisions.json` with `not json`.
- `'--converge rejects a malformed items file with exit 2'`.

Prose (`control-mode-console-prose.test.js`), each with a mutated-copy control:
- `'AC2.1: ledger-format.md routes every open item through --converge under control mode'`. The `#### Ledger narrowing` slice holds `--converge`, `control-mode on`, all three state words (`filed`, `digested`, `carried`), and `Generic gate failure`.
- `'AC2.1: review-console.md step 10 converges a refused insight under control mode'`. The step-10 line holds `--converge` and `source: 'insight'`.

- [ ] **Step 2: Run to verify failure**

Run: `node --test tests/bin-lib/console/residue-convergence.test.js`
Expected: FAIL (`Cannot find module …/residue-convergence`)

- [ ] **Step 3: Implement** the module, the CLI shape and both prose edits. Byte check: `ledger-format.md` is 43,094 B before, about 44,100 B after (about 8,400 B of headroom, still under the 47,250 B flag). `review-console.md` grows about +250 B.

- [ ] **Step 4: Run to verify pass**

Run: `node --test tests/bin-lib/console/residue-convergence.test.js tests/bin-lib/console/control-mode-cli.test.js tests/control-mode-console-prose.test.js tests/deferral-gate-conformance.test.js tests/reflect-wrap-up-insights-staging-conformance.test.js tests/path-guard-conformance.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/console/residue-convergence.js plugin/bin/console-resolve.js plugin/skills/_shared/ledger-format.md plugin/skills/wrap-up/review-console.md docs/plugin-structure.md tests/bin-lib/console/residue-convergence.test.js tests/bin-lib/console/control-mode-cli.test.js tests/control-mode-console-prose.test.js
git commit -m "Converge run-end residue under control mode — every item ends resolved, filed, digested or carried, refs #4620"
```

### Task 9: Automatic, revertable memory writes

**Role:** integration
**Review risk:** high (writes outside the repository)

**Files:**
- Create: `plugin/bin/lib/console/memory-write.js`
- Modify: `plugin/bin/console-resolve.js` (new `--memory-write` shape)
- Modify: `plugin/skills/wrap-up/review-console.md` ("On approval" step 8: one control-mode sentence)
- Modify: `docs/plugin-structure.md` (the `--memory-write` line)
- Test: `tests/bin-lib/console/memory-write.test.js` (new)
- Test: `tests/control-mode-console-prose.test.js`

**Interfaces:**
- Consumes: `resolveWithin` and `lstatType` (`../path-guard`). Never bare `fs.existsSync`/`fs.realpathSync`.
- Produces: `MEMORY_DIFF_CAP_BYTES = 20 * 1024`.
- Produces: `wholeFileDiff(name, oldText /* string|null */, newText) -> string`, a single-hunk unified diff. The header is `--- a/{name}` (`--- /dev/null` on create), then `+++ b/{name}`, then `@@ -1,{oldLines} +1,{newLines} @@` (`-0,0` on create). Every old line is prefixed `-` and every new line `+`. A side with no trailing newline is followed by `\ No newline at end of file`.
- Produces: `planMemoryWrite({ memoryDir, target, content, priorText }) -> { ok: true, path, priorHash, diff, overCap } | { ok: false, why }`. `target` must resolve inside `memoryDir` (`resolveWithin`, symlinks followed); otherwise `{ ok: false, why: 'outside-memory-dir' }`. `priorHash` = sha256 hex of `priorText`, or `'none'` when `priorText === null`. `overCap` = `Buffer.byteLength(diff) > MEMORY_DIFF_CAP_BYTES`. Pure: the caller reads and writes.
- Produces the shape `console-resolve.js --run <dir> --memory-write <target> --memory-dir <dir> --content-file <file>` (anchored `--run`, no ceiling grant). It reads the prior target directly (ENOENT → `null`) and plans the write. On `ok: false` it prints `console-resolve.js: memory write refused ({why}) — nothing written` and exits 5. Otherwise it writes the target with `writeFileAtomic`. When `overCap`, it writes the prior content to `{runDir}/staged/.memory-prior-{sha12}.md` first, and the entry names that path in place of the diff. The name is dot-prefixed because `resolve.js`'s `readRunFiles` drops `staged/` names starting with `.` (L340), so the backup never becomes a console item. Then one `AUTO` entry under `/wrap-up`, step `Memory write`: `Memory write {path}: prior sha256 {priorHash}; diff (reverse with git apply -R):` followed by the diff as an indented block, written with `formatEntry` plus a `--text`-equivalent string, reversibility `high`. Exit 0. A failed target write exits 3 and writes no entry. A failed entry exits 3 with stderr naming the written path.
- `review-console.md` step 8 sentence: under control mode each `M#` Apply writes through `node "${CLAUDE_PLUGIN_ROOT}/bin/console-resolve.js" --run "$PIPELINE_RUN_DIR" --memory-write "{file}" --memory-dir "{memory dir}" --content-file "{temp file}"`, then the `MEMORY.md` index line the same way. There is no approval step. Exit 5 stops with the generic failure card. No `AskUserQuestion` word in this sentence.

- [ ] **Step 1: Write the failing tests**

- `'AC4.1: a memory write logs the path, the prior hash and the old-to-new diff'`. Prior `a\nb\n` → new `a\nc\n`. `decisions.md` holds `Memory write {path}: prior sha256 {sha256('a\nb\n')}`, plus a diff containing `-b` and `+c`.
- `'AC4.1: a create logs prior sha256 none and a /dev/null diff'`.
- `'AC4.2: applying the reverse diff restores the prior content'`. Extract the diff from the entry, write it to a temp file, run `git apply -R --unidiff-zero {patch}` with `cwd` the memory dir (`execFileSync('git', …, { windowsHide: true })`), and assert the file equals `a\nb\n`. Repeat for a no-trailing-newline prior. For the create case, reverse-applying removes the file.
- `'AC4.2: an over-cap diff stores the prior content under staged/ and names it'`. The stored path is `staged/.memory-prior-{sha12}.md`, and the entry names it.
- `'an over-cap backup never becomes a console item'`. After the over-cap write, call `resolveAll({ runDir, policy: 'console-auto', deps })` over the same run dir, then remove the backup and call it again. The two `items` arrays are deep-equal (no extra item), and no item id contains `memory-prior`. Go-red: renaming the backup without the leading dot yields one extra `pending` (unmapped-prefix) item.
- `'AC4.3: no approval prompt — the CLI source names no AskUserQuestion'`. `console-resolve.js` and `memory-write.js` sources do not include `AskUserQuestion`.
- `'AC4.4: a write outside the memory dir is refused and writes nothing'`. Cases: `../escape.md`, an absolute path elsewhere, and a symlink inside the memory dir pointing out. Each exits 5; no file is created and `decisions.md` is unchanged.
- Prose: `'review-console.md step 8 routes control-mode memory writes through --memory-write'`, with a mutated-copy control.

- [ ] **Step 2: Run to verify failure**

Run: `node --test tests/bin-lib/console/memory-write.test.js`
Expected: FAIL (`Cannot find module …/memory-write`)

- [ ] **Step 3: Implement** the module, the CLI shape and the step-8 sentence. Byte check: `review-console.md` grows about +300 B.

- [ ] **Step 4: Run to verify pass**

Run: `node --test tests/bin-lib/console/memory-write.test.js tests/control-mode-console-prose.test.js tests/review-console-unattended-no-ask-conformance.test.js tests/path-guard-conformance.test.js tests/windows-hide-spawn-conformance.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/console/memory-write.js plugin/bin/console-resolve.js plugin/skills/wrap-up/review-console.md docs/plugin-structure.md tests/bin-lib/console/memory-write.test.js tests/control-mode-console-prose.test.js
git commit -m "Write memory automatically under control mode — logged with prior hash and a reversible diff, refs #4620"
```

### Task 10: The ceiling contract prose, the policy marker, and the HARD-GATE pins

**Role:** integration

**Files:**
- Modify: `plugin/skills/_shared/autonomy-ceiling.md`. In `## Precedence`, add rung `4. \`control-mode: on\` (run config or \`policy.yml\`) → \`unattended\`` and renumber the skill default to `5`. Add one sentence naming `console-resolve.js --run <dir> --ceiling` as the query, and that an invalid `autonomy` value suppresses rung 4. Add a new `## Control mode (#4620)` section after `## Precedence`.
- Modify: `plugin/skills/_shared/policy-schema-read-path.md:35` (replace "and `autonomy` is unchanged" with "and the resolved `autonomy` value is unchanged — the bookkeeping ceiling composes control mode below an explicit `autonomy` (`_shared/autonomy-ceiling.md`'s Precedence)"), and line 41's owner cell (`none yet (#4608)` → `` `/claude-tweaks:wrap-up` (the Review Console's carry route and residue convergence, #4620); the rest of its implied set, #4624 ``).
- Modify: `plugin/bin/lib/policy-schema.js:191` (summary drops `Not yet used. `) and line 190's comment (`control-mode -> #4624` → `control-mode -> #4620 (the bookkeeping ceiling, bin/lib/issues/autonomy.js's effectiveCeiling) and #4624 (the rest of its implied set)`).
- Modify: `tests/resolve-policy-control-mode.test.js:300` (remove `'control-mode'` from `NOT_YET_USED`; the one allowed deletion).
- Test: `tests/control-mode-hard-gates-conformance.test.js` (new)

`## Control mode (#4620)` content. It must state each item below; size about 2,000 B. Phrase it so no sentence also lands inside an existing test's slice, per `skill-prose-conformance-tests`' silent-direction rule: grep `tests/` for `autonomy-ceiling.md` anchors first (`console-execution.test.js`, `release-run-dir-lifecycle-conformance.test.js`, `work-record-needs-decision-conformance.test.js`, `flow-pre-authorize-merge-token.test.js`, `auto-merge-short-circuit-cant-tell.test.js`), and keep the section outside each one's slice.
1. **Composition.** Control mode implies the `unattended` capability set through `effectiveCeiling`. An explicit `autonomy` wins, and `--ceiling` reports `source explicit`.
2. **Carry route.** Every item the console would leave `pending`, `keep-staged` or `refused` resolves `carried` and becomes a `decision` fact in `{run-dir}/packet-facts/decisions.json` (`_shared/acceptance-packet.md`'s Decision facts). Can't-tell items still file.
3. **Residue terminal states.** `resolved`, `filed` (a spec-shaped record passing the deferral gate, authorized by `queueWriteAutoFile`), `digested` (`_shared/materiality-floor.md`), and `carried`. A failed carry is a failure card naming the item.
4. **Memory writes.** Logged path, prior hash, and reversible diff (`console-resolve.js --memory-write`).
5. **HARD-GATEs.** "Every HARD-GATE in `_shared/auto-mode-contract.md`'s "What `auto` does NOT silence" table, its merge-conflict resolution row included, still stops a control-mode run; the stop is reported with `flow/failure-cards.md`'s Generic gate failure card, never as a question." Nothing in the carry route or residue convergence applies to a HARD-GATE.

- [ ] **Step 1: Write the failing tests** (`tests/control-mode-hard-gates-conformance.test.js`; live reads, `[IL-80]` carve-out stated in the header: the table is the canonical gate list this record cites)

```js
// One anchor per gate on the HARD-GATE row, plus the separate merge-conflict row.
const GATES = [
  ['review spec compliance', '`/review` Step 1 spec compliance'],
  ['review test gate', '`/review` Step 1.5 test gate'],
  ['flow design-doc rejection', '`/flow` Step 2.7 design-doc rejection'],
  ['build plan validation', '`/build` Design Step 3 plan validation'],
  ['build plan audit', '`/build` Common Step 1.5 plan audit hard-fails'],
  ['multi-spec boundary freshness', 'multi-spec boundary-freshness escalation'],
  ['release Step 4 gates', '`/release` Step 4\'s two gates'],
  ['test PR-bookkeeping precondition', '`/test` Step 0 (PR-bookkeeping precondition check)'],
  ['adopted-branch collision', 'adopted-branch collision stop'],
  ['plan-review spec gap', 'plan-review needs-human spec gap'],
  ['adopted-run PR-conflict catch-up', 'adopted-run PR-conflict catch-up stop'],
  ['dispatch missing-claim fallback', 'second-call missing-claim fallback'],
  ['unresolvable merge conflict', 'Resolution of merge conflicts in worktree finishing'],
];
function notSilencedRows(contract) { /* the table rows under "What `auto` does NOT silence"; returns the HARD-GATE row text and the merge-conflict row text */ }
function controlModeSection(ceiling) { /* slice '## Control mode (#4620)' to next '## ' */ }
function assertGateStops(contract, ceiling, [name, anchor]) {
  const rows = notSilencedRows(contract);
  assert.ok(rows.some((r) => r.includes(anchor)), `${name}: not on the exemption list`);
  const cm = controlModeSection(ceiling);
  assert.match(cm, /What `auto` does NOT silence/, `${name}: control-mode section does not cite the table`);
  assert.match(cm, /merge-conflict resolution row included/, `${name}: merge conflicts not named`);
  assert.match(cm, /Generic gate failure card, never as a question/, `${name}: failure card not named`);
}
for (const gate of GATES) test(`AC6.1: ${gate[0]} still stops under control mode and is reported with the generic failure card`, () => assertGateStops(CONTRACT, CEILING, gate));
test('AC6.1 go-red: a gate missing from the contract fails its own assertion', () => {
  const m = CONTRACT.replace('`/review` Step 1.5 test gate', '`/review` test step');
  assert.notStrictEqual(m, CONTRACT);
  assert.throws(() => assertGateStops(m, CEILING, GATES[1]), { message: /review test gate: not on the exemption list/ });
});
test('AC6.1 go-red: dropping the failure-card clause fails', () => { /* mutate CEILING → throws /failure card not named/ */ });
test('AC6.1: control mode adds no capability that could silence a gate', () => {
  assert.deepStrictEqual(Object.keys(bookkeepingPermissions(null, { controlMode: true })).sort(), Object.keys(bookkeepingPermissions('unattended')).sort());
});
test('AC4.10: autonomy-ceiling.md Precedence names the control-mode rung below explicit sources', () => { /* rung order: config.yml < policy.yml < control-mode < supervised, by indexOf, with a permuted-copy control */ });
test('policy-schema-read-path.md names the control-mode owner', () => { /* row 41's owner cell includes '#4620', mutated-copy control */ });
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test tests/control-mode-hard-gates-conformance.test.js`
Expected: FAIL (no `## Control mode (#4620)` heading in `autonomy-ceiling.md`). Then remove `'control-mode'` from `NOT_YET_USED` and confirm `node --test tests/resolve-policy-control-mode.test.js` fails on the marker before the summary changes.

- [ ] **Step 3: Implement** the prose, the schema summary and comment, and the list edit. Byte check: `autonomy-ceiling.md` is 38,024 B before, about 40,300 B after (about 12,200 B of headroom). `policy-schema-read-path.md` is 9,347 B before, about +250 B after.

- [ ] **Step 4: Run to verify pass**

Run: `node --test tests/control-mode-hard-gates-conformance.test.js tests/resolve-policy-control-mode.test.js tests/policy-schema-metadata.test.js tests/policy-schema.test.js tests/policy-key-naming.test.js tests/risk-flags-refine-prose.test.js tests/console-execution.test.js tests/console-resolve-conformance.test.js tests/release-run-dir-lifecycle-conformance.test.js tests/work-record-needs-decision-conformance.test.js tests/flow-pre-authorize-merge-token.test.js tests/auto-merge-short-circuit-cant-tell.test.js tests/deferral-gate-conformance.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/_shared/autonomy-ceiling.md plugin/skills/_shared/policy-schema-read-path.md plugin/bin/lib/policy-schema.js tests/resolve-policy-control-mode.test.js tests/control-mode-hard-gates-conformance.test.js
git commit -m "Document control mode in the autonomy ceiling — composition, carry, residue, HARD-GATEs, refs #4620"
```

### Task 11: The console's control-mode branch and the carried route

**Role:** integration

**Files:**
- Modify: `plugin/skills/wrap-up/review-console.md`. Add one paragraph in `## Auto-resolution short-circuit (\`consoleAutoResolve\`)`, after the "Can't-tell filings" paragraph. Add exit 6 to its "Non-zero exits" sentence.
- Modify: `plugin/skills/wrap-up/review-console-appendix.md`. Add a `- \`carried\`` bullet in `### Resolution-to-step mapping`, and exit 6 in its "Non-zero exit codes" section.
- Test: `tests/control-mode-console-prose.test.js`

Control-mode paragraph (no `AskUserQuestion` word; about 900 B). It must state each of these:
- **Trigger and resolution.** Under control mode (`--ceiling` printing `control-mode on` with `source control-mode`), the same call resolves every policy-resolvable item as above.
- **The carry.** Every item it would have left `pending`, `keep-staged` or `refused` resolves `carried` instead: a `decision` fact in `{run-dir}/packet-facts/decisions.json` that the acceptance packet's Decisions left for you section renders (`_shared/acceptance-packet.md`'s Decision facts).
- **No residue.** The CLI then prints no Needs a human block, and nothing reaches the run's final stop as console residue.
- **The one route for failed or refused items.** A Queue-write, `ledger-record-*` or can't-tell item that resolve carried, or whose create fails at execution, takes `console-resolve.js --run "{item-run-dir}" --set-item {id} --resolution carried --reason '{why}'` rather than `keep-staged`. A `ledger-record-*` item adds `--ledger "{ledger path}"` (this run's ledger, `pack.ledger`'s `value.files`), and that call settles its ledger row `deferred` with `carried to the acceptance packet as {factId}`. Run it once for every carried `ledger-record-*` item right after the resolve, and on any failed create. Exit 5 or 3 stops with the Generic gate failure card.
- **Exit 6.** Stop with `flow/failure-cards.md`'s Generic gate failure card naming each item stderr lists.
- **Unchanged.** `#3944`'s tiebreak still runs first.
- **Off mode.** Outside control mode none of this applies.

Appendix bullet: "`carried` — execute **nothing** at the console: the item's decision fact is already in `{run-dir}/packet-facts/decisions.json` and reaches the human through the acceptance packet (`verification-brief.md`'s gather). It is terminal — not residue, so archival proceeds."

- [ ] **Step 1: Write the failing tests** (all in `control-mode-console-prose.test.js`, each claim with its own mutated-copy control asserting the helper's own message)

- `'AC1.1: the short-circuit names the control-mode carry into the packet'`. The section holds `resolves \`carried\``, `packet-facts/decisions.json` and `Decisions left for you`.
- `'AC2.1: under control mode no console item reaches the final stop as residue'`. The section holds `prints no Needs a human block`.
- `'AC7.1: a needs-human-decision ruling is carried, not applied'`. The section's carry sentence names `pending` (the resolution `sdd-ruling-needs-human-decision` takes).
- `'AC6.1: exit 6 stops with the generic failure card'`, in both review-console.md and the appendix.
- `'AC2.1: the one route for a failed or refused item settles a ledger-record row through --set-item --ledger'`. The section holds `--resolution carried`, `--ledger "{ledger path}"` and `carried to the acceptance packet as {factId}`, and never pairs `keep-staged` with that route.
- `'the appendix mapping routes carried to execute nothing'`. Model it on `droppedRoute` in `tests/review-console-unattended-no-ask-conformance.test.js`.
- `'carried is pinned code-to-prose'`. `require(resolve.js).CARRIED_RESOLUTION` appears as `` `carried` `` in the mapping bullet, and every entry of `CARRY_FROM` appears in the review-console carry sentence (iterate the export; non-empty floor).

- [ ] **Step 2: Run to verify failure**

Run: `node --test tests/control-mode-console-prose.test.js`
Expected: FAIL (no carry paragraph)

- [ ] **Step 3: Implement** both prose edits. Before editing, grep `tests/` for `review-console.md`'s `SHORT_CIRCUIT` slice anchors (`tests/review-console-unattended-no-ask-conformance.test.js`'s `PENDING`, `REUSES_ONLY`, `ARCHIVAL`, `STALE_CLAIM`, `FETCH_ALL` needles) and keep the new paragraph free of those phrases. Byte check: `review-console.md` should land near 38,500 B after Tasks 6, 8, 9 and 11 (about 14,000 B of headroom). The appendix is 20,775 B before, about +450 B after. Record the measured numbers.

- [ ] **Step 4: Run to verify pass**

Run: `node --test tests/control-mode-console-prose.test.js tests/review-console-unattended-no-ask-conformance.test.js tests/console-failed-execution-residue-conformance.test.js tests/sdd-ruling-ratify-files-record-conformance.test.js tests/build-sdd-ruling-deferral-gate.test.js tests/reflect-wrap-up-insights-staging-conformance.test.js tests/bin-lib/skill-audit/context-cost.test.js tests/bin-lib/skill-audit/anti-patterns.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/wrap-up/review-console.md plugin/skills/wrap-up/review-console-appendix.md tests/control-mode-console-prose.test.js
git commit -m "Describe the console's control-mode branch — carried items route to the packet, refs #4620"
```

### Task 12: Whole-change verification

**Role:** transcription

**Files:**
- Test: no new file. Verification only.

- [ ] **Step 1: AC5 unmodified-suite check (Waived-free form of AC5.1)**

Run: `git diff --numstat origin/main...HEAD -- tests`
Expected: every pre-existing test file shows `0` in the deletions column, except `tests/resolve-policy-control-mode.test.js` (`1`). Named: `AC5.1: pre-existing console, resolve and wrap-up suites pass unmodified`.

- [ ] **Step 2: Retirement sweep for the replaced pre-check form**

Run: `git grep -n -F 'resolve-policy.js" --values --run "$PIPELINE_RUN_DIR" autonomy' -- plugin docs ':!docs/superpowers/plans' ':!.claude-tweaks/pipelines'`
Expected: no hits (exit 1). Control, recorded at authoring time: the same search with `HEAD` before `--` printed `HEAD:plugin/skills/wrap-up/review-console.md:79:Resolve the ceiling once — …`, so the search can match its target. The two exclusions were added per #4579.

- [ ] **Step 3: Sweep the exit-code and verb lists** (`cli-wrapper-contract`)

Run: `git grep -n -F -e '--check-repair' -- plugin docs .claude/skills`
Expected: every file listed also names `--ceiling`, `--converge`, `--memory-write` and exit 6, or carries a stated no-change in the PR body. Then run `git grep -n -e 'console-resolve' -- plugin/skills docs` and read each line that states an exit code. The journey `docs/journeys/resolve-the-unattended-console-in-one-process-1932.md` describes the resolve shape only, so it is a stated no-change.

- [ ] **Step 4: Run the impact-selected suite (AC8.1)**

Run: `npm test > "$PIPELINE_RUN_DIR/evidence/npm-test.txt" 2>&1` (after `mkdir -p "$PIPELINE_RUN_DIR/evidence"`)
Expected: exit 0. `AC8.1: npm test passes` is logged as `AC evidence` with the counts read from that file.

Waived AC8.1: no test can assert that the suite passes. This step's `npm test` run is the check, and its counts are logged as `AC evidence`.

- [ ] **Step 5: Run the full suite before merge (byte-pinned prose)**

Run: `npm test -- --full > "$PIPELINE_RUN_DIR/evidence/npm-test-full.txt" 2>&1`
Expected: exit 0. A count that varies run-to-run is re-run per file in isolation before anything is concluded (CLAUDE.md).
