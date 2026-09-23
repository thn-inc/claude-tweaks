const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const {
  listSkills, extractDomainPaths, domainChurn, selectTarget,
  listRules, parseRulePaths, listClaudeMd, listTargets,
  readDesignIntegrationFlag, listDesignArtifacts,
  listMemory, selectMemoryTarget, resolveTargetPath,
} = require('../../../plugin/bin/lib/harness-health/scope');
const { STALE_DAYS } = require('../../../plugin/bin/lib/harness-health/score');

function tmp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-health-scope-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function initGitRepo(root) {
  execFileSync('git', ['-C', root, 'init', '-q']);
  execFileSync('git', ['-C', root, 'config', 'user.email', 'test@test.com']);
  execFileSync('git', ['-C', root, 'config', 'user.name', 'Test']);
}

function commit(root, msg) {
  execFileSync('git', ['-C', root, 'add', '-A']);
  execFileSync('git', ['-C', root, 'commit', '-q', '-m', msg]);
}

// ─── listSkills ────────────────────────────────────────────────────────────

test('listSkills returns [] when .claude/skills does not exist', (t) => {
  const root = tmp(t);
  assert.deepStrictEqual(listSkills(root), []);
});

test('listSkills lists .md files under .claude/skills, sorted by id, tagged kind: skill', (t) => {
  const root = tmp(t);
  fs.mkdirSync(path.join(root, '.claude', 'skills'), { recursive: true });
  fs.writeFileSync(path.join(root, '.claude', 'skills', 'zebra.md'), '# zebra');
  fs.writeFileSync(path.join(root, '.claude', 'skills', 'auth.md'), '# auth');
  const skills = listSkills(root);
  assert.deepStrictEqual(skills.map((s) => s.id), ['auth', 'zebra']);
  assert.strictEqual(skills[0].path, path.join(root, '.claude', 'skills', 'auth.md'));
  assert.strictEqual(skills[0].kind, 'skill');
});

test('listSkills ignores non-.md files', (t) => {
  const root = tmp(t);
  fs.mkdirSync(path.join(root, '.claude', 'skills'), { recursive: true });
  fs.writeFileSync(path.join(root, '.claude', 'skills', 'auth.md'), '# auth');
  fs.writeFileSync(path.join(root, '.claude', 'skills', 'notes.txt'), 'ignore me');
  assert.deepStrictEqual(listSkills(root).map((s) => s.id), ['auth']);
});

test('listSkills recognizes a directory-per-skill layout (.claude/skills/<name>/SKILL.md)', (t) => {
  const root = tmp(t);
  fs.mkdirSync(path.join(root, '.claude', 'skills', 'trpc'), { recursive: true });
  fs.writeFileSync(path.join(root, '.claude', 'skills', 'trpc', 'SKILL.md'), '# trpc');
  const skills = listSkills(root);
  assert.deepStrictEqual(skills.map((s) => s.id), ['trpc']);
  assert.strictEqual(skills[0].path, path.join(root, '.claude', 'skills', 'trpc', 'SKILL.md'));
  assert.strictEqual(skills[0].kind, 'skill');
});

test('listSkills ignores a skill directory with no SKILL.md inside', (t) => {
  const root = tmp(t);
  fs.mkdirSync(path.join(root, '.claude', 'skills', 'empty-dir'), { recursive: true });
  fs.writeFileSync(path.join(root, '.claude', 'skills', 'empty-dir', 'reference.md'), 'not a skill entrypoint');
  assert.deepStrictEqual(listSkills(root), []);
});

test('listSkills excludes the catalog README.md from the flat-file branch', (t) => {
  const root = tmp(t);
  fs.mkdirSync(path.join(root, '.claude', 'skills'), { recursive: true });
  fs.writeFileSync(path.join(root, '.claude', 'skills', 'README.md'), '# Skills catalog');
  fs.mkdirSync(path.join(root, '.claude', 'skills', 'trpc'), { recursive: true });
  fs.writeFileSync(path.join(root, '.claude', 'skills', 'trpc', 'SKILL.md'), '# trpc');
  assert.deepStrictEqual(listSkills(root).map((s) => s.id), ['trpc']);
});

test('listSkills merges flat-file and directory-per-skill conventions, sorted together by id', (t) => {
  const root = tmp(t);
  fs.mkdirSync(path.join(root, '.claude', 'skills', 'zebra'), { recursive: true });
  fs.writeFileSync(path.join(root, '.claude', 'skills', 'zebra', 'SKILL.md'), '# zebra');
  fs.writeFileSync(path.join(root, '.claude', 'skills', 'auth.md'), '# auth');
  const skills = listSkills(root);
  assert.deepStrictEqual(skills.map((s) => s.id), ['auth', 'zebra']);
});

// ─── extractDomainPaths ────────────────────────────────────────────────────

test('extractDomainPaths finds backtick-quoted file paths', () => {
  const content = 'See `src/api/user.js` for the pattern, also `bin/helper.js`.';
  assert.deepStrictEqual(extractDomainPaths(content).sort(), ['bin/helper.js', 'src/api/user.js']);
});

test('extractDomainPaths ignores backtick-quoted strings with no slash', () => {
  const content = 'Run `npm test` and see `SKILL.md`.';
  assert.deepStrictEqual(extractDomainPaths(content), []);
});

test('extractDomainPaths dedupes repeated references', () => {
  const content = '`src/a.js` is used here and `src/a.js` again there.';
  assert.deepStrictEqual(extractDomainPaths(content), ['src/a.js']);
});

// ─── parseRulePaths / listRules ────────────────────────────────────────────

test('parseRulePaths extracts a paths: frontmatter list', () => {
  const content = '---\npaths:\n  - src/api/**\n  - src/routes/**\n---\nBody text.';
  assert.deepStrictEqual(parseRulePaths(content), ['src/api/**', 'src/routes/**']);
});

test('parseRulePaths returns [] when there is no frontmatter', () => {
  assert.deepStrictEqual(parseRulePaths('# no frontmatter here'), []);
});

test('parseRulePaths returns [] when there is no paths: key', () => {
  const content = '---\nother: value\n---\nBody.';
  assert.deepStrictEqual(parseRulePaths(content), []);
});

test('listRules returns [] when .claude/rules does not exist', (t) => {
  const root = tmp(t);
  assert.deepStrictEqual(listRules(root), []);
});

test('listRules lists .claude/rules/*.md sorted by id, tagged kind: rule, with parsed pathGlobs', (t) => {
  const root = tmp(t);
  fs.mkdirSync(path.join(root, '.claude', 'rules'), { recursive: true });
  fs.writeFileSync(path.join(root, '.claude', 'rules', 'api-errors.md'), '---\npaths:\n  - src/api/**\n---\nUse the error handler.');
  fs.writeFileSync(path.join(root, '.claude', 'rules', 'zzz.md'), '# no frontmatter');
  const rules = listRules(root);
  assert.deepStrictEqual(rules.map((r) => r.id), ['api-errors', 'zzz']);
  assert.strictEqual(rules[0].kind, 'rule');
  assert.deepStrictEqual(rules[0].pathGlobs, ['src/api/**']);
  assert.deepStrictEqual(rules[1].pathGlobs, []);
});

// ─── listClaudeMd ───────────────────────────────────────────────────────────

test('listClaudeMd returns [] when CLAUDE.md does not exist', (t) => {
  const root = tmp(t);
  assert.deepStrictEqual(listClaudeMd(root), []);
});

test('listClaudeMd returns a single kind: claude-md item when CLAUDE.md exists', (t) => {
  const root = tmp(t);
  fs.writeFileSync(path.join(root, 'CLAUDE.md'), '# Project\n');
  const result = listClaudeMd(root);
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].kind, 'claude-md');
  assert.strictEqual(result[0].id, 'CLAUDE');
  assert.strictEqual(result[0].path, path.join(root, 'CLAUDE.md'));
});

// ─── listMemory ─────────────────────────────────────────────────────────────

test('listMemory returns [] when MEMORY.md does not exist', (t) => {
  const root = tmp(t);
  assert.deepStrictEqual(listMemory(root), []);
});

test('listMemory parses `- [Title](file.md) — hook` bullets into memory targets', (t) => {
  const root = tmp(t);
  fs.writeFileSync(
    path.join(root, 'MEMORY.md'),
    '# Memory Index\n\n' +
    '- [Design feedback style](design-feedback-style.md) — reviews design choices for real\n' +
    '- [Brainstorming interaction style](brainstorming-interaction-style.md) — wants breadth of options\n',
  );
  const targets = listMemory(root);
  assert.deepStrictEqual(targets.map((t) => t.id), ['brainstorming-interaction-style', 'design-feedback-style']);
  assert.strictEqual(targets[0].kind, 'memory');
  assert.strictEqual(targets[0].path, path.join(root, 'brainstorming-interaction-style.md'));
});

test('listMemory ignores non-bullet lines (headings, blank lines, prose)', (t) => {
  const root = tmp(t);
  fs.writeFileSync(
    root && path.join(root, 'MEMORY.md'),
    '# Memory Index\n\nSome intro prose that is not a bullet.\n\n- [Only entry](only-entry.md) — the one real bullet\n',
  );
  assert.deepStrictEqual(listMemory(root).map((t) => t.id), ['only-entry']);
});

// ─── selectMemoryTarget ──────────────────────────────────────────────────────

test('selectMemoryTarget returns null when there are no memory entries', (t) => {
  const root = tmp(t);
  assert.strictEqual(selectMemoryTarget(root, {}), null);
});

test('selectMemoryTarget picks a never-audited entry as stale', (t) => {
  const root = tmp(t);
  fs.writeFileSync(path.join(root, 'MEMORY.md'), '- [Only entry](only-entry.md) — hook\n');
  const target = selectMemoryTarget(root, {});
  assert.strictEqual(target.kind, 'memory');
  assert.strictEqual(target.id, 'only-entry');
  assert.strictEqual(target.why, 'stale');
});

test('selectMemoryTarget returns null when every entry was audited recently (no hotspot fallback)', (t) => {
  const root = tmp(t);
  fs.writeFileSync(path.join(root, 'MEMORY.md'), '- [Only entry](only-entry.md) — hook\n');
  const now = Date.now();
  const cursors = { 'memory:only-entry': { lastAuditedMs: now - 1000 } };
  assert.strictEqual(selectMemoryTarget(root, cursors, { now }), null);
});

test('selectMemoryTarget force-picks past STALE_DAYS even with a recorded cursor', (t) => {
  const root = tmp(t);
  fs.writeFileSync(path.join(root, 'MEMORY.md'), '- [Only entry](only-entry.md) — hook\n');
  const now = Date.now();
  const cursors = { 'memory:only-entry': { lastAuditedMs: now - (STALE_DAYS + 1) * 86400000 } };
  const target = selectMemoryTarget(root, cursors, { now });
  assert.strictEqual(target.why, 'stale');
  assert.strictEqual(target.daysSinceLastAudit, STALE_DAYS + 1);
});

test('listTargets never includes a kind: memory entry, even when MEMORY.md exists alongside it', (t) => {
  const root = tmp(t);
  fs.mkdirSync(path.join(root, '.claude', 'skills'), { recursive: true });
  fs.writeFileSync(path.join(root, '.claude', 'skills', 'auth.md'), '# auth');
  fs.writeFileSync(path.join(root, 'CLAUDE.md'), '# Project\n');
  fs.writeFileSync(path.join(root, 'MEMORY.md'), '- [Only entry](only-entry.md) — hook\n');
  const kinds = listTargets(root).map((t) => t.kind);
  assert.ok(!kinds.includes('memory'), 'listTargets must never surface a memory target — it is reachable only via an explicit --kind memory invocation');
});

// ─── readDesignIntegrationFlag / listDesignArtifacts ──────────────────────

test('readDesignIntegrationFlag returns disabled when CLAUDE.md does not exist', (t) => {
  const root = tmp(t);
  assert.strictEqual(readDesignIntegrationFlag(root), 'disabled');
});

test('readDesignIntegrationFlag parses the design-integration value from CLAUDE.md', (t) => {
  const root = tmp(t);
  fs.writeFileSync(path.join(root, 'CLAUDE.md'), '# Project\n\n## Design integration\n\ndesign-integration: enabled\n');
  assert.strictEqual(readDesignIntegrationFlag(root), 'enabled');
});

test('readDesignIntegrationFlag returns disabled when the flag is absent from CLAUDE.md', (t) => {
  const root = tmp(t);
  fs.writeFileSync(path.join(root, 'CLAUDE.md'), '# Project\n\nNo design flag here.\n');
  assert.strictEqual(readDesignIntegrationFlag(root), 'disabled');
});

test('listDesignArtifacts returns [] when design-integration is not enabled', (t) => {
  const root = tmp(t);
  fs.writeFileSync(path.join(root, 'CLAUDE.md'), '## Design integration\n\ndesign-integration: plugin-only\n');
  fs.writeFileSync(path.join(root, 'PRODUCT.md'), '# Product context');
  assert.deepStrictEqual(listDesignArtifacts(root), []);
});

test('listDesignArtifacts returns [] when CLAUDE.md is absent, even if PRODUCT.md/DESIGN.md exist', (t) => {
  const root = tmp(t);
  fs.writeFileSync(path.join(root, 'PRODUCT.md'), '# Product context');
  assert.deepStrictEqual(listDesignArtifacts(root), []);
});

test('listDesignArtifacts finds PRODUCT.md and DESIGN.md at the project root when enabled', (t) => {
  const root = tmp(t);
  fs.writeFileSync(path.join(root, 'CLAUDE.md'), '## Design integration\n\ndesign-integration: enabled\n');
  fs.writeFileSync(path.join(root, 'PRODUCT.md'), '# Product context');
  fs.writeFileSync(path.join(root, 'DESIGN.md'), '# Design system');
  const artifacts = listDesignArtifacts(root);
  assert.deepStrictEqual(artifacts.map((a) => a.id).sort(), ['DESIGN', 'PRODUCT']);
  assert.ok(artifacts.every((a) => a.kind === 'design-artifact'));
});

test('listDesignArtifacts omits a file that is absent at every canonical and fallback path', (t) => {
  const root = tmp(t);
  fs.writeFileSync(path.join(root, 'CLAUDE.md'), '## Design integration\n\ndesign-integration: enabled\n');
  fs.writeFileSync(path.join(root, 'PRODUCT.md'), '# Product context');
  const artifacts = listDesignArtifacts(root);
  assert.deepStrictEqual(artifacts.map((a) => a.id), ['PRODUCT']);
});

test('listDesignArtifacts falls back to docs/design/ then docs/ when root files are absent', (t) => {
  const root = tmp(t);
  fs.writeFileSync(path.join(root, 'CLAUDE.md'), '## Design integration\n\ndesign-integration: enabled\n');
  fs.mkdirSync(path.join(root, 'docs', 'design'), { recursive: true });
  fs.writeFileSync(path.join(root, 'docs', 'design', 'PRODUCT.md'), '# fallback product');
  fs.writeFileSync(path.join(root, 'docs', 'DESIGN.md'), '# fallback design');
  const artifacts = listDesignArtifacts(root);
  const product = artifacts.find((a) => a.id === 'PRODUCT');
  const design = artifacts.find((a) => a.id === 'DESIGN');
  assert.strictEqual(product.path, path.join(root, 'docs', 'design', 'PRODUCT.md'));
  assert.strictEqual(design.path, path.join(root, 'docs', 'DESIGN.md'));
});

test('listDesignArtifacts gives PRODUCT empty pathGlobs and DESIGN the frontend-signal glob list', (t) => {
  const root = tmp(t);
  fs.writeFileSync(path.join(root, 'CLAUDE.md'), '## Design integration\n\ndesign-integration: enabled\n');
  fs.writeFileSync(path.join(root, 'PRODUCT.md'), '# p');
  fs.writeFileSync(path.join(root, 'DESIGN.md'), '# d');
  const artifacts = listDesignArtifacts(root);
  const product = artifacts.find((a) => a.id === 'PRODUCT');
  const design = artifacts.find((a) => a.id === 'DESIGN');
  assert.deepStrictEqual(product.pathGlobs, []);
  assert.ok(design.pathGlobs.includes('components/'));
  assert.ok(design.pathGlobs.includes('*.tsx'));
  assert.ok(design.pathGlobs.includes('*.html'));
  assert.ok(design.pathGlobs.includes('*.mdx'));
});

// ─── listTargets ────────────────────────────────────────────────────────────

test('listTargets aggregates skills, rules, and CLAUDE.md, each correctly tagged', (t) => {
  const root = tmp(t);
  fs.mkdirSync(path.join(root, '.claude', 'skills'), { recursive: true });
  fs.mkdirSync(path.join(root, '.claude', 'rules'), { recursive: true });
  fs.writeFileSync(path.join(root, '.claude', 'skills', 'auth.md'), '# auth');
  fs.writeFileSync(path.join(root, '.claude', 'rules', 'api-errors.md'), '---\npaths:\n  - src/api/**\n---\n');
  fs.writeFileSync(path.join(root, 'CLAUDE.md'), '# Project\n');
  const targets = listTargets(root);
  assert.deepStrictEqual(
    targets.map((t) => `${t.kind}:${t.id}`).sort(),
    ['claude-md:CLAUDE', 'rule:api-errors', 'skill:auth'],
  );
});

test('listTargets includes design artifacts when design-integration is enabled', (t) => {
  const root = tmp(t);
  fs.writeFileSync(path.join(root, 'CLAUDE.md'), '## Design integration\n\ndesign-integration: enabled\n');
  fs.writeFileSync(path.join(root, 'PRODUCT.md'), '# p');
  const targets = listTargets(root);
  assert.ok(targets.some((t) => t.kind === 'design-artifact' && t.id === 'PRODUCT'));
});

// ─── domainChurn ───────────────────────────────────────────────────────────

test('domainChurn returns 0 for an empty path list', (t) => {
  const root = tmp(t);
  assert.strictEqual(domainChurn(root, [], 0), 0);
});

test('domainChurn counts commits touching the given paths since sinceMs', (t) => {
  const root = tmp(t);
  initGitRepo(root);
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'a.js'), 'const x = 1;\n');
  commit(root, 'first');
  const sinceMs = Date.now() - 86400000;
  fs.writeFileSync(path.join(root, 'src', 'a.js'), 'const x = 2;\n');
  commit(root, 'second');
  const churn = domainChurn(root, ['src/a.js'], sinceMs);
  assert.ok(churn >= 1, 'must count the commit touching src/a.js');
});

test('domainChurn returns 0 when git is unavailable (bad root)', () => {
  const churn = domainChurn('/nonexistent/path/xyz', ['a.js'], 0);
  assert.strictEqual(churn, 0);
});

test('domainChurn(root, paths, 0) counts a commit from well in the past, not just one made in the same instant as the query (regression: git --since=@0 and --since=1970-01-01 are both silently mishandled)', (t) => {
  // sinceMs=0 is the value rotation.js's selectByStaleThenChurn passes for any
  // never-before-audited target (lastAuditedMs is null -> sinceMs = 0). The
  // fix must mean "since the beginning of git history," not "since whenever
  // this process happens to run." A backdated commit (via GIT_AUTHOR_DATE /
  // GIT_COMMITTER_DATE) proves this deterministically, without relying on
  // wall-clock sleep or how fast the test happens to execute: two known-bad
  // implementations both pass a naive "commit immediately before querying"
  // check yet fail this one --
  //   - new Date(0).toISOString().slice(0, 10) ("1970-01-01", no time-of-day)
  //     is parsed by git as local midnight and underflows to a pre-epoch
  //     boundary in positive-UTC-offset timezones, silently matching nothing.
  //   - git's numeric `--since=@<seconds>` epoch-literal syntax, for small
  //     second counts, is parsed by git's fuzzy approxidate grammar as an
  //     ambiguous *relative* offset from "now" rather than an absolute
  //     timestamp -- so `--since=@0` silently degrades to "since right now"
  //     once any wall-clock time at all has elapsed since the commit.
  const root = tmp(t);
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'b.ts'), '', 'utf8');
  initGitRepo(root);
  execFileSync('git', ['-C', root, 'add', '.']);
  const backdated = new Date(Date.now() - 10 * 60 * 1000).toISOString(); // 10 minutes in the past
  execFileSync('git', ['-C', root, 'commit', '-q', '-m', 'init'], {
    env: { ...process.env, GIT_AUTHOR_DATE: backdated, GIT_COMMITTER_DATE: backdated },
  });

  const count = domainChurn(root, ['src/b.ts'], 0);
  assert.ok(count > 0, `expected the backdated commit to be counted since sinceMs=0, got ${count}`);
});

// ─── selectTarget ──────────────────────────────────────────────────────────

test('selectTarget returns null when no skills exist', (t) => {
  const root = tmp(t);
  assert.strictEqual(selectTarget(root, {}, { now: Date.now() }), null);
});

test('selectTarget force-picks a never-audited skill as stale', (t) => {
  const root = tmp(t);
  fs.mkdirSync(path.join(root, '.claude', 'skills'), { recursive: true });
  fs.writeFileSync(path.join(root, '.claude', 'skills', 'auth.md'), '# auth\nSee `src/auth.js`.');
  const result = selectTarget(root, {}, { now: Date.now() });
  assert.ok(result !== null);
  assert.strictEqual(result.id, 'auth');
  assert.strictEqual(result.why, 'stale');
});

test('selectTarget force-picks a skill unaudited past STALE_DAYS even with a cursor present', (t) => {
  const root = tmp(t);
  fs.mkdirSync(path.join(root, '.claude', 'skills'), { recursive: true });
  fs.writeFileSync(path.join(root, '.claude', 'skills', 'auth.md'), '# auth');
  const staleMs = Date.now() - (90 + 5) * 86400000;
  const result = selectTarget(root, { 'skill:auth': { lastAuditedMs: staleMs } }, { now: Date.now() });
  assert.ok(result !== null);
  assert.strictEqual(result.why, 'stale');
});

test('selectTarget returns null when all skills are fresh with zero churn', (t) => {
  const root = tmp(t);
  fs.mkdirSync(path.join(root, '.claude', 'skills'), { recursive: true });
  fs.writeFileSync(path.join(root, '.claude', 'skills', 'auth.md'), '# auth');
  const recentMs = Date.now() - 1 * 86400000;
  const result = selectTarget(root, { 'skill:auth': { lastAuditedMs: recentMs } }, {
    now: Date.now(),
    signals: { 'skill:auth': 0 },
  });
  assert.strictEqual(result, null);
});

test('selectTarget picks the highest-churn skill among fresh candidates (via signals injection)', (t) => {
  const root = tmp(t);
  fs.mkdirSync(path.join(root, '.claude', 'skills'), { recursive: true });
  fs.writeFileSync(path.join(root, '.claude', 'skills', 'auth.md'), '# auth');
  fs.writeFileSync(path.join(root, '.claude', 'skills', 'billing.md'), '# billing');
  const recentMs = Date.now() - 1 * 86400000;
  const cursors = {
    'skill:auth': { lastAuditedMs: recentMs },
    'skill:billing': { lastAuditedMs: recentMs },
  };
  const result = selectTarget(root, cursors, {
    now: Date.now(),
    signals: { 'skill:auth': 2, 'skill:billing': 8 },
  });
  assert.ok(result !== null);
  assert.strictEqual(result.id, 'billing');
  assert.strictEqual(result.why, 'hotspot');
});

test('selectTarget does not collide when a skill and a rule share the same bare id', (t) => {
  const root = tmp(t);
  fs.mkdirSync(path.join(root, '.claude', 'skills'), { recursive: true });
  fs.mkdirSync(path.join(root, '.claude', 'rules'), { recursive: true });
  fs.writeFileSync(path.join(root, '.claude', 'skills', 'auth.md'), '# auth');
  fs.writeFileSync(path.join(root, '.claude', 'rules', 'auth.md'), '---\npaths:\n  - src/auth/**\n---\n');
  const recentMs = Date.now() - 1 * 86400000;
  const cursors = {
    'skill:auth': { lastAuditedMs: recentMs },
    'rule:auth': { lastAuditedMs: recentMs },
  };
  const result = selectTarget(root, cursors, {
    now: Date.now(),
    signals: { 'skill:auth': 0, 'rule:auth': 5 },
  });
  assert.ok(result !== null);
  assert.strictEqual(result.kind, 'rule');
  assert.strictEqual(result.id, 'auth');
});

test('selectTarget --kind filter restricts the pool to one kind', (t) => {
  const root = tmp(t);
  fs.mkdirSync(path.join(root, '.claude', 'skills'), { recursive: true });
  fs.writeFileSync(path.join(root, '.claude', 'skills', 'auth.md'), '# auth');
  fs.writeFileSync(path.join(root, 'CLAUDE.md'), '# Project\n');
  const result = selectTarget(root, {}, { now: Date.now(), kind: 'claude-md' });
  assert.ok(result !== null);
  assert.strictEqual(result.kind, 'claude-md');
});

test('selectTarget reports daysSinceLastAudit: null for a never-audited (no cursor) stale pick', (t) => {
  const root = tmp(t);
  fs.mkdirSync(path.join(root, '.claude', 'skills'), { recursive: true });
  fs.writeFileSync(path.join(root, '.claude', 'skills', 'auth.md'), '# auth');
  const result = selectTarget(root, {}, { now: Date.now() });
  assert.strictEqual(result.why, 'stale');
  assert.strictEqual(result.daysSinceLastAudit, null);
});

test('selectTarget reports a numeric daysSinceLastAudit for a stale pick with a prior cursor', (t) => {
  const root = tmp(t);
  fs.mkdirSync(path.join(root, '.claude', 'skills'), { recursive: true });
  fs.writeFileSync(path.join(root, '.claude', 'skills', 'auth.md'), '# auth');
  const staleMs = Date.now() - (90 + 10) * 86400000;
  const result = selectTarget(root, { 'skill:auth': { lastAuditedMs: staleMs } }, { now: Date.now() });
  assert.strictEqual(result.why, 'stale');
  assert.ok(result.daysSinceLastAudit >= 100, `expected >= 100, got ${result.daysSinceLastAudit}`);
});

test('selectTarget reports churnCount on a hotspot pick', (t) => {
  const root = tmp(t);
  fs.mkdirSync(path.join(root, '.claude', 'skills'), { recursive: true });
  fs.writeFileSync(path.join(root, '.claude', 'skills', 'auth.md'), '# auth');
  const recentMs = Date.now() - 1 * 86400000;
  const result = selectTarget(root, { 'skill:auth': { lastAuditedMs: recentMs } }, {
    now: Date.now(),
    signals: { 'skill:auth': 7 },
  });
  assert.strictEqual(result.why, 'hotspot');
  assert.strictEqual(result.churnCount, 7);
});

test('selectTarget Phase 2 uses a design-artifact candidate pathGlobs, not content-scraped paths', (t) => {
  const root = tmp(t);
  initGitRepo(root);
  fs.writeFileSync(path.join(root, 'CLAUDE.md'), '## Design integration\n\ndesign-integration: enabled\n');
  fs.mkdirSync(path.join(root, 'components'), { recursive: true });
  fs.writeFileSync(path.join(root, 'components', 'Button.tsx'), 'export const Button = () => null;\n');
  fs.writeFileSync(path.join(root, 'DESIGN.md'), 'No backtick file references in this prose at all.');
  commit(root, 'first');
  const sinceMs = Date.now() - 86400000;
  fs.writeFileSync(path.join(root, 'components', 'Button.tsx'), 'export const Button = () => <button />;\n');
  commit(root, 'second');
  const recentMs = Date.now() - 1 * 86400000;
  const result = selectTarget(root, { 'design-artifact:DESIGN': { lastAuditedMs: sinceMs } }, {
    now: Date.now(),
    kind: 'design-artifact',
  });
  assert.ok(result !== null, 'must pick DESIGN via its curated pathGlobs, not via content-scraping (which would find zero backtick paths and score 0 churn)');
  assert.strictEqual(result.id, 'DESIGN');
  assert.strictEqual(result.why, 'hotspot');
});

test('selectTarget lets PRODUCT win via hotspot from its own content-scraped paths despite empty pathGlobs', (t) => {
  const root = tmp(t);
  initGitRepo(root);
  fs.writeFileSync(path.join(root, 'CLAUDE.md'), '## Design integration\n\ndesign-integration: enabled\n');
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'pricing.js'), 'export const price = 1;\n');
  fs.writeFileSync(path.join(root, 'PRODUCT.md'), 'Pricing logic lives in `src/pricing.js`.');
  commit(root, 'first');
  const sinceMs = Date.now() - 86400000;
  fs.writeFileSync(path.join(root, 'src', 'pricing.js'), 'export const price = 2;\n');
  commit(root, 'second');
  const result = selectTarget(root, { 'design-artifact:PRODUCT': { lastAuditedMs: sinceMs } }, {
    now: Date.now(),
    kind: 'design-artifact',
  });
  assert.ok(result !== null, 'must pick PRODUCT via paths scraped from its own prose, since its pathGlobs is always []');
  assert.strictEqual(result.kind, 'design-artifact');
  assert.strictEqual(result.id, 'PRODUCT');
  assert.strictEqual(result.why, 'hotspot');
  assert.deepStrictEqual(result.pathGlobs, [], 'the returned target.pathGlobs must stay the static [], not the scraped paths');
  assert.ok(result.churnCount > 0, `expected churnCount > 0 from the scraped-path churn, got ${result.churnCount}`);
});

// Regression: computeScore must UNION the candidate's own file path into the
// domainChurn pathspec, not just its content-scraped/pathGlobs references —
// otherwise a skill that's been heavily hand-rewritten, with no change to
// the files it happens to reference, is invisible to the rotation algorithm
// even though its own edit history is a real drift signal (mirrors
// docs-health/scope.js's [relDocPath, ...domainPaths] union).
test('selectTarget registers churn from a skill\'s own edit history, even when its referenced path never changed', (t) => {
  const root = tmp(t);
  initGitRepo(root);
  fs.mkdirSync(path.join(root, '.claude', 'skills'), { recursive: true });
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'auth.js'), 'export const login = () => {};\n');
  fs.writeFileSync(path.join(root, '.claude', 'skills', 'auth.md'), '# auth\nSee `src/auth.js`.');
  commit(root, 'first');
  const sinceMs = Date.now() - 86400000;
  // Only the skill file itself changes — src/auth.js (its sole referenced
  // path) is never touched again.
  fs.writeFileSync(path.join(root, '.claude', 'skills', 'auth.md'), '# auth (rewritten)\nSee `src/auth.js`.\nMore detail.');
  commit(root, 'second');

  const result = selectTarget(root, { 'skill:auth': { lastAuditedMs: sinceMs } }, { now: Date.now() });
  assert.ok(result !== null, 'must pick auth via its own edit history, not just its referenced path');
  assert.strictEqual(result.id, 'auth');
  assert.strictEqual(result.why, 'hotspot');
  assert.ok(result.churnCount > 0, `expected churnCount > 0 from the skill's own commit, got ${result.churnCount}`);
});

// ─── listTargets caching ────────────────────────────────────────────────────

test('listTargets caches the parsed rule content across calls when nothing on disk changed (regression: a --budget>1 loop must not re-read every rule every slot)', (t) => {
  const root = tmp(t);
  fs.mkdirSync(path.join(root, '.claude', 'rules'), { recursive: true });
  fs.writeFileSync(path.join(root, '.claude', 'rules', 'api-errors.md'), '---\npaths:\n  - src/api/**\n---\n');

  const originalReadFileSync = fs.readFileSync;
  let ruleReadCount = 0;
  fs.readFileSync = (...fsArgs) => {
    if (typeof fsArgs[0] === 'string' && fsArgs[0].endsWith('api-errors.md')) ruleReadCount += 1;
    return originalReadFileSync(...fsArgs);
  };
  try {
    const first = listTargets(root);
    assert.strictEqual(ruleReadCount, 1); // one content read on the cold call
    const second = listTargets(root);
    assert.strictEqual(ruleReadCount, 1); // unchanged directory -> no additional reads
    assert.strictEqual(second, first); // cache hit returns the same array reference
    // Simulate a --budget=4 loop hitting the same unchanged tree repeatedly.
    for (let i = 0; i < 3; i++) listTargets(root);
    assert.strictEqual(ruleReadCount, 1);
  } finally {
    fs.readFileSync = originalReadFileSync;
  }
});

test('listTargets re-reads a rule after its content changes (cache correctly invalidates, not just wins on staleness)', (t) => {
  const root = tmp(t);
  fs.mkdirSync(path.join(root, '.claude', 'rules'), { recursive: true });
  fs.writeFileSync(path.join(root, '.claude', 'rules', 'api-errors.md'), '---\npaths:\n  - src/api/**\n---\n');
  const first = listTargets(root);
  assert.deepStrictEqual(first.find((t2) => t2.id === 'api-errors').pathGlobs, ['src/api/**']);

  fs.writeFileSync(path.join(root, '.claude', 'rules', 'api-errors.md'), '---\npaths:\n  - src/api/**\n  - src/web/**\n---\n');
  const second = listTargets(root);
  assert.deepStrictEqual(second.find((t2) => t2.id === 'api-errors').pathGlobs, ['src/api/**', 'src/web/**']);
});

// ─── resolveTargetPath ───────────────────────────────────────────────────────

test('resolveTargetPath resolves a skill id to its file path', (t) => {
  const root = tmp(t);
  fs.mkdirSync(path.join(root, '.claude', 'skills'), { recursive: true });
  fs.writeFileSync(path.join(root, '.claude', 'skills', 'auth.md'), '# auth');
  assert.strictEqual(
    resolveTargetPath(root, 'skill', 'auth'),
    path.join(root, '.claude', 'skills', 'auth.md'),
  );
});

test('resolveTargetPath resolves a claude-md id to CLAUDE.md', (t) => {
  const root = tmp(t);
  fs.writeFileSync(path.join(root, 'CLAUDE.md'), '# CLAUDE');
  assert.strictEqual(resolveTargetPath(root, 'claude-md', 'CLAUDE'), path.join(root, 'CLAUDE.md'));
});

test('resolveTargetPath resolves a memory id when memoryDir is given', (t) => {
  const root = tmp(t);
  const memoryDir = tmp(t);
  fs.writeFileSync(path.join(memoryDir, 'MEMORY.md'), '- [Some Memory](some-memory.md) — hook\n');
  assert.strictEqual(
    resolveTargetPath(root, 'memory', 'some-memory', memoryDir),
    path.join(memoryDir, 'some-memory.md'),
  );
});

test('resolveTargetPath returns null for a memory id when memoryDir is omitted', (t) => {
  const root = tmp(t);
  assert.strictEqual(resolveTargetPath(root, 'memory', 'some-memory'), null);
});

test('resolveTargetPath returns null when no target matches kind+id', (t) => {
  const root = tmp(t);
  fs.mkdirSync(path.join(root, '.claude', 'skills'), { recursive: true });
  fs.writeFileSync(path.join(root, '.claude', 'skills', 'auth.md'), '# auth');
  assert.strictEqual(resolveTargetPath(root, 'skill', 'billing'), null);
  assert.strictEqual(resolveTargetPath(root, 'rule', 'auth'), null, 'kind must also match, not just id');
});

test('resolveTargetPath returns null when kind or id is missing', (t) => {
  const root = tmp(t);
  assert.strictEqual(resolveTargetPath(root, null, 'auth'), null);
  assert.strictEqual(resolveTargetPath(root, 'skill', null), null);
});
