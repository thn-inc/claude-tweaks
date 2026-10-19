# Regex-Aware Comment Stripper Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single-regex `stripComments` in `tests/helpers/strip-comments.js` with a dependency-free scanner that models regex literals, so comment text after a quote-bearing regex is blanked instead of read as code by the four source-scan conformance tests.

**Architecture:** One left-to-right pass over the source with a previous-significant-token heuristic for regex-versus-division; strings, templates (recursing into `${…}`) and regex literals are copied verbatim, comments are blanked to spaces in an output character array. `stripperVerdict` stays unchanged as the backstop for the compile-breaking direction. The consumers' "mis-parse is reported" fixtures move to the scanner's documented residual ambiguity (a regex right after `)` or `}`), which mis-parses under both the old and the new stripper, so the suite stays green between tasks.

**Tech Stack:** Node 18+, CommonJS, `node:test`, `node:assert/strict`, `node:vm` (already used by `compiles`).

**Spec:** `.claude-tweaks/pipelines/2026-10-19T170937-spec-3541-3543-3585/spec-3585/work/3585-spec.md` (record #3585)

Scope keywords: strip-comments, stripComments, stripperVerdict

## Global Constraints

- `tests/helpers/strip-comments.js` requires nothing beyond `node:` built-ins (AC4.1). `acorn` is never a dependency, not even a devDependency.
- Exported surface unchanged: `stripComments`, `stripperVerdict`, `STRIPPER_VERDICT_MESSAGES`. `compiles` and `stripperVerdict` bodies unchanged.
- Blanking contract unchanged: every non-newline character of a comment becomes a space; output length equals input length; every `\n` stays at its index.
- A leading hashbang line (`#!` at offset 0) is kept verbatim.
- Strings stop at an unescaped matching quote or at a newline (same as today).
- A real scan finding uncovered by the swap is fixed or allow-listed with a reason by that scan's own convention — never by weakening the stripper.
- Commit subjects: `{Verb} {what} — {detail}`, ending `refs #3585` (never `closes`/`fixes`).

## Review Focus

1. A keyword used as a property name (`a.return / 2`, `x.in / 2`) — a `.` before the identifier means it is a property, not a keyword, so the `/` is division. Pinned in Task 2's division test.
2. A `}` that closes an object literal or a `${…}` inside a template, followed by `/` — read as division by design (documented ambiguity); the template's own closing `}` must return control to the template scanner, not count as code. Pinned by Task 2's nested-template test.
3. Unterminated constructs at end of file (an open `/*`, an open template, an open regex) — must never throw or loop; a `/*` with no `*/` blanks to end of input. Pinned in Task 2's edge test.
4. Non-ASCII identifiers and `$`/`_` in names before a `/` (`ü / 2`, `$x / 2`) — identifier characters, so division. Pinned in Task 2's division test.
5. Performance on the real corpus — the full `plugin/bin` walk in the new tests must stay well under a second (spike: 134 ms for `plugin/bin`).

## Plan-time evidence (scratch prototype, not committed)

A throwaway port of the spec's Technical Approach was run against this worktree before authoring:
- `plugin/bin`: 420 files, the prototype's output differs from the current stripper's in exactly **23** files (the measurement's list), output length mismatches **0**, `stripperVerdict(raw, newStripped) !== 'ok'` for **0** files. `tests/`: 847 files, 41 differ, 0 not-ok.
- Whole-line `//` comments (raw line matching `/^\s*\/\/\s*\S/`) whose stripped line is not blank: current stripper — **23** `plugin/bin` files (candidates-dead-code.js 115 lines, grouping.js 68, impeccable-engine/index.js 39); prototype — **0** files.
- With the prototype swapped into the helper, the four scans' corpus tests all pass (no new or vanished real finding); exactly five fixture tests go red, all of them "a mis-parse is reported" fixtures built on shapes the new scanner no longer mis-parses: `tests/helpers-strip-comments.test.js` "stripperVerdict reports each reproducing mis-parse shape as misparsed", `tests/windows-hide-spawn-conformance.test.js` "a comment-stripper mis-parse is reported, not passed as a file with no calls", `tests/git-status-optional-locks.test.js` "a comment-stripper mis-parse is reported, not passed as a file with no status calls", `tests/path-guard-conformance.test.js` "a comment-stripper mis-parse is reported, not counted as zero tokens", `tests/bin-lib/exit-code-conformance.test.js` "a guard the stripper blanks is reported, not skipped as a guard-less library". Task 1 re-points them.
- Every residual fixture below returns `misparsed` under **both** the current stripper and the prototype.

---

### Task 1: Re-point the mis-parse fixtures to the residual `)`/`}` ambiguity

The backstop tests must keep proving that a mis-parse is reported. Their current fixtures rely on shapes Task 2 stops mis-parsing; the new fixtures put the regex right after `)` or `}`, which the heuristic reads as division (documented ambiguity), so they mis-parse under the old and the new stripper alike.

**Files:**
- Modify: `tests/helpers-strip-comments.test.js` (test "stripperVerdict reports each reproducing mis-parse shape as misparsed", lines 72-82)
- Modify: `tests/windows-hide-spawn-conformance.test.js` (test at line 133)
- Modify: `tests/git-status-optional-locks.test.js` (test at line 117)
- Modify: `tests/path-guard-conformance.test.js` (test at line 197)
- Modify: `tests/bin-lib/exit-code-conformance.test.js` (test at lines 113-121 and its comment)

**Interfaces:**
- Consumes: `stripComments(src: string): string`, `stripperVerdict(raw: string, stripped?: string): 'ok'|'misparsed'|'unparseable'` — unchanged.
- Produces: nothing new.

- [ ] **Step 1: Swap each fixture**

Exact replacements (expected values and assertion shapes stay as they are):

| File / test | Old fixture | New fixture |
|---|---|---|
| helpers test, rename to `'stripperVerdict reports each residual mis-parse shape (a regex after ) or }) as misparsed'` | the five inputs on lines 73-80 | `"const x = 'a'; if (x) /'/.test(x); const b = 'p//q'; fs.realpathSync(b);"`, `'if (a) /"/.test(a); const b = "//"; live();'`, ``'function f() {} /`/.test(s); const b = `x // y`; live();'``, `'if (x) /[/*]/.test(x); live(); /* c */'`, and the lazily compiled one `'function outer() { function inner() { if (x) /[/*]/.test(x); live(); } return inner; } /* c */'` |
| windows-hide line 136 | `"const x = 'a'; const a = /'/.test(x); const b = 'p//q'; cp.execFileSync('git', [b], {});"` | `"if (cp) /'/.test(cp); const b = 'p//q'; cp.execFileSync('git', [b], {});"` |
| git-status line 118 | `"const re = /[/*]/; runGit(['status']); /* c */"` | `"if (x) /[/*]/.test(x); runGit(['status']); /* c */"` |
| path-guard line 198 | `'const a = /"/; const b = "//"; fs.existsSync(b);'` | `'if (b) /"/.test(b); const c = "//"; fs.existsSync(c);'` |
| exit-code line 117 (`blanked`) | `'const re = /[/*]/;'` | `'if (x) /[/*]/.test(x);'` |

Rewrite the exit-code test's inner comment (lines 114-116) to: the regex sits right after `)`, which the stripper reads as division (its documented ambiguity), so the `/*` in the class opens a comment that runs to the trailing `*/` and blanks the guard; the `module.exports` line would then make `guardRegionFor` read the file as a pure library and skip it.

- [ ] **Step 2: Run the five files on the current stripper**

Run: `node --test tests/helpers-strip-comments.test.js tests/windows-hide-spawn-conformance.test.js tests/git-status-optional-locks.test.js tests/path-guard-conformance.test.js tests/bin-lib/exit-code-conformance.test.js`
Expected: PASS (`# fail 0`) — the residual shapes mis-parse under the current stripper too.

- [ ] **Step 3: Commit**

```bash
git add tests/helpers-strip-comments.test.js tests/windows-hide-spawn-conformance.test.js tests/git-status-optional-locks.test.js tests/path-guard-conformance.test.js tests/bin-lib/exit-code-conformance.test.js
git commit -m "Re-point stripper mis-parse fixtures to the regex-after-) ambiguity — backstop tests survive the regex-aware scanner, refs #3585"
```

---

### Task 2: Regex-aware scanner, its regression tests, and the prose that described the old gap

**Files:**
- Modify: `tests/helpers/strip-comments.js` (lines 3-23: header comment and `stripComments`)
- Test: `tests/helpers-strip-comments.test.js` (append)
- Modify: `tests/path-guard-conformance.test.js:41-50` (comment block only)
- Modify: `tests/bin-lib/exit-code-conformance.test.js:99-102` (comment only)
- Modify: `docs/journeys/act-on-a-red-path-guard-lint-3417.md:31` (the `mis-parsed this file` bullet)

**Interfaces:**
- Consumes: Task 1's fixtures (unchanged by this task).
- Produces: `stripComments(src: string): string` — same signature, same export list.

- [ ] **Step 1: Append the failing tests to `tests/helpers-strip-comments.test.js`**

Each `assert.equal(stripComments(input), expected)` below uses these exact strings (values confirmed against the plan-time prototype):

```js
test('AC1.1/AC1.2: a quote or backtick inside a regex no longer swallows the comment after it', () => {
  assert.equal(
    stripComments("const r = /['\"`]/; // it's gone\nlive(); // a `tick` too"),
    "const r = /['\"`]/;             \nlive();                ",
  );
});
test('AC1.1: // and /* inside a regex character class are kept verbatim', () => {
  const src = 'const r = /[//]/, s = /[/*]/; live();';
  assert.equal(stripComments(src), src);
});
test('AC1.1: division never opens a regex', () => {
  assert.equal(stripComments('a / b // c'), 'a / b     ');
  assert.equal(stripComments('f(x) / 2; live(); // gone'), 'f(x) / 2; live();        ');
  // Review Focus 1 and 4: a keyword as a property name, and non-ASCII / $ identifiers.
  assert.equal(stripComments("a.return / 2; x.in / 3; ü / 4; $x / 5; // it's gone"), "a.return / 2; x.in / 3; ü / 4; $x / 5;             ");
});
test('AC1.1: return and typeof introduce a regex', () => {
  assert.equal(stripComments("function f() { return /'/.test(s); } // it's gone"), "function f() { return /'/.test(s); }             ");
  assert.equal(stripComments("const t = typeof /'/; // it's gone"), "const t = typeof /'/;             ");
});
test("AC1.1: a template's nested ${} code is scanned, and its closing } returns to the template", () => {
  assert.equal(stripComments("const t = `a${ '/' + \"`\" }b`; // it's gone"), "const t = `a${ '/' + \"`\" }b`;             ");
});
test('AC1.1: an escaped slash does not end a regex', () => {
  assert.equal(stripComments("const r = /a\\/b'/; // it's gone"), "const r = /a\\/b'/;             ");
});
test('the hashbang line is kept and unterminated constructs at EOF do not throw', () => {
  assert.equal(stripComments('#!/usr/bin/env node\n// x\nlive();'), '#!/usr/bin/env node\n    \nlive();');
  assert.equal(stripComments('live(); /* open'), 'live();        ');
  for (const src of ['const t = `open ${ a', 'const r = /open', "const s = 'open"]) {
    assert.equal(stripComments(src).length, src.length);
  }
});
```

Then the corpus tests (walk `plugin/bin` recursively for `.js`/`.cjs` with `node:fs`/`node:path`, as the consumer scans do):

- `'AC2.2: no whole-line // comment of the three measured files survives stripping'` — for `plugin/bin/lib/code-health/candidates-dead-code.js`, `plugin/bin/lib/issues/grouping.js`, `plugin/bin/lib/impeccable-engine/index.js`: for every raw line matching `/^\s*\/\/\s*\S/`, the stripped line at the same index is whitespace-only; collect offenders as `{file}:{line}` and `assert.deepEqual(offenders, [])`. Also assert each file has at least one such line (the check is not vacuous).
- `'AC2.1: no whole-line // comment survives stripping in any plugin/bin file'` — the same check over every `plugin/bin` `.js`/`.cjs` file (the 23 measured files are the ones the old stripper failed on; prototype: 0 offenders).
- `'AC3.1: stripperVerdict is ok for every plugin/bin file'` — collect `{file}: {verdict}` for every non-`ok` and `assert.deepEqual(bad, [])`.
- `'AC4.1: the helper requires only node: built-ins'` — read `tests/helpers/strip-comments.js` as text, collect every `require('…')` argument, assert each starts with `node:`.

Waived as a separate test: AC5.1 and AC6.1 — they are suite runs, verified in Step 4.

- [ ] **Step 2: Run them to verify they fail on the current stripper**

Run: `node --test tests/helpers-strip-comments.test.js`
Expected: FAIL — at least the AC1.2 quote case, the character-class case, the return/typeof case, the escaped-slash case, AC2.1 and AC2.2 fail (the current stripper keeps `// it` and opens a comment at `[//`). AC3.1 and AC4.1 already pass (append-shaped, not a finding).

- [ ] **Step 3: Implement `stripComments(src: string): string` in `tests/helpers/strip-comments.js`**

Port the spec's Technical Approach:
- `out = src.split('')`; a `blank(start, end)` that sets every non-`\n` index in range to `' '`. If `src` starts with `#!`, start scanning after that line.
- `scanCode(inBrace: boolean)`: loop tracking `prev` — `null` at start, else `{ kind: 'punct'|'word'|'literal', value }`. In order: `//` → blank to newline; `/*` → blank through `*/` (to end of input when absent); `'`/`"` → string (backslash escapes, stops at the matching quote or a newline) → `prev = literal`; `` ` `` → `scanTemplate()` → `prev = literal`; `/` → regex when `prev === null`, or `prev` is a punctuator other than `)`, `]`, `}`, or `prev` is a word in `return typeof instanceof in of new delete void throw case do else yield await` **and** the word was not preceded by `.` (property access); otherwise division (`prev = punct '/'`); whitespace skipped (does not change `prev`); identifier/number run (`[A-Za-z0-9_$]` or any char ≥ `\u0080`) → `prev = word`; any other character → `prev = punct`. When `inBrace`, a local depth counter tracks `{`/`}`; the `}` at depth 0 consumes itself and returns.
- `scanRegex()`: from the opening `/`, honor backslash escapes and `[…]` classes (a `/` inside a class does not end it), stop at the closing `/` then consume trailing identifier characters (flags); stop without consuming at a newline or end of input.
- `scanTemplate()`: from the opening backtick, honor backslash escapes, on `${` call `scanCode(true)`, end after the closing backtick or at end of input.

Rewrite the header comment (lines 3-17) to state: what is modeled (strings, templates with nested `${…}` code scanned recursively, regex literals, comments blanked to spaces with offsets and newlines stable, hashbang kept); the regex-versus-division heuristic as listed above; its known ambiguity — a `/` right after `)` or `}` is read as division, so `if (x) /re/.test(y)` or a regex after a block-closing `}` is misread, a shape absent from `plugin/bin` and `tests/` at the time of writing; and that `stripperVerdict` remains the backstop for the compile-breaking direction, while a misread that still compiles can keep a comment (never blank code that compiles). Drop the sentence listing which scans call it, or name all four (windows-hide, git-status, path-guard, exit-code).

- [ ] **Step 4: Run the helper tests, the four scans, and the full suite**

Run: `node --test tests/helpers-strip-comments.test.js tests/windows-hide-spawn-conformance.test.js tests/git-status-optional-locks.test.js tests/path-guard-conformance.test.js tests/bin-lib/exit-code-conformance.test.js`
Expected: PASS (`# fail 0`) — AC1.1, AC1.2, AC2.1, AC2.2, AC3.1, AC4.1, AC5.1. A corpus-scan failure here is a real scan result: fix it or allow-list it with a reason by that scan's own convention, never by weakening the stripper.

Implementers and reviewers run only these focused files; the full `npm test` (AC6.1) runs once centrally at /build's Common Step 5.

- [ ] **Step 5: Update the prose that described the old gap**

- `tests/path-guard-conformance.test.js:41-50`: replace the "Regex literals are only partly modeled…" paragraph with: the stripper models regex literals (a quote, backtick, `//` or `/*` inside one stays code); its one known ambiguity is a regex right after `)` or `}`, read as division; `evaluate` fails the lint on any file whose stripped text stops compiling (`stripperVerdict`) instead of counting it as zero tokens, and a misread that still compiles goes unseen, as the helper's header says. Keep the computed-member-access sentence.
- `tests/bin-lib/exit-code-conformance.test.js:99-102`: "The shared stripper reads a regex right after `)` or `}` as division (tests/helpers/strip-comments.js's header), so a mis-parse can still blank a guard. …" — rest unchanged.
- `docs/journeys/act-on-a-red-path-guard-lint-3417.md:31`: the stripper now models regex literals; a mis-parse comes from a regex placed right after `)` or `}` (for example `if (x) /re/.test(y)`); remedy: assign the regex to a const first, or wrap it in parentheses. Keep the closing clause that a count read through a mis-parse is wrong in an unknown direction.

- [ ] **Step 6: Commit**

```bash
git add tests/helpers/strip-comments.js tests/helpers-strip-comments.test.js tests/path-guard-conformance.test.js tests/bin-lib/exit-code-conformance.test.js docs/journeys/act-on-a-red-path-guard-lint-3417.md
git commit -m "Model regex literals in the comment stripper — kept comment text in 23 plugin/bin files now blanked, refs #3585"
```

## Spec coverage

| Spec item | Task |
|---|---|
| Deliverable 1 (single-pass scanner, verbatim literals, blanking) | Task 2 Step 3 |
| Deliverable 2 (regex-vs-division rule, classes, escapes, flags) | Task 2 Step 3; tests Step 1 |
| Deliverable 3 (exports, hashbang, header rewrite) | Task 2 Step 3; hashbang test Step 1 |
| Deliverable 4 (six regression cases) | Task 2 Step 1 (AC1.1 tests) |
| Deliverable 5 (run the four scans, handle findings) | Task 1 (fixture re-point), Task 2 Step 4 |
| AC1.1, AC1.2, AC2.1, AC2.2, AC3.1, AC4.1 | Task 2 Step 1 test names |
| AC5.1, AC6.1 | Task 2 Step 4; full suite at Common Step 5 |
