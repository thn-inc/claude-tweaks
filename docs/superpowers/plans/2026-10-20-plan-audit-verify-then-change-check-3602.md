# Plan-audit Check F (spec-named path coverage) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Warn at plan-audit time when a repo path the spec's `## Technical Approach` / `## Gotchas` names appears in no plan task's `Files:` block, and add the matching prose plan-authoring check.

**Architecture:** A new warn-only `checkF` in `plugin/bin/lib/plan-audit/checks.js`, a sibling of Check E (which stays AC-only). Its inputs come from three new pure parser functions in `parser.js`: a spec-section path extractor built on Check E's section reader (generalized to any `##` heading), a path-waiver reader sharing Check E's waiver-line shape, and a path normalizer. `plan-audit.js` adds the `checkF` envelope key and `summaryLine` parts, never in `pass`. The docs (`plan-audit.md`, `plan-authoring-checks.md`, `build/SKILL.md`, `docs/plugin-structure.md`) gain the new check per the project skill `plan-audit-check-addition`'s registration set.

**Tech Stack:** Node 18+ CommonJS, `node --test`, no new dependencies.

**Spec:** `.claude-tweaks/pipelines/2026-10-20T124821-spec-3599-3602-3695-3696-3698-3699-3595/spec-3602/work/3602-spec.md` (the worktree's copy)

## Global Constraints

- Check letter is **F** (`git grep -n "Check F\|checkF" -- plugin docs tests` is empty today); envelope key `checkF`, placed after `checkE`.
- Warn-only: `checkF.ok` is always `true`; `checkF` never joins `pass` in `plan-audit.js`.
- Without `--spec`: `checkF` is exactly `{ ok: true, skipped: 'no-spec' }`. An unreadable `--spec` keeps today's exit 2 (shared read in `plan-audit.js`, nothing new). No new flag, so `USAGE` and the `--spec` pairing refusal in `args.js` are unchanged.
- Sections read: `## Technical Approach` (its `### Key Files` included, since the section ends only at a `#`/`##` heading) and `## Gotchas`. Never `## Acceptance Criteria`, `## Deliverables`, or any other section.
- Paths come only from backtick code spans that pass `looksLikeRepoPath`; matching is exact after `normalizeRepoPath`, plus a whole-segment suffix match (`via: 'suffix'`). No quoted-text fallback (spec Gotcha 1).
- Waiver line shape: `Waived {path}: {reason}`, an optional `- `/`* ` bullet, optional backticks around `{path}`, ignored inside a fence, the same shape Check E's `Waived AC{item}.{clause}: {reason}` uses.
- Byte rail: `RAIL_BYTES` = 52,500 (`plugin/bin/lib/skill-audit/budgets.js`). Merge-base sizes: `plugin/skills/build/plan-audit.md` 22,907 B (44%); `plugin/skills/build/plan-authoring-checks.md` 46,225 B (88.0%, inside 10% of the rail); `plugin/skills/build/SKILL.md` 47,644 B (90.8%, already flagged `nearCeiling`). **Named remedy (cut bytes at the source):** the new `plan-authoring-checks.md` paragraph stays at or under 1,000 B, and the `SKILL.md` edit is an in-place rewording with a net delta of 60 B or less. That leaves both files at least 4.8 KB under the rail, so no section move is needed. A `headroom.nearCeiling` flag on either file is informational and expected. Record the post-edit `wc -c` of both in Task 4's commit message.
- Commits: `{Verb} {what} — {detail}` style, `Refs #3602` (never a closing keyword).

## Review Focus

1. **Plugin-relative citations.** Specs here routinely cite `_shared/x.md` or `bin/lib/y.js` while `Files:` bullets carry the full `plugin/…` path. They must count as listed on a whole path segment, never mid-segment (`lib/y.js` must not match `plugin/bin/mylib/y.js`). Pinned in Task 2.
2. **Non-path code spans.** Identifiers (`AC_HEADING_RE`), basenames (`parser.js`), flags, globs, `{placeholder}` templates, URLs, `node:fs`, absolute paths, and directories ending in `/` are never paths, otherwise every spec is noise. Pinned in Task 1.
3. **A Check E waiver must not become a Check F waiver.** `Waived AC2.3: …` is not a path waiver and is never an orphan path waiver. Pinned in Task 2.
4. **CRLF specs** must yield exactly the LF result, as Check E's reader does. Pinned in Task 1.
5. **Paths inside a balanced fenced block** (example code in Technical Approach) are not extracted, while paths after the fence still are. Pinned in Task 1.

Waived tests/plan-audit-check-e-prose.test.js: read-only reference. The spec names it to read; it pins only Check E's prose and no line it asserts on is edited here. Task 4's new prose test mirrors its structure.

---

### Task 1: Parser — spec-section path extraction, path waivers, normalization

**Files:**
- Modify: `plugin/bin/lib/plan-audit/parser.js`
- Test: `tests/bin-lib/plan-audit/parser.test.js`

**Interfaces:**
- Consumes: existing `AC_FENCE_RE`, `AC_HEADING_RE`, `AC_SECTION_END_RE`, `WAIVER_RE` in `parser.js`.
- Produces (all exported):
  - `looksLikeRepoPath(span: string) -> boolean`
  - `normalizeRepoPath(p: string) -> string`
  - `extractSpecPaths(specText: string) -> { paths: {path: string, section: 'Technical Approach'|'Gotchas'}[], unparsed: {section: string, raw: string}[] }`
  - `extractPathWaivers(planText: string) -> {path: string, reason: string}[]`

- [ ] **Step 1: Write the failing tests** (append to `tests/bin-lib/plan-audit/parser.test.js`, a new `// ── Check F inputs (#3602)` block with its own `require` of the four exports)

```js
const F_SPEC = [
  '# 1: X', '',
  '## Deliverables', '', '1. Change `src/deliv.js`.', '',
  '## Acceptance Criteria', '', '1. `src/ac.js` works.', '',
  '## Technical Approach', '', 'Read `src/a.js` back; change `./src/b.js:88` only if it breaks.', '',
  '### Key Files', '', '- `src/a.js` — reader', '- `plugin/skills/_shared/x.md` — read only', '',
  '## Gotchas', '', '- Verify `lib/c.js` against `src/a.js`.', '',
  '## Release Note', '', 'Mentions `src/note.js`.', '',
].join('\n');

test('AC2.1 (#3602): extractSpecPaths reads only Technical Approach (with Key Files) and Gotchas — deduped, first section wins, normalized', () => {
  assert.deepStrictEqual(extractSpecPaths(F_SPEC), {
    paths: [
      { path: 'src/a.js', section: 'Technical Approach' },
      { path: 'src/b.js', section: 'Technical Approach' },
      { path: 'plugin/skills/_shared/x.md', section: 'Technical Approach' },
      { path: 'lib/c.js', section: 'Gotchas' },
    ],
    unparsed: [],
  });
});

test('#3602: looksLikeRepoPath accepts repo-relative file paths and rejects every non-path span', () => {
  for (const p of ['src/a.js', './src/a.js', 'src/b.js:88', 'src/b.js:12-20', '.claude/skills/x/SKILL.md', 'docs/plans/2026-10-20-x-ledger.md']) {
    assert.ok(looksLikeRepoPath(p), p);
  }
  for (const p of ['AC_HEADING_RE', 'parser.js', '--spec', 'src/*.js', 'work/{n}-spec.md', 'https://x.io/a.js',
    '.claude/skills/x/', 'origin/main', 'plan-audit.js {plan} --spec {spec}', '/abs/path.js', 'node:fs', '~/.claude/x.md']) {
    assert.ok(!looksLikeRepoPath(p), p);
  }
});

test('#3602: normalizeRepoPath drops a leading ./ and a :NN or :NN-MM line suffix', () => {
  assert.strictEqual(normalizeRepoPath('./src/b.js:88'), 'src/b.js');
  assert.strictEqual(normalizeRepoPath('src/b.js:12-20'), 'src/b.js');
  assert.strictEqual(normalizeRepoPath('src/a.js'), 'src/a.js');
});

test('AC4.1 (#3602): a line with an unbalanced code span is unparsed with its section; its neighbours still extract', () => {
  const spec = '## Technical Approach\n\nRead `src/a.js and stop.\nThen `src/b.js`.\n';
  assert.deepStrictEqual(extractSpecPaths(spec), {
    paths: [{ path: 'src/b.js', section: 'Technical Approach' }],
    unparsed: [{ section: 'Technical Approach', raw: 'Read `src/a.js and stop.' }],
  });
});

test('AC4.1 (#3602): an unclosed fence makes the section one unparsed entry, never an empty, clean result', () => {
  const spec = '## Technical Approach\n\n```js\nrequire(`src/a.js`)\n\n## Gotchas\n\n- `src/g.js`\n';
  assert.deepStrictEqual(extractSpecPaths(spec), {
    paths: [],
    unparsed: [{ section: 'Technical Approach', raw: 'unclosed code fence in "## Technical Approach"' }],
  });
});

test('#3602: a path inside a balanced fenced block is not extracted; one after the fence is', () => {
  const spec = '## Gotchas\n\n```\nsee `src/in-fence.js`\n```\n\n- `src/after.js`\n';
  assert.deepStrictEqual(extractSpecPaths(spec).paths, [{ path: 'src/after.js', section: 'Gotchas' }]);
});

test('#3602: a spec with neither section yields no paths and no unparsed entry (an optional section left out is nothing here)', () => {
  assert.deepStrictEqual(extractSpecPaths('## Acceptance Criteria\n\n1. `src/a.js` works.\n'), { paths: [], unparsed: [] });
});

test('#3602: a CRLF spec yields exactly the LF result', () => {
  assert.deepStrictEqual(extractSpecPaths(F_SPEC.replace(/\n/g, '\r\n')), extractSpecPaths(F_SPEC));
});

test('AC1.2 (#3602): extractPathWaivers reads Waived {path}: {reason} lines, normalized, skipping AC waivers and fenced lines', () => {
  const plan = ['Waived src/b.js: read-only', '- Waived `lib/c.js:12`: covered upstream', 'Waived AC2.3: not a path',
    '```', 'Waived src/fenced.js: inside a fence', '```'].join('\n');
  assert.deepStrictEqual(extractPathWaivers(plan), [
    { path: 'src/b.js', reason: 'read-only' },
    { path: 'lib/c.js', reason: 'covered upstream' },
  ]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/plan-audit/parser.test.js`
Expected: FAIL after Step 1 — `extractSpecPaths is not a function` (the four exports do not exist yet)

- [ ] **Step 3: Implement the four functions in `plugin/bin/lib/plan-audit/parser.js`**

Place them under a new `// ── Check F inputs: repo paths the spec's Technical Approach / Gotchas name (#3602)` comment block after `extractCoverageSources`, and add all four to `module.exports`.
- Generalize `acceptanceSectionLines(specText)` into `specSectionLines(specText, headingRe)` (same body, `AC_HEADING_RE` replaced by `headingRe`). Keep `acceptanceSectionLines` as `specSectionLines(specText, AC_HEADING_RE)` so Check E is byte-for-byte unchanged in behavior.
- `looksLikeRepoPath`: `/^(?:\.\/)?[A-Za-z0-9_.@-]+(?:\/[A-Za-z0-9_.@-]+)+\.[A-Za-z0-9]+(?::\d+(?:-\d+)?)?$/`. It needs at least one `/` and a file extension, and allows no whitespace, `*`, `{`, `:` scheme, `~`, or leading `/`.
- `normalizeRepoPath`: strip a repeated leading `./`, then a trailing `:\d+(-\d+)?`.
- `extractSpecPaths`: iterate sections in the fixed order `['Technical Approach', 'Gotchas']`, each heading `/^##[ \t]+{name}[ \t]*$/i`. An absent section contributes nothing. If the section's lines hold an odd number of `AC_FENCE_RE` lines, push one section-level unparsed entry `unclosed code fence in "## {name}"` and take no paths from it. Otherwise skip fenced lines; for every other line (CRLF already normalized by `specSectionLines`), an odd backtick count pushes `{section, raw: line.trim()}`; otherwise each `` /`([^`]+)`/g `` span, trimmed, that passes `looksLikeRepoPath` is normalized and appended unless that normalized path was already seen in either section.
- `extractPathWaivers`: build both waiver regexes from one shared helper, `waiverLineRe(targetPattern)`, which returns `^[ \t]*(?:[-*][ \t]+)?Waived[ \t]+{target}[ \t]*:[ \t]*(\S.*?)[ \t]*$`. Redefine `WAIVER_RE` as `waiverLineRe('(AC\\d+\\.\\d+)')` and add `PATH_WAIVER_RE = waiverLineRe('`?([^\\s`:]+(?::\\d+(?:-\\d+)?)?)`?')`. Walk plan lines, toggling on `AC_FENCE_RE` and skipping fenced lines. Keep a match only when its target passes `looksLikeRepoPath`, and push `{path: normalizeRepoPath(target), reason}`.

- [ ] **Step 4: Run the tests to verify they pass** (covers AC1.2, AC2.1, AC4.1)

Run: `node --test tests/bin-lib/plan-audit/parser.test.js tests/bin-lib/plan-audit/checks.test.js`
Expected: PASS. The existing #3099 parser and Check E tests stay green, which proves the `specSectionLines` and `WAIVER_RE` refactors kept Check E's behavior.

- [ ] **Step 5: Prove each new test discriminates (AC6.1)** — apply each mutation alone, re-run `node --test tests/bin-lib/plan-audit/parser.test.js`, confirm the named test FAILS, then restore:
  - Add `'Acceptance Criteria'` to the section list → the AC2.1 extraction test fails.
  - Drop the odd-backtick branch → the first AC4.1 test fails.
  - Drop the unclosed-fence branch → the second AC4.1 test fails.
  - Delete the `/` requirement (change `+` to `*` after the segment group) → the looksLikeRepoPath test fails.
  - Stop skipping fenced lines → the balanced-fence test fails.
  - Remove the `.replace(/\r\n?/g, '\n')` in `specSectionLines` → the CRLF test fails.
  - Remove the `looksLikeRepoPath` filter in `extractPathWaivers` → the AC1.2 waiver test fails.

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/lib/plan-audit/parser.js tests/bin-lib/plan-audit/parser.test.js
git commit -m "Add Check F parser inputs — spec Technical Approach/Gotchas paths, path waivers (Refs #3602)"
```

### Task 2: `checkF` — the warn-only check

**Files:**
- Modify: `plugin/bin/lib/plan-audit/checks.js`
- Test: `tests/bin-lib/plan-audit/checks.test.js`

**Interfaces:**
- Consumes: `extractSpecPaths`, `extractPathWaivers`, `normalizeRepoPath` (Task 1); existing `extractFileEntries(planText) -> {type, path}[]`.
- Produces: `checkF(specText: string, planText: string) -> { ok: true, unlisted: {path, section}[], listed: {path, via: 'exact'|'suffix'}[], waived: {path, reason}[], unparsed: {section, raw}[], orphanWaivers: {path, reason}[] }`, exported.

- [ ] **Step 1: Write the failing tests** (append to `tests/bin-lib/plan-audit/checks.test.js`)

```js
const { checkF } = require('../../../plugin/bin/lib/plan-audit/checks');

const F_SPEC = ['## Technical Approach', '', 'Read `src/a.js` and `src/b.js` back; change them only if the model change breaks them.', ''].join('\n');

function fPlan(filesLines, extraLines = []) {
  return [...extraLines, '### Task 1: Build it', '', '**Files:**', ...filesLines, '', '- [ ] **Step 1: Write the failing test**', ''].join('\n');
}

test('AC1.1 (#3602): a plan listing neither Technical Approach path reports both unlisted, and ok stays true', () => {
  const r = checkF(F_SPEC, fPlan(['- Modify: `src/other.js`']));
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.unlisted, [
    { path: 'src/a.js', section: 'Technical Approach' },
    { path: 'src/b.js', section: 'Technical Approach' },
  ]);
});

test('AC1.2 (#3602): a task listing src/a.js plus a Waived src/b.js line reports neither', () => {
  const r = checkF(F_SPEC, fPlan(['- Modify: `src/a.js`'], ['Waived src/b.js: read back by the existing reader test', '']));
  assert.deepStrictEqual(r.unlisted, []);
  assert.deepStrictEqual(r.listed, [{ path: 'src/a.js', via: 'exact' }]);
  assert.deepStrictEqual(r.waived, [{ path: 'src/b.js', reason: 'read back by the existing reader test' }]);
  assert.deepStrictEqual(r.orphanWaivers, []);
});

test('AC2.1 (#3602): a path named only in ## Acceptance Criteria or ## Deliverables is never reported', () => {
  const spec = ['## Deliverables', '', '1. Change `src/d.js`.', '', '## Acceptance Criteria', '', '1. `src/ac.js` works.', '', F_SPEC].join('\n');
  assert.deepStrictEqual(checkF(spec, fPlan(['- Modify: `src/a.js`', '- Modify: `src/b.js`'])).unlisted, []);
});

test('AC4.1 (#3602): an unreadable spec line passes through as unparsed, never as covered, and ok stays true', () => {
  const r = checkF('## Technical Approach\n\nRead `src/a.js and stop.\n', fPlan(['- Modify: `src/other.js`']));
  assert.deepStrictEqual(r.unparsed, [{ section: 'Technical Approach', raw: 'Read `src/a.js and stop.' }]);
  assert.deepStrictEqual(r.listed, []);
  assert.strictEqual(r.ok, true);
});

test('#3602: ./ prefixes and :NN line suffixes on either side still match exactly', () => {
  const r = checkF('## Gotchas\n\n- `./src/a.js:88`\n', fPlan(['- Modify: `src/a.js:10-20`']));
  assert.deepStrictEqual(r.listed, [{ path: 'src/a.js', via: 'exact' }]);
  assert.deepStrictEqual(r.unlisted, []);
});

test('#3602: a plugin-relative citation matches a Files path on a whole-segment suffix, never mid-segment', () => {
  const r = checkF('## Technical Approach\n\nSee `_shared/x.md` and `lib/y.js`.\n',
    fPlan(['- Modify: `plugin/skills/_shared/x.md`', '- Modify: `plugin/bin/mylib/y.js`']));
  assert.deepStrictEqual(r.listed, [{ path: '_shared/x.md', via: 'suffix' }]);
  assert.deepStrictEqual(r.unlisted, [{ path: 'lib/y.js', section: 'Technical Approach' }]);
});

test('#3602: a path waiver naming no extracted path is an orphan; a Check E AC waiver is never a Check F waiver', () => {
  const r = checkF(F_SPEC, fPlan(['- Modify: `src/a.js`', '- Modify: `src/b.js`'], ['Waived src/typo.js: stale', 'Waived AC1.1: a Check E waiver', '']));
  assert.deepStrictEqual(r.orphanWaivers, [{ path: 'src/typo.js', reason: 'stale' }]);
  assert.deepStrictEqual(r.waived, []);
});

test('#3602: a Key Files path the build only reads is still reported until a task names it or a waiver covers it', () => {
  const r = checkF('## Technical Approach\n\n### Key Files\n\n- `src/read-only.js` — read to confirm the shape\n', fPlan(['- Modify: `src/other.js`']));
  assert.deepStrictEqual(r.unlisted, [{ path: 'src/read-only.js', section: 'Technical Approach' }]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/plan-audit/checks.test.js`
Expected: FAIL after Step 1 — `checkF is not a function`

- [ ] **Step 3: Implement `checkF(specText, planText)` in `plugin/bin/lib/plan-audit/checks.js`**

Add it after `checkE` under a `// ── Check F — Spec-named path coverage (#3602)` comment. The comment states: warn-only, because path extraction from prose is a heuristic and a hard gate would block builds on its false positives; it reads only Technical Approach and Gotchas; it does exact matching after normalization plus a whole-segment suffix; it has no quoted-text fallback (#3602's report named Check E's keyword noise); and `unparsed` passes through untouched. Add `checkF` to `module.exports` and to the module's header comment ("Checks A/B/C/D, the headroom check, and the warn-only Checks E (#3099) and F (#3602)"). Order per path: a waiver first (first waiver wins per path); else `listed` with `via: 'exact'` when the normalized `Files:` set has it; else `via: 'suffix'` when some normalized `Files:` path ends with `'/' + path`; else `unlisted`. `orphanWaivers` holds the waivers whose path is not among the extracted paths. Normalize every `extractFileEntries` path with `normalizeRepoPath`.

- [ ] **Step 4: Run the tests to verify they pass** (covers AC1.1, AC1.2, AC2.1, AC4.1)

Run: `node --test tests/bin-lib/plan-audit/checks.test.js`
Expected: PASS

- [ ] **Step 5: Prove each new test discriminates (AC6.1)** — apply each mutation alone, re-run, confirm the named test FAILS, then restore:
  - Return `ok: r.unlisted.length === 0` → the AC1.1 test fails.
  - Skip the waiver lookup → the AC1.2 test fails.
  - Drop the `normalizeRepoPath` call on `Files:` paths → the normalization test fails.
  - Use `endsWith(path)` without the `'/'` → the suffix test fails.
  - Drop the orphan filter → the orphan test fails.
  - Return `unparsed: []` → the AC4.1 test fails.
  - The AC2.1 and Key Files tests are proven at the parser seam by Task 1 Step 5. Re-confirm here by temporarily adding `'Deliverables'` to the parser's section list.

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/lib/plan-audit/checks.js tests/bin-lib/plan-audit/checks.test.js
git commit -m "Add warn-only plan-audit Check F — spec-named paths no task lists (Refs #3602)"
```

### Task 3: CLI wiring — envelope key, summary line, comments

**Files:**
- Modify: `plugin/bin/plan-audit.js`
- Modify: `plugin/bin/lib/plan-audit/args.js`
- Test: `tests/bin-lib/plan-audit/cli.test.js`

**Interfaces:**
- Consumes: `checkF(specText, planText)` (Task 2).
- Produces: the envelope key `checkF` after `checkE`. Summary parts, in this order and only when `!report.checkF.skipped`:
  - `Check F: {N} unlisted spec path(s)`
  - `Check F: {N} unparsed spec block(s)`
  - `Check F: {N} orphan path waiver(s)`

- [ ] **Step 1: Write the failing tests** (append to `tests/bin-lib/plan-audit/cli.test.js`, reusing `makeERepo`, `writePlan`, `cliEPlan`, and `runCliArgs`; and edit the existing `AC4.1 (#3099)` test)

```js
const CLI_F_SPEC = ['## Acceptance Criteria', '', '1. The report renders.', '', '## Technical Approach', '',
  'Read `src/a.js` and `src/b.js` back; change them only if they break.', ''].join('\n');

test('AC1.1 (#3602): --spec reports both unlisted Technical Approach paths in checkF and the summary line; exit stays 0', () => {
  const repo = makeERepo();
  try {
    const plan = writePlan(repo, cliEPlan());
    const spec = path.join(repo, 'spec.md');
    fs.writeFileSync(spec, CLI_F_SPEC);
    const { exitCode, stdout } = runCliArgs([plan, '--repo-root', repo, '--spec', spec]);
    assert.strictEqual(exitCode, 0);
    const report = JSON.parse(stdout.split('\n')[0]);
    assert.strictEqual(report.checkF.ok, true);
    assert.deepStrictEqual(report.checkF.unlisted, [
      { path: 'src/a.js', section: 'Technical Approach' },
      { path: 'src/b.js', section: 'Technical Approach' },
    ]);
    assert.strictEqual(stdout.split('\n')[1], 'plan-audit: Check F: 2 unlisted spec path(s).');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('AC3.1 (#3602): unlisted spec paths never decide the exit code — a failing Check A alone does', () => {
  // plan = cliEPlan().replace('plugin/bin/existing.js', 'does/not/exist.js'), spec = CLI_F_SPEC
  // assert exitCode === 1, report.checkA.ok === false, report.checkF.ok === true, report.checkF.unlisted.length === 2
});

test('#3602: an unparsed Technical Approach line and an orphan path waiver each get their own summary part', () => {
  // spec = '## Acceptance Criteria\n\n1. The report renders.\n\n## Technical Approach\n\nRead `src/a.js and stop.\n'
  // plan = cliEPlan(['Waived src/typo.js: stale', ''])
  // assert exitCode === 0 and stdout line 2 === 'plan-audit: Check F: 1 unparsed spec block(s); Check F: 1 orphan path waiver(s).'
});
```

Edit the existing test `AC4.1 (#3099): without --spec the envelope carries checkE …` (cli.test.js:568) and retitle it `AC4.1 (#3099) + AC3.1 (#3602): without --spec the envelope carries checkE and checkF {ok: true, skipped: no-spec}; …`. Then:
- Add `assert.deepStrictEqual(a.checkF, { ok: true, skipped: 'no-spec' });`.
- Change both destructures to `const { checkE: dropA, checkF: dropFA, ...restA } = a;` and `const { checkE: dropB, checkF: dropFB, ...restB } = b;`.

The existing `Object.keys(restA)` list, the summary assertions, and the exit-code assertions stay as they are. They now prove the exit code and every other key are identical with and without Check F.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/plan-audit/cli.test.js`
Expected: FAIL after Step 1 — `report.checkF` is undefined

- [ ] **Step 3: Wire `checkF` into `plugin/bin/plan-audit.js`; update the comments in `plan-audit.js` and `args.js`**
  - Import `checkF`.
  - Add `checkF: specText === null ? { ok: true, skipped: 'no-spec' } : checkF(specText, text),` after `checkE` in `report`.
  - Add the three summary parts (Interfaces above) after the Check E block, under a `// #3602: warn-only, like Check E` comment.
  - Leave `pass` unchanged.
  - Header comment: name "the warn-only Checks E (#3099, AC clause coverage) and F (#3602, spec-named path coverage) — both run only with `--spec`", and "any Check E or Check F entry alone does not fail".
  - `args.js:40` comment: "--spec feeds Checks E and F (#3602), which only the full audit runs". No code change in `args.js`.

- [ ] **Step 4: Run the tests to verify they pass** (covers AC1.1, AC3.1)

Run: `node --test tests/bin-lib/plan-audit/cli.test.js tests/plan-audit-check-e-prose.test.js`
Expected: PASS (the E-prose flag-mirror test proves `USAGE` is unchanged)

- [ ] **Step 5: Prove each new test discriminates (AC6.1)** — apply each mutation alone, re-run `node --test tests/bin-lib/plan-audit/cli.test.js`, confirm the named test FAILS, then restore:
  - Add `&& report.checkF.unlisted.length === 0` to `pass` (guarded by `!report.checkF.skipped`) → the AC1.1 CLI test fails on exit code.
  - Drop the `skipped` ternary → the edited AC4.1 + AC3.1 test fails.
  - Delete the orphan-waiver summary part → the summary-parts test fails.
  - The AC3.1 Check-A test is exit-code-shaped: it fails if `pass` stops including `checkA.ok`. Confirm that once and restore.

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/plan-audit.js plugin/bin/lib/plan-audit/args.js tests/bin-lib/plan-audit/cli.test.js
git commit -m "Wire plan-audit Check F into the CLI envelope and summary line (Refs #3602)"
```

### Task 4: Docs, prose pins, enumeration sweep, full suite

**Files:**
- Modify: `plugin/skills/build/plan-audit.md`
- Modify: `plugin/skills/build/plan-authoring-checks.md`
- Modify: `plugin/skills/build/SKILL.md`
- Modify: `docs/plugin-structure.md`
- Create: `tests/plan-audit-check-f-prose.test.js`

**Interfaces:**
- Consumes: result keys from Task 2 (`unlisted`, `unparsed`, `waived`, `listed`, `orphanWaivers`) and summary wording from Task 3.

- [ ] **Step 1: Write the failing prose test** `tests/plan-audit-check-f-prose.test.js`. Mirror `tests/plan-audit-check-e-prose.test.js`'s header comment, `read`, and `bullet(text, label)` helpers. Locate the plan-authoring paragraph with exactly one `startsWith('**Verify-then-maybe-change check:**')` match among `\r?\n\r?\n`-split paragraphs, as `tests/plan-authoring-ac-clause-ids-prose.test.js` does. Tests and assertions:
  - `AC5.1 (#3602): plan-audit.md's opening enumeration names Check F`: the first paragraph after `# Common Step 1.5` matches `/warn-only Check E \(acceptance-criterion clause coverage, #3099\) and Check F \(spec-named path coverage, #3602\)/`.
  - `AC5.1 (#3602): the Invocation envelope list and --spec paragraph name checkF`: the file includes `` `{checkA, checkB, checkC, checkD, headroom, premiseRefs, checkE, checkF}` `` and matches `` /`checkE` and `checkF` are each `\{ok: true, skipped: 'no-spec'\}`/ ``.
  - `AC5.1 (#3602): Result interpretation documents every checkF result key`:
    - `bullet('`checkF.unlisted`')` matches `/amends the plan before dispatch/`, `` /`Waived \{path\}: \{reason\}`/ ``, and `/--step "Common Step 1\.5 \(Check F\)"/`.
    - `bullet('`checkF.unparsed`')` matches `/Never treat it as covered/` and `/--status SCANNED/`.
    - `bullet('`checkF.waived`')` matches `` /`checkF\.listed`/ `` and `/`suffix`/`.
    - `bullet('`checkF.orphanWaivers`')` exists.
  - `AC5.1 (#3602): What each check covers states Check F's sections, waiver, read-only rule, and warn-only status`: `bullet('Check F')` matches each of these:
    - `/warn-only/`
    - `` /`## Technical Approach`/ ``
    - `` /`### Key Files`/ ``
    - `` /`## Gotchas`/ ``
    - `` /never `## Acceptance Criteria` or `## Deliverables`/ ``
    - `` /`Waived \{path\}: \{reason\}`/ ``
    - `/no quoted-text fallback/`
    - `/only reads is exactly what this check exists to catch/`
    - `` /`unparsed`, never in `listed`/ ``
  - `#3602: plan-audit.md records the skip-gate ruling`: matches `/\*\*Check F shares that gate too\*\* \(#3602's ruling\)/`.
  - `AC5.1 (#3602): plan-authoring-checks.md holds the verify-then-maybe-change check`: the paragraph matches each of these:
    - `` /`## Technical Approach`/ `` and `` /`## Gotchas`/ ``
    - `/verify something, read something back, or change something only if a condition holds/`
    - `` /`Files:` block names each file the sentence reads/ ``
    - `` /`Waived \{path\}: \{reason\}`/ ``
    - `` /`checkF\.unlisted`/ ``
    - its `Buffer.byteLength` is at most 1000.
  - `#3602: build/SKILL.md Common Step 1.5 and docs/plugin-structure.md name Check F`:
    - The Step 1.5 slice (same `indexOf` bounds as the E-prose test) matches `/Check F \(spec-named path coverage\)/`.
    - The `node plugin/bin/plan-audit.js` line of `docs/plugin-structure.md` includes `checkE, checkF}` and `Check F (#3602`.
    - The `| build |` row includes `Check F (spec-named path coverage, #3602)`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/plan-audit-check-f-prose.test.js`
Expected: FAIL — every assertion misses (no Check F prose exists yet)

- [ ] **Step 3: Write the prose.** Edit in place, matching the surrounding voice. The pinned phrases above are exact copy.
  - `plan-audit.md`:
    - **Line 3:** replace `plus the warn-only Check E (acceptance-criterion clause coverage, #3099)` with `plus the warn-only Check E (acceptance-criterion clause coverage, #3099) and Check F (spec-named path coverage, #3602)`.
    - **Line 11:** append `, checkF` to the envelope list.
    - **Line 15:** `adds Check E.` → `adds Checks E and F.`; `` `checkE` is `{ok: true, skipped: 'no-spec'}` `` → `` `checkE` and `checkF` are each `{ok: true, skipped: 'no-spec'}` ``.
    - **Result interpretation:** after the `checkE.orphanWaivers` bullet, add four bullets.
      - `checkF.unlisted` (`[{path, section}, ...]`, `ok` always `true`): Check E's uncovered posture. The author amends the plan before dispatch, either adding the path to the `Files:` block of the task that verifies or changes it (adding that task if none exists), or adding `Waived {path}: {reason}` when the build only reads it. Then re-run the audit once. Auto mode logs with `` `node "${CLAUDE_PLUGIN_ROOT}/bin/log-decision.js" --run "$PIPELINE_RUN_DIR" --status AUTO --section "/build" --step "Common Step 1.5 (Check F)" --text "amended plan for {N} unlisted spec path(s) — listed {paths}; waived {paths}" --reversibility high` ``. Interactive mode surfaces it inline with no `AskUserQuestion`.
      - `checkF.unparsed` (`[{section, raw}, ...]`): informational-but-visible. Never treat it as covered; check those lines by reading; log with `--status SCANNED --text "Check F: {N} unparsed spec block(s) — checked by reading" --reversibility n/a`.
      - `checkF.waived` / `checkF.listed` (`via` `exact` or `suffix`, the weaker): with `unlisted` they account for every extracted path.
      - `checkF.orphanWaivers`: a stale or typo'd `Waived {path}:` line. Correct it to an extracted path or drop it.
    - **What each check covers:** add a `- **Check F**` bullet after Check E's, carrying every pinned phrase. Content per Global Constraints and Task 1/2:
      - It is warn-only; its sections are Technical Approach with `### Key Files`, and Gotchas.
      - The path-likeness rule is at least one `/`, a file extension, and no spaces, globs, `{placeholders}`, or URL scheme.
      - Normalization drops a leading `./` and a `:NN` suffix on both sides.
      - Matching is exact or on a whole-segment suffix (`_shared/x.md` matches `plugin/skills/_shared/x.md`).
      - Waiver: `Waived {path}: {reason}`. There is no quoted-text fallback.
      - Read-only sentence: "A path the build only reads is exactly what this check exists to catch, not a false positive: it still needs a task that names it or a waiver."
      - An absent section contributes nothing; an unbalanced line or unclosed fence lands in `unparsed`, never in `listed`.
    - **Skip-gate paragraph (line 77):** after `(`--spec` beside `--bytes` is a usage error).` insert `**Check F shares that gate too** (#3602's ruling), for Check E's reason: it reads only text already in memory and is warn-only.`
  - `plan-authoring-checks.md`: insert this paragraph after the `**Acceptance-criterion clause-id check:**` paragraph (at or under 1,000 B):

    `**Verify-then-maybe-change check:** every sentence in the spec's `## Technical Approach` (its `### Key Files` included) or `## Gotchas` that tells the builder to verify something, read something back, or change something only if a condition holds becomes a plan task or an explicit step inside one, and that task's `Files:` block names each file the sentence reads — as `Modify:` when the condition may change it. A file the build only reads gets a `Waived {path}: {reason}` line whose reason names the step that reads it. Such a sentence is neither a Deliverable nor an Acceptance Criterion, so nothing else carries it into the plan: in the incident behind #3602 a spec named two route files to read back, the plan touched neither, both per-task reviews passed, and only the whole-branch review found the reader the change broke. Run `plan-audit.js {plan} --spec {spec}` while authoring: `checkF.unlisted` lists each path those sections name that no `Files:` block lists.`
  - `build/SKILL.md:184`: `to add the warn-only Check E, AC-clause coverage (`plan-audit.md`)` → `to add the warn-only Check E (AC-clause coverage) and Check F (spec-named path coverage) (`plan-audit.md`)`. The net delta must be 60 B or less, and the literal `Check E` stays, because the E-prose test asserts `/Check E/`.
  - `docs/plugin-structure.md`:
    - **Build row (line 96):** `plus the warn-only Check E, AC-clause coverage, run when Common Step 1.5 passes `--spec`, #3099` → `plus the warn-only Check E (AC-clause coverage, #3099) and Check F (spec-named path coverage, #3602), run when Common Step 1.5 passes `--spec``.
    - **Usage line (line 221):** after the Check E parenthetical add ` and the warn-only Check F (#3602 — spec-named path coverage: each repo path the spec's `## Technical Approach`/`## Gotchas` names that no task's `Files:` block lists; same `--spec`-only, `skipped: 'no-spec'`, never-affects-exit contract)`, and append `, checkF` to its envelope list.

- [ ] **Step 4: Run the prose tests to verify they pass** (covers AC5.1)

Run: `node --test tests/plan-audit-check-f-prose.test.js tests/plan-audit-check-e-prose.test.js tests/plan-audit-skip-sentence-bytes-prose.test.js tests/plan-authoring-ac-clause-ids-prose.test.js tests/ceremony-profile-roster.test.js`
Expected: PASS

- [ ] **Step 5: Prove the prose test discriminates (AC6.1)** — for each pinned target, delete it, re-run `node --test tests/plan-audit-check-f-prose.test.js`, confirm the named test FAILS, then restore:
  - the `**Verify-then-maybe-change check:**` paragraph
  - the `**Check F shares that gate too**` sentence
  - the `- **Check F**` bullet
  - the `checkF.unlisted` bullet
  - `, checkF` in the envelope list

- [ ] **Step 6: Enumeration sweep and byte check.**
  - Run `git grep -nE 'Checks? A/B|Check E' -- plugin docs ':!docs/superpowers' ':!docs/plans'`. Every hit that enumerates the warn-only checks must also name Check F: `plan-audit.js` header, `checks.js` header, `args.js:40`, `plan-audit.md` lines 3/15 and the skip paragraph, `SKILL.md:184`, and `docs/plugin-structure.md` 96/221. A hit about Check E alone (its own bullets, parser/checks section comments, `summaryLine` lines) needs no change; name each such hit in the commit body as reviewed.
  - Then run `wc -c plugin/skills/build/plan-authoring-checks.md plugin/skills/build/SKILL.md plugin/skills/build/plan-audit.md`. Every file must be under 52,500. Record the numbers in the commit message.

- [ ] **Step 7: Verify the full test suite** (covers AC7.1)

Run: `npm test > "$TMPDIR/npm-test-3602.txt" 2>&1; echo "exit=$?"` then `tail -n 15 "$TMPDIR/npm-test-3602.txt"`
Expected: `exit=0` and `# fail 0`

- [ ] **Step 8: Commit**

```bash
git add plugin/skills/build/plan-audit.md plugin/skills/build/plan-authoring-checks.md plugin/skills/build/SKILL.md docs/plugin-structure.md tests/plan-audit-check-f-prose.test.js
git commit -m "Document plan-audit Check F and the verify-then-maybe-change plan-authoring check (Refs #3602)"
```
