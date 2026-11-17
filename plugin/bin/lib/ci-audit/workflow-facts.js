// plugin/bin/lib/ci-audit/workflow-facts.js — the workflow-file facts /claude-tweaks:ci-health
// (#5757) reads beside run data: each job's id, name, `needs`, whether it declares a job-level
// `timeout-minutes`, whether its `strategy` holds a `matrix`, and its steps' kinds, plus whether
// the workflow declares a top-level `concurrency`. Pure: it takes the workflow file's TEXT, never
// reads a file, never spawns, never throws. This module holds the workflow-file schema reading by
// the spec's Key Files design (the one place that knows the file's keys: jobs, needs, strategy,
// steps, concurrency). It is hand-scanned, with no YAML library, because the plugin payload has
// zero runtime dependencies (see merge-verification.js's header).
//
// It never guesses. Anything its scanner cannot follow is one reason in `unparsed` and `jobs` is
// then [] — never a partial list. The jobs: and concurrency: region guards (tab indentation, a
// YAML anchor or alias) and `concurrencyDeclared` come from merge-verification.js's
// readWorkflowShape; reasons it gives about other regions (on:, name:) are not this reader's and
// are dropped. Jobs, needs, timeout, matrix and steps come from this module's own line scanner.
//
// Rules:
//  - a job's `name` is its `name:` value, else its id;
//  - `needs` is a scalar id, a one-line flow list `[a, b]`, or a block list (indentless included);
//  - `timeoutDeclared` and `matrix` count only at job level (`strategy:` → `matrix:`): a step's
//    `timeout-minutes` or a `matrix` key under a step's `with:` sets neither;
//  - a step with a `run` key is a `command`, with a `uses` key an `action`; with both it is
//    unparsed; with neither it is skipped;
//  - every command and action step is listed, in file order, as { name, kind, named, value }:
//    `named` is whether it has a `name:`; `name` is that value, else — a derived name — its `run`
//    or `uses` value when that value is one plain or quoted line, else null (a block scalar, a
//    continued plain value, or a double-quoted value with a backslash escape, which this reader
//    does not decode: any name for it would be a guess). `value` is the `run`/`uses` value's
//    first line: the one-line value itself, a literal block's (`|`) first content line, or null
//    (a folded `>` block, a continued plain value, an escaped quoted value). An unknown name is
//    never a reason in `unparsed`: the step and its kind are still known;
//  - `concurrencyDeclared` is trustworthy only when `unparsed` holds no concurrency reason.
//
// Linear: one forward pass over the lines with a persistent index, hand scans per line, and no
// regex that can restart inside a long run.
'use strict';

const { readWorkflowShape } = require('../merge-verification');

// readWorkflowShape reasons about the two regions this reader reports on.
const SHAPE_REASONS = new Set([
  'no jobs: key',
  'tab indentation in jobs:',
  'anchor or alias in jobs:',
  'tab indentation in concurrency:',
  'anchor or alias in concurrency:',
  'concurrency not read',
  'cancel-in-progress value not read',
]);
const JOBS_REGION_REASONS = new Set(['tab indentation in jobs:', 'anchor or alias in jobs:']);

const ID = /^[A-Za-z_][A-Za-z0-9_-]*$/;
const DASH = /^ *-(?:[ \t]|$)/;

const empty = (unparsed) => ({ jobs: [], concurrencyDeclared: false, unparsed });

function leadSpaces(line) {
  let n = 0;
  while (n < line.length && line[n] === ' ') n++;
  return n;
}

const isSkippable = (line) => {
  const t = line.trim();
  return t === '' || t[0] === '#';
};

// Whether the line's leading whitespace holds a tab.
function tabIndent(line) {
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '\t') return true;
    if (line[i] !== ' ') return false;
  }
  return false;
}

// `{key, rest}` for a block-mapping entry's content, or null when it is no `key:` entry. A plain
// key ends at the first `:` followed by whitespace or the line's end.
function splitKey(content) {
  const q = content[0];
  let key;
  let keyEnd;
  if (q === "'" || q === '"') {
    let k = 1;
    while (k < content.length && content[k] !== q) k++;
    if (k >= content.length) return null;
    key = content.slice(1, k);
    keyEnd = k + 1;
    while (keyEnd < content.length && (content[keyEnd] === ' ' || content[keyEnd] === '\t')) keyEnd++;
    if (content[keyEnd] !== ':') return null;
  } else {
    if (q === undefined || '-?[]{},&*!|>%@`#'.includes(q)) return null;
    keyEnd = -1;
    for (let k = 0; k < content.length; k++) {
      const next = content[k + 1];
      if (content[k] === ':' && (next === undefined || next === ' ' || next === '\t' || next === '\r')) { keyEnd = k; break; }
    }
    if (keyEnd < 0) return null;
    key = content.slice(0, keyEnd).trimEnd();
  }
  return { key, rest: content.slice(keyEnd + 1) };
}

// Index of a plain value's comment start (`#` at the start or after whitespace), or -1.
function commentStart(v) {
  for (let i = 0; i < v.length; i++) {
    if (v[i] === '#' && (i === 0 || v[i - 1] === ' ' || v[i - 1] === '\t')) return i;
  }
  return -1;
}

// An inline scalar value: {text}, {empty: true} for no value (or null / ~), or null when it is
// not one plain or quoted scalar (a block scalar, a flow node, a tag, an escape).
function readScalar(raw) {
  const v = raw.trim();
  const q = v[0];
  if (q === "'" || q === '"') {
    let out = '';
    let k = 1;
    for (; k < v.length; k++) {
      const ch = v[k];
      if (q === '"' && ch === '\\') return null;
      if (ch === q) {
        if (q === "'" && v[k + 1] === "'") { out += "'"; k++; continue; }
        break;
      }
      out += ch;
    }
    if (k >= v.length) return null;
    const tail = v.slice(k + 1).trim();
    if (tail !== '' && tail[0] !== '#') return null;
    return { text: out };
  }
  const text = plainValue(v);
  if (text === '' || text === '~' || text === 'null') return { empty: true };
  if ('|>[]{}!&*@`%'.includes(text[0])) return null;
  return { text };
}

// A plain value with its comment removed, trimmed.
function plainValue(raw) {
  const v = raw.trim();
  const cut = commentStart(v);
  return (cut < 0 ? v : v.slice(0, cut)).trimEnd();
}

// A job id read from a scalar, or null.
function readId(raw) {
  const s = readScalar(raw);
  return s && !s.empty && ID.test(s.text) ? s.text : null;
}

// Thrown inside the scanner to stop at the first cause; caught in readWorkflowFacts.
class NotRead {
  constructor(reason) { this.reason = reason; }
}
const fail = (reason) => { throw new NotRead(reason); };

// Whether the next structural line after i (before end) sits deeper than col.
function deeperFollows(lines, i, end, col) {
  for (; i < end; i++) {
    if (isSkippable(lines[i])) continue;
    return leadSpaces(lines[i]) > col;
  }
  return false;
}

// `needs` read from its key line's rest (key at keyIndent, line index i is the line after it).
function readNeeds(lines, i, end, keyIndent, rest, jobId) {
  const reason = `job ${jobId} needs not read`;
  const v = plainValue(rest);
  if (v.startsWith('[')) {
    if (!v.endsWith(']')) fail(reason);
    const inner = v.slice(1, -1);
    if (inner.trim() === '') return { needs: [], next: i };
    const needs = inner.split(',').map((it) => readId(it) || fail(reason));
    return { needs, next: i };
  }
  if (v !== '') {
    const id = readId(rest);
    if (id === null || deeperFollows(lines, i, end, keyIndent)) fail(reason);
    return { needs: [id], next: i };
  }
  const needs = [];
  let itemIndent = null;
  for (; i < end; i++) {
    const l = lines[i];
    if (isSkippable(l)) continue;
    if (tabIndent(l)) fail('tab indentation in jobs:');
    const ind = leadSpaces(l);
    const dash = DASH.test(l);
    if (itemIndent === null) {
      if (ind < keyIndent || (ind === keyIndent && !dash)) break;
      if (!dash) fail(reason);
      itemIndent = ind;
    }
    if (ind === itemIndent && dash) {
      needs.push(readId(l.slice(ind + 1)) || fail(reason));
      continue;
    }
    if (ind <= keyIndent) break;
    fail(reason);
  }
  if (needs.length === 0) fail(reason);
  return { needs, next: i };
}

// Whether a block `strategy:` (key at keyIndent) holds a `matrix` key at its own column.
function readStrategy(lines, i, end, keyIndent, rest, jobId) {
  const reason = `job ${jobId} strategy not read`;
  if (plainValue(rest) !== '') fail(reason);
  let childIndent = null;
  let matrix = false;
  for (; i < end; i++) {
    const l = lines[i];
    if (isSkippable(l)) continue;
    const ind = leadSpaces(l);
    if (ind <= keyIndent) break;
    if (childIndent === null) childIndent = ind;
    if (ind > childIndent) continue;
    if (tabIndent(l)) fail('tab indentation in jobs:');
    if (ind < childIndent) fail(reason);
    const kv = splitKey(l.slice(ind));
    if (kv === null) fail(reason);
    if (kv.key === 'matrix') matrix = true;
  }
  if (childIndent === null) fail(reason);
  return { matrix, next: i };
}

// The step list under `steps:` (key at keyIndent; items deeper, or an indentless sequence at it).
function readSteps(lines, i, end, keyIndent, jobId) {
  const reason = `job ${jobId} steps not read`;
  const steps = [];
  let stepIndent = null;
  let keyCol = null;
  let cur = null; // {name, run, uses, pending} for the step being read; run/uses: {oneLine, text, first}
  let last = null; // {key, emptyValue, deeper} for the last key read in this step
  const finish = () => {
    if (cur === null) return;
    if (cur.run && cur.uses) fail(reason);
    const val = cur.run || cur.uses;
    if (val) {
      const named = cur.name !== null;
      steps.push({
        name: named ? cur.name : (val.oneLine ? val.text : null),
        kind: cur.run ? 'command' : 'action',
        named,
        value: val.oneLine ? val.text : val.first,
      });
    }
    cur = null;
  };
  const readKey = (content) => {
    const kv = splitKey(content);
    if (kv === null) fail(reason);
    const value = plainValue(kv.rest);
    last = { key: kv.key, emptyValue: value === '', deeper: false, seq: false };
    cur.pending = null;
    if (kv.key === 'name') {
      const s = readScalar(kv.rest);
      if (s === null || s.empty) fail(reason);
      cur.name = s.text;
    } else if (kv.key === 'run' || kv.key === 'uses') {
      const s = value === '' ? null : readScalar(kv.rest);
      cur[kv.key] = s && !s.empty ? { oneLine: true, text: s.text, first: null } : { oneLine: false, text: null, first: null };
      // A literal block (`|`, `|-`, `|2`, …): its first content line is the value's first line.
      cur.pending = value[0] === '|' ? cur[kv.key] : null;
    }
  };
  for (; i < end; i++) {
    const line = lines[i];
    // A literal block's first content line, read before the comment skip: `# x` there is content.
    if (cur !== null && cur.pending && line.trim() !== '' && keyCol !== null && leadSpaces(line) > keyCol) {
      cur.pending.first = line.trim();
      cur.pending = null;
    }
    if (isSkippable(line)) continue;
    const ind = leadSpaces(line);
    const dash = DASH.test(line);
    if (stepIndent === null) {
      if (ind < keyIndent || (ind === keyIndent && !dash)) break;
      if (tabIndent(line)) fail('tab indentation in jobs:');
      if (!dash) fail(reason);
      stepIndent = ind;
    }
    if (ind < stepIndent || (ind === stepIndent && !dash)) {
      if (ind <= keyIndent) break;
      fail(reason);
    }
    if (ind === stepIndent) {
      if (tabIndent(line)) fail('tab indentation in jobs:');
      finish();
      cur = { name: null, run: null, uses: null, pending: null };
      last = null;
      const after = line.slice(ind + 1);
      let sp = 0;
      while (sp < after.length && (after[sp] === ' ' || after[sp] === '\t')) sp++;
      const content = after.slice(sp).trimEnd();
      if (content === '' || content[0] === '#') {
        keyCol = null; // the step's keys start on the next line
      } else {
        keyCol = ind + 1 + sp;
        readKey(content);
      }
      continue;
    }
    if (keyCol === null) keyCol = ind;
    if (ind < keyCol) fail(reason);
    if (ind > keyCol) { // a deeper line: the last key's value continues
      if (last === null) fail(reason);
      if (last.key === 'name') fail(reason);
      if ((last.key === 'run' || last.key === 'uses') && cur[last.key]) cur[last.key].oneLine = false;
      last.deeper = true;
      continue;
    }
    if (tabIndent(line)) fail('tab indentation in jobs:');
    if (dash) { // an indentless sequence value of the empty-valued key above
      if (last === null || !last.emptyValue || (last.deeper && !last.seq)) fail(reason);
      last.seq = true;
      continue;
    }
    readKey(line.slice(ind));
  }
  finish();
  return { steps, next: i };
}

// The jobs under `jobs:` (region lines (start, end)), in one forward pass.
function readJobs(lines, start, end) {
  const inline = plainValue(lines[start].slice(lines[start].indexOf(':') + 1));
  if (inline.startsWith('{')) fail('jobs: flow-style map not read');
  if (inline !== '') fail('jobs: not read');
  const jobs = [];
  let jobIndent = null;
  let i = start + 1;
  while (i < end) {
    const line = lines[i];
    if (isSkippable(line)) { i++; continue; }
    if (tabIndent(line)) fail('tab indentation in jobs:');
    const ind = leadSpaces(line);
    if (jobIndent === null) {
      if (ind === 0) fail('jobs: not read');
      jobIndent = ind;
    }
    if (ind !== jobIndent) fail('jobs: not read');
    const kv = splitKey(line.slice(ind));
    const id = kv && ID.test(kv.key) ? kv.key : null;
    if (!kv || id === null) fail('jobs: not read');
    const own = plainValue(kv.rest);
    if (own.startsWith('{')) fail(`job ${id} flow-style map not read`);
    if (own !== '') fail(`job ${id} not read`);
    const job = { id, name: id, needs: [], timeoutDeclared: false, matrix: false, steps: [] };
    jobs.push(job);
    i++;
    let keyIndent = null;
    let open = null; // 'key' for an empty-valued key with nothing under it yet, 'seq' once a `- ` value follows
    while (i < end) {
      const l = lines[i];
      if (isSkippable(l)) { i++; continue; }
      const indent = leadSpaces(l);
      if (indent <= jobIndent) break;
      if (keyIndent === null) keyIndent = indent;
      if (indent > keyIndent) { // a deeper line of a key not read here
        if (open === 'key') open = null;
        i++;
        continue;
      }
      if (tabIndent(l)) fail('tab indentation in jobs:');
      if (indent < keyIndent) fail('jobs: not read');
      if (DASH.test(l)) {
        if (open === null) fail('jobs: not read');
        open = 'seq';
        i++;
        continue;
      }
      const jkv = splitKey(l.slice(indent));
      if (jkv === null) fail('jobs: not read');
      const value = plainValue(jkv.rest);
      open = value === '' ? 'key' : null;
      i++;
      if (jkv.key === 'name') {
        const s = readScalar(jkv.rest);
        if (s === null || deeperFollows(lines, i, end, keyIndent)) fail(`job ${id} name not read`);
        if (!s.empty) job.name = s.text;
        open = null;
      } else if (jkv.key === 'needs') {
        const r = readNeeds(lines, i, end, keyIndent, jkv.rest, id);
        job.needs = r.needs;
        i = r.next;
        open = null;
      } else if (jkv.key === 'timeout-minutes') {
        if (value === '') fail(`job ${id} timeout-minutes not read`);
        job.timeoutDeclared = true;
      } else if (jkv.key === 'strategy') {
        const r = readStrategy(lines, i, end, keyIndent, jkv.rest, id);
        job.matrix = r.matrix;
        i = r.next;
        open = null;
      } else if (jkv.key === 'steps') {
        if (value === '') {
          const r = readSteps(lines, i, end, keyIndent, id);
          job.steps = r.steps;
          i = r.next;
          open = null;
        } else if (value !== '[]') {
          fail(`job ${id} steps not read`);
        }
      }
    }
  }
  if (jobs.length === 0) fail('jobs: not read');
  return jobs;
}

// The jobs: region (its key line to the line before the next top-level line), or null.
function jobsRegion(lines) {
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    const c = lines[i][0];
    if (c === undefined || c === ' ' || c === '\t' || c === '#' || lines[i].trim() === '') continue;
    if (start >= 0) return { start, end: i };
    const kv = splitKey(lines[i]);
    if (kv && kv.key === 'jobs') start = i;
  }
  return start >= 0 ? { start, end: lines.length } : null;
}

function readWorkflowFacts(text) {
  if (typeof text !== 'string') return empty(['workflow file not read']);
  try {
    const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
    const shape = readWorkflowShape(body);
    const shapeReasons = shape.unparsed.filter((r) => SHAPE_REASONS.has(r));
    const out = { jobs: [], concurrencyDeclared: shape.concurrency !== 'absent', unparsed: shapeReasons };
    const lines = body.split(/\r?\n/);
    const region = jobsRegion(lines);
    if (region === null) {
      if (!out.unparsed.includes('no jobs: key')) out.unparsed.push('no jobs: key');
      return out;
    }
    if (shapeReasons.some((r) => JOBS_REGION_REASONS.has(r))) return out;
    try {
      out.jobs = readJobs(lines, region.start, region.end);
    } catch (e) {
      if (!(e instanceof NotRead)) throw e;
      if (!out.unparsed.includes(e.reason)) out.unparsed.push(e.reason);
    }
    return out;
  } catch {
    return empty(['workflow file not read']);
  }
}

module.exports = { readWorkflowFacts };
