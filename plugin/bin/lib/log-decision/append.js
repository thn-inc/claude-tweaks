// Format one _shared/auto-decision-log.md entry and append it to a run's
// decisions.md — the decisions.md half of #637's "no CLI writes decisions.md
// or staged/" gap (the staged/ half now ships as bin/stage-item.js /
// bin/lib/stage-item/write.js). Every AUTO / STAGED site that used to compose
// the line by hand (or via a scratch node -e) calls bin/log-decision.js,
// which is a thin wrapper over this module.
// The run dir must resolve under the main checkout ($RUN_ROOT — see
// _shared/pipeline-run-dir.md's Anchoring section): a worktree-local shadow
// copy is refused, never silently written ([IL-127]).
//
// Anchoring is a structural .git check, not a domain-name check: ADR-0004
// (docs/decisions/0004-worktree-two-domain-convention.md) documents
// `.claude/worktrees/` and `.worktrees/` as two permanently separate,
// equally live linked-worktree domains, so a substring match on one name
// misses the other. Instead we walk up from the run dir to the nearest
// ancestor holding a `.git` entry: a `.git` file (a linked worktree of
// either domain, or a submodule) is refused — never the main checkout; a
// DIRECTORY means a real checkout root, which must match the resolved
// mainRoot. No `.git` found anywhere above the run dir also refuses — this
// predicate fails CLOSED on the unknown case, same as
// bin/lib/hooks/worktree-reap.js.
'use strict';

const fs = require('fs');
const path = require('path');
const { mainCheckoutRoot, safeReal } = require('../hooks/worktree-detect');
const { withLock } = require('../file-lock');
const { writeFileAtomic } = require('../atomic-write');

const STATUSES = ['AUTO', 'STAGED', 'KEPT-PROMPT', 'SCANNED', 'REFUSED', 'SKIP'];

function pad2(n) { return String(n).padStart(2, '0'); }

function hms(now) {
  const d = new Date(now);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

// { status, now, step?, spec?, text, reversibility?, lever? } -> one schema line (no newline).
function formatEntry({ status, now, step, spec, text, reversibility = 'n/a', lever }) {
  if (!STATUSES.includes(status)) throw new Error(`invalid status: ${status} (expected ${STATUSES.join('|')})`);
  const body = String(text || '').trim();
  if (!body) throw new Error('text is required');
  const hasSpec = spec != null && spec !== '';
  let location;
  if (step && hasSpec) location = `spec #${spec} — ${step}`;
  else if (step) location = String(step);
  else if (hasSpec) location = `spec #${spec}`;
  else location = 'log-decision';
  const action = /[.!?]$/.test(body) ? body : `${body}.`;
  let line = `- ${status} ${hms(now)} — ${location}: ${action} Reversibility: ${reversibility}.`;
  if (lever) line += ` [lever: ${lever}]`;
  return line;
}

// The inverse of formatEntry's fixed prefix: `- {STATUS} {HH:MM:SS} — {location}: {action}`.
// Returns null for anything that is not an entry line (a heading, a blank, a
// hand-written note) — callers must treat null as "not an entry", never as a match.
const ENTRY_RE = new RegExp(`^- (${STATUSES.join('|')}) (\\d{2}:\\d{2}:\\d{2}) — (.+?): (.*)$`);

function parseEntry(line) {
  const m = ENTRY_RE.exec(String(line));
  return m ? { status: m[1], time: m[2], location: m[3], action: m[4] } : null;
}

// Walk up from `startDir` for the nearest ancestor containing a `.git` entry.
// Returns { dir, isFile } for the first hit, or null if none exists above the
// filesystem root.
function findGitRoot(startDir) {
  let dir = startDir;
  for (;;) {
    let st;
    try { st = fs.statSync(path.join(dir, '.git')); } catch { st = null; }
    if (st) return { dir, isFile: st.isFile() };
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function isDirectory(p) {
  try { return fs.statSync(p).isDirectory(); } catch { return false; }
}

// { runDir, cwd?, mainRoot? } -> { ok, file } | { ok:false, reason:'missing'|'not-anchored' }
function resolveTarget({ runDir, cwd = process.cwd(), mainRoot }) {
  const real = safeReal(runDir);
  if (!real || !isDirectory(real)) return { ok: false, reason: 'missing' };

  const found = findGitRoot(real);
  if (!found || found.isFile) return { ok: false, reason: 'not-anchored' };
  const gitRoot = found.dir;

  // `mainRoot: undefined` (production callers' default) means "compute the
  // anchor" — if mainCheckoutRoot(cwd) can't determine one (cwd not in a git
  // repo, e.g. a cron job/sandbox script), that's the unknown case this
  // predicate is documented above to fail CLOSED on, not an invitation to
  // accept whatever real checkout the run dir happens to sit in ([IL-127]-
  // class bypass). An explicit `mainRoot: null` is a distinct, deliberate
  // opt-out kept for callers that only want the .git-file structural gate
  // above and never asked for a domain match.
  let anchor = mainRoot;
  if (mainRoot === undefined) {
    anchor = mainCheckoutRoot(cwd);
    if (!anchor) return { ok: false, reason: 'not-anchored' };
  }
  if (anchor && (safeReal(anchor) || anchor) !== gitRoot) return { ok: false, reason: 'not-anchored' };
  return { ok: true, file: path.join(real, 'decisions.md') };
}

// Normalize a `--section` value before it's used to build a decisions.md
// heading (#2549). Under Git Bash (MSYS) on Windows with MSYS_NO_PATHCONV
// unset, MSYS's automatic path-conversion rewrites a leading-slash argument
// into a Windows path before Node ever sees it — `--section "/reflect"`
// arrives here as `--section "C:/Program Files/Git/reflect"`. Reverse that
// shape first; otherwise, treat a value with no leading slash as the
// slash-free calling form (the MSYS-proof alternative every future call site
// can use) and prepend one. A value that already starts with `/` (the normal,
// unmangled case) is returned unchanged — never double-slashed.
function normalizeSection(section) {
  if (!section) return section;
  const msysMatch = /^[A-Za-z]:\/.*?\/Git\/(.+)$/.exec(section);
  if (msysMatch) return `/${msysMatch[1]}`;
  if (!section.startsWith('/')) return `/${section}`;
  return section;
}

// { runDir, section?, entry } -> { file, created }. Append-only; never rewrites prior lines.
//
// Two concurrent invocations against the same run dir (e.g. two `node
// bin/log-decision.js` processes) do a read-modify-write of decisions.md — an
// unguarded pair can each read the same pre-append content and each overwrite
// the other's line (#816). Guarded two ways, mirroring bin/lib/flow/manifest.js's
// writeManifest: the whole read-modify-write-rename sequence runs under
// ../file-lock.js's mkdir-based mutex (so a second writer's read can't start
// until the first's rename has landed), and the write itself goes through
// bin/lib/atomic-write.js's writeFileAtomic (#1653), which writes a
// per-process tmp file then fs.renameSync's atomically over decisions.md (so
// a reader never observes a torn/partial file even without the lock). The
// lock is best-effort/fail-open (file-lock.js's own contract) — a write that
// can't acquire it in time still proceeds unlocked rather than hang the
// caller.
function appendEntry({ runDir, section, entry }) {
  const lockPath = path.join(runDir, '.decisions.lock');
  return withLock(lockPath, () => {
    const file = path.join(runDir, 'decisions.md');
    let created = false;
    let text;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
      created = true;
      text = '';
    }
    if (text && !text.endsWith('\n')) text += '\n';
    let finalText;
    if (!section) {
      finalText = text + entry + '\n';
    } else {
      const heading = `## ${normalizeSection(section)}`;
      const lines = text ? text.split('\n') : [];
      if (lines.length && lines[lines.length - 1] === '') lines.pop();
      const start = lines.indexOf(heading);
      if (start === -1) {
        lines.push(heading, entry);
      } else {
        let end = lines.length;
        for (let i = start + 1; i < lines.length; i++) { if (/^## /.test(lines[i])) { end = i; break; } }
        lines.splice(end, 0, entry);
      }
      finalText = lines.join('\n') + '\n';
    }
    writeFileAtomic(file, finalText);
    return { file, created };
  });
}

module.exports = {
  STATUSES, formatEntry, parseEntry, resolveTarget, appendEntry, hms, normalizeSection,
};
