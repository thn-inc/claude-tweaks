# Harness Cost Agent Entries Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `estimateHarnessCost` (and so `bin/harness-cost-report.js` and harness-health's cost-efficiency check) report agent definitions' `tools:` scope alongside skills, as the docs already claim.

**Architecture:** `estimateHarnessCost` concatenates `measureAgentToolCost(repoRoot)` rows onto the skill rows, every row carrying a `kind: 'skill' | 'agent'` discriminator, then sorts the combined list by bytes descending as today. A new `totalAgents` summary field sits beside `totalSkills` (which keeps meaning skills only). The CLI passes the combined entries through `flagHighToolCount` unchanged, so a high-tool-count agent is flagged the same way a skill is.

**Tech Stack:** Node 18+, CommonJS, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-10-19T065835-record-2933/spec-2933/work/2933-spec.md`

**Scope keywords:** estimateHarnessCost, harness-cost-report, totalSkills

## Global Constraints

- `totalSkills` keeps meaning skills only — add a separate `totalAgents` count; never change `totalSkills`'s meaning.
- `unscopedCount` keeps meaning skills only (it is rendered as `{unscopedCount}/{totalSkills} skills unscoped`).
- Agent bytes are sized from the flat `agents/{name}.md` file via `measuredBytes(path.join(repoRoot, 'agents', `${name}.md`))` — never `path.join(dir, name, 'SKILL.md')`.
- Agent rows carry `sharedCitations: null` (citation depth is a skill-directory measurement).
- Existing skill-entry fields stay identical apart from the added `kind: 'skill'`.
- No `agents/` directory → zero agent entries, `totalAgents: 0`, no error.
- `plugin/skills/harness-health/SKILL.md` is 48,299 bytes against a ~51,200-byte ceiling (2,901 headroom, plan-audit `nearCeiling`): Task 2's prose edits there must add at most ~400 net bytes — reword in place, never append a new paragraph.
- Waived AC4.1: the full `npm test` run is `/claude-tweaks:build` Common Step 5's verification, not a task step.
- `MINIMAL_BASELINE_TOOLS` was calibrated as a skill baseline: state in the CLI header comment and harness-health prose that agents are measured against the same four-tool yardstick without that equivalence being validated.

## Review Focus

- An `agents/` directory holding a non-`.md` file or a subdirectory — must be ignored (already true in `measureAgentToolCost`; pinned by the no-crash expectation of the mixed fixture in Task 1).
- An agent named the same as a skill — both rows must survive, distinguished by `kind`.
- An agent with no `tools:` line — `toolCount: null`, never flagged, and NOT counted in `unscopedCount`.
- The real corpus: `qa-agent` must appear with `kind: 'agent'`, `toolCount: 1`.
- CLI output on a plugin root with no `agents/` — `totalAgents: 0`, exit 0.

---

### Task 1: estimateHarnessCost includes agent entries

**Files:**
- Modify: `plugin/bin/lib/skill-audit/harness-cost.js:115-133` (header comment on `estimateHarnessCost` + body)
- Test: `tests/bin-lib/skill-audit/harness-cost.test.js`

**Interfaces:**
- Produces: `estimateHarnessCost(repoRoot) -> { entries, totalSkills, totalAgents, unscopedCount }`; each entry `{ kind: 'skill'|'agent', name, bytes, tools, toolCount, overageRatio, sharedCitations }` (`sharedCitations: null` for agents).

- [ ] **Step 1: Write the failing tests** — add to `tests/bin-lib/skill-audit/harness-cost.test.js`, and adjust the two existing real-corpus tests that assume every entry is a skill:

```js
// existing 'estimateHarnessCost covers every shipped skill with a positive byte count' becomes:
const { entries, totalSkills } = estimateHarnessCost(REPO);
const skills = entries.filter((e) => e.kind === 'skill');
assert.strictEqual(skills.length, listSkillDirs(REPO).length);
assert.strictEqual(totalSkills, skills.length);
assert.ok(entries.every((e) => e.bytes > 0));

test('AC2.1: estimateHarnessCost includes the real shipped qa-agent as an agent entry', () => {
  const { entries, totalAgents } = estimateHarnessCost(REPO);
  const qa = entries.find((e) => e.kind === 'agent' && e.name === 'qa-agent');
  assert.ok(qa, 'expected an agent entry for plugin/agents/qa-agent.md');
  assert.deepStrictEqual(qa.tools, ['Bash']);
  assert.strictEqual(qa.toolCount, 1);
  assert.strictEqual(qa.sharedCitations, null);
  assert.strictEqual(totalAgents, measureAgentToolCost(REPO).length);
});

test('estimateHarnessCost: synthetic corpus with a skill and an agent of the same name keeps both, by kind', () => {
  // makeSkill(root,'dup',['allowed-tools: Read, Bash']); write agents/dup.md with 'tools: Bash, Read, Write'
  // plus agents/unscoped-agent.md with no tools: line, plus agents/notes.txt and agents/sub/ (ignored)
  // assert: kinds of the two 'dup' rows are ['agent','skill'] (sorted); totalSkills 1; totalAgents 2;
  // unscopedCount 0 (the unscoped agent is not counted); agent dup bytes === fs.statSync(agents/dup.md).size
});

test('AC3.1: estimateHarnessCost: no agents/ directory yields zero agent entries and no error', () => {
  const root = tmpRoot('no-agents-composite');
  makeSkill(root, 'only-skill', ['allowed-tools: Read']);
  const { entries, totalAgents, totalSkills } = estimateHarnessCost(root);
  assert.strictEqual(totalAgents, 0);
  assert.strictEqual(totalSkills, 1);
  assert.ok(entries.every((e) => e.kind === 'skill'));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/skill-audit/harness-cost.test.js`
Expected: FAIL — `qa` is undefined / `e.kind` is undefined / `totalAgents` is undefined.

- [ ] **Step 3: Implement** — in `estimateHarnessCost`, tag skill rows `kind: 'skill'`; map `measureAgentToolCost(repoRoot)` to `{ kind: 'agent', name, bytes: measuredBytes(path.join(repoRoot, 'agents', `${name}.md`)).bytes, tools, toolCount, overageRatio, sharedCitations: null }`; concatenate, sort by bytes descending; `unscopedCount` counts only `kind === 'skill' && toolCount === null`; return `{ entries, totalSkills, totalAgents, unscopedCount }`. Update the function's header comment (per-skill-and-agent composite; agents sized from the flat file; `totalSkills`/`unscopedCount` stay skill-only).

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/skill-audit/harness-cost.test.js`
Expected: PASS (all tests).

- [ ] **Step 5: Prove the agent-inclusion test goes red (AC2.2)** — temporarily remove the agent concatenation, re-run Step 4's command, confirm the qa-agent test fails, restore.

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/lib/skill-audit/harness-cost.js tests/bin-lib/skill-audit/harness-cost.test.js
git commit -m "Include agent definitions in estimateHarnessCost — kind discriminator and totalAgents, refs #2933"
```

### Task 2: CLI, harness-health prose, and docs report agents

**Files:**
- Modify: `plugin/bin/harness-cost-report.js:17-21` (header comment), `:60-62` (report shape)
- Modify: `plugin/skills/harness-health/SKILL.md:108-114` (cost-efficiency check prose) and `:213` (SUMMARIZE line)
- Modify: `docs/plugin-structure.md:23` and `:137`
- Test: `tests/harness-cost-report-cli.test.js`

**Interfaces:**
- Consumes: Task 1's `estimateHarnessCost` return shape.
- Produces: CLI stdout `{ totalSkills, totalAgents, unscopedCount, flagged, entries }`.

- [ ] **Step 1: Write the failing tests** in `tests/harness-cost-report-cli.test.js`:

```js
// extend the existing row-for-row test:
assert.strictEqual(report.totalAgents, expected.totalAgents);

test('AC1.1: --plugin-root <plugin/> output includes qa-agent marked as an agent', () => {
  // run(['--plugin-root', PLUGIN_ROOT]) → JSON; entry with name 'qa-agent' has kind 'agent'
});

test('a high-tool-count agent is flagged like a skill', () => {
  // tmp plugin root: skills/s/SKILL.md (allowed-tools: Read) + agents/wide.md (tools: 9 names)
  // run → report.flagged.map(e => `${e.kind}:${e.name}`) deepEqual ['agent:wide']; report.totalAgents 1
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/harness-cost-report-cli.test.js`
Expected: FAIL — `report.totalAgents` undefined.

- [ ] **Step 3: Implement** — destructure `totalAgents` and emit `{ totalSkills, totalAgents, unscopedCount, flagged, entries }`. Header comment: `entries` is every skill's AND agent definition's row (with `kind`), agents measured against the same four-tool baseline, which was calibrated as a skill baseline and not validated for agents.

- [ ] **Step 4: Update prose** — harness-health SKILL.md cost-efficiency paragraph: report covers skills' `allowed-tools:` and agent definitions' `tools:` (each entry carries `kind`), `totalAgents` count, `unscopedCount` is skills only, flagged can name an agent, same-baseline caveat. SUMMARIZE line: `tool scope: {unscopedCount}/{totalSkills} skills unscoped, {totalAgents} agents, flagged: {kind}:{name}={toolCount} tools, ...`. `docs/plugin-structure.md:23`: keep "(and each agent definition's `tools:`)" accurate — now reported by `estimateHarnessCost` with a `kind` field. `:137`: output shape `{totalSkills, totalAgents, unscopedCount, flagged, entries}`, every shipped skill's and agent definition's row.

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test tests/harness-cost-report-cli.test.js tests/bin-lib/skill-audit/harness-cost.test.js`
Expected: PASS.

- [ ] **Step 6: Acceptance check**

Run: `node plugin/bin/harness-cost-report.js --plugin-root plugin`
Expected: JSON containing `"kind":"agent","name":"qa-agent"` and `"totalAgents":1`.

- [ ] **Step 7: Commit**

```bash
git add plugin/bin/harness-cost-report.js plugin/skills/harness-health/SKILL.md docs/plugin-structure.md tests/harness-cost-report-cli.test.js
git commit -m "Report agent entries in harness-cost-report and harness-health — refs #2933"
```
