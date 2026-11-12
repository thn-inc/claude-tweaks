'use strict';
// plugin/bin/lib/dispatch/task-prompt.js — #4589: pure renderer for /claude-tweaks:dispatch's two
// Task() prompts. The dispatching session used to hand-substitute the fenced templates in
// skills/dispatch/task-prompt.md (a prose file); this module reads that same text and fills it from
// a CLOSED placeholder set, so a prompt is derived, never retyped, and an edit to a sentence in a
// fenced block reaches the output with no code change. Every other `{...}` token in the templates
// (`{n}`, `{gate}`, `{run-dir}`, `{child-worktree}`, ...) is agent-facing and left verbatim.
//
// Output shape: a marker line (`[dispatch-prompt: {run-id} {call}]`), the filled template with the
// Context pack inlined at `{context-pack}`, an optional resume line, an optional effort line, no
// trailing whitespace. MARKER_RE matches the marker only as the prompt's first line, where the CLI
// writes it: a rendered prompt quoted inside another prompt carries no marker. MARKER_RE,
// promptDigest and REGISTRY_FILE are shared with bin/lib/hooks/dispatch-prompt-gate.js, which
// matches a dispatched prompt against the registry the CLI writes (digest = sha256 of the exact
// UTF-8 bytes, no normalization).
//
// Values are checked before any substitution: the issues are positive integers, runDir is a
// non-empty string, and no value carries a DISPATCHER_PLACEHOLDERS token — a later fill would
// rewrite it inside the value (a runDir holding `{ISO}`), or the closed-set check would blame the
// template for it.
//
// Chunking: a rendered prompt is read back in pieces. CHUNK_BYTES sits a third under the Bash output
// cap observed at authoring; a chunk is a run of whole lines that neither starts nor ends with
// whitespace (the split newline belongs to no chunk), so a chunk round-trips through a tool result
// that trims, and `chunks.join('\n')` is the exact prompt.
const crypto = require('node:crypto');
const path = require('node:path');

const DISPATCHER_PLACEHOLDERS = Object.freeze([
  '{issue list}', '{comma-joined issue numbers}', '{minted-run-dir}', '{run-id}',
  '{plugin-root}', '{context-pack}', '{policy-values}', '{ISO}',
]);

const REGISTRY_FILE = 'dispatch-prompts.jsonl';
const MARKER_RE = /^\[dispatch-prompt: (\S+) (first|second)\](?:\n|$)/;
const MAX_PROMPT_BYTES = 131072;
const CHUNK_BYTES = 20000;

const FIRST_STEPS = 'build,test';
const SECOND_STEPS = 'review,polish,wrap-up';
const INVOKE = 'PIPELINE_RUN_DIR="{minted-run-dir}" /claude-tweaks:flow';

const norm = (s) => String(s).replace(/\r\n/g, '\n');
const count = (s, tok) => s.split(tok).length - 1;
const fill = (s, tok, value) => s.split(tok).join(value);

function fencedAfter(text, headingRe, label) {
  const lines = norm(text).split('\n');
  const h = lines.findIndex((l) => headingRe.test(l));
  if (h === -1) throw new Error(`task-prompt.md: missing "${label}" heading`);
  const open = lines.findIndex((l, i) => i > h && l.startsWith('```'));
  if (open === -1) throw new Error(`task-prompt.md: no opening fence after "${label}"`);
  const close = lines.findIndex((l, i) => i > open && l.startsWith('```'));
  if (close === -1) throw new Error(`task-prompt.md: no closing fence after "${label}"`);
  return lines.slice(open + 1, close).join('\n');
}

function extractTemplates(text) {
  return {
    first: fencedAfter(text, /^## First call\b/, '## First call'),
    second: fencedAfter(text, /^## Second call\b/, '## Second call'),
  };
}

function extractContextPack(text) {
  const lines = norm(text).split('\n');
  const h = lines.findIndex((l) => /^## Context pack\b/.test(l));
  if (h === -1) throw new Error('task-prompt.md: missing "## Context pack" heading');
  const start = lines.findIndex((l, i) => i > h && /^1\. /.test(l));
  if (start === -1) throw new Error('task-prompt.md: Context pack has no item 1');
  const end = lines.findIndex((l, i) => i > start && l.startsWith('Substitute this whole block'));
  if (end === -1) throw new Error('task-prompt.md: Context pack lacks the "Substitute this whole block" anchor');
  return lines.slice(start, end).join('\n').replace(/\s+$/, '');
}

function profileOf(template) {
  const hits = [...String(template).matchAll(/\[Use: (\w+)\]/g)];
  if (hits.length !== 1) throw new Error(`task-prompt.md: expected exactly one [Use: X] line, found ${hits.length}`);
  return hits[0][1].toLowerCase();
}

function findUnsubstituted(prompt) {
  return DISPATCHER_PLACEHOLDERS.filter((p) => String(prompt).includes(p));
}

function renderResumeContext(verdict) {
  const v = verdict || {};
  const nonEmpty = (x) => typeof x === 'string' && x.length > 0;
  if (!nonEmpty(v.prUrl) || !nonEmpty(v.priorRunId)) {
    throw new Error('resume context needs a non-empty prUrl and priorRunId');
  }
  const ctx = v.context || {};
  const lp = ctx.lastPhase;
  const phase = lp && lp.section ? `${lp.section} ${lp.step}`.trim() : 'none recorded';
  const defects = Array.isArray(ctx.openDefects) && ctx.openDefects.length
    ? ctx.openDefects.join('; ') : 'none recorded';
  return `Resuming stalled run ${v.priorRunId} on PR ${v.prUrl}; last logged phase: ${phase}; open defects: ${defects}`;
}

function markerLine(runId, call) {
  return `[dispatch-prompt: ${runId} ${call}]`;
}

function promptDigest(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

function promptSize(prompt) {
  const bytes = Buffer.byteLength(prompt, 'utf8');
  return { bytes, ok: bytes <= MAX_PROMPT_BYTES };
}

function fitsChunk(chunk) {
  return Buffer.byteLength(chunk, 'utf8') <= CHUNK_BYTES;
}

const isWs = (ch) => /\s/.test(ch);
function splitOk(prev, next) {
  return prev.length > 0 && next.length > 0 && !isWs(prev[prev.length - 1]) && !isWs(next[0]);
}

function chunkPrompt(prompt) {
  if (fitsChunk(prompt)) return [prompt];
  const lines = prompt.split('\n');
  const chunks = [];
  let start = 0;
  while (start < lines.length) {
    let cur = '';
    let best = -1;
    let reachedEnd = false;
    for (let e = start; e < lines.length; e++) {
      const candidate = e === start ? lines[e] : `${cur}\n${lines[e]}`;
      if (!fitsChunk(candidate)) break;
      cur = candidate;
      if (e === lines.length - 1) { reachedEnd = true; best = e; break; }
      if (splitOk(lines[e], lines[e + 1])) best = e;
    }
    if (best === -1) {
      throw new Error(`no chunk split within ${CHUNK_BYTES} bytes at line ${start + 1} `
        + '(an over-long line, or blank lines spanning the limit)');
    }
    chunks.push(lines.slice(start, best + 1).join('\n'));
    start = best + 1;
    if (reachedEnd) break;
  }
  return chunks;
}

function renderTaskPrompt(text, opts) {
  const o = opts || {};
  const call = o.call;
  if (call !== 'first' && call !== 'second') throw new Error(`call must be 'first' or 'second', got ${call}`);
  const issues = Array.isArray(o.issues) ? o.issues : [];
  if (!issues.length) throw new Error('issues must be a non-empty list');
  if (!issues.every((n) => Number.isInteger(n) && n > 0)) {
    throw new Error(`issues must be positive integers, got ${JSON.stringify(issues)}`);
  }
  if (typeof o.runDir !== 'string' || !o.runDir) throw new Error('runDir must be a non-empty string');
  const named = [['runDir', o.runDir], ['pluginRoot', o.pluginRoot], ['policyValues', o.policyValues],
    ['selectedAt', o.selectedAt], ['stepToken', o.stepToken], ['resume.prUrl', o.resume && o.resume.prUrl]];
  for (const [name, value] of named) {
    const hit = typeof value === 'string' ? DISPATCHER_PLACEHOLDERS.find((p) => value.includes(p)) : undefined;
    if (hit) throw new Error(`${name} contains the placeholder token ${hit}`);
  }

  // (1) template
  let t = extractTemplates(text)[call];

  // (2) continuation step token
  if (o.stepToken) {
    const base = `${call === 'first' ? FIRST_STEPS : SECOND_STEPS} auto`;
    if (count(t, base) !== 2) throw new Error(`template lost its "${base}" step-list lines (expected 2)`);
    t = fill(t, base, `${o.stepToken} auto`);
  }

  // (3) first-call-only flags
  if ((o.headless || o.resume) && call !== 'first') {
    throw new Error('--headless/--resume apply to the first call only');
  }
  if (o.headless && o.resume) throw new Error('resume is human-typed: no DISPATCH_HEADLESS');
  if (o.headless || o.resume) {
    if (count(t, INVOKE) !== 2) throw new Error('first template lost its two invocation lines');
    const flag = o.headless ? 'DISPATCH_HEADLESS=1' : `RESUME_PR="${o.resume.prUrl}"`;
    if (o.resume) renderResumeContext(o.resume);
    t = fill(t, INVOKE, fill(INVOKE, ' /claude-tweaks:flow', ` ${flag} /claude-tweaks:flow`));
  }

  // (4) issue forms
  if (issues.length === 1) {
    if (!count(t, '#{issue}')) throw new Error('template lost its #{issue} placeholder');
    t = fill(t, '#{issue}', `#${issues[0]}`);
  } else {
    const bundle = '"#{n1},#{n2},..."';
    if (!count(t, bundle)) throw new Error('template lost its bundle placeholder');
    t = fill(t, bundle, `"${issues.map((n) => `#${n}`).join(',')}"`);
  }

  // (5) context pack
  if (!count(t, '{context-pack}')) throw new Error('template lost its {context-pack} placeholder');
  t = fill(t, '{context-pack}', extractContextPack(text));

  // (6) values
  for (const need of ['{policy-values}', '{ISO}']) {
    if (!count(t, need)) throw new Error(`template lost its ${need} placeholder`);
  }
  const values = [
    ['{issue list}', issues.map((n) => `#${n}`).join(', ')],
    ['{comma-joined issue numbers}', issues.join(',')],
    ['{minted-run-dir}', o.runDir],
    ['{run-id}', path.basename(o.runDir)],
    ['{plugin-root}', o.pluginRoot],
    ['{policy-values}', o.policyValues],
    ['{ISO}', o.selectedAt],
  ];
  for (const [tok, value] of values) {
    if (value === undefined || value === null) continue;
    t = fill(t, tok, String(value));
  }

  // (7) closed-set check
  const left = findUnsubstituted(t);
  if (left.length) throw new Error(`unsubstituted placeholder(s): ${left.join(', ')}`);

  // (8) marker, resume line, effort line
  let out = `${markerLine(path.basename(o.runDir), call)}\n\n${t}`;
  if (o.resume) out += `\n\n${renderResumeContext(o.resume)}`;
  if (o.effortLine) out += `\n\n${o.effortLine}`;

  // (9) no trailing whitespace
  return out.replace(/\s+$/, '');
}

module.exports = {
  DISPATCHER_PLACEHOLDERS, extractTemplates, extractContextPack, profileOf, findUnsubstituted,
  renderResumeContext, MARKER_RE, markerLine, promptDigest, REGISTRY_FILE, MAX_PROMPT_BYTES,
  promptSize, CHUNK_BYTES, fitsChunk, chunkPrompt, renderTaskPrompt,
};
