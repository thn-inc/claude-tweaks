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
// AC7.1 (names): DENYLIST below, plus this repository's own workflow names, plus the hard-coded
// workflow-file locations of the common CI products, over each file's whole text, comments
// included (a vendor name in a comment is still a name). A `_shared/<name>.md` citation of a
// contract that exists under plugin/skills/_shared/ is blanked first; an invented or traversing
// `_shared/` path is not. Each rule has a boundary kind:
//   any  — matched anywhere: names no English word contains (github, cloudflare, ...);
//   pre  — matched where a word starts: after a non-letter (`_`, a digit, punctuation) or at a
//          camelCase hump (isGitHub, read_azure_runs);
//   tok  — a word start and a word end (a non-letter or a hump after it), for short names and
//          names that are also English words (gh, aws, drone, nix);
//   raw  — the regex carries its own boundaries.
// AC8.1 (reads and calls), .js files only, over comment-stripped text: any child_process use, any
// spawn-family call, any network module (require or dynamic import), fetch(, process.binding(, a
// forge CLI literal, a manifest or lockfile named in a literal, and a read call (readFile,
// readFileSync, createReadStream, open, openSync) whose arguments name a source-code file by
// extension. A read of a path held in a variable is allowed: the CLI reads its own
// --gather/--findings/--issues files that way.
// Recall limits: a name assembled from two literals or reached through a computed key; an
// all-lowercase run where a `pre`/`tok` name follows another lowercase letter (`viadocker`);
// a member `.exec(` (RegExp.prototype.exec shares the name; a bare exec( and any child_process
// require are flagged); a source-file read whose path literal sits in a variable declared
// elsewhere; a directory walk (readdir/readdirSync) over a source tree; a dynamic import of a
// computed specifier; bare Harness, Renovate and quay (English words: only product forms are
// denied); Depot, Namespace and ADO (ordinary words or too short); workflow_dispatch and the
// other workflow-syntax keys, which the skill legitimately reads.
const REPO = path.join(__dirname, '..');
const SKILL_DIR = path.join(REPO, 'plugin', 'skills', 'ci-health');
const SHARED_DIR = path.join(REPO, 'plugin', 'skills', '_shared');
const LIB_DIR = path.join(REPO, 'plugin', 'bin', 'lib', 'ci-audit');
const CLI = path.join(REPO, 'plugin', 'bin', 'ci-audit.js');
const EXEMPT = path.join(LIB_DIR, 'source.js');
const toPosix = (p) => p.split(path.sep).join('/');

const ci = (s) => new RegExp(s, 'gi');
const cs = (s) => new RegExp(s, 'g');
const DENYLIST = [
  ['forge', ci('github|gitlab|bitbucket|codeberg'), 'any'],
  ['forge', ci('gitea'), 'pre'],
  ['forge CLI', ci('gh'), 'tok'],
  ['forge CLI env', cs('GH_[A-Z0-9_]*[A-Z0-9]'), 'tok'],
  ['forge', cs('GHES'), 'tok'],
  ['forge', ci('forgejo'), 'any'],
  ['forge registry', ci('ghcr|quay\\.io|jfrog'), 'any'],
  ['forge registry', cs('ECR'), 'tok'],
  ['CI product', ci('circleci|buildkite|appveyor|codefresh|bitrise|buildjet|buildbot|codemagic'), 'any'],
  // One-word product names no English word contains; the spaced forms are case-sensitive below.
  ['CI product', ci('codebuild|cloudbuild|codepipeline|codedeploy|codecommit|blacksmith|cirrus[ -]?ci|earthfile|earthly\\/'), 'pre'],
  // "earthly" is an English adjective: the capitalized product name only.
  ['CI product', cs('Earthly'), 'tok'],
  // Harness's product forms only: the bare word is this plugin's own vocabulary (harness-health).
  ['CI product', ci('harness(?:\\.io|[ -]?ci|[ -]?cd)'), 'tok'],
  ['CI product', ci('github[ -]?actions|gitlab[ -]?ci|circle[ -]?ci|jenkins|travis|azure[ -]?pipelines|team[ -]?city|bitbucket[ -]?pipelines|app[ -]?veyor|tekton|woodpecker'), 'pre'],
  // `semaphore` and `drone` alone are English words (product forms only); `argo` is a token.
  ['CI product', ci('gha|drone[ -]?ci|semaphore[ -]?ci|semaphoreci|bamboo|concourse|argo(?:cd)?'), 'tok'],
  // Product spellings only: "the code build step" and "a cloud build" are ordinary phrases.
  ['CI product', cs('Code[ -]Build|Code[ -]Pipeline|Cloud[ -]Build'), 'tok'],
  // The product's own nouns, case-sensitive, so the word "actions" and "Next Actions" stay clean.
  ['CI product', cs('Actions[ ]+(?:[Ww]orkflow|[Tt]ab|[Rr]unner|[Mm]inute|[Jj]ob|[Ss]tep|[Cc]ache|[Ss]ecret|[Ll]og)s?'), 'tok'],
  ['hosted runner', ci('ubuntu(?:-[a-z0-9.]+)?|macos-(?:latest|\\d[a-z0-9.]*)|windows-(?:latest|\\d{4})|self[ -]?hosted|runs-on'), 'tok'],
  ['hosted runner', ci('microsoft'), 'pre'],
  ['cache service', ci('actions\\/cache|cache@v|sccache|turborepo|buildkit'), 'any'],
  ['cache service', ci('ccache|bazel|turbo[ -]?repo|nx[ _-]?cloud|turbo[ -]?cache|registry[ -]?cache|type=registry|docker|artifactory'), 'pre'],
  ['cache service', ci('s3|gcs|nix'), 'tok'],
  ['cloud vendor', ci('cloudflare|digitalocean|heroku|vercel|netlify'), 'any'],
  ['cloud vendor', ci('amazon|google|azure|digital[ -]?ocean'), 'pre'],
  ['cloud vendor', ci('aws|gcp'), 'tok'],
  ['dependency bot', ci('dependabot|renovatebot'), 'any'],
  // Renovate's product forms only: a bare sentence-initial Renovate is an English verb.
  ['dependency bot', ci('renovate(?:bot|\\[bot\\]|\\.json|config|-config)'), 'pre'],
  // Workflow-syntax forms specific to one forge's CI.
  ['forge workflow syntax', ci('pull_request_target|\\$\\{\\{\\s*secrets'), 'raw'],
  // A workflow step reference (`actions/checkout`), never the English word "actions".
  ['forge step reference', ci('actions\\/[a-z]'), 'pre'],
];
const LOCATIONS = ['.github/workflows', '.gitlab-ci.yml', 'Jenkinsfile', '.circleci', 'azure-pipelines.yml',
  '.travis.yml', 'bitbucket-pipelines.yml', '.buildkite', '.drone.yml', '.woodpecker'];
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
const LOCATION_RULES = LOCATIONS.map((l) => ['workflow-file location', ci(`(?<![a-z0-9_-])${escapeRe(l)}`), 'raw']);

// This repository's workflows -> [{ file, text }]; tests inject a planted listing the same way.
function readWorkflowListing(root = REPO) {
  const dir = path.join(root, '.github', 'workflows');
  return fs.readdirSync(dir).filter((n) => /\.ya?ml$/.test(n)).map((file) => ({ file, text: readText(path.join(dir, file)) }));
}
// The plugin's own names: a workflow that runs one of its skills is named after the skill, and
// the skill naming itself is not a repository-specific name.
const normName = (n) => n.toLowerCase().replace(/[ _]+/g, '-');
const OWN_NAMES = new Set([...fs.readdirSync(path.join(REPO, 'plugin', 'skills')), 'ci-audit', 'ci-health'].map(normName));
// Every workflow file basename, plus every hyphenated stem and every top-level `name:` that is not
// one plain word (a bare `test` would match prose) and not one of the plugin's own names.
function repoWorkflowRules(listing = readWorkflowListing()) {
  const names = new Set();
  for (const { file, text } of listing) {
    names.add(file);
    const stem = file.replace(/\.ya?ml$/, '');
    const top = /^name:[ \t]*(['"]?)(.+?)\1[ \t]*$/m.exec(text);
    for (const n of [stem, top && top[2]]) {
      if (n && /[\s_-]/.test(n) && !OWN_NAMES.has(normName(n))) names.add(n);
    }
  }
  return [...names].map((n) => ['this repository\'s workflow', ci(`(?<![a-z0-9_.-])${escapeRe(n)}(?![a-z0-9_-])`), 'raw']);
}

const LETTER = /[A-Za-z]/;
const UP = /[A-Z]/;
const LO = /[a-z]/;
const startsWord = (t, i) => i === 0 || !LETTER.test(t[i - 1]) || (LO.test(t[i - 1]) && UP.test(t[i]));
const endsWord = (t, j) => j >= t.length || !LETTER.test(t[j]) || (/[a-z0-9]/.test(t[j - 1]) && UP.test(t[j]));
const BOUNDED = {
  any: () => true,
  raw: () => true,
  pre: (t, m) => startsWord(t, m.index),
  tok: (t, m) => startsWord(t, m.index) && endsWord(t, m.index + m[0].length),
};

const lineAt = (text, i) => text.slice(0, i).split('\n').length;
function matchRules(text, rules, file, clause) {
  const out = [];
  for (const [rule, re, kind = 'raw'] of rules) {
    for (const m of text.matchAll(re)) {
      if (BOUNDED[kind](text, m)) out.push({ clause, file, line: lineAt(text, m.index), rule, match: m[0] });
    }
  }
  return out;
}
const blankSharedCitations = (text) => text.replace(/_shared\/([a-z0-9-]+)\.md/g,
  (m, name) => (fs.existsSync(path.join(SHARED_DIR, `${name}.md`)) ? ' '.repeat(m.length) : m));

const SOURCE_EXT = /\.(?:[cm]?js|jsx|tsx?|py|go|rs|java|kt|rb|php|c|cc|cpp|h|hpp|cs|swift)(?![a-z0-9])/i;
const MANIFEST = /(?<![a-z0-9_.-])(?:package(?:-lock)?\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.ya?ml|bun\.lockb?|cargo\.(?:toml|lock)|go\.(?:mod|sum)|requirements[a-z0-9_.-]*\.txt|pipfile(?:\.lock)?|pyproject\.toml|poetry\.lock|gemfile(?:\.lock)?|pom\.xml|build\.gradle(?:\.kts)?|composer\.(?:json|lock))(?![a-z0-9_-])/gi;
const NET_MODULES = "['\"`](?:node:)?(?:https?|http2|net|dns|tls|dgram|undici)['\"`]";
const IO_KEEP = [
  ['child_process', /(?<![a-z0-9_])child_process(?![a-z0-9_])/g],
  ['network module', new RegExp(`(?<![\\w$])(?:require|import)\\(\\s*${NET_MODULES}\\s*\\)`, 'g')],
  ['forge CLI literal', /(['"`])gh(?:\1|\s)/g],
  ['manifest or lockfile', MANIFEST],
];
const IO_BLANK = [
  ['spawn call', /(?<![\w$])(?:spawn|spawnSync|execFile|execFileSync|execSync|fork)\s*\(|(?<![\w$.])exec\s*\(/g],
  ['network call', /(?<![\w$])fetch\s*\(|\bnew\s+(?:WebSocket|XMLHttpRequest)\b|\bprocess\s*\.\s*binding\s*\(/g],
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

// AC8.1 (forge-aware imports, #5757 I6): a module's own text can be agnostic while a module it
// requires names the forge, resolves its host or spawns — and prints that knowledge through it
// (repo-resolve's refusal names the forge and its CLI). So a relative require from a scanned file
// is an offender when its target is repo-resolve.js, anything under lib/ci-health/ (harness-health's
// forge reads), lib/init/ci-workflow-review.js (the workflow-file location), or any module whose
// comment-stripped text requires child_process or repo-resolve. One import is allowed by name:
// workflow-facts.js takes merge-verification.js's pure readWorkflowShape (that module also spawns
// for other callers). Recall limits: one level only (a forge-aware module two requires away is not
// seen), a computed or non-relative specifier, a require through a variable.
const LIB_ROOT = path.join(REPO, 'plugin', 'bin', 'lib');
const FORGE_SEAMS = new Set([path.join(LIB_ROOT, 'repo-resolve.js'), path.join(LIB_ROOT, 'init', 'ci-workflow-review.js')]);
const ALLOWED_FORGE_IMPORTS = { 'plugin/bin/lib/ci-audit/workflow-facts.js': new Set(['../merge-verification']) };
// The relative require sites across the scanned files when this rule landed; fewer means the
// matcher stopped matching, not that the imports went away.
const REQUIRE_FLOOR = 20;
const REQUIRE_REL =/(?<![\w$])require\s*\(\s*(['"`])(\.{1,2}\/[^'"`]+)\1\s*\)/g;
function resolveModule(from, spec) {
  const base = path.resolve(from, spec);
  for (const c of [base, `${base}.js`, path.join(base, 'index.js')]) if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
  return null;
}
function forgeAwareReason(target) {
  if (target === null) return 'unresolvable module';
  if (target === EXEMPT) return null; // the one sanctioned adapter: its text is relayed as adapter text
  if (FORGE_SEAMS.has(target)) return 'a forge seam';
  if (path.relative(path.join(LIB_ROOT, 'ci-health'), target).split(path.sep)[0] !== '..') return 'a forge read module';
  const text = stripComments(readText(target));
  if (/(?<![\w$])require\s*\(\s*['"`](?:node:)?child_process['"`]\s*\)/.test(text)) return 'a module that spawns';
  if (/(?<![\w$])require\s*\(\s*['"`][^'"`]*repo-resolve['"`]\s*\)/.test(text)) return 'a module that resolves the forge host';
  return null;
}

// One scan for every file: the positive walk and every go-red control call this. Relative requires
// resolve against `from` (a planted copy in a scratch directory resolves as its original would).
// -> { offenders, readSites, requireSites }
function scanFile(abs, rel, repoRules, from = path.dirname(abs)) {
  const text = readText(abs);
  const offenders = matchRules(blankSharedCitations(text), [...DENYLIST, ...LOCATION_RULES, ...repoRules], rel, 'names');
  if (!abs.endsWith('.js')) return { offenders, readSites: 0, requireSites: 0 };
  const keep = stripComments(text);
  const blank = stripComments(text, { literals: 'blank' });
  for (const [mode, stripped] of [['keep', keep], ['blank', blank]]) {
    const verdict = stripperVerdict(text, stripped);
    if (verdict !== 'ok') offenders.push({ clause: 'io', file: rel, line: 0, rule: `stripper (${mode})`, match: STRIPPER_VERDICT_MESSAGES[verdict] });
  }
  offenders.push(...matchRules(keep, IO_KEEP, rel, 'io'), ...matchRules(blank, IO_BLANK, rel, 'io'));
  let readSites = 0;
  for (const m of blank.matchAll(READ_CALL)) {
    readSites++;
    const args = balancedArgs(keep, m.index + m[0].length - 1);
    if (SOURCE_EXT.test(args)) offenders.push({ clause: 'io', file: rel, line: lineAt(keep, m.index), rule: 'source-file read', match: m[0] + args + ')' });
  }
  let requireSites = 0;
  const allowed = ALLOWED_FORGE_IMPORTS[rel] || new Set();
  for (const m of keep.matchAll(REQUIRE_REL)) {
    requireSites++;
    if (allowed.has(m[2])) continue;
    const why = forgeAwareReason(resolveModule(from, m[2]));
    if (why !== null) offenders.push({ clause: 'io', file: rel, line: lineAt(keep, m.index), rule: 'forge-aware import', match: `${m[2]} (${why})` });
  }
  return { offenders, readSites, requireSites };
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
  ...walk(LIB_DIR).filter((f) => f.endsWith('.js') && f !== EXEMPT),
  CLI,
].map((abs) => ({ abs, rel: toPosix(path.relative(REPO, abs)) }));

function scanTree() {
  const rules = repoWorkflowRules();
  let offenders = [];
  let readSites = 0;
  let requireSites = 0;
  for (const { abs, rel } of scanned()) {
    const r = scanFile(abs, rel, rules);
    offenders = offenders.concat(r.offenders);
    readSites += r.readSites;
    requireSites += r.requireSites;
  }
  return { offenders, readSites, requireSites };
}
const show = (os_) => os_.map((o) => `${o.file}:${o.line} ${o.rule}: ${o.match}`).join('\n');
const nameRules = (os_) => os_.filter((o) => o.clause === 'names');
const ioRules = (os_) => os_.filter((o) => o.clause === 'io');

// An independent recursive listing, posix-relative to the repo, for the floor's expected set.
function listRel(rel) {
  const out = [];
  for (const e of fs.readdirSync(path.join(REPO, rel), { withFileTypes: true })) {
    const child = `${rel}/${e.name}`;
    if (e.isDirectory()) out.push(...listRel(child));
    else if (e.isFile()) out.push(child);
  }
  return out;
}

test('floor: the scan covers every skill file, every ci-audit module but source.js, and the CLI', () => {
  const lib = listRel('plugin/bin/lib/ci-audit').filter((n) => n.endsWith('.js'));
  assert.ok(lib.includes('plugin/bin/lib/ci-audit/source.js'), 'source.js is gone: the exemption names a file that no longer exists');
  const expected = [
    ...listRel('plugin/skills/ci-health'),
    ...lib.filter((n) => n !== 'plugin/bin/lib/ci-audit/source.js'),
    'plugin/bin/ci-audit.js',
  ].sort();
  const got = scanned().map((f) => f.rel).sort();
  assert.deepEqual(got, expected);
  assert.ok(got.length >= 10, `only ${got.length} files scanned; fewer than 10 means the walk lost files`);
  assert.ok(repoWorkflowRules().length >= 8, 'fewer than 8 repository workflow names: the repository clause is reading nothing');
});

test('AC7.1: no CI product, hosted runner, cache service, cloud vendor, forge, repository workflow or workflow-file location is named outside source.js', () => {
  const found = nameRules(scanTree().offenders);
  assert.deepEqual(found, [], `vendor-specific names outside source.js:\n${show(found)}`);
});

test('AC8.1: nothing outside source.js spawns, uses the network, names the forge CLI, or reads source, lockfile or manifest files', () => {
  const { offenders, readSites, requireSites } = scanTree();
  const found = ioRules(offenders);
  assert.deepEqual(found, [], `reads or calls outside source.js:\n${show(found)}`);
  assert.ok(readSites >= 2, `only ${readSites} read call sites matched (the CLI has 2): the read matcher stopped matching`);
  assert.ok(requireSites >= REQUIRE_FLOOR, `only ${requireSites} relative require sites matched: the import matcher stopped matching`);
});

// --- go-red self-tests: the same scanFile over planted copies of real files ---

test('control: the exempt source.js, scanned the same way, trips both clauses', () => {
  const { offenders } = scanFile(EXEMPT, 'source.js', repoWorkflowRules());
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
function plant(t, srcAbs, extra, name, rules = repoWorkflowRules()) {
  const f = path.join(scratch(t), name || path.basename(srcAbs));
  fs.writeFileSync(f, readText(srcAbs) + extra);
  return scanFile(f, 'fixture', rules, path.dirname(srcAbs)).offenders;
}
const baseLines = (abs) => readText(abs).split('\n').length;
const rows = (found, n) => found.map((o) => [o.line - n, o.rule, o.match]).sort();

test('AC7.2: a denylisted name planted in a copy of a real module is reported, in code or in a comment; the unplanted copy is not', (t) => {
  const mod = path.join(LIB_DIR, 'phases.js');
  assert.deepEqual(plant(t, mod, ''), [], 'control: the unplanted copy reports nothing');
  const found = plant(t, mod, "\nconst RUNNER = 'ubuntu-latest';\nconst HOST = 'GitHub Actions';\n// read from azure\n");
  assert.deepEqual(rows(found, baseLines(mod)), [
    [1, 'hosted runner', 'ubuntu-latest'], [2, 'CI product', 'GitHub Actions'], [2, 'forge', 'GitHub'], [3, 'cloud vendor', 'azure'],
  ]);
});

test('AC7.2: names inside identifiers, env names and the wider product list are reported', (t) => {
  const mod = path.join(LIB_DIR, 'checks.js');
  const plants = [
    'const isGitHub = 1, readGithubRuns = 2, fetch_gitlab_runs = 3, viaBitbucket = 4;', // 1
    'const onAzureHost = 1, AWS_REGION = 2, useDockerCache = 3;', // 2
    "const t = process.env.GH_TOKEN || process.env.GH_HOST || 'GHA';", // 3
    "const img = 'ghcr.io/x'; // Docker Hub, Microsoft-hosted", // 4
    '// the Actions runner, GCS, Dependabot, renovate[bot], Bitrise, Harness CI, BuildJet, Blacksmith, Artifactory, Nix', // 5
    '// CodeBuild, CodePipeline, Cloud Build, Code Build', // 6
    'const codebuild = 1, cloudBuild = 2, codepipeline = 3, codedeploy = 4, codecommit = 5; // cloudbuild.yaml', // 7
    'const s3Bucket = 1, NX_CLOUD = 2, nx_cloud = 3, renovateConfig = 4, blacksmithRunner = 5, isGHES = 6, turboCache = 7;', // 8
    "const u = 'harness.io', v = 'blacksmith-4vcpu', harnessCi = 1; // Actions Workflow, Actions Runner Controller", // 9
    '// ECR, quay.io, JFrog, Cirrus CI, Forgejo, Earthly, Buildbot, Codemagic, pull_request_target, ${{ secrets.X }}', // 10
  ];
  const found = plant(t, mod, `\n${plants.join('\n')}\n`);
  assert.deepEqual(rows(found, baseLines(mod)), [
    [1, 'forge', 'Bitbucket'], [1, 'forge', 'GitHub'], [1, 'forge', 'Github'], [1, 'forge', 'gitlab'],
    [2, 'cache service', 'Docker'], [2, 'cloud vendor', 'AWS'], [2, 'cloud vendor', 'Azure'],
    [3, 'CI product', 'GHA'], [3, 'forge CLI env', 'GH_HOST'], [3, 'forge CLI env', 'GH_TOKEN'], [3, 'forge CLI', 'GH'], [3, 'forge CLI', 'GH'],
    [4, 'cache service', 'Docker'], [4, 'forge registry', 'ghcr'], [4, 'hosted runner', 'Microsoft'],
    [5, 'CI product', 'Actions runner'], [5, 'CI product', 'Bitrise'], [5, 'CI product', 'Blacksmith'], [5, 'CI product', 'BuildJet'],
    [5, 'cache service', 'Artifactory'], [5, 'cache service', 'GCS'], [5, 'cache service', 'Nix'], [5, 'dependency bot', 'Dependabot'],
    [5, 'CI product', 'Harness CI'], [5, 'dependency bot', 'renovate[bot]'],
    [6, 'CI product', 'Cloud Build'], [6, 'CI product', 'Code Build'], [6, 'CI product', 'CodeBuild'], [6, 'CI product', 'CodePipeline'],
    [7, 'CI product', 'cloudBuild'], [7, 'CI product', 'cloudbuild'], [7, 'CI product', 'codebuild'], [7, 'CI product', 'codecommit'],
    [7, 'CI product', 'codedeploy'], [7, 'CI product', 'codepipeline'],
    [8, 'CI product', 'blacksmith'], [8, 'cache service', 'NX_CLOUD'], [8, 'cache service', 'nx_cloud'], [8, 'cache service', 's3'],
    [8, 'cache service', 'turboCache'], [8, 'dependency bot', 'renovateConfig'], [8, 'forge', 'GHES'],
    [9, 'CI product', 'Actions Runner'], [9, 'CI product', 'Actions Workflow'], [9, 'CI product', 'blacksmith'], [9, 'CI product', 'harness.io'],
    [9, 'CI product', 'harnessCi'],
    [10, 'CI product', 'Buildbot'], [10, 'CI product', 'Cirrus CI'], [10, 'CI product', 'Codemagic'], [10, 'CI product', 'Earthly'],
    [10, 'forge registry', 'ECR'], [10, 'forge registry', 'JFrog'], [10, 'forge registry', 'quay.io'], [10, 'forge', 'Forgejo'],
    [10, 'forge workflow syntax', '${{ secrets'], [10, 'forge workflow syntax', 'pull_request_target'],
  ].sort());
});

test('AC7.2: ordinary words that share letters with a denylisted name are not reported', (t) => {
  const md = path.join(SKILL_DIR, 'checklist.md');
  assert.deepEqual(plant(t, md, ''), []);
  const ok = [
    "## Next Actions",
    "## Allowed Steps",
    "## Harness",
    "Harness-health owns that check.",
    "The Harness section lists the runner.",
    "the harness, the test harness, `harness-health`, `/claude-tweaks:harness-health`, a harness for the parser.",
    "Renovate the checklist before the next release.",
    "renovate the flow when the runner process changes.",
    "the actions it takes, the code build step, a cloud build, the code pipeline stage.",
    "Record unix timestamps in milliseconds; Unix time is the reference.",
    "A semaphore bounds the concurrency; semaphores are cheap.",
    "Run it nightly; a nightly window is fine.",
    "the runner process exits; a runner pool is shared.",
    "Report the cache hit ratio and the cache miss count.",
    "the cache, jobsCache, cacheKey, a warm cache.",
    "high, highest, ghost, ghostly, Ghosts, sigh, laughs, the night shift.",
    "laws, draws, jaws, paws, cargo, Argon, arguments, argue.",
    "drones, a drone of noise, bamboos, phoenix, nixed, onyx.",
    "docket, gcsx, s3cret, s3x, ecru, secrets in a vault, a secret value.",
    "windows, a window, macOS-like hosts, a hosted service, self-contained.",
    "earth, the earth, unearthly, an earthly concern, earthbound, quay side, a depot, a namespace.",
    "concurrency groups, a concurrency key, a dependency on the build.",
    "Each step declares a command; a step with no command counts as setup.",
    "waiting, setup and running phases per job.",
    "the critical path, a shard, shard skew, the slowest shard.",
    "repeated work across jobs; a step repeated in five jobs.",
    "missing timeout, a declared timeout, a timeout margin.",
    "workflow files, a workflow file, the workflow-files directory.",
    "job names, step names, workflow names are untrusted.",
    "pull requests, a pull request, the request target.",
    "the queue wait, a queue, queueing time.",
    "environment preparation, a prebuilt image, prepared dependencies.",
    "the forge CLI, the forge, a forge write, the hosted runner service.",
    "Next actions follow; Allowed steps follow.",
    "actions, Actions, the Actions list, actions taken.",
    "a build kit, a toolkit, a kitchen.",
    "a smith, black text, a locksmith.",
    "code review, code health, code paths, cloud costs.",
    "microservice, micro-benchmarks, soft limits.",
    "azul, azimuth, amazing, a goggle.",
    "nightly-free prose, release notes, test plans.",
    "the CI health check, a CI health sweep, CI timing.",
    "p50 and p90 figures in milliseconds.",
    "the gather report, the findings file, the issue index.",
    "born-ready, risk:low, size:low.",
    "a remedy direction, not a product.",
    "the threshold override, the default threshold.",
    "shells, ghosts, highs, thighs, weights.",
    "Sigh: highly ghostlike lights.",
    "the end.",
  ];
  assert.ok(ok.length >= 50, 'the ordinary-prose twin keeps at least 50 lines');
  const okText = ok.join('\n');
  assert.deepEqual(plant(t, md, `\n${okText}\n`), [], 'ordinary words are not vendor names');
});

test('AC7.2: a planted name in a copy of checklist.md is reported', (t) => {
  const md = path.join(SKILL_DIR, 'checklist.md');
  const found = plant(t, md, '\nUse a github runner with sccache on AWS, or `actions/checkout`.\n');
  assert.deepEqual(rows(found, baseLines(md)), [
    [1, 'cache service', 'sccache'], [1, 'cloud vendor', 'AWS'], [1, 'forge step reference', 'actions/c'], [1, 'forge', 'github'],
  ]);
});

test('the _shared/ carve-out blanks only a citation of an existing contract', (t) => {
  const md = path.join(SKILL_DIR, 'checklist.md');
  assert.ok(fs.existsSync(path.join(SHARED_DIR, 'github-write-transport.md')), 'the pinned contract moved');
  assert.deepEqual(plant(t, md, '\nSee `_shared/github-write-transport.md`.\n'), []);
  const found = plant(t, md, '\nSee `_shared/github-actions-cache.md`, `_shared/../../github-x.md` and the github API.\n');
  assert.deepEqual(rows(found, baseLines(md)), [
    [1, 'CI product', 'github-actions'], [1, 'forge', 'github'], [1, 'forge', 'github'], [1, 'forge', 'github'],
  ]);
});

test('AC7.1 go-red: a hard-coded workflow-file location and a repository workflow name are reported', (t) => {
  const mod = path.join(LIB_DIR, 'checks.js');
  const found = plant(t, mod, "\nconst A = '.gitlab-ci.yml';\nconst B = 'test-perf.yml';\nconst C = 'release-please';\n");
  assert.deepEqual(rows(found, baseLines(mod)), [
    [1, 'CI product', 'gitlab-ci'], [1, 'forge', 'gitlab'], [1, 'workflow-file location', '.gitlab-ci.yml'],
    [2, 'this repository\'s workflow', 'test-perf'], [2, 'this repository\'s workflow', 'test-perf.yml'],
    [3, 'this repository\'s workflow', 'release-please'],
  ]);
});

test('a repository workflow named after one of the plugin\'s skills (any case, spaces or underscores) denies only its file name', (t) => {
  const listing = [...readWorkflowListing(), { file: 'ci-health.yml', text: 'name: ci-health\non:\n  schedule: []\n' },
    { file: 'nightly-docs.yml', text: 'name: docs-health nightly\n' },
    { file: 'audit.yml', text: 'name: CI Health\n' }, { file: 'audit2.yml', text: 'name: "CI health"\n' },
    { file: 'ci_health.yml', text: 'name: Nightly Bench\n' }];
  const rules = repoWorkflowRules(listing);
  for (const { abs, rel } of scanned()) assert.deepEqual(nameRules(scanFile(abs, rel, rules).offenders), [], rel);
  const found = plant(t, path.join(SKILL_DIR, 'SKILL.md'), '\nSee ci-health.yml, nightly-docs, docs-health nightly and the Nightly Bench run.\n', 'SKILL.md', rules);
  assert.deepEqual(rows(found, baseLines(path.join(SKILL_DIR, 'SKILL.md'))), [
    [1, 'this repository\'s workflow', 'Nightly Bench'], [1, 'this repository\'s workflow', 'ci-health.yml'],
    [1, 'this repository\'s workflow', 'docs-health nightly'], [1, 'this repository\'s workflow', 'nightly-docs'],
  ]);
});

test('AC8.1 go-red: each banned read or call planted in a copy of the CLI is reported on its line', (t) => {
  assert.deepEqual(plant(t, CLI, ''), []);
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
    "import('node:dns');",
    "import('undici');",
    "process.binding('tcp_wrap');",
    "import('node:child_process');",
  ];
  const found = plant(t, CLI, `\n${plants.join('\n')}\n`, 'ci-audit.js');
  assert.deepEqual(found.map((o) => [o.line - baseLines(CLI), o.rule]).sort(), [
    [1, 'child_process'], [2, 'spawn call'], [3, 'spawn call'], [4, 'network module'], [5, 'network call'],
    [6, 'forge CLI'], [6, 'forge CLI literal'], [7, 'manifest or lockfile'], [8, 'source-file read'], [9, 'manifest or lockfile'],
    [11, 'network module'], [12, 'network module'], [13, 'network call'], [14, 'child_process'],
  ].sort());
});

test('I6 go-red: a forge-aware import planted in a copy of the CLI or a module is reported; source.js and the allowed import are not', (t) => {
  const plants = [
    "const { gateOriginRepo } = require('./lib/repo-resolve');",
    "const { errorText } = require('./lib/ci-health/fetch');",
    "const { readWorkflowSet } = require('./lib/init/ci-workflow-review');",
    "const mv = require('./lib/merge-verification');",
    "const s = require('./lib/ci-audit/source');",
    "const g = require('./lib/strip-comments'); // pure: no spawn, no host",
  ];
  const found = plant(t, CLI, `\n${plants.join('\n')}\n`, 'ci-audit.js').filter((o) => o.rule === 'forge-aware import');
  assert.deepEqual(found.map((o) => [o.line - baseLines(CLI), o.match]), [
    [1, './lib/repo-resolve (a forge seam)'],
    [2, './lib/ci-health/fetch (a forge read module)'],
    [3, './lib/init/ci-workflow-review (a forge seam)'],
    [4, './lib/merge-verification (a module that spawns)'],
  ]);
  // The allowed import is allowed for workflow-facts.js only: the same line elsewhere is flagged.
  const mod = path.join(LIB_DIR, 'checks.js');
  const other = plant(t, mod, "\nconst { readWorkflowShape } = require('../merge-verification');\n", 'checks.js')
    .filter((o) => o.rule === 'forge-aware import');
  assert.deepEqual(other.map((o) => o.match), ['../merge-verification (a module that spawns)']);
});

test('I6 go-red: the pre-fix CLI, which imported repo-resolve and ci-health modules, is reported', (t) => {
  const d = scratch(t);
  const f = path.join(d, 'ci-audit.js');
  fs.writeFileSync(f, [
    "'use strict';",
    "const { originUrl, gateOriginRepo, pinExplicitRepoHost } = require('./lib/repo-resolve');",
    "const { DEFAULT_DAYS, MAX_DAYS } = require('./lib/ci-health/constants');",
    "const { errorText } = require('./lib/ci-health/fetch');",
    "const { oneLine } = require('./lib/ci-health/render');",
    "const source = require('./lib/ci-audit/source');",
    '',
  ].join('\n'));
  const found = scanFile(f, 'fixture', [], path.dirname(CLI)).offenders.filter((o) => o.rule === 'forge-aware import');
  assert.deepEqual(found.map((o) => o.line), [2, 3, 4, 5]);
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
