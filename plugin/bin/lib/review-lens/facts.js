'use strict';

// Diff facts for review lens selection (#6001): the named, per-diff facts `select.js` reads to pick which of
// `/claude-tweaks:review` Step 3's lenses to dispatch. Pure computation over `git diff {base}...{head}`; no model.
//
// computeFacts({ cwd, base, head = 'HEAD', riskFlags = [], riskPolicy, git })
//   -> { ok: true, facts } | { ok: false, fact, reason }
// `fact` names the stage that failed: a FACT_NAMES entry or an internal derivation stage — `paths` (the name-status
// diff, so an unresolvable base lands here) and `addedLines` (the -U0 diff and its line parse). The caller treats any
// `ok: false` as "facts unavailable" and keeps the full tier set; it is never read as "no facts call for anything".
//
// facts: { paths: [{path, status, kind}], kinds: {prose, source, test, config, workflow} -> bool, executableContent,
//   shellInvocationAdded, inputHandlingAdded, errorHandlingTouched, riskPathTouched, riskFlags, newFiles, newModules,
//   perCallPath, loopSpawn }.
//
// Which lens reads which fact is select.js's APPLIES / CALLED_FOR; it is not restated here.
//
// executableContent — the definition is `plugin/skills/review/step3-tier-variants.md`'s "No executable content" (the
// `low`-tier skip): true when any changed path is not prose (.md/.markdown/.txt), or any changed line of a prose
// file — added or deleted (plan-review clarification: "changed line" covers deletions) — sits inside a fenced code
// block (an added line judged against the post-image's fences, a deleted line against the pre-image's), or reads as a
// command to run (`isExecutableProseLine`). Fence state comes from the whole file, never the -U0 hunk alone.
// shellInvocationAdded: an added source line spawns a process. inputHandlingAdded: an added source line reads
// argv/env/stdin/a file or joins a non-literal path. errorHandlingTouched: an added source line adds
// try/catch/throw/exit handling. These three read added lines of `source` files only.
// loopSpawn: a spawn line and an enclosing loop in a source file's post-image, at least one of the two added.
// perCallPath: a changed source path that runs on every hook or test call (PER_CALL_PATH_RES).
// newFiles / newModules: a path added (status A or C) / an added `source` file.
//
// riskPathTouched — Reading A (#6001 plan-review decision): any protected path (`express/eligibility.js`'s
// `isProtectedPath`), or any record Risk-flag, or — only when `riskPolicy.controlMode === true` — a path matching a
// `risk-path-globs` list (`issues/blast-radius.js`'s `isSensitivePath`). This mirrors `readRiskPolicy`
// (`plugin/bin/lib/policy.js`), which consults `risk-path-globs` only after `isControlModeOn`, as
// `plugin/bin/accept-park.js`'s `decide` does. `riskPolicy` is `readRiskPolicy`'s result, or `{ error }` when that
// read threw. With control mode off the globs are never consulted, so an invalid block is harmless there. With control
// mode on and `globsInvalid`, or on `{ error }`, the fact fails (`riskPathTouched`, reason names `risk-path-globs`).
//
// The git seam: `git(args) -> stdout`, throws on non-zero. Every regex is linear (no nested quantifiers).

const { execFileSync } = require('node:child_process');
const { parseNameStatusZ } = require('../git-z');
const { isProtectedPath } = require('../express/eligibility');
const { isSensitivePath } = require('../issues/blast-radius');

const FACT_NAMES = Object.freeze([
  'paths', 'kinds', 'executableContent', 'shellInvocationAdded', 'inputHandlingAdded', 'errorHandlingTouched',
  'riskPathTouched', 'riskFlags', 'newFiles', 'newModules', 'perCallPath', 'loopSpawn',
]);

const KIND_NAMES = Object.freeze(['prose', 'source', 'test', 'config', 'workflow']);
// How far above a spawn line a loop header is searched (and the converse for a header added around a spawn).
const LOOP_LOOKBACK_LINES = 40;
const PER_CALL_PATH_RES = [/(^|\/)hooks\.(?:js|sh)$/, /(^|\/)lib\/hooks\//, /(^|\/)tools\/run-tests\.js$/, /(^|\/)bin\/verify\.js$/];

const PROSE_EXT_RE = /\.(?:md|markdown|txt)$/i;
const WORKFLOW_RE = /(^|\/)\.github\/workflows\//;
const TEST_RE = /(^|\/)(?:tests?|__tests__|spec)\/|\.(?:test|spec)\.[cm]?[jt]sx?$/;
const SOURCE_EXT_RE = /\.(?:[cm]?[jt]sx?|py|rb|go|rs|java|kt|swift|php|sh|bash|zsh|ps1|c|h|cc|cpp)$/i;

function classifyPathKind(p) {
  if (PROSE_EXT_RE.test(p)) return 'prose';
  if (WORKFLOW_RE.test(p)) return 'workflow';
  if (TEST_RE.test(p)) return 'test';
  if (SOURCE_EXT_RE.test(p)) return 'source';
  return 'config';
}

// An executable prose line: step3-tier-variants.md's "a `git`, `gh`, or other shell invocation" — leading or backticked
// git/gh/npm/npx/bash/curl/any `node`/python/python3/pwsh/`sh -c`, a `node -e` anywhere, or a `$ ` prompt line. Alternations are fixed words; the backtick body is one negated class.
const CMD = '(?:git|gh|npm|npx|bash|curl|node|python3?|pwsh|sh\\s+-c)';
const LEADING_CMD_RE = new RegExp(`^[ \\t]*(?:\\$[ \\t]+)?${CMD}[ \\t]`);
const PROMPT_RE = /^[ \t]*\$[ \t]+\S/;
const BACKTICK_CMD_RE = new RegExp(`\`[ \\t]*(?:\\$[ \\t]+)?${CMD}\\b[^\`]*\``);
const NODE_E_RE = /\bnode[ \t]+-e\b/;

function isExecutableProseLine(line) {
  const s = String(line);
  return LEADING_CMD_RE.test(s) || PROMPT_RE.test(s) || BACKTICK_CMD_RE.test(s) || NODE_E_RE.test(s);
}

// A spawn: the child_process module, execFileSync/execSync/spawnSync/spawn/execFile on any receiver, and `exec(` bare or on a
// child_process receiver (`cp`, `childProcess`, `child_process`). Another receiver's `.exec(` (a RegExp) is not a spawn.
const SPAWN_RE = /\bchild_process\b|\b(?:execFileSync|execSync|spawnSync|spawn|execFile)\(|(?<![\w$.])exec\(|\b(?:cp|childProcess)\.exec\(/;
const GIT_ARGV_RE = /['"`](?:git|gh)['"`][ \t]*,/;
const INPUT_RE = /\bprocess\.(?:argv|env)\b|\breadFileSync\b|\bstdin\b/;
const PATH_CALL_RE = /\bpath\.(?:join|resolve)\(([^)]*)\)/g;
const STRING_LITERAL_RE = /^[ \t]*(['"`])[^'"`$]*\1[ \t]*$/;
const ERROR_RE = /\btry[ \t]*\{|\bcatch\b|\bthrow\s|\bprocess\.exit\b|\.catch\(/;
const LOOP_RE = /\b(?:for|while)[ \t]*\(|\bfor[ \t]+await[ \t]*\(|\.(?:forEach|map)\(/;

const isSpawnLine = (l) => SPAWN_RE.test(l) || GIT_ARGV_RE.test(l);
function handlesInput(l) {
  if (INPUT_RE.test(l)) return true;
  for (const m of l.matchAll(PATH_CALL_RE)) {
    if (m[1].split(',').some((arg) => !STRING_LITERAL_RE.test(arg))) return true;
  }
  return false;
}

// Leading indentation in columns, a tab advancing to the next multiple of 4 (CommonMark's tab stop).
function indentOf(l) {
  let col = 0;
  for (const ch of l.slice(0, l.length - l.trimStart().length)) col = ch === '\t' ? col + 4 - (col % 4) : col + 1;
  return col;
}

// Line numbers inside a fenced code block (markers included), CommonMark-style: a run of 3+ backticks or tildes opens,
// a run of the same char at least as long with nothing after it closes (an opener takes any indentation; a closer at most 3 more than its opener's, else it is content). An unclosed fence runs to the end.
// Any leading indentation is accepted: this repo's skill prose nests fences inside list items (4+ spaces). Lines split
// on \r?\n, so a CRLF file's trailing \r never hides a fence marker.
const FENCE_OPEN_RE = /^[ \t]*(`{3,}|~{3,})(.*)$/;
function fencedLineNumbers(text) {
  const inside = new Set();
  let open = null;
  let openIndent = 0;
  text.split(/\r?\n/).forEach((line, i) => {
    const n = i + 1;
    if (open === null) {
      const m = FENCE_OPEN_RE.exec(line);
      if (m && !(m[1][0] === '`' && m[2].includes('`'))) { open = m[1]; openIndent = indentOf(line); inside.add(n); }
      return;
    }
    inside.add(n);
    const m = FENCE_OPEN_RE.exec(line);
    if (m && m[1][0] === open[0] && m[1].length >= open.length && m[2].trim() === '' && indentOf(line) <= openIndent + 3) open = null;
  });
  return inside;
}

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

// Per `diff --git` section of a -U0 patch (context lines, which a user's `diff.interHunkContext` can add despite -U0, advance both counters): { added: [{n, text}], deleted: [{n, text}] }, n the post-/pre-image line.
function parsePatch(patch) {
  const sections = [];
  let cur = null;
  let oldN = 0;
  let newN = 0;
  let inHunk = false;
  for (const line of patch.split('\n')) {
    if (line.startsWith('diff --git ')) {
      cur = { added: [], deleted: [] };
      sections.push(cur);
      inHunk = false;
      continue;
    }
    if (cur === null) continue;
    const h = HUNK_RE.exec(line);
    if (h) {
      oldN = Number(h[1]);
      newN = Number(h[3]);
      inHunk = true;
    } else if (inHunk && line[0] === ' ') { oldN++; newN++; }
    else if (inHunk && line[0] === '+') cur.added.push({ n: newN++, text: line.slice(1) });
    else if (inHunk && line[0] === '-') cur.deleted.push({ n: oldN++, text: line.slice(1) });
  }
  return sections;
}

function defaultGit(cwd) {
  return (args) => execFileSync('git', ['-C', cwd, ...args], {
    encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
  });
}

// A spawn line with an enclosing loop header (walking the indentation ancestors upward, within the lookback), at least
// one of the two on an added line.
function hasLoopSpawn(text, addedNs) {
  const all = text.split(/\r?\n/);
  for (let i = 0; i < all.length; i++) {
    if (!isSpawnLine(all[i])) continue;
    const spawnAdded = addedNs.has(i + 1);
    if (LOOP_RE.test(all[i]) && spawnAdded) return true;
    let limit = indentOf(all[i]);
    for (let j = i - 1; j >= 0 && i - j <= LOOP_LOOKBACK_LINES; j--) {
      if (all[j].trim() === '' || indentOf(all[j]) >= limit) continue;
      if (LOOP_RE.test(all[j])) {
        if (spawnAdded || addedNs.has(j + 1)) return true;
        break;
      }
      limit = indentOf(all[j]);
      if (limit === 0) break;
    }
  }
  return false;
}

function computeFacts({ cwd, base, head = 'HEAD', riskFlags = [], riskPolicy, git } = {}) {
  const run = git || defaultGit(cwd);
  let stage = 'paths';
  const fail = (err) => ({ ok: false, fact: stage, reason: err && err.message ? err.message : String(err) });
  const memo = new Map();
  const show = (rev, p) => {
    const key = `${rev}:${p}`;
    if (!memo.has(key)) memo.set(key, run(['show', key]));
    return memo.get(key);
  };

  let entries;
  let sections;
  try {
    for (const rev of [base, head]) {
      if (typeof rev !== 'string' || rev === '' || rev.startsWith('-')) throw new Error(`not a usable revision: ${JSON.stringify(rev)}`);
    }
    const range = `${base}...${head}`;
    entries = parseNameStatusZ(run(['diff', '--name-status', '-z', '-M', '--no-ext-diff', '--end-of-options', range, '--'])).map((r) => ({
      path: r.paths[r.paths.length - 1],
      oldPath: r.paths[0],
      status: r.status[0],
      kind: classifyPathKind(r.paths[r.paths.length - 1]),
    }));
    stage = 'addedLines';
    sections = parsePatch(run(['diff', '-U0', '--inter-hunk-context=0', '--no-color', '-M', '--no-ext-diff', '--end-of-options', range, '--']));
    // A file<->symlink typechange prints two sections for one entry, so it lands here and keeps the full tier set (safe).
    if (sections.length !== entries.length) throw new Error(`diff sections (${sections.length}) do not match changed paths (${entries.length})`);
  } catch (err) {
    return fail(err);
  }

  const facts = {};
  const compute = (name, fn) => { stage = name; facts[name] = fn(); };
  try {
    compute('paths', () => entries.map(({ path, status, kind }) => ({ path, status, kind })));
    compute('kinds', () => Object.fromEntries(KIND_NAMES.map((k) => [k, entries.some((e) => e.kind === k)])));

    let preRev = null;
    const preImage = (p) => {
      if (preRev === null) preRev = run(['merge-base', base, head]).trim();
      return show(preRev, p);
    };
    compute('executableContent', () => entries.some((e, i) => {
      if (e.kind !== 'prose') return true;
      const { added, deleted } = sections[i];
      if (added.some((l) => isExecutableProseLine(l.text)) || deleted.some((l) => isExecutableProseLine(l.text))) return true;
      if (added.length > 0) {
        const fenced = fencedLineNumbers(show(head, e.path));
        if (added.some((l) => fenced.has(l.n))) return true;
      }
      if (deleted.length > 0) {
        const fenced = fencedLineNumbers(preImage(e.oldPath));
        if (deleted.some((l) => fenced.has(l.n))) return true;
      }
      return false;
    }));

    const sourceAdds = entries.flatMap((e, i) => (e.kind === 'source' ? [{ e, added: sections[i].added }] : []));
    const anyAdded = (pred) => sourceAdds.some(({ added }) => added.some((l) => pred(l.text)));
    compute('shellInvocationAdded', () => anyAdded(isSpawnLine));
    compute('inputHandlingAdded', () => anyAdded(handlesInput));
    compute('errorHandlingTouched', () => anyAdded((l) => ERROR_RE.test(l)));
    compute('loopSpawn', () => sourceAdds.some(({ e, added }) => added.length > 0
      && hasLoopSpawn(show(head, e.path), new Set(added.map((l) => l.n)))));
    compute('perCallPath', () => entries.some((e) => e.kind === 'source' && PER_CALL_PATH_RES.some((re) => re.test(e.path))));
    compute('riskPathTouched', () => {
      if (riskPolicy === undefined) throw new Error('riskPolicy is missing: pass readRiskPolicy\'s result (or { error })');
      if (riskPolicy && riskPolicy.error) throw new Error(`risk-path-globs unreadable: ${riskPolicy.error}`);
      const controlMode = Boolean(riskPolicy && riskPolicy.controlMode === true);
      if (controlMode && riskPolicy.globsInvalid) throw new Error('risk-path-globs is invalid while control mode is on');
      const touched = entries.flatMap((e) => (e.oldPath === e.path ? [e.path] : [e.path, e.oldPath]));
      if (riskFlags.length > 0 || touched.some(isProtectedPath)) return true;
      if (!controlMode) return false;
      const globs = Object.values(riskPolicy.pathGlobs || {}).flat();
      return touched.some((p) => isSensitivePath(p, globs));
    });
    compute('riskFlags', () => [...riskFlags]);
    compute('newFiles', () => entries.some((e) => e.status === 'A' || e.status === 'C'));
    compute('newModules', () => entries.some((e) => e.status === 'A' && e.kind === 'source'));
  } catch (err) {
    return fail(err);
  }
  return { ok: true, facts };
}

module.exports = { FACT_NAMES, KIND_NAMES, computeFacts, classifyPathKind, isExecutableProseLine, LOOP_LOOKBACK_LINES, PER_CALL_PATH_RES };
