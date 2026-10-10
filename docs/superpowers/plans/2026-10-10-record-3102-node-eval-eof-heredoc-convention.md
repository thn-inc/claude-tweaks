# State the Unquoted NODE_EVAL_EOF Heredoc Convention (#3102) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `bin/node-eval-file.js`'s header documents the unquoted `<<NODE_EVAL_EOF` call-site form and its body-escaping rule, and `adopted-branch-collision-check.md` cites that rule beside its fence.

**Architecture:** Two prose edits: a header-comment rewrite and one sentence in a skill sub-file. A conformance test appended to the existing `tests/node-eval-file-heredoc-syntax.test.js` pins both.

**Tech Stack:** CommonJS comment, Markdown skill prose, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-10-10T190327-spec-3101-3102-3103-3104/spec-3102/work/3102-spec.md`

## Global Constraints

- Every one of the 24 `plugin/skills` call sites already uses unquoted `<<NODE_EVAL_EOF`; none uses `<<'EOF'`. Do not edit any call site.
- **The rule, stated exactly as the shell behaves.** An unquoted heredoc expands `$…` and backtick command substitution in its body. A backslash is consumed only before `$`, a backtick, another backslash, or a newline. So the body may carry no `$` other than `${CLAUDE_PLUGIN_ROOT}` and no unescaped backtick. A literal backtick is written `` \` ``, as `queue-pull-script.md:511` already does. A JS `\n` or a regex `\d` is untouched and needs no escaping. Do not state the record's looser "no backslash at all" form: three live bodies legitimately carry backslashes.
- `plugin/skills/build/adopted-branch-collision-check.md` stays far under 46080 B (it is about 6 KB).
- Commit message style: `{Verb} {what} — {detail}`, ending with `Claude-Session: https://claude.ai/code/session_01TTWaqgMumX4GGXgtA8CkKa`.

## Review Focus

- The header's usage example must name the real wrapper invocation (`node "${CLAUDE_PLUGIN_ROOT}/bin/node-eval-file.js" <args...> <<NODE_EVAL_EOF … NODE_EVAL_EOF`), not the retired `node -e … <<'EOF'` form. Pinned by the test.
- The rule must say an escaped backtick is fine. Otherwise a future reader "fixes" `queue-pull-script.md:511` and breaks it. Pinned by the test, which asserts the header names `` \` ``.
- The adopted-branch sentence must cite the header, not restate the rule. If it restated it, the two copies would drift. Pinned by the test.

---

### Task 1: State the heredoc convention in the header and the adopted-branch snippet

**Files:**
- Modify: `plugin/bin/node-eval-file.js:13-20` (header comment, the "This wrapper reads the JS source from stdin…" paragraph through "nothing else about the surrounding shell changes.")
- Modify: `plugin/skills/build/adopted-branch-collision-check.md:28-30` (the sentence immediately above the ```bash fence that opens `<<NODE_EVAL_EOF`)
- Test: `tests/node-eval-file-heredoc-syntax.test.js` (append one test)

**Interfaces:**
- Consumes: nothing.
- Produces: nothing.

- [ ] **Step 1: Write the failing test**

Append to `tests/node-eval-file-heredoc-syntax.test.js`:

```js
test('node-eval-file.js header and the adopted-branch snippet state the unquoted NODE_EVAL_EOF convention (#3102)', () => {
  const header = fs.readFileSync(path.join(ROOT, 'plugin', 'bin', 'node-eval-file.js'), 'utf8')
    .replace(/\r\n/g, '\n').split("'use strict';")[0];
  assert.match(header, /node "\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/node-eval-file\.js" <args\.\.\.> <<NODE_EVAL_EOF/,
    'header must show the unquoted <<NODE_EVAL_EOF call-site form');
  assert.ok(!header.includes("<<'EOF'"), "header still documents the retired quoted <<'EOF' form");
  assert.match(header, /no `\$` other than `\$\{CLAUDE_PLUGIN_ROOT\}`/, 'header must state the no-other-$ rule');
  assert.ok(header.includes('\\`'), 'header must say a literal backtick is written escaped');
  const snippet = fs.readFileSync(path.join(SKILLS_DIR, 'build', 'adopted-branch-collision-check.md'), 'utf8')
    .replace(/\r\n/g, '\n');
  const beforeFence = snippet.slice(0, snippet.indexOf('<<NODE_EVAL_EOF'));
  const lastPara = beforeFence.slice(beforeFence.lastIndexOf('\n\n'));
  // The paragraph already cited the header for the Windows `node -e` no-op before #3102, so pin the new sentence itself.
  assert.match(lastPara, /keep the body free of any other `\$` or unescaped backtick, per `bin\/node-eval-file\.js`'s header/,
    'adopted-branch snippet must cite the header rule beside its fence');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/node-eval-file-heredoc-syntax.test.js`
Expected: FAIL. The new #3102 test fails on "header must show the unquoted <<NODE_EVAL_EOF call-site form"; the existing tests still pass.

- [ ] **Step 3: Rewrite the header paragraph and add the snippet sentence**

In `plugin/bin/node-eval-file.js`, replace the comment lines from `// limitation on any shell — only the inline-argument form is affected. This` through `// nothing else about the surrounding shell changes.` with:

```js
// limitation on any shell — only the inline-argument form is affected. This
// wrapper reads the JS source from stdin (never argv), writes it to a temp
// `.cjs` file, and execs `node <file> <args...>` on it — forwarding
// stdout/stderr/exit code unchanged. A call site swaps `node -e "<code>"
// <args...>` for:
//
//   node "${CLAUDE_PLUGIN_ROOT}/bin/node-eval-file.js" <args...> <<NODE_EVAL_EOF
//   <code>
//   NODE_EVAL_EOF
//
// The delimiter is deliberately unquoted, so `${CLAUDE_PLUGIN_ROOT}` inside the
// body expands (#3091). That also makes the shell expand everything else an
// unquoted heredoc expands: the body must carry no `$` other than
// `${CLAUDE_PLUGIN_ROOT}` and no unescaped backtick (write a literal one as \`),
// and a backslash is consumed when it precedes `$`, a backtick, another
// backslash, or a newline. A JS `\n` or a regex `\d` is untouched.
// tests/node-eval-file-heredoc-syntax.test.js checks every body's JS syntax,
// not this rule — keep it by reading the body before adding a `$` or backtick.
```

In `plugin/skills/build/adopted-branch-collision-check.md`, append this sentence to the paragraph ending `…which would read as a clean result:` (immediately above the ```bash fence):

`The heredoc delimiter is unquoted so \`${CLAUDE_PLUGIN_ROOT}\` expands — keep the body free of any other \`$\` or unescaped backtick, per \`bin/node-eval-file.js\`'s header.`

(Write the backticks literally in the Markdown; the backslashes above are only this plan's escaping.)

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/node-eval-file-heredoc-syntax.test.js tests/node-eval-file.test.js`
Expected: PASS. If `tests/node-eval-file.test.js` does not exist, run the first file alone.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/node-eval-file.js plugin/skills/build/adopted-branch-collision-check.md tests/node-eval-file-heredoc-syntax.test.js
git commit -m "State the unquoted NODE_EVAL_EOF heredoc convention in node-eval-file.js and the adopted-branch snippet (#3102)"
```
