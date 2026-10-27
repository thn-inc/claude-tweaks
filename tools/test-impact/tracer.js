'use strict';
// tools/test-impact/tracer.js — the test-impact read tracer (#4024).
//
// A `--require` preload carried by NODE_OPTIONS into every node process of a traced `node --test`
// run. It records which repo paths each test file reads, for tools/test-impact.js to fold into a
// test-impact map. Inert unless CT_TRACE_ROOT (realpath of the repo) and CT_TRACE_DIR are set.
//
// Attribution: CT_TRACE_TEST, else — when NODE_TEST_CONTEXT is set (a `node --test` worker) and
// process.argv[1] is under the root — the repo-relative test path, then exported as CT_TRACE_TEST so
// children inherit it. An unattributed process patches nothing.
//
// Output: each attributed process appends JSON lines to `{CT_TRACE_DIR}/{pid}-{ms}-{rand}.trace` —
// `["T", test]` first, then `[kind, relPath]` once per unique pair, written immediately with the
// unpatched appendFileSync. JSON, not tab-separated, because fixture paths hold tabs and newlines.
// Kinds: f content read (read/open/copy source/stat/lstat/module load/cp of a file, a non-node child's in-repo
// file argument or a shell's rc file, and a package.json a require reads for main or exports), s existence
// probe (exists/access/realpath/readlink, and every candidate a require probes up to the one it resolves
// to — relative, absolute, node_modules, require.resolve paths — minus those nested under an earlier probe,
// which impact.js's reads() ancestor rule for an `s` entry already covers), d directory listing
// (readdir/opendir), c content prefix (a cp of a directory, a non-node child's in-repo directory argument
// or an `env -C` directory, a content-reading git subcommand — its cwd, or a pathspec's literal prefix —
// or `''` for a node child that cannot trace itself). Paths under `.git/` and outside the root are
// dropped; `''` is the root itself.
// A trace write that fails (EMFILE, ENOSPC) marks the process lost: `{pid}-{ms}-{rand}.lost` beside the trace
// file holds `["T", test]`, written with the unpatched appendFileSync. If that marker cannot be written either,
// an exit listener retries it once and, when it still fails in a process that would exit 0, sets exit code 1
// and writes a diagnostic to fd 2, so the traced test fails. build-map counts the markers and trace refuses
// to write a map while any exists.
//
// Children: a child_process call with an explicit `env` gets CT_TRACE_* and the CT_TRACE_REQUIRE token
// (`--require "{abs tracer}"`) appended to its NODE_OPTIONS, so a test spawning node with a clean env
// is still traced; an env already naming a different CT_TRACE_ROOT is a nested trace and left alone.
// Node children trace themselves; for other children the in-repo path arguments are recorded here.
// `env [options] cmd` and `sh|bash -c` with option clusters (`-o pipefail`, `-euo pipefail`, `+e`) are
// read as the command they run (an `env -C` directory and a shell's `--rcfile` are recorded on the way); an
// `env` option this does not know falls back to the generic recording of its path arguments.
// A node child whose env was stripped of the trace (`env -i`, `-u NODE_OPTIONS`, a `NODE_OPTIONS=` or
// `CT_TRACE_*=` assignment) cannot trace itself, so its reads are unknown: it records `c ''`, beside its
// path arguments.
//
// Invariants (each one broke the full suite in the spike): wrapped functions copy the original's own
// property descriptors (util.promisify.custom — `promisify(execFile)` must keep resolving
// {stdout, stderr}); the tracer never calls process.cwd() — Node caches the cwd, so an eager call
// changes what a later one answers once the cwd is deleted — it reads the cwd through the unpatched
// realpathSync.native('.') only when a path is relative; it is silent and never throws into the host.

const ROOT_ENV = process.env.CT_TRACE_ROOT;
const DIR_ENV = process.env.CT_TRACE_DIR;
// Fail closed: once a test is attributed, any patch that cannot be installed (or a recording hook that
// throws) records `["c", ""]` — the whole-repo prefix, which selects the test for every change — so a
// broken install over-selects instead of silently under-recording. Set by install() once it can emit.
let failClosed = null;
if (ROOT_ENV && DIR_ENV) {
  try {
    install();
  } catch (_) {
    // never break the traced process
    if (failClosed) failClosed();
  }
}

function install() {
  const fs = require('fs');
  const path = require('path');
  const util = require('util');
  const cp = require('child_process');
  const Module = require('module');
  const { fileURLToPath } = require('url');

  // Unpatched originals the tracer itself uses.
  const appendFileSync = fs.appendFileSync;
  const statSync = fs.statSync;
  const readFileSync = fs.readFileSync;
  const realpathNative = fs.realpathSync.native;

  const stripSep = (p) => (p.length > 1 && (p.endsWith('/') || p.endsWith(path.sep)) ? p.slice(0, -1) : p);

  // The current cwd without process.cwd() (whose cache would change the host's own later calls), or
  // null when it cannot be read (deleted).
  function currentCwd() {
    try {
      return realpathNative('.');
    } catch (_) {
      return null;
    }
  }

  function toPathString(p) {
    if (typeof p === 'string') return p;
    if (Buffer.isBuffer(p)) return p.toString();
    if (p && typeof p === 'object' && p.protocol === 'file:' && typeof p.href === 'string') return fileURLToPath(p);
    return null;
  }

  // Absolute path of `s` against `base` (an absolute dir; undefined = the process cwd, read lazily), or null.
  function toAbs(s, base) {
    if (typeof s !== 'string') return null;
    if (path.isAbsolute(s)) return stripSep(path.normalize(s));
    let b = base;
    if (b === undefined) b = currentCwd();
    if (!b) return null;
    return stripSep(path.join(b, s));
  }

  if (!path.isAbsolute(ROOT_ENV) || !path.isAbsolute(DIR_ENV)) return;
  const roots = [stripSep(path.normalize(ROOT_ENV))];
  try {
    const real = stripSep(realpathNative(ROOT_ENV));
    if (!roots.includes(real)) roots.push(real);
  } catch (_) {
    // root not resolvable: compare against the given form only
  }

  // Repo-relative POSIX path of absolute `abs`, or null when outside the root or under `.git/`.
  function relOf(abs) {
    if (typeof abs !== 'string') return null;
    for (const root of roots) {
      let r = null;
      if (abs === root) r = '';
      else {
        const prefix = root.endsWith(path.sep) ? root : root + path.sep;
        if (abs.startsWith(prefix)) r = abs.slice(prefix.length);
      }
      if (r === null) continue;
      r = r.split(path.sep).join('/');
      if (r === '.git' || r.startsWith('.git/')) return null;
      return r;
    }
    return null;
  }

  let test = process.env.CT_TRACE_TEST || null;
  if (!test && process.env.NODE_TEST_CONTEXT && typeof process.argv[1] === 'string') {
    const r = relOf(toAbs(process.argv[1], undefined));
    if (r) {
      test = r;
      process.env.CT_TRACE_TEST = test;
    }
  }
  if (!test) return;

  const out = path.join(DIR_ENV, `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.trace`);
  const seen = new Set();
  let headerWritten = false;
  // The loss marker: written once (writeLost), retried by markLost and, at exit, by onExit.
  const lostOut = out.replace(/\.trace$/, '.lost');
  const LOST_LINE = `${JSON.stringify(['T', test])}\n`;
  let lostWritten = false;
  let lostListening = false;
  function writeLost() {
    try {
      appendFileSync(lostOut, LOST_LINE);
      lostWritten = true;
    } catch (_) {
      // retried by the exit listener
    }
  }
  function onExit(code) {
    try {
      if (!lostWritten) writeLost();
      if (lostWritten || code) return;
      process.exitCode = 1;
      fs.writeSync(2, `tracer: a trace write failed and its loss marker could not be written (${lostOut}) — exiting 1 so the traced test fails\n`);
    } catch (_) {
      // never break the traced process
    }
  }
  // Idempotent: the marker is attempted until it lands, and the exit listener is registered once.
  function markLost() {
    try {
      if (!lostWritten) writeLost();
      if (!lostListening) {
        lostListening = true;
        process.once('exit', onExit);
      }
    } catch (_) {
      // never break the traced process
    }
  }
  function emit(kind, r) {
    const line = JSON.stringify([kind, r]);
    if (seen.has(line)) return;
    try {
      if (!headerWritten) {
        appendFileSync(out, `${JSON.stringify(['T', test])}\n`);
        headerWritten = true;
      }
      appendFileSync(out, `${line}\n`);
      // Remembered only once written: a transient failure (EMFILE, ENOSPC) must not make this read
      // look recorded, so the next identical read retries it instead of being deduped away.
      seen.add(line);
    } catch (_) {
      markLost();
    }
  }
  failClosed = () => emit('c', '');

  // Records `p` (a path argument, relative to `base`) as `kind`; 'auto' picks d/f by what is on disk.
  function record(kind, p, base) {
    const s = toPathString(p);
    if (s === null) return;
    const abs = toAbs(s, base);
    const r = relOf(abs);
    if (r === null) return;
    if (kind === 'auto') {
      // Only cp/cpSync: Node 22 copies the tree internally, not through the patched fs reads (Node 20
      // lists directories through readdirSync, which adds a `d` record too), so a directory copy is a
      // content dependence on everything beneath it — a `d` listing alone would miss a modified file
      // inside the copied tree.
      const st = statSync(abs, { throwIfNoEntry: false });
      kind = st && st.isDirectory() ? 'c' : 'f';
    }
    emit(kind, r);
  }

  const CUSTOM = util.promisify.custom;
  // A wrapper that runs `before(arguments)` (guarded) and then the original, carrying the original's
  // own properties. A `before` that returns a function `done` gets it called after the original, as
  // `done(result, false)` or — when the original throws — `done(undefined, true)` before the original
  // error is rethrown unchanged; a throwing `done` fails closed and is never rethrown.
  // A promisify.custom implementation calls the unwrapped original directly, so it is replaced by a
  // wrapped copy under the original's attributes — and left out of the bulk copy, since Node defines it
  // non-configurable (copied first, it could never be replaced).
  // A promisified function's own custom slot points at itself (Node sets it so promisify is idempotent):
  // that self-reference maps to the wrapper, and only the top level's custom implementation is wrapped.
  function wrapFn(orig, before, nested = false) {
    const wrapped = function traced() {
      let done;
      try {
        done = before(arguments);
      } catch (_) {
        // never break the traced process
        failClosed();
      }
      if (typeof done !== 'function') return orig.apply(this, arguments);
      const after = (result, threw) => {
        try {
          done(result, threw);
        } catch (_) {
          // never break the traced process
          failClosed();
        }
      };
      let result;
      try {
        result = orig.apply(this, arguments);
      } catch (err) {
        after(undefined, true);
        throw err;
      }
      after(result, false);
      return result;
    };
    const descriptors = Object.getOwnPropertyDescriptors(orig);
    const customDesc = descriptors[CUSTOM];
    delete descriptors[CUSTOM];
    try {
      Object.defineProperties(wrapped, descriptors);
    } catch (_) {
      // a non-configurable property: keep what was copied
    }
    if (customDesc) {
      let value = customDesc.value;
      if (value === orig) value = wrapped;
      else if (typeof value === 'function' && !nested) value = wrapFn(value, before, true);
      try {
        Object.defineProperty(wrapped, CUSTOM, { ...customDesc, value });
      } catch (_) {
        // an accessor: keep the original's
        try { Object.defineProperty(wrapped, CUSTOM, customDesc); } catch (__) { /* none */ }
      }
    }
    return wrapped;
  }
  // Each patch is installed on its own: one that fails (a frozen or non-writable target) fails closed
  // and leaves every other patch in place.
  function patch(obj, name, before) {
    try {
      if (!obj || typeof obj[name] !== 'function') return;
      const orig = obj[name];
      const wrapped = wrapFn(orig, before);
      if (typeof orig.native === 'function') wrapped.native = wrapFn(orig.native, before);
      obj[name] = wrapped;
      if (obj[name] !== wrapped) failClosed();
    } catch (_) {
      failClosed();
    }
  }
  const first = (kind) => (args) => record(kind, args[0]);

  const FS_KINDS = {
    f: ['readFileSync', 'readFile', 'openSync', 'open', 'createReadStream', 'copyFileSync', 'copyFile',
      'statSync', 'stat', 'lstatSync', 'lstat'],
    s: ['existsSync', 'exists', 'accessSync', 'access', 'realpathSync', 'realpath', 'readlinkSync', 'readlink'],
    d: ['readdirSync', 'readdir', 'opendirSync', 'opendir'],
    auto: ['cpSync', 'cp'],
  };
  const PROMISE_KINDS = {
    f: ['readFile', 'open', 'copyFile', 'stat', 'lstat'],
    s: ['access', 'realpath', 'readlink'],
    d: ['readdir', 'opendir'],
    auto: ['cp'],
  };
  for (const [kind, names] of Object.entries(FS_KINDS)) for (const n of names) patch(fs, n, first(kind));
  for (const [kind, names] of Object.entries(PROMISE_KINDS)) for (const n of names) patch(fs.promises, n, first(kind));

  for (const ext of ['.js', '.json', '.cjs']) {
    patch(Module._extensions, ext, (args) => record('f', args[1]));
  }

  // The CJS resolver probes candidates through internal bindings, so an added `index.js` (or a `foo.js`
  // beside `foo/`, or a node_modules package) can change what a `require` resolves to without touching any
  // recorded read. resolutionCandidates lists, in Node's probe order, every path Module._resolveFilename /
  // _findPath / tryPackage / resolveExports would consult for a request — absolute paths, out-of-root ones
  // included (relOf filters at emit): `s` for an existence probe, `f` for a package.json whose content
  // (main, exports) is read, and `cover: true` on the `s` of a package directory resolved through `exports`
  // (its whole subtree holds the result). Null for a builtin or a non-string request; throws when Node's own
  // lookup helpers are unavailable (the hook's guard then fails closed).
  const EXPORTS_PATTERN = /^((?:@[^/\\%]+\/)?[^./\\%][^/\\%]*)(\/.*)?$/;
  const TRAILING_DOT = /[\\/]$|(?:^|[\\/])\.\.?$/;
  const isFile = (p) => {
    try {
      const st = statSync(p, { throwIfNoEntry: false });
      return Boolean(st) && st.isFile();
    } catch (_) {
      return false;
    }
  };
  // The package.json at `p`, parsed (unpatched read), or null when absent or unparseable.
  const readPackageJson = (p) => {
    try {
      return JSON.parse(readFileSync(p, 'utf8'));
    } catch (_) {
      return null;
    }
  };
  function resolutionCandidates(request, parent, options) {
    if (typeof request !== 'string') return null;
    if (typeof Module.isBuiltin === 'function' ? Module.isBuiltin(request) : request.startsWith('node:') || Module.builtinModules.includes(request)) return null;
    if (typeof Module._resolveLookupPaths !== 'function' || typeof Module._nodeModulePaths !== 'function') {
      throw new Error('Module lookup helpers unavailable');
    }
    const exts = Object.keys(Module._extensions);

    // Lookup dirs: Node's own derivation (a null entry = an absolute request, whose base is itself).
    let dirs;
    if (path.isAbsolute(request)) dirs = [null];
    else if (options && typeof options === 'object' && Array.isArray(options.paths)) {
      if (request.startsWith('./') || request.startsWith('../') || (process.platform === 'win32' && (request.startsWith('.\\') || request.startsWith('..\\')))) {
        dirs = options.paths.map((p) => toAbs(p));
      } else {
        dirs = [];
        // Node 22 counts the exact requests `.` and `..` as relative (the given paths are the lookup dirs); Node 20
        // does not (the fake parent's lookup answers), so both are kept — an over-record is safe.
        if (request === '.' || request === '..') {
          for (const p of options.paths) {
            const abs = toAbs(p);
            if (abs && !dirs.includes(abs)) dirs.push(abs);
          }
        }
        for (const p of options.paths) {
          const abs = toAbs(p);
          if (!abs) continue;
          for (const d of Module._resolveLookupPaths(request, { paths: Module._nodeModulePaths(abs) }) || []) {
            if (!dirs.includes(d)) dirs.push(d);
          }
        }
      }
    } else dirs = Module._resolveLookupPaths(request, parent) || [];

    const list = [];
    const listed = new Set();
    const add = (kind, abs, cover) => {
      const key = `${kind}\0${abs}`;
      if (listed.has(key)) return;
      listed.add(key);
      list.push(cover ? { kind, abs, cover: true } : { kind, abs });
    };
    const addExts = (b) => {
      for (const ext of exts) add('s', b + ext);
    };
    const addWithExts = (b) => {
      add('s', b);
      addExts(b);
    };
    const trailingSlash = TRAILING_DOT.test(request);

    for (const dir of dirs) {
      let base;
      if (dir === null) base = toAbs(request);
      else {
        const dirAbs = toAbs(dir);
        if (!dirAbs) continue;
        // resolveExports: a bare `name` / `@scope/name` (+ subpath) whose package.json declares `exports`.
        const m = EXPORTS_PATTERN.exec(request);
        if (m) {
          const pkgDir = path.join(dirAbs, m[1]);
          const pkgJson = path.join(pkgDir, 'package.json');
          if (isFile(pkgJson)) {
            add('f', pkgJson);
            const pkg = readPackageJson(pkgJson);
            if (pkg && pkg.exports != null) {
              add('s', pkgDir, true);
              continue;
            }
          } else add('s', pkgJson);
        }
        base = toAbs(request, dirAbs);
      }
      if (!base) continue;
      // _findPath: the path itself, then each extension (not for a request ending in `/`, `.` or `..`).
      if (!trailingSlash) addWithExts(base);
      // tryPackage: the directory's package.json `main`, then its index.
      const baseJson = path.join(base, 'package.json');
      let main;
      if (isFile(baseJson)) {
        add('f', baseJson);
        const pkg = readPackageJson(baseJson);
        if (pkg && typeof pkg.main === 'string' && pkg.main) main = pkg.main;
      } else add('s', baseJson);
      if (main !== undefined) {
        const m = path.resolve(base, main);
        addWithExts(m);
        addExts(path.join(m, 'index'));
      }
      addExts(path.join(base, 'index'));
    }
    return list;
  }

  // The index of the candidate `result` came from: the first whose path is the result (or, with `cover`,
  // holds it), else — Node returns a realpath — the first whose realpath is; -1 when none is.
  function winnerIndex(candidates, result) {
    const at = candidates.findIndex((c) => c.abs === result || (c.cover === true && result.startsWith(c.abs + path.sep)));
    if (at !== -1) return at;
    return candidates.findIndex((c) => {
      try {
        return realpathNative(c.abs) === result;
      } catch (_) {
        return false;
      }
    });
  }

  // Emitted after the original returns, so the candidates can be cut at the winner: one after the winner
  // cannot change the result while the winner exists, and the winner's own deletion is still recorded
  // because the winner stays in the list. A resolution that throws (or whose winner cannot be found) keeps
  // the whole list. Every earlier candidate is kept, except an `s` nested under an earlier kept `s` — the
  // add and delete of a nested path is already covered by impact.js's reads() ancestor rule (an `s` entry
  // selects a test for an added or deleted path equal to it or under it), and a nested path's modification
  // never affects resolution. `f` entries are never dropped: a package.json's content does.
  patch(Module, '_resolveFilename', (args) => {
    const candidates = resolutionCandidates(args[0], args[1], args[3]);
    if (candidates === null) return undefined;
    return (result, threw) => {
      let last = candidates.length - 1;
      if (!threw && typeof result === 'string') {
        const w = winnerIndex(candidates, result);
        if (w !== -1) last = w;
      }
      const keptS = [];
      for (let i = 0; i <= last; i++) {
        const c = candidates[i];
        const r = relOf(c.abs);
        if (r === null) continue;
        if (c.kind === 's') {
          if (keptS.some((k) => r === k || r.startsWith(`${k}/`))) continue;
          keptS.push(r);
        }
        emit(c.kind, r);
      }
    };
  });

  // ---- child processes ----

  const REQ = process.env.CT_TRACE_REQUIRE || '';
  function injectEnv(env) {
    if (env.CT_TRACE_ROOT !== undefined && env.CT_TRACE_ROOT !== ROOT_ENV) return env;
    const next = { ...env, CT_TRACE_ROOT: ROOT_ENV, CT_TRACE_DIR: DIR_ENV, CT_TRACE_TEST: test };
    if (REQ) {
      next.CT_TRACE_REQUIRE = REQ;
      const opts = typeof next.NODE_OPTIONS === 'string' ? next.NODE_OPTIONS : '';
      if (!opts.includes(REQ)) next.NODE_OPTIONS = opts ? `${opts} ${REQ}` : REQ;
    }
    return next;
  }

  // Splits a shell command line into its simple commands' words: quotes and backslashes are honoured,
  // `| ; & ( )` and newlines end a command, and a redirection's target is dropped (it is not an argument).
  function shellCommands(str) {
    const cmds = [[]];
    let word = null;
    let skipNext = false;
    const endWord = () => {
      if (word === null) return;
      if (skipNext) skipNext = false;
      else cmds[cmds.length - 1].push(word);
      word = null;
    };
    for (let i = 0; i < str.length;) {
      const ch = str[i];
      if (ch === "'") {
        const end = str.indexOf("'", i + 1);
        const stop = end === -1 ? str.length : end;
        word = (word || '') + str.slice(i + 1, stop);
        i = stop + 1;
      } else if (ch === '"') {
        let j = i + 1;
        let s = '';
        while (j < str.length && str[j] !== '"') {
          if (str[j] === '\\' && j + 1 < str.length) { s += str[j + 1]; j += 2; } else s += str[j++];
        }
        word = (word || '') + s;
        i = j + 1;
      } else if (ch === '\\' && i + 1 < str.length) {
        word = (word || '') + str[i + 1];
        i += 2;
      } else if (ch === '\n' || ch === '|' || ch === ';' || ch === '&' || ch === '(' || ch === ')') {
        endWord();
        cmds.push([]);
        i++;
      } else if (/\s/.test(ch)) {
        endWord();
        i++;
      } else if (ch === '>' || ch === '<') {
        if (word !== null && /^\d+$/.test(word)) word = null;
        else endWord();
        i++;
        while (str[i] === '>' || str[i] === '&') i++;
        skipNext = true;
      } else {
        word = (word || '') + ch;
        i++;
      }
    }
    endWord();
    return cmds.filter((c) => c.length > 0);
  }

  const isNode = (cmd) => {
    const base = path.basename(cmd).toLowerCase();
    return cmd === process.execPath || base === 'node' || base === 'node.exe';
  };
  const isGit = (cmd) => {
    const base = path.basename(cmd).toLowerCase();
    return base === 'git' || base === 'git.exe';
  };
  const existing = (abs) => (abs === null ? null : statSync(abs, { throwIfNoEntry: false }) || null);
  // A child's path argument: `c` for an in-repo directory, `f` for an in-repo file, nothing when it is absent.
  function recordExisting(t, base) {
    const abs = toAbs(t, base);
    const r = relOf(abs);
    if (r === null) return;
    const st = existing(abs);
    if (st) emit(st.isDirectory() ? 'c' : 'f', r);
  }

  // The git subcommands whose output depends on the content (or the listing) of tracked files — the
  // ones that are recorded as `c` prefixes. Writers and ref-only commands (add, commit, checkout,
  // rev-parse, ...) are absent on purpose: they do not make a test's result depend on a file's bytes.
  const GIT_CONTENT = new Set(['ls-files', 'grep', 'show', 'cat-file', 'ls-tree', 'archive', 'diff', 'log', 'status', 'blame']);
  const GIT_VALUE_OPTS = new Set(['-c', '--git-dir', '--work-tree', '--namespace', '--super-prefix', '--config-env']);

  const GLOB_CHARS = /[*?[]/;
  // The repo top for `:/` and `top` pathspec magic: the realpath form when it differs from the given
  // one (`roots` pushes it last above), because git reports and resolves against the real path.
  const TOP = roots[roots.length - 1];

  // git's global options before the subcommand: { cwd (absolute; undefined = the process cwd), sub (the
  // subcommand's index) }, or null when a `-C` value cannot be resolved.
  function gitGlobals(args, base) {
    let cwd = base;
    let i = 0;
    for (; i < args.length; i++) {
      const t = args[i];
      if (t === '-C') {
        cwd = toAbs(args[++i], cwd);
        if (!cwd) return null;
      } else if (GIT_VALUE_OPTS.has(t)) i++;
      else if (!t.startsWith('-')) break;
    }
    return { cwd, sub: i };
  }

  // A pathspec token's magic split off: `:(top,glob,…)pattern` or the short `:/` `:!` `:^` forms.
  // `base` is the repo top under `top` magic (and for a bare `:path` before `--`, git's index-blob
  // form), else the git cwd; `glob` is false under `literal` magic.
  function parsePathspec(t, cwdAbs, pathsOnly) {
    let magic = [];
    let pattern = t;
    if (t.startsWith(':(')) {
      const end = t.indexOf(')');
      if (end !== -1) {
        magic = t.slice(2, end).split(',').map((m) => m.trim().replace(/:.*$/, ''));
        pattern = t.slice(end + 1);
      }
    } else if (t.startsWith(':')) {
      let k = 1;
      for (; k < t.length && '/!^'.includes(t[k]); k++) magic.push(t[k] === '/' ? 'top' : 'exclude');
      if (t[k] === ':') k++;
      pattern = t.slice(k);
      if (magic.length === 0 && !pathsOnly) magic.push('top');
    }
    return {
      pattern,
      base: magic.includes('top') ? TOP : cwdAbs,
      exclude: magic.includes('exclude'),
      icase: magic.includes('icase'),
      glob: !magic.includes('literal') && GLOB_CHARS.test(pattern),
    };
  }

  // A literal path argument of a git content command: records f/c when it exists in the repo (or, after
  // `--`, f even when it does not) and returns whether it counted.
  function recordGitPath(t, base, pathsOnly) {
    const abs = toAbs(t, base);
    const r = relOf(abs);
    if (r === null) return false;
    const st = existing(abs);
    if (!st && !pathsOnly) return false;
    emit(st && st.isDirectory() ? 'c' : 'f', r);
    return true;
  }

  // One `git grep` option token: whether it gives a pattern (-e/--regexp, or -f/--file a pattern file),
  // whether it is -f/--file, and its value — attached (`-ePAT`, `--regexp=PAT`), or the next token
  // (`takesNext`). A short cluster's first value-taking letter takes the rest of the cluster or, last,
  // the next token; -A -B -C -m and the matching long options take a value too, so it is never read
  // as the pattern or a path.
  const GREP_LONG_VALUE = new Set(['--regexp', '--file', '--max-depth', '--threads', '--context',
    '--after-context', '--before-context', '--max-count']);
  function grepOption(t) {
    if (t.startsWith('--')) {
      const eq = t.indexOf('=');
      const name = eq === -1 ? t : t.slice(0, eq);
      const pattern = name === '--regexp' || name === '--file';
      const file = name === '--file';
      if (eq !== -1) return { pattern, file, takesNext: false, value: t.slice(eq + 1) };
      return { pattern, file, takesNext: GREP_LONG_VALUE.has(name), value: undefined };
    }
    for (let k = 1; k < t.length; k++) {
      const ch = t[k];
      if (ch === 'O') break; // -O[<pager>]: the rest of the cluster is its optional value
      if ('efABCm'.includes(ch)) {
        const last = k === t.length - 1;
        return { pattern: ch === 'e' || ch === 'f', file: ch === 'f', takesNext: last, value: last ? undefined : t.slice(k + 1) };
      }
    }
    return { pattern: false, file: false, takesNext: false, value: undefined };
  }

  // The git rule: a content subcommand run inside the root records its in-repo path arguments (or
  // `<rev>:<path>` paths), else `c` for its cwd's prefix. Returns false when the rule does not apply.
  // A glob or magic pathspec records `c` for its literal directory prefix (the segments before the first
  // one holding a glob character); an exclusion pathspec counts as no path.
  function recordGit(args, g) {
    const i = g.sub;
    if (!GIT_CONTENT.has(args[i])) return false;
    const cwdAbs = g.cwd === undefined ? currentCwd() : g.cwd;
    const prefix = relOf(cwdAbs);
    if (prefix === null) return false;
    let found = false;
    let pathsOnly = false;
    const grep = args[i] === 'grep';
    let patternGiven = false;
    for (let j = i + 1; j < args.length; j++) {
      const t = args[j];
      if (t === '') continue;
      if (!pathsOnly && t === '--') { pathsOnly = true; continue; }
      if (grep && !pathsOnly && t.startsWith('-')) {
        const opt = grepOption(t);
        if (opt.pattern) patternGiven = true;
        // A `-f <file>` pattern file is a content read, but not a pathspec: it never narrows the prefix.
        const value = opt.takesNext ? args[++j] : opt.value;
        if (opt.file && typeof value === 'string') record('f', value, cwdAbs);
        continue;
      }
      if (!pathsOnly && t.startsWith('-')) continue;
      // `git grep`'s first positional is its pattern (a regex), unless -e/-f already gave one.
      if (grep && !pathsOnly && !patternGiven) {
        patternGiven = true;
        continue;
      }
      if (t.startsWith(':') || GLOB_CHARS.test(t)) {
        const spec = parsePathspec(t, cwdAbs, pathsOnly);
        if (spec.exclude) continue;
        if (!spec.glob) {
          if (recordGitPath(spec.pattern, spec.base, pathsOnly)) found = true;
          continue;
        }
        const segments = spec.pattern.split('/');
        const literal = spec.icase ? [] : segments.slice(0, segments.findIndex((s) => GLOB_CHARS.test(s)));
        const r = relOf(toAbs(literal.join('/'), spec.base));
        if (r !== null) {
          emit('c', r);
          found = true;
        }
        continue;
      }
      if (recordGitPath(t, cwdAbs, pathsOnly)) {
        found = true;
        continue;
      }
      const colon = pathsOnly ? -1 : t.indexOf(':');
      if (colon === -1 || colon === t.length - 1) continue;
      // `<rev>:<path>` is relative to the repo top unless it starts with ./ or ../ — counted only when it
      // exists now, so an option value that merely holds a colon never hides the cwd-wide prefix.
      const p = t.slice(colon + 1);
      const pAbs = /^\.\.?[\\/]/.test(p) ? toAbs(p, cwdAbs) : toAbs(p, TOP);
      const pr = relOf(pAbs);
      const pst = pr === null ? null : existing(pAbs);
      if (pst) {
        emit(pst.isDirectory() ? 'c' : 'f', pr);
        found = true;
      }
    }
    if (!found) emit('c', prefix);
    return true;
  }

  const isShell = (cmd) => ['sh', 'bash', 'zsh', 'dash', 'ksh'].includes(path.basename(cmd).toLowerCase());
  // The names that carry the trace into a node child (it traces itself only while it inherits them).
  const dropsTrace = (name) => name === 'NODE_OPTIONS' || name.startsWith('CT_TRACE_');
  const isEnv = (cmd) => {
    const base = path.basename(cmd).toLowerCase();
    return base === 'env' || base === 'env.exe';
  };
  // The script of `sh [-opts] -c "<script>"` (a `-` cluster holding `c` makes the first operand the script),
  // or null. A cluster holding `o`/`O` takes the next word as its option name (`-o pipefail`, `+O extglob`);
  // `--rcfile`/`--init-file` take a value, handed to `onFile` (the shell reads it); `--` or `-` ends the options.
  // A script file operand is not one.
  function shellScript(words, onFile) {
    let sawC = false;
    for (let j = 1; j < words.length; j++) {
      const t = words[j];
      if (t === '--' || t === '-') return sawC && j + 1 < words.length ? words[j + 1] : null;
      if (t === '--rcfile' || t === '--init-file') {
        if (++j < words.length) onFile(words[j]);
        continue;
      }
      if (t.startsWith('--')) continue;
      if (/^[-+][A-Za-z]+$/.test(t)) {
        if (t[0] === '-' && t.includes('c')) sawC = true;
        if (/[oO]/.test(t)) j++;
        continue;
      }
      if (t.startsWith('-') || t.startsWith('+')) return null;
      return sawC ? t : null;
    }
    return null;
  }

  // `env [options] [NAME=value ...] command ...` as the command it runs: { words (the assignments kept),
  // base (moved by -C/--chdir, whose in-repo directory is recorded like any path argument), stripped (the
  // env no longer carries the trace) }, or null for an option this does not know (the caller then records
  // the arguments generically, as for any other command).
  function envCommand(words, base) {
    let j = 1;
    let stripped = false;
    for (; j < words.length; j++) {
      const t = words[j];
      if (t === '--') { j++; break; }
      if (['-i', '-', '--ignore-environment'].includes(t)) { stripped = true; continue; }
      if (['-0', '-v', '--null', '--debug'].includes(t)) continue;
      if (t === '-u' || t === '--unset') { j++; if (j < words.length && dropsTrace(words[j])) stripped = true; continue; }
      if (t === '-P') { j++; continue; }
      if (t.startsWith('--unset=') || (t.startsWith('-u') && !t.startsWith('--'))) {
        if (dropsTrace(t.slice(t.startsWith('--') ? '--unset='.length : 2))) stripped = true;
        continue;
      }
      if (t === '-C' || t === '--chdir' || t.startsWith('--chdir=')) {
        const dir = t.startsWith('--chdir=') ? t.slice('--chdir='.length) : words[++j];
        if (dir === undefined) return null;
        const next = toAbs(dir, base);
        if (next === null) return null;
        recordExisting(dir, base);
        base = next;
        continue;
      }
      if (t.startsWith('-')) return null;
      break;
    }
    return { words: words.slice(j), base, stripped };
  }

  // One child command (its words) run from `base` (absolute; undefined = the process cwd). Leading
  // `NAME=value` assignments are skipped; `env [options] cmd ...` is read as `cmd`; `sh -c "<script>"` is
  // read as the shell string it runs; a git command the git rule does not cover falls through with its
  // global options and their values dropped.
  // `stripped`: an enclosing env or assignment removed or replaced the trace variables, so a node child is not
  // self-tracing: it records `c ''` (its reads are unknown) and its path arguments like any other child.
  function recordCommand(commandWords, base, stripped = false) {
    let words = commandWords;
    let first = 0;
    while (first < words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[first])) {
      if (dropsTrace(words[first].slice(0, words[first].indexOf('=')))) stripped = true;
      first++;
    }
    if (first === words.length) return;
    if (first) words = words.slice(first);
    const cmd = words[0];
    if (isEnv(cmd)) {
      const e = envCommand(words, base);
      if (e) { recordCommand(e.words, e.base, stripped || e.stripped); return; }
    }
    if (isNode(cmd)) {
      if (!stripped) return;
      // It cannot trace itself, so what it reads is unknown: fail closed, beside its path arguments below.
      emit('c', '');
    }
    if (isShell(cmd)) {
      const script = shellScript(words, (file) => recordExisting(file, base));
      if (script !== null) {
        for (const c of shellCommands(script)) recordCommand(c, base, stripped);
        return;
      }
    }
    if (isGit(cmd)) {
      const args = words.slice(1);
      const g = gitGlobals(args, base);
      if (!g) return;
      if (recordGit(args, g)) return;
      words = args.slice(g.sub);
      base = g.cwd;
    }
    for (let k = 0; k < words.length; k++) {
      const t = words[k];
      if (t === '' || t.startsWith('-')) continue;
      if (k === 0 && !t.includes('/') && !t.includes('\\')) continue;
      recordExisting(t, base);
    }
  }

  const optionsIndex = (args) => {
    for (let k = 1; k < args.length; k++) {
      const v = args[k];
      if (v && typeof v === 'object' && !Array.isArray(v)) return k;
    }
    return -1;
  };

  // An option as child_process reads it: Node copies only the options object's own enumerable properties.
  const own = (opts, key) => (opts && Object.prototype.propertyIsEnumerable.call(opts, key) ? opts[key] : undefined);

  function beforeChild(name) {
    return (args) => {
      const k = optionsIndex(args);
      const opts = k === -1 ? null : args[k];
      const env = own(opts, 'env');
      if (env && typeof env === 'object') {
        args[k] = Object.assign(Object.create(Object.getPrototypeOf(opts)), opts, { env: injectEnv(env) });
      }
      if (name === 'fork') return;
      let base;
      const cwd = own(opts, 'cwd');
      if (cwd != null) {
        base = toAbs(toPathString(cwd), undefined);
        if (!base) return;
      }
      let commands;
      if (name === 'exec' || name === 'execSync') commands = shellCommands(String(args[0]));
      else {
        const words = [String(args[0])].concat(Array.isArray(args[1]) ? args[1].map(String) : []);
        commands = own(opts, 'shell') ? shellCommands(words.join(' ')) : [words];
      }
      for (const words of commands) recordCommand(words, base);
    };
  }
  for (const name of ['spawn', 'spawnSync', 'execFile', 'execFileSync', 'exec', 'execSync', 'fork']) {
    patch(cp, name, beforeChild(name));
  }

  try {
    Module.syncBuiltinESMExports();
  } catch (_) {
    // ESM named imports would keep the unwrapped functions
    failClosed();
  }
}
