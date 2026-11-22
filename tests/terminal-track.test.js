'use strict';
// Pins #601's terminal track: the Surface enum lists `terminal` at every
// enumeration site, and the two new files exist within their stated budgets.
// The enum sites are prose, so these are content-anchored greps, not parsers --
// case-sensitive on the literal token lists the sites actually carry.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { readText } = require('./helpers/read-skill');
const ROOT = path.join(__dirname, '..');
const read = (...p) => readText(path.join(ROOT, ...p));

test('every Surface enumeration site lists terminal', () => {
  const sites = [
    ['plugin/skills/specify/spec-template.md', 'Surface: {web | mobile | desktop | backend | infra | terminal}'],
    ['plugin/skills/specify/SKILL.md', '--surface <web|mobile|desktop|backend|infra|terminal>'],
    ['plugin/skills/flow/materialize.md', 'surface: {web|mobile|desktop|backend|infra|terminal}'],
    ['plugin/skills/flow/materialize.md', 'Surface: {web | mobile | desktop | backend | infra | terminal}'],
    ['plugin/skills/help/reference-card.md', '<web\\|mobile\\|desktop\\|backend\\|infra\\|terminal>'],
  ];
  for (const [file, literal] of sites) {
    assert.ok(read(file).includes(literal), `${file} is missing the terminal-inclusive enum literal: ${literal}`);
  }
  // The retired five-value spellings must be gone everywhere under skills/.
  const fiveValue = /web \| mobile \| desktop \| backend \| infra}|web\|mobile\|desktop\|backend\|infra>|web\\\|mobile\\\|desktop\\\|backend\\\|infra>/;
  const offenders = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.md') && fiveValue.test(fs.readFileSync(p, 'utf8'))) offenders.push(path.relative(ROOT, p));
    }
  };
  walk(path.join(ROOT, 'plugin', 'skills'));
  assert.deepStrictEqual(offenders, [], `enum sites still carrying the five-value spelling: ${offenders.join(', ')}`);
});

test('terminal-ux.md exists and carries the six sections', () => {
  const p = path.join(ROOT, 'plugin', 'skills', '_shared', 'terminal-ux.md');
  assert.ok(fs.existsSync(p), 'skills/_shared/terminal-ux.md is missing');
  const md = readText(p);
  assert.strictEqual((md.match(/^## /gm) || []).length, 6, 'terminal-ux.md must carry exactly its six principle sections');
});

test('terminal-routing.md exists and names the honest-skip outcomes', () => {
  const md = read('plugin/skills/design-wrapper/terminal-routing.md');
  assert.match(md, /CLI detector is web-only/);
  assert.match(md, /upstream has no terminal track/);
  assert.match(md, /re-open this\ntable|re-open this table/, 'the revisit condition must be recorded');
});

test('build Common Step 1.7 routes surface: terminal to design-wrapper pre-build', () => {
  // Since #5605 the routing rule lives in the skill-load gate's pre-build rule, which Step 1.7 cites.
  const skill = read('plugin/skills/build/SKILL.md');
  assert.match(
    skill,
    /Common Step 1\.7[^\n]*\n\nGate per `_shared\/skill-load-gate\.md`: `--skill design-wrapper --mode pre-build`, `--surface`/,
    'Common Step 1.7 must gate pre-build on the skill-load gate with the record surface',
  );
  const { decide } = require('../plugin/bin/lib/skill-gate');
  const verdict = decide({ skill: 'design-wrapper', mode: 'pre-build', surface: 'terminal', designIntegration: 'enabled', files: { error: 'no diff' } });
  assert.equal(verdict.decision, 'proceed', 'the pre-build gate must route surface: terminal to /claude-tweaks:design-wrapper pre-build');

  const prebuild = read('plugin/skills/build/design-prebuild.md');
  assert.match(
    prebuild,
    /^## Terminal track$/m,
    'design-prebuild.md must carry a Terminal track section',
  );
  assert.match(
    prebuild,
    /_shared\/terminal-ux\.md/,
    'design-prebuild.md must name the terminal always-load set',
  );
});
