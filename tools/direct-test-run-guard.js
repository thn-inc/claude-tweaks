'use strict';

// The repo-local guard against direct `node --test` runs (#5547): a multi-file or looped direct run skips
// what tools/run-tests.js gives a run (SAFEGUARDS_TEXT), so a typed Bash command holding one is denied with
// the runner command that runs the same files. This module is the pure core: `classifyCommand` decides a
// typed command, `hasDirectTestRun` says whether any segment of a text is a direct test run at all (a
// single-file one included). Every file-system answer comes in through `hasRunner` and `isDirectory`; OS
// path rules come from `pathImpl`. Segments, effective cwds and assignment substitution come from the
// hooks' shared shell scanner (forEachCommandSegment), so quoted text (`echo "node --test a b"`) is one
// word and never a command.

const fs = require('fs');
const path = require('path');
const { NODE_TEST_VALUE_FLAGS } = require('./run-tests');
const { forEachCommandSegment } = require('../plugin/bin/lib/hooks/git-command');

const SAFEGUARDS_TEXT = 'A direct node --test over several files, or in a loop, skips what tools/run-tests.js gives a run: git auto-maintenance off for fixture repos, a per-run TMPDIR removed on exit, the machine-wide suite slot, and bounded file concurrency.';
const EXPANSION_LINE = 'The runner takes *.test.js files only and refuses anything else the expansion names, so make it name test files only.';
const LOOP_FILES_PLACEHOLDER = '<the test files this loop runs>';
// The scanner does not follow `pushd`/`popd`, so after one the run's directory, and the runner's path from
// it, cannot be named.
const DIR_STACK_PLACEHOLDER = 'node <path to tools/run-tests.js> <the same flags and test files>';

const NODE_TEST_VALUE_SET = new Set(NODE_TEST_VALUE_FLAGS);
// General node options (not test flags) that take their value as the next word: every option `node --help`
// (Node 26.13.1) prints as `--name=...`, with its short and alias spellings. A value is never counted as a
// file. The runner takes none of them, so the replacement line leaves them out and the reason names them.
const NODE_VALUE_OPTIONS = new Set([
  '-r', '--require', '--import', '--loader', '--experimental-loader', '--env-file', '--env-file-if-exists', '-C',
  '--conditions', '--input-type', '--title', '--watch-path', '--inspect-port', '--debug-port', '--disable-warning',
  '--redirect-warnings', '--diagnostic-dir', '--max-http-header-size', '--secure-heap', '--secure-heap-min',
  '--allow-fs-read', '--allow-fs-write', '--bench-isolation', '--bench-name-pattern', '--bench-reporter',
  '--bench-reporter-destination', '--bench-samples', '--bench-warmup', '--build-sea', '--build-snapshot-config',
  '--cpu-prof-dir', '--cpu-prof-interval', '--cpu-prof-name', '--disable-proto', '--dns-result-order',
  '--experimental-package-map', '--experimental-sea-config', '--heap-prof-dir', '--heap-prof-interval',
  '--heap-prof-name', '--heapsnapshot-near-heap-limit', '--heapsnapshot-signal', '--icu-data-dir',
  '--inspect-publish-uid', '--localstorage-file', '--max-old-space-size-percentage',
  '--network-family-autoselection-attempt-timeout', '--openssl-config', '--process-timeout', '--report-filename',
  '--report-signal', '--run', '--snapshot-blob', '--tls-cipher-list', '--tls-keylog', '--trace-event-categories',
  '--trace-event-file-pattern', '--trace-require-module', '--unhandled-rejections', '--use-largepages',
  '--v8-pool-size', '--vfs-load', '--watch-kill-signal',
]);
// Options whose value is inline code: a node command using one runs no script file.
const INLINE_CODE_OPTIONS = new Set(['-e', '--eval', '-p', '--print']);
const NPX_VALUE_OPTIONS = new Set(['-p', '--package']);
// Keywords a command can follow in its segment. A `while`/`until` one also opens a loop whose condition
// is this segment, so a run there is repeated.
const LEAD_KEYWORDS = new Set(['do', 'then', 'else', 'if', 'elif', 'while', 'until']);
const CONDITION_LOOPS = new Set(['while', 'until']);
// The leads that run their command once per input, each with its options that take a value word.
const REPEATING_LEADS = new Map([
  ['xargs', new Set(['-I', '-L', '-n', '-P', '-s', '-d', '-E', '-a', '-J', '-R', '-S', '--arg-file', '--delimiter',
    '--max-args', '--max-lines', '--max-procs', '--max-chars', '--eof', '--process-slot-var'])],
  ['parallel', new Set(['-j', '-n', '-N', '-I', '-S', '-a', '-d', '-E', '-L', '-P', '--jobs', '--max-args',
    '--arg-file', '--delimiter', '--sshlogin'])],
]);
const FIND_EXEC_ACTIONS = new Set(['-exec', '-execdir', '-ok', '-okdir']);
const NODE_NAMES = new Set(['node', 'node.exe']);
const SHELLS = new Set(['sh', 'bash', 'zsh']);
const DIR_STACK_COMMANDS = new Set(['pushd', 'popd']);
const MAX_WRAPPER_DEPTH = 3;

// The options each transparent prefix command is read with: `flags` (one word each), `valued` (the option
// and the next word), `assignments` (`NAME=value` words count as options), `duration` (one more word after
// the options). Any other option ends the prefix's options, so that option word is taken as the program:
// it is never node, so the segment is allowed, as a prefix that is not modeled should be.
const TIMEOUT_OPTIONS = {
  flags: /^(?:-[vfp]|--verbose|--foreground|--preserve-status|-[sk].+|--signal=.+|--kill-after=.+)$/,
  valued: new Set(['-s', '-k', '--signal', '--kill-after']),
  duration: true,
};
const PREFIX_OPTIONS = new Map([
  ['env', { flags: /^(?:-i|--ignore-environment|-|-u.+|--unset=.+)$/, valued: new Set(['-u', '--unset']), assignments: true }],
  ['time', { flags: /^-p$/ }],
  ['nice', { flags: /^(?:-n?-?[0-9]+|--adjustment=.+)$/, valued: new Set(['-n', '--adjustment']) }],
  ['nohup', {}],
  ['command', { flags: /^-p$/ }],
  ['exec', { flags: /^-[cl]+$/, valued: new Set(['-a']) }],
  ['timeout', TIMEOUT_OPTIONS],
  ['gtimeout', TIMEOUT_OPTIONS],
  ['sudo', { flags: /^-[EnH]+$/, valued: new Set(['-u']) }],
]);

const ASSIGNMENT_RE = /^[A-Za-z_][A-Za-z0-9_]*=/;
const IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const GLOB_RE = /[*?[{]/;
const EXPANSION_RE = /[$`]/;
const LOOP_VAR_RE = /^\$(?:([A-Za-z_][A-Za-z0-9_]*)|\{([A-Za-z_][A-Za-z0-9_]*)\})$/;
// A redirection word: an operator alone (its target is the next word) or glued to its target (`>out`, `2>&1`).
const REDIRECT_RE = /^(?:[0-9]*|&)[<>]/;
const REDIRECT_OP_RE = /^(?:[0-9]*|&)(?:>>?|>\||<<?<?|<>|>&|<&)$/;
// A shell's short-option cluster (`-c`, `-lc`, `-euo`, `+o`). One starting `-` and holding `c` makes the
// shell run its first non-option word as a script; one ending in `o` takes the next word as an option name.
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
  // A value the scanner substituted for an unquoted `$NAME` is word-split by the shell: the `$` of the
  // word as typed (`raw`) is a bare character there, where `"$NAME"` makes it a double-quoted one.
  const splits = (i) => {
    if (t[i] === raw[i] || !/\s/.test(t[i])) return false;
    const at = raw[i].indexOf('$');
    return at !== -1 && typeof kinds[i] === 'string' && kinds[i][at] === 'b';
  };
  const wordsOf = (i) => (splits(i) ? t[i].split(/\s+/).filter(Boolean) : [t[i]]);
  return {
    t,
    bare,
    wordsOf,
    name: (i) => (typeof t[i] === 'string' ? P.basename(t[i]) : ''),
    render: (i) => {
      if (t[i] === raw[i]) return requote(raw[i], kinds[i]);
      return splits(i) ? wordsOf(i).map((w) => quoteValue(w, null)).join(' ') : quoteValue(t[i], kinds[i]);
    },
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

// The index of the program after any run of transparent prefix commands starting at `i`: `!` and the
// commands in PREFIX_OPTIONS, each with its own options (`t.length` when the words run out).
function skipPrefixes(seg, i) {
  const { t } = seg;
  for (;;) {
    if (t[i] === '!' && seg.bare(i)) {
      i += 1;
      continue;
    }
    const spec = PREFIX_OPTIONS.get(seg.name(i));
    if (!spec) return Math.min(i, t.length);
    i += 1;
    let optionsDone = false;
    while (i < t.length) {
      const w = t[i];
      if (spec.assignments && ASSIGNMENT_RE.test(w)) i += 1;
      else if (optionsDone || !w.startsWith('-')) break;
      else if (w === '--') { optionsDone = true; i += 1; }
      else if (spec.flags && spec.flags.test(w)) i += 1;
      else if (spec.valued && spec.valued.has(w)) i += 2;
      else break; // an option not modeled: it is taken as the program
    }
    if (spec.duration && i < t.length && !t[i].startsWith('-')) i += 1;
  }
}

// The innermost enclosing `for` loop whose variable `word` names (`$f`, `${f}`), or null.
function loopFor(word, loops) {
  const m = LOOP_VAR_RE.exec(word);
  if (!m) return null;
  const name = m[1] || m[2];
  for (let k = loops.length - 1; k >= 0; k -= 1) {
    if (loops[k].kind === 'for' && loops[k].variables[0] === name) return loops[k];
  }
  return null;
}

// Whether `word` references a variable an enclosing loop sets (a `for` variable, a `while read` name).
function mentionsLoopVariable(word, loops) {
  return loops.some((l) => l.variables.some((v) => new RegExp(`\\$\\{?${v}(?![A-Za-z0-9_])`).test(word)));
}

// The command-substitution nesting after word `tok`: `$(` opens one level, `(` inside one opens another,
// `)` closes one; a backtick opens or closes a backtick substitution.
function advanceSubstitution({ depth, tick }, tok) {
  for (let k = 0; k < tok.length; k += 1) {
    const c = tok[k];
    if (c === '`') tick = !tick;
    else if (c === '$' && tok[k + 1] === '(') { depth += 1; k += 1; }
    else if (c === '(' && depth > 0) depth += 1;
    else if (c === ')' && depth > 0) depth -= 1;
  }
  return { depth, tick };
}

// Reads the node command at `at` (up to `end`): null when it is no direct test run, else the role of each
// word after the program. A direct test run is `node` (or `npx [options] node[@<v>]`) with `--test` among
// the options before the first script operand, or a first script operand ending in `.test.js`, or (inside
// a `for` loop) a script that is the loop's variable over a word list naming a `.test.js` word. A node
// command with inline code (`-e`, `-p`) runs no script, so it is a run only with `--test`. Roles: `test`
// (the `--test` word), `dd` (`--`), `testflag`/`testvalue` (a test flag and its value word, kept),
// `foreign`/`foreignvalue` (any other option and its value word, left out of the replacement), `operand`.
function readRun(seg, at, end, loops) {
  const { t } = seg;
  let optStart;
  if (NODE_NAMES.has(seg.name(at))) {
    optStart = at + 1;
  } else if (seg.name(at) === 'npx') {
    let j = at + 1;
    while (j < end && t[j].startsWith('-') && t[j] !== '--') j += NPX_VALUE_OPTIONS.has(t[j]) ? 2 : 1;
    if (j >= end || !(t[j] === 'node' || t[j].startsWith('node@'))) return null;
    optStart = j + 1;
  } else {
    return null;
  }
  const role = new Map();
  let sawTest = false;
  let inline = false;
  let script = -1;
  let afterDashDash = false;
  let substitution = { depth: 0, tick: false };
  for (let i = optStart; i < end; i += 1) {
    const tok = t[i];
    // The words a `$(...)` or backtick substitution spans after its first are its own command's words, never
    // node options or files: kept in the replacement as typed.
    const inside = substitution.depth > 0 || substitution.tick;
    substitution = advanceSubstitution(substitution, tok);
    if (inside) {
      role.set(i, 'substitution');
      continue;
    }
    if (!afterDashDash) {
      if (seg.isRedirect(i)) {
        if (seg.isRedirectOp(i)) i += 1;
        continue;
      }
      if (tok === '--') {
        role.set(i, 'dd');
        afterDashDash = true;
        continue;
      }
      if (tok.length > 1 && tok[0] === '-') {
        if (tok === '--test') {
          role.set(i, 'test');
          sawTest = true;
          continue;
        }
        const testFlag = tok.startsWith('--test-') || tok.startsWith('--experimental-test-');
        if (INLINE_CODE_OPTIONS.has(tok.split('=')[0])) inline = true;
        role.set(i, testFlag ? 'testflag' : 'foreign');
        const takesValue = !tok.includes('=')
          && (NODE_TEST_VALUE_SET.has(tok) || NODE_VALUE_OPTIONS.has(tok) || INLINE_CODE_OPTIONS.has(tok));
        if (takesValue && i + 1 < end) {
          i += 1;
          role.set(i, testFlag ? 'testvalue' : 'foreignvalue');
        }
        continue;
      }
    }
    if (sawTest) {
      role.set(i, 'operand');
      continue;
    }
    if (!inline) script = i;
    break;
  }
  if (!sawTest) {
    if (script === -1) return null;
    const loop = loopFor(t[script], loops);
    const loopScript = Boolean(loop && loop.words && loop.words.some((w) => w.endsWith('.test.js')));
    if (!t[script].endsWith('.test.js') && !loopScript) return null;
    role.set(script, 'operand');
  }
  const operands = [...role].filter(([, r]) => r === 'operand').map(([i]) => i);
  return { at, optStart, end, sawTest, operands, role };
}

// The script text a `sh|bash|zsh [options] -c <text>` word list runs, or null: a `-`-cluster holding `c`
// anywhere before the shell's first non-option word makes that word the script. A cluster ending in `o`
// (`-o`, `+o`, `-euo`) takes the next word as an option name; long options are skipped.
function wrapperText(seg, at, end) {
  const { t } = seg;
  let sawC = false;
  for (let j = at + 1; j < end; j += 1) {
    const w = t[j];
    if (w === '--') return sawC && j + 1 < end ? t[j + 1] : null;
    if (SHELL_CLUSTER_RE.test(w)) {
      if (w[0] === '-' && w.includes('c')) sawC = true;
      if (w.endsWith('o')) j += 1;
    } else if (!w.startsWith('--')) {
      return sawC ? w : null;
    }
  }
  return null;
}

// The program a segment runs and whether its lead repeats it, after any transparent prefix commands
// (skipPrefixes): `xargs`/`parallel` run their first non-option word (past the options that take a value),
// `find` the word after one of its `-exec`/`-execdir`/`-ok`, up to the `;` or `+` ending that action.
function programOf(seg, lead) {
  const { t } = seg;
  const runnable = (i) => NODE_NAMES.has(seg.name(i)) || seg.name(i) === 'npx' || SHELLS.has(seg.name(i));
  const start = skipPrefixes(seg, lead);
  const leadName = seg.name(start);
  const valued = REPEATING_LEADS.get(leadName);
  if (valued) {
    let j = start + 1;
    while (j < t.length && t[j].startsWith('-') && t[j] !== '--') j += valued.has(t[j]) ? 2 : 1;
    if (t[j] === '--') j += 1;
    const at = skipPrefixes(seg, j);
    return runnable(at) ? { at, end: t.length, ledRepeat: true } : null;
  }
  if (leadName === 'find') {
    for (let i = start + 1; i < t.length; i += 1) {
      if (!FIND_EXEC_ACTIONS.has(t[i])) continue;
      const at = skipPrefixes(seg, i + 1);
      let end = at + 1;
      while (end < t.length && t[end] !== ';' && t[end] !== '+') end += 1;
      if (runnable(at)) return { at, end, ledRepeat: true };
      i = end;
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
  const words = run.operands.flatMap((i) => seg.wordsOf(i));
  if (words.some((w) => isUnder(P.resolve(effCwd, w), evals, P))) return null;
  const deny = repeated
    || words.length >= 2
    || (run.sawTest && words.length === 0)
    || words.some((w) => GLOB_RE.test(w) || EXPANSION_RE.test(w) || w.endsWith('/') || ctx.isDirectory(P.resolve(effCwd, w)));
  if (!deny) return null;

  const rel = toSlash(P.relative(effCwd, P.join(root, 'tools', 'run-tests.js')), P);
  // A loop-variable operand becomes the loop's word list when every word is literal or a glob. The files a
  // `while`/`until` loop, an `xargs`/`find` lead or an expanded word list runs cannot be named, and no
  // replacement line may hold a loop variable, so those get the fixed placeholder text.
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
  for (let i = 0; i < run.end && !fixed; i += 1) {
    if (!subst.has(i) && mentionsLoopVariable(t[i], state.loops)) fixed = true;
  }
  let line;
  let expansion = false;
  const foreign = [];
  if (state.dirMoved) {
    line = DIR_STACK_PLACEHOLDER;
  } else if (fixed) {
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
      const r = run.role.get(i);
      if (r === 'test' || r === 'dd') continue;
      if (r === 'foreign' || r === 'foreignvalue') foreign.push(seg.render(i));
      else parts.push(subst.has(i) ? subst.get(i) : seg.render(i));
    }
    line = parts.join(' ');
    expansion = run.operands.some((i) => !subst.has(i) && EXPANSION_RE.test(t[i]));
  }
  if (!state.dirMoved && P.resolve(effCwd) !== P.resolve(ctx.callCwd)) {
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
    ...(foreign.length ? [`The runner does not take ${foreign.join(' ')}; if the tests need them, set NODE_OPTIONS.`] : []),
    'In a checkout older than this guard, write the files to a list and use: node tools/run-tests.js --files-from <list>',
    'A single test file outside a loop can still be run directly.',
  ].join('\n');
  return { decision: 'deny', kind: 'typed', reason, replacement: line };
}

// The script a segment runs, as the word typed, or null: the first non-option operand of a `node`, `bash`,
// `sh` or `zsh` program (a `-c` shell form runs text, not a file, and inline node code runs no file), or the
// program word itself when it holds a `/` and ends in a script extension.
function scriptOperand(seg, prog) {
  const { t } = seg;
  const name = seg.name(prog.at);
  const isNode = NODE_NAMES.has(name);
  if (isNode || SHELLS.has(name)) {
    if (!isNode && wrapperText(seg, prog.at, prog.end) !== null) return null;
    for (let i = prog.at + 1; i < prog.end; i += 1) {
      const w = t[i];
      if (seg.isRedirect(i)) {
        if (seg.isRedirectOp(i)) i += 1;
        continue;
      }
      if (w === '--') return i + 1 < prog.end ? i + 1 : null;
      if (isNode) {
        if (w.length > 1 && w[0] === '-') {
          if (INLINE_CODE_OPTIONS.has(w.split('=')[0])) return null;
          if (!w.includes('=') && (NODE_TEST_VALUE_SET.has(w) || NODE_VALUE_OPTIONS.has(w))) i += 1;
          continue;
        }
      } else if (SHELL_CLUSTER_RE.test(w)) {
        if (w.endsWith('o')) i += 1;
        continue;
      } else if (w.startsWith('--')) {
        continue;
      }
      return i;
    }
    return null;
  }
  return /\/.*\.(?:sh|js|mjs|cjs)$/.test(t[prog.at]) ? prog.at : null;
}

// Records the script file a segment runs in `ctx.scripts`, resolved against the segment's working directory.
function collectScript(seg, prog, segCwd, ctx) {
  if (segCwd === null || prog.at >= seg.t.length) return;
  const i = scriptOperand(seg, prog);
  if (i === null || i >= seg.t.length) return;
  const word = seg.t[i];
  if (word === '' || EXPANSION_RE.test(word)) return;
  const name = seg.name(prog.at);
  const kind = NODE_NAMES.has(name) || /\.(?:js|mjs|cjs)$/.test(word) ? 'js' : 'shell';
  ctx.scripts.push({ word, kind, abs: ctx.pathImpl.resolve(segCwd, word) });
}

// Walks `text` segment by segment. In 'detect' mode it records whether any segment is a direct test run;
// in 'classify' mode it records the first deny. Loop nesting is tracked across segments: a segment is
// inside a loop after a `for` segment, or from a `while`/`until` segment (its condition included), up to
// that loop's own `done`. A wrapper's text is walked with the loops and the `pushd`/`popd` mark in effect
// where the wrapper runs (`inherited`).
function walk(text, cwd, ctx, inherited = { loops: [], dirMoved: false }) {
  const P = ctx.pathImpl;
  const state = { loops: [...inherited.loops], dirMoved: inherited.dirMoved, found: false, result: null };
  forEachCommandSegment(text, cwd, (t, effCwd, q, again) => {
    if (state.found || state.result) return;
    const seg = segmentView(t, q, P);
    const head = leadOf(seg);
    const { lead } = head;
    if (t[0] === 'done' && seg.bare(0)) {
      if (!again) state.loops.pop();
      return;
    }
    // A `while`/`until` condition runs once per pass: its loop is open for the condition itself. A
    // `while read` condition names the loop's variables.
    if (head.conditionLoop && !again) {
      const cmd = skipPrefixes(seg, lead);
      const variables = t[cmd] === 'read' ? t.slice(cmd + 1).filter((w) => IDENTIFIER_RE.test(w)) : [];
      state.loops.push({ kind: head.conditionLoop, variables, words: null, wordText: [] });
    }
    if (lead >= t.length) return;
    if (t[lead] === 'for' && seg.bare(lead)) {
      if (!again) {
        const hasList = t[lead + 2] === 'in';
        const wordIdx = hasList ? t.map((_, i) => i).slice(lead + 3) : [];
        state.loops.push({
          kind: 'for',
          variables: IDENTIFIER_RE.test(t[lead + 1] || '') ? [t[lead + 1]] : [],
          words: hasList ? wordIdx.map((i) => t[i]) : null,
          wordText: wordIdx.map(seg.render),
        });
      }
      return;
    }
    const prog = programOf(seg, lead);
    if (!prog) return;
    if (DIR_STACK_COMMANDS.has(t[prog.at]) && seg.bare(prog.at)) {
      state.dirMoved = true;
      return;
    }
    const repeated = state.loops.length > 0 || prog.ledRepeat || ctx.repeated;
    const segCwd = typeof effCwd === 'string' ? effCwd : null;
    const isEval = !prog.ledRepeat && t[prog.at] === 'eval' && seg.bare(prog.at);
    if (ctx.mode === 'scripts' && !isEval) collectScript(seg, prog, segCwd, ctx);
    if (isEval || SHELLS.has(seg.name(prog.at))) {
      // `eval` runs its arguments joined by a space; a shell its `-c` script.
      const inner = isEval ? t.slice(prog.at + 1, prog.end).join(' ') : wrapperText(seg, prog.at, prog.end);
      if (inner === null || ctx.depth >= MAX_WRAPPER_DEPTH) return;
      if (ctx.mode === 'classify' && segCwd === null) return;
      const sub = walk(inner, segCwd || cwd, { ...ctx, depth: ctx.depth + 1, repeated }, { loops: state.loops, dirMoved: state.dirMoved });
      state.found = sub.found;
      state.result = sub.result;
      return;
    }
    if (ctx.mode === 'scripts') return;
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

// Whether a script's text starts node --test itself. `kind` 'js': the exact string literal `--test` in
// single, double or backtick quotes and the substring `child_process`. `kind` 'shell': any direct test run
// (a script is a repeatable run by nature, so a single-file one is enough). Never throws.
function scanScript(text, kind, { cwd, pathImpl = path } = {}) {
  try {
    if (typeof text !== 'string') return false;
    if (kind === 'js') return /(['"`])--test\1/.test(text) && text.includes('child_process');
    if (kind === 'shell') return hasDirectTestRun(text, { cwd, pathImpl });
    return false;
  } catch (_) {
    return false;
  }
}

// The checkout directories whose scripts are repo tooling: never read by the script scan.
const SKIPPED_SCRIPT_DIRS = new Set(['tools', 'plugin', 'tests', 'perf', 'evals', 'scripts']);

function scriptReason(word) {
  return [
    `This repository's guard blocked a script that starts node --test itself: ${word}. ${SAFEGUARDS_TEXT}`,
    'Have the script start the runner instead, from inside the checkout it tests, with the same flags and files:',
    '',
    'node tools/run-tests.js --test-reporter=tap <files>',
    '',
    'In JavaScript: spawnSync(process.execPath, [\'tools/run-tests.js\', ...flags, ...files], { cwd: checkoutRoot }). The exit code and stdout are node\'s own.',
    'In a checkout older than this guard, write the files to a list and use: node tools/run-tests.js --files-from <list>',
  ].join('\n');
}

// The hook's verdict for one PreToolUse payload: `{ decision: 'allow' }` or `{ decision: 'deny', reason }`.
// `deps` is { hasRunner, isDirectory, readScript(absPath) -> string|null, pathImpl }. A non-Bash call, or one
// outside a checkout holding tools/run-tests.js, is allowed. Lets any error through (judge catches it).
function judgeOrThrow(payload, deps) {
  const { hasRunner, readScript, pathImpl = path } = deps;
  if (!payload || payload.tool_name !== 'Bash') return ALLOW();
  const command = payload.tool_input && payload.tool_input.command;
  const cwd = payload.cwd;
  if (typeof command !== 'string' || command === '' || typeof cwd !== 'string') return ALLOW();
  const typed = classifyCommandOrThrow(command, { ...deps, cwd });
  if (typed.decision === 'deny') return { decision: 'deny', reason: typed.reason };
  if (!hasRunner(cwd)) return ALLOW();

  const ctx = { mode: 'scripts', depth: 0, repeated: false, callCwd: cwd, pathImpl, scripts: [] };
  walk(command, cwd, ctx);
  for (const { word, kind, abs } of ctx.scripts) {
    const root = hasRunner(pathImpl.dirname(abs));
    if (root) {
      const first = toSlash(pathImpl.relative(root, abs), pathImpl).split('/')[0];
      if (SKIPPED_SCRIPT_DIRS.has(first)) continue;
    }
    const text = readScript(abs);
    if (typeof text === 'string' && scanScript(text, kind, { cwd: pathImpl.dirname(abs), pathImpl })) {
      return { decision: 'deny', reason: scriptReason(word) };
    }
  }
  return ALLOW();
}

// judgeOrThrow for the hook: never throws, and any internal error allows.
function judge(payload, deps) {
  try {
    return judgeOrThrow(payload, deps);
  } catch (_) {
    return ALLOW();
  }
}

const MAX_SCRIPT_BYTES = 262144;

// The file-system answers the hook reads through. None of the three throws.
function realDeps() {
  return {
    pathImpl: path,
    // The checkout root holding tools/run-tests.js at or above `dir`, or null.
    hasRunner(dir) {
      try {
        let d = path.resolve(dir);
        for (;;) {
          try {
            if (fs.statSync(path.join(d, 'tools', 'run-tests.js')).isFile()) return d;
          } catch (_) { /* not here: look one level up */ }
          const parent = path.dirname(d);
          if (parent === d) return null;
          d = parent;
        }
      } catch (_) {
        return null;
      }
    },
    isDirectory(p) {
      try {
        return fs.statSync(p).isDirectory();
      } catch (_) {
        return false;
      }
    },
    // The text of a regular file of at most MAX_SCRIPT_BYTES, else null.
    readScript(p) {
      try {
        const st = fs.statSync(p);
        if (!st.isFile() || st.size > MAX_SCRIPT_BYTES) return null;
        return fs.readFileSync(p, 'utf8');
      } catch (_) {
        return null;
      }
    },
  };
}

// The hook entry: stdin to end, then a deny JSON on stdout or nothing. Every failure prints nothing, and the
// exit status stays 0; the process ends on its own (an explicit exit can truncate a pending stdout write).
function main() {
  const chunks = [];
  process.stdout.on('error', () => {});
  process.stdin.on('error', () => {});
  process.stdin.on('data', (c) => chunks.push(c));
  process.stdin.on('end', () => {
    try {
      const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const verdict = judge(payload, realDeps());
      if (verdict.decision === 'deny') {
        process.stdout.write(JSON.stringify({
          hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: verdict.reason },
        }));
      }
    } catch (_) { /* prints nothing */ }
  });
}

if (require.main === module) main();

module.exports = {
  classifyCommand, classifyCommandOrThrow, hasDirectTestRun, scanScript, judge, judgeOrThrow, realDeps, SAFEGUARDS_TEXT,
};
