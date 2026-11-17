'use strict';
// tools/guard-refusals/replay.js — #5590: replays each refused read-only row against this checkout's
// guard and gives it a disposition. A pure module: rows in (summarize()'s rows plus `cwd`), counts out;
// the rewrite, the write-gate scanner and the shape detector are injected (defaultDeps() wires the real ones).
//
// Semantics (the contract the CLI and its tests rely on):
//   dispositions   over rows whose effect is `read`.
//     plugin rows (guard `plugin:*`): still-denied when gitTargets holds an action in GATE_COVERAGE.gitActions
//       or fileWriteTargets / mkdirTargets return a non-empty list; no-longer-denied otherwise; scanner-failed
//       when a scanner throws (never no-longer-denied). A missing cwd is '/'.
//     harness rows (guard `harness-command`), first match wins: other-checkout (readClass); rewritten (a rule
//       changes the text and detect() finds nothing in the result); refused-shape (detect() finds a shape in
//       the rewritten text, else the original; `detector` is its first id, counted in refusedShapeById);
//       long-chain (chainLength >= 4); passes-now (the row's reason is one section 7 records as no longer
//       given, shapes.js FORMER_REASONS, and the row predates the day that row was last probed); else
//       unexplained. A throwing rewrite or detect leaves the row unexplained.
//     `unexplainedByReason` counts the unexplained harness rows by the row's `reason` (null as `none`).
//   writeTargetsMoved / writeTargetsRespelled / writeTargetsLost / writeTargetsChecked   over every Bash row (any
//     guard, any effect) with an absolute cwd, not truncated, that a rule changes: checked counts the rows
//     compared. moved counts those where any scanner list (JSON.stringify) differs between the original and
//     the rewritten text once both have their literal assignments written out (spellOutAssignments): the
//     rewrite changed where the command writes. respelled counts those where the lists differ only as the
//     texts stand: the same write, which the scanner resolves in one spelling and not in the other. lost
//     counts those where a target in a before-list is missing from the matching after-list, as the texts
//     stand (a gained target alone is not lost). A throw skips the row, counted in writeTargetsSkipped.
//   notReplayed   Bash rows (any guard, any effect) no rule could be tried on or whose rewrite threw, by cause:
//     truncated, noCwd, rewriteFailed. A harness read among them is judged on its original text only.
//   ruleNotApplied   harness-command Bash rows, any effect, not truncated, whose rewrite applies and whose
//     rewritten text detect() leaves clean, counted only when EVERY applied rule shipped (RULE_SINCE non-null)
//     and the row's ts is on or after the day AFTER that release day (UTC): a refusal on the release day itself
//     may predate the build. The row counts under each applied rule; `total` counts distinct rows.
//   byClass   git-C-own, exit-status, collision-fence over all rows, keyed by SESSION version: the first
//     pluginVersion any row of the same `file` yields, else unknown (unknownVersion).
//   byPattern   per supplied { id, pattern }: matching rows and how many a rule changes. A shape counts as
//     changed only when rewritten === count. null when no patterns are given.
// Nothing here throws: a failing dependency skips that row's check.

const path = require('node:path');
const { detectShapes, lexShell, FORMER_REASONS } = require('./shapes');
const { gitTargets, fileWriteTargets, mkdirTargets } = require('../../plugin/bin/lib/hooks/git-command');
const { GATE_COVERAGE } = require('../../plugin/bin/lib/hooks/pre-tool-use');
const { rewriteForGuard } = require('../../plugin/bin/lib/hooks/guard-rewrite');

// The rewriter's worktree and realpath probes are stubbed (its plugin-root probe still reads this checkout):
// the verdict is "the rules in this checkout change this text", never a claim about the session's disk.
const REWRITE_DEPS = { isLinkedWorktree: () => true, canonicalRealpath: (p) => p.replace(/\/+$/, '') || p };

// Rule id -> the release day (UTC) it shipped in, null while no release carries it. Keep in step with
// RULE_IDS (a test pins the key set).
const RULE_SINCE = {
  'drop-redundant-cd': '2026-10-25',
  'inline-literal-assignment': '2026-10-25',
  'plugin-root-placeholder': '2026-10-25',
  'node-eval-separator': '2026-10-25',
  'quote-escaped-space': '2026-10-25',
  'drop-git-C-cwd': null,
  'quote-exit-status': null,
};

const DAY_MS = 86400e3;
const LONG_CHAIN = 4;

function defaultDeps() {
  return {
    rewrite: (command, cwd) => rewriteForGuard({ command, cwd, deps: REWRITE_DEPS }),
    scanner: { gitTargets, fileWriteTargets, mkdirTargets },
    detect: (t) => detectShapes(t, { placeholders: false }),
  };
}

// Simple commands at the top level: split at ; && || | and newline in `plain` state outside $(…), backtick
// and (…) nesting; a segment with no real text (blank, comment, heredoc body only) is not counted.
function chainLength(text) {
  const kinds = lexShell(text);
  let depth = 0;
  let tick = false;
  let count = 0;
  let has = false;
  const flush = () => { if (has) count++; has = false; };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const k = kinds[i];
    if (k === 'plain') {
      if (c === '`') { tick = !tick; has = true; continue; }
      if (c === '(') { depth++; has = true; continue; }
      if (c === ')') { if (depth > 0) depth--; has = true; continue; }
      if (depth === 0 && !tick) {
        const sep = c === ';' || c === '\n' || c === '|'
          || (c === '&' && (text[i + 1] === '&' || text[i - 1] === '&') && text[i - 1] !== '>' && text[i - 1] !== '<');
        if (sep) { flush(); continue; }
      }
    }
    if (k !== 'comment' && k !== 'heredoc' && !/\s/.test(c)) has = true;
  }
  flush();
  return count;
}

const CACHE_VERSION = /[/\\]plugins[/\\]cache[/\\][^/\\\s'"]+[/\\]claude-tweaks[/\\](\d+\.\d+\.\d+)/;
function pluginVersion(command) {
  const m = CACHE_VERSION.exec(command);
  return m ? m[1] : 'unknown';
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
const END = '(?=[\\s;&|)]|$)';

function gitCOwn(text, cwd) {
  const alts = ['\\.' + END, "'\\.'", '"\\."'];
  if (typeof cwd === 'string' && cwd) {
    const c = escapeRe(cwd.replace(/\/+$/, '') || cwd);
    alts.push(`${c}\\/?${END}`, `'${c}\\/?'`, `"${c}\\/?"`);
  }
  // `git` must be an unquoted word of its own: not inside quotes, not the tail of `my-git`, `./git` or `x.git`.
  // A directory prefix (`/usr/bin/git`, `./bin/git`) still runs real git.
  const re = new RegExp(`(?<![\\w./-])(?:(?:\\.{0,2}\\/)?(?:(?!\\.+\\/)[\\w.-]+\\/)+|\\/)?git\\s+-C\\s+(?:${alts.join('|')})`, 'g');
  const kinds = lexShell(text);
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (kinds[m.index] === 'plain') return true;
  }
  return false;
}

function plainContains(text, needle) {
  const kinds = lexShell(text);
  for (let i = text.indexOf(needle); i !== -1; i = text.indexOf(needle, i + 1)) {
    if (kinds[i] === 'plain' && kinds[i + needle.length - 1] === 'plain') return true;
  }
  return false;
}

function isSubagent(file) {
  return typeof file === 'string' && file.split(/[\\/]/).includes('subagents');
}

function bump(map, key) {
  map[key] = (map[key] || 0) + 1;
}

function scanAll(scanner, command, cwd) {
  return [scanner.gitTargets(command, cwd), scanner.fileWriteTargets(command, cwd), scanner.mkdirTargets(command, cwd)];
}

// The write gate's scanner follows a variable one hop, and only when it is a word's single reference
// (git-command.js updateAssignment / substituteVars, by design). In `S=/a; F=$S/b; sed -i … $F` it
// resolves no target; once inline-literal-assignment has written F's value out it resolves /a/b. The
// command writes the same file either way. spellOutAssignments() writes each such value out, and
// replay() scans both texts in that spelling, so a difference left over is a write that really moved.
//
// It reads a top-level statement that is exactly `NAME=value` (ended by `;`, `&&`, a newline or the
// end of the text), outside `$(…)`, `(…)` and backticks and before the first compound command (`if`,
// `for`, `while`, `until`, `case`, `select`, `function`) or `{`. The value must be literal text once
// earlier names are written out, and the text may assign NAME nowhere else (a second `NAME=` or
// `NAME+=` anywhere, or `for`/`read`/`export`/`local`/`declare`/`typeset`/`readonly NAME`). A later
// `$NAME` or `${NAME}` outside single quotes, comments and heredoc bodies becomes the value; an
// unquoted one only when the value holds no space. A statement after `&&` is read as run. One forward
// pass: every lookup reads a fixed window, and a blank run is skipped once per statement. A value longer
// than VALUE_MAX is not learned, and a text whose written-out values pass SPELL_BUDGET characters comes
// back unchanged (a chain of assignments can double a value at each step), so the output stays bounded.
const NAME_WINDOW = 256;
const VALUE_MAX = 1024;
const SPELL_BUDGET = 1 << 16;
const REF = /^\$(?:\{([A-Za-z_]\w*)\}|([A-Za-z_]\w*))/;
const ASSIGNMENT = /^([A-Za-z_]\w*)=/;
const ASSIGNED_ANYWHERE = /(?<![\w$])([A-Za-z_]\w*)\+?=/g;
const ASSIGNED_BY_WORD = /\b(?:for|read|export|local|declare|typeset|readonly)[ \t]+(?:-\w+[ \t]+)*([A-Za-z_]\w*)/g;
const COMPOUND = /^(?:if|for|while|until|case|select|function)(?![\w-])/;
const VALUE_CHAR = /[\w./@:+,=%-]/;

function spellOutAssignments(text) {
  const kinds = lexShell(text);
  const assigned = {};
  for (const m of text.matchAll(ASSIGNED_ANYWHERE)) bump(assigned, m[1]);
  for (const m of text.matchAll(ASSIGNED_BY_WORD)) assigned[m[1]] = 2;
  const known = new Map();
  const refAt = (i) => {
    const m = REF.exec(text.slice(i, i + NAME_WINDOW));
    const name = m && m[0].length < NAME_WINDOW ? m[1] || m[2] : null;
    return name && known.has(name) ? { length: m[0].length, value: known.get(name) } : null;
  };
  // The statement `NAME=value` that starts at `i`, as { name, value, end }, or null.
  const assignmentAt = (i) => {
    const m = ASSIGNMENT.exec(text.slice(i, i + NAME_WINDOW));
    if (!m || assigned[m[1]] !== 1) return null;
    let value = '';
    let j = i + m[0].length;
    for (; j < text.length; j++) {
      const c = text[j];
      const k = kinds[j];
      if (k === 'plain' && /[\s;&|()<>]/.test(c)) break;
      if (k === 'delim' && c !== '$') continue;
      if (k !== 'plain' && k !== 'double' && k !== 'single') return null;
      if (c === '$' && k !== 'single') {
        const ref = refAt(j);
        if (!ref) return null;
        value += ref.value;
        j += ref.length - 1;
      } else if (VALUE_CHAR.test(c) || (c === ' ' && k !== 'plain')) value += c;
      else return null;
    }
    let e = j;
    while (text[e] === ' ' || text[e] === '\t') e++;
    const ended = e >= text.length || text[e] === ';' || text[e] === '\n' || (text[e] === '&' && text[e + 1] === '&');
    return value && value.length <= VALUE_MAX && ended ? { name: m[1], value, end: j } : null;
  };

  let out = '';
  let spent = 0;
  let start = true; // at the start of a statement
  let learning = true; // no compound command or `{` seen yet
  let depth = 0;
  let tick = false;
  for (let i = 0; i < text.length;) {
    const c = text[i];
    const k = kinds[i];
    if (c === '\\' && (k === 'plain' || k === 'double')) {
      out += text.slice(i, i + 2);
      i += 2;
      start = false;
      continue;
    }
    if (k === 'plain' && start && learning && depth === 0 && !tick) {
      const a = assignmentAt(i);
      if (a) {
        known.set(a.name, a.value);
        spent += a.value.length;
        out += `${a.name}=${a.value.includes(' ') ? `"${a.value}"` : a.value}`;
        i = a.end;
        start = false;
        continue;
      }
      if (COMPOUND.test(text.slice(i, i + 10))) learning = false;
    }
    if (c === '$' && (k === 'plain' || k === 'double')) {
      const ref = refAt(i);
      if (ref && (k === 'double' || !ref.value.includes(' '))) {
        spent += ref.value.length;
        if (spent > SPELL_BUDGET) return text;
        out += ref.value;
        i += ref.length;
        start = false;
        continue;
      }
    }
    if (k === 'plain') {
      if (c === '`') tick = !tick;
      else if (c === '(') depth++;
      else if (c === ')' && depth > 0) depth--;
      else if (c === '{' && text[i - 1] !== '$') learning = false;
    }
    if (k === 'plain' && (c === ';' || c === '\n' || (c === '&' && text[i - 1] === '&'))) start = true;
    else if (c !== ' ' && c !== '\t') start = false;
    out += c;
    i++;
  }
  return out;
}

// A refusal whose reason section 7 records as no longer given (FORMER_REASONS), dated before the day
// that row was last probed. From that day on the same reason contradicts the row and stays unexplained.
function formerlyRefused(r) {
  const former = Object.hasOwn(FORMER_REASONS, r.reason) ? FORMER_REASONS[r.reason] : null;
  const t = Date.parse(r.ts);
  return Boolean(former) && Number.isFinite(t) && t < Date.parse(`${former.until}T00:00:00Z`);
}

function sinceOk(rules, ts) {
  const t = Date.parse(ts);
  if (!Number.isFinite(t)) return false;
  return rules.every((id) => {
    const day = RULE_SINCE[id];
    return day != null && t >= Date.parse(`${day}T00:00:00Z`) + DAY_MS;
  });
}

function replay(rows, given = {}) {
  const defaults = defaultDeps();
  const rewrite = given.rewrite || defaults.rewrite;
  const scanner = given.scanner || defaults.scanner;
  const detect = given.detect || defaults.detect;
  const patterns = given.patterns || null;

  const dispositions = {
    plugin: { 'still-denied': 0, 'no-longer-denied': 0, 'scanner-failed': 0 },
    harness: { 'other-checkout': 0, rewritten: 0, 'refused-shape': 0, 'long-chain': 0, 'passes-now': 0, unexplained: 0 },
    refusedShapeById: {},
    unexplainedByReason: {},
    rows: [],
  };
  const ruleNotApplied = { total: 0, byRule: {} };
  const byClass = {};
  for (const id of ['git-C-own', 'exit-status', 'collision-fence']) byClass[id] = { total: 0, unknownVersion: 0, byVersion: {} };
  let writeTargetsMoved = 0;
  let writeTargetsChecked = 0;
  let writeTargetsLost = 0;
  let writeTargetsRespelled = 0;
  // Rewritten rows whose scan threw, so they entered neither writeTargetsChecked nor the moved/lost counts.
  let writeTargetsSkipped = 0;
  // Bash rows no rule could be tried on (truncated text, no absolute cwd) or whose rewrite threw:
  // a harness read among them lands in refused-shape, long-chain or unexplained without a rewrite.
  const notReplayed = {};

  // A row without a file is its own session, never pooled with other file-less rows.
  const sessionKey = (r) => (typeof r.file === 'string' && r.file ? r.file : r);
  const sessionVersion = new Map();
  for (const r of rows) {
    const v = pluginVersion(r.command || '');
    if (v !== 'unknown' && !sessionVersion.has(sessionKey(r))) sessionVersion.set(sessionKey(r), v);
  }
  const countClass = (id, r) => {
    const v = sessionVersion.get(sessionKey(r));
    byClass[id].total++;
    if (v) bump(byClass[id].byVersion, v); else byClass[id].unknownVersion++;
  };
  // An invalid pattern is reported under its id, never thrown.
  const byPattern = patterns ? {} : null;
  const compiled = [];
  for (const { id, pattern } of patterns || []) {
    try {
      compiled.push({ id, re: new RegExp(pattern) });
      byPattern[id] = { count: 0, rewritten: 0 };
    } catch { byPattern[id] = { error: 'invalid pattern' }; }
  }

  for (const r of rows) {
    const command = typeof r.command === 'string' ? r.command : '';
    const isBash = r.tool === 'Bash';
    const absCwd = typeof r.cwd === 'string' && path.isAbsolute(r.cwd);
    // One rewrite per row; `failed` marks a throw, `rw` the applied result (null: no rule changes it).
    let rw = null;
    let failed = false;
    if (isBash && !r.truncated && absCwd) {
      try {
        const res = rewrite(command, r.cwd);
        rw = res && res.command !== command ? res : null;
      } catch { failed = true; bump(notReplayed, 'rewriteFailed'); }
    } else if (isBash) bump(notReplayed, r.truncated ? 'truncated' : 'noCwd');

    if (r.effect === 'read' && /^plugin:/.test(r.guard || '')) {
      let d;
      try {
        // A truncated command is cut text: the scanner cannot judge it.
        if (r.truncated) throw new Error('truncated');
        const cwd = absCwd ? r.cwd : '/';
        const [git, writes, mkdirs] = scanAll(scanner, command, cwd);
        const denied = git.some((t) => GATE_COVERAGE.gitActions.includes(t.action)) || writes.length > 0 || mkdirs.length > 0;
        d = denied ? 'still-denied' : 'no-longer-denied';
      } catch { d = 'scanner-failed'; }
      dispositions.plugin[d]++;
      dispositions.rows.push({ toolUseId: r.toolUseId, disposition: d });
    } else if (r.effect === 'read' && r.guard === 'harness-command') {
      let d;
      let detector;
      if (r.readClass === 'other-checkout') d = 'other-checkout';
      else if (failed) d = 'unexplained';
      else {
        try {
          const shapes = detect(rw ? rw.command : command);
          if (rw && !shapes.length) d = 'rewritten';
          else if (shapes.length) { d = 'refused-shape'; detector = shapes[0]; }
          else if (chainLength(command) >= LONG_CHAIN) d = 'long-chain';
          else d = formerlyRefused(r) ? 'passes-now' : 'unexplained';
        } catch { d = 'unexplained'; }
      }
      dispositions.harness[d]++;
      if (detector) bump(dispositions.refusedShapeById, detector);
      if (d === 'unexplained') bump(dispositions.unexplainedByReason, r.reason || 'none');
      dispositions.rows.push(detector ? { toolUseId: r.toolUseId, disposition: d, detector } : { toolUseId: r.toolUseId, disposition: d });
    }

    if (isBash && !r.truncated && absCwd && rw) {
      try {
        const before = scanAll(scanner, command, r.cwd);
        const after = scanAll(scanner, rw.command, r.cwd);
        // An unchanged spelling scans the same: the lists are reused.
        const spelt = [spellOutAssignments(command), spellOutAssignments(rw.command)];
        const spelledBefore = spelt[0] === command ? before : scanAll(scanner, spelt[0], r.cwd);
        const spelledAfter = spelt[1] === rw.command ? after : scanAll(scanner, spelt[1], r.cwd);
        writeTargetsChecked++;
        if (JSON.stringify(spelledBefore) !== JSON.stringify(spelledAfter)) writeTargetsMoved++;
        else if (JSON.stringify(before) !== JSON.stringify(after)) writeTargetsRespelled++;
        const lost = before.some((list, i) => {
          const kept = new Set(after[i].map((t) => JSON.stringify(t)));
          return list.some((t) => !kept.has(JSON.stringify(t)));
        });
        if (lost) writeTargetsLost++;
      } catch { writeTargetsSkipped++; }
    }

    if (r.guard === 'harness-command' && rw && rw.applied && rw.applied.length && sinceOk(rw.applied, r.ts)) {
      let clean = false;
      try { clean = detect(rw.command).length === 0; } catch { /* skipped */ }
      if (clean) {
        ruleNotApplied.total++;
        const version = pluginVersion(command);
        for (const id of rw.applied) {
          const entry = ruleNotApplied.byRule[id] || (ruleNotApplied.byRule[id] = { total: 0, byVersion: {} });
          entry.total++;
          const slot = entry.byVersion[version] || (entry.byVersion[version] = { main: 0, subagent: 0 });
          slot[isSubagent(r.file) ? 'subagent' : 'main']++;
        }
      }
    }

    if (r.effect === 'read') {
      if (gitCOwn(command, r.cwd)) countClass('git-C-own', r);
      if (plainContains(command, '$?')) countClass('exit-status', r);
    }
    if (command.includes('node-eval-file.js') && command.includes('remote-branch-collision')) countClass('collision-fence', r);

    for (const { id, re } of compiled) {
      if (re.test(command)) {
        byPattern[id].count++;
        if (rw) byPattern[id].rewritten++;
      }
    }
  }

  return { dispositions, writeTargetsMoved, writeTargetsRespelled, writeTargetsLost, writeTargetsChecked, writeTargetsSkipped, notReplayed, ruleNotApplied, byClass, byPattern };
}

module.exports = { replay, RULE_SINCE, REWRITE_DEPS, chainLength, pluginVersion, defaultDeps, spellOutAssignments };
