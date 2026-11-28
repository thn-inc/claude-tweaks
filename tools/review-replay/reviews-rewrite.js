'use strict';
// Pure string layer for the lens-reviewer replay: read the sha range out of an
// archived prompt, classify the run-directory paths it names, and rewrite the
// prompt so no archived sha, worktree path or main-checkout path survives.
// Main-checkout paths may contain spaces, so every match is prefix-based on the
// literal mainRoot, never whitespace tokenizing.
const { toPosix } = require('./schema.js');

const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const PATH_END = '[^\\s"\'`)]';
const PIPELINES = '.claude-tweaks/pipelines/';
// The characters of a path-segment name. Keep it last in every class it joins: a `-` before
// it would turn into a range (`[.A-Z…_+-]` is right, `[A-Z…_+-.]` spans `+` to `.`).
const SEG = 'A-Za-z0-9_+-';
// A worktree name never ends in '.', so a sentence's full stop stays outside the match.
const WORKTREE_NAME = `[.${SEG}]*[${SEG}]`;
// A mention of a root is a whole path unless a path-continuation character follows: a name
// character, or a dot that starts one. Any other character (space, quote, `:` or `,` in a
// path list, sentence punctuation) ends it, so no separator can hide a leak.
const PATH_END_LOOKAHEAD = `(?![${SEG}]|\\.[${SEG}])`;
// The bare root is that whole-path mention with no `/` after it: `{mainRoot}/…` is never
// rewritten, so a main-checkout path that is not a worktree or a run input stays flagged.
const BARE_END = `(?![/${SEG}]|\\.[${SEG}])`;
// An outDir span stops at a separator (`,` `:` `;` `|`, whitespace, a quote, a backtick or `)`)
// instead of swallowing the next path in a list; any other character (`[` `@` `~` `=`, non-ASCII)
// is part of the path.
const OUT_TAIL = `(?:/[^\\s"'\`),:;|]*|${PATH_END_LOOKAHEAD})`;
// Path fragments that name a worktree or a run directory under some checkout root.
const ROOT_MARKERS = ['/.claude/worktrees/', '/.claude-tweaks/pipelines/'];
// What ends an absolute path for the root-independent scan: a separator. A space does not, since a
// checkout root may contain one (`Code Workspaces`).
const HARD_SEP = '\n\r"\'`(),;|=<>:';
const isSpace = (ch) => ch === ' ' || ch === '\t' || ch === '\f' || ch === '\v';
const SHA_TOKEN = '(?<![0-9A-Za-z])[0-9a-f]{7,40}(?![0-9A-Za-z])';
// On win32 a path may be spelled with `\`, `/` or both (`D:\a\repo/.claude/worktrees/w`). Every scan runs on this view
// of the text, each `\` turned into `/`: it has the original's length, so a match's offsets index the original too, and
// rewriteText stitches its output from the original, so a backslash outside a rewritten path survives.
const scanView = (text, platform = process.platform) => (platform === 'win32' ? String(text).replace(/\\/g, '/') : String(text));
// Forward slashes, no trailing slash: `M/` would build `M//` and blind every scan.
const normRoot = (p) => toPosix(p).replace(/\/+$/, '');
// Trailing `.,;:` removed by a backward scan: a `[.,;:]+$` regex is quadratic on a long dot run.
function trimPunct(s) {
  let end = s.length;
  while (end > 0 && '.,;:'.includes(s[end - 1])) end--;
  return s.slice(0, end);
}
// A root that normalises to '' (the filesystem root) would match everywhere.
function requireRoot(mainRoot) {
  const root = normRoot(mainRoot);
  if (!root) throw new Error('mainRoot must not be empty or the filesystem root');
  return root;
}

function rangeOf(text) {
  const t = String(text);
  const range = t.match(/\b([0-9a-f]{7,40})\.\.\.(?:HEAD\b|[0-9a-f]{7,40}\b)/);
  const baseMatch = range || t.match(/\bbase\s+([0-9a-f]{7,40})\b/i);
  const dots = t.match(/\.\.\.([0-9a-f]{7,40})\b/);
  const headMatch = dots || t.match(/\bHEAD(?:\s+at)?\s+([0-9a-f]{7,40})\b/);
  return { base: baseMatch ? baseMatch[1] : null, head: headMatch ? headMatch[1] : null };
}

// Whether git check-ref-format takes refs/remotes/origin/{name}, for a name of originRefsOf's characters with its
// trailing dots stripped: no empty component, none starting with `.` or ending with `.lock`.
const gitTakesRef = (name) => name.split('/').every((seg) => seg !== '' && !seg.startsWith('.') && !seg.endsWith('.lock'));

// The origin/{name} refs a text names, once each. A ref ends at a `..` or `...` range (no git ref name holds `..`), or
// before a space, quote, backtick, paren, comma, colon, semicolon or the end; a sentence's trailing dots are not part of
// it. A name git would refuse is dropped, since writing it would fail the replay repository.
// The name is the greedy run of ref characters, cut at its first `..` past the first character; a run with no `..` is
// a name only when a terminator or the end follows it. A lazy capture with that lookahead rescanned the rest of the run
// from every `origin/` in it (quadratic on `origin/` repeated with a non-terminator at the end).
const REF_END = /[\s`'"),:;]/;
function originRefsOf(text) {
  const t = String(text);
  const out = [];
  const re = /\borigin\/([A-Za-z0-9._\/-]+)/g;
  let m;
  while ((m = re.exec(t)) !== null) {
    const run = m[1];
    const range = run.indexOf('..', 1);
    let raw;
    if (range !== -1) {
      raw = run.slice(0, range);
      re.lastIndex = m.index + 'origin/'.length + range;
    } else {
      // Every origin/ inside the run ends at the same character, so a non-terminator there rules them all out:
      // lastIndex already sits at the run's end.
      const next = t[m.index + m[0].length];
      if (next !== undefined && !REF_END.test(next)) continue;
      raw = run;
    }
    let end = raw.length;
    while (end > 0 && raw[end - 1] === '.') end--; // a backward scan: a `\.+$` regex is quadratic on a long dot run
    const name = raw.slice(0, end);
    if (gitTakesRef(name) && !out.includes(name)) out.push(name);
  }
  return out;
}

function classify(rel) {
  if (rel.split('/').includes('..')) return null;
  if (/^(?:review-ctx|delta-ctx)\/context\.md$/.test(rel)) return 'bundle';
  if (/^work\/[^/]+\.md$/.test(rel)) return 'spec';
  if (/^context\/[^/]+\.md$/.test(rel)) return 'procedure';
  if (/^(?:review-ctx|delta-ctx)\/agent-scratch\/[^/,]+(?:\/[^,]*)?$/.test(rel)) return 'scratch';
  return null;
}

// Optional prefix: mainRoot, or a worktree under it. Group 1 = prefix presence
// is read from the matched text, group 2 = seg, group 3 = rest.
function runInputsOf(text, { mainRoot, runName, copy = false, platform }) {
  const root = escapeRe(normRoot(mainRoot));
  const re = new RegExp(
    `(?:${root}/(?:\\.claude/worktrees/${WORKTREE_NAME}/)?)?\\.claude-tweaks/pipelines/([^/\\s"'\`)]+)/(${PATH_END}*)`,
    'g'
  );
  const inputs = [];
  const unknown = [];
  const seen = new Set();
  for (const m of scanView(text, platform).matchAll(re)) {
    const stripped = trimPunct(m[2]);
    const match = m[0].slice(0, m[0].length - (m[2].length - stripped.length));
    const prefixed = !match.startsWith(PIPELINES);
    if (m[1] !== runName) {
      if (copy && !prefixed) continue;
      if (!unknown.includes(match)) unknown.push(match);
      continue;
    }
    if (seen.has(match)) continue;
    seen.add(match);
    const lead = stripped.match(/^(spec-\d+)\/(.*)$/);
    const member = lead ? lead[1] : null;
    const rel = lead ? lead[2] : stripped;
    const kind = classify(rel);
    if (!kind) {
      if (!unknown.includes(match)) unknown.push(match);
      continue;
    }
    inputs.push({ match, member, rel, kind });
  }
  return { inputs, unknown };
}

// The distinct worktree paths `{mainRoot}/.claude/worktrees/{name}` the text names, in text order.
function worktreePathsOf(text, { mainRoot, platform }) {
  const re = new RegExp(`${escapeRe(requireRoot(mainRoot))}/\\.claude/worktrees/${WORKTREE_NAME}`, 'g');
  return [...new Set([...scanView(text, platform).matchAll(re)].map((m) => m[0]))];
}

function stripEffortLines(text) {
  return String(text).replace(/^\[Effort: (?:low|medium|high|xhigh|max) — [^\]]*\][ \t\r]*$\n?/gm, '');
}

// Maps one sha token, or null when the map is empty.
function shaMapper(map) {
  const keys = Object.keys(map || {});
  if (!keys.length) return null;
  return (tok) => {
    const key = keys.find((k) => k.startsWith(tok));
    return key ? String(map[key]).slice(0, tok.length) : tok;
  };
}

function rewriteShas(text, map) {
  const mapSha = shaMapper(map);
  if (!mapSha) return String(text);
  return String(text).replace(new RegExp(SHA_TOKEN, 'g'), (tok) => mapSha(tok));
}

function rewriteText(text, { mainRoot, runName, repoPath, replacements = {}, shaMap = {}, platform }) {
  const t = String(text);
  const view = scanView(t, platform);
  const root = escapeRe(requireRoot(mainRoot));
  const { inputs, unknown } = runInputsOf(view, { mainRoot, runName });
  // Any run-directory path the scan finds may be replaced, an unknown one included; the literal alternative runs
  // first, so a replaced worktree-prefixed path never loses its prefix to the worktree rewrite.
  // Longest match first so a path never loses its tail to a shorter one.
  const literals = [...new Set([...inputs.map((i) => i.match), ...unknown])]
    .filter((m) => Object.prototype.hasOwnProperty.call(replacements, m))
    .sort((a, b) => b.length - a.length);
  const mapSha = shaMapper(shaMap);
  // One left-to-right pass, so no step re-matches text another substituted: a repoPath or
  // replacement value under mainRoot, or one carrying an archived sha prefix, stays as given.
  // At one position the alternatives try in order: run input, worktree, bare root, sha.
  const never = '((?!))'; // a group that never matches keeps the callback's group numbering
  const re = new RegExp([
    literals.length ? `(${literals.map(escapeRe).join('|')})` : never,
    `${root}/\\.claude/worktrees/${WORKTREE_NAME}`,
    `${root}${BARE_END}`,
    mapSha ? `(${SHA_TOKEN})` : never,
  ].join('|'), 'g');
  let out = '';
  let last = 0;
  for (const m of view.matchAll(re)) {
    const [, lit, sha] = m;
    const sub = lit !== undefined ? String(replacements[lit]) : sha !== undefined ? mapSha(sha) : repoPath;
    out += t.slice(last, m.index) + sub;
    last = m.index + m[0].length;
  }
  return out + t.slice(last);
}

// Longer than any real path (Linux PATH_MAX), so a prefix this long cannot exist on disk.
const MAX_PATH = 4096;

// Every absolute path (starting `/`, `~/` or `X:/`) naming a worktree or a run directory that does
// not start at `root` and does not lie in a `skip` span, so the barrier holds when mainRoot is not the
// archived checkout's (a moved --runs). With `exists`, only a path whose prefix up to and including
// the marker directory (`…/.claude/worktrees`) exists is flagged: a dead path in test-fixture or
// comment text names nothing a reviewer could read. One forward walk: the absolute path a marker
// belongs to is the last one started since a separator.
function foreignRootPaths(t, root, skip, exists) {
  const found = [];
  let absAt = -1; // where the current absolute path starts, -1 for none since the last separator
  let j = 0;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (HARD_SEP.includes(ch)) {
      absAt = -1;
      continue;
    }
    const atStart = i === 0 || isSpace(t[i - 1]) || HARD_SEP.includes(t[i - 1]);
    if (atStart && /[A-Za-z]/.test(ch) && t[i + 1] === ':' && t[i + 2] === '/') {
      absAt = i;
      i += 1; // the drive colon belongs to the path it starts
      continue;
    }
    const driveSlash = absAt === i - 2 && t[i - 1] === ':';
    if (atStart && !driveSlash && (ch === '/' || (ch === '~' && t[i + 1] === '/'))) absAt = i;
    const marker = ch === '/' && absAt >= 0 ? ROOT_MARKERS.find((mk) => t.startsWith(mk, i)) : undefined;
    if (marker === undefined) continue;
    let end = i + 1;
    while (end < t.length && !isSpace(t[end]) && !HARD_SEP.includes(t[end])) end++;
    while (j < skip.length && skip[j][1] <= i) j++;
    const exempt = t.startsWith(root + '/', absAt) || (j < skip.length && skip[j][0] <= i);
    const prefixEnd = i + marker.length - 1;
    const live = () => !exists || (prefixEnd - absAt <= MAX_PATH && exists(t.slice(absAt, prefixEnd)));
    if (!exempt && live()) found.push(trimPunct(t.slice(absAt, end)));
    i = end - 1; // nothing up to `end` is a separator or a path start
  }
  return found;
}

// `exists(prefix)`, optional: whether a foreign checkout prefix exists on disk. Without it every
// foreign worktree or run-directory path is flagged.
function unrewrittenPaths(text, { mainRoot, runName, outDir, exists, platform }) {
  const t = scanView(text, platform);
  const root = requireRoot(mainRoot);
  const out = outDir ? normRoot(outDir) : '';
  // An outDir equal to or containing mainRoot would hide every leak, so it fails closed. A span
  // with a `..` segment can climb out of the output directory, so it exempts nothing.
  const skip = [];
  if (out && out !== root && !root.startsWith(out + '/')) {
    const spans = new RegExp(`${escapeRe(out)}${OUT_TAIL}`, 'g');
    for (const m of t.matchAll(spans)) {
      if (!m[0].slice(out.length).split('/').includes('..')) skip.push([m.index, m.index + m[0].length]);
    }
  }
  const tail = `(?:/${PATH_END}*|${PATH_END_LOOKAHEAD})`;
  const re = new RegExp(`(?:${escapeRe(root)}|${escapeRe(PIPELINES + runName)})${tail}`, 'g');
  const ownRun = new RegExp(`${escapeRe(PIPELINES + runName)}${tail}`, 'g');
  const found = [];
  let j = 0; // spans and mentions both arrive in text order, so one forward walk pairs them
  for (const m of t.matchAll(re)) {
    // Exempt only a mention that lies wholly inside an outDir span (sentence punctuation
    // aside), so `{outDir}:/etc` or a list joining another path is still flagged.
    const end = m.index + trimPunct(m[0]).length;
    while (j < skip.length && skip[j][1] <= m.index) j++;
    if (j < skip.length && skip[j][0] <= m.index && end <= skip[j][1]) {
      // The exemption covers main-checkout leaks only: the archived run's own directory is
      // flagged wherever it sits, inside the output directory included.
      for (const own of m[0].matchAll(ownRun)) found.push(own[0]);
      continue;
    }
    found.push(m[0]);
  }
  return [...found, ...foreignRootPaths(t, root, skip, exists)];
}

// { base, head } from a prompt's `Base {sha} … Head {sha}` lines (the first sha-bearing "base" and the first "head
// {sha}" after it), else a `{sha}..{sha}` / `{sha}...{sha}` range; null when neither names two shas.
function shaPairOf(text) {
  const t = String(text);
  const base = /\bbase[ \t]+([0-9a-f]{7,40})\b/i.exec(t);
  if (base) {
    const headRe = /\bhead[ \t]+([0-9a-f]{7,40})\b/ig;
    headRe.lastIndex = base.index + base[0].length;
    const head = headRe.exec(t);
    if (head) return { base: base[1], head: head[1] };
  }
  const range = /(?<![0-9A-Za-z])([0-9a-f]{7,40})\.\.\.?([0-9a-f]{7,40})(?![0-9A-Za-z])/.exec(t);
  return range ? { base: range[1], head: range[2] } : null;
}

// Whether a trimmed line is one absolute path and nothing else (`/…`, `~/…`, `X:\…` or `X:/…`). A path may hold a
// space (`Code Workspaces`), so a line with spaces still counts when every piece after the first carries a `/`, `\` or
// `.`: `/tmp/x is your prompt` does not, `/Users/x/Code Workspaces/r/p.md` does. Split, not one regex, to stay linear.
function isLonePath(line) {
  if (!/^(?:\/|~\/|[A-Za-z]:[\\/])\S/.test(line)) return false;
  return line.split(/[ \t]+/).slice(1).every((piece) => /[/\\.]/.test(piece));
}

// The path after the first `(it is your prompt …):` marker, on that line or the next, else null: the first match of
// /\(it is your prompt\b[^)\n]*\):[ \t]*(?:\r?\n[ \t]*)?(\S[^\r\n]*)/, by a scan that stays linear. That regex
// rescanned `[^)\n]*` to the same `)` or newline from every marker before it (quadratic in the markers). Every marker
// before one `)` or newline shares that stop and so its answer, so each stop is read once.
function markedPointerPath(t) {
  const marker = /\(it is your prompt\b/g;
  const tail = /[ \t]*(?:\r?\n[ \t]*)?(\S[^\r\n]*)/y;
  let stop = -1;
  for (let m; (m = marker.exec(t)) !== null;) {
    const from = m.index + m[0].length;
    if (from <= stop) continue;
    stop = from;
    while (stop < t.length && t[stop] !== ')' && t[stop] !== '\n') stop += 1;
    if (t[stop] !== ')' || t[stop + 1] !== ':') continue;
    tail.lastIndex = stop + 2;
    const got = tail.exec(t);
    if (got) return got[1].trimEnd();
  }
  return null;
}

// pointerPathOf's answer for a prompt that says its instructions are in or from "this file" and has two or more lone
// absolute path lines: a pointer whose file cannot be told, never "not a pointer" (its text would replay as the prompt).
const POINTER_AMBIGUOUS = Object.freeze({ ambiguous: true });

// The file path a pointer prompt names: after `(it is your prompt …):`, on that line or the next; else, in a prompt
// that says its instructions are in or from "this file", the one line that is a lone absolute path. POINTER_AMBIGUOUS
// when such a prompt has more than one lone path line; null when neither holds, or when it has no lone path line (an
// inline prompt that only mentions "this file").
function pointerPathOf(text) {
  const t = String(text);
  const marked = markedPointerPath(t);
  if (marked !== null) return marked;
  if (!/\b(?:in|from) this file\b|\bRead this file\b/i.test(t)) return null;
  const paths = t.split(/\r?\n/).map((l) => l.trim()).filter(isLonePath);
  if (paths.length > 1) return POINTER_AMBIGUOUS;
  return paths.length === 1 ? paths[0] : null;
}

module.exports = { scanView, rangeOf, originRefsOf, runInputsOf, worktreePathsOf, stripEffortLines, rewriteShas, rewriteText, unrewrittenPaths, shaPairOf, pointerPathOf, POINTER_AMBIGUOUS };
