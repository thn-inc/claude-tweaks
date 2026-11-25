# Born-ready captures carry a ceremony label; the Manifesto skips verdicts that cannot matter — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Records filed by `/capture`'s Shaped-body branch carry a `ceremony:*` label, and `/flow`'s Manifesto skips the per-record ceremony-check whenever its verdict cannot change anything.

**Architecture:** Deliverable 1 takes the co-ownership option. `/capture`'s Shaped-body branch already co-owns `risk:*`/`size:*`/`ready` as "the same judgment `/specify` shaping mode makes". It now also judges `ceremony:*` through the canonical `_shared/ceremony-check-invocation.md` pattern and stamps the label. The permission matrix, the ownership prose, the skill graph and ADR 0006 (as a dated note) all change to match. Deliverable 2 adds a skip rule to `flow/manifesto.md`'s Ceremony profile computation, plus a third `--ceremony` source, `:skipped`, to `bin/manifesto-write.js` (the auto path's writer). That source logs the skip in a form `materialize.md`'s existing pass-through already reads.

**Tech Stack:** Markdown skill prose, Node (`plugin/bin/`), `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-11-25T073222-record-4118/work/4118-spec.md`

**Scope keywords:** `sole owner of \`ceremony:*\``, `stamped by \`/specify\``, `this branch never`

## Global Constraints

- Skip condition, verbatim from the spec: "the run-wide fold is already `standard` from a labelled record, **and** the record is not `size:low` (the only case `build/micro-plan.md` reads a per-record `fast-lane`)". On a skip, pass `--ceremony standard` to materialize and log the skip with its reason.
- Acceptance: "A conformance test pins manifesto.md's skip condition … and its `--ceremony standard` pass-through, and reverting the prose turns it red." `npm test` passes.
- `plugin/skills/flow/SKILL.md` sits at 52352 bytes against `RAIL_BYTES` = 52500. Task 2's edit there must not grow the file: `wc -c` afterwards must print ≤ 52352.
- A `ceremony-check` output with no `CEREMONY:` line is never defaulted to `standard` (`_shared/ceremony-check-invocation.md`).
- Commit subjects use `{Verb} {what} — {detail}` and say `refs #4118`, never `closes`/`fixes`.

Waived AC3.1: `npm test` is run whole by /build Common Step 5 and /test, not by a task step.

## Review Focus

1. A single-record run, or a run where no record carries a `ceremony:standard` *label*, must never skip, because the fold is not yet `standard`. A judged verdict does not count as a label. Task 1's lib guard refuses `:skipped` without a labelled `standard` record (test included).
2. A `size:low` unlabeled record is always judged, because micro-plan reads its per-record `fast-lane`. This is prose only: manifesto-write never sees `size`, so the Task 2 conformance pin covers it.
3. The skip log line must still match materialize's reader (`#{n} carries no ceremony:* label -> CEREMONY: {verdict}`). Otherwise materialize would judge the record again. Task 1's test asserts the prefix.
4. `:skipped` with `fast-lane` is meaningless and must be refused (Task 1 test).
5. When `/capture`'s ceremony-check renders no `CEREMONY:` line, the record is filed without a ceremony label and the failure is reported. It is never stamped `standard` (Task 3 conformance pin).

---

### Task 1: `manifesto-write.js` accepts a `:skipped` ceremony source

**Files:**
- Modify: `plugin/bin/lib/flow/manifesto-write.js` (`CEREMONY_SOURCES` ~line 49, `checkRecords` ~line 80, the ceremony log loop ~line 305)
- Modify: `plugin/bin/manifesto-write.js` (header comment lines 8-15, `USAGE` ~line 66, `parseCeremony` ~line 93)
- Test: `tests/bin-lib/flow/manifesto-write.test.js`

**Interfaces:**
- Produces: CLI entry grammar `<n>=<fast-lane|standard>[:judged|:skipped]`. Record shape `{ n, ceremony, ceremonySource: 'label'|'judged'|'skipped' }`. Log line step `Manifesto ceremony-check (skipped)`, text `#{n} carries no ceremony:* label -> CEREMONY: standard (judgment skipped: the run-wide fold is already standard from a labelled record and #{n} is not size:low)`. Task 2's prose quotes this text exactly.

- [ ] **Step 1: Write the failing tests** (in `tests/bin-lib/flow/manifesto-write.test.js`, beside the existing `a judged record logs the ceremony-check line…` test, reusing its `fixture`/`write`/`formatEntry` helpers):

```js
test('a skipped record logs the skip line, whose prefix materialize.md reads as the verdict (#4118)', () => {
  const fx = fixture({ decisions: CLAIM });
  const records = [{ n: 4027, ceremony: 'standard', ceremonySource: 'label' }, { n: 4031, ceremony: 'standard', ceremonySource: 'skipped' }];
  write(fx, { records });
  const flow = fs.readFileSync(path.join(fx.runDir, 'decisions.md'), 'utf8');
  const text = '#4031 carries no ceremony:* label -> CEREMONY: standard (judgment skipped: the run-wide fold is already standard from a labelled record and #4031 is not size:low)';
  assert.ok(flow.includes(formatEntry({ status: 'AUTO', now: NOW, step: 'Manifesto ceremony-check (skipped)', spec: null, text, reversibility: 'n/a', lever: null })));
  assert.ok(flow.includes('#4031 carries no ceremony:* label -> CEREMONY: standard'));
});

test('a skipped record is refused without a labelled standard record, or with fast-lane (#4118)', () => {
  assert.throws(() => checkRecords([{ n: 1, ceremony: 'standard', ceremonySource: 'skipped' }]), ManifestoInputError);
  assert.throws(() => checkRecords([{ n: 1, ceremony: 'standard', ceremonySource: 'judged' }, { n: 2, ceremony: 'standard', ceremonySource: 'skipped' }]), ManifestoInputError);
  assert.throws(() => checkRecords([{ n: 1, ceremony: 'standard', ceremonySource: 'label' }, { n: 2, ceremony: 'fast-lane', ceremonySource: 'skipped' }]), ManifestoInputError);
  assert.doesNotThrow(() => checkRecords([{ n: 1, ceremony: 'standard', ceremonySource: 'label' }, { n: 2, ceremony: 'standard', ceremonySource: 'skipped' }]));
});

test('parseCeremony reads :skipped (#4118)', () => {
  assert.deepStrictEqual(parseCeremony('7=standard,8=standard:skipped').records,
    [{ n: 7, ceremony: 'standard', ceremonySource: 'label' }, { n: 8, ceremony: 'standard', ceremonySource: 'skipped' }]);
});
```

Export `checkRecords` (and `ManifestoInputError` if not already exported) from the lib, and `parseCeremony` from the CLI (it is already exported). Add both to the test file's existing destructuring imports.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/bin-lib/flow/manifesto-write.test.js`
Expected: FAIL. The three new tests fail (unknown ceremonySource / regex mismatch).

- [ ] **Step 3: Implement.** Make these changes:
  - `CEREMONY_SOURCES` → `['label', 'judged', 'skipped']`.
  - `checkRecords`: after the per-record loop, for each `skipped` record require `ceremony === 'standard'` and at least one record with `ceremonySource === 'label' && ceremony === 'standard'`. Otherwise throw `ManifestoInputError` naming the record.
  - The log loop: add a `skipped` branch writing the Interfaces line.
  - CLI regex: `(?::(judged|skipped))?`, with `ceremonySource: m[3] || 'label'`.
  - Error text, USAGE and header comment: name `[:judged|:skipped]`, with one comment line saying `:skipped` is flow/manifesto.md's skip rule (#4118).

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/bin-lib/flow/manifesto-write.test.js`
Expected: PASS, all tests.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/flow/manifesto-write.js plugin/bin/manifesto-write.js tests/bin-lib/flow/manifesto-write.test.js
git commit -m "Add a skipped ceremony source to manifesto-write — refs #4118"
```

---

### Task 2: Manifesto skip rule in prose, pinned by a conformance test

**Files:**
- Modify: `plugin/skills/flow/manifesto.md:35` (the `**Ceremony profile computation.**` paragraph)
- Modify: `plugin/skills/flow/SKILL.md` (Step 3's `auto` paragraph: the "Judge each unlabeled record" clause and the `--ceremony` grammar in the `manifesto-write.js` command), byte-neutral
- Test: `tests/flow-manifesto-ceremony-fallback-conformance.test.js`

**Interfaces:**
- Consumes: Task 1's `:skipped` grammar and its exact log text.

- [ ] **Step 1: Write the failing test (AC2.1).** Append to `tests/flow-manifesto-ceremony-fallback-conformance.test.js`:

```js
// --- #4118: skip the judgment when its verdict cannot matter ---
// FROZEN_PRE_4118 is plugin/skills/flow/manifesto.md's Ceremony profile computation paragraph
// as it stands at this plan's base (`git show HEAD:plugin/skills/flow/manifesto.md`, line 35),
// copied verbatim and collapsed: the control proving the pins go red on reverted prose.
const FROZEN_PRE_4118 = collapse('<line 35 verbatim>');
const skipPinsMissing = (p) => [
  ['fold already standard from a labelled record', 'already carries a `ceremony:standard` label'],
  ['not size:low condition', 'is not `size:low`'],
  ['micro-plan reason', '`build/micro-plan.md`'],
  ['--ceremony standard pass-through', 'pass `--ceremony standard` to materialize'],
  ['skip log step', 'Manifesto ceremony-check (skipped)'],
  ['skip log text', '#{n} carries no ceremony:* label -> CEREMONY: standard (judgment skipped: the run-wide fold is already standard from a labelled record and #{n} is not size:low)'],
  ['auto path suffix', '`{n}=standard:skipped`'],
].filter(([, needle]) => !p.includes(needle)).map(([name]) => name);

test('#4118: the Manifesto skips a ceremony-check whose verdict cannot matter, and passes --ceremony standard', () => {
  const p = paragraph(MANIFESTO, LEAD);
  assert.deepStrictEqual(skipPinsMissing(p), []);
  const flowSkill = collapse(read('plugin/skills/flow/SKILL.md'));
  assert.ok(flowSkill.includes('[:judged|:skipped]'), 'flow Step 3 auto command must name :skipped');
});

test('control: the frozen pre-#4118 paragraph fails every skip pin', () => {
  assert.strictEqual(skipPinsMissing(FROZEN_PRE_4118).length, 7);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/flow-manifesto-ceremony-fallback-conformance.test.js`
Expected: FAIL after Step 1 on the `#4118:` test (7 pins missing). The control passes.

- [ ] **Step 3: Edit `manifesto.md` line 35.** Insert right after "…and hold each verdict in memory." (inside the same paragraph):

> Skip the judgment when its verdict cannot matter (#4118): when another record in this run already carries a `ceremony:standard` label (the run-wide fold is already `standard`) and this record is not `size:low` (the only case `build/micro-plan.md`'s gate reads a per-record `fast-lane`), hold `standard` without judging, pass `--ceremony standard` to materialize for it (`manifesto-write.js` takes `{n}=standard:skipped`), and log the skip with its reason in the same held-then-logged way, step `Manifesto ceremony-check (skipped)`, text `#{n} carries no ceremony:* label -> CEREMONY: standard (judgment skipped: the run-wide fold is already standard from a labelled record and #{n} is not size:low)`. Its prefix is the line `materialize.md` reads, so the pass-through is unchanged.

Keep every existing sentence the older pins read (AC1.x, AC2.1).

- [ ] **Step 4: Edit `flow/SKILL.md` Step 3's auto paragraph, byte-neutral.**
  - Change `[:judged][,…]` to `[:judged|:skipped][,…]`.
  - Extend "Judge each unlabeled record (…)" with: `, or skip it as `:skipped` under `manifesto.md`'s skip rule (another record labelled `ceremony:standard`, this one not `size:low`)`.
  - Offset the growth with a cut in the same file. Compress Step 1 item 3's **Already inside an isolated worktree session.** paragraph to its consequence: explicit `current-branch` is the escape hatch, there is no automatic check, and the call is a judgment call. Keep that consequence; cut only restatement.
  - Verify: `wc -c plugin/skills/flow/SKILL.md` prints ≤ 52352.

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test tests/flow-manifesto-ceremony-fallback-conformance.test.js tests/manifesto-lever-conformance.test.js tests/manifesto-auto-fast-path.test.js`
Expected: PASS.

- [ ] **Step 6: Revert check.** Confirm `FROZEN_PRE_4118` is byte-identical (collapsed) to the base's line 35 (`git show 68608178fa:plugin/skills/flow/manifesto.md`), so the control test proves reverting the prose turns the `#4118:` test red.

- [ ] **Step 7: Commit**

```bash
git add plugin/skills/flow/manifesto.md plugin/skills/flow/SKILL.md tests/flow-manifesto-ceremony-fallback-conformance.test.js
git commit -m "Skip a Manifesto ceremony-check whose verdict cannot matter — refs #4118"
```

---

### Task 3: `/capture`'s Shaped-body branch judges and stamps `ceremony:*`

**Files:**
- Modify: `plugin/skills/capture/SKILL.md` (Shaped-body branch step 3 ~lines 343-362, its presentation line ~line 368)
- Modify: `plugin/skills/_shared/work-record-permission-matrix.md:25` (`/capture` row)
- Modify: `plugin/skills/_shared/work-record.md:101` (Ceremony row)
- Modify: `plugin/skills/flow/materialize.md:113` (the `ceremony` bullet's "stamped on every record it shapes" and "`/specify` remains the sole owner of `ceremony:*`")
- Modify: `plugin/skills/_shared/ceremony-profile.md:3` ("stamped as a `ceremony:*` label by `/claude-tweaks:specify`")
- Modify: `plugin/skills/assess-agent-autonomy/ceremony-check.md` (Called from, Step 1 Gather primary call, Persisting the verdict)
- Modify: `plugin/skills/assess-agent-autonomy/SKILL.md` (call-site diagram, Component-Skill Contract caller list)
- Modify: `plugin/skills/_shared/ceremony-check-invocation.md` ("Referenced by" list)
- Modify: `docs/skill-graph.md` (add a `/capture` → `/assess-agent-autonomy` edge row in `/capture`'s section; amend lines ~373 and ~647, which say `/specify` owns the label)
- Modify: `docs/decisions/0006-ceremony-tiering-owned-by-specify.md` (append a dated `**Note (2026-11-25):**` after the 2026-10-17 note)
- Create: `tests/capture-born-ready-ceremony-conformance.test.js`

**Interfaces:**
- Consumes: `recordPayload`'s existing `ceremony` key (`plugin/bin/lib/issues/record-payload.js:91`, emits `ceremony:{tier}`), already passed through `bin/compose-record.js`.

- [ ] **Step 1: Write the failing test (AC1.1)** `tests/capture-born-ready-ceremony-conformance.test.js`, in the house style of `tests/flow-manifesto-ceremony-fallback-conformance.test.js` (`readText`, `collapse`):

```js
// FROZEN_PRE_4118_ROW: the /capture permission-matrix row at this plan's base, verbatim, collapsed.
test('capture Shaped-body step 3 judges ceremony through the canonical pattern and passes it to recordPayload', () => {
  const c = collapse(read('plugin/skills/capture/SKILL.md'));
  const branch = c.slice(c.indexOf('## Shaped-body branch'), c.indexOf('## Entry Format'));
  assert.ok(branch.includes('`_shared/ceremony-check-invocation.md`'));
  assert.ok(branch.includes('"ceremony": "<fast-lane|standard>"'));
  assert.ok(!/never passes those[^.]*`ceremony`/.test(branch), 'ceremony still listed as never passed');
  assert.ok(branch.includes('never defaulted to `standard`'), 'missing-verdict clause');
});
test('the permission matrix grants /capture ceremony:* on the Shaped-body branch only', () => {
  const row = matrixRow('/capture');
  assert.ok(row.includes('`ceremony:*`'));
  assert.ok(!FROZEN_PRE_4118_ROW.includes('`ceremony:*`'), 'control');
});
test('no file still calls /specify the sole owner of ceremony:*', () => {
  for (const rel of ['plugin/skills/flow/materialize.md', 'plugin/skills/_shared/work-record.md']) {
    assert.ok(!collapse(read(rel)).includes('remains the sole owner of `ceremony:*`'), rel);
  }
});
```

(`matrixRow(actor)` returns the collapsed line of `work-record-permission-matrix.md` starting `| **\`/capture\`**`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/capture-born-ready-ceremony-conformance.test.js`
Expected: FAIL on the first three assertions groups.

- [ ] **Step 3: Edit `capture/SKILL.md` step 3.**
  - After scoring, judge ceremony with the canonical pattern (`_shared/ceremony-check-invocation.md`) as bare `ceremony-check`. There is no `#{n}` yet, the same pre-numbering exception as `/specify`'s decomposition loop. The judgment reads the composed body in memory, wrapped per that file.
  - Pass `ceremony` to `recordPayload`. Under local-files, pass it wherever `risk`/`size` go.
  - Add `"ceremony": "<fast-lane|standard>"` to the JSON example.
  - Remove `ceremony` from the "never passes those" list.
  - Add `ceremony:{c}` to the presentation line.
  - State the call-site delta in one sentence: writeback, per-record, without `#{n}`.
  - State the failure rule: output with no `CEREMONY:` line files the record without a ceremony label (flow's Manifesto fallback still judges it) and says so in the presentation line. It is never defaulted to `standard`.
  - The `needs:definition` branch (step 1) stays label-free, because an undecided record is not shaped.

- [ ] **Step 4: Edit the ownership sites.**
  - Matrix `/capture` Adds: add `ceremony:*` to the "**only** on the Shaped-body branch" list. In its Never column, extend "scoring and `ready` on the new record of any stub filing" to include `ceremony:*`.
  - `work-record.md:101`: "stamped by `/specify` alongside Scoring, and by `/capture`'s Shaped-body branch".
  - `materialize.md:113`:
    - "the label `/claude-tweaks:specify` (or `/claude-tweaks:capture`'s Shaped-body branch) already stamped".
    - Replace "`/specify` remains the sole owner of `ceremony:*`" with "only `/specify` and `/capture`'s Shaped-body branch write `ceremony:*` (the permission matrix)".
  - `ceremony-profile.md:3`: name both stampers.
  - `ceremony-check.md`: add `/claude-tweaks:capture`'s Shaped-body branch step 3 as a primary caller (body composed in memory, no fetch, no `#{n}`). Persisting: capture stamps the label too.
  - `assess-agent-autonomy/SKILL.md`: add the diagram line `/claude-tweaks:capture Shaped-body [ ceremony-check ] -> CEREMONY: …` and add `/claude-tweaks:capture` to the Component-Skill Contract caller list.
  - `ceremony-check-invocation.md`: add `capture/SKILL.md` (Shaped-body branch) to "Referenced by".
  - `docs/skill-graph.md`:
    - Add one row under `/capture`'s section for the `/assess-agent-autonomy` edge (ceremony-check, inline, writeback on the Shaped-body branch, #4118).
    - Reword the `/flow` row (~373) "`/specify` owns the label" → "`/specify` and `/capture`'s Shaped-body branch own the label".
    - Reword the `/specify` row (~647) "`/specify` is this mode's primary caller" → "`/specify` and `/capture`'s Shaped-body branch are this mode's primary callers".
  - ADR 0006 note: `/capture`'s Shaped-body branch now also stamps `ceremony:*` (#4118). It is a filing-time shaper that already co-owns `risk:*`/`size:*`/`ready`, so the ADR's "compute once where the record is shaped, stamp a permanent label" reasoning extends to it. The rejected alternative (a build-time path writing back) still stands. The body is left as originally written.

- [ ] **Step 5: Run tests**

Run: `node --test tests/capture-born-ready-ceremony-conformance.test.js tests/untrusted-record-content-conformance.test.js tests/deferral-gate-conformance.test.js tests/ceremony-profile-roster.test.js`
Expected: PASS.

- [ ] **Step 6: Sweep.** Run `git grep -n -F "sole owner"` and `git grep -n -F "stamped by \`/specify\`"` under `plugin/` and `docs/` (excluding `docs/decisions/` bodies and `CHANGELOG`). Expected: no remaining claim that only `/specify` writes `ceremony:*`.

- [ ] **Step 7: Commit**

```bash
git add plugin/skills/capture/SKILL.md plugin/skills/_shared/work-record-permission-matrix.md plugin/skills/_shared/work-record.md plugin/skills/flow/materialize.md plugin/skills/_shared/ceremony-profile.md plugin/skills/assess-agent-autonomy/ceremony-check.md plugin/skills/assess-agent-autonomy/SKILL.md plugin/skills/_shared/ceremony-check-invocation.md docs/skill-graph.md docs/decisions/0006-ceremony-tiering-owned-by-specify.md tests/capture-born-ready-ceremony-conformance.test.js
git commit -m "Stamp ceremony on born-ready captures — refs #4118"
```
