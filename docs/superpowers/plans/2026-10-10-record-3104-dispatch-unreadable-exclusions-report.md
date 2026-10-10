# Report an Unreadable dispatch-exclusions.json as "Reason Unknown" (#3104) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When `dispatch-exclusions.json` exists but cannot be read or parsed, `/claude-tweaks:dispatch #N` reports the exclusion reason as unknown because the file is unreadable. It must never report the record as merely absent from the queue.

**Architecture:** Task 1 adds `readExclusionsStatus(path)` to `plugin/bin/lib/dispatch/exclusions.js`. It returns `{ status: 'ok' | 'absent' | 'unreadable', entries, error }`, which separates ENOENT from a read/parse/shape failure. `readExclusions` keeps its exact current contract by delegating to it. Task 2 adds a new report sub-file, `plugin/skills/dispatch/exclusions-unreadable-report.md`, holding the one-line status probe and the named report line. The `#N` bullet in `plugin/skills/dispatch/SKILL.md` cites it with a byte-neutral edit, and `docs/plugin-structure.md`'s dispatch sub-file row lists it.

**Tech Stack:** Node CommonJS, Markdown skill prose, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-10-10T190327-spec-3101-3102-3103-3104/spec-3104/work/3104-spec.md`

## Global Constraints

- `plugin/skills/dispatch/SKILL.md` must stay under 46080 bytes measured LF-normalized (`tr -d '\r' < plugin/skills/dispatch/SKILL.md | wc -c`). It is 46002 B at base, so the `#N` bullet edit must not grow the file. Trim the same bullet to pay for the citation.
- `readExclusions(path)` keeps its current contract unchanged: it returns `[]` on absent/unreadable/non-array, logs to stderr for unreadable and non-array but not for ENOENT, and never throws. Every existing caller (`queue-pull-script.md`, `next-ranking.md`, `firing-exclusion.md`) depends on it.
- The `#N` bullet must keep the literal phrases `no entry at all`, `never as an open PR`, `and stop`, and `not-spec-shaped-exclusion-report.md`. `tests/dispatch-named-form-exclusion-reasons.test.js` pins them.
- A single-line `node -e "…"` is safe on Windows Git Bash; only a multi-line one no-ops (`bin/node-eval-file.js`'s header). The probe must be one line.
- Commit message style: `{Verb} {what} — {detail}`, ending with `Claude-Session: https://claude.ai/code/session_01TTWaqgMumX4GGXgtA8CkKa`.

## Review Focus

- A file holding valid JSON that is not an array (e.g. `{}`) is corrupt too, so it must read as `unreadable`, not `ok`. Pinned in Task 1's tests.
- A permission error (EACCES) and a directory at the path (EISDIR) are read failures, not absence. Pinned by Task 1's EISDIR test, which uses a directory at the path and is portable.
- An empty array `[]` is a readable, valid file. The record genuinely has no entry, so it reports as absent. Pinned in Task 1's tests (`status: 'ok', entries: []`).
- The report line must name the unreadable file and its error, and must tell the human what to do: re-run the queue pull. Pinned in Task 2's prose test.
- The byte budget must hold. Pinned by Task 2's own `wc -c`-style test assertion.

---

### Task 1: `readExclusionsStatus` separates absent from unreadable

**Files:**
- Modify: `plugin/bin/lib/dispatch/exclusions.js` (around `readExclusions`, lines ~11-35, and `module.exports`)
- Test: `tests/bin-lib/dispatch/exclusions.test.js` (append)

**Interfaces:**
- Consumes: nothing.
- Produces: `readExclusionsStatus(path) → { status: 'ok'|'absent'|'unreadable', entries: object[], error: string|null }`, exported from `plugin/bin/lib/dispatch/exclusions.js`. Task 2's probe calls it.

- [ ] **Step 1: Write the failing tests**

Append to `tests/bin-lib/dispatch/exclusions.test.js`, and add `readExclusionsStatus` to the destructured `require` at the top:

```js
test('readExclusionsStatus: absent file is absent, never unreadable (#3104)', () => {
  assert.deepStrictEqual(readExclusionsStatus(tmpFile()), { status: 'absent', entries: [], error: null });
});

test('readExclusionsStatus: corrupt JSON, non-array JSON, and a directory are unreadable with an error (#3104)', () => {
  const corrupt = tmpFile();
  fs.writeFileSync(corrupt, 'not json');
  const nonArray = tmpFile();
  fs.writeFileSync(nonArray, JSON.stringify({ not: 'an array' }));
  const dir = tmpFile();
  fs.mkdirSync(dir);
  for (const p of [corrupt, nonArray, dir]) {
    const r = readExclusionsStatus(p);
    assert.equal(r.status, 'unreadable', `${p} must read as unreadable`);
    assert.deepStrictEqual(r.entries, []);
    assert.equal(typeof r.error, 'string');
    assert.ok(r.error.length > 0);
  }
});

test('readExclusionsStatus: a valid array, empty or not, is ok (#3104)', () => {
  const empty = tmpFile();
  fs.writeFileSync(empty, '[]');
  assert.deepStrictEqual(readExclusionsStatus(empty), { status: 'ok', entries: [], error: null });
  const full = tmpFile();
  const entry = { reason: 'not-spec-shaped', records: [7], detail: { missing: ['Release Note'] } };
  fs.writeFileSync(full, JSON.stringify([entry]));
  assert.deepStrictEqual(readExclusionsStatus(full), { status: 'ok', entries: [entry], error: null });
});

test('readExclusionsStatus never logs; readExclusions keeps its stderr diagnostics (#3104)', () => {
  const originalError = console.error;
  const calls = [];
  console.error = (...args) => calls.push(args.join(' '));
  try {
    const corrupt = tmpFile();
    fs.writeFileSync(corrupt, 'not json');
    readExclusionsStatus(corrupt);
    assert.deepStrictEqual(calls, [], 'readExclusionsStatus must stay silent -- callers render the error themselves');
    assert.deepStrictEqual(readExclusions(corrupt), []);
    assert.equal(calls.length, 1);
  } finally {
    console.error = originalError;
  }
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/dispatch/exclusions.test.js`
Expected: FAIL, with `readExclusionsStatus is not a function`.

- [ ] **Step 3: Implement**

In `plugin/bin/lib/dispatch/exclusions.js`, add `readExclusionsStatus` above `readExclusions`, then make `readExclusions` delegate to it. Keep `readExclusions`' existing comment block; append one line to it naming `readExclusionsStatus` as the variant for callers that must tell absent from unreadable (#3104).

```js
// #3104: the same read as readExclusions, but it reports *why* there are no
// entries instead of collapsing absent and unreadable into []. dispatch #N must
// not call a record "absent from this firing's queue" when the file that would
// say otherwise could not be read. Silent: the caller renders the error itself.
function readExclusionsStatus(path) {
  let raw;
  try {
    raw = fs.readFileSync(path, 'utf8');
  } catch (err) {
    if (err && err.code === 'ENOENT') return { status: 'absent', entries: [], error: null };
    return { status: 'unreadable', entries: [], error: err.code || err.message };
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return { status: 'unreadable', entries: [], error: err.message };
  }
  if (!Array.isArray(parsed)) return { status: 'unreadable', entries: [], error: 'not a JSON array' };
  return { status: 'ok', entries: parsed, error: null };
}

function readExclusions(path) {
  const r = readExclusionsStatus(path);
  if (r.status === 'unreadable') {
    if (r.error === 'not a JSON array') {
      console.error(`readExclusions: ${path} did not contain a JSON array -- treating as empty`);
    } else {
      console.error(`readExclusions: ${path} unreadable (${r.error}) -- treating as empty`);
    }
  }
  return r.entries;
}
```

Export it: `readExclusions, readExclusionsStatus, appendExclusion, excludedNumbers, groupIsExcluded,`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/dispatch/exclusions.test.js tests/dispatch-not-spec-shaped-exclusion-fixture.test.js tests/dispatch-named-target-exclusion-fixture.test.js`
Expected: PASS. The existing `readExclusions` tests, including the exact-once stderr counts, must still pass unchanged.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/dispatch/exclusions.js tests/bin-lib/dispatch/exclusions.test.js
git commit -m "Add readExclusionsStatus — tell an unreadable dispatch-exclusions.json from an absent one (#3104)"
```

### Task 2: Report the unreadable case by name from the `#N` bullet

**Files:**
- Create: `plugin/skills/dispatch/exclusions-unreadable-report.md`
- Modify: `plugin/skills/dispatch/SKILL.md` (the `**\`#N\`** — direct.` bullet only, ~line 178)
- Modify: `docs/plugin-structure.md` (the `| dispatch |` row: add the file to the sub-file list, and add one sentence to the notes column)
- Test: `tests/dispatch-named-form-exclusion-reasons.test.js` (append)

**Interfaces:**
- Consumes: `readExclusionsStatus` from Task 1.
- Produces: nothing.

- [ ] **Step 1: Write the failing test**

Append to `tests/dispatch-named-form-exclusion-reasons.test.js`:

```js
test('dispatch #N reports an unreadable dispatch-exclusions.json as reason-unknown, never as absent, within the byte ceiling (#3104)', () => {
  assert.ok(SINGLE.includes('exclusions-unreadable-report.md'), '#N bullet must cite exclusions-unreadable-report.md for the unreadable case');
  const report = readText(path.join(DISPATCH, 'exclusions-unreadable-report.md'));
  assert.ok(report.includes('readExclusionsStatus'), 'the report must probe readExclusionsStatus, not readExclusions');
  assert.match(report, /reason unknown/, 'the report line must say the reason is unknown');
  assert.match(report, /never .*absent from this firing's queue/, 'the report must forbid the absent misreport');
  assert.ok(report.includes('Step 2'), 'the report must route the human to re-run the queue pull (Step 2)');
  const probe = report.split('\n').find((l) => l.includes('readExclusionsStatus') && l.trimStart().startsWith('node '));
  assert.ok(probe, 'the report must carry a one-line node probe');
  const lf = require('node:fs').readFileSync(path.join(DISPATCH, 'SKILL.md'), 'utf8').replace(/\r\n/g, '\n');
  assert.ok(Buffer.byteLength(lf, 'utf8') < 46080, `dispatch/SKILL.md is ${Buffer.byteLength(lf, 'utf8')} B LF -- must stay under 46080`);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/dispatch-named-form-exclusion-reasons.test.js`
Expected: FAIL, with `#N bullet must cite exclusions-unreadable-report.md for the unreadable case`.

- [ ] **Step 3: Implement**

Create `plugin/skills/dispatch/exclusions-unreadable-report.md`:

````markdown
# Dispatch Step 3 — Unreadable Exclusions Report (`#N` form)

Referenced by `skills/dispatch/SKILL.md` Step 3's `#N` bullet (#3104). Read it only when a named
record clears the label checks, is absent from `dispatch-groups.json`, and has no
`dispatch-exclusions.json` entry naming it. That is the one case where "absent from this firing's
queue" would otherwise be reported.

`readExclusions` returns `[]` both when the file is missing and when it is corrupt, unreadable or
not a JSON array. An empty read therefore cannot tell "nothing excluded this record" from "the
list that would say why could not be read". Probe the file's status first, as one line.
`$DISPATCH_EXCLUSIONS` is the session-scoped path `queue-pull-script.md` resolved. In a fresh shell,
re-resolve it the same way that script does, never by guessing a path.

```bash
node -e "console.log(JSON.stringify(require(process.argv[1]).readExclusionsStatus(process.argv[2])))" "${CLAUDE_PLUGIN_ROOT}/bin/lib/dispatch/exclusions.js" "$DISPATCH_EXCLUSIONS"
```

- `status: "ok"` or `status: "absent"`: the file was read (or never written this firing), so the
  record really has no exclusion entry. Report it as absent from this firing's queue, as the `#N`
  bullet says.
- `status: "unreadable"`: report

  `#{N} — exclusion reason unknown: this firing's dispatch-exclusions.json could not be read ({error}). Re-run the queue pull (Step 2), then name #{N} again.`

  and stop. Never report it as absent from this firing's queue: a record the queue pull really
  excluded (e.g. `not-spec-shaped`) would read as merely missing, which is the misreport class
  #3084 removed.
````

In `plugin/skills/dispatch/SKILL.md`'s `#N` bullet, replace `no entry at all as absent from this firing's queue.` with `no entry at all as absent from this firing's queue, after exclusions-unreadable-report.md rules out an unreadable file.`. Wrap the filename in backticks, as the bullet's other sub-file names are. Then pay for the added bytes inside the same bullet without losing a pinned phrase: drop `session-scoped ` from `this run's session-scoped \`dispatch-exclusions.json\``, and shorten `(re-verify against Step 2's live queue, not a cached table)` to `(re-verify against Step 2's live queue)`. Measure with `tr -d '\r' < plugin/skills/dispatch/SKILL.md | wc -c`: it must be ≤ 46002, the base size. If it isn't, trim further inside the same bullet only, keeping every phrase listed in Global Constraints.

In `docs/plugin-structure.md`'s `| dispatch |` row, append `, exclusions-unreadable-report.md` to the sub-file list, after `not-spec-shaped-exclusion-report.md`. Then append this sentence to the end of the notes column, before the closing ` |`: ` exclusions-unreadable-report.md holds the #N form's probe for an unreadable dispatch-exclusions.json (readExclusionsStatus) and its reason-unknown report line, so a corrupt exclusion list is never reported as absence (#3104)`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/dispatch-named-form-exclusion-reasons.test.js tests/bin-lib/dispatch/exclusions.test.js`
Then also run any test that pins plugin-structure.md's sub-file tables, if one exists: `node --test tests/plugin-structure-subfile-tables.test.js` (skip it if the file is absent). Find it with `ls tests | grep -i subfile`, and run whichever exists.
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/dispatch/exclusions-unreadable-report.md plugin/skills/dispatch/SKILL.md docs/plugin-structure.md tests/dispatch-named-form-exclusion-reasons.test.js
git commit -m "Report an unreadable dispatch-exclusions.json as reason-unknown from dispatch #N, never as absent (#3104)"
```
