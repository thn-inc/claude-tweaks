const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { readText } = require('../helpers/read-skill');

const REPO_ROOT = path.resolve(__dirname, '..', '..');

function readSkill(name, file = 'SKILL.md') {
  return readText(path.join(REPO_ROOT, 'plugin', 'skills', name, file));
}

function readSubfile(skill, filename) {
  return readText(path.join(REPO_ROOT, 'plugin', 'skills', skill, filename));
}

// These edges used to be asserted twice — once in /research's own Relationship
// table and once in each counterpart's. Both tables were removed in v6.33.0 and
// every edge now lives once in docs/skill-graph.md. The invariant is unchanged:
// these relationships stay recorded. Only their home moved.
function readGraph() {
  return readText(path.join(REPO_ROOT, 'docs', 'skill-graph.md'));
}

for (const skill of ['capture', 'challenge', 'specify', 'browse']) {
  test(`docs/skill-graph.md records the /research <-> /${skill} edge`, () => {
    const graph = readGraph();
    assert.match(graph, /research/, 'docs/skill-graph.md must mention /research');
    assert.ok(
      graph.includes(skill),
      `docs/skill-graph.md must record the edge between /research and /${skill}`,
    );
  });
}

test('/help reference card lists /research', () => {
  const body = readSubfile('help', 'reference-card.md');
  assert.match(body, /research/, '/help reference-card.md must mention /research');
});

// record #179 — sweep cross-references for /research's new (verify-mode) lifecycle position.

test('research/SKILL.md no longer claims no skill invokes it from a numbered Workflow step', () => {
  const body = readSkill('research');
  assert.doesNotMatch(
    body,
    /none of these invoke/i,
    'research/SKILL.md must not restate the stale "none of these invoke" claim — verify mode is now positioned before /superpowers:brainstorming',
  );
});

test('docs/skill-graph.md records the /research verify <-> /superpowers:brainstorming edge', () => {
  const graph = readGraph();
  assert.match(
    graph,
    /research verify.*brainstorming/is,
    'docs/skill-graph.md must record verify mode\'s position before /superpowers:brainstorming',
  );
});

test('skills/specify/ actually mentions /research (the specify<->research edge is wired, not aspirational)', () => {
  const specifyDir = path.join(REPO_ROOT, 'plugin', 'skills', 'specify');
  const files = fs.readdirSync(specifyDir).filter((f) => f.endsWith('.md'));
  const hit = files.some((f) => /research/i.test(readText(path.join(specifyDir, f))));
  assert.ok(hit, 'at least one file under skills/specify/ must mention /research — docs/skill-graph.md\'s specify<->research edge must be real, not aspirational');
});
