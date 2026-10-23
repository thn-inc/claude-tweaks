'use strict';
// #2876: this repo's own committed agent-trust-scope posture under autonomy: unattended.
// registry-access and credential-scope are closed by permissions.deny in .claude/settings.json;
// network-egress is an accepted risk recorded in docs/decisions/0022-*.md, so it must still be
// reported — a narrow rule that silences it without bounding egress is what this guards against.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { scanAgentTrustScope } = require('../plugin/bin/lib/code-health/candidates-agent-trust-scope.js');
const { readText } = require('./helpers/read-skill');

const ROOT = path.join(__dirname, '..');
const settings = JSON.parse(fs.readFileSync(path.join(ROOT, '.claude', 'settings.json'), 'utf8'));
const autonomy = (readText(path.join(ROOT, '.claude-tweaks', 'policy.yml')).match(/^autonomy:\s*["']?([a-z-]+)["']?\s*$/m) || [])[1];

function kindsOf(dir) {
  return scanAgentTrustScope(dir).candidates.map((c) => c.kind);
}

// Scans a copy of the committed settings under a forced `autonomy: unattended`, so the check
// holds whatever this repo's own autonomy is (the generator reports nothing when it isn't elevated).
test('the committed deny list closes registry-access and credential-scope', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-trust-scope-fixture-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, '.claude-tweaks'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.claude-tweaks', 'policy.yml'), 'autonomy: unattended\n');
  fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
  fs.copyFileSync(path.join(ROOT, '.claude', 'settings.json'), path.join(dir, '.claude', 'settings.json'));
  const kinds = kindsOf(dir);
  assert.ok(!kinds.includes('registry-access'), `registry-access still reported: ${kinds}`);
  assert.ok(!kinds.includes('credential-scope'), `credential-scope still reported: ${kinds}`);
});

test('network-egress stays reported while autonomy is elevated (accepted risk, ADR 0022)', (t) => {
  if (autonomy !== 'unattended' && autonomy !== 'trusted') {
    t.skip('autonomy is not elevated — the generator reports nothing');
    return;
  }
  assert.ok(kindsOf(ROOT).includes('network-egress'), 'network-egress silenced — a deny rule now hides an accepted risk ADR 0022 says stays visible');
});

test('ADR 0022 records the network-egress accepted risk and the uses that need it', () => {
  const dir = path.join(ROOT, 'docs', 'decisions');
  const file = fs.readdirSync(dir).find((f) => /^0022-.*\.md$/.test(f));
  assert.ok(file, 'docs/decisions/0022-*.md missing');
  const text = readText(path.join(dir, file));
  for (const needle of ['network-egress', 'WebFetch', '/claude-tweaks:research', 'curl', '**Status:** accepted']) {
    assert.ok(text.includes(needle), `ADR 0022 does not mention ${needle}`);
  }
});

test('the deny list keeps the existing allow entry, plugin wiring, and WebFetch', () => {
  assert.ok(settings.permissions.allow.includes('Read(node_modules/**)'));
  assert.ok(settings.enabledPlugins && settings.enabledPlugins['claude-tweaks@claude-tweaks-marketplace'] === true);
  assert.ok(settings.extraKnownMarketplaces && settings.extraKnownMarketplaces['claude-tweaks-marketplace']);
  assert.ok(!settings.permissions.deny.some((r) => /^WebFetch(\(|$)/.test(r)), 'WebFetch must not be denied while /research needs it');
});
