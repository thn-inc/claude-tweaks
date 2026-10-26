'use strict';
// tests/payload-boundary.test.js — the `plugin/` payload is self-contained.
//
// Enforces the invariant `docs/decisions/0015-plugin-payload-boundary-is-the-plugin-subtree.md`
// establishes structurally but does not itself enforce: everything a running skill or hook can
// reach must ship inside `plugin/` (a `git-subdir` install copies only that subtree — nothing
// at the repo root reaches an installed cache; see ADR-0015's "Root content is excluded from
// the install by the copy step" paragraph). Four static, read-only assertions, no plugin code
// executed:
//
//   (a) every `${CLAUDE_PLUGIN_ROOT}`-relative path referenced in `plugin/**/*.md` and
//       `plugin/hooks/hooks.json`, in an *executable* context, resolves to a real file inside
//       `plugin/`.
//   (b) every `require()` call in `plugin/bin/**/*.js` with a string-literal argument resolves
//       inside `plugin/` (Node builtins exempt); any `require()` with a non-literal argument is
//       itself a failure, listed by file:line.
//   (c) no directory named `tests` exists anywhere under `plugin/`.
//   (d) no lockfile (`package-lock.json`, `npm-shrinkwrap.json`, `bun.lock`) exists under
//       `plugin/` — the installer auto-runs dependency install when one is present, which would
//       violate the zero-runtime-deps policy CLAUDE.md's Stack table states.
//
// Symlink semantics (Technical Approach, spec #419): a symlink under `plugin/` whose target
// resolves outside `plugin/` is a hard failure of (a)/(b), never a silent skip. Every resolution
// helper below walks through `fs.realpathSync` and compares the REAL path against `plugin/`'s
// own real path, not just the nominal joined path — a symlink pointing outside is caught the
// same way a dangling reference is.
//
// Extraction heuristic for (a) (defined here, per spec #419 — not invented at build time): a
// `${CLAUDE_PLUGIN_ROOT}` reference counts as executable when it appears either outside any
// fenced code block, or inside a fenced block whose language tag is `bash`/`sh`/`json` — the
// contexts skills actually execute from. A path segment that is itself a `{placeholder}` (e.g.
// `${CLAUDE_PLUGIN_ROOT}/skills/{template}/routine-template.yml`, `{BINARY}`,
// `{record.template}`) is a per-consumer substitution token, not a concrete file reference —
// this repo's own pervasive `{n}`/`{owner}`/`{repo}`-style placeholder convention (see
// materialize.md's header format for the same pattern) — so a path containing one is excluded
// from the resolution requirement rather than reported as dangling.
//
// Both (a) and (b) additionally apply Node's own require() extension-fallback (`X`, `X.js`,
// `X.json`, `X/index.js`) before declaring a reference dangling: a large share of the real
// corpus is `require('${CLAUDE_PLUGIN_ROOT}/bin/lib/...')`-shaped text with no explicit
// extension, which Node resolves at runtime exactly this way. Checking only the literal string
// would report every one of those as a false failure. The fallback only ever turns a failure
// into a pass when a real file backs one of the four candidate paths — it cannot mask a
// genuinely wrong reference, since nothing else on disk shares that name.
//
// BOUNDARY_ALLOW (below): specific, reviewed exceptions the two heuristics above don't cover.
// Each entry needs a non-empty `reason` (asserted by this file) and is reviewable in diff. This
// is for genuine illustrative/deliberate-design exceptions only — a reference that turns out to
// be a real dangling boundary violation gets fixed at the source, never allowlisted (see the
// version-check.md and hooks.js fixes this same record made once this suite surfaced them).

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const Module = require('node:module');
const { readText } = require('./helpers/read-skill');
const { toPosix } = require('../plugin/bin/lib/shared-primitives');

const ROOT = path.join(__dirname, '..');
const PLUGIN_DIR = path.join(ROOT, 'plugin');
const BUILTINS = new Set(Module.builtinModules);

// ── BOUNDARY_ALLOW ──────────────────────────────────────────────────────────

const BOUNDARY_ALLOW = [
  {
    file: 'plugin/skills/init/bootstrap/version-check.md',
    pattern: '${CLAUDE_PLUGIN_ROOT}/CHANGELOG.md',
    reason:
      'CHANGELOG.md is a dev-side file at the repo root, outside plugin/ (CLAUDE.md\'s Structure ' +
      "table; ADR-0015's \"Root content is excluded from the install by the copy step\" — a " +
      "git-subdir install never ships a copy). The Changelog notice snippet this line sits in " +
      'guards the read with fs.existsSync first and treats a miss as a silent, informational ' +
      'skip (the record #419 build added that guard) — the reference is a deliberate ' +
      "best-effort probe of a path this build knows is absent for every installed user, not an " +
      'oversight.',
  },
  {
    file: 'plugin/bin/lib/statusline-wrapper-source.js',
    pattern: 'require(target)',
    reason:
      "This file is a TEMPLATE (bin/install-statusline-wrapper.js's TEMPLATE_PATH) copied out " +
      "to the user's ~/.claude config directory at install time and run there as an independent " +
      'process — it is never require()d into a running plugin session. Its one dynamic require ' +
      "deliberately loads whichever cached plugin version is newest at RUNTIME ('so settings.json " +
      "never needs to be updated on plugin upgrades', per its own header comment) — the target " +
      'is, by design, a sibling version directory outside this build\'s own plugin/ root, and ' +
      'cannot be a string literal since the newest version is unknown until the wrapper runs.',
  },
];

for (const entry of BOUNDARY_ALLOW) {
  test(`BOUNDARY_ALLOW entry for ${entry.file} carries a real reason`, () => {
    assert.strictEqual(typeof entry.reason, 'string');
    assert.ok(entry.reason.trim().length >= 20, 'BOUNDARY_ALLOW reason must not be empty/placeholder');
  });
}

function isAllowed(relFile, rawText) {
  return BOUNDARY_ALLOW.some((e) => e.file === relFile && rawText.includes(e.pattern));
}

// ── Shared resolution helper (symlink- and extension-fallback-aware) ───────

function realpathOrNull(p) {
  try {
    return fs.realpathSync(p);
  } catch {
    return null;
  }
}

const PLUGIN_REAL = realpathOrNull(PLUGIN_DIR);

// Resolves `arg` (a require()-style specifier, relative or plugin-root-anchored) against
// `baseDir`. Tries the literal path, then Node's own extension-fallback candidates. A candidate
// only counts as resolved when its REAL path (symlinks followed) is `baseDir`'s plugin root or
// beneath it — never a bare fs.existsSync on the nominal path, which a symlink could satisfy
// while actually pointing outside `plugin/`.
function resolveInsidePlugin(baseDir, arg, pluginRootReal) {
  const candidates = [arg, `${arg}.js`, `${arg}.json`, path.join(arg, 'index.js')];
  for (const rel of candidates) {
    const abs = path.resolve(baseDir, rel);
    if (!fs.existsSync(abs)) continue;
    const real = realpathOrNull(abs);
    if (real === null) continue; // exists per lstat but realpath failed (broken symlink) — not resolved
    const inside = pluginRootReal !== null && (real === pluginRootReal || real.startsWith(pluginRootReal + path.sep));
    return { found: true, insidePlugin: inside };
  }
  return { found: false, insidePlugin: false };
}

function hasPlaceholderSegment(relPath) {
  return relPath.split('/').some((seg) => seg.includes('{') || seg.includes('}'));
}

// ── (a) Markdown / hooks.json reference extraction ──────────────────────────

function findAllMdFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...findAllMdFiles(full));
    else if (entry.name.endsWith('.md')) out.push(full);
  }
  return out;
}

const PLUGIN_ROOT_PATH_RE = /\$\{CLAUDE_PLUGIN_ROOT\}(\/[A-Za-z0-9._\-/{}]*)?/g;
const FENCE_RE = /^\s*```(\S*)/;
const TRAILING_PUNCT_RE = /[.,;:)`>\\]+$/; // no real filename in this repo ends in these

// Returns [{ lineNumber, token, suffix }] for every executable `${CLAUDE_PLUGIN_ROOT}/...`
// occurrence in `text`, honoring the fenced-code-block heuristic above. `isJson` treats the
// whole file as executable (hooks.json has no markdown fences to track).
function scanMarkdownReferences(text, isJson) {
  const lines = text.split('\n');
  let inFence = false;
  let fenceLang = '';
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!isJson) {
      const fenceMatch = FENCE_RE.exec(line);
      if (fenceMatch) {
        if (!inFence) {
          inFence = true;
          fenceLang = fenceMatch[1].toLowerCase();
        } else {
          inFence = false;
          fenceLang = '';
        }
        continue;
      }
    }
    if (!line.includes('CLAUDE_PLUGIN_ROOT')) continue;
    const executable = isJson || !inFence || ['bash', 'sh', 'json'].includes(fenceLang);
    if (!executable) continue;
    let m;
    PLUGIN_ROOT_PATH_RE.lastIndex = 0;
    while ((m = PLUGIN_ROOT_PATH_RE.exec(line))) {
      const token = m[0];
      const rawSuffix = m[1] || '';
      const suffix = rawSuffix.replace(TRAILING_PUNCT_RE, '');
      if (suffix.length <= 1) continue; // bare `${CLAUDE_PLUGIN_ROOT}` or trailing `/` only — nothing to resolve
      out.push({ lineNumber: i + 1, token, suffix });
    }
  }
  return out;
}

// ── (b) require() call extraction (hand-rolled lexer) ───────────────────────
//
// A regex over raw source text cannot distinguish a real `require('./x')` call from the same
// text sitting inside a comment (`// require('./lib/hooks/' + event)`, documenting the pattern)
// or a string literal building unrelated shell text (`'node -e "...require(\'fs\')..."'`) — both
// occur for real in this tree. This lexer tracks comment/string state so only require() calls
// that are actually live code get reported. It is deliberately narrow (not a full JS parser):
// it only needs to find `require(`, skip trivia, and either read a single immediately-closing
// string-literal argument (literal) or capture raw text to the matching close-paren (dynamic).

function findRequireCalls(text) {
  const results = [];
  const n = text.length;
  let i = 0;

  const isIdentChar = (c) => /[A-Za-z0-9_$]/.test(c);

  function skipTrivia(idx) {
    for (;;) {
      const c = text[idx];
      if (c === undefined) return idx;
      if (c === ' ' || c === '\t' || c === '\r' || c === '\n') {
        idx++;
        continue;
      }
      if (c === '/' && text[idx + 1] === '/') {
        idx += 2;
        while (idx < n && text[idx] !== '\n') idx++;
        continue;
      }
      if (c === '/' && text[idx + 1] === '*') {
        idx += 2;
        while (idx < n && !(text[idx] === '*' && text[idx + 1] === '/')) idx++;
        idx += 2;
        continue;
      }
      return idx;
    }
  }

  function scanQuoted(idx) {
    const q = text[idx];
    const start = idx + 1;
    let j = start;
    let hasInterpolation = false;
    while (j < n) {
      const c = text[j];
      if (c === '\\') {
        j += 2;
        continue;
      }
      if (q === '`' && c === '$' && text[j + 1] === '{') {
        hasInterpolation = true;
        j += 2;
        let depth = 1;
        while (j < n && depth > 0) {
          if (text[j] === '{') depth++;
          else if (text[j] === '}') depth--;
          j++;
        }
        continue;
      }
      if (c === q) break;
      j++;
    }
    return { end: j + 1, raw: text.slice(start, j), hasInterpolation };
  }

  function scanArg(idx) {
    const argStart = idx;
    const c = text[idx];
    if (c === '"' || c === "'" || c === '`') {
      const { end, raw, hasInterpolation } = scanQuoted(idx);
      const after = skipTrivia(end);
      if (!hasInterpolation && text[after] === ')') {
        return { kind: 'literal', value: raw, end: after + 1 };
      }
    }
    let depth = 1;
    let j = argStart;
    while (j < n && depth > 0) {
      const ch = text[j];
      if (ch === '"' || ch === "'" || ch === '`') {
        j = scanQuoted(j).end;
        continue;
      }
      if (ch === '/' && text[j + 1] === '/') {
        while (j < n && text[j] !== '\n') j++;
        continue;
      }
      if (ch === '/' && text[j + 1] === '*') {
        j += 2;
        while (j < n && !(text[j] === '*' && text[j + 1] === '/')) j++;
        j += 2;
        continue;
      }
      if (ch === '(') depth++;
      else if (ch === ')') {
        depth--;
        if (depth === 0) break;
      }
      j++;
    }
    return { kind: 'dynamic', value: text.slice(argStart, j), end: j + 1 };
  }

  while (i < n) {
    const c = text[i];
    if (c === '/' && text[i + 1] === '/') {
      i += 2;
      while (i < n && text[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && text[i + 1] === '*') {
      i += 2;
      while (i < n && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      i = scanQuoted(i).end;
      continue;
    }
    if (c === 'r' && text.slice(i, i + 7) === 'require') {
      const prev = text[i - 1];
      const next = text[i + 7];
      const boundaryBefore = prev === undefined || !isIdentChar(prev);
      const boundaryAfter = next === undefined || !isIdentChar(next);
      if (boundaryBefore && boundaryAfter) {
        const afterName = skipTrivia(i + 7);
        if (text[afterName] === '(') {
          const lineNumber = 1 + text.slice(0, i).split('\n').length - 1;
          const argIdx = skipTrivia(afterName + 1);
          const { kind, value, end } = scanArg(argIdx);
          results.push({ lineNumber, kind, value });
          i = end;
          continue;
        }
      }
    }
    i++;
  }
  return results;
}

function findAllJsFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...findAllJsFiles(full));
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

// ── (c) / (d) directory and lockfile sweeps ─────────────────────────────────

const LOCKFILE_NAMES = new Set(['package-lock.json', 'npm-shrinkwrap.json', 'bun.lock']);

function findDirsNamed(dir, name, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const full = path.join(dir, entry.name);
    if (entry.name === name) out.push(full);
    findDirsNamed(full, name, out);
  }
  return out;
}

function findLockfiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      findLockfiles(full, out);
    } else if (LOCKFILE_NAMES.has(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

// ── Proof each check can go red (synthetic fixtures — per skill-prose-conformance-tests'
//    go-red guidance; the real corpus is swept separately below) ───────────

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'payload-boundary-'));
}

test('scanMarkdownReferences: flags a reference outside any fence', () => {
  const refs = scanMarkdownReferences('See `${CLAUDE_PLUGIN_ROOT}/bin/foo.js` for details.', false);
  assert.strictEqual(refs.length, 1);
  assert.strictEqual(refs[0].suffix, '/bin/foo.js');
});

test('scanMarkdownReferences: flags a reference inside a bash fence', () => {
  const text = '```bash\nnode "${CLAUDE_PLUGIN_ROOT}/bin/foo.js"\n```';
  assert.strictEqual(scanMarkdownReferences(text, false).length, 1);
});

test('scanMarkdownReferences: does NOT flag a reference inside a non-bash/sh/json fence (illustrative)', () => {
  const text = '```text\nExample: ${CLAUDE_PLUGIN_ROOT}/bin/foo.js\n```';
  assert.deepStrictEqual(scanMarkdownReferences(text, false), []);
});

test('scanMarkdownReferences: hooks.json is treated as fully executable (isJson=true)', () => {
  const text = '{ "command": "node \\"${CLAUDE_PLUGIN_ROOT}/bin/hooks.js\\" session-start" }';
  assert.strictEqual(scanMarkdownReferences(text, true).length, 1);
});

test('resolveInsidePlugin: a real file resolves', () => {
  const root = tmp();
  fs.mkdirSync(path.join(root, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(root, 'bin', 'real.js'), 'module.exports = {};\n');
  const result = resolveInsidePlugin(root, './bin/real.js', realpathOrNull(root));
  assert.strictEqual(result.found, true);
  assert.strictEqual(result.insidePlugin, true);
});

test('resolveInsidePlugin: a dangling path does not resolve (proof this check can go red)', () => {
  const root = tmp();
  fs.mkdirSync(path.join(root, 'bin'), { recursive: true });
  const result = resolveInsidePlugin(root, './bin/does-not-exist.js', realpathOrNull(root));
  assert.strictEqual(result.found, false);
});

test('resolveInsidePlugin: extension-fallback resolves an extensionless require() target', () => {
  const root = tmp();
  fs.mkdirSync(path.join(root, 'lib'), { recursive: true });
  fs.writeFileSync(path.join(root, 'lib', 'digest.js'), 'module.exports = {};\n');
  const result = resolveInsidePlugin(root, './lib/digest', realpathOrNull(root));
  assert.strictEqual(result.found, true);
  assert.strictEqual(result.insidePlugin, true);
});

test('resolveInsidePlugin: a symlink whose target escapes the plugin root is a hard failure (proof this check can go red)', () => {
  const root = tmp();
  const outside = tmp();
  fs.writeFileSync(path.join(outside, 'secret.js'), 'module.exports = {};\n');
  fs.mkdirSync(path.join(root, 'bin'), { recursive: true });
  fs.symlinkSync(path.join(outside, 'secret.js'), path.join(root, 'bin', 'escape.js'));
  const result = resolveInsidePlugin(root, './bin/escape.js', realpathOrNull(root));
  assert.strictEqual(result.found, true, 'the symlink itself exists and is followed');
  assert.strictEqual(result.insidePlugin, false, 'but its real target is outside the plugin root');
});

test('resolveInsidePlugin: a symlink whose target stays inside the plugin root resolves', () => {
  const root = tmp();
  fs.mkdirSync(path.join(root, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(root, 'bin', 'real.js'), 'module.exports = {};\n');
  fs.symlinkSync(path.join(root, 'bin', 'real.js'), path.join(root, 'bin', 'alias.js'));
  const result = resolveInsidePlugin(root, './bin/alias.js', realpathOrNull(root));
  assert.strictEqual(result.insidePlugin, true);
});

test('hasPlaceholderSegment: flags a `{token}` path segment, passes a concrete one', () => {
  assert.strictEqual(hasPlaceholderSegment('bin/{BINARY}'), true);
  assert.strictEqual(hasPlaceholderSegment('skills/{template}/routine-template.yml'), true);
  assert.strictEqual(hasPlaceholderSegment('bin/lib/issues/record.js'), false);
});

test('findRequireCalls: reports a real literal require() call', () => {
  const calls = findRequireCalls("const x = require('./lib/foo.js');\n");
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].kind, 'literal');
  assert.strictEqual(calls[0].value, './lib/foo.js');
  assert.strictEqual(calls[0].lineNumber, 1);
});

test('findRequireCalls: ignores require() text inside a // comment', () => {
  const calls = findRequireCalls("// require('./lib/hooks/' + event) is the pattern to avoid\nconst y = 1;\n");
  assert.deepStrictEqual(calls, []);
});

test('findRequireCalls: ignores require() text inside a /* */ comment', () => {
  const calls = findRequireCalls('/* require("../../../etc/passwd") */\nconst y = 1;\n');
  assert.deepStrictEqual(calls, []);
});

test('findRequireCalls: ignores require() text embedded inside an unrelated string literal', () => {
  const calls = findRequireCalls("lines.push('node -e \"const fs=require(\\'fs\\')\"');\n");
  assert.deepStrictEqual(calls, []);
});

test('findRequireCalls: flags a dynamic (non-literal) require() argument by file:line (proof this check can go red)', () => {
  const calls = findRequireCalls("function loadModule(event) { return require('./lib/hooks/' + event); }\n");
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].kind, 'dynamic');
  assert.strictEqual(calls[0].value, "'./lib/hooks/' + event");
});

test('findRequireCalls: a template literal without interpolation is treated as a literal', () => {
  const calls = findRequireCalls('const x = require(`./lib/foo.js`);\n');
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].kind, 'literal');
});

test('findRequireCalls: a template literal WITH interpolation is dynamic', () => {
  const calls = findRequireCalls('const x = require(`./lib/${name}.js`);\n');
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].kind, 'dynamic');
});

test('findDirsNamed: flags a `tests` directory under the scanned root (proof this check can go red)', () => {
  const root = tmp();
  fs.mkdirSync(path.join(root, 'bin', 'tests'), { recursive: true });
  assert.strictEqual(findDirsNamed(root, 'tests').length, 1);
});

test('findDirsNamed: a clean tree has no matches', () => {
  const root = tmp();
  fs.mkdirSync(path.join(root, 'bin'), { recursive: true });
  assert.deepStrictEqual(findDirsNamed(root, 'tests'), []);
});

test('findLockfiles: flags a lockfile under the scanned root (proof this check can go red)', () => {
  const root = tmp();
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, 'package-lock.json'), '{}');
  assert.strictEqual(findLockfiles(root).length, 1);
});

test('findLockfiles: a clean tree has no matches', () => {
  const root = tmp();
  fs.writeFileSync(path.join(root, 'package.json'), '{}');
  assert.deepStrictEqual(findLockfiles(root), []);
});

// ── Live-corpus sweeps ───────────────────────────────────────────────────────

test('(a) every executable ${CLAUDE_PLUGIN_ROOT}-relative reference in plugin/**/*.md and plugin/hooks/hooks.json resolves inside plugin/', () => {
  const files = [...findAllMdFiles(PLUGIN_DIR), path.join(PLUGIN_DIR, 'hooks', 'hooks.json')];
  const failures = [];
  for (const file of files) {
    const isJson = file.endsWith('hooks.json');
    const text = readText(file);
    // Compared against a /-keyed allowlist, so it is a display ID (#4288).
    const relFile = toPosix(path.relative(ROOT, file));
    for (const ref of scanMarkdownReferences(text, isJson)) {
      if (hasPlaceholderSegment(ref.suffix)) continue;
      if (isAllowed(relFile, ref.token)) continue;
      const { found, insidePlugin } = resolveInsidePlugin(PLUGIN_DIR, `.${ref.suffix}`, PLUGIN_REAL);
      if (!found || !insidePlugin) {
        failures.push(`${relFile}:${ref.lineNumber} — ${ref.token} does not resolve inside plugin/`);
      }
    }
  }
  assert.deepStrictEqual(failures, [], `dangling \${CLAUDE_PLUGIN_ROOT} reference(s):\n${failures.join('\n')}`);
});

test('(b) every require() in plugin/bin/**/*.js resolves inside plugin/ — no dynamic requires outside BOUNDARY_ALLOW', () => {
  const files = findAllJsFiles(path.join(PLUGIN_DIR, 'bin'));
  const failures = [];
  for (const file of files) {
    const text = readText(file);
    // Compared against a /-keyed allowlist, so it is a display ID (#4288).
    const relFile = toPosix(path.relative(ROOT, file));
    const baseDir = path.dirname(file);
    for (const call of findRequireCalls(text)) {
      const rawText = `require(${call.value})`;
      if (call.kind === 'dynamic') {
        if (isAllowed(relFile, rawText)) continue;
        failures.push(`${relFile}:${call.lineNumber} — dynamic require() argument: ${call.value}`);
        continue;
      }
      const arg = call.value;
      if (BUILTINS.has(arg) || BUILTINS.has(arg.replace(/^node:/, ''))) continue;
      if (!arg.startsWith('.') && !arg.startsWith('/')) {
        failures.push(`${relFile}:${call.lineNumber} — bare specifier '${arg}' (npm dependency? plugin ships zero runtime deps)`);
        continue;
      }
      if (isAllowed(relFile, rawText)) continue;
      const { found, insidePlugin } = resolveInsidePlugin(baseDir, arg, PLUGIN_REAL);
      if (!found) {
        failures.push(`${relFile}:${call.lineNumber} — require('${arg}') does not resolve to a file`);
      } else if (!insidePlugin) {
        failures.push(`${relFile}:${call.lineNumber} — require('${arg}') resolves outside plugin/`);
      }
    }
  }
  assert.deepStrictEqual(failures, [], `require() boundary violation(s):\n${failures.join('\n')}`);
});

test('(c) no directory named `tests` exists under plugin/', () => {
  const hits = findDirsNamed(PLUGIN_DIR, 'tests').map((d) => path.relative(ROOT, d));
  assert.deepStrictEqual(hits, [], `tests/ dir(s) found under plugin/: ${hits.join(', ')}`);
});

test('(d) no lockfile exists under plugin/', () => {
  const hits = findLockfiles(PLUGIN_DIR).map((f) => path.relative(ROOT, f));
  assert.deepStrictEqual(hits, [], `lockfile(s) found under plugin/: ${hits.join(', ')}`);
});
