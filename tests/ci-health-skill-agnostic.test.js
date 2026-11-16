'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { stripComments, stripperVerdict, STRIPPER_VERDICT_MESSAGES } = require('./helpers/strip-comments');
const { readText } = require('./helpers/read-skill');

// /claude-tweaks:ci-health must stay project-agnostic (#5757): it reads only CI run data and
// workflow files, and names no vendor. Only plugin/bin/lib/ci-audit/source.js may name a forge,
// a forge CLI or a workflow-file location, or spawn. This suite scans everything else the skill
// runs or reads: every file under plugin/skills/ci-health/, every ci-audit module but source.js,
// and the CLI plugin/bin/ci-audit.js (its emitted text falls under the same rule).
//
// AC7.1 (names): DENYLIST below, plus this repository's own workflow file names, plus the
// hard-coded workflow-file locations of the common CI products. A .js file is scanned over
// stripComments' keep-mode text (comments blanked, string literals kept, since emitted text
// counts); a .md file over its text. A `_shared/<name>.md` citation is a path to one of this
// plugin's own contracts, not a vendor mention, and is blanked first.
// AC8.1 (reads and calls), .js files only: any child_process use, any spawn-family call, any
// network module or fetch( call, a forge CLI literal, a manifest or lockfile named anywhere in a
// literal, and a read call (readFile, readFileSync, createReadStream, open, openSync) whose
// arguments name a source-code file by extension. A read of a path held in a variable is allowed:
// the CLI reads its own --gather/--findings/--issues files that way.
// Recall limits: a name assembled from two literals or reached through a computed key is not
// seen; `.exec(` is not flagged as a member call because RegExp.prototype.exec shares the name
// (a bare exec( is, and requiring child_process is flagged on its own); a source-file read whose
// path literal sits in a variable declared elsewhere is not tied to the read.
const REPO = path.join(__dirname, '..');
const SKILL_DIR = path.join(REPO, 'plugin', 'skills', 'ci-health');
const LIB_DIR = path.join(REPO, 'plugin', 'bin', 'lib', 'ci-audit');
const CLI = path.join(REPO, 'plugin', 'bin', 'ci-audit.js');
const EXEMPT = 'source.js';
const toPosix = (p) => p.split(path.sep).join('/');

// Token boundaries: `tok` needs a non-alphanumeric on both sides (short or ordinary-word names);
// `pre` only before it, so a vendor name inside a longer identifier or host still matches.
const tok = (s) => new RegExp(`(?<![a-z0-9_])(?:${s})(?![a-z0-9_])`, 'gi');
const pre = (s) => new RegExp(`(?<![a-z0-9_])(?:${s})`, 'gi');
const DENYLIST = [
  ['CI product', pre('github[\\s-]*actions|gitlab[\\s-]*ci|circle[\\s-]*ci|jenkins|travis|buildkite|azure[\\s-]*pipelines|team[\\s-]*city|bitbucket[\\s-]*pipelines|app[\\s-]*veyor|codefresh|tekton|woodpecker')],
  // `semaphore` alone is a concurrency primitive and `argo` a prefix of argument words: both whole tokens.
  ['CI product', tok('drone(?:[\\s-]*ci)?|semaphore[\\s-]*ci|semaphoreci|bamboo|concourse|argo(?:cd)?|cloud[\\s-]*build|code[\\s-]*build|code[\\s-]*pipeline')],
  ['hosted runner', tok('ubuntu(?:-[a-z0-9.]+)?|macos-(?:latest|\\d[a-z0-9.]*)|windows-(?:latest|\\d{4})|self[\\s-]*hosted|runs-on')],
  ['cache service', pre('actions\\/cache|cache@v|sccache|ccache|bazel|turbo[\\s-]*repo|nx[\\s-]*cloud|build[\\s-]*kit|registry[\\s-]*cache|type=registry')],
  ['cache service', tok('s3')],
  ['cloud vendor', pre('amazon|google|azure|cloudflare|digital[\\s-]*ocean|heroku|vercel|netlify')],
  ['cloud vendor', tok('aws|gcp')],
  ['forge', pre('github|gitlab|bitbucket|codeberg|gitea')],
  ['forge CLI', tok('gh')],
  // A workflow step reference (`actions/checkout`), never the English word "actions".
  ['forge step reference', pre('actions\\/[a-z]')],
];
const LOCATIONS = ['.github/workflows', '.gitlab-ci.yml', 'Jenkinsfile', '.circleci', 'azure-pipelines.yml',
  '.travis.yml', 'bitbucket-pipelines.yml', '.buildkite', '.drone.yml', '.woodpecker'];
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
const LOCATION_RULES = LOCATIONS.map((l) => ['workflow-file location', new RegExp(`(?<![a-z0-9_-])${escapeRe(l)}`, 'gi')]);

// This repository's workflows: every file basename, every hyphenated stem, and every top-level
// `name:` that is not one plain word (a bare `test` would match ordinary prose).
function repoWorkflowRules(root = REPO) {
  const dir = path.join(root, '.github', 'workflows');
  const names = new Set();
  for (const f of fs.readdirSync(dir).filter((n) => /\.ya?ml$/.test(n))) {
    names.add(f);
    const stem = f.replace(/\.ya?ml$/, '');
    if (stem.includes('-')) names.add(stem);
    const top = /^name:[ \t]*(['"]?)(.+?)\1[ \t]*$/m.exec(readText(path.join(dir, f)));
    if (top && /[\s-]/.test(top[2])) names.add(top[2]);
  }
  return [...names].map((n) => ['this repository\'s workflow', new RegExp(`(?<![a-z0-9_.-])${escapeRe(n)}(?![a-z0-9_-])`, 'gi')]);
}

const lineAt = (text, i) => text.slice(0, i).split('\n').length;
function matchRules(text, rules, file, clause) {
  const out = [];
  for (const [rule, re] of rules) {
    for (const m of text.matchAll(re)) out.push({ clause, file, line: lineAt(text, m.index), rule, match: m[0] });
  }
  return out;
}

const SOURCE_EXT = /\.(?:[cm]?js|jsx|tsx?|py|go|rs|java|kt|rb|php|c|cc|cpp|h|hpp|cs|swift)(?![a-z0-9])/i;
const MANIFEST = /(?<![a-z0-9_.-])(?:package(?:-lock)?\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.ya?ml|bun\.lockb?|cargo\.(?:toml|lock)|go\.(?:mod|sum)|requirements[a-z0-9_.-]*\.txt|pipfile(?:\.lock)?|pyproject\.toml|poetry\.lock|gemfile(?:\.lock)?|pom\.xml|build\.gradle(?:\.kts)?|composer\.(?:json|lock))(?![a-z0-9_-])/gi;
const IO_KEEP = [
  ['child_process', /(?<![a-z0-9_])child_process(?![a-z0-9_])/g],
  ['network module', /require\(\s*['"`](?:node:)?(?:https?|http2|net|dns|tls|dgram|undici)['"`]\s*\)/g],
  ['forge CLI literal', /(['"`])gh(?:\1|\s)/g],
  ['manifest or lockfile', MANIFEST],
];
const IO_BLANK = [
  ['spawn call', /(?<![\w$])(?:spawn|spawnSync|execFile|execFileSync|execSync|fork)\s*\(|(?<![\w$.])exec\s*\(/g],
  ['network call', /(?<![\w$])fetch\s*\(|\bnew\s+(?:WebSocket|XMLHttpRequest)\b/g],
];
const READ_CALL = /(?<![\w$])(?:readFileSync|readFile|createReadStream|openSync|open)\s*\(/g;

function balancedArgs(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '(') depth++;
    else if (text[i] === ')' && --depth === 0) return text.slice(open + 1, i);
  }
  return text.slice(open + 1);
}

// One scan for every file: the positive walk and every go-red control call this.
// -> { offenders, readSites }
function scanFile(abs, rel, repoRules) {
  const text = readText(abs);
  if (!abs.endsWith('.js')) {
    const named = text.replace(/_shared\/[a-z0-9-]+\.md/g, (m) => ' '.repeat(m.length));
    return { offenders: matchRules(named, [...DENYLIST, ...LOCATION_RULES, ...repoRules], rel, 'names'), readSites: 0 };
  }
  const keep = stripComments(text);
  const blank = stripComments(text, { literals: 'blank' });
  const offenders = [];
  for (const [mode, stripped] of [['keep', keep], ['blank', blank]]) {
    const verdict = stripperVerdict(text, stripped);
    if (verdict !== 'ok') offenders.push({ clause: 'io', file: rel, line: 0, rule: `stripper (${mode})`, match: STRIPPER_VERDICT_MESSAGES[verdict] });
  }
  const named = keep.replace(/_shared\/[a-z0-9-]+\.md/g, (m) => ' '.repeat(m.length));
  offenders.push(...matchRules(named, [...DENYLIST, ...LOCATION_RULES, ...repoRules], rel, 'names'));
  offenders.push(...matchRules(keep, IO_KEEP, rel, 'io'), ...matchRules(blank, IO_BLANK, rel, 'io'));
  let readSites = 0;
  for (const m of blank.matchAll(READ_CALL)) {
    readSites++;
    const args = balancedArgs(keep, m.index + m[0].length - 1);
    if (SOURCE_EXT.test(args)) offenders.push({ clause: 'io', file: rel, line: lineAt(keep, m.index), rule: 'source-file read', match: m[0] + args + ')' });
  }
  return { offenders, readSites };
}

function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(abs));
    else if (e.isFile()) out.push(abs);
  }
  return out;
}
const scanned = () => [
  ...walk(SKILL_DIR),
  ...walk(LIB_DIR).filter((f) => f.endsWith('.js') && path.basename(f) !== EXEMPT),
  CLI,
].map((abs) => ({ abs, rel: toPosix(path.relative(REPO, abs)) }));

function scanTree() {
  const rules = repoWorkflowRules();
  let offenders = [];
  let readSites = 0;
  for (const { abs, rel } of scanned()) {
    const r = scanFile(abs, rel, rules);
    offenders = offenders.concat(r.offenders);
    readSites += r.readSites;
  }
  return { offenders, readSites };
}
const show = (os_) => os_.map((o) => `${o.file}:${o.line} ${o.rule}: ${o.match}`).join('\n');
const nameRules = (os_) => os_.filter((o) => o.clause === 'names');
const ioRules = (os_) => os_.filter((o) => o.clause === 'io');

test('floor: the scan covers every skill file, every ci-audit module but source.js, and the CLI', () => {
  const lib = fs.readdirSync(LIB_DIR).filter((n) => n.endsWith('.js'));
  assert.ok(lib.includes(EXEMPT), 'source.js is gone: the exemption names a file that no longer exists');
  const expected = [
    ...fs.readdirSync(SKILL_DIR).map((n) => `plugin/skills/ci-health/${n}`),
    ...lib.filter((n) => n !== EXEMPT).map((n) => `plugin/bin/lib/ci-audit/${n}`),
    'plugin/bin/ci-audit.js',
  ].sort();
  const got = scanned().map((f) => f.rel).sort();
  assert.deepEqual(got, expected);
  assert.ok(got.length >= 10, `only ${got.length} files scanned; fewer than 10 means the walk lost files`);
  assert.ok(!got.includes(`plugin/bin/lib/ci-audit/${EXEMPT}`));
  assert.ok(repoWorkflowRules().length >= 8, 'fewer than 8 repository workflow names: the repository clause is reading nothing');
});

test('AC7.1: no CI product, hosted runner, cache service, cloud vendor, forge, repository workflow or workflow-file location is named outside source.js', () => {
  const found = nameRules(scanTree().offenders);
  assert.deepEqual(found, [], `vendor-specific names outside source.js:\n${show(found)}`);
});

test('AC8.1: nothing outside source.js spawns, uses the network, names the forge CLI, or reads source, lockfile or manifest files', () => {
  const { offenders, readSites } = scanTree();
  const found = ioRules(offenders);
  assert.deepEqual(found, [], `reads or calls outside source.js:\n${show(found)}`);
  assert.ok(readSites >= 2, `only ${readSites} read call sites matched (the CLI has 2): the read matcher stopped matching`);
});

// --- go-red self-tests: the same scanFile over planted copies of real files ---

test('control: the exempt source.js, scanned the same way, trips both clauses', () => {
  const { offenders } = scanFile(path.join(LIB_DIR, EXEMPT), EXEMPT, repoWorkflowRules());
  const rules = new Set(offenders.map((o) => `${o.clause}:${o.rule}`));
  for (const r of ['names:forge', 'names:forge CLI', 'names:workflow-file location', 'io:child_process', 'io:spawn call', 'io:forge CLI literal']) {
    assert.ok(rules.has(r), `source.js should trip ${r}; got ${[...rules].join(', ')}`);
  }
});

function scratch(t) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-agnostic-'));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  return d;
}
function plant(t, srcAbs, extra, name) {
  const f = path.join(scratch(t), name || path.basename(srcAbs));
  fs.writeFileSync(f, readText(srcAbs) + extra);
  return scanFile(f, 'fixture', repoWorkflowRules()).offenders;
}
const baseLines = (abs) => readText(abs).split('\n').length;

test('AC7.2: a denylisted name planted in a copy of a real module is reported; the unplanted copy is not', (t) => {
  const mod = path.join(LIB_DIR, 'phases.js');
  assert.deepEqual(plant(t, mod, ''), [], 'control: the unplanted copy reports nothing');
  const n = baseLines(mod);
  const found = plant(t, mod, "\nconst RUNNER = 'ubuntu-latest';\nconst HOST = 'GitHub Actions';\n// azure in a comment is not code\n");
  assert.deepEqual(found.map((o) => [o.line, o.rule]).sort(), [[n + 1, 'hosted runner'], [n + 2, 'CI product'], [n + 2, 'forge']]);
});

test('AC7.2: a planted name in a copy of checklist.md is reported, with ordinary words and a _shared citation left alone', (t) => {
  const md = path.join(SKILL_DIR, 'checklist.md');
  assert.deepEqual(plant(t, md, ''), []);
  const n = baseLines(md);
  const ok = '\n## Next Actions\n## Allowed Steps\nthe cache, jobsCache, laws, draws, glazureware, ghost, high, drones, arguments, a semaphore, windows.\nSee `_shared/github-write-transport.md`.\n';
  assert.deepEqual(plant(t, md, ok), [], 'ordinary words and a _shared/ contract path are not vendor names');
  const bad = '\nUse a github runner with sccache on AWS, or `actions/checkout`.\n';
  assert.deepEqual(plant(t, md, bad).map((o) => [o.line, o.rule, o.match]).sort(), [
    [n + 1, 'cache service', 'sccache'],
    [n + 1, 'cloud vendor', 'AWS'],
    [n + 1, 'forge step reference', 'actions/c'],
    [n + 1, 'forge', 'github'],
  ]);
});

test('AC7.1 go-red: a hard-coded workflow-file location and a repository workflow name are reported', (t) => {
  const mod = path.join(LIB_DIR, 'checks.js');
  const n = baseLines(mod);
  const found = plant(t, mod, "\nconst A = '.gitlab-ci.yml';\nconst B = 'test-perf.yml';\nconst C = 'release-please';\n");
  assert.deepEqual(found.map((o) => [o.line, o.rule, o.match]).sort(), [
    [n + 1, 'CI product', 'gitlab-ci'],
    [n + 1, 'forge', 'gitlab'],
    [n + 1, 'workflow-file location', '.gitlab-ci.yml'],
    [n + 2, 'this repository\'s workflow', 'test-perf'],
    [n + 2, 'this repository\'s workflow', 'test-perf.yml'],
    [n + 3, 'this repository\'s workflow', 'release-please'],
  ]);
});

test('AC8.1 go-red: each banned read or call planted in a copy of the CLI is reported on its line', (t) => {
  assert.deepEqual(plant(t, CLI, ''), []);
  const n = baseLines(CLI);
  const plants = [
    "const cp = require('child_process');",
    'spawnSync(cmd, []);',
    'deps.execFile(cmd);',
    "const h = require('https');",
    'fetch(url);',
    "deps.run(['g' + 'h'], 'gh');",
    "fs.readFileSync(path.join(root, 'package.json'));",
    "fs.readFileSync(path.join(root, 'src', 'index.ts'), 'utf8');",
    "const lock = 'yarn.lock';",
    'pattern.exec(text); // RegExp exec is not a spawn',
  ];
  const found = plant(t, CLI, `\n${plants.join('\n')}\n`, 'ci-audit.js');
  assert.deepEqual(found.map((o) => [o.line - n, o.rule]).sort(), [
    [1, 'child_process'], [2, 'spawn call'], [3, 'spawn call'], [4, 'network module'], [5, 'network call'],
    [6, 'forge CLI'], [6, 'forge CLI literal'], [7, 'manifest or lockfile'], [8, 'source-file read'], [9, 'manifest or lockfile'],
  ].sort());
});

test('a stripper mis-parse in either mode is an offender, never a clean scan', (t) => {
  const d = scratch(t);
  const f = path.join(d, 'm.js');
  fs.writeFileSync(f, "const b = 'q';\nif (b) /'/.test(b); const c = 'x'; fetch(c);\n");
  const verdicts = scanFile(f, 'fixture', []).offenders.filter((o) => o.rule.startsWith('stripper'));
  assert.deepEqual(verdicts.map((o) => o.rule), ['stripper (blank)']);
  fs.writeFileSync(f, 'const = ;\n');
  assert.deepEqual(scanFile(f, 'fixture', []).offenders.map((o) => o.rule), ['stripper (keep)', 'stripper (blank)']);
});

test('a CRLF checkout of the skill files scans the same as LF', (t) => {
  const d = scratch(t);
  for (const name of fs.readdirSync(SKILL_DIR)) {
    const f = path.join(d, name);
    fs.writeFileSync(f, readText(path.join(SKILL_DIR, name)).replace(/\n/g, '\r\n') + '\r\nself-hosted\r\n');
    const found = scanFile(f, 'fixture', repoWorkflowRules());
    assert.deepEqual(found.offenders.map((o) => [o.line, o.match]), [[baseLines(path.join(SKILL_DIR, name)) + 1, 'self-hosted']]);
  }
});
