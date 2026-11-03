# Debate-Settled Console Findings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Review Console counts a finding as settled when a converged-positive cross-lens debate confirmed it, and when it is the partner of a contested pair the tiebreak judged under the other finding's key.

**Architecture:** Reader and producer change together. `tiebreakModel` in `plugin/bin/lib/console/resolve.js` learns two more settlement routes: (1) a converged-positive debate line settles every `lens … :line` key it names; (2) a settled `review-contested-*` file passes its verdict to every finding listed in its `## Positions` section. The review prose (`step3-debate-and-refutation.md`) is updated so the debate line names both findings and the contested file's Positions bullets have a fixed shape. `plugin/bin/lib/tiebreak.js` stays unchanged: a verdict line keeps one key per tiebreak id, and the pair is recorded in the contested artifact. That artifact is the only source that also covers runs already on disk (AC3).

**Tech Stack:** Node 18+, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-10-30T061610-spec-4563/work/4563-spec.md`

**Scope keywords:** tiebreakModel, converged positive, review-contested, Positions

## Global Constraints

- A STAGED line with no later settlement of any kind still resolves `keep-staged` — a genuinely unsettled finding is never dropped (AC4).
- A settlement only counts when logged AFTER the STAGED line (existing `settledAfter` rule).
- A direct settlement of a key (a tiebreak verdict or `Confirmed` line for that key) always wins over a partner inheritance.
- Every commit message: `{Verb} {what} — {detail}` subject, a `Refs #4563` line (never "closes"/"fixes"), ending with `Claude-Session: https://claude.ai/code/session_01CcCLFrQqNAPPzfWeWz3DEh`. Use `git -C {worktree}`, one plain command per Bash call; never `git stash`.
- "Resolves dismissed" for a coordination STAGED line (no staged file) means superseded, so no item is produced. That is the existing #3772 behavior. A staged `review-*` file settled as confirmed resolves `dismissed`.

Waived plugin/bin/lib/tiebreak.js: read only — the plan leaves the verdict-line shape unchanged (one key per tiebreak id); the contested pair is carried by the staged contested file's `## Positions` section instead, the only source that also covers already-recorded runs (AC3.1).

## Review Focus

- A converged-positive debate line written in the old template shape (no lens list) must settle nothing: both findings stay `keep-staged`, never silently dropped.
- A debate line converging **negative** or **inconclusive** must never settle anything, even though it names a lens and location.
- A contested file whose own key has no verdict leaves both its finding and its partner `keep-staged`.
- A partner key that carries its own verdict keeps that verdict (e.g. its own `dropped`), not the inherited one, whether it was logged before or after the pair's verdict.
- An inherited can't-tell verdict must not file twice: the contested file carries the one filing, and the partner's own staged file is dismissed as covered.
- A `lens …:line` mention in the free text before `converged positive` (the region itself) must not be double-counted into a wrong key; only keys after the region are read, with a bare `:n` meaning the region's path.

---

### Task 1: Converged-positive debate line settles every finding it names

**Role:** integration
**Review risk:** high

Risk signal: decision logic — branches on a parsed debate outcome to decide which findings are settled, ahead of the #3772 `Confirmed` branch.

**Files:**
- Modify: `plugin/bin/lib/console/resolve.js` (`tiebreakModel`, ~line 504; new helper beside `lineKeys` ~line 490)
- Test: `tests/bin-lib/console/resolve.test.js` (append after the `#3949` block, before `parseTiebreakLine reads all four resolver shapes`)

**Interfaces:**
- Produces: `debateConvergedKeys(line: string) -> string[]` (module-private) — `[]` for any line that is not a converged-positive AUTO debate line; otherwise every `{lens}|{path}:{line}` key named after the region.

- [ ] **Step 1: Write the failing tests** (test names carry `(#4563)`)

```js
const debatePositive = (rest) => `- AUTO 10:00:00 — Debate: cross-lens disagreement on src/a.js:5 converged positive after 1 round${rest}. Reversibility: high.`;
const stagedLow = (lens, loc) => `- STAGED 09:59:00 — Reproduction: lens "${lens}" finding ${loc} not reproduced. Staged to Review Console as low-confidence. Reversibility: high.`;

test('a converged-positive debate naming both findings supersedes both STAGED lines (#4563 AC1)', () => {
  const d = [stagedLow('3a', 'src/a.js:5'), stagedLow('3e', 'src/a.js:9'),
    debatePositive(' (lens "3a" finding src/a.js:5; lens "3e" finding src/a.js:9 — both confirmed)')].join('\n');
  assert.deepStrictEqual(findings(d), []);
});
test('the as-recorded 4304 shape (bare :n against the region path) settles both (#4563 AC1)', () => {
  const d = [stagedLow('3a', 'src/a.js:5'), stagedLow('3e', 'src/a.js:9'),
    debatePositive(' (lens 3a :5 narrative, low; lens 3e :9 duplication, medium — both confirmed)')].join('\n');
  assert.deepStrictEqual(findings(d), []);
});
test('a staged review-unconfirmed file whose line the debate settles resolves dismissed (#4563 AC1)', () => {
  const d = [`${stagedLow('3a', 'src/a.js:5')} Stage path: staged/review-unconfirmed-1.md.`,
    debatePositive(' (lens "3a" finding src/a.js:5; lens "3e" finding src/a.js:9 — both confirmed)')].join('\n');
  const items = findings(d, { 'review-unconfirmed-1.md': 'x' });
  assert.deepStrictEqual(items.map((i) => [i.id, i.resolution]), [['review-unconfirmed-1.md', 'dismissed']]);
  assert.strictEqual(items[0].reason, 'superseded — cross-lens debate confirmed it; routed through Step 3 Routing');
});
test('a converged-positive line with no lens list settles nothing (#4563 AC4)', () => {
  const d = [stagedLow('3a', 'src/a.js:5'), debatePositive('')].join('\n');
  assert.deepStrictEqual(findings(d).map((i) => i.resolution), ['keep-staged']);
});
test('negative and inconclusive debate lines settle nothing (#4563 AC4)', () => {
  const neg = '- STAGED 10:00:00 — Debate: lens "3a" finding src/a.js:5 — cross-lens disagreement converged negative after 1 round; unconfirmed. Reversibility: high.';
  const fakeAuto = '- AUTO 10:00:00 — Debate: cross-lens disagreement on src/a.js:5 converged negative after 1 round (lens "3a" finding src/a.js:5). Reversibility: high.';
  for (const later of [neg, fakeAuto]) {
    assert.ok(findings([stagedLow('3a', 'src/a.js:5'), later].join('\n')).some((i) => i.resolution === 'keep-staged'));
  }
});
test('a converged-positive debate logged before the STAGED line does not supersede it (#4563)', () => {
  const d = [debatePositive(' (lens "3a" finding src/a.js:5 — confirmed)'), stagedLow('3a', 'src/a.js:5')].join('\n');
  assert.deepStrictEqual(findings(d).map((i) => i.resolution), ['keep-staged']);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test --test-name-pattern="#4563" tests/bin-lib/console/resolve.test.js`
Expected: FAIL after Step 1 — the AC1.1/AC1.2 tests report keep-staged items where `[]` / `dismissed` is expected (the AC4.1 controls already pass).

- [ ] **Step 3: Implement `debateConvergedKeys` and wire it into `tiebreakModel`**

Match the line with `^- AUTO \d{2}:\d{2}:\d{2} — (?:Step [\d.]+: )?Debate: cross-lens disagreement on ([A-Za-z0-9_./-]+\.[A-Za-z0-9]+):(\d+) converged positive\b(.*)$`. From group 3 (the text after `converged positive`) collect every `\blens\s+"?([A-Za-z0-9_-]+)"?\s+(?:finding\s+)?([A-Za-z0-9_./-]+\.[A-Za-z0-9]+)?:(\d+)` match as `${lens}|${path || regionPath}:${n}`. In `tiebreakModel`'s first loop, check this before the `#3772` `Confirmed` branch: for each key, run `settledByKey.set(key, { index, kind: 'confirmed', id: null, key, via: 'debate' })`, then skip the `Confirmed` branch for this line. In `settledFileResolution`, a `confirmed` verdict with `via === 'debate'` returns reason `superseded — cross-lens debate confirmed it; routed through Step 3 Routing` (resolution `dismissed`, unchanged); every other `confirmed` keeps today's reason. Update the comment above `findingKey` (~line 630), which lists what supersedes a STAGED line, to name the debate route.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/console/resolve.test.js`
Expected: PASS (all tests, the new and the pre-existing).

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/console/resolve.js tests/bin-lib/console/resolve.test.js
git commit -m "Settle debate-confirmed findings in the Review Console — a converged-positive debate supersedes every finding it names"
```

### Task 2: A settled contested file settles its partner finding

**Role:** integration
**Review risk:** high

Risk signal: decision logic — verdict-inheritance precedence and a two-pass `computeSettledFiles()` re-settlement.

**Files:**
- Modify: `plugin/bin/lib/console/resolve.js` (`tiebreakModel`; new helper `contestedPositionKeys`)
- Create: `tests/bin-lib/console/fixtures/debate-settlement-4304/decisions.md` — `## /review` then lines 71–101 of `/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/archive/2026-10-28T060616-spec-4304/decisions.md`, verbatim (real-writer excerpt)
- Create: `tests/bin-lib/console/fixtures/debate-settlement-4304/staged/` (directory) holding `review-contested-1.md` and `review-contested-2.md` — verbatim copies from that archive's `staged/`
- Test: `tests/bin-lib/console/resolve.test.js` (append after Task 1's tests)

**Interfaces:**
- Consumes: Task 1's `tiebreakModel` shape, unchanged return `{ lines, latestById, settledAfter, settledFiles, absorbed }`.
- Produces: `contestedPositionKeys(text: string|null) -> string[]` (module-private) — `findingKey(bullet)` for every `- ` bullet between a `## Positions` heading and the next `## ` heading; `[]` for null text or no section.

- [ ] **Step 1: Write the failing tests**

```js
const positions = (a, b) => `# Review — contested finding\n\n## Positions\n\n- **Finding A (lens ${a.lens}, low)** — ${a.path}:${a.line}: claim A\n- **Finding B (lens ${b.lens}, medium)** — ${b.path}:${b.line}: claim B\n\n## Judge 1 (partial)\n\nx\n`;
const partner = { lens: '3f', path: 'src/a.js', line: 7 };

test('a tiebreak confirming a contested pair settles the partner finding too (#4563 AC2)', () => {
  const f = tbFinding();
  const v = tbVerdict(f, { verdict: 'confirmed' });
  const d = [stagedLow('3f', 'src/a.js:7'), tbDebate(f, 'review-contested-1.md'), v.entry].join('\n');
  assert.deepStrictEqual(findings(d, { 'review-contested-1.md': positions(f, partner) }).map((i) => [i.id, i.resolution]),
    [['review-contested-1.md', 'dismissed']]);
});
test('a refuted contested pair drops the partner too (#4563 AC2)', () => {
  const f = tbFinding({ reporterSeverity: 'low' });
  const v = tbVerdict(f, { verdict: 'refuted', severity: 'low' });
  const d = [stagedLow('3f', 'src/a.js:7'), tbDebate(f, 'review-contested-1.md'), v.entry].join('\n');
  assert.deepStrictEqual(findings(d, { 'review-contested-1.md': positions(f, partner) }).map((i) => [i.id, i.resolution]),
    [['review-contested-1.md', 'dropped']]);
});
test('an unsettled contested file leaves its partner keep-staged (#4563 AC4)', () => {
  const f = tbFinding();
  const d = [stagedLow('3f', 'src/a.js:7'), tbDebate(f, 'review-contested-1.md')].join('\n');
  const items = findings(d, { 'review-contested-1.md': positions(f, partner) });
  assert.deepStrictEqual(items.map((i) => i.resolution).sort(), ['keep-staged', 'keep-staged']);
});
test('a partner with its own later verdict keeps it over the inherited one (#4563)', () => {
  const f = tbFinding();
  const p = tbFinding({ lens: '3f', line: 7, claim: 'partner claim' });
  const d = [stagedLow('3f', 'src/a.js:7'), tbDebate(f, 'review-contested-1.md'),
    tbVerdict(f, { verdict: 'confirmed' }).entry, tbVerdict(p, { recommendation: 'file' }).entry].join('\n');
  const items = findings(d, { 'review-contested-1.md': positions(f, partner) });
  assert.ok(items.some((i) => i.id.startsWith('tiebreak:') && i.resolution === 'filed'), 'the partner\'s own console verdict still surfaces');
});
test('a partner\'s own verdict logged BEFORE the pair\'s verdict still wins over inheritance (#4563)', () => {
  const f = tbFinding();
  const p = tbFinding({ lens: '3f', line: 7, claim: 'partner claim', reporterSeverity: 'low' });
  const d = [`${stagedLow('3f', 'src/a.js:7')} Stage path: staged/review-unconfirmed-2.md.`, tbDebate(f, 'review-contested-1.md'),
    tbVerdict(p, { verdict: 'refuted', severity: 'low' }).entry, tbVerdict(f, { verdict: 'confirmed' }).entry].join('\n');
  const items = findings(d, { 'review-contested-1.md': positions(f, partner), 'review-unconfirmed-2.md': 'x' });
  assert.deepStrictEqual(items.map((i) => [i.id, i.resolution]).sort(), [['review-contested-1.md', 'dismissed'], ['review-unconfirmed-2.md', 'dropped']]);
});
test('an inherited can\'t-tell verdict files once: the partner\'s own staged file is dismissed as covered (#4563)', () => {
  const f = tbFinding();
  const d = [`${stagedLow('3f', 'src/a.js:7')} Stage path: staged/review-unconfirmed-2.md.`, tbDebate(f, 'review-contested-1.md'),
    tbVerdict(f, { recommendation: 'file' }).entry].join('\n');
  const items = findings(d, { 'review-contested-1.md': positions(f, partner), 'review-unconfirmed-2.md': 'x' });
  assert.strictEqual(items.filter((i) => i.resolution === 'filed').length, 1, 'one filing for one tiebreak id');
  const p = items.find((i) => i.id === 'review-unconfirmed-2.md');
  assert.deepStrictEqual([p.resolution, p.reason], ['dismissed', 'covered by review-contested-1.md — its contested pair\'s tiebreak item carries the verdict']);
});
test('run 2026-10-28T060616-spec-4304 (real excerpt) resolves with zero keep-staged items (#4563 AC3)', () => {
  const dir = path.join(__dirname, 'fixtures', 'debate-settlement-4304');
  const { items } = findingItems({ runDir: dir, deps: bareDeps() });
  assert.deepStrictEqual(items.filter((i) => OPEN.includes(i.resolution)).map((i) => i.id), []);
  assert.deepStrictEqual(items.filter((i) => i.id.startsWith('review-contested-')).map((i) => i.resolution), ['dismissed', 'dismissed']);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test --test-name-pattern="#4563 AC[23]" tests/bin-lib/console/resolve.test.js`
Expected: FAIL after Step 1 — the partner's STAGED line still appears as a `keep-staged` item (AC2.1). The AC3.1 fixture reports exactly one open id, the 3f `plugin/bin/lib/worktree/pre-review-catchup.js:157` line: Task 1 already settles 3a `:5` and 3e `:9`, and with Task 1 reverted the fixture reports all three, which proves the fixture discriminates.

- [ ] **Step 3: Implement partner inheritance in `tiebreakModel`**

Move the settled-file loop into a local `computeSettledFiles()` closure that returns `{ settledFiles, absorbed }`. Call it once. Then, for each settled file whose `classifyStagedItem(name).section === SECTIONS.CONTESTED`, take its staged text (from `snapshot.staged`) and run `contestedPositionKeys` on it. For every key that has no `settledByKey` entry at all, set `settledByKey.set(key, { ...chosen, key, inheritedFrom: name })`, keeping the verdict's index. A direct verdict or `Confirmed` line for the partner key wins whatever its order relative to the pair's verdict: one tiebreak wave logs in arbitrary order. In `settledFileResolution`, a verdict with `inheritedFrom` and `kind === 'console'` returns `{ resolution: 'dismissed', reason: \`covered by ${inheritedFrom} — its contested pair's tiebreak item carries the verdict\` }`, so one tiebreak id files once. Inherited `confirmed`/`dropped`/`digested` resolve as their kind does today. Then call `computeSettledFiles()` a second time, so a partner's own staged file can settle. Return the result of the second call.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/console/resolve.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/console/resolve.js tests/bin-lib/console/resolve.test.js tests/bin-lib/console/fixtures/debate-settlement-4304
git commit -m "Settle a tiebroken contested pair's partner — the verdict reaches every finding in the contested file's Positions"
```

### Task 3: Producer prose — the debate line names both findings; the contested file's Positions shape is fixed

**Role:** integration

**Files:**
- Modify: `plugin/skills/review/step3-debate-and-refutation.md:45` (Both `agree` bullet) and `:47` (Mixed / partial bullet)
- Modify: `plugin/skills/review/step3-tiebreak.md:102` (settlement paragraph)
- Modify: `tests/multi-agent-coordination.test.js:1267` (`confirmedEntry` example)
- Test: `tests/bin-lib/console/resolve.test.js` (producer↔reader pin)

- [ ] **Step 1: Write the failing pin test**

```js
test('the debate step\'s converged-positive template, instantiated, settles both findings (#4563 producer pin)', () => {
  const doc = readText('plugin/skills/review/step3-debate-and-refutation.md');
  const tpl = doc.split('\n').find((l) => l.includes('Both `agree`')).match(/`(AUTO \{HH:MM:SS\}[^`]*)`/)[1];
  const line = `- ${tpl.replace('{HH:MM:SS}', '10:00:00').replace(/\{lensA\}/g, '3a').replace(/\{lensB\}/g, '3e')
    .replace(/\{pathA\}|\{pathB\}|\{path\}/g, 'src/a.js').replace(/\{lineA\}|\{line\}/g, '5').replace(/\{lineB\}/g, '9')}`;
  assert.deepStrictEqual(findings([stagedLow('3a', 'src/a.js:5'), stagedLow('3e', 'src/a.js:9'), line].join('\n')), []);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test --test-name-pattern="producer pin" tests/bin-lib/console/resolve.test.js`
Expected: FAIL after Step 1 — today's template names no lens, so both STAGED lines stay keep-staged.

- [ ] **Step 3: Update the prose**

- Both `agree`: the template becomes `AUTO {HH:MM:SS} — Debate: cross-lens disagreement on {path}:{line} converged positive after 1 round (lens "{lensA}" finding {pathA}:{lineA}; lens "{lensB}" finding {pathB}:{lineB} — both confirmed). Reversibility: high.`. Add one sentence saying the Review Console supersedes each finding this line names (`console/resolve.js`'s `tiebreakModel`), so both must be named.
- Mixed / partial: add one sentence fixing the staged file's `## Positions` section to one bullet per finding, `- **Finding A (lens {lensA}, {severity})** — {pathA}:{lineA}: {claim}` (and the same for B). The Console applies the tiebreak verdict on the contested entry (keyed to Finding A) to every finding listed there.
- `step3-tiebreak.md:102`: after the `#3772` sentence, add that a converged-positive debate line (Step 3.5) supersedes every finding it names, and that a verdict settling a `review-contested-*` file supersedes the partner finding listed in that file's `## Positions` section.
- `tests/multi-agent-coordination.test.js:1267`: change `confirmedEntry` to the new template, instantiated (`src/auth.ts:42`, lenses `security`/`architecture`).

- [ ] **Step 4: Run the touched suites**

Run: `node --test tests/bin-lib/console/resolve.test.js tests/multi-agent-coordination.test.js tests/review-tiebreak-step-conformance.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/review/step3-debate-and-refutation.md plugin/skills/review/step3-tiebreak.md tests/multi-agent-coordination.test.js tests/bin-lib/console/resolve.test.js
git commit -m "Name every debate-confirmed finding in the review log — the converged-positive line and contested Positions match the Console reader"
```

### Task 4 (folded verification): AC3 end to end

- [ ] **Step 1: Verification — AC3.1 against the real run**

Run `console-resolve.js --policy console-auto --dry-run --json` on an anchored copy of run 2026-10-28T060616-spec-4304 (its `decisions.md` cut before the first `Review Console:` line, plus `staged/`). Expected: no `keep-staged` item. Then run `console-resolve.js --policy console-auto` for real, followed by `console-residue.js --run` on the same copy. Expected: nothing pending. Delete the copy afterwards.
