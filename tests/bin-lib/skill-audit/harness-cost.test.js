'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  MINIMAL_BASELINE_TOOLS,
  parseToolListField,
  measureSkillToolCost,
  measureAgentToolCost,
  countSharedCitations,
  estimateHarnessCost,
  flagHighToolCount,
} = require('../../../plugin/bin/lib/skill-audit/harness-cost.js');
const { listSkillDirs, KNOWN_SKILLS } = require('../../../plugin/bin/lib/skill-audit/skill-catalog.js');

// The corpus root these measurements take is the plugin payload root — the one
// with `skills/` directly beneath it — which is `plugin/`, not the repo root.
const REPO = path.join(__dirname, '..', '..', '..', 'plugin');

function tmpRoot(slug) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `harness-cost-${slug}-`));
}

function makeSkill(root, name, frontmatterLines, body = 'body\n') {
  const skillDir = path.join(root, 'skills', name);
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(
    path.join(skillDir, 'SKILL.md'),
    `---\nname: ${name}\n${frontmatterLines.join('\n')}\n---\n${body}`,
  );
  return skillDir;
}

// ── parseToolListField: the single-line CSV frontmatter scalar shape
// (`allowed-tools:`/`tools:`), distinct from frontmatter-list.js's multi-line
// bullet-list shape (`files:`/`paths:`).

test('parseToolListField: parses a comma-separated scalar line', () => {
  const content = '---\nname: x\nallowed-tools: Read, Grep, Glob, Bash\n---\nbody\n';
  assert.deepStrictEqual(parseToolListField(content, 'allowed-tools'), ['Read', 'Grep', 'Glob', 'Bash']);
});

test('parseToolListField: returns null when the field is absent (implicitly unbounded)', () => {
  const content = '---\nname: x\ndescription: y\n---\nbody\n';
  assert.strictEqual(parseToolListField(content, 'allowed-tools'), null);
});

test('parseToolListField: returns [] for a present-but-empty value', () => {
  const content = '---\nname: x\nallowed-tools:\n---\nbody\n';
  assert.deepStrictEqual(parseToolListField(content, 'allowed-tools'), []);
});

test('parseToolListField: returns null with no frontmatter fence at all', () => {
  assert.strictEqual(parseToolListField('just a body, no fence\n', 'allowed-tools'), null);
});

test('parseToolListField: trims whitespace around each tool name', () => {
  const content = '---\nname: x\ntools:  Bash ,  Read\n---\nbody\n';
  assert.deepStrictEqual(parseToolListField(content, 'tools'), ['Bash', 'Read']);
});

// ── measureSkillToolCost: the real corpus's own `allowed-tools:` declarations.

test('measureSkillToolCost covers every shipped skill', () => {
  const costs = measureSkillToolCost(REPO);
  assert.strictEqual(costs.length, listSkillDirs(REPO).length);
  for (const known of KNOWN_SKILLS) {
    assert.ok(costs.some((c) => c.name === known), `measureSkillToolCost is missing known skill: ${known}`);
  }
});

test('measureSkillToolCost: a skill with no allowed-tools line is unscoped (toolCount null)', () => {
  const root = tmpRoot('unscoped');
  makeSkill(root, 'plain-skill', ['description: a skill with no tool scope']);
  const [entry] = measureSkillToolCost(root);
  assert.strictEqual(entry.name, 'plain-skill');
  assert.strictEqual(entry.tools, null);
  assert.strictEqual(entry.toolCount, null);
  assert.strictEqual(entry.overageRatio, null);
});

test('measureSkillToolCost: overageRatio is toolCount / baseline length', () => {
  const root = tmpRoot('scoped');
  makeSkill(root, 'scoped-skill', ['allowed-tools: Read, Grep, Glob, Bash, Skill, Write, AskUserQuestion']);
  const [entry] = measureSkillToolCost(root);
  assert.strictEqual(entry.toolCount, 7);
  assert.strictEqual(entry.overageRatio, 7 / MINIMAL_BASELINE_TOOLS.length);
});

// ── measureAgentToolCost: `agents/{name}.md`'s `tools:` field.

test('measureAgentToolCost: absent agents/ directory is an empty list, not an error', () => {
  const root = tmpRoot('no-agents');
  assert.deepStrictEqual(measureAgentToolCost(root), []);
});

test('measureAgentToolCost: reads tools: from an agent definition', () => {
  const root = tmpRoot('agents');
  const agentsDir = path.join(root, 'agents');
  fs.mkdirSync(agentsDir, { recursive: true });
  fs.writeFileSync(path.join(agentsDir, 'qa-agent.md'), '---\nname: qa-agent\ntools: Bash\n---\nbody\n');
  const [entry] = measureAgentToolCost(root);
  assert.strictEqual(entry.name, 'qa-agent');
  assert.deepStrictEqual(entry.tools, ['Bash']);
  assert.strictEqual(entry.toolCount, 1);
});

test('measureAgentToolCost finds the real shipped qa-agent', () => {
  const agents = measureAgentToolCost(REPO);
  assert.ok(agents.some((a) => a.name === 'qa-agent'), 'expected the shipped qa-agent.md to be found');
});

// ── countSharedCitations: distinct `_shared/*.md` references.

test('countSharedCitations: counts distinct _shared/*.md references across SKILL.md and sub-files', () => {
  const root = tmpRoot('citations');
  const skillDir = makeSkill(root, 'citing-skill', ['description: cites shared files'],
    'See `_shared/foo.md` and `_shared/bar.md`.\n');
  fs.writeFileSync(path.join(skillDir, 'extra.md'), 'Also see `_shared/foo.md` again and `_shared/baz.md`.\n');
  assert.strictEqual(countSharedCitations(root, 'citing-skill'), 3);
});

test('countSharedCitations: zero when the skill cites nothing', () => {
  const root = tmpRoot('no-citations');
  makeSkill(root, 'lonely-skill', ['description: no citations here']);
  assert.strictEqual(countSharedCitations(root, 'lonely-skill'), 0);
});

// ── estimateHarnessCost: the per-skill composite.

test('estimateHarnessCost covers every shipped skill with a positive byte count', () => {
  const { entries, totalSkills } = estimateHarnessCost(REPO);
  assert.strictEqual(entries.length, listSkillDirs(REPO).length);
  assert.strictEqual(totalSkills, entries.length);
  assert.ok(entries.every((e) => e.bytes > 0));
});

test('estimateHarnessCost: entries are sorted by bytes descending', () => {
  const { entries } = estimateHarnessCost(REPO);
  for (let i = 1; i < entries.length; i++) {
    assert.ok(entries[i - 1].bytes >= entries[i].bytes, 'entries should be sorted by bytes descending');
  }
});

test('estimateHarnessCost: unscopedCount matches the number of null-toolCount entries', () => {
  const { entries, unscopedCount } = estimateHarnessCost(REPO);
  const actual = entries.filter((e) => e.toolCount === null).length;
  assert.strictEqual(unscopedCount, actual);
});

test('estimateHarnessCost: on a synthetic corpus, scoped and unscoped skills report distinct toolCounts', () => {
  const root = tmpRoot('composite');
  makeSkill(root, 'scoped', ['allowed-tools: Read, Bash']);
  makeSkill(root, 'unscoped', ['description: no scope']);
  const { entries, unscopedCount } = estimateHarnessCost(root);
  const scoped = entries.find((e) => e.name === 'scoped');
  const unscoped = entries.find((e) => e.name === 'unscoped');
  assert.strictEqual(scoped.toolCount, 2);
  assert.strictEqual(unscoped.toolCount, null);
  assert.strictEqual(unscopedCount, 1);
});

// ── flagHighToolCount: never flags an unscoped (null) entry; only a declared
// count over the ratio threshold.

test('flagHighToolCount: flags a declared tool count more than 2x the baseline by default', () => {
  const entries = [
    { name: 'lean', toolCount: 3, overageRatio: 3 / MINIMAL_BASELINE_TOOLS.length },
    { name: 'rich', toolCount: 9, overageRatio: 9 / MINIMAL_BASELINE_TOOLS.length },
    { name: 'unscoped', toolCount: null, overageRatio: null },
  ];
  const flagged = flagHighToolCount(entries);
  assert.deepStrictEqual(flagged.map((e) => e.name), ['rich']);
});

test('flagHighToolCount: an unscoped entry is never flagged regardless of threshold', () => {
  const entries = [{ name: 'unscoped', toolCount: null, overageRatio: null }];
  assert.deepStrictEqual(flagHighToolCount(entries, { ratioThreshold: 0 }), []);
});

test('flagHighToolCount: custom ratioThreshold is honored', () => {
  const entries = [{ name: 'modest', toolCount: 5, overageRatio: 5 / MINIMAL_BASELINE_TOOLS.length }];
  assert.deepStrictEqual(flagHighToolCount(entries, { ratioThreshold: 2 }), []);
  assert.deepStrictEqual(flagHighToolCount(entries, { ratioThreshold: 1 }).map((e) => e.name), ['modest']);
});

// ── No shipped skill's explicit allowed-tools declaration is currently over
// budget — a descriptive snapshot, not a hard gate (the corpus majority
// carries no allowed-tools line at all, which this lens surfaces via
// unscopedCount rather than per-skill flags; see harness-cost.js's header).

test('no shipped skill with a declared allowed-tools line currently exceeds 2x the baseline', () => {
  const { entries } = estimateHarnessCost(REPO);
  const flagged = flagHighToolCount(entries);
  assert.deepStrictEqual(
    flagged.map((e) => `${e.name} (${e.toolCount} tools)`),
    [],
    'a skill crossing this threshold is not necessarily wrong, but should be a deliberate choice — '
      + 'review whether its allowed-tools list can be narrowed',
  );
});
