# Prefilter Word Set Derived From Guard Parsers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `bash-prefilter.js` derives both of its word sets from one constant exported by `git-command.js`, and a differential corpus test proves that every command a guard parser targets takes the full-handler path.

**Architecture:** `git-command.js` exports `GUARDED_PROGRAM_WORDS`, a frozen object keyed by parser family: `git` (`['git', 'env']`, the words `findGitLead` keys on, used by `gitTargets`/`teardownTargets`), `mkdir` (`['mkdir']`, `mkdirTargets`), and `write` (`WRITE_SHAPES`, `fileWriteTargets`). `bash-prefilter.js` builds `PRE_TOOL_USE_WORDS` as the flattened values and `POST_TOOL_USE_WORDS` as the `git` family, so it holds no program-word literal of its own. The differential test runs a corpus through the four real parsers and asserts `shouldRunFull` is true for every targeted command, per event.

**Tech Stack:** Node 18+, `node --test`, no dependencies.

**Spec:** `.claude-tweaks/pipelines/2026-10-10T133006-record-3092/work/3092-spec.md`

## Global Constraints

- `bash-prefilter.js` holds no hand-typed program-word literal (AC1). Its only words come from `require('./git-command')`.
- `bash-prefilter.js` stays dependency-light: it may require only `fs` and `./git-command` (its header contract). Never require `pre-tool-use.js` from it.
- `PRE_TOOL_USE_WORDS` keeps its current members and order: `['git', 'env', 'mkdir', ...WRITE_SHAPES]`. `POST_TOOL_USE_WORDS` keeps `['git', 'env']`. Both stay frozen arrays with the same export names, because `tests/hooks-dispatcher.test.js` and `tests/hooks-gate-coverage.test.js` import them.
- `WRITE_SHAPES` stays the same frozen array object. `GATE_COVERAGE.bashWriteShapes` asserts identity with it (`tests/hooks-gate-coverage.test.js:120`).
- `perf/hooks-prefilter.test.js`'s skip-path budget must still hold (AC3). The skip path must not gain work beyond building two arrays once at module load.
- Commit style: `{Verb} {what} — {detail}`, imperative, ending with the line `Claude-Session: https://claude.ai/code/session_01TTWaqgMumX4GGXgtA8CkKa`.

## Review Focus

- **`env` is redundant by design.** Every command `findGitLead` resolves through `env` also carries a `git` word, so removing `env` from the constant cannot fail the differential test. The test carves `env` out of the per-word discrimination check by name, and asserts it is still a member, so the carve-out is visible rather than silent.
- **Assignment-plus-reference commands** (`G=git; $G commit`) reach the full path through the `ASSIGNMENT && PARAM_REFERENCE` rule, not through a word. They belong in the corpus because the parsers target them, but they do not count as discrimination witnesses for any word.
- **Post-tool-use runs only the git-family parsers** (`gitTargets`, plus `teardownTargets`'s Bash branch in `post-tool-use.js:504`). The post assertion must use only those two parsers, or a `cp` command would wrongly demand a post-tool-use full run.
- **Corpus rot.** If a parser change makes a corpus command stop producing a target, the differential assertion goes vacuously green. A sanity assertion requires every corpus entry to produce at least one target.
- **Docs that name the old pairing test.** `policy-schema-coverage.md:27` and `docs/hooks.md:11` say `tests/hooks-gate-coverage.test.js` pins the word-set pairing. After this change the differential test pins it, so both sentences must name it.

---

### Task 1: Export the guarded-program-word constant, derive the prefilter from it, pin it with a differential corpus test

**Files:**
- Modify: `plugin/bin/lib/hooks/git-command.js` (beside `WRITE_SHAPES`, line ~525, plus `module.exports` line ~709, plus the comment block at lines ~445-449 and ~517-523)
- Modify: `plugin/bin/lib/hooks/bash-prefilter.js:30-37`
- Modify: `tests/hooks-bash-prefilter.test.js:17-20` (replace the self-comparing test)
- Modify: `tests/hooks-gate-coverage.test.js:135-149` (drop the by-construction `includes()` assertion)
- Modify: `plugin/skills/_shared/policy-schema-coverage.md:27` (one sentence: name the differential test)
- Modify: `docs/hooks.md:11` (one clause: name the differential test)
- Test: `tests/hooks-bash-prefilter.test.js`

**Interfaces:**
- Consumes: `gitTargets(command, cwd)`, `fileWriteTargets(command, cwd)`, `mkdirTargets(command, cwd)` from `plugin/bin/lib/hooks/git-command.js` (each returns an array of targets). `teardownTargets(ctx)` from `plugin/bin/lib/hooks/pre-tool-use.js`, with `ctx = { input: { tool_name: 'Bash', tool_input: { command } }, cwd }`, also returning an array. `shouldRunFull(event, input)` and `commandWords(command)` from `bash-prefilter.js`.
- Produces: `GUARDED_PROGRAM_WORDS` exported from `git-command.js`: `Object.freeze({ git: Object.freeze(['git', 'env']), mkdir: Object.freeze(['mkdir']), write: WRITE_SHAPES })`. `PRE_TOOL_USE_WORDS` and `POST_TOOL_USE_WORDS` keep their names and values.

- [ ] **Step 1: Write the failing differential test**

In `tests/hooks-bash-prefilter.test.js`, replace the test at lines 17-20 (`'pre-tool-use words are git, env, mkdir plus every WRITE_SHAPES entry'`) with the block below. Extend the existing imports: add `GUARDED_PROGRAM_WORDS`, `gitTargets`, `fileWriteTargets` and `mkdirTargets` to the `git-command` require, and add one new require line for `teardownTargets` from `../plugin/bin/lib/hooks/pre-tool-use`. Keep `WRITE_SHAPES` if other tests in the file still use it (line ~41 does).

```js
// #3092: the corpus is run through the REAL guard parsers, so a word dropped
// from GUARDED_PROGRAM_WORDS (or a parser keyed on a word the constant never
// learned) shows up as a targeted command the prefilter skips. Every entry
// must produce a target; see the sanity test below.
const CWD = process.cwd();
const DIFFERENTIAL_CORPUS = [
  'cp a.txt b.txt', 'mv a.txt b.txt', 'echo x | tee out.txt', 'sed -i s/a/b/ f.txt',
  'perl -pi -e s/a/b/ f.txt', 'install -m 644 a.txt dest.txt', 'ln -s a.txt link.txt',
  'truncate -s 0 f.txt', 'dd if=/dev/zero of=f.bin count=1', 'mkdir -p newdir',
  'git commit -m x', 'git push', 'git rm f.txt', 'env git commit -m x', 'env -i git push',
  '/usr/bin/git commit -m x', 'git worktree remove ../w',
  'G=git; $G commit -m x', 'C=cp; $C a.txt b.txt', 'X=mk; ${X}dir d',
];
const teardown = (command) => teardownTargets({ input: { tool_name: 'Bash', tool_input: { command } }, cwd: CWD });
// post-tool-use.js runs only the git-family parsers (gitTargets + teardownTargets' Bash branch).
const PARSERS_BY_EVENT = {
  'pre-tool-use': [(c) => gitTargets(c, CWD), (c) => fileWriteTargets(c, CWD), (c) => mkdirTargets(c, CWD), teardown],
  'post-tool-use': [(c) => gitTargets(c, CWD), teardown],
};
const targeted = (event, command) => PARSERS_BY_EVENT[event].some((parse) => parse(command).length > 0);

test('every differential-corpus command produces at least one guard-parser target (corpus has not rotted)', () => {
  for (const command of DIFFERENTIAL_CORPUS) {
    assert.ok(targeted('pre-tool-use', command), `no parser targets ${JSON.stringify(command)} — fix or drop the corpus entry`);
  }
});

for (const event of Object.keys(PARSERS_BY_EVENT)) {
  test(`${event}: every command a guard parser targets takes the full-handler path (#3092)`, () => {
    for (const command of DIFFERENTIAL_CORPUS) {
      if (!targeted(event, command)) continue;
      assert.strictEqual(shouldRunFull(event, bash(command)), true,
        `${event} prefilter skips ${JSON.stringify(command)} although a guard parser targets it`);
    }
  });
}

test('every guarded program word except env is the sole trigger of some targeted corpus command', () => {
  // Removing such a word from GUARDED_PROGRAM_WORDS makes its witness skip, so
  // the differential tests above fail. `env` is superset hygiene: every env-wrapped
  // command findGitLead resolves also carries `git`, so no witness can exist.
  const all = Object.values(GUARDED_PROGRAM_WORDS).flat();
  assert.ok(all.includes('env'), 'env must stay in the git family (findGitLead walks past it)');
  for (const word of all.filter((w) => w !== 'env')) {
    const witness = DIFFERENTIAL_CORPUS.find((command) => {
      if (!targeted('pre-tool-use', command) || /=/.test(command.split(/\s/)[0])) return false;
      const covered = [...commandWords(command)].filter((w) => all.includes(w));
      return covered.length === 1 && covered[0] === word;
    });
    assert.ok(witness, `no corpus command is triggered by '${word}' alone — add one so dropping it fails`);
  }
});
```

Note the witness filter. `/=/.test(command.split(/\s/)[0])` excludes the assignment-led entries (`G=git; …`), because those reach the full path through the assignment rule, not a word. `dd if=… of=…` is unaffected, since its first token `dd` has no `=`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/hooks-bash-prefilter.test.js`
Expected: FAIL. The three new tests that read `GUARDED_PROGRAM_WORDS` throw `TypeError: Cannot convert undefined or null to object`, or the import yields `undefined`. The sanity test and the two per-event differential tests pass already, which is correct: today's prefilter has no gap. The constant is what is missing.

- [ ] **Step 3: Export the constant from `git-command.js`**

Directly after the `WRITE_SHAPES` declaration (line ~525), add:

```js
// Every program word a guard parser in this module keys on, by parser family —
// bash-prefilter.js derives BOTH of its word sets from this, so a parser keyed on
// a new word is reached by adding it here, never by editing a second list (#3092).
//   git:   findGitLead's lead (`git`, or a path ending `/git`, which the prefilter
//          reaches by basename) and the `env` wrapper it walks past —
//          gitTargets, resolvedGitSegments, and teardownTargets (pre-tool-use.js)
//   mkdir: mkdirTargets' command word
//   write: fileWriteTargets' shapes
// tests/hooks-bash-prefilter.test.js's differential corpus runs the real parsers
// and fails when a targeted command's word is missing here.
const GUARDED_PROGRAM_WORDS = Object.freeze({
  git: Object.freeze(['git', 'env']),
  mkdir: Object.freeze(['mkdir']),
  write: WRITE_SHAPES,
});
```

Add `GUARDED_PROGRAM_WORDS` to the `module.exports` object after `WRITE_SHAPES`.

Update the two comment blocks that describe the old pairing:
- Lines ~447-449: replace "Every shape here is paired with a word in bash-prefilter.js's PRE_TOOL_USE_WORDS, which imports WRITE_SHAPES below — so a shape added there is covered by construction." with "Every shape here is a word in GUARDED_PROGRAM_WORDS.write (below), from which bash-prefilter.js derives PRE_TOOL_USE_WORDS — so a shape added there is covered by construction."
- Lines ~520-523: replace "bash-prefilter.js imports it for its PRE_TOOL_USE_WORDS," with "GUARDED_PROGRAM_WORDS.write (below) carries it into bash-prefilter.js's PRE_TOOL_USE_WORDS,".

- [ ] **Step 4: Derive the prefilter word sets**

In `plugin/bin/lib/hooks/bash-prefilter.js`, replace lines 30-37 (from `const { WRITE_SHAPES } = require('./git-command');` through the `POST_TOOL_USE_WORDS` line, including the `env` comment) with:

```js
const { GUARDED_PROGRAM_WORDS } = require('./git-command');

// Both word sets come from git-command.js, where the parsers that key on these
// words live (#3092): pre-tool-use runs every guard family, post-tool-use only the
// git family (gitTargets and teardownTargets' Bash branch). No word is typed here.
const PRE_TOOL_USE_WORDS = Object.freeze(Object.values(GUARDED_PROGRAM_WORDS).flat());
const POST_TOOL_USE_WORDS = GUARDED_PROGRAM_WORDS.git;
```

Also update the header line `// Dependency-light by contract: fs plus git-command.js (which requires only` if its wording no longer fits. It still does, so leave it unchanged.

- [ ] **Step 5: Run the test to verify it passes**

Run: `node --test tests/hooks-bash-prefilter.test.js`
Expected: PASS, every test.

- [ ] **Step 6: Prove the differential test discriminates (scratch mutation, not committed)**

Temporarily change `mkdir: Object.freeze(['mkdir'])` to `mkdir: Object.freeze([])` in `git-command.js` and run `node --test tests/hooks-bash-prefilter.test.js`.
Expected: FAIL, naming `mkdir -p newdir` (pre-tool-use differential) and `'mkdir'` (witness test).
Restore the line. Then temporarily drop `'tee'` from `WRITE_SHAPES` and run again.
Expected: FAIL, naming `echo x | tee out.txt`. `fileWriteTargets` itself also stops targeting tee, so it is the sanity test that names it. Either failure proves the corpus is wired to the live constant.
Restore with `git checkout -- plugin/bin/lib/hooks/git-command.js` only if Step 3's edit is already committed. Otherwise undo by hand and re-run Step 5. Record both outcomes in your report.

- [ ] **Step 7: Drop the by-construction assertion in `tests/hooks-gate-coverage.test.js`**

In the test `'every WRITE_SHAPES entry is a pre-tool-use prefilter word, and the Bash group is one unconditional handler (#70, #3074)'` (line ~135), delete only:

```js
    assert.ok(PRE_TOOL_USE_WORDS.includes(shape),
      `WRITE_SHAPES includes '${shape}' but the pre-tool-use prefilter skips it — the parser branch is dead code`);
```

Keep the `runsFull('pre-tool-use', \`${shape} a b\`)` assertion and the single-handler checks. Above the `for (const shape of WRITE_SHAPES)` loop, add the comment `// The word-set pairing itself is pinned by the differential corpus in tests/hooks-bash-prefilter.test.js (#3092).` If `PRE_TOOL_USE_WORDS` is then unused in this file, remove it from the line-22 require.

- [ ] **Step 8: Repoint the two docs that name the pairing test**

- `plugin/skills/_shared/policy-schema-coverage.md:27`: replace "`tests/hooks-gate-coverage.test.js` asserts the prefilter word set covers the write-shape list precisely because that asymmetry hid `sed -i` for months." with "`tests/hooks-bash-prefilter.test.js`'s differential corpus runs every guard parser and fails when a command one of them targets is skipped by the prefilter, precisely because that asymmetry hid `sed -i` for months." Then measure: `wc -c plugin/skills/_shared/policy-schema-coverage.md` must stay under 46080.
- `docs/hooks.md:11`: replace "— `tests/hooks-gate-coverage.test.js` pins the pairing." with "— the word set is derived from `git-command.js`'s `GUARDED_PROGRAM_WORDS`, and `tests/hooks-bash-prefilter.test.js`'s differential corpus pins it against the real parsers (#3092)."

- [ ] **Step 9: Run the affected suites and the perf budget**

Run: `node --test tests/hooks-bash-prefilter.test.js tests/hooks-gate-coverage.test.js tests/hooks-dispatcher.test.js`
Expected: PASS.
Run: `node --test perf/hooks-prefilter.test.js`
Expected: PASS (skip-path budget holds, AC3).
Run: `grep -nE "'(git|env|mkdir)'" plugin/bin/lib/hooks/bash-prefilter.js`
Expected: no output (AC1).

- [ ] **Step 10: Commit**

```bash
git add plugin/bin/lib/hooks/git-command.js plugin/bin/lib/hooks/bash-prefilter.js tests/hooks-bash-prefilter.test.js tests/hooks-gate-coverage.test.js plugin/skills/_shared/policy-schema-coverage.md docs/hooks.md
git commit -m "Derive the Bash prefilter word set from the guard parsers — GUARDED_PROGRAM_WORDS plus a differential corpus test (#3092)

Claude-Session: https://claude.ai/code/session_01TTWaqgMumX4GGXgtA8CkKa"
```
