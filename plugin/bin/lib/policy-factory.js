// bin/lib/policy-factory.js — the factory policy layer's reader (#6006).
//
// The factory layer resolves below a repo's .claude-tweaks/policy.yml and above the
// schema default (CLAUDE_TWEAKS_FACTORY_POLICY over ~/.claude-tweaks/factory-policy.yml,
// merged per key). ONLY this module reads that variable or that file: callers get one
// merged policy text (`raw`) and feed it to resolvePolicyKeys as `factoryRaw`. Refusing
// keys a factory may not set (FACTORY_REFUSED_KEYS) is the resolver's job, not this
// module's — `raw` still carries them. Warnings are returned, never written to stderr.
'use strict';
const fs = require('fs');
const path = require('path');
const { POLICY_KEYS, RENAMED_KEYS, parseDriverModels, parseFlatLines } = require('./policy-schema');
const { modelProfilesEntry } = require('./model-profiles/policy-fragment');

const FACTORY_POLICY_ENV = 'CLAUDE_TWEAKS_FACTORY_POLICY';
const FACTORY_POLICY_REL_PATH = '.claude-tweaks/factory-policy.yml';
// Names another factory file in place of ~/FACTORY_POLICY_REL_PATH; tools/run-tests.js sets it for every suite.
const FACTORY_POLICY_FILE_ENV = 'CT_FACTORY_POLICY_FILE';
// Keys a factory layer may never set: each is a per-run human decision or an executed
// command, so a user-wide file or variable must not stand in for it.
const FACTORY_REFUSED_KEYS = ['merge-authorization', 'control-mode', 'deploy-command', 'release-hook'];

const KEY_LINE = /^["']?([A-Za-z0-9_.-]+)["']?\s*:/;

// A chunk is a column-0 `key:` line (the key may be quoted) plus every following
// blank, comment or indented line, up to the next column-0 non-comment line. Lines
// before the first key are dropped; trailing blank lines are not part of a chunk.
function splitTopLevelChunks(text) {
  const chunks = [];
  let current = null;
  const close = () => {
    if (current === null) return;
    while (current.lines.length > 1 && current.lines[current.lines.length - 1].trim() === '') current.lines.pop();
    chunks.push({ key: current.key, text: `${current.lines.join('\n')}\n` });
    current = null;
  };
  for (const line of String(text).split('\n')) {
    const columnZero = line !== '' && !/^\s/.test(line);
    if (columnZero && !line.startsWith('#')) {
      close();
      const match = KEY_LINE.exec(line);
      if (match) current = { key: match[1], lines: [line] };
    } else if (current !== null) {
      current.lines.push(line);
    }
  }
  close();
  return chunks;
}

// The name a chunk's key merges under: a renamed key maps to its replacement, a
// retired one (replacedBy: null) keeps its own name. The chunk text is never
// rewritten, so the resolver still migrates the old spelling and tags renamed-from.
function canonicalKey(key) {
  const entry = RENAMED_KEYS.find((alias) => alias.key === key);
  return entry && entry.replacedBy ? entry.replacedBy : key;
}

// Every chunk of a key is kept, in order, so the resolver applies its own within-source
// rules (a new name beats its alias, a second map block is invalid): the merge runs after
// the resolver's RENAMED_KEYS normalization, not instead of it. Map keeps first-appearance order.
// A flat chunk the resolver's parseFlatLines does not see (an empty value, a quoted key) sets nothing, so it is
// left out and never hides the other source's value; a map key's chunk is the block parsers' to judge.
function byCanonicalKey(text) {
  const map = new Map();
  for (const chunk of splitTopLevelChunks(text)) {
    const key = canonicalKey(chunk.key);
    if (!isMapKey(key) && !Object.prototype.hasOwnProperty.call(parseFlatLines(chunk.text), chunk.key)) continue;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(chunk);
  }
  return map;
}

function isMapKey(key) {
  const entry = POLICY_KEYS.find((candidate) => candidate.key === key);
  return Boolean(entry) && entry.type === 'map';
}

// A variable's map block that would not parse is dropped for the file's. risk-path-globs
// is never judged here: its rows are checked against risk-categories, which only the
// resolver can see.
function isMalformedMapBlock(key, chunks) {
  if (!isMapKey(key)) return false;
  const text = chunks.map((chunk) => chunk.text).join('\n');
  if (key === 'express-driver-models') return parseDriverModels(text).ok === false;
  if (key === 'model-profiles') return modelProfilesEntry(text).invalid === true;
  return false;
}

// The factory file's path and the name its warning shows: FACTORY_POLICY_FILE_ENV from the injected env when set
// (the CT_HOOKS_REPO_INFO_STORE precedent, so a test run never reads the machine's own file; a relative value turns
// the file off rather than resolving against the cwd), else the file under the home directory. null: no file.
function factoryFilePath(env, homeDir) {
  const override = env[FACTORY_POLICY_FILE_ENV];
  if (typeof override === 'string' && override !== '') return path.isAbsolute(override) ? { file: override, shown: override } : null;
  let home;
  try {
    home = typeof homeDir === 'function' ? homeDir() : env.HOME || env.USERPROFILE;
  } catch {
    return null; // a home lookup that throws (os.homedir() with no HOME and no passwd entry) is no home: no file, never thrown
  }
  return home ? { file: path.join(home, FACTORY_POLICY_REL_PATH), shown: `~/${FACTORY_POLICY_REL_PATH}` } : null;
}

function readFactoryFile(env, homeDir, readFile) {
  const located = factoryFilePath(env, homeDir);
  if (located === null) return { text: null, warning: null };
  try {
    return { text: readFile(located.file), warning: null };
  } catch (err) {
    if (err && err.code === 'ENOENT') return { text: null, warning: null };
    const code = (err && err.code) || 'UNKNOWN';
    return { text: null, warning: `resolve-policy: warning: could not read ${located.shown} (${code}) — factory file ignored\n` };
  }
}

// -> { raw: string|null, origin: 'env'|'file'|'env+file'|null, warnings: string[] }
function readFactoryPolicy({ env = process.env, homeDir, readFile = (p) => fs.readFileSync(p, 'utf8') } = {}) {
  const warnings = [];
  const fromEnv = typeof env[FACTORY_POLICY_ENV] === 'string' && env[FACTORY_POLICY_ENV].trim() !== '' ? env[FACTORY_POLICY_ENV] : null;
  const file = readFactoryFile(env, homeDir, readFile);
  if (file.warning) warnings.push(file.warning);
  const fromFile = file.text !== null && file.text.trim() !== '' ? file.text : null;

  if (fromEnv === null && fromFile === null) return { raw: null, origin: null, warnings };
  if (fromFile === null) return { raw: fromEnv, origin: 'env', warnings };
  if (fromEnv === null) return { raw: fromFile, origin: 'file', warnings };

  const envChunks = byCanonicalKey(fromEnv);
  const fileChunks = byCanonicalKey(fromFile);
  const winners = []; // { from, chunks }
  for (const [key, chunks] of envChunks) {
    const dropped = fileChunks.has(key) && isMalformedMapBlock(key, chunks) && !isMalformedMapBlock(key, fileChunks.get(key));
    if (dropped) {
      warnings.push(`resolve-policy: warning: ${key} has invalid value "${chunks[0].text.split('\n')[0].trimEnd()}" in ${FACTORY_POLICY_ENV} — using ~/${FACTORY_POLICY_REL_PATH}'s block\n`);
      winners.push({ from: 'file', chunks: fileChunks.get(key) });
    } else {
      winners.push({ from: 'env', chunks });
    }
  }
  for (const [key, chunks] of fileChunks) if (!envChunks.has(key)) winners.push({ from: 'file', chunks });

  // origin names the sources that supplied a winning chunk; when only one did, its text
  // is the answer verbatim.
  const sources = new Set(winners.map((winner) => winner.from));
  if (sources.size === 0) return { raw: null, origin: null, warnings };
  if (sources.size === 1) return sources.has('env') ? { raw: fromEnv, origin: 'env', warnings } : { raw: fromFile, origin: 'file', warnings };
  const raw = `${winners.flatMap((winner) => winner.chunks).map((chunk) => chunk.text.replace(/\n$/, '')).join('\n')}\n`;
  return { raw, origin: 'env+file', warnings };
}

module.exports = { FACTORY_POLICY_ENV, FACTORY_POLICY_FILE_ENV, FACTORY_POLICY_REL_PATH, FACTORY_REFUSED_KEYS, readFactoryPolicy, splitTopLevelChunks };
