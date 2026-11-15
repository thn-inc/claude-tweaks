'use strict';

// The repo-local guard against direct `node --test` runs (#5547): a multi-file or looped direct run skips
// what tools/run-tests.js gives a run (SAFEGUARDS_TEXT), so a typed Bash command holding one is denied with
// the runner command that runs the same files. This module is the pure core: `classifyCommand` decides a
// typed command, `hasDirectTestRun` says whether any segment of a text is a direct test run at all (a
// single-file one included). Every file-system answer comes in through `hasRunner` and `isDirectory`; OS
// path rules come from `pathImpl`. Segments, effective cwds and assignment substitution come from the
// hooks' shared shell scanner (forEachCommandSegment), so quoted text (`echo "node --test a b"`) is one
// word and never a command.

const path = require('path');
const { NODE_TEST_VALUE_FLAGS } = require('./run-tests');
const { forEachCommandSegment } = require('../plugin/bin/lib/hooks/git-command');

const SAFEGUARDS_TEXT = 'A direct node --test over several files, or in a loop, skips what tools/run-tests.js gives a run: git auto-maintenance off for fixture repos, a per-run TMPDIR removed on exit, the machine-wide suite slot, and bounded file concurrency.';
const EXPANSION_LINE = 'The runner takes *.test.js files only and refuses anything else the expansion names, so make it name test files only.';
const LOOP_FILES_PLACEHOLDER = '<the test files this loop runs>';

// Node options read as taking the next word as their value, so a flag value is never counted as a file.
const SPACE_VALUE_FLAGS = new Set([...NODE_TEST_VALUE_FLAGS, '-r', '--require', '--import', '--loader']);
// Keywords a command can follow in its segment. A `while`/`until` one also opens a loop whose condition
// is this segment, so a run there is repeated.
const LEAD_KEYWORDS = new Set(['do', 'then', 'else', 'if', 'elif', 'while', 'until']);
const CONDITION_LOOPS = new Set(['while', 'until']);
const REPEATING_LEADS = new Set(['xargs', 'parallel']);
const FIND_EXEC_ACTIONS = new Set(['-exec', '-execdir', '-ok', '-okdir']);
const NODE_NAMES = new Set(['node', 'node.exe']);
const SHELLS = new Set(['sh', 'bash', 'zsh']);
const MAX_WRAPPER_DEPTH = 3;

const ASSIGNMENT_RE = /^[A-Za-z_][A-Za-z0-9_]*=/;
const GLOB_RE = /[*?[{]/;
const EXPANSION_RE = /[$`]/;
const LOOP_VAR_RE = /^\$(?:([A-Za-z_][A-Za-z0-9_]*)|\{([A-Za-z_][A-Za-z0-9_]*)\})$/;
// A redirection word: an operator alone (its target is the next word) or glued to its target (`>out`, `2>&1`).
const REDIRECT_RE = /^(?:[0-9]*|&)[<>]/;
const REDIRECT_OP_RE = /^(?:[0-9]*|&)(?:>>?|>\||<<?<?|<>|>&|<&)$/;
// A shell's short-option cluster (`-c`, `-lc`, `+e`); one starting `-` and holding `c` makes the shell run
// its first non-option word as a script.
const SHELL_CLUSTER_RE = /^[-+][A-Za-z]+$/;

const ALLOW = () => ({ decision: 'allow' });

// The word as the shell would read it back: each span re-quoted the way it was typed (`spanKinds`, one
// character per value character: `b` bare, `e` backslash-escaped, `s` single-, `d` double-quoted).
function requote(value, kinds) {
  if (typeof kinds !== 'string' || kinds.length !== value.length) return value;
  if (value === '') return '""';
  let out = '';
  for (let i = 0; i < value.length;) {
    let j = i;
    while (j < value.length && kinds[j] === kinds[i]) j += 1;
    const run = value.slice(i, j);
    if (kinds[i] === 's') out += `'${run}'`;
    else if (kinds[i] === 'd') out += `"${run}"`;
    else if (kinds[i] === 'e') out += run.replace(/[\s\S]/g, '\\$&');
    else out += run;
    i = j;
  }
  return out;
}

// A word whose value the scanner substituted from an earlier `NAME=value`: the value, double-quoted when
// the original was quoted or the value holds a blank.
function quoteValue(value, kinds) {
  if ((typeof kinds === 'string' && /[^b]/.test(kinds)) || /\s/.test(value) || value === '') {
    return `"${value.replace(/["\\$`]/g, '\\$&')}"`;
  }
  return value;
}

function isUnder(p, dir, P) {
  const rel = P.relative(dir, p);
  return rel === '' || (rel !== '..' && !rel.startsWith('..' + P.sep) && !P.isAbsolute(rel));
}

const toSlash = (p, P) => p.split(P.sep).join('/');

// One segment as the scanner handed it, with the helpers every rule reads it through.
function segmentView(t, q, P) {
  const raw = Array.isArray(q && q.raw) ? q.raw : t;
  const kinds = (q && q.spanKinds) || [];
  const bare = (i) => typeof kinds[i] !== 'string' || kinds[i][0] === 'b';
  return {
    t,
    bare,
    name: (i) => (typeof t[i] === 'string' ? P.basename(t[i]) : ''),
    render: (i) => (t[i] === raw[i] ? requote(raw[i], kinds[i]) : quoteValue(t[i], kinds[i])),
    isRedirect: (i) => bare(i) && REDIRECT_RE.test(t[i]),
    isRedirectOp: (i) => bare(i) && REDIRECT_OP_RE.test(t[i]),
  };
}

// The index past the segment's leading `NAME=value` assignments and keywords (LEAD_KEYWORDS), the
// assignment indices among them (kept in a replacement line; the keywords are not), and the last
// `while`/`until` keyword among them, or null.
function leadOf(seg) {
  const assignments = [];
  let conditionLoop = null;
  let i = 0;
  for (; i < seg.t.length; i += 1) {
    if (ASSIGNMENT_RE.test(seg.t[i]) && seg.bare(i)) assignments.push(i);
    else if (LEAD_KEYWORDS.has(seg.t[i]) && seg.bare(i)) {
      if (CONDITION_LOOPS.has(seg.t[i])) conditionLoop = seg.t[i];
    } else break;
  }
  return { lead: i, assignments, conditionLoop };
}

// The index of the program after any run of transparent prefix commands starting at `i` (`!`, `env`,
// `time`, `nice`, `nohup`, `command`, `exec`, `timeout`, `gtimeout`, each with the options modeled
// here), or -1 when a prefix uses an option not modeled (`env -S`, `command -v`, `time -o`, ...): what
// such a prefix runs is not read, as before prefixes were skipped.
function skipPrefixes(seg, i) {
  const { t } = seg;
  const at = (k) => (k < t.length ? t[k] : undefined);
  for (;;) {
    if (i >= t.length) return -1;
    const name = seg.name(i);
    if (t[i] === '!' && seg.bare(i)) {
      i += 1;
    } else if (name === 'env') {
      i += 1;
      let optionsDone = false;
      for (;;) {
        const w = at(i);
        if (w === undefined) return -1;
        if (ASSIGNMENT_RE.test(w) || w === '-') i += 1;
        else if (optionsDone || !w.startsWith('-')) break;
        else if (w === '-i' || w === '--ignore-environment') i += 1;
        else if (w === '-u' || w === '--unset') i += 2;
        else if (w.startsWith('--unset=') || /^-u./.test(w)) i += 1;
        else if (w === '--') { optionsDone = true; i += 1; }
        else return -1;
      }
    } else if (name === 'time') {
      i += 1;
      while (at(i) === '-p') i += 1;
      if (at(i) !== undefined && at(i).startsWith('-')) return -1;
    } else if (name === 'nice') {
      i += 1;
      for (let w = at(i); w !== undefined && w.startsWith('-'); w = at(i)) {
        if (w === '-n' || w === '--adjustment') i += 2;
        else if (/^-n?-?[0-9]+$/.test(w) || w.startsWith('--adjustment=')) i += 1;
        else if (w === '--') { i += 1; break; }
        else return -1;
      }
    } else if (name === 'nohup') {
      i += 1;
      if (at(i) === '--') i += 1;
      else if (at(i) !== undefined && at(i).startsWith('-')) return -1;
    } else if (name === 'command') {
      i += 1;
      for (let w = at(i); w !== undefined && w.startsWith('-'); w = at(i)) {
        if (w === '-p') i += 1;
        else if (w === '--') { i += 1; break; }
        else return -1;
      }
    } else if (name === 'exec') {
      i += 1;
      for (let w = at(i); w !== undefined && w.startsWith('-'); w = at(i)) {
        if (/^-[cl]+$/.test(w)) i += 1;
        else if (w === '-a') i += 2;
        else if (w === '--') { i += 1; break; }
        else return -1;
      }
    } else if (name === 'timeout' || name === 'gtimeout') {
      i += 1;
      for (let w = at(i); w !== undefined && w.startsWith('-'); w = at(i)) {
        if (w === '-s' || w === '-k' || w === '--signal' || w === '--kill-after') i += 2;
        else if (/^-[sk]./.test(w) || w.startsWith('--signal=') || w.startsWith('--kill-after=')) i += 1;
        else if (['-v', '--verbose', '-f', '--foreground', '-p', '--preserve-status'].includes(w)) i += 1;
        else if (w === '--') { i += 1; break; }
        else return -1;
      }
      if (at(i) === undefined) return -1;
      i += 1; // the duration
    } else {
      return i;
    }
  }
}

// The innermost enclosing `for` loop whose variable `word` names (`$f`, `${f}`), or null.
function loopFor(word, loops) {
  const m = LOOP_VAR_RE.exec(word);
  if (!m) return null;
  const name = m[1] || m[2];
  for (let k = loops.length - 1; k >= 0; k -= 1) {
    if (loops[k].kind === 'for' && loops[k].variable === name) return loops[k];
  }
  return null;
}

// Reads the node command at `at` (up to `end`): null when it is no direct test run, else where its parts
// are. A direct test run is `node` (or `npx [options] node@<v>`) with `--test` among the options before
// the first script operand, or a first script operand ending in `.test.js`, or (inside a `for` loop) a
// script that is the loop's variable over a word list naming a `.test.js` word.
function readRun(seg, at, end, loops) {
  const { t } = seg;
  let optStart;
  if (NODE_NAMES.has(seg.name(at))) {
    optStart = at + 1;
  } else if (seg.name(at) === 'npx') {
    let j = at + 1;
    while (j < end && t[j].startsWith('-')) j += 1;
    if (j >= end || !t[j].startsWith('node@')) return null;
    optStart = j + 1;
  } else {
    return null;
  }
  let sawTest = false;
  let script = -1;
  for (let i = optStart; i < end; i += 1) {
    if (seg.isRedirect(i)) {
      if (seg.isRedirectOp(i)) i += 1;
      continue;
    }
    const tok = t[i];
    if (tok === '--') {
      script = i + 1 < end ? i + 1 : -1;
      break;
    }
    if (tok.length > 1 && tok[0] === '-') {
      if (tok === '--test') sawTest = true;
      else if (SPACE_VALUE_FLAGS.has(tok)) i += 1;
      continue;
    }
    script = i;
    break;
  }
  const scriptWord = script === -1 ? '' : t[script];
  const loop = script === -1 ? null : loopFor(scriptWord, loops);
  const loopScript = Boolean(loop && loop.words && loop.words.some((w) => w.endsWith('.test.js')));
  if (!sawTest && !scriptWord.endsWith('.test.js') && !loopScript) return null;
  const operands = [];
  if (!sawTest) {
    operands.push(script);
  } else if (script !== -1) {
    for (let i = script; i < end; i += 1) {
      if (seg.isRedirect(i)) {
        if (seg.isRedirectOp(i)) i += 1;
        continue;
      }
      if (t[i].length > 1 && t[i][0] === '-') {
        if (SPACE_VALUE_FLAGS.has(t[i])) i += 1;
        continue;
      }
      operands.push(i);
    }
  }
  // The `--test` words the runner line drops: every option one before the script, and in the `--test`
  // form any later one too (the runner refuses it).
  const dropped = new Set();
  for (let i = optStart; i < end; i += 1) {
    if (t[i] === '--test' && (sawTest || script === -1 || i < script)) dropped.add(i);
  }
  return { at, optStart, end, sawTest, operands, dropped };
}

// The script text a `sh|bash|zsh [options] -c <text>` word list runs, or null: a `-`-cluster holding `c`
// anywhere before the shell's first non-option word makes that word the script. `-o <name>` and
// `+o <name>` pairs and long options are skipped.
function wrapperText(seg, at, end) {
  const { t } = seg;
  let sawC = false;
  for (let j = at + 1; j < end; j += 1) {
    const w = t[j];
    if (w === '--') return sawC && j + 1 < end ? t[j + 1] : null;
    if (w === '-o' || w === '+o') j += 1;
    else if (SHELL_CLUSTER_RE.test(w)) sawC = sawC || (w[0] === '-' && w.includes('c'));
    else if (!w.startsWith('--')) return sawC ? w : null;
  }
  return null;
}

// The program a segment runs and whether its lead repeats it, after any transparent prefix commands
// (skipPrefixes): `xargs`/`parallel` run the first node or shell word after them, `find` the one after
// its `-exec`/`-execdir`/`-ok`, up to the `;` or `+` ending it.
function programOf(seg, lead) {
  const { t } = seg;
  const runnable = (i) => NODE_NAMES.has(seg.name(i)) || seg.name(i) === 'npx' || SHELLS.has(seg.name(i));
  const start = skipPrefixes(seg, lead);
  if (start === -1) return null;
  const leadName = seg.name(start);
  if (REPEATING_LEADS.has(leadName)) {
    for (let i = start + 1; i < t.length; i += 1) if (runnable(i)) return { at: i, end: t.length, ledRepeat: true };
    return null;
  }
  if (leadName === 'find') {
    let i = start + 1;
    while (i < t.length && !FIND_EXEC_ACTIONS.has(t[i])) i += 1;
    for (i += 1; i < t.length; i += 1) {
      if (!runnable(i)) continue;
      let end = i + 1;
      while (end < t.length && t[end] !== ';' && t[end] !== '+') end += 1;
      return { at: i, end, ledRepeat: true };
    }
    return null;
  }
  return { at: start, end: t.length, ledRepeat: false };
}

// The deny verdict for a direct test run, or null when it is allowed.
function judgeRun(seg, run, effCwd, { lead, assignments }, ctx, state, { ledRepeat, repeated }) {
  const P = ctx.pathImpl;
  const { t } = seg;
  const root = ctx.hasRunner(effCwd);
  if (!root) return null;
  const evals = P.join(root, 'evals');
  if (isUnder(P.resolve(effCwd), evals, P)) return null;
  const words = run.operands.map((i) => t[i]);
  if (words.some((w) => isUnder(P.resolve(effCwd, w), evals, P))) return null;
  const deny = repeated
    || words.length >= 2
    || (run.sawTest && words.length === 0)
    || words.some((w) => GLOB_RE.test(w) || EXPANSION_RE.test(w) || w.endsWith('/') || ctx.isDirectory(P.resolve(effCwd, w)));
  if (!deny) return null;

  const rel = toSlash(P.relative(effCwd, P.join(root, 'tools', 'run-tests.js')), P);
  // A loop-variable operand becomes the loop's word list when every word is literal or a glob; the files
  // a `while`/`until` loop, an `xargs`/`find` lead or an expanded word list runs cannot be named.
  const subst = new Map();
  let fixed = ledRepeat;
  for (const i of run.operands) {
    if (fixed) break;
    const loop = loopFor(t[i], state.loops);
    if (!loop) continue;
    if (!loop.words || loop.words.some((w) => EXPANSION_RE.test(w))) fixed = true;
    else subst.set(i, loop.wordText.join(' '));
  }
  if (!fixed && state.loops.some((l) => l.kind !== 'for')) {
    fixed = run.operands.some((i) => !subst.has(i) && EXPANSION_RE.test(t[i]));
  }
  let line;
  let expansion = false;
  if (fixed) {
    line = `node ${rel} ${LOOP_FILES_PLACEHOLDER}`;
  } else {
    // Leading assignments and the prefix commands before the program, as typed.
    const parts = assignments.map(seg.render);
    for (let i = lead; i < run.at; i += 1) parts.push(seg.render(i));
    if (seg.name(run.at) === 'npx') {
      for (let i = run.at; i < run.optStart; i += 1) parts.push(seg.render(i));
      parts.push(rel);
    } else {
      parts.push('node', rel);
    }
    for (let i = run.optStart; i < run.end; i += 1) {
      if (run.dropped.has(i)) continue;
      parts.push(subst.has(i) ? subst.get(i) : seg.render(i));
    }
    line = parts.join(' ');
    expansion = run.operands.some((i) => !subst.has(i) && EXPANSION_RE.test(t[i]));
  }
  if (P.resolve(effCwd) !== P.resolve(ctx.callCwd)) {
    const dir = toSlash(P.relative(ctx.callCwd, effCwd), P);
    line = `cd ${/\s/.test(dir) ? `"${dir}"` : dir} && ${line}`;
  }
  const reason = [
    `This repository's guard blocked a direct test run. ${SAFEGUARDS_TEXT}`,
    'Run the same files through the runner, which takes the same files and node test flags:',
    '',
    line,
    '',
    ...(expansion ? [EXPANSION_LINE] : []),
    'In a checkout older than this guard, write the files to a list and use: node tools/run-tests.js --files-from <list>',
    'A single test file outside a loop can still be run directly.',
  ].join('\n');
  return { decision: 'deny', kind: 'typed', reason, replacement: line };
}

// Walks `text` segment by segment. In 'detect' mode it records whether any segment is a direct test run;
// in 'classify' mode it records the first deny. Loop nesting is tracked across segments: a segment is
// inside a loop after a `for` segment, or from a `while`/`until` segment (its condition included), up to
// that loop's own `done`.
function walk(text, cwd, ctx) {
  const P = ctx.pathImpl;
  const state = { loops: [], found: false, result: null };
  forEachCommandSegment(text, cwd, (t, effCwd, q, again) => {
    if (state.found || state.result) return;
    const seg = segmentView(t, q, P);
    const head = leadOf(seg);
    const { lead } = head;
    if (t[0] === 'done' && seg.bare(0)) {
      if (!again) state.loops.pop();
      return;
    }
    // A `while`/`until` condition runs once per pass: its loop is open for the condition itself.
    if (head.conditionLoop && !again) state.loops.push({ kind: head.conditionLoop, variable: null, words: null, wordText: [] });
    if (lead >= t.length) return;
    if (t[lead] === 'for' && seg.bare(lead)) {
      if (!again) {
        const hasList = t[lead + 2] === 'in';
        const wordIdx = hasList ? t.map((_, i) => i).slice(lead + 3) : [];
        state.loops.push({
          kind: 'for',
          variable: t[lead + 1],
          words: hasList ? wordIdx.map((i) => t[i]) : null,
          wordText: wordIdx.map(seg.render),
        });
      }
      return;
    }
    const prog = programOf(seg, lead);
    if (!prog) return;
    const repeated = state.loops.length > 0 || prog.ledRepeat || ctx.repeated;
    const segCwd = typeof effCwd === 'string' ? effCwd : null;
    if (SHELLS.has(seg.name(prog.at))) {
      const inner = wrapperText(seg, prog.at, prog.end);
      if (inner === null || ctx.depth >= MAX_WRAPPER_DEPTH) return;
      if (ctx.mode === 'classify' && segCwd === null) return;
      const sub = walk(inner, segCwd || cwd, { ...ctx, depth: ctx.depth + 1, repeated });
      state.found = sub.found;
      state.result = sub.result;
      return;
    }
    const run = readRun(seg, prog.at, prog.end, state.loops);
    if (!run) return;
    if (ctx.mode === 'detect') {
      state.found = true;
      return;
    }
    if (segCwd === null) return;
    state.result = judgeRun(seg, run, segCwd, head, ctx, state, { ledRepeat: prog.ledRepeat, repeated });
  }, { pathImpl: P });
  return state;
}

// `{ decision: 'allow' }`, or `{ decision: 'deny', kind: 'typed', reason, replacement }` for the first
// denied direct test run in `command`. `hasRunner(dir)` returns the checkout root holding
// tools/run-tests.js at or above `dir`, or null; `isDirectory(absPath)` a boolean. Lets any internal
// error (or one from `hasRunner`/`isDirectory`) through, so a test can tell a bug from an allow.
function classifyCommandOrThrow(command, { cwd, hasRunner, isDirectory, pathImpl = path } = {}) {
  if (typeof command !== 'string' || command === '' || typeof cwd !== 'string') return ALLOW();
  const ctx = { mode: 'classify', depth: 0, repeated: false, callCwd: cwd, hasRunner, isDirectory, pathImpl };
  return walk(command, cwd, ctx).result || ALLOW();
}

// classifyCommandOrThrow for the hook: never throws, and any internal error allows.
function classifyCommand(command, options) {
  try {
    return classifyCommandOrThrow(command, options);
  } catch (_) {
    return ALLOW();
  }
}

// Whether any command segment of `text` (shell wrappers included) is a direct test run, a single-file one
// included. Never throws: an unreadable text is no run.
function hasDirectTestRun(text, { cwd, pathImpl = path } = {}) {
  try {
    if (typeof text !== 'string' || text === '') return false;
    return walk(text, cwd || '.', { mode: 'detect', depth: 0, repeated: false, callCwd: cwd || '.', pathImpl }).found;
  } catch (_) {
    return false;
  }
}

module.exports = { classifyCommand, classifyCommandOrThrow, hasDirectTestRun, SAFEGUARDS_TEXT };
