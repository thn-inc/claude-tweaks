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
//       long-chain (chainLength >= 4); else unexplained. A throwing rewrite or detect leaves the row unexplained.
//     `unexplainedByReason` counts the unexplained harness rows by the row's `reason` (null as `none`).
//   writeTargetsMoved / writeTargetsLost / writeTargetsChecked   over every Bash row (any guard, any effect) with
//     an absolute cwd, not truncated, that a rule changes: checked counts the rows compared, moved those where
//     any scanner list (JSON.stringify) differs between the original and rewritten text, lost those where a
//     target in a before-list is missing from the matching after-list (a gained target alone is moved, not
//     lost). A throw skips the row.
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
const { detectShapes, lexShell } = require('./shapes');
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
  const re = new RegExp(`(?<![\\w./-])git\\s+-C\\s+(?:${alts.join('|')})`, 'g');
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
    harness: { 'other-checkout': 0, rewritten: 0, 'refused-shape': 0, 'long-chain': 0, unexplained: 0 },
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
      } catch { failed = true; }
    }

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
          else d = chainLength(command) >= LONG_CHAIN ? 'long-chain' : 'unexplained';
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
        writeTargetsChecked++;
        if (JSON.stringify(before) !== JSON.stringify(after)) writeTargetsMoved++;
        const lost = before.some((list, i) => {
          const kept = new Set(after[i].map((t) => JSON.stringify(t)));
          return list.some((t) => !kept.has(JSON.stringify(t)));
        });
        if (lost) writeTargetsLost++;
      } catch { /* skipped: not compared */ }
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

    if (compiled.length) {
      for (const { id, re } of compiled) {
        if (re.test(command)) {
          byPattern[id].count++;
          if (rw) byPattern[id].rewritten++;
        }
      }
    }
  }

  return { dispositions, writeTargetsMoved, writeTargetsLost, writeTargetsChecked, ruleNotApplied, byClass, byPattern };
}

module.exports = { replay, RULE_SINCE, REWRITE_DEPS, chainLength, pluginVersion, defaultDeps };
