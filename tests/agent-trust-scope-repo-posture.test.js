'use strict';
// #2876: this repo's own committed agent-trust-scope posture under autonomy: unattended.
// registry-access and credential-scope are closed by permissions.deny in .claude/settings.json;
// network-egress is an accepted risk recorded in docs/decisions/0022-*.md, so it must still be
// reported — a narrow rule that silences it without bounding egress is what this guards against.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { scanAgentTrustScope } = require('../plugin/bin/lib/code-health/candidates-agent-trust-scope.js');

const ROOT = path.join(__dirname, '..');
const settings = JSON.parse(fs.readFileSync(path.join(ROOT, '.claude', 'settings.json'), 'utf8'));
const autonomy = (fs.readFileSync(path.join(ROOT, '.claude-tweaks', 'policy.yml'), 'utf8').match(/^autonomy:\s*["']?([a-z-]+)/m) || [])[1];

test('the committed deny list closes registry-access and credential-scope', () => {
  const kinds = scanAgentTrustScope(ROOT).candidates.map((c) => c.kind);
  assert.ok(!kinds.includes('registry-access'), `registry-access still reported: ${kinds}`);
  assert.ok(!kinds.includes('credential-scope'), `credential-scope still reported: ${kinds}`);
});

test('network-egress stays reported while autonomy is elevated (accepted risk, ADR 0022)', () => {
  if (autonomy !== 'unattended' && autonomy !== 'trusted') return;
  const kinds = scanAgentTrustScope(ROOT).candidates.map((c) => c.kind);
  assert.ok(kinds.includes('network-egress'), 'network-egress silenced — a deny rule now hides an accepted risk ADR 0022 says stays visible');
});

test('ADR 0022 records the network-egress accepted risk and the uses that need it', () => {
  const dir = path.join(ROOT, 'docs', 'decisions');
  const file = fs.readdirSync(dir).find((f) => /^0022-.*\.md$/.test(f));
  assert.ok(file, 'docs/decisions/0022-*.md missing');
  const text = fs.readFileSync(path.join(dir, file), 'utf8');
  for (const needle of ['network-egress', 'WebFetch', '/claude-tweaks:research', 'curl', '**Status:** accepted']) {
    assert.ok(text.includes(needle), `ADR 0022 does not mention ${needle}`);
  }
});

test('the deny key is additive — allow, plugins, marketplaces and worktree are untouched', () => {
  assert.deepStrictEqual(settings.permissions.allow, ['Read(node_modules/**)']);
  assert.deepStrictEqual(settings.worktree, { baseRef: 'head' });
  assert.ok(settings.enabledPlugins && settings.enabledPlugins['claude-tweaks@claude-tweaks-marketplace'] === true);
  assert.ok(settings.extraKnownMarketplaces && settings.extraKnownMarketplaces['claude-tweaks-marketplace']);
  assert.ok(!settings.permissions.deny.some((r) => /^WebFetch(\(|$)/.test(r)), 'WebFetch must not be denied while /research needs it');
});
