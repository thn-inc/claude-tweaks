# Write Gate Substitution Walk Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The worktree-always write gate walks the commands inside every `$( … )`, backtick and `<( … )`/`>( … )` body, so a write, mkdir or git command there resolves where bash runs it.

**Architecture:** Three mechanisms in `plugin/bin/lib/hooks/git-command.js`. (1) A body the walk's piece holds whole is found by a new `substitutionBodies(text)` and walked recursively as its own chunk from the piece's starting cwds (a subshell: what it changes is dropped), and the piece is visited with the body blanked. (2) A substitution opener the segment splitter cut inside (a separator in the body) is reported by `groupEventsWith` as a `rest` piece one level deeper, so the existing sub-run machinery walks the substitution's first command. (3) A backtick span holding a separator is split at its closer (`segmentSpans`' new `btClose`), so its last command is walked inside it and the text after the closer is the outer command's tail.

**Tech Stack:** Node 18+, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-10-28T190057-record-4446/work/4446-spec.md`

**Scope keywords:** substitutionBodies, groupEventsWith, segmentSpansWith

**Prototype:** every code block below was run as a whole in a scratch worktree at fae7a76ba: the four scanner suites and `perf/heredoc-scan-linearity.test.js` pass (only the pin rows Tasks 2 and 3 update fail), the tests below pass (59/59; 45 of them fail at base), the base comparison over the 1,606 scanner calls the suites make moves nothing from allowed to denied outside the listed classes, and 1,350 fuzzed commands under bash 3.2 and 5 leak nothing (base leaks in 134 of 400 at seed 99). Raw diff: `/private/tmp/claude-501/-Users-thomasholknielsen-Code-Workspaces-claude-tweaks/6632f468-fb30-4491-bfde-ec591460a9c3/scratchpad/4446/proto.diff`.

## Global Constraints

- Quoted verbatim from `.claude/skills/shell-scanner-bash-differential/SKILL.md` (it governs `git-command.js`):
  - "Run every case you add or change under `/bin/bash` (3.2, macOS) and a bash 5 (`/opt/homebrew/bin/bash` here) … Write the verdict into the test comment … When the versions disagree, note it … and side with whichever shell writes. Never derive an expected target from the scanner's own output or from memory of the bash manual."
  - "The gate's tradeoff is that a spurious deny is acceptable and a leak is not. … Pin each fail-closed tradeoff as deliberate, so a later 'fix' cannot quietly reopen it."
  - "Every new rule can regress a shape that already worked. Run the full case list through `git-command.js` at the merge-base … Diff the targets. Anything that moves from denied to allowed needs its own bash verdict."
  - "Wall-clock budgets go in `perf/heredoc-scan-linearity.test.js`. A `ms < 750` assertion in `tests/` failed `npm test` under load."
  - "In a scratch worktree, delete or invert each rule one at a time and run the four suites. A mutant that every test survives means one of two things: a pin is missing … or the rule is dead (remove it)."
  - "Test titles name the record and the behavior (`#4149: …`), never review-round labels (m1, F2, round N)."
  - "Expected paths the scanner resolves go through `path.resolve` (`MAIN_F` in `tests/hooks-gate-coverage.test.js`), or the pin fails on win32."
  - "This session's Bash guard refuses heredocs, `cd` chains and any argument containing a `git` token. Write the drivers as scratchpad node scripts and run them with `node <script>`."
  - "Judging a case only under bash 3.2 and 5 … Run zsh as a third oracle … Whether the scanner should follow zsh is still an open decision (#4455), so do not quietly side with zsh in the expected target."
- The four scanner suites: `tests/hooks-gate-coverage.test.js`, `tests/hooks-git-command.test.js`, `tests/hooks-bash-prefilter.test.js`, `tests/teardown-gate.test.js`. A Bash command naming the second file is refused by the session guard (it holds `git`); run the suites through a scratchpad node script that spawns `node --test` with the four paths (one is at `/private/tmp/claude-501/-Users-thomasholknielsen-Code-Workspaces-claude-tweaks/6632f468-fb30-4491-bfde-ec591460a9c3/scratchpad/4446/run-suites.js <repo-root> <out-file> [files…]`).
- Never `git stash`. Commit messages end with `refs #4446`, never `closes`/`fixes`.
- Bash verdicts below were taken with the bounded oracle (`oracle-cases.js` beside `run-suites.js`): each row's comment states them; the rows use `/main`, `/wt`, `/r` where the oracle ran `../main`, `../wt` and the tree's `r` dir.

## Review Focus

1. A `git commit -m "$(cat <<'EOF' … EOF)"` message (this repo's commit idiom): the body's prose never becomes a target, and a redirect after the closing `)"` still does. Pinned by the existing #4149 routine and #4210 heredoc rows, which must stay green, plus Task 1's heredoc row.
2. Single-quoted, ANSI-C quoted, escaped `\$(` and double-quoted `<(` text is never walked. Task 1's negative rows.
3. A deep or long nest stays bounded: past eight levels the body keeps the reading it had before (#4446's cost cap), past NEST_LEVEL_CAP the scan reads nothing new, and a run of 2,000 unclosed openers costs linear text. Tasks 1 and 2.
4. `$(( … ))` arithmetic is not walked as commands, inside double quotes too, while a substitution inside it is. Tasks 1 and 2.
5. A `cd` inside any substitution never reaches the commands after it. Tasks 1, 2 and 3 rows with `> g` after the substitution.

---

### Task 1: Walk each substitution body a piece holds whole

**Role:** judgment
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/hooks/git-command.js` (`nestBudget` neighbourhood ~line 167, `scanCommandSubstitution` ~line 277, a new function after `closesDoubled` ~line 2302, `walkShellChunk` signature ~line 2448 and `visitPiece`/`runBodies` ~lines 2638-2649)
- Test: `tests/hooks-gate-coverage.test.js` (new block after the `#4303: a $(( subshell scopes its cd …` test, ~line 836)

**Interfaces:**
- Produces: `substitutionBodies(text: string) -> null | { bodies: string[], text: string }` (module-private); `walkShellChunk(…, pathImpl, subDepth = 0)` (new trailing parameter); module-level `let nestNoHeredoc = false`; constants `BODY_BLANK = '_'`, `SUB_BODY_DEPTH_CAP = 8`. Tasks 2 and 3 edit `substitutionBodies`' unclosed-opener branch only.

- [ ] **Step 1: Write the failing tests** (append to `tests/hooks-gate-coverage.test.js`; `MAIN_F`, `MAIN_ROOT`, `fileWriteTargets`, `gitTargets`, `mkdirTargets` already exist there)

```js
// #4446: a substitution body the walk's piece holds whole runs before the piece's command, in a subshell from
// the cwd the piece starts at, so it is walked as a command list of its own. Bash 3.2 and 5 (zsh too) write the
// listed file for each row and nothing for the [] rows; `echo a 2>(…)` runs the process substitution (fd word
// `2` is an argument there), `echo a >>(…)` does not (zsh does). `cd /main $(cp a f)`: the substitution runs
// in r before cd (bash 3.2 and 5 write r/f and main/g).
const files4446 = (command) => fileWriteTargets(command, '/r').map((t) => t.file);
for (const [command, expected] of [
  ['echo $(cp a /main/f.js)', [MAIN_F]],
  ['echo `cp a /main/f.js`', [MAIN_F]],
  ['echo "$(echo x > /main/f.js)"', [MAIN_F]],
  ['X="$(cp a /main/f.js)"', [MAIN_F]],
  ['echo `echo x > f`', [path.resolve('/r/f')]],
  ['cat <(cp a /main/f.js)', [MAIN_F]],
  ['echo >(cp a /main/f.js)', [MAIN_F]],
  ['echo a 2>(cp a /main/f.js)', [MAIN_F]],
  ['echo "`cp a /main/f.js`"', [MAIN_F]],
  ['echo ${x:-$(cp a /main/f.js)}', [MAIN_F]],
  ['echo $(echo $(cp a /main/f.js))', [MAIN_F]],
  ['x="$(cd /main; cp a f.js)"', [MAIN_F]],
  ['cd /main && x="$(cd ../wt; cp a f.js)"', [path.resolve('/wt/f.js')]],
  ['echo `echo \\`cp a /main/f.js\\``', [MAIN_F]],
  ["x=\"$(cat <<'EOF'\nm\nEOF\ncp a /main/f.js)\"", [MAIN_F]],
  ['cd /main $(cp a f); echo y > g', [path.resolve('/r/f'), path.resolve('/main/g')]],
  ['echo $(D=/main); cp a $D/f', []],
  ["echo '$(cp a /main/f.js)'", []],
  ["echo $'$(cp a /main/f.js)'", []],
  ['echo "\\$(cp a /main/f.js)"', []],
  ['echo "<(cp a /main/f.js)"', []],
  ['echo a >>(cp a /main/f.js)', []],
  ['echo "$(( a>1 ))"', []],
  ['x=$( (( a>1 )) )', []],
]) {
  test(`#4446: \`${command}\` walks its substitution body`, () => {
    assert.deepStrictEqual(files4446(command), expected);
  });
}
// #4446: bash 3.2 and 5 run `git -C /main commit` and create /main/d.
test('#4446: a git or mkdir command inside a substitution body is a target', () => {
  assert.deepStrictEqual(gitTargets('x=$(git -C /main commit -m y)', '/r'), [{ action: 'commit', dir: MAIN_ROOT }]);
  assert.deepStrictEqual(mkdirTargets('x=$(mkdir /main/d)', '/r').map((t) => t.file), [path.resolve('/main/d')]);
});
// #4446: SUB_BODY_DEPTH_CAP. Bash 3.2 and 5 write /main/f.js for the cp nest and nothing for the arithmetic ones.
const nest4446 = (k, inner) => 'x=' + '$(echo '.repeat(k - 1) + '$(' + inner + ')' + ')'.repeat(k - 1);
test('#4446: bodies are walked eight substitution levels deep', () => {
  assert.deepStrictEqual(files4446(nest4446(8, 'cp a /main/f.js')), [MAIN_F]);
  assert.deepStrictEqual(files4446(nest4446(8, ' (( a>1 )) ')), []);
});
test('#4446: a body past eight levels keeps its text in the command around it (deliberate fail-closed tradeoff)', () => {
  assert.deepStrictEqual(files4446(nest4446(9, ' (( a>1 )) ')), [path.resolve('/r/1')]);
});
test('#4446: a nest past NEST_LEVEL_CAP is read as before #4446 (deliberate fail-closed tradeoff)', () => {
  assert.deepStrictEqual(files4446(nest4446(40, ' (( a>1 )) ')), [path.resolve('/r/1')]);
});
// #4446: after the cwd cap (five relative-cd groups make 32 cwds), a write inside "$( cd …; … )" is denied:
// an absolute cd makes the cwd known again, a relative one keeps it lost.
test('#4446: a substitution body after the cwd cap is walked from the lost cwd', () => {
  const groups = '{ cd s1; }; { cd s2; }; { cd s3; }; { cd s4; }; { cd s5; }; ';
  const opts = { overflowCwd: '/main' };
  assert.ok(fileWriteTargets(`${groups}x="$( cd /main; cp a f )"`, '/r', opts).some((t) => t.file === path.resolve('/main/f') && !t.lost));
  assert.ok(fileWriteTargets(`${groups}x="$( cd ../main; cp a f )"`, '/r', opts).some((t) => t.lost));
});
```

- [ ] **Step 2: Run the new tests and the four suites**

Run: the scratch runner with `tests/hooks-gate-coverage.test.js`.
Expected: FAIL — the new `#4446:` rows fail (`echo $(cp a /main/f.js)` resolves `[]`); every pre-existing test passes.

- [ ] **Step 3: Implement**

a. Beside `let nestBudget = null;` add:

```js
// #4446: set while substitutionBodies scans a piece of the walk's text, which stripHeredocBodies has
// already planned: a body it planned is gone from that text, so a `<<` opener there is read as plain text.
let nestNoHeredoc = false;
```

and in `scanCommandSubstitution` change the heredoc condition to `if (c === '<' && str[i + 1] === '<' && !arith && !nestNoHeredoc) {`.

b. After `closesDoubled`, add `BODY_BLANK`, `SUB_BODY_DEPTH_CAP` and `substitutionBodies` exactly as below (the algorithm is the decision; keep the doc comment):

```js
// #4446: the substitution bodies one piece of the walk holds whole, for walkShellChunk to walk each as
// a command list of its own. A body is a `$( … )` (a `$((` that is no arithmetic included), a
// backtick span or an unquoted `<( … )`/`>( … )`, found outside single quotes; one inside double
// quotes or a `${ … }` counts, as bash runs it there, and so does one inside arithmetic. An opener
// whose closer is not in the piece ends the scan: the segment was cut inside it. Returns null when the
// piece holds no body, or when a nested scan was capped (NEST_LEVEL_CAP or the step budget), so a nest
// the scan cannot follow keeps the reading it had before #4446. Otherwise { bodies, text }: each body's
// text (a backtick's with bash's backtick unescaping applied: `\\`, `` \` `` and `\$` lose their
// backslash) and the piece's text with each body blanked to BODY_BLANK characters of the same length,
// so the piece's own command no longer reads the body's words as its own (`x=$( (( a>1 )) )`).
const BODY_BLANK = '_';
// How many substitution levels the walk descends into: each level walks its bodies again, so a nest
// deeper than this keeps its text in the piece, the reading before #4446 (a cost cap, as MAX_HEREDOC_NESTING).
const SUB_BODY_DEPTH_CAP = 8;
function substitutionBodies(text) {
  if (!/[$`<>]/.test(text)) return null;
  const bodies = [];
  const blank = [];
  const outerBudget = nestBudget;
  nestBudget = { left: NEST_STEPS_PER_CHAR * text.length + NEST_STEPS_FLOOR };
  nestNoHeredoc = true;
  try {
    let dq = false;
    for (let i = 0; i < text.length; i += 1) {
      const c = text[i];
      if (c === '\\') { i += 1; continue; }
      if (dq) {
        if (c === '"') { dq = false; continue; }
      } else if (c === '"') { dq = true; continue; }
      else if (c === "'" || (c === '$' && text[i + 1] === "'")) {
        const r = skipSingleQuoted(text, c === '$' ? i + 2 : i + 1, c === '$');
        if (r.capped) return null;
        i = r.end - 1;
        continue;
      }
      let open = -1;
      if (c === '`') open = i + 1;
      else if (c === '$' && text[i + 1] === '(') {
        // A `$((` whose inner `(` closes at a `)` directly followed by `)` is arithmetic (groupEvents' test),
        // read here with the substitution scanner, so it holds inside double quotes too: the scan goes on
        // inside it, since an opener there runs.
        if (text[i + 2] === '(') {
          const inner = skipCommandSubstitution(text, i + 3);
          if (inner.capped) return null;
          if (inner.closed && text[inner.end] === ')') { i += 2; continue; }
        }
        open = i + 2;
      } else if (!dq && (c === '<' || c === '>') && text[i + 1] === '(' && !(i > 0 && /[<>&|]/.test(text[i - 1]))) open = i + 2;
      if (open === -1) continue;
      const r = c === '`' ? skipBacktick(text, open) : skipCommandSubstitution(text, open);
      if (r.capped) return null;
      if (!r.closed) break;
      const body = text.slice(open, r.end - 1);
      bodies.push(c === '`' ? body.replace(/\\([\\`$])/g, '$1') : body);
      blank.push([open, r.end - 1]);
      i = r.end - 1;
    }
  } finally {
    nestBudget = outerBudget;
    nestNoHeredoc = false;
  }
  if (!blank.length) return null;
  let out = '';
  let at = 0;
  for (const [from, to] of blank) {
    out += text.slice(at, from) + BODY_BLANK.repeat(to - from);
    at = to;
  }
  return { bodies, text: out + text.slice(at) };
}
```

c. `walkShellChunk` gains `subDepth = 0` as its last parameter; both `runBodies` calls pass `subDepth` through unchanged. Replace `visitPiece` with:

```js
  const visitPiece = (ev, pieceCwds, pieceVars) => {
    const text = walkSubstitutionBodies(ev.text, pieceCwds, pieceVars);
    if (!ev.tail) return visitUnderEach(text, pieceCwds, pieceVars, handler, nest, pathImpl);
    const next = visitUnderEach(text, pieceCwds, new Map(pieceVars), handler, nest, pathImpl);
    return joinCwds(pieceCwds, next, overflow);
  };
  // #4446: each substitution body the piece holds whole runs before the piece's own command, in a
  // subshell from the cwds the piece starts at, so it is walked as its own chunk there and what it
  // changes is dropped; the piece is then visited with those bodies blanked.
  const walkSubstitutionBodies = (text, pieceCwds, pieceVars) => {
    const found = subDepth < SUB_BODY_DEPTH_CAP ? substitutionBodies(text) : null;
    if (found === null) return text;
    for (const body of found.bodies) {
      walkShellChunk(body, pieceCwds, new Map(pieceVars), handler, depth, true, overflow, baseLike, pathImpl, subDepth + 1);
    }
    return found.text;
  };
```

- [ ] **Step 4: Run the four suites and the perf suite**

Expected: PASS, every test.

- [ ] **Step 5: Commit** `git-command.js` and the test file: `Walk each substitution body a piece holds whole — refs #4446`.

---

### Task 2: Walk the first command of a substitution the segment cuts

**Role:** judgment
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/hooks/git-command.js` (`groupEventsWith`: its `cut`, the `)` pop for a `p` frame, the `<(`/`>(` branch, the `subst` push, the final push; `substitutionBodies`' unclosed branch)
- Modify: `tests/hooks-gate-coverage.test.js:742-758` (the `#4303: … still reads the write inside the arithmetic's substitution` rows: comment and the last row's expected `path.resolve('/r/f.js')` becomes `MAIN_F`; bash 3.2 and 5 write /main/f.js)
- Test: `tests/hooks-gate-coverage.test.js` (new block after Task 1's)

**Interfaces:**
- Consumes: Task 1's `substitutionBodies`.
- Produces: `groupEventsWith` events `{ text, sub: true, tail: false, nesting, esac: 0 }` for each opener the piece opened and left open ("rests"), pushed right after the piece, outermost first, before the cut's own event.

- [ ] **Step 1: Write the failing tests**

```js
// #4446: a separator inside a substitution cuts the segment there, so the substitution's first command sits
// at the end of the piece that opens it; it is walked inside the substitution. Bash 3.2 and 5 (zsh too)
// write each listed file: `$(cd /main) $(cp a f; true)` scopes the first cd to its own substitution, and
// `$(cd /main & true; cp a f)` backgrounds the cd.
for (const [command, expected] of [
  ['x=$(cd /wt\necho y > g)', [path.resolve('/wt/g')]],
  ['x=$(cd /wt && echo y > g)', [path.resolve('/wt/g')]],
  ['x=$(cd /wt; echo y > g)', [path.resolve('/wt/g')]],
  ['echo $(cd /main; cp a f.js)', [MAIN_F]],
  ['x=$( (( a>1 )); true)', []],
  ['x=$((( a>1 )); true)', []],
  ['cd /main | true; x=$(cd /main && cp a f.js | true)', [MAIN_F]],
  ['echo $(cd /main) $(cp a f; true)', [path.resolve('/r/f')]],
  ['x=$(cd /main & true; cp a f)', [path.resolve('/r/f')]],
  ['y=$(x=$(cd /main; cp a f); echo $x > g)', [path.resolve('/main/f'), path.resolve('/r/g')]],
  ['x=$(echo $(cd /main; cp a f))', [path.resolve('/main/f')]],
  ['x=$(cd /main; echo $(cp a f))', [path.resolve('/main/f')]],
  ['x=$(cd /main; echo "$(cp a f)")', [path.resolve('/main/f')]],
  ['diff <(cd /main && cp a f.js) a', [MAIN_F]],
  ['x=$(echo y > /main/f; true)', [path.resolve('/main/f')]],
  ['echo $(cd /main && echo x > f.js) > g', [MAIN_F, path.resolve('/r/g')]],
]) {
  test(`#4446: \`${command}\` walks the first command of a substitution the segment cuts`, () => {
    assert.deepStrictEqual(files4446(command), expected);
  });
}
// #4446: each rest holds only its own level's text, so a run of 2,000 unclosed openers stays linear.
test('#4446: each level of a run of unclosed substitutions hands the walk only its own text', () => {
  const total = boundedRun((gc, { command }) => {
    let chars = 0;
    gc.forEachShellSegment(command, '/r', (t) => { chars += t.join('').length; });
    return chars;
  }, { command: 'echo ' + '$(true '.repeat(2000) + '; cp a f' + ')'.repeat(2000) });
  assert.ok(total < 100000, `${total} characters reached the handler`);
});
```

- [ ] **Step 2: Run** — Expected: FAIL (`x=$(cd /wt && echo y > g)` resolves `/r/g`), and the updated #4303 row fails.

- [ ] **Step 3: Implement** in `groupEventsWith`:

```js
  // #4446: the substitution openers (`$(`, `<(`, `>(`) still open in this segment, each with `at`, the
  // index just past it, and `level`, its nesting. A piece cut while one it opened is still open holds
  // that substitution's first command after the opener (`x=$(cd ../wt && …`, cut at the `&&`): it is
  // handed to the walk as a piece of its own, inside the substitution, right after the piece, outermost
  // first, so the substitution's own list starts with it.
  const openers = [];
  const rests = (at) => {
    for (let k = 0; k < openers.length; k += 1) {
      const o = openers[k];
      if (o.at <= start) continue;
      // Each level's command runs through the next opener still open (kept, so a word it starts still
      // reads as a substitution: `y=$(x=$(cd …` assigns no literal to x); the text after that opener is
      // the deeper level's own, so a long run of unclosed openers costs linear text, not one copy of
      // the tail per level.
      const text = seg.slice(o.at, k + 1 < openers.length ? openers[k + 1].at : at);
      events.push({ text, sub: true, tail: false, nesting: o.level, esac: 0 });
    }
  };
```

`cut` calls `rests(at)` between pushing the piece and pushing `ev`; the final push is followed by `rests(seg.length)`. Push `{ frame: top(), at: <index past the opener>, level: g.nesting }` after `nest(1, true)` in the `<(`/`>(` branch (at `j + 1`) and for `subst === 1` (at `i + 2`, before `i` advances). In the `)` branch for a `p` frame, right after `pop()`: `if (openers.length && openers[openers.length - 1].frame === t) openers.pop();`.

In `substitutionBodies`, the unclosed branch becomes (the dq guard keeps `"$(cat <<'EOF' … EOF)" > out.js`'s `> out.js` visible — the existing `#4210 review: a heredoc body inside "$( … )"` test — and the capped-pass one beside it):

```js
      if (!r.closed) {
        // Unquoted, the segment was cut inside it and groupEvents walks the rest; inside double quotes
        // (a heredoc body planned out of a "$( … )", or a capped pass cutting inside the quotes) no
        // rest is walked, so the text stays visible.
        if (c !== '`' && !dq) blank.push([open, text.length]);
        break;
      }
```

- [ ] **Step 4: Run the four suites and the perf suite** — Expected: PASS.

- [ ] **Step 5: Commit**: `Walk the first command of a substitution the segment cuts — refs #4446`.

---

### Task 3: Walk a backtick span that holds a separator

**Role:** judgment
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/hooks/git-command.js` (`segmentSpansWith`' `cut` and backtick branch; `groupEvents`/`groupEventsWith` signature, `atCmd` init, the lone-`&` cut, the backtick word scan; `walkShellChunk`'s span loop; `substitutionBodies`' unclosed branch)
- Modify: `tests/hooks-gate-coverage.test.js:780-785` (`#4303: arithmetic holding a backtick keeps the target its cut resolved`: assert `deepStrictEqual(…, [{ action: 'copy', file: MAIN_F }])`, comment updated; bash 3.2 and 5 write /main/f.js)
- Test: `tests/hooks-gate-coverage.test.js` (new block after Task 2's)

**Interfaces:**
- Consumes: Task 2's `openers`/`rests`.
- Produces: `segmentSpans` entries gain an optional `btClose` (index in `text` of the closing backtick of the span the segment began inside, present only when that backtick held a separator); `groupEvents(seg, g, afterBacktick = false)`.

- [ ] **Step 1: Write the failing tests**

```js
// #4446: a backtick that holds a separator is cut there; its last command is walked inside it and the text
// after its closer is the outer command's tail. Bash 3.2 and 5 write each listed file; zsh writes nothing for
// `x=\`…\` & cp`, main/f for the `cd /main && … &` row and main/g for the `case` row (#4455: the rows side
// with bash). `cd /main \`true\``: a backtick with no separator stays part of its command.
for (const [command, expected] of [
  ['echo `true; cp a /main/f.js`', [MAIN_F]],
  ['echo `true; true` & cp a /main/f.js', [MAIN_F]],
  ['echo `true; true`& cp a /main/f.js', [MAIN_F]],
  ['x=`true; true` & cp a /main/f.js', [MAIN_F]],
  ['echo `true; cp a b` & cp a /main/f.js', [path.resolve('/r/b'), MAIN_F]],
  ['cd /main && echo `true; true`& cp a f', [path.resolve('/r/f')]],
  ['echo `true; true` case x in | cd /main; echo y > g', [path.resolve('/r/g')]],
  ['echo `cd /main; echo x > f.js`', [MAIN_F]],
  ['echo `cd /main && echo x > f.js` > g', [MAIN_F, path.resolve('/r/g')]],
  ['cd /main `true`; echo y > g', [path.resolve('/main/g')]],
  ['echo `(( a>1 )); true`', []],
  ['echo $(true; echo `cd /main; cp a f`; cp a g)', [path.resolve('/main/f'), path.resolve('/r/g')]],
]) {
  test(`#4446: \`${command}\` walks the backtick that holds a separator`, () => {
    assert.deepStrictEqual(files4446(command), expected);
  });
}
// #4446: bash 3.2 and 5 write only r/g (echo prints `cd /main`); the tail's words may be a cd, so the walk
// goes on under both cwds.
test('#4446: the rest of a command after a backtick holding a separator is its tail (deliberate fail-closed tradeoff)', () => {
  assert.deepStrictEqual(files4446('echo `true; true` cd /main; echo y > g'), [path.resolve('/r/g'), path.resolve('/main/g')]);
});
```

- [ ] **Step 2: Run** — Expected: FAIL (`echo \`true; cp a /main/f.js\`` resolves `[]`).

- [ ] **Step 3: Implement**

a. `segmentSpansWith`: a `let btClose = -1;` reset by `cut`, which pushes `btClose` on the segment only when it is not -1; in the backtick branch, after the inner loop and before `current += '`'`, `if (inner.length > 1) btClose = current.length;`.

b. `groupEvents(seg, g, afterBacktick = false)` passes it to `groupEventsWith(seg, g, spans, undo, afterBacktick)`: `let atCmd = !afterBacktick;`, and the lone-`&` cut becomes `cut(i, i > 0 || afterBacktick ? { bg: … } : null)` (doc comment: the rest after a backtick's closer starts at an argument, and an `&` there is a lone `&`, never `|&`'s). In the backtick/`$'` word scan, after the closing-quote loop: `if (ch === '`' && j >= seg.length) openers.push({ frame: null, at: i + 1, level: g.nesting + 1 });` (a backtick the segment never closes was cut inside by a separator; its text is the backtick's first command, one level deeper).

c. `walkShellChunk`: walk each span as its parts —

```js
  // #4446: a segment that holds the closing backtick of a span it began inside (segmentSpans' btClose)
  // is walked in two parts: the backtick's last command, inside it, then the rest of the outer
  // command after the closer, whose first piece is that command's tail.
  const spanParts = (span) => (span.btClose === undefined ? [{ text: span.text, sub: span.sub, closed: false }]
    : [{ text: span.text.slice(0, span.btClose), sub: true, closed: false }, { text: span.text.slice(span.btClose + 1), sub: false, closed: true }]);
```

The span loop's `inBacktick` and event loop move inside `for (const part of spanParts(span))`, call `groupEvents(part.text, g, part.closed)`, read `part.sub` where they read `span.sub`, and mark the part's first event `tail = true` when `part.closed` and it is a text piece. `runBodies`, the separator handling and `btCase` stay per span.

d. `substitutionBodies`' unclosed branch blanks backticks too: `if (!dq) blank.push([open, text.length]);`.

- [ ] **Step 4: Run the four suites and the perf suite** — Expected: PASS.

- [ ] **Step 5: Commit**: `Walk a backtick span that holds a separator — refs #4446`.

---

### Task 4: End-to-end deny, prefilter corpus and coverage prose

**Role:** integration

**Files:**
- Test: `tests/hooks-gate-coverage.test.js` (new e2e test after `AC1.1 e2e #4303` ~line 2999, reusing `linkedWorktree4303`)
- Modify: `tests/hooks-bash-prefilter.test.js:27-50` (`DIFFERENTIAL_CORPUS`)
- Modify: `plugin/skills/_shared/policy-schema-coverage.md` (line 30's "Known gaps" list and the substitution sentence before it; 36,737 B now, rail 52,500 B: ~15.7 KB headroom)
- Modify: `plugin/bin/lib/hooks/git-command.js` (`walkShellChunk`'s header comment ~lines 2338-2348: one sentence on bodies)

- [ ] **Step 1: Write the e2e test** (skip on win32 exactly as `AC1.1 e2e #4303` does, same reason):

```js
// #4446: every record shape, run from a linked worktree with the main checkout's absolute path in it. Bash 3.2
// and 5, started in the worktree, write into the main checkout for each; `x=$(cd ${wt}; cp a f.js)` writes wt/f.js.
test('e2e #4446: a write into the main checkout from inside a substitution or backtick is DENIED', {
  skip: process.platform === 'win32' && 'win32: the commands splice a native temp path, whose backslashes the scanner reads as escapes',
}, () => {
  const { main, wt, decisionFor } = linkedWorktree4303();
  const groups = Array.from({ length: 5 }, (_, i) => `{ cd s${i}; }; `).join('');
  for (const command of [
    `echo $(cp a ${main}/f.js)`, `echo \`cp a ${main}/f.js\``, `echo \`true; true\` & cp a ${main}/f.js`,
    `echo $(( $(cd ${main}; cp a f.js) + 1 ))`, `echo "$(echo x > ${main}/f.js)"`, `X="$(cp a ${main}/f.js)"`,
    `x=$(cd ${main} && echo y > g)`, `x=$(git -C ${main} commit -m y)`, `${groups}x="$( cd ${main}; cp a f )"`,
  ]) assert.strictEqual(decisionFor(command), 'deny', command);
  assert.notStrictEqual(decisionFor(`x=$(cd ${wt}; cp a f.js)`), 'deny');
});
```

Add to `DIFFERENTIAL_CORPUS`, with the comment `// #4446: a write inside a substitution body, quoted or cut by a separator.`: `'echo "$(echo x > tracked.js)"'`, ``'echo `true; echo x > tracked.js`'``, `'x=$(cd sub && echo x > tracked.js)'`.

- [ ] **Step 2: Run** the two suites — Expected: PASS for the corpus lines (prefilter must run full for each); the e2e passes on Tasks 1-3's code.

- [ ] **Step 3: Prose.** In `policy-schema-coverage.md` line 30, after "so a `cd` inside a deeper `$( )` never reaches the commands after it." add: "Every command substitution and process substitution — a `$( … )` (a `$((` that is no arithmetic), a backtick span, `<( … )` or `>( … )`, inside double quotes, a `${ … }` or arithmetic too — is walked as a command list of its own from the cwd the command holding it starts at, its first command included, and a backtick that holds a separator ends at its closer, so the rest of the command (after a lone `&` too) is read as the outer command's (#4446); a nest deeper than eight substitutions keeps its text in the command around it, read as before." Delete from the Known gaps list: "the first command of a `$( )`, backtick or `<( )`; a backtick that holds a separator (its last command, and the rest of the segment after a lone `&` that follows it); ". Behavior-change sweep: `git grep -n -i -e 'first command of a' -e 'backtick that holds a separator' -e 'substitution-body' -- plugin docs tests` — every hit outside `docs/incident-log.md`, `docs/decisions/`, `CHANGELOG.md` and `docs/plans/` is rewritten or listed as no-change in the commit message.

- [ ] **Step 4: Run the four suites** — Expected: PASS.

- [ ] **Step 5: Commit**: `Pin the substitution walk end to end and in the coverage prose — refs #4446`.

---

### Task 5: Verification evidence (base comparison, mutants, fuzz, timing)

**Role:** judgment

**Files:**
- No committed file unless a surviving mutant needs a new pin (then `tests/hooks-gate-coverage.test.js`, under the mutated rule's task block).
- Evidence: `$PIPELINE_RUN_DIR/evidence/` (`mkdir -p` first; plain Bash redirect, never the Write tool), `PIPELINE_RUN_DIR=/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/2026-10-28T190057-record-4446`.

Scripts (scratch, never committed) in `/private/tmp/claude-501/-Users-thomasholknielsen-Code-Workspaces-claude-tweaks/6632f468-fb30-4491-bfde-ec591460a9c3/scratchpad/4446/`: `record-corpus.js` (records every scanner call the suites make), `compare.js <base git-command.js> <head git-command.js> <corpus.jsonl>`, `fuzz.js <base> <head> <count> <seed>` (bash 3.2 and 5, bounded oracle), `perf-probe.js <repo-root>` (times shapes through `hooks.js pre-tool-use`), `run-suites.js`. A detached base worktree at fae7a76ba is at `…/scratchpad/4446/base` with `corpus.jsonl` recorded from it.

- [ ] **Step 1: AC2.1 base comparison.** `node compare.js base/…/git-command.js <worktree>/…/git-command.js corpus.jsonl > $PIPELINE_RUN_DIR/evidence/base-comparison.txt`. Expected: every `+` (allowed→denied) row is a listed shape (#4303 arithmetic row, the arithmetic backtick row, a backtick-with-separator body, `tee >(…)`'s spurious target now spelled `>(____)`, a syntax-error command's spurious `y`); every `-` is a spurious target bash never writes. Record each row's classification.
- [ ] **Step 2: AC3.1 mutants.** In a scratch `git worktree add --detach` of HEAD, delete or invert each rule one at a time and run the four suites: `substitutionBodies`' call in `visitPiece`; the blank of complete bodies; the unclosed blank; its `!dq` guard; its backtick exclusion (Task 2 state) / inclusion; `nestNoHeredoc`; `SUB_BODY_DEPTH_CAP` (set to 9); the `r.capped` returns; the arithmetic skip; the `<(` prev-character rule; the `!dq` on `<(`; the single-quote and `$'` skip; the backslash skip; the backtick unescape; `new Map(pieceVars)` (pass `pieceVars`); bodies walked from `pieceCwds` (walk after the visit, from its result); `rests`; the slice to the next opener (slice to `at`); `o.at <= start`; the opener pop; `btClose` only when `inner.length > 1`; `spanParts`; `afterBacktick`'s `atCmd`; its lone `&`; the tail flag; the unclosed-backtick opener push. Expected: each mutant turns at least one test red; a survivor gets a discriminating test (with its bash verdict) or the rule is removed as dead. Write `mutant | killed-by test name | suites summary` lines to `$PIPELINE_RUN_DIR/evidence/mutants.txt`.
- [ ] **Step 3: Fuzz.** `node fuzz.js base/… <worktree>/… 400 99` and seed `123457` → `$PIPELINE_RUN_DIR/evidence/fuzz.txt`. Expected: `head` 0, `regress` 0; each `newSpurious` row explained (a command bash rejects).
- [ ] **Step 4: Timing.** `node perf-probe.js base` and `node perf-probe.js <worktree>` → `$PIPELINE_RUN_DIR/evidence/perf.txt`. Expected: no shape over 3x base through the hook, none over 1.5 s.
- [ ] **Step 5: Log** one `AC evidence` entry per artifact: `node "/Users/thomasholknielsen/.claude/plugins/cache/claude-tweaks-marketplace/claude-tweaks/6.156.1/bin/log-decision.js" --run "$PIPELINE_RUN_DIR" --section "/build" --status AUTO --step "AC evidence" --text-file "{tmp}"`, the text naming the AC id, the command shape, the counts, and the evidence path. Commit only a new pin, if any: `Pin {rule} against its mutant — refs #4446`.

---

## Spec coverage

| Spec item | Task |
|---|---|
| Deliverable 1 (walk bodies, own cd scope) | 1, 2, 3 |
| Deliverable 2 (write, mkdir, git targets) | 1 (git/mkdir rows), 2, 3 |
| Deliverable 3 (pin every shape, bash verdict comments) | 1-4 |
| AC1.1 each shape denied from a worktree | 4 (e2e), 1-3 (unit) |
| AC2.1 base comparison | 5 Step 1 |
| AC3.1 every rule has a mutant | 5 Step 2 |
| AC4.1 four suites + perf pass | Steps 4 of 1-4 |
