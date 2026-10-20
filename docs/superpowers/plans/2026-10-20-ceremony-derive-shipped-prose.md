# Ceremony Derivation: Shipped Prompt Prose Is Production — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop `computeDiffFacts` from counting shipped skill/agent/command prompt prose as docs, so a diff that changes it no longer derives a `fast-lane` wrap-up.

**Architecture:** `isDocsPath` in `plugin/bin/lib/dispatch/ceremony-derive.js` currently matches every `*.md`. Add an `isPromptProsePath` predicate — markdown under a Claude Code component directory (`skills/`, `agents/`, `commands/`) at any path prefix — and exclude it from `isDocsPath`, so such files fall into `implFiles`. Project-agnostic by construction (keys on Claude Code's own directory conventions, not this repo's `plugin/` layout), so no policy key. Record the decision in the module and in `wrap-up/ceremony-derivation.md`, and keep `build/micro-plan.md`'s restatement of the exclusion accurate.

**Tech Stack:** Node 18+, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-10-19T220736-record-3477/work/3477-spec.md`

Scope keywords: isDocsPath, computeDiffFacts

## Global Constraints

- A `docs/**/*.md`-only diff must still derive `fast-lane` (AC2.1).
- `npm test` passes (AC3.1).
- Misclassification must only ever err toward production (more ceremony), never toward docs.

## Review Focus

- `.claude/skills/**/*.md` (a project's own harness skills): classified as prompt prose (production) — pinned in Task 1.
- A materialized `.claude-tweaks/pipelines/{run}/work/{n}-spec.md`: must stay docs — the #1545 evidence test (`EVIDENCE_DIFF`) already pins it; must stay green.
- Uppercase/mixed-case extension (`SKILL.MD`): handled by the `i` flag, same as today's `isDocsPath`.
- A path whose basename merely contains the word (`docs/skill-authoring.md`, `docs/agents.md`): stays docs — the directory segment must be followed by `/`. Pinned in Task 1.
- Consumers of `implFiles`: `resolve-profile.js`'s diff-ceiling (`plugin/bin/lib/model-profiles/profiles.js`, `implFiles <= 1`) now sees prose files as impl — strictly more conservative (fewer Standard caps), the safe direction; no code change needed there.

Consumer enumeration (`git grep -n "computeDiffFacts\|isDocsPath" -- plugin tests`): `plugin/skills/wrap-up/ceremony-derivation.md` (the derivation), `plugin/skills/build/dispatch.md` (diff-facts for `resolve-profile.js --diff-facts`), `plugin/skills/build/micro-plan.md` (prose restatement of the exclusion — updated in Task 2), `tests/build-micro-plan-conformance.test.js` (uses `plugin/bin/lib/dream/scan.js` + a test path — no `.md`, unaffected), `tests/ceremony-derivation-mode-gate.test.js` (`shouldDerive`/`deriveCeremonyProfile` — re-run in Task 1). `isDocsPath` has no consumer outside its own module.

---

### Task 1: Classify prompt prose as production in `ceremony-derive.js`

**Files:**
- Modify: `plugin/bin/lib/dispatch/ceremony-derive.js`
- Test: `tests/bin-lib/dispatch/ceremony-derive.test.js`

**Interfaces:**
- Produces: `isPromptProsePath(path: string) -> boolean`, exported alongside the existing `{ computeDiffFacts, deriveCeremonyProfile, isDocsPath, shouldDerive }`. `isDocsPath(path)` keeps its signature; it now returns `false` for prompt-prose paths.

- [ ] **Step 1: Write the failing tests** (append to `tests/bin-lib/dispatch/ceremony-derive.test.js`; import `isPromptProsePath` and `isDocsPath` in the existing destructure)

```js
// #3477: shipped prompt prose (skills/agents/commands markdown) is production.
test('AC1.1: a plugin-prose diff (plugin/skills/test/qa-prompts.md + a test file) does not derive fast-lane', () => {
  const files = [
    { path: 'plugin/skills/test/qa-prompts.md', additions: 18, deletions: 1 },
    { path: 'tests/qa-prompts-step-origin.test.js', additions: 183, deletions: 0 },
  ];
  const facts = computeDiffFacts(files);
  assert.equal(facts.implFiles, 1);
  assert.equal(facts.lowSurface, false);
  assert.equal(deriveCeremonyProfile(files, 'standard'), 'standard');
});

test('AC2.1: a docs/**/*.md-only diff still derives fast-lane', () => {
  const files = [
    { path: 'docs/plugin-structure.md', additions: 5, deletions: 0 },
    { path: 'docs/reference/claude-quality-levers.md', additions: 3, deletions: 1 },
  ];
  assert.equal(computeDiffFacts(files).lowSurface, true);
  assert.equal(deriveCeremonyProfile(files, 'standard'), 'fast-lane');
});

test('isPromptProsePath: markdown under skills/, agents/, commands/ at any prefix is prompt prose', () => {
  for (const p of ['plugin/skills/test/qa-prompts.md', 'plugin/skills/_shared/work-record.md', 'plugin/agents/qa-agent.md',
    '.claude/skills/upstream-drift/SKILL.md', 'skills/foo/SKILL.md', '.claude/commands/ship.md', 'plugin/skills/foo/SKILL.MD']) {
    assert.equal(isPromptProsePath(p), true, p);
    assert.equal(isDocsPath(p), false, p);
  }
});

test('isPromptProsePath: other markdown stays docs, including basenames that merely contain the word', () => {
  for (const p of ['docs/skill-authoring.md', 'docs/agents.md', 'README.md', 'CLAUDE.md',
    '.claude-tweaks/pipelines/2026-08-26T000000-spec-1/work/1-spec.md', 'docs/superpowers/plans/2026-10-20-x.md']) {
    assert.equal(isPromptProsePath(p), false, p);
    assert.equal(isDocsPath(p), true, p);
  }
  assert.equal(isPromptProsePath('plugin/skills/foo/helper.js'), false, 'non-markdown is never prompt prose');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/dispatch/ceremony-derive.test.js`
Expected: FAIL — `isPromptProsePath is not a function` (the AC1.1 test also fails on `implFiles` 0 vs 1).

- [ ] **Step 3: Implement `isPromptProsePath(path) -> boolean` and narrow `isDocsPath`**

Regex: `/(^|\/)(skills|agents|commands)\/.+\.md$/i`. `isDocsPath` becomes `.md` AND NOT `isPromptProsePath`. Rewrite the comment above `isDocsPath` to record the decision: prompt prose is the shipped product of a plugin (this repo's CLAUDE.md Stack table: "Content | Markdown (SKILL.md files …)") or a project's own harness, so it counts as production for the low-surface gate; project-agnostic because it keys on Claude Code's component-directory conventions, not on `plugin/`; erring toward production costs only a `standard` wrap-up. Cite #3477 and the run that exposed it (`2026-10-17T194130-record-3005`, #3005's four prose files plus one test derived `fast-lane`). Keep the existing note that a materialized `work/{n}-spec.md` stays docs. Add `isPromptProsePath` to `module.exports`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/dispatch/ceremony-derive.test.js tests/ceremony-derivation-mode-gate.test.js tests/build-micro-plan-conformance.test.js tests/console-resolve-conformance.test.js tests/diff-facts-parse-numstat-conformance.test.js`
Expected: PASS, 0 failures.

Plan-audit Check B consumers reviewed, no edit needed: `plugin/bin/lib/model-profiles/profiles.js` / `plugin/bin/resolve-profile.js` (read `implFiles`; prose now counting as impl only makes the diff-ceiling cap fire less — the safe direction), `plugin/skills/build/dispatch.md` ("at most one implementation file" stays accurate), `tests/diff-facts-parse-numstat-conformance.test.js` (input `src/a.js`, unaffected — run above), `docs/decisions/0017-*.md` and dated plan/journey/ledger files (history, not instructions).

- [ ] **Step 5: Prove the new tests discriminate**

Temporarily revert only `isDocsPath`'s body to `return /\.md$/i.test(path);` (keep the new export), run `node --test tests/bin-lib/dispatch/ceremony-derive.test.js`, confirm AC1.1 and both `isPromptProsePath`-paired `isDocsPath` assertions go red while AC2.1 stays green; restore the change and re-run green.

- [ ] **Step 6: Real-input probe (#3005's actual diff)**

Run: `git show --numstat --format= 9f164ed46 | node -e "const { parseNumstat } = require('./plugin/bin/lib/blast-radius-cli.js'); const { computeDiffFacts } = require('./plugin/bin/lib/dispatch/ceremony-derive.js'); console.log(JSON.stringify(computeDiffFacts(parseNumstat(require('fs').readFileSync(0, 'utf8')))))"`
Expected: `implFiles: 5` (independent count — `git show --numstat --format= 9f164ed46 | grep -cE '(^|/)(skills|agents)/'` prints 5: `.claude/skills/…/SKILL.md`, `plugin/agents/qa-agent.md`, three `plugin/skills/**` files), `lowSurface: false`. At base this diff gave `implFiles: 0`, `lowSurface: true`.

- [ ] **Step 7: Commit**

```bash
git add plugin/bin/lib/dispatch/ceremony-derive.js tests/bin-lib/dispatch/ceremony-derive.test.js
git commit -m "Classify shipped prompt prose as production in ceremony derivation — refs #3477"
```

### Task 2: Record the decision in the wrap-up and micro-plan prose

**Files:**
- Modify: `plugin/skills/wrap-up/ceremony-derivation.md` (4,477 B; RAIL_BYTES 52,500 — headroom ample)
- Modify: `plugin/skills/build/micro-plan.md:16-18` (6,786 B)

**Interfaces:**
- Consumes: Task 1's `isPromptProsePath` classification.

- [ ] **Step 1: Edit `ceremony-derivation.md` step 2**

Where step 2 says "any mix of test and/or docs files only", add one sentence: markdown under a `skills/`, `agents/`, or `commands/` directory at any prefix (`plugin/skills/**`, `plugin/agents/*.md`, `.claude/skills/**`) is prompt prose — the shipped product — and counts as a production file, not docs (`isPromptProsePath`, #3477); other markdown (`docs/**`, a materialized `work/{n}-spec.md`) stays docs.

- [ ] **Step 2: Edit `micro-plan.md` condition 3's parenthetical**

Change "or itself a `docs/**`/`*.md` path (the same test/docs exclusion …)" so the docs exclusion reads: a `*.md` path that is not prompt prose (markdown under `skills/`, `agents/`, or `commands/` counts as implementation) — keeping the existing citation of `computeDiffFacts`.

- [ ] **Step 3: Check prose pins**

Run: `git grep -n -F "any mix of test and/or docs files" -- tests plugin` and `git grep -n -F "same test/docs" -- tests plugin`
Expected: hits only in the two edited files (no test pins the edited sentences); if a test hit appears, run it and keep it green.

- [ ] **Step 4: Commit**

```bash
git add plugin/skills/wrap-up/ceremony-derivation.md plugin/skills/build/micro-plan.md
git commit -m "Document prompt-prose classification in wrap-up and micro-plan — refs #3477"
```

Full suite (AC3.1) runs centrally at /build Common Step 5, not in a task.
