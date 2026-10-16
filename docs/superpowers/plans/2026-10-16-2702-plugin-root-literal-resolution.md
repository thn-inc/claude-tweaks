# #2702 — One-shot literal resolution of CLAUDE_PLUGIN_ROOT / CLAUDE_CODE_SESSION_ID Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tell a worktree-session agent, in shipped prose, to resolve the plugin root and session id to literal values once and substitute them into every later command, so `${CLAUDE_PLUGIN_ROOT}`-templated snippets stop tripping the harness's runtime-variable refusal.

**Architecture:** One new paragraph in `plugin/skills/_shared/worktree-setup.md`'s `## Post-creation catch-up` section, placed immediately after the existing "harness's Bash-shape guard stays in effect" paragraph, citing `_shared/scratch-worktree.md` §7 (the refusal catalog) rather than restating it. One new `node --test` conformance suite pins the paragraph's content and placement. No hook code changes.

**Tech Stack:** Markdown skill prose; `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-10-16T173115-spec-2702-2727-2776/spec-2702/work/2702-spec.md`

## Global Constraints

- No file under `plugin/bin/lib/hooks/` changes (AC3) — the refusal is the Claude Code harness's guard, not `pre-tool-use.js` (verified: none of "too complex to verify", "computed at runtime", "cannot be shown not to be git" appears under `plugin/bin/`).
- Never hardcode an absolute plugin path, never prescribe a shell lookup ladder or a glob over plugin cache directories (`docs/skill-authoring.md` "Plugin-root references" rules; AC2).
- Keep writing the `${CLAUDE_PLUGIN_ROOT}` spelling in existing snippets — this change instructs substitution, it does not rewrite snippets.
- Byte budget: `_shared/worktree-setup.md` is 20,555 B; the composed `worktree-setup` bundle (build/SKILL.md:176) measures 42,970 B against the 51,200 B ceiling — this paragraph must stay under ~900 B. #2727 (same run) also adds to this file.
- Cite `_shared/scratch-worktree.md` §7, do not restate its refusal shapes.

## Review Focus

1. **Ordering vs. the catch-up's own "before anything else runs" clause** — the new step must not read as a command to run *before* the unconditional `git fetch`/`git merge`; phrase it as "the first time a later command needs either value". Pinned by the placement assertion in Task 1.
2. **Plugin-root derivation source** — must name the Skill tool's `Base directory for this skill:` line minus `skills/{name}`, matching `docs/skill-authoring.md`; a reader with no Skill invocation (manual read) needs the file's own grandparent — mirror `routine-kickoff/SKILL.md:29`'s fallback sentence. Pinned in Task 1.
3. **Session id** — `printenv CLAUDE_CODE_SESSION_ID` as one plain command (memory: plain `echo $VAR` is refused, `printenv VAR` passes). Pinned in Task 1.
4. **Subagent prompts** — a dispatching agent must substitute the literals into a subagent's prompt too (harness-health/SKILL.md already does this for `$FINDINGS_FILE`); one clause. Pinned in Task 1.
5. **Ladder/glob regression** — a later edit adding `find ~/.claude/plugins` style resolution would break AC2. Pinned by a negative assertion in Task 1.

---

### Task 1: Literal-resolution paragraph + conformance suite

**Files:**
- Modify: `plugin/skills/_shared/worktree-setup.md:109-117` (insert a new paragraph after the paragraph ending "`(docs/donts.md)`." and before "Unconditionally, before anything else runs in the new worktree")
- Create: `tests/worktree-setup-plugin-root-literal.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: the anchor string `**Resolve plugin-supplied values to literals once.**` — #2727's task (same run) inserts in a different section (`## Adopt-or-create`) and must not move this paragraph.

- [ ] **Step 1: Write the failing test**

Create `tests/worktree-setup-plugin-root-literal.test.js`:

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const { readText } = require('./helpers/read-skill');
// #2702: the "too complex to verify" / "value computed at runtime" refusals a
// worktree session hits on ${CLAUDE_PLUGIN_ROOT}/$CLAUDE_CODE_SESSION_ID
// snippets come from the Claude Code harness's own Bash guard, which the
// plugin cannot narrow. The plugin-side mitigation is shipped prose telling
// the agent to resolve both values to literals once and substitute them —
// the model-resolved-placeholder rule docs/skill-authoring.md states for
// maintainers, which never shipped to a runtime agent until now.

const ROOT = path.join(__dirname, '..');
const SETUP = readText(path.join(ROOT, 'plugin', 'skills', '_shared', 'worktree-setup.md'));
const ANCHOR = '**Resolve plugin-supplied values to literals once.**';

function catchupSection() {
  const start = SETUP.indexOf('## Post-creation catch-up');
  assert.notStrictEqual(start, -1, '## Post-creation catch-up heading missing');
  const end = SETUP.indexOf('\n## ', start + 1);
  return SETUP.slice(start, end === -1 ? undefined : end);
}

function paragraph() {
  const section = catchupSection();
  const at = section.indexOf(ANCHOR);
  assert.notStrictEqual(at, -1, 'literal-resolution paragraph missing from Post-creation catch-up');
  const end = section.indexOf('\n\n', at);
  return section.slice(at, end === -1 ? undefined : end);
}

test('worktree-setup.md: literal-resolution paragraph sits after the guard note, before the unconditional fetch', () => {
  const section = catchupSection();
  const guard = section.indexOf("harness's Bash-shape guard");
  const anchor = section.indexOf(ANCHOR);
  const fetch = section.indexOf('Unconditionally, before anything else runs');
  assert.ok(guard !== -1 && fetch !== -1, 'catch-up section lost its guard note or fetch anchor');
  assert.ok(guard < anchor && anchor < fetch, `expected guard(${guard}) < paragraph(${anchor}) < fetch(${fetch})`);
});

test('worktree-setup.md: names both values and how each resolves', () => {
  const p = paragraph();
  assert.match(p, /CLAUDE_PLUGIN_ROOT/, 'must name CLAUDE_PLUGIN_ROOT');
  assert.match(p, /CLAUDE_CODE_SESSION_ID/, 'must name CLAUDE_CODE_SESSION_ID');
  assert.match(p, /Base directory for this skill:/, 'plugin root derives from the Skill tool line');
  assert.match(p, /skills\/\{name\}/, 'must say to drop the trailing skills/{name} segment');
  assert.match(p, /grandparent/i, 'must give the no-Skill-invocation fallback (the read file\'s grandparent)');
  assert.match(p, /printenv CLAUDE_CODE_SESSION_ID/, 'session id resolves via one plain printenv call');
});

test('worktree-setup.md: says to substitute literally, everywhere, including subagent prompts', () => {
  const p = paragraph();
  assert.match(p, /literal/i, 'must say literal substitution');
  assert.match(p, /every later command/i, 'must cover every later command, not just the next one');
  assert.match(p, /subagent/i, 'must extend to prompts handed to subagents');
  assert.match(p, /first time a later command needs/i, 'must not read as a step to run before the unconditional fetch');
  assert.match(p, /scratch-worktree\.md/, 'must cite the §7 refusal catalog, not restate it');
});

test('worktree-setup.md: prescribes no lookup ladder or cache glob', () => {
  const p = paragraph();
  assert.doesNotMatch(p, /\bfind\b|\bls\s+~|plugins\/cache|\*\*?\//, 'no shell lookup ladder or cache-directory glob (docs/skill-authoring.md Plugin-root references)');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/worktree-setup-plugin-root-literal.test.js`
Expected: FAIL with "literal-resolution paragraph missing from Post-creation catch-up" (the first test fails on `guard < anchor` with anchor -1)

- [ ] **Step 3: Write minimal implementation**

In `plugin/skills/_shared/worktree-setup.md`, immediately after the paragraph that ends ``use plain filesystem reads (`ls`, `cat`) against the main checkout's path instead (`docs/donts.md`).`` and before the line beginning `Unconditionally, before anything else runs in the new worktree`, insert (blank line before and after):

```markdown
**Resolve plugin-supplied values to literals once.** `CLAUDE_PLUGIN_ROOT` is not set in the Bash tool environment, and inside a worktree session the same guard refuses a command that passes `"${CLAUDE_PLUGIN_ROOT}"` or `"$CLAUDE_CODE_SESSION_ID"` as a runtime value (`_shared/scratch-worktree.md` §7's runtime-computed-variable entries). The first time a later command needs either value, resolve it once: the plugin root is the Skill tool's `Base directory for this skill:` line minus its trailing `skills/{name}` (no Skill invocation — the read file's own grandparent); the session id is one plain `printenv CLAUDE_CODE_SESSION_ID` call. Substitute both as literal paths/strings into every later command, and into any prompt handed to a subagent.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/worktree-setup-plugin-root-literal.test.js`
Expected: PASS (4 tests)

Then byte check: `wc -c plugin/skills/_shared/worktree-setup.md` — expect ≤ 21,500.

- [ ] **Step 5: Run the neighboring worktree-setup suites**

Run: `node --test tests/worktree-setup-catchup-no-run-dir.test.js tests/worktree-adopt-or-create-consolidation.test.js tests/worktree-headless-ahead-of-origin.test.js tests/worktree-post-creation-longpaths.test.js tests/bin-lib/skill-audit/context-cost.test.js`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add plugin/skills/_shared/worktree-setup.md tests/worktree-setup-plugin-root-literal.test.js
git commit -m "Document one-shot literal resolution of plugin root and session id — worktree-setup.md catch-up (refs #2702)"
```
