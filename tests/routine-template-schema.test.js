'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parseRoutineTemplate } = require('../plugin/bin/lib/routine-template-parser.js');
const { readText } = require('./helpers/read-skill');

const SKILLS_DIR = path.join(__dirname, '..', 'plugin', 'skills');
const CRON_RE = /^\S+\s+\S+\s+\S+\s+\S+\s+\S+$/;
const FORBIDDEN_KEYS = ['environment_id', 'repo_url', 'account', 'credentials', 'connector_uuid', 'url'];

function findTemplates() {
  return fs
    .readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => path.join(SKILLS_DIR, d.name, 'routine-template.yml'))
    .filter((p) => fs.existsSync(p));
}

test('at least one routine-template.yml exists to validate', () => {
  const templates = findTemplates();
  assert.ok(templates.length >= 1, 'expected at least one skills/*/routine-template.yml to exist');
});

test('specify/routine-template.yml is present in the scanned template set (#970)', () => {
  const templates = findTemplates();
  assert.ok(
    templates.some((p) => p.endsWith(path.join('specify', 'routine-template.yml'))),
    'expected plugin/skills/specify/routine-template.yml to be discovered by findTemplates() — a later glob/enumeration refactor must not silently drop it'
  );
});

for (const templatePath of findTemplates()) {
  const skillName = path.basename(path.dirname(templatePath));

  test(`${skillName}/routine-template.yml conforms to schema`, () => {
    const text = fs.readFileSync(templatePath, 'utf8');
    const tpl = parseRoutineTemplate(text);

    assert.equal(typeof tpl.template_version, 'number');
    assert.ok(
      Number.isInteger(tpl.template_version) && tpl.template_version >= 1,
      'template_version must be a positive integer'
    );

    assert.equal(typeof tpl.routine_name, 'string');
    assert.match(
      tpl.routine_name,
      /^[a-z0-9]+(-[a-z0-9]+)*$/,
      'routine_name must be a lowercase hyphenated slug (it becomes both a live routine name and a filename)'
    );

    // Since #529 a template carries no prompt text at all: the live prompt is
    // assembled at instantiation from the kernel in _shared/routine-template-schema.md
    // plus this one `kickoff` value. A template that still froze the kernel into
    // itself would be un-updatable without re-provisioning every routine.
    assert.equal(
      tpl.prompt,
      undefined,
      'templates no longer carry a prompt field — the kernel is assembled at instantiation (#529)'
    );
    assert.equal(typeof tpl.kickoff, 'string', 'kickoff is required');
    const kickoffFirst = tpl.kickoff.trim().split(/\s+/)[0];
    assert.equal(
      kickoffFirst,
      skillName,
      `kickoff's first token must equal the owning skill directory (got '${kickoffFirst}')`
    );
    assert.ok(
      !tpl.kickoff.includes('\n'),
      'kickoff is a single line — the whitespace-token grammar has no multi-line form'
    );
    assert.ok(
      !/\bBefore anything else\b/.test(text),
      'no template may contain kernel text'
    );
    assert.ok(
      !text.includes('{{TARGET_BRANCH}}'),
      'no template may contain the kernel placeholder'
    );

    // `branch` is a legal template field (a vendored, single-project template may
    // pin one) but must stay unset in the plugin-shipped copies — the same
    // portability rule that bans environment_id and repo URLs below.
    assert.equal(
      tpl.branch,
      undefined,
      'a plugin-shipped template must not pin `branch` — it ships to every project, and /claude-tweaks:routine resolves the branch per project'
    );

    assert.equal(typeof tpl.model, 'string');
    assert.ok(tpl.model.length > 0, 'model must be non-empty');

    assert.ok(Array.isArray(tpl.allowed_tools), 'allowed_tools must be an array');
    assert.ok(tpl.allowed_tools.length > 0, 'allowed_tools must not be empty');
    for (const t of tpl.allowed_tools) {
      assert.equal(typeof t, 'string');
      assert.ok(t.length > 0);
    }

    assert.ok(Array.isArray(tpl.mcp_connections), 'mcp_connections must be an array (may be empty)');

    assert.ok(
      tpl.default_schedule && typeof tpl.default_schedule === 'object',
      'default_schedule must be a nested map'
    );
    assert.equal(typeof tpl.default_schedule.cron_expression, 'string');
    assert.match(tpl.default_schedule.cron_expression, CRON_RE, 'cron_expression must be a 5-field cron string');
    assert.equal(typeof tpl.default_schedule.description, 'string');
    assert.ok(tpl.default_schedule.description.length > 0, 'default_schedule.description must be non-empty');

    for (const forbidden of FORBIDDEN_KEYS) {
      assert.equal(tpl[forbidden], undefined, `template must never contain account-specific field "${forbidden}"`);
      if (tpl.default_schedule) {
        assert.equal(
          tpl.default_schedule[forbidden],
          undefined,
          `default_schedule must never contain account-specific field "${forbidden}"`
        );
      }
    }
  });
}

// The kernel replaces the per-template preamble copies: one canonical block in
// _shared/routine-template-schema.md, assembled per firing. Nothing but these two
// tests notices when the block loses a part or its version line goes missing —
// and a kernel missing its branch-sync paragraph reaches every routine at once.
test('the schema declares an integer kernel_version adjacent to the kernel block', () => {
  const schema = readText(path.join(SKILLS_DIR, '_shared', 'routine-template-schema.md'));
  const m = schema.match(/^kernel_version: (\d+)$/m);
  assert.ok(m, 'kernel_version literal line missing');
  assert.ok(Number(m[1]) >= 1);
});

test('the kernel block carries its four parts in order', () => {
  const schema = readText(path.join(SKILLS_DIR, '_shared', 'routine-template-schema.md'));
  const section = schema.split('## Standard prompt kernel')[1];
  assert.ok(section, 'schema must carry a "## Standard prompt kernel" section');
  const rawBlock = section.split('```')[1];
  assert.ok(rawBlock, 'the kernel section must carry a fenced block');
  // The kernel is hard-wrapped prose, so a pinned phrase can straddle a line break
  // (the resolved-build format string does). Match against a whitespace-collapsed
  // copy: this pin is about which parts are present and in what order, never about
  // where the block happens to wrap.
  const block = rawBlock.replace(/\s+/g, ' ');
  const posBranch = block.indexOf('git merge --ff-only');
  const posLadder = block.indexOf('cache-scan-highest-of-N');
  // The empty-cache self-heal is the [IL-117] mitigation: without an anchor here,
  // deleting the whole paragraph would leave this test green while its name still
  // promised four parts.
  const posSelfHeal = block.indexOf('bash scripts/claude-cloud-setup.sh');
  const posFallback = block.indexOf('follow its instructions directly as written');
  const posClosing = block.indexOf('Then: /claude-tweaks:routine-kickoff {kickoff}');
  assert.ok(
    posBranch > -1 && posLadder > posBranch && posSelfHeal > posLadder && posFallback > posSelfHeal && posClosing > posFallback,
    `kernel parts out of order: branch-sync@${posBranch} ladder@${posLadder} self-heal@${posSelfHeal} fallback@${posFallback} closing@${posClosing}`);
  assert.ok(block.includes('{{TARGET_BRANCH}}'));
  assert.ok(block.includes('If it has diverged rather than just fallen behind, stop'));
  assert.ok(block.includes('claude-tweaks v{version} @ {path} (resolved via:'));
});

// AC4: the parameterless (as-shipped) template's kickoff must stay
// byte-identical — no `focus=` argument — so today's generalist routine
// keeps firing exactly as it does now while the `focus` field exists in the
// schema. What actually varies with focus's presence/absence is the kickoff
// value's argument, nothing else.
test('code-health/routine-template.yml: parameterless template has no focus field and its kickoff carries no focus= argument (AC4/IL-115 regression pin)', () => {
  const templatePath = path.join(SKILLS_DIR, 'code-health', 'routine-template.yml');
  const tpl = parseRoutineTemplate(readText(templatePath));
  assert.equal(
    tpl.focus,
    undefined,
    'the shipped generalist template must not set focus — presence would change which routine this template instantiates',
  );
  assert.equal(
    tpl.kickoff,
    'code-health',
    "the parameterless template's kickoff must stay exactly this — no focus= suffix",
  );
});

test('instantiated record schema documents webhook_triggers as an optional field', () => {
  const schema = readText(path.join(SKILLS_DIR, '_shared', 'routine-template-schema.md'));
  assert.match(schema, /\|\s*`webhook_triggers`\s*\|\s*array of objects\s*\|\s*no\s*\|/);
  assert.match(schema, /webhook_trigger_id/);
  assert.match(schema, /RemoteTrigger.*create_webhook_trigger|create_webhook_trigger.*RemoteTrigger/);
});
