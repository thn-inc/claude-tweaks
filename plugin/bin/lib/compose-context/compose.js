// bin/lib/compose-context/compose.js — marker grammar, strip, and concatenate
// for the per-run skill-context composer (#1988). Pure: no fs, no shell, no
// CLI state — bin/lib/skill-audit/context-cost.js (#1990) and later phases
// import stripMarkers/compose directly.
//
// Grammar (line-anchored, one marker per line):
//   <!-- when: {key}={value} -->   opens a block
//   <!-- /when -->                 closes the innermost open block
// Exactly one key=value per marker; nesting depth at most 1 (an outer block
// may hold inner blocks, never deeper); a pair opens and closes in the same
// source. Every marker in a source is validated before any branch is decided,
// so a malformed marker inside a branch this run would strip is still an error.
// Lines inside a fenced code block are literal text, never markers — the way
// a composed file documents the grammar.
'use strict';

const KEYS = ['integration-model', 'mode', 'attendance', 'transport', 'worktree-policy', 'work-backend'];
const VOCAB = {
  'integration-model': ['pr-first', 'local-merge'],
  mode: ['auto', 'confirm', 'interactive', 'hybrid'],
  attendance: ['headless', 'attended'],
  transport: ['gh', 'mcp'],
  'worktree-policy': ['always', 'optional'],
  'work-backend': ['github-issues', 'local-files'],
};
const UNRESOLVED = 'unresolved';
const MAX_DEPTH = 2; // outer + one nested level

// A line that starts like a marker is either a valid open/close or a malformed
// marker — never content. Anchored so ordinary prose mentioning "when:" is
// untouched; only an HTML comment opening with when/ /when counts.
const CANDIDATE_RE = /^\s*<!--\s*(?:when:|\/when\b)/;
const OPEN_RE = /^\s*<!--\s*when:\s*([A-Za-z0-9-]+)=([A-Za-z0-9-]+)\s*-->\s*$/;
const CLOSE_RE = /^\s*<!--\s*\/when\s*-->\s*$/;
// A line opening a fenced code block (```/~~~, up to 3 leading spaces per
// CommonMark). Once open, the fence is closed only by a fence of the same
// character and at least the same length — every other line while inside it,
// including a fence-shaped line of the other character or a shorter run of
// the same character, is literal text: never a candidate, never validated,
// never stripped.
const FENCE_RE = /^ {0,3}(`{3,}|~{3,})/;

class MarkerError extends Error {
  constructor(message, { file = null, line }) {
    super(message);
    this.name = 'MarkerError';
    this.file = file;
    this.line = line;
  }
}

// text -> tokens; throws MarkerError on the first malformed marker (by line).
function parseMarkers(text, file = null) {
  const lines = String(text).split('\n');
  const tokens = [];
  const stack = [];
  let inFence = false;
  let fenceChar = null;
  let fenceLen = 0;
  const fail = (message, line) => { throw new MarkerError(message, { file, line }); };
  // `fenced` lets a consumer (the marker-conformance test) skip code-fence lines with the parser's own fence state instead of a second tracker.
  lines.forEach((raw, i) => {
    const line = i + 1;
    const fenceMatch = raw.match(FENCE_RE);
    if (inFence) {
      if (fenceMatch && fenceMatch[1][0] === fenceChar && fenceMatch[1].length >= fenceLen) {
        inFence = false;
        fenceChar = null;
        fenceLen = 0;
      }
      tokens.push({ type: 'text', line, fenced: true });
      return;
    }
    if (fenceMatch) {
      inFence = true;
      fenceChar = fenceMatch[1][0];
      fenceLen = fenceMatch[1].length;
      tokens.push({ type: 'text', line, fenced: true });
      return;
    }
    if (!CANDIDATE_RE.test(raw)) {
      tokens.push({ type: 'text', line });
      return;
    }
    const open = raw.match(OPEN_RE);
    if (open) {
      const [, key, value] = open;
      if (!Object.prototype.hasOwnProperty.call(VOCAB, key)) fail(`unknown key "${key}" (expected one of ${KEYS.join(', ')})`, line);
      if (!VOCAB[key].includes(value)) fail(`unknown value "${value}" for ${key} (expected one of ${VOCAB[key].join(', ')})`, line);
      if (stack.length >= MAX_DEPTH) fail('nesting depth > 1 (a block may hold inner blocks, never deeper)', line);
      stack.push(line);
      tokens.push({ type: 'open', key, value, line });
      return;
    }
    if (CLOSE_RE.test(raw)) {
      if (stack.length === 0) fail('close without open (<!-- /when --> with no open block)', line);
      stack.pop();
      tokens.push({ type: 'close', line });
      return;
    }
    fail('malformed marker (expected exactly `<!-- when: key=value -->` or `<!-- /when -->`)', line);
  });
  if (stack.length) fail(`unclosed marker (opened at line ${stack[stack.length - 1]})`, stack[stack.length - 1]);
  return tokens;
}

function stripMarkers(text) {
  const lines = String(text).split('\n');
  const tokens = parseMarkers(text);
  return lines.filter((_, i) => tokens[i].type === 'text').join('\n');
}

function assertConditions(conditions) {
  if (!conditions || typeof conditions !== 'object') throw new TypeError('conditions must be an object keyed by the six condition keys');
  for (const key of KEYS) {
    const value = conditions[key];
    if (value !== UNRESOLVED && !VOCAB[key].includes(value)) {
      throw new TypeError(`conditions.${key} must be one of ${VOCAB[key].join(', ')} or "${UNRESOLVED}" (got ${JSON.stringify(value)})`);
    }
  }
}

function unresolvedKeys(conditions) {
  return KEYS.filter((key) => conditions[key] === UNRESOLVED);
}

function renderResolvedHeader(conditions) {
  return `<!-- resolved: ${KEYS.map((key) => `${key}=${conditions[key]}`).join(' ')} -->`;
}

// [{path, content}], conditions -> the composed bundle: resolved header line,
// then each source's kept lines in argv order, every body newline-terminated.
function compose(sources, conditions) {
  assertConditions(conditions);
  if (!Array.isArray(sources)) throw new TypeError('sources must be an array of {path, content}');
  // Validate everything first — a malformed marker anywhere is an error before
  // any branch of any source is decided.
  const parsed = sources.map((source) => ({ source, tokens: parseMarkers(source.content, source.path) }));
  const bodies = parsed.map(({ source, tokens }) => {
    const lines = String(source.content).split('\n');
    const keepStack = [];
    const kept = [];
    tokens.forEach((token, i) => {
      if (token.type === 'open') {
        const cond = conditions[token.key];
        keepStack.push(cond === UNRESOLVED || cond === token.value);
      } else if (token.type === 'close') {
        keepStack.pop();
      } else if (keepStack.every(Boolean)) {
        kept.push(lines[i]);
      }
    });
    let body = kept.join('\n');
    // A source whose every line was stripped contributes nothing — not a blank line.
    if (body !== '' && !body.endsWith('\n')) body += '\n';
    return body;
  });
  return `${renderResolvedHeader(conditions)}\n${bodies.join('')}`;
}

module.exports = {
  KEYS, VOCAB, UNRESOLVED, CANDIDATE_RE, MarkerError, parseMarkers, stripMarkers, compose, unresolvedKeys, renderResolvedHeader,
};
