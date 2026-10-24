'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { readText } = require('./helpers/read-skill');

const ROOT = path.join(__dirname, '..');
const read = (rel) => readText(path.join(ROOT, rel));

// #2868: a sandbox can have `gh` present and authenticated via REST while its
// outbound proxy blocks GitHub's GraphQL API specifically, so every
// GraphQL-backed `gh` subcommand (including check 3's own `gh repo view`
// probe) fails with a 403 naming this exact signature. Before this branch
// existed, dispatch's Detection Ladder had no legal route forward for that
// case: it couldn't use the `gh` transport (check 3 hard-fails) and wasn't
// allowed to fall back to the already-built MCP transport (`gh` wasn't
// "absent"). Pin the exact signature string everywhere it's matched or
// documented, so a later rewording of any one copy doesn't silently diverge
// from the others.
const SIGNATURE = 'GitHub GraphQL is not available';

test('dispatch/SKILL.md Preflight documents the gh-present-but-GraphQL-blocked branch', () => {
  const skill = read('plugin/skills/dispatch/SKILL.md');
  const preflight = skill.slice(skill.indexOf('## Preflight'), skill.indexOf('## Workflow'));
  assert.match(preflight, /GraphQL-blocked/);
  assert.match(preflight, /mcp-transport\.md/);
  // A real failure (no signature match) must still read as a hard stop in this prose.
  assert.match(preflight, /any other check 3 failure (hard-stops|stays a hard stop)/);
});

test('mcp-transport.md documents the GraphQL-blocked branch: detection, non-matching-failure fail-closed, logging, and the code-twin note', () => {
  const t = read('plugin/skills/dispatch/mcp-transport.md');
  assert.match(t, /^## Preflight — the GraphQL-blocked branch \(#2868\)$/m);
  const section = t.slice(t.indexOf('## Preflight — the GraphQL-blocked branch'), t.indexOf('## Preflight — check 3 on the MCP transport'));
  assert.ok(section.includes(SIGNATURE), 'names the exact signature, not every non-zero exit');
  assert.match(section, /not every non-zero exit/);
  assert.match(section, /stays an\s*\n?\s*ordinary hard stop/);
  assert.match(section, /log-decision\.js/);
  assert.match(section, /--status AUTO/);
  assert.match(section, /mcpReachable/);
  assert.match(section, /detectIntegrationModel/);
  // Check 3's own MCP equivalent now explicitly covers both MCP-routed entries.
  const check3 = t.slice(t.indexOf('## Preflight — check 3 on the MCP transport'), t.indexOf('## Preflight — why check 2'));
  assert.match(check3, /gh.*absent, or.*gh.*present but GraphQL-blocked/);
});

test('forge-detection.md\'s check-3 row documents dispatch\'s GraphQL-blocked routing and that /help and /tidy are unchanged', () => {
  const t = read('plugin/skills/_shared/forge-detection.md');
  const row = t.split('\n').find((line) => /^\|\s*3\s*\|/.test(line));
  assert.ok(row, 'check-3 row exists');
  assert.ok(row.includes(SIGNATURE), 'check-3 row names the exact signature');
  assert.match(row, /dispatch\/mcp-transport\.md/);
  assert.match(row, /\/help.*\/tidy|\/tidy.*\/help/);
});
