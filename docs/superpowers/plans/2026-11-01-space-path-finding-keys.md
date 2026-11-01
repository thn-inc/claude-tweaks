# Space-Path Finding Keys Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Review Console finding at a path holding a space settles against its own tiebreak verdict, never a sibling's.

**Architecture:** The tiebreak resolver learns to read evidence at the finding's own space-holding path, so such a finding can be confirmed or dropped at all. The console resolver then keys a verdict line by the whole path it already parses. It resolves each STAGED location to the longest of its candidate keys that some settler names, falling back to today's `FINDING_PATH` key.

**Tech Stack:** Node 18+ CommonJS, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-11-01T182336-spec-4632/work/4632-spec.md`

Scope keywords: findingKey, lineKeys, parseTiebreakLine, TIEBREAK_CONFIRMED_RE, parseEvidence, EVIDENCE_RE

## Global Constraints

- Tests run with `node --test`; a verdict line in `tests/bin-lib/console/resolve.test.js` is "built through the real resolver and the sanctioned formatter, never typed by hand" (the file's own `tbVerdict` comment). Use `tbFinding`/`tbVerdict`/`tbStaged`/`tbCoincidence`/`tbDebate`/`stagedLow`/`findings`.
- From `.claude/skills/parse-signal-discipline/fix-shape-late-items.md` item 25, verbatim: "Run the extractor on an out-of-class input before stating its failure direction. Assert the extracted value directly, and pin two inputs that differ only in the part it would drop (`tests/bin-lib/console/resolve.test.js`)."
- A space-free path keys byte-identically to before on both sides (spec AC6). The existing #4582 cases in `resolve.test.js` (lines ~1062-1100) must pass unedited, including `+src/a.ts:4` staying `keep-staged` against a verdict for `src/a.ts`.
- Producer templates under `plugin/skills/**` are not changed (spec Gotchas).
- Prose settlers (`debateConvergedKeys`, the #3772 `Confirmed` AUTO sentence, `contestedPositionKeys`) keep the shortest (today's) key. That residual is accepted in the spec's Gotchas; do not widen them.
- Commit messages: `{Verb} {what} — {detail}`, ending with the line `Claude-Session: https://claude.ai/code/session_01X7gPF9KCviqiMJfu1bzMPu`.
- Every test name carries the AC clause id it covers (`AC{n}.{clause}`).

## Review Focus

1. A two-finding coincidence line (`findings a dir/x.ts:3 / a dir/x.ts:5 share a location`). The current regex is `\S`-only, so the second key is silently lost and the line settles on the first key alone. Both keys must be whole, and the line stays open until both settle (Task 2).
2. Evidence that wraps a space-holding path in backticks (`` `a dir/x.ts`:3 `` and `` `a dir/x.ts:3` ``) must parse like the bare form (Task 1).
3. A re-staged space-path finding (#4583): STAGED, verdict, then STAGED again for `a dir/x.ts:3`. The second STAGED line stays open (Task 2).
4. A contested pair whose Finding A sits at a space-holding path settles its `review-contested-*` file through its own console verdict, and a sibling space path's contested file stays keep-staged (Task 2).
5. Verdicts at both `a dir/x.ts:3` and plain `dir/x.ts:3` (same lens): each STAGED line takes its own verdict (longest named candidate wins) (Task 2).

---

### Task 1: Tiebreak evidence at a space-holding path

**Role:** integration

**Files:**
- Modify: `plugin/bin/lib/tiebreak.js` (`parseEvidence` ~96, `parseTiebreakReply` ~148, `resolveTiebreak` ~262)
- Test: `tests/bin-lib/tiebreak.test.js`

**Interfaces:**
- Produces: `parseTiebreakReply(replyText, { findingPath } = {})`. With no options it behaves exactly as today. With `findingPath`, an `Evidence:` value that starts with `{findingPath}:{line}`, `` `{findingPath}`:{line} `` or `` `{findingPath}:{line}` `` parses with `path: findingPath`. `resolveTiebreak(finding, replyText, opts)` passes `{ findingPath: finding.path }`. Task 2 relies on `resolveTiebreak` returning `outcome: 'drop'` / `'confirmed'` for a finding at `a dir/x.ts`.

- [ ] **Step 1: Write the failing tests** in `tests/bin-lib/tiebreak.test.js`, next to the existing evidence-parsing tests (~line 800):

```js
test('AC2.1: evidence at a space-holding finding path resolves drop and confirmed (#4632)', () => {
  const f = { ...RAW[0], path: 'a dir/x.ts', line: 3 };
  for (const [verdict, outcome] of [['refuted', 'drop'], ['confirmed', 'confirmed']]) {
    for (const ev of ['a dir/x.ts:3 `quote text here`', '`a dir/x.ts`:3 `quote text here`', '`a dir/x.ts:3` `quote text here`']) {
      const r = resolveTiebreak(f, `Verdict: ${verdict}\nEvidence: ${ev}\nSeverity: medium\nSTATUS: DONE`, { readFile: () => 'line1\nline2\nquote text here\n', now: NOW });
      assert.strictEqual(r.outcome, outcome, `${verdict} ${ev}`);
    }
  }
});
test('a space-holding evidence path for a different finding path still fails (#4632)', () => {
  const f = { ...RAW[0], path: 'b dir/x.ts', line: 3 };
  const r = resolveTiebreak(f, 'Verdict: refuted\nEvidence: a dir/x.ts:3 `quote text here`\nSeverity: medium\nSTATUS: DONE', { readFile: () => 'line1\nline2\nquote text here\n', now: NOW });
  assert.strictEqual(r.outcome, 'console');
});
test('parseTiebreakReply without findingPath keeps today\'s evidence parse (#4632)', () => {
  assert.strictEqual(parseTiebreakReply('Verdict: confirmed\nEvidence: a dir/x.ts:3 x\nSTATUS: DONE').evidence, null);
});
```

Use whatever `now`/`RAW`/`readFile` constants the file already defines (`RAW[0]`'s shape is the file's own finding fixture). Rename `NOW` to the existing constant if it differs.

- [ ] **Step 2: Run to verify the new tests fail**

Run: `node --test tests/bin-lib/tiebreak.test.js`
Expected: FAIL, the AC2.1 test reports `console` where `drop` was expected. The third test passes already: it pins the unchanged default.

- [ ] **Step 3: Implement** the `findingPath` option. In `parseEvidence(value, findingPath)`, when `findingPath` is a non-empty string, first try the three prefixed forms above (exact string comparison against `findingPath`, never a regex built from it) and on a match feed `{findingPath}:{line}{rest}` to the existing line/quote parsing. Otherwise fall through to today's `WRAPPED_TOKEN_RE`/`EVIDENCE_RE` path unchanged. Thread the option from `resolveTiebreak` through `parseTiebreakReply` to `parseEvidence`.

- [ ] **Step 4: Run the file's suite**

Run: `node --test tests/bin-lib/tiebreak.test.js`
Expected: PASS, every test.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/tiebreak.js tests/bin-lib/tiebreak.test.js
git commit -m "Read tiebreak evidence at a space-holding finding path — refuted/confirmed no longer collapse to no-evidence (#4632)

Claude-Session: https://claude.ai/code/session_01X7gPF9KCviqiMJfu1bzMPu"
```

### Task 2: Key a space-holding path whole in the Review Console

**Role:** judgment
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/console/resolve.js` (`TIEBREAK_CONFIRMED_RE` ~468, `parseTiebreakLine` ~471, `lineKeys` ~496, `tiebreakModel` ~555-634, `coordinationItems` ~767-800, the `findingKey` comment block ~740)
- Modify: `plugin/bin/lib/tiebreak.js:326` comment (`findingKey: lens + first path:line`), so it describes the whole-path verdict key and the STAGED candidate rule.
- Modify: `tests/bin-lib/tiebreak.test.js:483` comment, the same statement.
- No change: `plugin/skills/_shared/multi-agent-coordination.md:83` (still true: the key is lens plus path:line); `plugin/bin/lib/console/backfill.js` (joins verdicts by id; spec Gotchas); `.claude/skills/parse-signal-discipline/fix-shape-late-items.md:190` (historical #4582 entry).
- Test: `tests/bin-lib/console/resolve.test.js` (new `// ---- #4632 ----` block after the #4582 block)
- No change (plan-audit Check B scope-keyword hits): `plugin/bin/lib/console/backfill.js` and `tests/bin-lib/console/backfill.test.js` (backfill joins verdicts by tiebreak id and keys item ids on `LEGACY_LOCATION_RE`); `plugin/bin/lib/issues/retry.js` (matched `NEGATIVE_EVIDENCE_RE`, an unrelated identifier); `docs/plans/2026-10-23-spec-3946-3949-3816-3950-ledger.md` and the four `docs/superpowers/plans/2026-10-3*-*.md` plans (historical records of earlier builds).

**Interfaces:**
- Consumes: Task 1's `resolveTiebreak` producing `drop`/`confirmed` for a space-holding path (through `tbVerdict`).
- Produces, inside `resolve.js` only (no new exports):
  - `parseTiebreakLine(line).key` is `` `${lens}|${path}:${line}` `` from the parsed groups.
  - `TIEBREAK_CONFIRMED_RE`'s path group accepts spaces, anchored on the ` confirmed by tiebreak:{id}. Confirmed.` tail.
  - `locationCandidates(line, match, lens) → string[]`: candidate keys for one `FINDING_LOC_RE` match, shortest first. `candidates[0]` is today's key. Each longer candidate starts right after a whitespace character to the left of the match. Scanning left stops at `"`, `—`, `:` or the line start.
  - `lineKeys(line, known = new Set()) → string[]`: each location resolves to its longest candidate in `known`, else `candidates[0]`. The coincidence branch finds its second location with the same rule, after ` / `.
  - `tiebreakModel` builds `known` from `settledByKey`'s keys once its first pass ends. It passes `known` to every later `lineKeys` call and returns `keysOf: (line) => lineKeys(line, known)`. `coordinationItems` uses `model.keysOf` in place of its two bare `lineKeys(line)` calls.
  - Consumer classification: every `lineKeys` caller (`naming`, `latestStaged`, `coordinationItems`' `settledAfter` and `contested` lookups) is pick-one per location. Every caller needs the resolved key; none needs the candidate list.

- [ ] **Step 0: Real-input baseline (before any edit).** Write a scratch script outside the repo (the session scratchpad). It runs `findingItems({ runDir, deps })` from `plugin/bin/lib/console/resolve.js` over every directory holding a `decisions.md` under `/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/` (recursively, including `archive/`), with `deps = { readFile: (p) => fs.readFileSync(p, 'utf8'), readdir: (p) => { try { return fs.readdirSync(p); } catch { return []; } } }`. It writes `{runDir: items.map(i => [i.id, i.section, i.resolution])}` as JSON to `before.json`. Record the run-dir count.

- [ ] **Step 1: Write the failing tests** in `tests/bin-lib/console/resolve.test.js`, in the new block (`f` objects via `tbFinding({ lens: '3b', path, line: 3 })`, the STAGED line via `tbStaged(f)`):

```js
test('AC1.1 AC1.2: a dropped verdict for a dir/x.ts:3 settles that line only; b dir/x.ts:3 stays keep-staged (#4632)', () => {
  const a = tbFinding({ lens: '3b', path: 'a dir/x.ts', line: 3 });
  const b = tbFinding({ lens: '3b', path: 'b dir/x.ts', line: 3 });
  const items = findings([tbStaged(a), tbStaged(b), tbVerdict(a, { verdict: 'refuted' }).entry].join('\n'));
  assert.deepStrictEqual(items.map((i) => [i.id.includes('b dir/x.ts'), i.resolution]), [[true, 'keep-staged']]);
});
test('AC2.1: a lone STAGED line at my dir/x.ts:3 is settled by its own dropped, digested, console and confirmed verdict (#4632)', () => {
  // dropped and digested and confirmed: no item left; console: exactly the tiebreak:{id} item.
});
test('AC3.1: a confirmed verdict at my dir/x.ts:3 parses with the whole path and key (#4632)', () => {
  const v = tbVerdict(tbFinding({ lens: '3b', path: 'my dir/x.ts', line: 3 }), { verdict: 'confirmed' });
  const p = parseTiebreakLine(v.entry);
  assert.deepStrictEqual([p.kind, p.path, p.key], ['confirmed', 'my dir/x.ts', '3b|my dir/x.ts:3']);
});
test('AC4.1: drifted STAGED prose before a space-free path still settles (#4632)', () => {
  // `lens "3c" finding at plugin/a.ts:4 not reproduced…` and `lens "3c" finding Error handling at plugin/a.ts:4 …`,
  // each followed by tbVerdict(tbFinding({ lens: '3c', path: 'plugin/a.ts', line: 4 }), { verdict: 'refuted' }) → findings(...) is [].
});
test('AC6.1: a space-free verdict path keys byte-identically to the FINDING_PATH key (#4632)', () => {
  const OLD = new RegExp(String.raw`(${FINDING_PATH}):(\d+)`);
  for (const path of ['src/a.js', 'packages/@scope/x.ts', 'app/[id]/page.tsx', 'routes/$id.tsx']) {
    for (const verdict of ['confirmed', 'refuted', 'cant-tell']) {
      const entry = tbVerdict(tbFinding({ path, line: 7 }), { verdict }).entry;
      const m = OLD.exec(entry);
      assert.strictEqual(parseTiebreakLine(entry).key, `3a|${m[1]}:${m[2]}`, `${path} ${verdict}`);
    }
  }
});
```

Add one test per Review Focus line (1, 3, 4, 5), named `Review Focus N: … (#4632)`. Assert resolutions per item with `findings(...)`: a coincidence line at `a dir/x.ts:3 / a dir/x.ts:5` stays `keep-staged` when only the `:3` verdict exists, and settles once both exist. Import `FINDING_PATH` from `MOD` alongside the existing names. AC5.1 (every existing case passes unchanged) is covered by Step 4's full-file run, not a new test.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/bin-lib/console/resolve.test.js`
Expected: FAIL after Step 1. AC1, AC2's dropped/confirmed/console cases, AC3, and Review Focus 1, 4 and 5 fail. AC4.1 and AC6.1 pass at base, since both pin unchanged behavior; record that they pass rather than claiming red.

- [ ] **Step 3: Implement** the Interfaces above in `resolve.js`. Update the comment above `findingKey` (~740) and the two comments named in Files to describe the whole-path verdict key and the longest-named-candidate rule.

- [ ] **Step 4: Run both suites**

Run: `node --test tests/bin-lib/console/resolve.test.js tests/bin-lib/tiebreak.test.js tests/bin-lib/console/backfill.test.js`
Expected: PASS, every test (AC5.1).

- [ ] **Step 5: Real-input comparison.** Re-run Step 0's script into `after.json` and diff it against `before.json`. Expected: identical for every run dir unless that run's `decisions.md` holds a space-holding finding path. Name every differing run dir and its changed items in the task report, or state "0 run dirs differ of {count}".

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/lib/console/resolve.js plugin/bin/lib/tiebreak.js tests/bin-lib/console/resolve.test.js tests/bin-lib/tiebreak.test.js
git commit -m "Key a space-holding finding path whole in the Review Console — a verdict on a dir/x.ts no longer settles b dir/x.ts (#4632)

Claude-Session: https://claude.ai/code/session_01X7gPF9KCviqiMJfu1bzMPu"
```
