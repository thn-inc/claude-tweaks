'use strict';
// bin/lib/release-local/manifest.js — byte-preserving version edits for the
// local release engine (#2254). The stack → manifest mapping cites
// skills/init/bootstrap/step-21-release.md's table (code twin
// RELEASE_STACK_TABLE in bin/lib/init/release-bootstrap.js); the engine reads
// the bootstrap-written release-please-config.json rather than re-detecting.
// Every edit is a raw string splice of the version token — never
// JSON.parse+stringify, never a TOML re-emit — so a release diff shows one
// token per file (spec: byte-preserving AC).

const path = require('path');

// Only genuine path absence reads as "no version here". A bad ref (`invalid
// object name`) is a git error and propagates — unlike manifest-path.js's
// NOT_FOUND_ERROR_RE, which folds both because its callers key on the
// distinction downstream. (Plan ruling 8: Task 3's implementer caught the
// brief's original NOT_FOUND_ERROR_RE reuse contradicting its own test.)
const PATH_ABSENT_RE = /does not exist|exists on disk, but not in/i;

// `path.posix.isAbsolute` does not see a Windows drive letter or a UNC share.
const WINDOWS_ABSOLUTE_RE = /^[A-Za-z]:|^\\\\/;

const CONFIG_FILE = 'release-please-config.json';
const MANIFEST_FILE = '.release-please-manifest.json';
const SEMVER = '\\d+\\.\\d+\\.\\d+';
// Stack manifests by release-type (step-21-release.md's table). go has no
// manifest (tag only); java/ruby/dotnet need per-project version files the
// local engine does not model — point them at `simple` + extra-files.
const STACK_TARGETS = {
  node: [{ path: 'package.json', kind: 'json' }, { path: 'package-lock.json', kind: 'json-lock', optional: true }],
  php: [{ path: 'composer.json', kind: 'json' }],
  // step-21-release.md selects `python` from pyproject.toml OR setup.py, so every
  // marker it can select on has to be a target — a setup.py-only repo would
  // otherwise fail every release on a required pyproject.toml it never had. All
  // three are optional; resolveTargets turns that into a one-of requirement.
  python: [
    { path: 'pyproject.toml', kind: 'toml', sections: ['project', 'tool.poetry'], optional: true },
    { path: 'setup.py', kind: 'py-assign', optional: true },
    { path: 'setup.cfg', kind: 'toml', sections: ['metadata'], unquoted: true, optional: true },
  ],
  rust: [{ path: 'Cargo.toml', kind: 'toml', sections: ['package'] }],
  go: [],
  simple: [{ path: 'version.txt', kind: 'text', create: true }],
};
const UNSUPPORTED = new Set(['java', 'ruby', 'dotnet']);

class ManifestError extends Error {}

function readConfig(readFile) {
  const text = readFile(CONFIG_FILE);
  if (text === null || text === undefined) return null;
  let cfg;
  try { cfg = JSON.parse(text); } catch (e) { throw new ManifestError(`${CONFIG_FILE} is not valid JSON: ${e.message}`); }
  const pkg = (cfg.packages && cfg.packages['.']) || {};
  const releaseType = pkg['release-type'] || cfg['release-type'] || null;
  const extraFiles = pkg['extra-files'] || cfg['extra-files'] || [];
  if (!releaseType) throw new ManifestError(`${CONFIG_FILE} names no release-type for package "."`);
  return { releaseType, extraFiles };
}

function extraFileTarget(entry) {
  if (typeof entry === 'string') return { path: entry, kind: 'generic' };
  if (entry && entry.type === 'json') {
    if (entry.jsonpath !== '$.version') throw new ManifestError(`extra-files jsonpath ${entry.jsonpath} is unsupported — the local engine splices $.version only`);
    return { path: entry.path, kind: 'json' };
  }
  throw new ManifestError(`extra-files entry of type ${entry && entry.type} is unsupported by the local engine (json or a generic x-release-please-version path)`);
}

function resolveTargets({ releaseType, extraFiles = [] }) {
  if (UNSUPPORTED.has(releaseType)) {
    throw new ManifestError(`release-type ${releaseType} manifest edits are unsupported by the local engine — use release-type simple with extra-files naming the version-bearing file`);
  }
  const stack = STACK_TARGETS[releaseType];
  if (!stack) throw new ManifestError(`unknown release-type ${releaseType}`);
  // A stack whose every manifest is optional (python) still needs ONE of them to
  // carry a version — `oneOf` names the set so applyVersion can say so before writing.
  const oneOf = stack.length > 0 && stack.every((t) => t.optional) ? stack.map((t) => t.path) : null;
  const stackTargets = oneOf ? stack.map((t) => ({ ...t, oneOf })) : stack;
  // extra-files names paths the engine writes; the config must not be able to
  // point those outside the repo it is releasing. The check is on path SEGMENTS,
  // not a prefix: `..hidden.json` is an ordinary (if odd) filename inside the
  // root, while `..`, `../x`, `/abs/x` and the Windows drive/UNC forms are not.
  const extras = extraFiles.map(extraFileTarget);
  for (const target of extras) {
    const normalized = path.posix.normalize(String(target.path));
    const escapes = normalized === '..' || normalized.startsWith('../')
      || path.posix.isAbsolute(normalized) || WINDOWS_ABSOLUTE_RE.test(normalized);
    if (escapes) throw new ManifestError(`extra-files path escapes the repo root: ${target.path}`);
  }
  return [{ path: MANIFEST_FILE, kind: 'manifest', optional: true }, ...stackTargets, ...extras];
}

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function spliceMatch(text, re, to, group) {
  const m = re.exec(text);
  if (!m) return { text, found: false, previous: null };
  const start = m.index + m[0].indexOf(m[group], m[1].length);
  return { text: text.slice(0, start) + to + text.slice(start + m[group].length), found: true, previous: m[group] };
}

// Structural, not first-occurrence: a `"version"` nested in an earlier object
// (`{"publishConfig": {"version": "9.9.9"}, "version": "1.2.0"}`) is a different
// key, and a regex that takes the first hit bumps the wrong token. Walk the text
// tracking string state (with escapes) and brace/bracket depth, and accept the
// key only as a string token at object depth `depth` — 1 for a whole file's root
// object, 0 for the packages[""] slice spliceJsonLock hands over (its text
// already begins inside that object).
const JSON_VERSION_VALUE_RE = new RegExp(`^\\s*:\\s*"(${SEMVER})"`);

function spliceJsonKey(text, key, to, { depth = 1 } = {}) {
  let level = 0;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"') {
      const open = i;
      i += 1;
      while (i < text.length && text[i] !== '"') i += text[i] === '\\' ? 2 : 1;
      const token = text.slice(open + 1, i);
      i += 1;
      if (level !== depth || token !== key) continue;
      const m = JSON_VERSION_VALUE_RE.exec(text.slice(i));
      if (!m) continue;
      const at = i + m[0].length - 1 - m[1].length;
      return { text: text.slice(0, at) + to + text.slice(at + m[1].length), found: true, previous: m[1] };
    }
    if (ch === '{' || ch === '[') level += 1;
    else if (ch === '}' || ch === ']') level -= 1;
    i += 1;
  }
  return { text, found: false, previous: null };
}

// package-lock.json: the root "version" plus, on lockfileVersion 2/3, the
// packages[""] entry's own "version" — never a dependency's. A v1 lockfile
// has no packages block, and a blind second occurrence there would be the
// first dependency's pin (ruling 9, Task 3 review). The packages[""] search
// is bounded by the first "node_modules/ key so an entry without a version
// cannot leak the match into a dependency either.
function spliceJsonLock(text, to) {
  const root = spliceJsonKey(text, 'version', to);
  const block = /"packages"\s*:\s*\{\s*""\s*:\s*\{/.exec(root.text);
  if (!block) return root;
  const at = block.index + block[0].length;
  const end = root.text.indexOf('"node_modules/', at);
  const scope = end === -1 ? root.text.slice(at) : root.text.slice(at, end);
  const inner = spliceJsonKey(scope, 'version', to, { depth: 0 });
  const rest = end === -1 ? '' : root.text.slice(end);
  return { text: root.text.slice(0, at) + inner.text + rest, found: root.found || inner.found, previous: root.previous };
}

// `unquoted` also accepts setup.cfg's bare INI value (`version = 1.2.0`); the
// backreference keeps a quoted value's closing quote matched to its opener.
function spliceToml(text, sections, to, { unquoted = false } = {}) {
  const quote = unquoted ? '["\']?' : '["\']';
  for (const section of sections) {
    const header = new RegExp(`^\\[${escapeRe(section)}\\][ \\t]*$`, 'm').exec(text);
    if (!header) continue;
    const bodyStart = header.index + header[0].length;
    const rest = text.slice(bodyStart);
    // A real TOML table header line only — any column-0 `[` (a multi-line
    // array's own continuation, e.g. a nested-array element) is not a section
    // boundary; a header both opens and closes its brackets on one line.
    const next = /^\[[^\]\n]*\][ \t]*$/m.exec(rest);
    const body = next ? rest.slice(0, next.index) : rest;
    const vm = new RegExp(`^([ \\t]*version[ \\t]*=[ \\t]*(${quote}))(${SEMVER})\\2`, 'm').exec(body);
    if (!vm) continue;
    const start = bodyStart + vm.index + vm[1].length;
    return { text: text.slice(0, start) + to + text.slice(start + vm[3].length), found: true, previous: vm[3] };
  }
  return { text, found: false, previous: null };
}

function spliceVersion(kind, text, to, opts = {}) {
  switch (kind) {
    case 'json': return spliceJsonKey(text, 'version', to);
    case 'json-lock': return spliceJsonLock(text, to);
    case 'manifest': return spliceJsonKey(text, '.', to);
    case 'toml': return spliceToml(text, opts.sections || [], to, opts);
    // The key has to BE `version`, not merely end in it: `min_version = "0.1.0"`
    // and `python_version = "3.8.0"` are commonplace in a setup.py and come first.
    // (setup.cfg's [metadata] line needs no equivalent — spliceToml anchors it to
    // start-of-line with optional indentation.)
    case 'py-assign': return spliceMatch(text, new RegExp(`((?<![\\w.])version\\s*=\\s*['"])(${SEMVER})(['"])`), to, 2);
    case 'text': {
      // release-please's `simple` strategy writes version.txt through
      // DefaultUpdater.updateContent, which returns `this.version + '\n'` —
      // the WHOLE file becomes the version plus one newline, regardless of
      // prior content. Byte-compatibility means matching that discard, not
      // preserving whatever else was there.
      if (text === null || text === undefined) return { text: `${to}\n`, found: false, previous: null };
      const m = new RegExp(SEMVER).exec(text);
      if (!m) return { text, found: false, previous: null };
      return { text: `${to}\n`, found: true, previous: m[0] };
    }
    case 'generic': {
      // release-please's generic updater rewrites the version token on EVERY
      // line carrying the annotation, not just the first; `previous` reports
      // the first rewritten line's token.
      let previous = null;
      const out = text.split('\n').map((line) => {
        if (!line.includes('x-release-please-version')) return line;
        const m = new RegExp(SEMVER).exec(line);
        if (!m) return line;
        if (previous === null) previous = m[0];
        return line.slice(0, m.index) + to + line.slice(m.index + m[0].length);
      });
      return { text: out.join('\n'), found: previous !== null, previous };
    }
    default: throw new ManifestError(`unknown manifest kind ${kind}`);
  }
}

function versionOfText(target, text) {
  if (text === null || text === undefined) return null;
  const probe = spliceVersion(target.kind, text, '0.0.0', target);
  return probe.found ? probe.previous : null;
}

// First target whose file carries a version token: manifest file, then the
// stack manifest, then extra-files. Absent files read as null; anything else
// the reader throws propagates (a git error is never "no version").
function firstVersion(targets, read) {
  for (const target of targets) {
    if (target.kind === 'generic') continue;
    let text;
    try {
      text = read(target.path);
    } catch (err) {
      if (PATH_ABSENT_RE.test(String(err.message || err))) continue;
      throw err;
    }
    const v = versionOfText(target, text);
    if (v !== null) return v;
  }
  return null;
}

function currentVersion(targets, readFile) { return firstVersion(targets, readFile); }
function versionAtRef(targets, show) { return firstVersion(targets, show); }

// Standalone (never shared with applyVersion's own body — its decision logic
// is duplicated here deliberately, W4/#2254): the paths a live run would
// actually write, for the dry-run plan's `manifest:` line. A present target
// whose text carries no version token is never written by applyVersion
// either (it refuses instead), so it must not be listed as if it would be.
function plannedWrites(targets, to, readFile) {
  const paths = [];
  for (const target of targets) {
    const text = readFile(target.path);
    const absent = text === null || text === undefined;
    if (absent && !target.create) continue; // optional-missing or required-missing: nothing written
    const out = spliceVersion(target.kind, text, to, target);
    if (!out.found && !target.create) continue; // present but tokenless, not a create target: applyVersion refuses this one
    if (out.text === text) continue; // no change
    paths.push(target.path);
  }
  return paths;
}

function applyVersion(targets, to, readFile, writeFile) {
  // Pre-pass, before any write: a one-of stack (python) with no member carrying a
  // version token is a misconfigured repo, and half a bumped manifest set on disk
  // is worse than nothing.
  const oneOf = targets.filter((t) => t.oneOf);
  if (oneOf.length && !oneOf.some((t) => versionOfText(t, readFile(t.path)) !== null)) {
    throw new ManifestError(`no stack manifest carried a version token (looked for ${oneOf[0].oneOf.join(', ')})`);
  }
  // Second pre-pass, still before any write: decide every target's fate from
  // its current text, so a refusal never lands after a sibling was written.
  const plan = [];
  for (const target of targets) {
    const text = readFile(target.path);
    const absent = text === null || text === undefined;
    if (absent && !target.create) {
      if (target.optional) continue;
      throw new ManifestError(`${target.path} is missing — the release-type names it as the manifest`);
    }
    const out = spliceVersion(target.kind, text, to, target);
    if (!out.found) {
      // A create target that already exists must carry the token it was
      // created with — a version.txt full of something else is not "absent",
      // and skipping it would ship a tag the file never reflects.
      if (target.create && !absent) throw new ManifestError(`${target.path} exists but carries no version token to bump`);
      // A one-of member without a token is fine when another member carries
      // it (the first pre-pass proved one does): a pyproject.toml that holds
      // only tool config beside a setup.cfg with the version.
      if (target.oneOf && !target.create) continue;
      if (!target.create) throw new ManifestError(`${target.path} carries no version token to bump`);
    }
    if (out.text === text) continue;
    plan.push({ target, text: out.text, previous: out.previous });
  }
  const written = [];
  for (const { target, text, previous } of plan) {
    writeFile(target.path, text);
    written.push({ path: target.path, previous });
  }
  return written;
}

module.exports = {
  CONFIG_FILE, MANIFEST_FILE, STACK_TARGETS, ManifestError,
  readConfig, resolveTargets, spliceVersion, currentVersion, versionAtRef, plannedWrites, applyVersion,
};
