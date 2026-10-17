# wrap-up-pack closing-record set + parked-at-shaping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `wrap-up-pack.json`'s `inputs` carries `closingRecords` (header-sourced records only) and `parkedAtShaping` (per-record header flag), so every closing-keyword reader and Section E's parked restore read one pack field instead of restating Ruling R1 or re-reading the worktree header mirror.

**Architecture:** `pack.js` owns the rule once: a new exported `closingRecords({records, source})` keeps records only for the `headers`/`worktree-headers` rungs, and `resolveRecords` also returns each header record's `parked-at-shaping` flag. `resolveInputs` surfaces both on `inputs`. `engine-verify.js` drops its local `HEADER_SOURCES` set and calls `closingRecords`; the three wrap-up prose readers cite `inputs.closingRecords`, Section E cites `inputs.parkedAtShaping`, and one sentence in Section C step 2 is the field's only description.

**Tech Stack:** Node 18+ CommonJS, `node --test`, markdown skill prose.

**Spec:** `.claude-tweaks/pipelines/2026-10-17T192009-record-3399/work/3399-spec.md` (record #3399)

## Global Constraints

- Ruling R1 (unchanged semantics): a record may receive a closing keyword only when `sources.records` is `headers` or `worktree-headers`; a `manifest`/`worktree-manifest` rung lists `not-run`/`failed` specs whose PR line is `Refs`.
- `wrap-up-pack.json`'s top-level key set is unchanged (`tests/bin-lib/wrap-up/pack-cli.test.js:61` pins it) — the new fields live under `inputs` only.
- `plugin/skills/wrap-up/SKILL.md` is NOT edited: `tests/release-lifecycle-byte-budget.test.js` caps it at 36,390 bytes and it is 36,379 (11 bytes headroom).
- Premise reversal (logged in decisions.md): Deliverable 1 names a `--render` to update; `wrap-up-pack.js` has no `--render` flag (USAGE is `--run/--json/--only/--print`). Only `inputs` and the pack-field prose-consumer conformance test change.
- Commit messages: `{Verb} {what} — {detail}`, reference the record as `refs #3399` (never `closes`/`fixes`).

Waived AC4.1: a suite-wide pass is not a test of its own — Task 2 Step 6 runs `npm test` and `/build` Common Step 5 re-runs it as the producer of the pass stamp.

## Review Focus

1. A body line `parked-at-shaping: true` below the frontmatter (record bodies are verbatim, quoted text) must not read as parked — only the frontmatter block counts. Pinned in Task 1.
2. A `worktree-manifest` rung (the real pr-first dispatch-bundle shape, #2391) must yield an empty closing set, not only the `manifest` rung. Pinned in Task 1.
3. `parkedAtShaping` serializes through JSON with string keys — the prose read is `inputs.parkedAtShaping["{issue}"]`, so the test reads it back through `JSON.parse(JSON.stringify(inputs))`. Pinned in Task 1.
4. A `cleanup-only` run skips Phase 3, so no pack exists when Section E runs — the restore must still have a value. Section E produces the pack before item 4 removes the worktree; pinned in Task 2.
5. `engine-verify.js`'s `resolvedIssueNumbers` must keep falling through to `verify-expectations.json`'s `issues` on a manifest rung — the existing #3365 "Ruling R1" test (`tests/bin-lib/wrap-up/engine-verify.test.js:1160`) pins it and must stay green unmodified.

---

### Task 1: `pack.js` closing set + parked flag, `engine-verify.js` consumer

**Files:**
- Modify: `plugin/bin/lib/wrap-up/pack.js`
- Modify: `plugin/bin/lib/wrap-up/engine-verify.js`
- Test: `tests/bin-lib/wrap-up/pack.test.js`

**Interfaces:**
- Produces (pack.js, add to `module.exports`): `closingRecords({ records: number[], source: string }) -> number[]` — returns `records` when `source` is `'headers'` or `'worktree-headers'`, else `[]`. Backed by a module-level `const CLOSING_RECORD_SOURCES = new Set(['headers', 'worktree-headers'])` (not exported).
- Produces (pack.js): `resolveRecords(deps, runDir, worktree)` now returns `{ records, source, parkedAtShaping }`, where `parkedAtShaping` is an object keyed by record number → boolean, populated for the two header rungs only and `{}` for `manifest`/`worktree-manifest`/`unavailable`. Existing callers (`console/resolve.js:173` reads `.records`; `engine-verify.js:426` destructures `records, source`; three `pack.test.js` destructures) are unaffected — grep `resolveRecords(` over `plugin/` and `tests/` shows no whole-object equality assertion.
- Produces (pack.js): `resolveInputs(...)` return object gains `closingRecords: number[]` (= `closingRecords(resolution)`) and `parkedAtShaping: {[n]: boolean}` (= the resolution's map). `inputs.records` and `inputs.sources.records` are unchanged.
- Produces (pack.js): `headerRecords(deps, dir)` stays exported with the same `number[]` return; its file reads move into a new internal `headerEntries(deps, dir) -> Array<{ record: number, parkedAtShaping: boolean }>` (sorted by record, one entry per record; `parkedAtShaping` is true when any file for that record carries the flag). The flag is read only from the leading frontmatter block (`/^---\r?\n([\s\S]*?)\r?\n---/`, then `/^parked-at-shaping:\s*true\s*$/m` inside it); `record:` keeps its current whole-text regex.
- Consumes (engine-verify.js): replace `HEADER_SOURCES` and its `.has(source) && records.length` test with `const closing = closingRecords(resolveRecords(RECORD_DEPS, runDir, recordedWorktree(runDir))); if (closing.length) return closing;`. Import `closingRecords` alongside `resolveRecords` at line 31. Update the comment block above `RECORD_DEPS` to say the header-rung rule lives in `pack.js`'s `closingRecords`.

- [ ] **Step 1: Write the failing tests** — append to `tests/bin-lib/wrap-up/pack.test.js`, importing `closingRecords` in the existing destructure at line 8:

```js
test('AC1.1: a pack built from a manifest-only parent run dir has inputs.records non-empty and inputs.closingRecords empty', () => {
  // same fixture as the existing "resolveInputs (c)" test: manifest.yml ids 1930/1931 + spec-1932/work header
  const inputs = resolveInputs({ runDir: dir, cwd: '/w/tree', deps: okDeps() });
  assert.deepStrictEqual(inputs.records, [1930, 1931, 1932]);
  assert.strictEqual(inputs.sources.records, 'manifest');
  assert.deepStrictEqual(inputs.closingRecords, []);
  assert.deepStrictEqual(inputs.parkedAtShaping, {});
});

test('AC1.2: a header-resolved pack has inputs.closingRecords equal to inputs.records (rung a and rung b)', () => {
  const own = resolveInputs({ runDir: fixtureRunDir(), cwd: '/w/tree', deps: okDeps() });
  assert.strictEqual(own.sources.records, 'headers');
  assert.deepStrictEqual(own.closingRecords, own.records);
  assert.deepStrictEqual(own.closingRecords, [1535]);
  const { runDir } = mirrorFixture();
  const mirrored = resolveInputs({ runDir, cwd: '/nowhere', deps: okDeps() });
  assert.strictEqual(mirrored.sources.records, 'worktree-headers');
  assert.deepStrictEqual(mirrored.closingRecords, [1930]);
});

test('closingRecords keeps records only for the two header rungs (Ruling R1, decided once)', () => {
  for (const source of ['headers', 'worktree-headers']) assert.deepStrictEqual(closingRecords({ records: [7, 8], source }), [7, 8]);
  for (const source of ['manifest', 'worktree-manifest', 'unavailable']) assert.deepStrictEqual(closingRecords({ records: [7, 8], source }), []);
});

test('#3399: a worktree-manifest rung yields an empty closing set', () => {
  // reuse the #2391 fixture shape (spec-2283/spec-2338 headers only in the worktree mirror)
  assert.strictEqual(inputs.sources.records, 'worktree-manifest');
  assert.deepStrictEqual(inputs.closingRecords, []);
});

test('#3399: parkedAtShaping reads each closing record\'s frontmatter flag, keyed by record number through JSON', () => {
  // mirror fixture whose 1930 header frontmatter carries `parked-at-shaping: true`
  const round = JSON.parse(JSON.stringify(resolveInputs({ runDir, cwd: '/nowhere', deps: okDeps() })));
  assert.strictEqual(round.parkedAtShaping['1930'], true);
  const plain = resolveInputs({ runDir: fixtureRunDir(), cwd: '/w/tree', deps: okDeps() });
  assert.deepStrictEqual(plain.parkedAtShaping, { 1535: false });
});

test('#3399: a parked-at-shaping line in the record body below the frontmatter does not count', () => {
  // header: '---\nrecord: 1930\n---\n# 1930\n\nparked-at-shaping: true\n'
  assert.strictEqual(inputs.parkedAtShaping[1930], false);
});
```

The parked-fixture variants write the header text directly (extend `mirrorFixture` with an optional `headerText(n)` parameter defaulting to today's `---\nrecord: ${n}\n---\n`, or write the file inline in the test — either is fine; do not change existing tests' fixtures).

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/wrap-up/pack.test.js`
Expected: FAIL — `closingRecords is not a function` / `inputs.closingRecords` undefined.

- [ ] **Step 3: Implement the Interfaces above in `pack.js`, then switch `engine-verify.js` to `closingRecords`**

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/wrap-up/pack.test.js tests/bin-lib/wrap-up/engine-verify.test.js tests/bin-lib/wrap-up/pack-cli.test.js tests/bin-lib/console/resolve.test.js`
Expected: PASS, 0 failures (engine-verify's existing #3365 manifest-rung "Ruling R1" test stays green unmodified — it is the characterization test for the refactor).

- [ ] **Step 5: Prove discrimination** — temporarily make `closingRecords` return `records` unconditionally, re-run `node --test tests/bin-lib/wrap-up/pack.test.js tests/bin-lib/wrap-up/engine-verify.test.js`, confirm AC1.1, the worktree-manifest test and engine-verify's manifest-rung test go red, then restore (verify with `git diff` that only intended changes remain).

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/lib/wrap-up/pack.js plugin/bin/lib/wrap-up/engine-verify.js tests/bin-lib/wrap-up/pack.test.js
git commit -m "Add closingRecords and parkedAtShaping to wrap-up-pack inputs — refs #3399"
```

---

### Task 2: Readers cite the pack fields; conformance pins

**Files:**
- Modify: `plugin/skills/wrap-up/cleanup-procedures-execution.md` (Section C step 2 prose + snippet; Section E preamble; Section E step 7)
- Modify: `plugin/skills/wrap-up/execution-and-verification.md` (current-branch `Fixes` issue-set sentence)
- Modify: `plugin/skills/wrap-up/review-console.md` (On-approval step 11's `issues` clause)
- Modify: `plugin/skills/wrap-up/cleanup-procedures.md` (Canonical cleanup list ordering-rule parenthetical)
- Test: `tests/wrap-up-record-resolution-conformance.test.js` (re-point the pins listed below)
- Test: `tests/wrap-up-pack-conformance.test.js` (add the inputs-field prose-consumer test)

**Interfaces:**
- Consumes: Task 1's `inputs.closingRecords` and `inputs.parkedAtShaping`, and `pack.js`'s exported `closingRecords`.
- Prose pins this task must re-point (grepped `tests/` for phrases from each edited block): `tests/wrap-up-record-resolution-conformance.test.js` lines 58-62 (step 2 `inputs.records`), 64-67 (step 2 `worktree-headers`), 69-72 (Section E "read at the start of Phase 4's execution step … from the worktree mirror"), 74-77 (Section E current-branch header read), 96-103 (step 11 `inputs.records`), 106-109 (current-branch `sources.records`). No other suite pins these phrases; `tests/verify-expectations-writer-conformance.test.js` pins step 11's `--issues {n}[,{m}]` CLI form, which stays.

Exact replacements (keep surrounding text as is). The quoted old spans are line-wrapped in the files (e.g. Section E's "The one\nexception: step 7's …" at lines 332-335) — match on content, and re-wrap the new text to the file's existing ~100-column width:

1. **Section C step 2** — replace the span from `Otherwise, take the issue set from` through `(Ruling R1). Only when the pack is absent` with:

   > Otherwise, take the issue set from `{run-dir}/wrap-up-pack.json`'s `inputs.closingRecords` (Phase 3's fact pack). That field is the one place wrap-up decides which records a run may close (Ruling R1, `pack.js`'s `closingRecords`): it equals `inputs.records` when `inputs.sources.records` is `headers` or `worktree-headers` — a materialized header, read from the worktree's mirror of the run dir until the header reaches the main checkout by merge — and is empty on a `manifest`/`worktree-manifest` rung, whose ids include `not-run`/`failed` specs with no closing keyword to stamp. Every other closing-keyword reader cites this field rather than restating the rule. Only when the pack is still absent

   and replace the snippet's `node -e` line with (run once at plan time against a sample pack: printed `3399 12`):

   ```bash
     ISSUES=($(node -e 'const p=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));console.log(((p.inputs&&p.inputs.closingRecords)||[]).join(" "))' "$PACK"))
   ```

2. **execution-and-verification.md** — replace `` `inputs.records` when non-empty and its `sources.records` is `headers` or `worktree-headers` (a multi-spec current-branch run can resolve more than one; a `manifest`/`worktree-manifest` source lists specs that never ran, whose line is `Refs`, so it never feeds `Fixes`), otherwise `` with:

   > `inputs.closingRecords` when non-empty (a multi-spec current-branch run can resolve more than one; which records a run may close is defined once, at `cleanup-procedures-execution.md`'s Section C step 2), otherwise

3. **review-console.md step 11** — replace `` `{run-dir}/wrap-up-pack.json`'s `inputs.records` when non-empty and the pack's `inputs.sources.records` reads `headers` or `worktree-headers` (a `manifest`/`worktree-manifest` source names a sibling spec's id, not this run's own closing reference — Ruling R1), else `` with:

   > `{run-dir}/wrap-up-pack.json`'s `inputs.closingRecords` when non-empty (the records this run may close — `cleanup-procedures-execution.md`'s Section C step 2), else

4. **Section E preamble** — replace `The one exception: step 7's `parked-at-shaping` read happens at the very start of this execution step, before item 4 runs — item 4 removes the worktree that field is read from, and nothing else in the canonical list reads it earlier.` with:

   > Step 7's `parked-at-shaping` value comes from `{run-dir}/wrap-up-pack.json`'s `inputs.parkedAtShaping`, which Phase 3 read from the materialized header while the worktree still existed, so the read has no ordering constraint of its own. A `cleanup-only` run skips Phase 3: when the pack is absent, produce it at the very start of this execution step, before item 4 removes the worktree — `node "${CLAUDE_PLUGIN_ROOT}/bin/wrap-up-pack.js" --run "$PIPELINE_RUN_DIR" --only ledger` (`inputs` resolves in full whichever probe `--only` names; `ledger` is the cheapest).

5. **Section E step 7** — replace from `AND the materialized header carries` through `holds the header — read it there):` with:

   > AND `{run-dir}/wrap-up-pack.json`'s `inputs.parkedAtShaping["{issue}"]` is `true` (the materialized header's `parked-at-shaping` field, `materialize.md`'s field for exactly this restore-on-abandon case — the pack resolved it from the run dir's own `work/` or the worktree's mirror, so this step reads no header file itself):

   and replace `Skip restoration silently when no materialized header exists or `parked-at-shaping` is absent,` with `Skip restoration silently when the pack holds no `true` entry for this issue (no materialized header, or `parked-at-shaping` absent),`.

6. **cleanup-procedures.md** — replace `optionally uses the materialized header's `parked-at-shaping` field (captured at the start of the execution step, before item 4, from the worktree mirror, since item 4 removes the worktree first, or read from the run dir's own `work/` on a `current-branch` run — see Section E; its core release no longer requires it)` with `optionally reads the pack's `inputs.parkedAtShaping` (see Section E; its core release no longer requires it)`.

- [ ] **Step 1: Write the failing tests** — in `tests/wrap-up-record-resolution-conformance.test.js`:

  - Re-point the step-2 test (lines 58-62) to match `` /`\{run-dir\}\/wrap-up-pack\.json`'s `inputs\.closingRecords`/ `` (keep the mirror-glob assertion).
  - Replace the step-2 `worktree-headers` test (64-67), the Section E R2 test (69-72) and the current-branch header test (74-77), the step 11 test's `inputs.records` match (96-103 → `inputs\.closingRecords`, keep its `doesNotMatch`), and the current-branch Fixes test (106-109 → `` /`inputs\.closingRecords` when non-empty/ ``).
  - Add one assertion function and both its positive and go-red uses (Go-red control rule: the control runs the same function against frozen pre-change text and expects it to throw):

```js
// The one sentence allowed to name the header-source rungs: Section C step 2's field definition.
const DEFINITION_START = 'That field is the one place wrap-up decides which records a run may close';
const DEFINITION_END = 'rather than restating the rule.';
function assertNoGateRestatement(name, text) {
  const flat = collapse(text);
  const s = flat.indexOf(DEFINITION_START);
  const e = s === -1 ? -1 : flat.indexOf(DEFINITION_END, s);
  const outside = s === -1 ? flat : flat.slice(0, s) + flat.slice(e + DEFINITION_END.length);
  assert.doesNotMatch(outside, /worktree-headers|sources\.records|HEADER_SOURCES/, `${name} restates the header-source gate`);
}
const PRE_CHANGE_SNIPPET = `ISSUES=($(node -e 'const p=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));const s=(p.inputs&&p.inputs.sources&&p.inputs.sources.records)||"";if(["headers","worktree-headers"].includes(s))console.log((p.inputs.records||[]).join(" "))' "$PACK"))`;
const PRE_CHANGE_CURRENT_BRANCH = "`inputs.records` when non-empty and its `sources.records` is\n`headers` or `worktree-headers` (a multi-spec current-branch run can resolve more than one;";

test('AC2.1 go-red: the gate-restatement check fails on the pre-change readers', () => {
  assert.throws(() => assertNoGateRestatement('pre-change step 2', PRE_CHANGE_SNIPPET));
  assert.throws(() => assertNoGateRestatement('pre-change current-branch', PRE_CHANGE_CURRENT_BRANCH));
});
for (const name of WRAPUP_FILES) {
  test(`AC2.1: ${WRAPUP_DIR}/${name} does not restate the header-source gate`, () => assertNoGateRestatement(name, read(`${WRAPUP_DIR}/${name}`)));
}
test('AC2.1: the field definition exists, once, in Section C step 2', () => {
  const corpus = WRAPUP_FILES.map((n) => collapse(read(`${WRAPUP_DIR}/${n}`))).join('\n');
  assert.strictEqual(corpus.split(DEFINITION_START).length - 1, 1);
  assert.ok(step2Block().includes(DEFINITION_START));
  assert.match(step2Block(), /`headers` or `worktree-headers`/);
});
test('engine-verify.js derives its issue set from pack.js closingRecords, with no local header-source set (#3399 Deliverable 2)', () => {
  const src = read('plugin/bin/lib/wrap-up/engine-verify.js');
  assert.doesNotMatch(src, /HEADER_SOURCES|'worktree-headers'/);
  assert.match(src, /closingRecords\(resolveRecords\(/);
});
```

  - Section E (AC3) — one assertion function, positive + go-red:

```js
function sectionEStep7(text) {
  const flat = collapse(text);
  const s = flat.indexOf('7. **Remove `bot:in-progress`; restore `parked` if applicable.**');
  const e = flat.indexOf(' 8. The CLI logs the release', s);
  assert.ok(s !== -1 && e !== -1, 'Section E step 7 anchors vanished');
  return flat.slice(s, e);
}
function assertRestoreReadsPack(step7) {
  assert.match(step7, /`inputs\.parkedAtShaping\["\{issue\}"\]` is `true`/);
  assert.doesNotMatch(step7, /\{worktree\}|-spec\.md/, 'Section E step 7 reads a header file under a worktree path');
}
const PRE_CHANGE_STEP_7 = '7. **Remove `bot:in-progress`; restore `parked` if applicable.** AND the materialized header carries `parked-at-shaping: true` (read from the worktree mirror, `{worktree}/.claude-tweaks/pipelines/{run-id}/work/{issue}-spec.md`) 8. The CLI logs the release';

test('AC3.1: Section E\'s restore reads inputs.parkedAtShaping and no file under a worktree path', () => {
  assertRestoreReadsPack(sectionEStep7(read('plugin/skills/wrap-up/cleanup-procedures-execution.md')));
});
test('AC3.1 go-red: the restore check fails on the pre-change step 7, and on a worktree path re-inserted into today\'s', () => {
  assert.throws(() => assertRestoreReadsPack(sectionEStep7(PRE_CHANGE_STEP_7)));
  const current = sectionEStep7(read('plugin/skills/wrap-up/cleanup-procedures-execution.md'));
  const mutated = current.replace('reads no header file itself', 'reads {worktree}/.claude-tweaks/pipelines/{run-id}/work/{issue}-spec.md');
  assert.notStrictEqual(mutated, current, 'mutation anchor vanished — the control would be vacuous');
  assert.throws(() => assertRestoreReadsPack(mutated));
});
test('Section E produces the pack before item 4 on a cleanup-only run (Review Focus 4)', () => {
  assert.match(collapse(read('plugin/skills/wrap-up/cleanup-procedures-execution.md')), /A `cleanup-only` run skips Phase 3: when the pack is absent, produce it at the very start of this execution step, before item 4 removes the worktree — `node "\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/wrap-up-pack\.js" --run "\$PIPELINE_RUN_DIR" --only ledger`/);
});
```

  In `tests/wrap-up-pack-conformance.test.js` add:

```js
test('every inputs field a closing-keyword reader relies on is produced by resolveInputs and read by prose (#3399)', () => {
  const { resolveInputs } = require(path.join(ROOT, 'plugin', 'bin', 'lib', 'wrap-up', 'pack.js'));
  // tmp run dir with one work/{n}-spec.md header; deps: resolvePolicy fake, git/ghSync throwing, real readFile/readdir
  assert.ok(Array.isArray(inputs.closingRecords));
  assert.strictEqual(typeof inputs.parkedAtShaping, 'object');
  const corpus = ['cleanup-procedures-execution', 'execution-and-verification', 'review-console', 'cleanup-procedures']
    .map((f) => read(`plugin/skills/wrap-up/${f}.md`)).join('\n');
  for (const f of ['closingRecords', 'parkedAtShaping']) assert.ok(corpus.includes(`inputs.${f}`), `no prose consumer reads inputs.${f}`);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/wrap-up-record-resolution-conformance.test.js tests/wrap-up-pack-conformance.test.js`
Expected: FAIL — the AC2.1 per-file tests for `cleanup-procedures-execution.md`, `execution-and-verification.md`, `review-console.md`; AC3.1; the cleanup-only pack test; the prose-consumer test.

- [ ] **Step 3: Apply prose replacements 1-6 above**

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/wrap-up-record-resolution-conformance.test.js tests/wrap-up-pack-conformance.test.js tests/verify-expectations-writer-conformance.test.js tests/bin-lib/skill-audit/context-cost.test.js`
Expected: PASS, 0 failures.

Run: `grep -rn "worktree-headers" plugin/skills/wrap-up/`
Expected (AC2.1): exactly one line, `cleanup-procedures-execution.md`'s Section C step 2 definition sentence.

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/wrap-up/cleanup-procedures-execution.md plugin/skills/wrap-up/execution-and-verification.md plugin/skills/wrap-up/review-console.md plugin/skills/wrap-up/cleanup-procedures.md tests/wrap-up-record-resolution-conformance.test.js tests/wrap-up-pack-conformance.test.js
git commit -m "Point wrap-up closing-keyword readers at inputs.closingRecords — refs #3399"
```

- [ ] **Step 6: Full suite (AC4.1)**

Run: `npm test > /private/tmp/claude-501/-Users-thomasholknielsen-Code-Workspaces-claude-tweaks/4c2bd4e0-a786-4544-8267-a5d03bd117e8/scratchpad/npm-test-3399.log 2>&1; echo exit=$?`
Expected: `exit=0`; the log's `ℹ fail` line reads `0`.

## As built (Common Step 4.5 — beneficial deviations)

- `inputs.parkedAtShaping` is a per-record map (`{ [n]: boolean }`), not a single value, so a multi-record current-branch run carries one flag per closing record.
- Section E produces the pack before item 4 whenever it is absent (a `cleanup-only` run, or a failed Phase 3 pack run) with `wrap-up-pack.js --only claim` — `claim` is the one probe a cleanup-only reader consumes — and logs a `SKIP` ("parked restore unverified") instead of treating a still-absent pack as "not parked".
- Section C step 2's snippet falls through to the worktree-mirror glob when the pack lacks `inputs.closingRecords` (a pack written by a pre-#3399 build).
- Two further readers were repointed beyond the plan's four: `cleanup-procedures.md`'s ordering-rule citation of the carrier-commit check, and `dispatch/two-call-gate.md:27` (expand-contract: every consumer migrates), each pinned in `tests/wrap-up-record-resolution-conformance.test.js`.
