# Skill Load Model + Review Load Delta Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Compute each skill entry point's per-invocation load (floor = its `SKILL.md` bytes, closure = floor + every transitively cited file) and show a PR's delta on both in `/claude-tweaks:review` as non-blocking information.

**Architecture:** A pure module `plugin/bin/lib/skill-audit/load.js` works over an injected `readFile(repoRelPath) -> string | null`, so the same code measures the working tree (head) and `git show` content (base). A thin CLI `plugin/bin/load-delta.js` resolves the base, builds both sides, and prints JSON (`--json`) or one rendered outcome. Review step 3j runs the CLI and pastes its output.

**Tech Stack:** Node 18+ (CommonJS, zero runtime deps), `node --test`, git CLI.

**Spec:** `.claude-tweaks/pipelines/2026-10-17T062549-spec-3307-3308-3306-3309-3310-3311/spec-3307/work/3307-spec.md` (record #3307) _(Spec file deleted at the series close-out in PR #3433; the GitHub record, with its As-built notes, is the durable spec.)_

## Global Constraints

- All paths inside `load.js` are repo-relative POSIX strings (`plugin/skills/flow/SKILL.md`); a plugin root is repo-relative too (`plugin`, `.claude`, or `.` for the repo root).
- Bytes are always `measuredBytes` semantics: CRLF→LF, then `<!-- when: -->` marker lines stripped (`stripMarkers`); a malformed marker falls back to the raw normalized byte count.
- The CLI follows `gh-api-module-pattern`: `run(argv, deps)`, injectable `git` runner taking an argv array, `--end-of-options` before every ref argument, never a shell string.
- Exit codes: 0 success (including `no-baseline`), 2 malformed invocation (including an unresolvable explicit `--base`), 3 a `--plugin-root` with no `skills/` directory. An unexpected internal error exits 1.
- Nothing in this unit fails a test because a load grew. No CI gate on load.
- Never check out the base and never `git stash` — base content comes only from `git show <sha>:<path>`.
- Diff against the merge-base with `origin/{integration-branch}`, never a local `main`.
- A skill reference in actionable step text uses the fully qualified `/claude-tweaks:{skill}` form.
- Commit style: `{Verb} {what} — {detail}` with `(refs #3307)`; end every commit message with the line `Claude-Session: https://claude.ai/code/session_01QCX4onFvfDc9rsSUN52717`.

## Review Focus

1. A backticked citation whose resolved path climbs out of the plugin root (`` `../../../etc/x.md` ``) must land in `unresolved`, never be read — pinned in Task 2.
2. Tracked test fixtures that happen to contain `skills/*/SKILL.md` (this repo has `evals/fixtures/merge-check-repo/` and `tools/upstream-drift/fixtures/emilkowalski-skills/`) must not be discovered as plugin roots — discovery only looks at the repo root and one directory down — pinned in Task 2 and Task 5.
3. Base content checked out with CRLF line endings must measure identically to the same content with LF — no phantom delta — pinned in Task 4.
4. Three distinct failure signals must never collapse into one: a file absent at base (0 bytes, normal), a merge-base that does not resolve (`no-baseline`, exit 0), an explicit `--base` that does not resolve (exit 2) — pinned in Task 5.
5. A file reached twice — cited by two members, or both cited and a compose source — counts once in the closure — pinned in Task 3.

## Deviations from the spec text (deliberate; architecture-alignment will classify them)

- **Plugin-root discovery depth.** The spec's single `git ls-files '*skills/*/SKILL.md'` also matches the two fixture trees in Review Focus 2. Discovery instead uses `git ls-files -- ':(glob)skills/*/SKILL.md' ':(glob)*/skills/*/SKILL.md'` (probed: returns exactly `.claude` ×19 and `plugin` ×39 here).
- **Rule (d) anchor.** AC1(d) says "nearest preceding `/claude-tweaks:{name}` token on the same line". For the phrase "in the `/claude-tweaks:X` skill's directory" the name follows the cited token, so "preceding the token" would never resolve it. This plan reads "preceding" as preceding the end of the first directory phrase at or after the token (falling back to the token's own position when the phrase precedes the token). Both phrasings are tested.
- **Compose sources** come from `parseComposeCallLine` (the parser `findComposeCallSites` itself uses), applied to each closure member's text — `findComposeCallSites` reads the working tree, so it cannot see base content.
- **3j degrade lines.** Beyond AC10's three outcomes, the CLI prints `Skill load delta: no baseline (…) — skipped` for `no-baseline`, and 3j renders `Skill load delta: not run — {reason}` on a non-zero exit, so 3j never skips silently.

## File Structure

- Modify `plugin/bin/lib/skill-audit/context-cost.js` — extract `measuredTextBytes(text, label)` from `measuredBytes`; export it and `corpusDir`. No behavior change.
- Create `plugin/bin/lib/skill-audit/load.js` — discovery, citation grammar, closure walk, delta.
- Create `plugin/bin/load-delta.js` — CLI.
- Create `plugin/skills/review/step3-skill-load-delta.md` — the 3j procedure.
- Modify `plugin/skills/review/code-mode-steps.md` — 3j pointer (≤4 lines) after 3i.
- Modify `plugin/skills/review/review-summary-template.md` — `### Skill Load Delta` full-template section + one compact-form line.
- Modify `docs/plugin-structure.md` — `load.js` in the `skill-audit/` line (23), `step3-skill-load-delta.md` in the review sub-file row (91), the CLI row after line 129.
- Create `tests/bin-lib/skill-audit/load.test.js`, `tests/load-delta-cli.test.js`.

Byte pins checked: `plugin/skills/review/code-mode-steps.md` is 41,885 B; `tests/ceremony-profile-roster.test.js:89-91` pins it `<= CEILING_BYTES` (51,200) — the ~350 B pointer leaves ~9 KB headroom. `review-summary-template.md` (14,361 B) has no file-specific pin. No compose call site sources either file. `docs/skill-graph.md` lists no review `step3-*.md` sub-file, so no edge is added (spec Gotcha).

---

### Task 1: Text-level measuring helper

**Files:**
- Modify: `plugin/bin/lib/skill-audit/context-cost.js:115-133` (`measuredBytes`) and the `module.exports` block (`:521`)
- Test: `tests/bin-lib/skill-audit/load.test.js` (create)

**Interfaces:**
- Produces: `measuredTextBytes(text: string, label?: string) -> { bytes: number, markerError?: string }` and `corpusDir(root: string) -> string` (throws `"{root} is not a plugin root: no skills/ directory beneath it …"`), both exported from `context-cost.js`.

- [ ] **Step 1: Write the failing test**

Create `tests/bin-lib/skill-audit/load.test.js`:

```js
// tests/bin-lib/skill-audit/load.test.js — the per-invocation skill load
// model (#3307): bin/lib/skill-audit/load.js plus the text-level measuring
// helper it shares with context-cost.js.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { measuredTextBytes, measuredBytes } = require('../../../plugin/bin/lib/skill-audit/context-cost');

test('measuredTextBytes equals measuredBytes for the same content (CRLF + markers)', () => {
  const text = '<!-- when: mode=auto -->\r\nhello\r\n<!-- /when -->\r\nbye\r\n';
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'load-model-'));
  const file = path.join(dir, 'x.md');
  fs.writeFileSync(file, text);
  assert.deepStrictEqual(measuredTextBytes(text), measuredBytes(file));
  assert.strictEqual(measuredTextBytes(text).bytes, Buffer.byteLength('hello\nbye\n'));
});

test('measuredTextBytes falls back to raw normalized bytes on a malformed marker, naming the label', () => {
  const text = '<!-- when: mode=auto -->\nx\n';
  const r = measuredTextBytes(text, 'lbl.md');
  assert.strictEqual(r.bytes, Buffer.byteLength(text));
  assert.match(r.markerError, /^lbl\.md:1: unclosed marker/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/bin-lib/skill-audit/load.test.js`
Expected: FAIL with "measuredTextBytes is not a function"

- [ ] **Step 3: Write minimal implementation**

In `context-cost.js`, replace the `measuredBytes` function body with:

```js
function measuredTextBytes(raw, label = '<text>') {
  const text = raw.replace(/\r\n/g, '\n');
  try {
    const stripped = stripMarkers(text);
    return { bytes: Buffer.byteLength(stripped, 'utf8') };
  } catch (err) {
    if (err instanceof MarkerError) {
      return { bytes: Buffer.byteLength(text, 'utf8'), markerError: `${label}:${err.line}: ${err.message}` };
    }
    throw err;
  }
}

function measuredBytes(file) {
  return measuredTextBytes(fs.readFileSync(file, 'utf8'), file);
}
```

Keep the existing comment above `measuredBytes`, adding one line before `measuredTextBytes`: `// Text-level core of measuredBytes, for content that is not on disk (git show — load.js, #3307).` Add `corpusDir,` and `measuredTextBytes,` to `module.exports` (after `DESCRIPTION_TOTAL_CEILING_CHARS,`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/skill-audit/load.test.js tests/bin-lib/skill-audit/context-cost.test.js`
Expected: PASS (both files)

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/skill-audit/context-cost.js tests/bin-lib/skill-audit/load.test.js
git commit -m "Extract measuredTextBytes from measuredBytes — text-level measuring for the load model (refs #3307)" -m "Claude-Session: https://claude.ai/code/session_01QCX4onFvfDc9rsSUN52717"
```

### Task 2: Plugin-root discovery and the citation grammar

**Files:**
- Create: `plugin/bin/lib/skill-audit/load.js`
- Test: `tests/bin-lib/skill-audit/load.test.js` (append)

**Interfaces:**
- Consumes: nothing beyond Node built-ins and `toPosix` from `plugin/bin/lib/shared-primitives.js`.
- Produces:
  - `discoverPluginRoots(listFiles: () => string[]) -> string[]` — sorted, unique; root `'.'` for `skills/x/SKILL.md`, `'plugin'` for `plugin/skills/x/SKILL.md`; any deeper path is ignored.
  - `extractCitations(text, citingFile, pluginRoot, { exists }) -> { resolved: string[], unresolved: Array<{citingFile, line, token}> }` — `resolved` unique, in first-seen order; `line` 1-based.
  - `withinRoot(pluginRoot, p) -> boolean` (internal helper, also exported for Task 3).

- [ ] **Step 1: Write the failing test**

Append to `tests/bin-lib/skill-audit/load.test.js`:

```js
const load = require('../../../plugin/bin/lib/skill-audit/load');

function existsIn(files) {
  const set = new Set(files);
  return (p) => set.has(p);
}

test('discoverPluginRoots: repo root and one level down only; fixtures deeper are ignored', () => {
  const files = [
    'plugin/skills/flow/SKILL.md',
    'plugin/skills/build/SKILL.md',
    '.claude/skills/x/SKILL.md',
    'skills/top/SKILL.md',
    'evals/fixtures/merge-check-repo/skills/a/SKILL.md',
    'tools/upstream-drift/fixtures/emilkowalski-skills/skills/b/SKILL.md',
    'plugin/skills/flow/manifesto.md',
  ];
  assert.deepStrictEqual(load.discoverPluginRoots(() => files), ['.', '.claude', 'plugin']);
});

test('extractCitations rule (a): relative to the citing file directory', () => {
  const r = load.extractCitations('Read `part.md` in this skill\'s directory.', 'plugin/skills/flow/SKILL.md', 'plugin',
    { exists: existsIn(['plugin/skills/flow/part.md']) });
  assert.deepStrictEqual(r, { resolved: ['plugin/skills/flow/part.md'], unresolved: [] });
});

test('extractCitations rule (b): _shared, stripping a leading _shared/ so it never doubles', () => {
  const ex = existsIn(['plugin/skills/_shared/foo.md']);
  for (const tok of ['foo.md', '_shared/foo.md']) {
    const r = load.extractCitations(`see \`${tok}\``, 'plugin/skills/flow/SKILL.md', 'plugin', { exists: ex });
    assert.deepStrictEqual(r.resolved, ['plugin/skills/_shared/foo.md'], tok);
  }
});

test('extractCitations rule (a) wins over (b) when both exist', () => {
  const r = load.extractCitations('`foo.md`', 'plugin/skills/flow/SKILL.md', 'plugin',
    { exists: existsIn(['plugin/skills/flow/foo.md', 'plugin/skills/_shared/foo.md']) });
  assert.deepStrictEqual(r.resolved, ['plugin/skills/flow/foo.md']);
});

test('extractCitations rule (c): ${CLAUDE_PLUGIN_ROOT}/ resolves against the plugin root', () => {
  const r = load.extractCitations('`${CLAUDE_PLUGIN_ROOT}/skills/test/verification.md`', 'plugin/skills/flow/SKILL.md', 'plugin',
    { exists: existsIn(['plugin/skills/test/verification.md']) });
  assert.deepStrictEqual(r.resolved, ['plugin/skills/test/verification.md']);
});

test('extractCitations rule (d): "in that skill\'s directory" uses the nearest preceding /claude-tweaks:{name}', () => {
  const line = 'Run `/claude-tweaks:stories` then `/claude-tweaks:design-wrapper`; read `frontend-detection.md` in that skill\'s directory.';
  const r = load.extractCitations(line, 'plugin/skills/flow/SKILL.md', 'plugin',
    { exists: existsIn(['plugin/skills/design-wrapper/frontend-detection.md']) });
  assert.deepStrictEqual(r.resolved, ['plugin/skills/design-wrapper/frontend-detection.md']);
});

test('extractCitations rule (d): "in the `/claude-tweaks:{name}` skill\'s directory" names the skill after the token', () => {
  const line = 'read `frontend-detection.md` in the `/claude-tweaks:design-wrapper` skill\'s directory';
  const r = load.extractCitations(line, 'plugin/skills/build/SKILL.md', 'plugin',
    { exists: existsIn(['plugin/skills/design-wrapper/frontend-detection.md']) });
  assert.deepStrictEqual(r.resolved, ['plugin/skills/design-wrapper/frontend-detection.md']);
});

test('extractCitations rule (d) does not apply without the phrase or without a skill token', () => {
  const ex = existsIn(['plugin/skills/design-wrapper/frontend-detection.md']);
  const noPhrase = load.extractCitations('`/claude-tweaks:design-wrapper` uses `frontend-detection.md`.', 'plugin/skills/build/SKILL.md', 'plugin', { exists: ex });
  assert.deepStrictEqual(noPhrase.resolved, []);
  const noToken = load.extractCitations('read `frontend-detection.md` in that skill\'s directory', 'plugin/skills/build/SKILL.md', 'plugin', { exists: ex });
  assert.deepStrictEqual(noToken.resolved, []);
});

test('extractCitations: an unresolvable token is recorded with its 1-based line, never counted', () => {
  const r = load.extractCitations('line one\nsee `docs/skill-graph.md` here', 'plugin/skills/flow/SKILL.md', 'plugin', { exists: () => false });
  assert.deepStrictEqual(r, {
    resolved: [],
    unresolved: [{ citingFile: 'plugin/skills/flow/SKILL.md', line: 2, token: 'docs/skill-graph.md' }],
  });
});

test('extractCitations: a token climbing out of the plugin root is unresolved even if the path exists', () => {
  const r = load.extractCitations('`../../../README.md`', 'plugin/skills/flow/SKILL.md', 'plugin', { exists: () => true });
  assert.deepStrictEqual(r.resolved, []);
  assert.strictEqual(r.unresolved.length, 1);
});

test('extractCitations: repeated citations of one file resolve once', () => {
  const r = load.extractCitations('`a.md` and `a.md`\n`a.md`', 'plugin/skills/flow/SKILL.md', 'plugin',
    { exists: existsIn(['plugin/skills/flow/a.md']) });
  assert.deepStrictEqual(r.resolved, ['plugin/skills/flow/a.md']);
});

test('extractCitations works under a repo-root plugin root (".")', () => {
  const r = load.extractCitations('`_shared/foo.md`', 'skills/flow/SKILL.md', '.', { exists: existsIn(['skills/_shared/foo.md']) });
  assert.deepStrictEqual(r.resolved, ['skills/_shared/foo.md']);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/bin-lib/skill-audit/load.test.js`
Expected: FAIL with "Cannot find module '../../../plugin/bin/lib/skill-audit/load'"

- [ ] **Step 3: Write minimal implementation**

Create `plugin/bin/lib/skill-audit/load.js`:

```js
'use strict';

// Per-invocation skill load model (#3307, parent #3305).
//
// Raw file size stopped being an honest cost measure once a per-file cap
// rewarded splitting: moving a section into a sibling file that SKILL.md
// tells the reader to load immediately looked like a saving while the
// invocation still paid for every byte. For each entry point (every
// skills/*/SKILL.md under a plugin root) this module computes
//   floor   — the SKILL.md's own measured bytes, paid on every invocation;
//   closure — floor + every file reachable from it by citation (backticked
//             `.md` tokens, compose-context.js sources), transitively, each
//             file counted once: the upper bound an invocation can load.
// A PR's delta on both makes a split show as a move ("floor -10 KB, closure
// +80 B"), not a cut. Pure over an injected readFile, so the CLI
// (bin/load-delta.js) feeds it working-tree content for head and
// `git show` content for base. All paths are repo-relative POSIX strings.

const path = require('node:path');
const { toPosix } = require('../shared-primitives');

const posix = path.posix;
const PLUGIN_ROOT_PREFIX = '${CLAUDE_PLUGIN_ROOT}/';
const BACKTICK_MD = /`([^`\n]+\.md)`/g;
const SKILL_DIR_PHRASE = /in that skill's directory|in the `\/claude-tweaks:[a-z0-9-]+` skill's directory/g;
const SKILL_TOKEN = /\/claude-tweaks:([a-z0-9-]+)/g;
// A plugin root is the repo root or one directory down. Deeper trees are
// test fixtures (evals/fixtures/…, tools/upstream-drift/fixtures/…), never a
// shipped or project-local skill root.
const ROOT_SKILL_MD = /^(?:([^/]+)\/)?skills\/[^/]+\/SKILL\.md$/;

function discoverPluginRoots(listFiles) {
  const roots = new Set();
  for (const f of listFiles()) {
    const m = toPosix(f).match(ROOT_SKILL_MD);
    if (m) roots.add(m[1] || '.');
  }
  return [...roots].sort();
}

function withinRoot(pluginRoot, p) {
  if (p === '..' || p.startsWith('../') || posix.isAbsolute(p)) return false;
  return pluginRoot === '.' || p.startsWith(`${pluginRoot}/`);
}

// Rule (d)'s skill: the nearest /claude-tweaks:{name} token preceding the end
// of the first directory phrase at or after the cited token. For "in the
// `/claude-tweaks:X` skill's directory" that is X itself (it follows the
// token); for "in that skill's directory" it is the last skill named before
// the phrase. A phrase only before the token anchors at the token.
function phraseSkill(line, tokenIndex) {
  const phrases = [...line.matchAll(SKILL_DIR_PHRASE)];
  if (phrases.length === 0) return null;
  const after = phrases.find((m) => m.index >= tokenIndex);
  const anchor = after ? after.index + after[0].length : tokenIndex;
  const names = [...line.slice(0, anchor).matchAll(SKILL_TOKEN)];
  return names.length ? names[names.length - 1][1] : null;
}

function extractCitations(text, citingFile, pluginRoot, { exists }) {
  const resolved = [];
  const unresolved = [];
  const seen = new Set();
  const citingDir = posix.dirname(citingFile);
  const sharedDir = posix.join(pluginRoot, 'skills', '_shared');
  text.replace(/\r\n/g, '\n').split('\n').forEach((line, i) => {
    for (const m of line.matchAll(BACKTICK_MD)) {
      const token = m[1];
      const candidates = [
        posix.join(citingDir, token), // (a)
        posix.join(sharedDir, token.replace(/^_shared\//, '')), // (b)
      ];
      if (token.startsWith(PLUGIN_ROOT_PREFIX)) {
        candidates.push(posix.join(pluginRoot, token.slice(PLUGIN_ROOT_PREFIX.length))); // (c)
      }
      const skill = phraseSkill(line, m.index);
      if (skill) candidates.push(posix.join(pluginRoot, 'skills', skill, token)); // (d)
      const hit = candidates.find((c) => withinRoot(pluginRoot, c) && exists(c));
      if (!hit) {
        unresolved.push({ citingFile, line: i + 1, token });
      } else if (!seen.has(hit)) {
        seen.add(hit);
        resolved.push(hit);
      }
    }
  });
  return { resolved, unresolved };
}

module.exports = { discoverPluginRoots, extractCitations, withinRoot };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/bin-lib/skill-audit/load.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/skill-audit/load.js tests/bin-lib/skill-audit/load.test.js
git commit -m "Add load.js plugin-root discovery and citation grammar — rules (a)-(d), unresolved never counted (refs #3307)" -m "Claude-Session: https://claude.ai/code/session_01QCX4onFvfDc9rsSUN52717"
```

### Task 3: Floor and closure per entry point

**Files:**
- Extends: `plugin/bin/lib/skill-audit/load.js` (created in Task 2 — not a `Modify:` bullet, since `plan-audit.js` Check A requires a `Modify:` path to exist before dispatch)
- Test: `tests/bin-lib/skill-audit/load.test.js` (append)

**Interfaces:**
- Consumes: `extractCitations`, `withinRoot` (Task 2); `measuredTextBytes`, `parseComposeCallLine` from `context-cost.js` (Task 1 / existing).
- Produces: `entryPointLoads(pluginRoot, { readFile, listSkillMds }) -> Array<{ entry, floor, closure, files, unresolved }>`, sorted by `entry`. `entry` is `{rootName}:{skill}` where `rootName` is `posix.basename(pluginRoot)` (or `.` for the repo root). `files` is the closure set sorted lexically. `readFile(p)` returns the file's text or `null` when absent; `listSkillMds()` returns the root's `…/skills/*/SKILL.md` paths.

- [ ] **Step 1: Write the failing test**

Append:

```js
function tree(files) {
  const has = (p) => Object.prototype.hasOwnProperty.call(files, p);
  return {
    readFile: (p) => (has(p) ? files[p] : null),
    listSkillMds: () => Object.keys(files).filter((p) => /(^|\/)skills\/[^/]+\/SKILL\.md$/.test(p)),
  };
}
const B = (s) => Buffer.byteLength(s, 'utf8');

test('entryPointLoads: floor is the SKILL.md bytes; closure sums the transitive set once each', () => {
  const files = {
    'plugin/skills/flow/SKILL.md': 'Read `a.md` in this skill\'s directory.\n',
    'plugin/skills/flow/a.md': 'Then `b.md`.\n',
    'plugin/skills/flow/b.md': 'leaf\n',
    'plugin/skills/flow/orphan.md': 'never cited\n',
  };
  const [row] = load.entryPointLoads('plugin', tree(files));
  assert.strictEqual(row.entry, 'plugin:flow');
  assert.strictEqual(row.floor, B(files['plugin/skills/flow/SKILL.md']));
  assert.deepStrictEqual(row.files, ['plugin/skills/flow/SKILL.md', 'plugin/skills/flow/a.md', 'plugin/skills/flow/b.md']);
  assert.strictEqual(row.closure, row.files.reduce((s, f) => s + B(files[f]), 0));
  assert.deepStrictEqual(row.unresolved, []);
});

test('entryPointLoads: entries are namespaced by root so same-named skills never collide', () => {
  const a = load.entryPointLoads('plugin', tree({ 'plugin/skills/x/SKILL.md': 'p\n' }));
  const b = load.entryPointLoads('.claude', tree({ '.claude/skills/x/SKILL.md': 'c\n' }));
  assert.deepStrictEqual([a[0].entry, b[0].entry], ['plugin:x', '.claude:x']);
});

test('entryPointLoads: a citation cycle terminates and counts each file once', () => {
  const files = {
    'plugin/skills/s/SKILL.md': '`a.md`\n',
    'plugin/skills/s/a.md': '`b.md`\n',
    'plugin/skills/s/b.md': '`a.md` and `SKILL.md`\n',
  };
  const [row] = load.entryPointLoads('plugin', tree(files));
  assert.deepStrictEqual(row.files, ['plugin/skills/s/SKILL.md', 'plugin/skills/s/a.md', 'plugin/skills/s/b.md']);
  assert.strictEqual(row.closure, B('`a.md`\n') + B('`b.md`\n') + B('`a.md` and `SKILL.md`\n'));
});

test('entryPointLoads: compose sources join the closure and are walked transitively', () => {
  const composeLine = 'Run `node "${CLAUDE_PLUGIN_ROOT}/bin/compose-context.js" --run "$PIPELINE_RUN_DIR" --step x "${CLAUDE_PLUGIN_ROOT}/skills/_shared/src.md"`.\n';
  const files = {
    'plugin/skills/s/SKILL.md': 'Read `step.md` in this skill\'s directory.\n',
    'plugin/skills/s/step.md': composeLine,
    'plugin/skills/_shared/src.md': 'see `deep.md`\n',
    'plugin/skills/_shared/deep.md': 'deep\n',
  };
  const [row] = load.entryPointLoads('plugin', tree(files));
  assert.deepStrictEqual(row.files, [
    'plugin/skills/_shared/deep.md', 'plugin/skills/_shared/src.md',
    'plugin/skills/s/SKILL.md', 'plugin/skills/s/step.md',
  ]);
});

test('entryPointLoads: a file both cited and a compose source counts once', () => {
  const files = {
    'plugin/skills/s/SKILL.md': '`_shared/src.md` and `node "${CLAUDE_PLUGIN_ROOT}/bin/compose-context.js" --step x "${CLAUDE_PLUGIN_ROOT}/skills/_shared/src.md"`\n',
    'plugin/skills/_shared/src.md': 'src\n',
  };
  const [row] = load.entryPointLoads('plugin', tree(files));
  assert.deepStrictEqual(row.files, ['plugin/skills/_shared/src.md', 'plugin/skills/s/SKILL.md']);
  assert.strictEqual(row.closure, B(files['plugin/skills/s/SKILL.md']) + B('src\n'));
});

test('entryPointLoads: unresolved citations and missing compose sources surface, at zero bytes', () => {
  const files = {
    'plugin/skills/s/SKILL.md': '`missing.md`\n`node "${CLAUDE_PLUGIN_ROOT}/bin/compose-context.js" --step x "${CLAUDE_PLUGIN_ROOT}/skills/_shared/gone.md"`\n',
  };
  const [row] = load.entryPointLoads('plugin', tree(files));
  assert.strictEqual(row.closure, row.floor);
  assert.deepStrictEqual(row.unresolved.map((u) => [u.line, u.token]), [
    [1, 'missing.md'],
    [2, 'plugin/skills/_shared/gone.md'],
  ]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/bin-lib/skill-audit/load.test.js`
Expected: FAIL with "load.entryPointLoads is not a function"

- [ ] **Step 3: Write minimal implementation**

In `load.js`, add after the existing `require` lines:

```js
const { measuredTextBytes, parseComposeCallLine } = require('./context-cost');

// parseComposeCallLine resolves `${CLAUDE_PLUGIN_ROOT}/x` against an absolute
// root; a fixed sentinel root keeps this module free of the real filesystem.
const SENTINEL_ROOT = path.resolve(path.sep, '__skill_load_model_root__');
```

Add before `module.exports`:

```js
function composeSources(text, citingFile, pluginRoot, { exists }) {
  const resolved = [];
  const unresolved = [];
  text.replace(/\r\n/g, '\n').split('\n').forEach((line, i) => {
    if (!line.includes('compose-context.js')) return;
    const parsed = parseComposeCallLine(line, SENTINEL_ROOT);
    if (!parsed) return;
    if (parsed.unparsed) {
      unresolved.push({ citingFile, line: i + 1, token: `compose-context.js: ${parsed.reason}` });
      return;
    }
    for (const abs of parsed.sources) {
      const p = posix.join(pluginRoot, toPosix(path.relative(SENTINEL_ROOT, abs)));
      if (withinRoot(pluginRoot, p) && exists(p)) resolved.push(p);
      else unresolved.push({ citingFile, line: i + 1, token: p });
    }
  });
  return { resolved, unresolved };
}

function entryPointLoads(pluginRoot, { readFile, listSkillMds }) {
  const texts = new Map();
  const read = (p) => {
    if (!texts.has(p)) texts.set(p, readFile(p));
    return texts.get(p);
  };
  const exists = (p) => read(p) !== null;
  const edges = new Map();
  const edgesOf = (p) => {
    if (!edges.has(p)) {
      const text = read(p) || '';
      const cites = extractCitations(text, p, pluginRoot, { exists });
      const composed = composeSources(text, p, pluginRoot, { exists });
      edges.set(p, {
        next: [...new Set([...cites.resolved, ...composed.resolved])],
        unresolved: [...cites.unresolved, ...composed.unresolved],
      });
    }
    return edges.get(p);
  };
  const bytesOf = (p) => measuredTextBytes(read(p) || '', p).bytes;
  const rootName = pluginRoot === '.' ? '.' : posix.basename(pluginRoot);

  return listSkillMds().map((skillMd) => {
    const seen = new Set([skillMd]);
    const queue = [skillMd];
    const unresolved = [];
    while (queue.length) {
      const p = queue.shift();
      const e = edgesOf(p);
      unresolved.push(...e.unresolved);
      for (const n of e.next) {
        if (!seen.has(n)) { seen.add(n); queue.push(n); }
      }
    }
    const files = [...seen].sort();
    return {
      entry: `${rootName}:${posix.basename(posix.dirname(skillMd))}`,
      floor: bytesOf(skillMd),
      closure: files.reduce((sum, f) => sum + bytesOf(f), 0),
      files,
      unresolved,
    };
  }).sort((a, b) => (a.entry < b.entry ? -1 : a.entry > b.entry ? 1 : 0));
}
```

Change the export line to `module.exports = { discoverPluginRoots, extractCitations, withinRoot, entryPointLoads };`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/bin-lib/skill-audit/load.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/skill-audit/load.js tests/bin-lib/skill-audit/load.test.js
git commit -m "Add entryPointLoads — floor and transitive closure per skill entry point, compose sources included (refs #3307)" -m "Claude-Session: https://claude.ai/code/session_01QCX4onFvfDc9rsSUN52717"
```

### Task 4: The delta

**Files:**
- Extends: `plugin/bin/lib/skill-audit/load.js` (created in Task 2 — not a `Modify:` bullet, since `plan-audit.js` Check A requires a `Modify:` path to exist before dispatch)
- Test: `tests/bin-lib/skill-audit/load.test.js` (append)

**Interfaces:**
- Consumes: `entryPointLoads` rows (Task 3).
- Produces: `loadDelta(baseRows, headRows) -> Array<{ entry, floor, dFloor, closure, dClosure, newUnresolved, added?: true, removed?: true }>` — changed entries only (a nonzero `dFloor` or `dClosure`, or added/removed), sorted by `entry`. `floor`/`closure` are head values (0 for removed). `newUnresolved` holds head unresolved items whose `(citingFile, token)` pair is absent at base (line numbers ignored, since lines shift).

- [ ] **Step 1: Write the failing test**

Append:

```js
test('loadDelta move-not-cut: a 10,000 B split shows floor ≈ -10,000 and closure = the pointer line', () => {
  const pointer = 'Read `part.md` in this skill\'s directory.';
  const base = load.entryPointLoads('plugin', tree({ 'plugin/skills/s/SKILL.md': `${'a'.repeat(19999)}\n` }));
  const head = load.entryPointLoads('plugin', tree({
    'plugin/skills/s/SKILL.md': `${'a'.repeat(9999)}\n${pointer}\n`,
    'plugin/skills/s/part.md': `${'a'.repeat(9999)}\n`,
  }));
  assert.strictEqual(base[0].floor, 20000);
  const [row] = load.loadDelta(base, head);
  assert.strictEqual(row.entry, 'plugin:s');
  assert.ok(Math.abs(row.dFloor + 10000) <= B(pointer) + 2, `dFloor ${row.dFloor}`);
  assert.ok(Math.abs(row.dClosure - B(pointer)) <= 2, `dClosure ${row.dClosure}`);
});

test('loadDelta: a _shared change fans out to exactly the entry points whose closure holds it', () => {
  const files = {
    'plugin/skills/one/SKILL.md': '`_shared/x.md`\n',
    'plugin/skills/two/SKILL.md': 'see `_shared/x.md`\n',
    'plugin/skills/three/SKILL.md': 'no citations\n',
    'plugin/skills/_shared/x.md': 'shared\n',
  };
  const base = load.entryPointLoads('plugin', tree(files));
  const head = load.entryPointLoads('plugin', tree({ ...files, 'plugin/skills/_shared/x.md': 'shared, now longer\n' }));
  const rows = load.loadDelta(base, head);
  assert.deepStrictEqual(rows.map((r) => r.entry), ['plugin:one', 'plugin:two']);
  for (const r of rows) {
    assert.strictEqual(r.dFloor, 0);
    assert.strictEqual(r.dClosure, B('shared, now longer\n') - B('shared\n'));
  }
});

test('loadDelta: added and removed entry points', () => {
  const base = load.entryPointLoads('plugin', tree({ 'plugin/skills/old/SKILL.md': 'old\n' }));
  const head = load.entryPointLoads('plugin', tree({ 'plugin/skills/new/SKILL.md': 'brand new\n' }));
  assert.deepStrictEqual(load.loadDelta(base, head), [
    { entry: 'plugin:new', floor: 10, dFloor: 10, closure: 10, dClosure: 10, newUnresolved: [], added: true },
    { entry: 'plugin:old', floor: 0, dFloor: -4, closure: 0, dClosure: -4, newUnresolved: [], removed: true },
  ]);
});

test('loadDelta: CRLF base content measures the same as LF head — no phantom delta', () => {
  const lf = 'Read `a.md` in this skill\'s directory.\nline two\n';
  const base = load.entryPointLoads('plugin', tree({
    'plugin/skills/s/SKILL.md': lf.replace(/\n/g, '\r\n'), 'plugin/skills/s/a.md': 'x\r\n',
  }));
  const head = load.entryPointLoads('plugin', tree({ 'plugin/skills/s/SKILL.md': lf, 'plugin/skills/s/a.md': 'x\n' }));
  assert.deepStrictEqual(load.loadDelta(base, head), []);
});

test('loadDelta: newUnresolved lists only citations unresolved at head and not at base, ignoring line moves', () => {
  const base = load.entryPointLoads('plugin', tree({ 'plugin/skills/s/SKILL.md': '`gone.md`\n' }));
  const head = load.entryPointLoads('plugin', tree({ 'plugin/skills/s/SKILL.md': 'moved down\n`gone.md`\n`new-miss.md`\n' }));
  const [row] = load.loadDelta(base, head);
  assert.deepStrictEqual(row.newUnresolved, [{ citingFile: 'plugin/skills/s/SKILL.md', line: 3, token: 'new-miss.md' }]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/bin-lib/skill-audit/load.test.js`
Expected: FAIL with "load.loadDelta is not a function"

- [ ] **Step 3: Write minimal implementation**

Add before `module.exports` in `load.js`:

```js
const unresolvedKey = (u) => `${u.citingFile}\u0000${u.token}`;

function loadDelta(baseRows, headRows) {
  const base = new Map(baseRows.map((r) => [r.entry, r]));
  const head = new Map(headRows.map((r) => [r.entry, r]));
  const entries = [...new Set([...base.keys(), ...head.keys()])].sort();
  const out = [];
  for (const entry of entries) {
    const b = base.get(entry);
    const h = head.get(entry);
    if (!b) {
      out.push({ entry, floor: h.floor, dFloor: h.floor, closure: h.closure, dClosure: h.closure, newUnresolved: h.unresolved, added: true });
      continue;
    }
    if (!h) {
      out.push({ entry, floor: 0, dFloor: -b.floor, closure: 0, dClosure: -b.closure, newUnresolved: [], removed: true });
      continue;
    }
    const dFloor = h.floor - b.floor;
    const dClosure = h.closure - b.closure;
    if (dFloor === 0 && dClosure === 0) continue;
    const known = new Set(b.unresolved.map(unresolvedKey));
    out.push({ entry, floor: h.floor, dFloor, closure: h.closure, dClosure, newUnresolved: h.unresolved.filter((u) => !known.has(unresolvedKey(u))) });
  }
  return out;
}
```

Export line: `module.exports = { discoverPluginRoots, extractCitations, withinRoot, entryPointLoads, loadDelta };`

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/bin-lib/skill-audit/load.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/skill-audit/load.js tests/bin-lib/skill-audit/load.test.js
git commit -m "Add loadDelta — floor and closure delta per changed entry point, added/removed and new unresolved citations (refs #3307)" -m "Claude-Session: https://claude.ai/code/session_01QCX4onFvfDc9rsSUN52717"
```

### Task 5: The `load-delta.js` CLI

**Files:**
- Create: `plugin/bin/load-delta.js`
- Test: `tests/load-delta-cli.test.js` (create)

**Interfaces:**
- Consumes: `discoverPluginRoots`, `entryPointLoads`, `loadDelta` (Tasks 2-4); `corpusDir` (Task 1); `readIntegrationBranch(repoRoot)` from `plugin/bin/lib/policy.js`; `toPosix`.
- Produces: `run(argv, deps) -> exitCode`, `parseArgs(argv)`, `renderText(result, changedFiles)`. `deps`: `{ stdout(s), stderr(s), cwd: string, git?: (args) => string, readIntegrationBranch?: (repoRoot) => string | null }`. JSON output (`--json`, one line): `{ status: 'ok', base: <sha>, roots: [{ pluginRoot, entries: loadDelta rows }] }` or `{ status: 'no-baseline', base: null, roots: [{ pluginRoot, entries: entryPointLoads rows }] }`. Text output (default): exactly one block — `Skill load delta: no skill files changed — skipped`, `Skill load delta: skill files changed, no entry point's load moved`, the table, or `Skill load delta: no baseline (merge-base with {ref} unresolved) — skipped`.

Git commands this CLI issues (each probed read-only against this repo during plan authoring):
- `git -C {cwd} rev-parse --show-toplevel`
- `git -C {repo} ls-files -- ':(glob)skills/*/SKILL.md' ':(glob)*/skills/*/SKILL.md'` → here: `.claude` ×19, `plugin` ×39, no fixture roots.
- `git -C {repo} rev-parse --verify --quiet --end-of-options {ref}^{commit}` → exit 1, no output, for `nope-ref`.
- `git -C {repo} symbolic-ref --quiet --short refs/remotes/origin/HEAD` → `origin/main`.
- `git -C {repo} merge-base HEAD origin/{branch}`
- `git -C {repo} ls-tree -r --name-only --full-tree {sha}`
- `git -C {repo} show --end-of-options {sha}:{path}` → content; for an absent path exits 128 (`fatal: path … does not exist`), which this CLI never reaches because it checks the `ls-tree` set first.
- `git -C {repo} diff --name-only --end-of-options {sha}`

- [ ] **Step 1: Write the failing test**

Create `tests/load-delta-cli.test.js`:

```js
// tests/load-delta-cli.test.js — bin/load-delta.js (#3307), the CLI over
// bin/lib/skill-audit/load.js that review step 3j runs. Exercised through
// the run(argv, deps) seam against throwaway git repos, plus one run against
// this repo (AC12).
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { run } = require('../plugin/bin/load-delta');

const REPO = path.join(__dirname, '..');

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function write(root, rel, text) {
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text);
}

// A repo with one commit on main, recorded as origin/main, then optional head edits.
function makeRepo(baseFiles, { origin = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'load-delta-'));
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 't@example.com');
  git(dir, 'config', 'user.name', 't');
  for (const [rel, text] of Object.entries(baseFiles)) write(dir, rel, text);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'base');
  if (origin) git(dir, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  return dir;
}

function call(argv, cwd) {
  const out = { stdout: '', stderr: '' };
  const code = run(argv, {
    stdout: (s) => { out.stdout += s; },
    stderr: (s) => { out.stderr += s; },
    cwd,
    readIntegrationBranch: () => null,
  });
  return { code, ...out };
}

const POINTER = 'Read `part.md` in this skill\'s directory.';

test('ok: a committed move-not-cut split reports one changed entry against the merge-base', () => {
  const dir = makeRepo({ 'plugin/skills/s/SKILL.md': `${'a'.repeat(19999)}\n` });
  const baseSha = git(dir, 'rev-parse', 'HEAD').trim();
  write(dir, 'plugin/skills/s/SKILL.md', `${'a'.repeat(9999)}\n${POINTER}\n`);
  write(dir, 'plugin/skills/s/part.md', `${'a'.repeat(9999)}\n`);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'split');
  const r = call(['--json'], dir);
  assert.strictEqual(r.code, 0, r.stderr);
  const j = JSON.parse(r.stdout);
  assert.strictEqual(j.status, 'ok');
  assert.strictEqual(j.base, baseSha);
  assert.deepStrictEqual(j.roots.map((x) => x.pluginRoot), ['plugin']);
  const [row] = j.roots[0].entries;
  assert.strictEqual(row.entry, 'plugin:s');
  assert.strictEqual(row.dClosure, Buffer.byteLength(POINTER) + 1);
});

test('no-baseline: no origin ref still exits 0 with absolute loads, never a zero delta', () => {
  const dir = makeRepo({ 'plugin/skills/s/SKILL.md': 'hello\n' }, { origin: false });
  const r = call(['--json'], dir);
  assert.strictEqual(r.code, 0, r.stderr);
  const j = JSON.parse(r.stdout);
  assert.deepStrictEqual([j.status, j.base], ['no-baseline', null]);
  const [row] = j.roots[0].entries;
  assert.deepStrictEqual([row.entry, row.floor, row.closure], ['plugin:s', 6, 6]);
  assert.strictEqual('dFloor' in row, false);
  const text = call([], dir);
  assert.match(text.stdout, /^Skill load delta: no baseline \(merge-base with origin\/main unresolved\) — skipped\n$/);
});

test('an explicit --base that does not resolve exits 2 naming the ref', () => {
  const dir = makeRepo({ 'plugin/skills/s/SKILL.md': 'x\n' });
  const r = call(['--base', 'no-such-ref', '--json'], dir);
  assert.strictEqual(r.code, 2);
  assert.strictEqual(r.stdout, '');
  assert.match(r.stderr, /--base no-such-ref does not resolve to a commit/);
});

test('an explicit --base is used as given', () => {
  const dir = makeRepo({ 'plugin/skills/s/SKILL.md': 'x\n' }, { origin: false });
  const baseSha = git(dir, 'rev-parse', 'HEAD').trim();
  write(dir, 'plugin/skills/s/SKILL.md', 'xyz\n');
  const j = JSON.parse(call(['--base', baseSha, '--json'], dir).stdout);
  assert.deepStrictEqual([j.status, j.base, j.roots[0].entries[0].dFloor], ['ok', baseSha, 2]);
});

test('a --plugin-root with no skills/ exits 3 with corpusDir\'s message', () => {
  const dir = makeRepo({ 'plugin/skills/s/SKILL.md': 'x\n', 'docs/readme.md': 'd\n' });
  const r = call(['--plugin-root', 'docs'], dir);
  assert.strictEqual(r.code, 3);
  assert.match(r.stderr, /not a plugin root: no skills\/ directory beneath it/);
});

test('malformed invocations exit 2', () => {
  const dir = makeRepo({ 'plugin/skills/s/SKILL.md': 'x\n' });
  assert.strictEqual(call(['--bogus'], dir).code, 2);
  assert.strictEqual(call(['--base'], dir).code, 2);
  assert.strictEqual(call(['--plugin-root'], dir).code, 2);
});

test('discovery skips fixture trees deeper than one directory', () => {
  const dir = makeRepo({
    'plugin/skills/s/SKILL.md': 'x\n',
    '.claude/skills/t/SKILL.md': 'y\n',
    'evals/fixtures/repo/skills/u/SKILL.md': 'z\n',
  });
  const j = JSON.parse(call(['--json'], dir).stdout);
  assert.deepStrictEqual(j.roots.map((x) => x.pluginRoot), ['.claude', 'plugin']);
});

test('text outcome 1: a diff touching no skill file', () => {
  const dir = makeRepo({ 'plugin/skills/s/SKILL.md': 'x\n', 'README.md': 'r\n' });
  write(dir, 'README.md', 'changed\n');
  assert.strictEqual(call([], dir).stdout, 'Skill load delta: no skill files changed — skipped\n');
});

test('text outcome 2: skill files changed but no entry point moved', () => {
  const dir = makeRepo({ 'plugin/skills/s/SKILL.md': 'x\n', 'plugin/skills/s/orphan.md': 'o\n' });
  write(dir, 'plugin/skills/s/orphan.md', 'orphan, not cited by anything\n');
  assert.strictEqual(call([], dir).stdout, 'Skill load delta: skill files changed, no entry point\'s load moved\n');
});

test('text outcome 3: a table with added/removed markers and signed deltas', () => {
  const dir = makeRepo({ 'plugin/skills/s/SKILL.md': 'x\n', 'plugin/skills/gone/SKILL.md': 'bye\n' });
  write(dir, 'plugin/skills/s/SKILL.md', 'x\n`missing.md`\n');
  fs.rmSync(path.join(dir, 'plugin/skills/gone'), { recursive: true });
  const out = call([], dir).stdout;
  assert.match(out, /^Skill load delta \(base [0-9a-f]{7}\):\n/);
  assert.match(out, /\| Entry \| Floor \| ΔFloor \| Closure \| ΔClosure \| New unresolved \|/);
  assert.match(out, /\| plugin:gone \(removed\) \| 0 \| -4 \| 0 \| -4 \| — \|/);
  assert.match(out, /\| plugin:s \| 15 \| \+13 \| 15 \| \+13 \| 1: `missing\.md` \|/);
});

test('AC12: this repo — exits 0 and lists both the plugin and .claude roots', () => {
  const r = call(['--json'], REPO);
  assert.strictEqual(r.code, 0, r.stderr);
  const roots = JSON.parse(r.stdout).roots.map((x) => x.pluginRoot);
  assert.ok(roots.includes('plugin') && roots.includes('.claude'), JSON.stringify(roots));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/load-delta-cli.test.js`
Expected: FAIL with "Cannot find module '../plugin/bin/load-delta'"

- [ ] **Step 3: Write minimal implementation**

Create `plugin/bin/load-delta.js`:

```js
#!/usr/bin/env node
// bin/load-delta.js — per-invocation skill load delta (#3307). Thin CLI over
// bin/lib/skill-audit/load.js: computes each skill entry point's floor
// (SKILL.md bytes) and closure (floor + every transitively cited file) at
// the base and at the working tree, and prints the change. Review step 3j
// (skills/review/step3-skill-load-delta.md) runs it; it never gates.
//
// Usage: load-delta.js [--plugin-root <dir>]... [--base <ref>] [--json] [--help]
//   --plugin-root  repeatable; the directory holding skills/ (default: every
//                  tracked skills/*/SKILL.md root at the repo root or one
//                  directory down — discoverPluginRoots)
//   --base         base commit-ish (default: merge-base of HEAD with
//                  origin/{integration-branch}: policy `integration-branch`,
//                  else origin/HEAD, else main — _shared/integration-branch.md)
//   --json         one JSON line instead of the rendered outcome
// Base content comes from `git show <sha>:<path>`; nothing is checked out.
// Exit: 0 success (including status no-baseline); 2 malformed invocation or
// an explicit --base that does not resolve; 3 a --plugin-root with no
// skills/; 1 an unexpected error.
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { discoverPluginRoots, entryPointLoads, loadDelta } = require('./lib/skill-audit/load');
const { corpusDir } = require('./lib/skill-audit/context-cost');
const { readIntegrationBranch } = require('./lib/policy');
const { toPosix, escapeRegExp } = require('./lib/shared-primitives');

const USAGE = 'usage: load-delta.js [--plugin-root <dir>]... [--base <ref>] [--json] [--help]\n';

function parseArgs(argv) {
  const o = { pluginRoots: [], base: null, json: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') o.help = true;
    else if (a === '--json') o.json = true;
    else if (a === '--plugin-root' || a === '--base') {
      const v = argv[++i];
      if (v === undefined || v.startsWith('--')) return { error: `${a} needs a value` };
      if (a === '--base') o.base = v; else o.pluginRoots.push(v);
    } else return { error: `unknown argument: ${a}` };
  }
  return o;
}

function defaultGit(cwd) {
  return (args) => execFileSync('git', args, {
    cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, maxBuffer: 64 * 1024 * 1024,
  });
}

const realDeps = {
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
  cwd: process.cwd(),
};

const skillsPrefix = (root) => (root === '.' ? 'skills/' : `${root}/skills/`);
const SKILL_MD_UNDER = (root) => new RegExp(`^${escapeRegExp(skillsPrefix(root))}[^/]+/SKILL\\.md$`);

function headSide(repoRoot, root) {
  const readFile = (p) => {
    try { return fs.readFileSync(path.join(repoRoot, p), 'utf8'); } catch (err) {
      if (err.code === 'ENOENT' || err.code === 'EISDIR' || err.code === 'ENOTDIR') return null;
      throw err;
    }
  };
  const listSkillMds = () => {
    const dir = path.join(repoRoot, root, 'skills');
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && fs.existsSync(path.join(dir, d.name, 'SKILL.md')))
      .map((d) => `${skillsPrefix(root)}${d.name}/SKILL.md`);
  };
  return { readFile, listSkillMds };
}

function baseSide(git, sha, baseFiles, root) {
  const re = SKILL_MD_UNDER(root);
  return {
    // A path absent from the base tree is "did not exist at base" (null → 0
    // bytes), decided from the ls-tree set, never from a swallowed git error.
    readFile: (p) => (baseFiles.has(p) ? git(['show', '--end-of-options', `${sha}:${p}`]) : null),
    listSkillMds: () => [...baseFiles].filter((p) => re.test(p)),
  };
}

const fmt = (n) => n.toLocaleString('en-US');
const signed = (n) => (n > 0 ? `+${fmt(n)}` : fmt(n));

function renderText(result, changedFiles) {
  if (result.status === 'no-baseline') {
    return `Skill load delta: no baseline (merge-base with ${result.baseRef} unresolved) — skipped\n`;
  }
  const rows = result.roots.flatMap((r) => r.entries);
  if (rows.length === 0) {
    const touched = changedFiles.some((f) => result.roots.some((r) => f.startsWith(skillsPrefix(r.pluginRoot))));
    return touched
      ? 'Skill load delta: skill files changed, no entry point\'s load moved\n'
      : 'Skill load delta: no skill files changed — skipped\n';
  }
  const lines = [
    `Skill load delta (base ${result.base.slice(0, 7)}):`,
    '',
    '| Entry | Floor | ΔFloor | Closure | ΔClosure | New unresolved |',
    '|---|---|---|---|---|---|',
  ];
  for (const r of rows) {
    const mark = r.added ? ' (added)' : r.removed ? ' (removed)' : '';
    const miss = r.newUnresolved.length
      ? `${r.newUnresolved.length}: ${r.newUnresolved.slice(0, 3).map((u) => `\`${u.token}\``).join(', ')}${r.newUnresolved.length > 3 ? ', …' : ''}`
      : '—';
    lines.push(`| ${r.entry}${mark} | ${fmt(r.floor)} | ${signed(r.dFloor)} | ${fmt(r.closure)} | ${signed(r.dClosure)} | ${miss} |`);
  }
  return `${lines.join('\n')}\n`;
}

function run(argv, deps = realDeps) {
  const o = parseArgs(argv);
  if (o.error) { deps.stderr(`load-delta.js: ${o.error}\n${USAGE}`); return 2; }
  if (o.help) { deps.stdout(USAGE); return 0; }
  const cwd = deps.cwd || process.cwd();
  const rawGit = deps.git || defaultGit(cwd);
  const readBranch = deps.readIntegrationBranch || readIntegrationBranch;
  try {
    let repoRoot;
    try { repoRoot = rawGit(['-C', cwd, 'rev-parse', '--show-toplevel']).trim(); } catch {
      deps.stderr('load-delta.js: not inside a git work tree\n'); return 2;
    }
    const git = (args) => rawGit(['-C', repoRoot, ...args]);

    let roots;
    if (o.pluginRoots.length) {
      roots = [];
      for (const r of o.pluginRoots) {
        const abs = path.resolve(cwd, r);
        try { corpusDir(abs); } catch (err) { deps.stderr(`load-delta.js: ${err.message}\n`); return 3; }
        // realpath: git prints the resolved toplevel, so a symlinked cwd
        // (macOS /var -> /private/var) must be resolved before comparing.
        const rel = toPosix(path.relative(repoRoot, fs.realpathSync(abs))) || '.';
        if (rel.startsWith('..') || path.isAbsolute(rel)) { deps.stderr(`load-delta.js: --plugin-root ${r} is outside the repository\n`); return 2; }
        roots.push(rel);
      }
      roots = [...new Set(roots)].sort();
    } else {
      const listed = git(['ls-files', '--', ':(glob)skills/*/SKILL.md', ':(glob)*/skills/*/SKILL.md']);
      roots = discoverPluginRoots(() => listed.split('\n').filter(Boolean));
    }

    let base = null;
    let baseRef;
    if (o.base) {
      baseRef = o.base;
      try { base = git(['rev-parse', '--verify', '--quiet', '--end-of-options', `${o.base}^{commit}`]).trim(); } catch { base = ''; }
      if (!base) { deps.stderr(`load-delta.js: --base ${o.base} does not resolve to a commit\n`); return 2; }
    } else {
      let branch = readBranch(repoRoot);
      if (!branch) {
        try { branch = git(['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD']).trim().replace(/^origin\//, ''); } catch { branch = ''; }
      }
      baseRef = `origin/${branch || 'main'}`;
      try { base = git(['merge-base', 'HEAD', baseRef]).trim() || null; } catch { base = null; }
    }

    const heads = roots.map((root) => ({ root, rows: entryPointLoads(root, headSide(repoRoot, root)) }));
    let result;
    let changedFiles = [];
    if (!base) {
      result = { status: 'no-baseline', base: null, baseRef, roots: heads.map((h) => ({ pluginRoot: h.root, entries: h.rows })) };
    } else {
      const baseFiles = new Set(git(['ls-tree', '-r', '--name-only', '--full-tree', base]).split('\n').filter(Boolean));
      result = {
        status: 'ok',
        base,
        roots: heads.map((h) => ({
          pluginRoot: h.root,
          entries: loadDelta(entryPointLoads(h.root, baseSide(git, base, baseFiles, h.root)), h.rows),
        })),
      };
      changedFiles = git(['diff', '--name-only', '--end-of-options', base]).split('\n').filter(Boolean);
    }
    if (o.json) {
      const { baseRef: _omit, ...json } = result;
      deps.stdout(`${JSON.stringify(json)}\n`);
    } else {
      deps.stdout(renderText(result, changedFiles));
    }
    return 0;
  } catch (err) {
    deps.stderr(`load-delta.js: ${(err && err.message) || err}\n`);
    return 1;
  }
}

module.exports = { run, parseArgs, renderText };

if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/load-delta-cli.test.js tests/bin-lib/skill-audit/load.test.js`
Expected: PASS

- [ ] **Step 5: Real-input probe with an independent count**

Run from the worktree root:

```bash
node plugin/bin/load-delta.js --json --base HEAD | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);console.log(j.status, j.roots.map(r=>r.pluginRoot+':'+r.entries.length).join(' '))})"
```

Expected: `ok .claude:0 plugin:0` (base = HEAD with a clean tree, so no entry moved). Then the independent count — the floor of `plugin:flow` must equal `measuredBytes` of the file:

```bash
node -e "const {entryPointLoads}=require('./plugin/bin/lib/skill-audit/load');const fs=require('fs');const {measuredBytes}=require('./plugin/bin/lib/skill-audit/context-cost');const rows=entryPointLoads('plugin',{readFile:p=>{try{return fs.readFileSync(p,'utf8')}catch{return null}},listSkillMds:()=>fs.readdirSync('plugin/skills').filter(d=>fs.existsSync('plugin/skills/'+d+'/SKILL.md')).map(d=>'plugin/skills/'+d+'/SKILL.md')});const f=rows.find(r=>r.entry==='plugin:flow');console.log(f.floor, measuredBytes('plugin/skills/flow/SKILL.md').bytes, f.files.length, f.closure, f.unresolved.length)"
```

Expected: the first two numbers are equal. Record all five numbers in the task report (closure size and unresolved count for `plugin:flow` are the real-corpus baseline the reviewer checks for plausibility: closure > floor, files > 1).

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/load-delta.js tests/load-delta-cli.test.js
git commit -m "Add load-delta.js CLI — floor/closure delta against the merge-base, JSON or one rendered outcome (refs #3307)" -m "Claude-Session: https://claude.ai/code/session_01QCX4onFvfDc9rsSUN52717"
```

### Task 6: Review step 3j, summary template, and docs

**Files:**
- Create: `plugin/skills/review/step3-skill-load-delta.md`
- Modify: `plugin/skills/review/code-mode-steps.md` (insert after the `### 3i: Documentation Freshness (informational)` section, before `### Step 3.5 & 3.6`)
- Modify: `plugin/skills/review/review-summary-template.md` (compact form `:16-19`; full template after `### Code Simplification`, `:151-152`)
- Modify: `docs/plugin-structure.md:23`, `:91`, `:129`
- Test: `tests/load-delta-cli.test.js` (append)

**Interfaces:**
- Consumes: the CLI's text outcomes (Task 5), verbatim.

- [ ] **Step 1: Write the failing test**

Append to `tests/load-delta-cli.test.js`:

```js
const REVIEW = path.join(REPO, 'plugin', 'skills', 'review');

test('review 3j pointer: at most 4 lines, cites step3-skill-load-delta.md', () => {
  const text = fs.readFileSync(path.join(REVIEW, 'code-mode-steps.md'), 'utf8');
  const start = text.indexOf('### 3j: Skill Load Delta (informational)');
  assert.ok(start !== -1, '3j heading missing');
  const end = text.indexOf('\n### ', start + 1);
  const block = text.slice(start, end).replace(/\n+$/, '');
  assert.ok(block.split('\n').length <= 4, `3j block is ${block.split('\n').length} lines`);
  assert.match(block, /`step3-skill-load-delta\.md`/);
  assert.ok(start > text.indexOf('### 3i: Documentation Freshness'), '3j must follow 3i');
});

test('step3-skill-load-delta.md quotes every outcome line the CLI prints, verbatim', () => {
  const doc = fs.readFileSync(path.join(REVIEW, 'step3-skill-load-delta.md'), 'utf8');
  for (const line of [
    'Skill load delta: no skill files changed — skipped',
    'Skill load delta: skill files changed, no entry point\'s load moved',
    '| Entry | Floor | ΔFloor | Closure | ΔClosure | New unresolved |',
    'Skill load delta: no baseline (',
    'Skill load delta: not run — ',
  ]) assert.ok(doc.includes(line), `missing: ${line}`);
  assert.match(doc, /\/bin\/load-delta\.js/);
  assert.match(doc, /never changes the verdict/i);
});

test('review summary template carries the Skill Load Delta section and a compact-form line', () => {
  const t = fs.readFileSync(path.join(REVIEW, 'review-summary-template.md'), 'utf8');
  const full = t.slice(t.indexOf('## Full template'));
  assert.match(full, /### Skill Load Delta\n/);
  const compact = t.slice(t.indexOf('## Compact form'), t.indexOf('## Full template'));
  assert.match(compact, /\*\*Skill load delta:\*\*/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/load-delta-cli.test.js`
Expected: FAIL with "3j heading missing"

- [ ] **Step 3: Write the prose**

Create `plugin/skills/review/step3-skill-load-delta.md` with exactly this content:

````markdown
# Step 3j — Skill Load Delta (informational)

Loaded by `code-mode-steps.md`'s 3j pointer. Shows how this diff moves each skill entry point's per-invocation load:

- **floor** — the `SKILL.md`'s own bytes, paid on every invocation;
- **closure** — the floor plus every file reachable from it by a backticked `.md` citation or a `compose-context.js` source, transitively, each file once: the upper bound one invocation can load.

3j never changes the verdict, never adds a finding, and never skips silently — every path below renders one line or one table. Parent #3305 chose visibility over a gate: a load that grew is information for the reviewer, not a failure.

## When it runs

Every code-mode review, at every `review-effort` tier and every ceremony profile — it is one read-only CLI call.

## Command

From the checkout under review:

- Branch scope (the default): `node "${CLAUDE_PLUGIN_ROOT}/bin/load-delta.js"` — the base is the merge-base of `HEAD` with `origin/{integration-branch}` (`_shared/integration-branch.md`'s policy rank, else `origin/HEAD`).
- `base:{ref}` scope: `node "${CLAUDE_PLUGIN_ROOT}/bin/load-delta.js" --base {ref}`.

Plugin roots are discovered from the repository (every tracked `skills/*/SKILL.md` at the repo root or one directory down), so the same command covers this plugin's own corpus and a project's `.claude/skills/`.

## Render

Paste the CLI's output, verbatim, under the summary's `### Skill Load Delta` section (`review-summary-template.md`). It is exactly one of:

1. `Skill load delta: no skill files changed — skipped` — the diff touches nothing under any plugin root's `skills/`.
2. `Skill load delta: skill files changed, no entry point's load moved` — skill files changed, but none is in any entry point's closure (or the changes cancel out).
3. A table, headed `Skill load delta (base {sha}):`, with the columns `| Entry | Floor | ΔFloor | Closure | ΔClosure | New unresolved |` — one row per entry point whose floor or closure changed; `(added)`/`(removed)` mark entry points new at head or deleted.

Reading the table:

- A split that only moves text shows floor down and closure roughly unchanged (up by the pointer line) — a move, not a cut.
- A change to a `_shared/*.md` file shows on every entry point whose closure contains it.
- **New unresolved** lists backticked `.md` tokens the citation grammar could not resolve that were not unresolved at the base. Not an error — but if the reader really loads that file, its bytes are missing from the closure.

## Degrades

- `Skill load delta: no baseline (merge-base with {ref} unresolved) — skipped` — the CLI could not find the base (no `origin/{integration-branch}` ref in this checkout). Render the line as printed.
- The CLI exits non-zero (2 malformed invocation, 3 not a plugin root, 1 unexpected error): render `Skill load delta: not run — {first line of its stderr}`.
````

In `plugin/skills/review/code-mode-steps.md`, insert immediately before the line `### Step 3.5 & 3.6: Cross-Lens Debate, Per-Candidate Refutation, and Gap-Sweep` (so it follows the 3i section and its trailing blank line):

```markdown
### 3j: Skill Load Delta (informational)

Read `step3-skill-load-delta.md` in this skill's directory and run it on every code-mode review: one read-only CLI call reporting each skill entry point's floor and closure delta. It never changes the verdict and never skips silently.

```

In `plugin/skills/review/review-summary-template.md`:

- Compact form: after the `**Status:** …` line inside the compact block, add the line
  `{only when 3j printed a table:} **Skill load delta:** {N} entry point(s) moved — largest ΔClosure {signed bytes} on {entry}`
  and, in the bullet list above the block, append this sentence to the end of the "Zero findings in every category …" bullet: ` A non-empty skill load delta (3j) is informational and does not disqualify the compact form.`
- Full template: after the `### Code Simplification` section's bullet line, add:

```markdown

### Skill Load Delta
{3j's output, verbatim — one outcome line or the table (`step3-skill-load-delta.md`)}
```

In `docs/plugin-structure.md`:

- Line 23 (`plugin/bin/lib/skill-audit/` description): append ` \`load.js\` is the per-invocation load model (#3307) — floor/closure per \`SKILL.md\` entry point, \`loadDelta\` between two trees — read by \`load-delta.js\`.` before the line's end.
- Line 91 (the `| review |` sub-file row): add `, step3-skill-load-delta.md` after `step3-debate-and-refutation.md` in the second column.
- After line 129 (`context-cost-report.js`), add:
  `node plugin/bin/load-delta.js [--plugin-root <dir>]... [--base <ref>] [--json] [--help]   # Load-delta CLI (#3307) — thin wrapper over \`skill-audit/load.js\`: each skill entry point's floor and closure at the merge-base with \`origin/{integration-branch}\` vs the working tree; default roots are every tracked \`skills/*/SKILL.md\` at the repo root or one directory down. Prints one rendered outcome (review step 3j pastes it) or \`--json\`. Exit 0 (including \`no-baseline\`), 2 malformed or unresolvable \`--base\`, 3 a root with no \`skills/\`.`

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/load-delta-cli.test.js tests/ceremony-profile-roster.test.js tests/skill-catalog-completeness.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/review/step3-skill-load-delta.md plugin/skills/review/code-mode-steps.md plugin/skills/review/review-summary-template.md docs/plugin-structure.md tests/load-delta-cli.test.js
git commit -m "Add review step 3j skill load delta — informational floor/closure table in the review summary (refs #3307)" -m "Claude-Session: https://claude.ai/code/session_01QCX4onFvfDc9rsSUN52717"
```

---

The full suite runs centrally at `/claude-tweaks:build` Common Step 5, not inside a task. A lone `tests/bin-lib/gif/palette.test.js` wall-clock failure there is the pre-existing load flake in `docs/plans/2026-10-17-skill-size-limits-ledger.md` row 3 _(ledger deleted at the series close-out in PR #3433)_.

**Plan self-check (authoring time, 2026-10-17).** The inlined Task 1-5 code was assembled in a scratch copy of `plugin/` and the inlined tests run against it: `load.test.js` 25/25 pass, `load-delta-cli.test.js` 11/11 pass (AC12 run against this worktree, ~15 s). Real-corpus probe (scratch build, working tree at 06bce586): `plugin:flow` floor 43,199 = `measuredBytes` 43,199, closure 1,896,658 B over 143 files, 1,459 unresolved tokens; `plugin:review` floor 13,401 = 13,401, closure 1,450,635 B / 110 files; `plugin:build` floor 45,747 = 45,747, closure 1,746,147 B / 131 files; 39 entry points, floors summing to 985,540 B (spec: "39 `SKILL.md` files … ~960 KB"). The unresolved count is dominated by repo-relative `docs/…` tokens and `{placeholder}.md` tokens, which the grammar deliberately does not resolve; 3j shows only *new* unresolved tokens.

Self-review notes: AC1 → Task 2; AC2/3/4 → Task 3; AC5/6/7 → Task 4; AC8/9/12 → Task 5; AC10/11 → Task 6 (+ CLI text outcomes in Task 5); Deliverable `docs/plugin-structure.md` → Task 6.
