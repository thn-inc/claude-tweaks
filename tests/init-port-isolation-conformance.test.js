'use strict';
// Pins #1794's port-isolation /init step — a prose test per
// skill-prose-conformance-tests: each assertion pins a literal substring or
// ordering that would go red if the corresponding content were reverted.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

function read(relPath) {
  return fs.readFileSync(path.join(__dirname, '..', relPath), 'utf8');
}

// AC1
test('init/SKILL.md has a Step 6.5 heading between Step 6 and Step 7, citing the sub-file', () => {
  const skill = read('plugin/skills/init/SKILL.md');
  const step6 = skill.indexOf('### Step 6: Worktree Configuration');
  const step65 = skill.indexOf('### Step 6.5: Port Isolation');
  const step7 = skill.indexOf('### Step 7: Browser Integration');
  assert.ok(step6 !== -1 && step65 !== -1 && step7 !== -1, 'all three headings must exist');
  assert.ok(step6 < step65 && step65 < step7, 'Step 6.5 must sit between Step 6 and Step 7');
  const body = skill.slice(step65, step7);
  assert.ok(body.includes('bootstrap/step-06-5-port-isolation.md'), 'the Step 6.5 stub must cite its sub-file');
  assert.ok(body.split('\n').filter((l) => l.trim()).length <= 4, 'the stub must stay <=4 lines');
});

// AC1
test('the sub-file contains all six rewrite rows and the named report-only hard cases', () => {
  const sub = read('plugin/skills/init/bootstrap/step-06-5-port-isolation.md');
  const rewriteRows = [
    'vite.config',
    'vue.config',
    'app.listen',
    'target:',
    'docker-compose.yml',
    '.env.local',
  ];
  for (const needle of rewriteRows) {
    assert.ok(sub.includes(needle), `rewrite table missing a row mentioning "${needle}"`);
  }
  assert.match(sub, /package\.json.*scripts/s, 'missing the package.json shell-expansion hard case');
  assert.match(sub, /Windows `cmd`/, 'missing the named Windows cmd-shell limitation');
  assert.ok(sub.includes('angular.json'), 'missing the angular.json hard case');
  assert.match(sub, /README\/Makefile Python commands/, 'missing the README/Makefile Python hard case');
});

// AC2
test('the sub-file states the diff gate runs in every mode including auto, and a decline still writes port-services + allocates', () => {
  const sub = read('plugin/skills/init/bootstrap/step-06-5-port-isolation.md');
  assert.match(sub, /always shown, never silenced by `auto`/);
  assert.match(sub, /declined rewrite.*still sets `port-services`.*runs the first `allocate`/s);
});

// AC3
test('the port-services write is routed through the worktree-always deferred-write mechanism', () => {
  const sub = read('plugin/skills/init/bootstrap/step-06-5-port-isolation.md');
  assert.ok(sub.includes('worktree-policy-finalization.md'));
  assert.match(sub, /Step 6 carries its[\s\S]*worktree-always.*decision/);

  const finalization = read('plugin/skills/init/worktree-policy-finalization.md');
  assert.ok(finalization.includes('port-services'), 'worktree-policy-finalization.md must name port-services');
});

// AC4
test('step-04-gitignore-suggestions.md lists .env.local and .env', () => {
  const step4 = read('plugin/skills/init/bootstrap/step-04-gitignore-suggestions.md');
  assert.ok(step4.includes('.env.local'));
  assert.match(step4, /\r?\n\.env\r?\n/, '.env must be its own gitignore line');
});

// AC5
test('update-mode.md has the port-literal-drift row; skill-graph.md ## init has the two new rows; getting-started.md mentions port-services', () => {
  const updateMode = read('plugin/skills/init/update-mode.md');
  assert.match(updateMode, /[Pp]ort literal drift/);

  const skillGraph = read('docs/skill-graph.md');
  const initSection = skillGraph.slice(skillGraph.indexOf('## init'), skillGraph.indexOf('## journey-health'));
  assert.ok(initSection.includes('bin/ports.js'), '## init section missing the bin/ports.js row');
  assert.ok(initSection.includes('_shared/dev-url-detection.md'), '## init section missing the dev-url-detection.md row');

  const gettingStarted = read('docs/getting-started.md');
  assert.ok(gettingStarted.includes('port-services'));
});

// AC7: the documented allocate command line is byte-pinned and actually executes.
test('the allocate command line from the sub-file is executable end-to-end', () => {
  const sub = read('plugin/skills/init/bootstrap/step-06-5-port-isolation.md');
  const match = sub.match(/```bash\nnode "\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/ports\.js" allocate --services \{a,b,c\}\n```/);
  assert.ok(match, 'the documented allocate command line must be byte-pinned in a fenced code block');

  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-init-ports-home-'));
  const checkout = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-init-ports-checkout-'));
  const portsJs = path.resolve(__dirname, '..', 'plugin', 'bin', 'ports.js');
  const out = execFileSync('node', [portsJs, 'allocate', '--path', checkout, '--services', 'web,api,db'], {
    encoding: 'utf8',
    env: { ...process.env, HOME: home },
  });
  assert.match(out.trim(), /^\d+$/, `expected a bare base port on stdout, got: ${JSON.stringify(out)}`);
});

// AC8
test('the sub-file states every proposed rewrite is syntax-checked before being shown, with report-only fallback', () => {
  const sub = read('plugin/skills/init/bootstrap/step-06-5-port-isolation.md');
  assert.match(sub, /parse the REWRITTEN snippet/i);
  assert.match(sub, /fails to parse is downgraded to report-only/);
});

// AC9
test('auto-mode-contract.md names the Step 6.5 rewrite-diff gate in its HARD-GATE exemption table', () => {
  const contract = read('plugin/skills/_shared/auto-mode-contract.md');
  const tableStart = contract.indexOf('## What `auto` does NOT silence');
  assert.notEqual(tableStart, -1);
  const table = contract.slice(tableStart, tableStart + 6000);
  assert.match(table, /Step 6\.5/);
  assert.match(table, /port-rewrite diff gate/);
});
