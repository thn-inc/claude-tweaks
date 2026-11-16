'use strict';
// tools/review-replay/score.js — settles every replay judge's reply through tiebreak.js's resolveTiebreak and scores the
// agreement with the archived verdicts, per arm, plus the cost per arm. A reply that cannot be settled to a verdict is
// notJudged, never a silent disagreement or agreement.

const fs = require('fs');
const path = require('path');
const { resolveTiebreak } = require('../../plugin/bin/lib/tiebreak.js');
const { CHUNK_HEADER_RE } = require('./prompt.js');
const {
  MANIFEST_FILE, FIXTURE_FILE, VERDICTS_FILE, JOURNAL_FILE, JOURNAL_EVENT_TYPES, VERDICT_CLASSES,
  IDENTITY_RE, armLabel, parseArmLabel, validateManifest,
} = require('./schema.js');

const SPLIT = /\r?\n/;
const EXIT_NOT_CLEAN = 3;
// Reasons from resolveTiebreak that settle as cant-tell; every other non-confirmed, non-refuted reason is notJudged.
const CANT_TELL_REASONS = ['verdict:cant-tell', 'evidence-unverified'];

const split = (text) => String(text).split(SPLIT);
const bump = (map, key, by = 1) => {
  map[key] = (map[key] || 0) + by;
};
const tally = () => ({ agree: 0, n: 0 });
const tallyInto = (map, key, agree) => {
  const t = map[key] || (map[key] = tally());
  t.n += 1;
  if (agree) t.agree += 1;
};

// remove when #5540 has landed and tiebreak.js exports a chunk splitter
// The reply text per id: the lines under the id's "### Finding {id}" header up to the next header, with the reply's last
// non-empty line (the status line) after it. An id with two sections, or none, maps to null.
function splitChunkReply(text, ids) {
  const lines = split(text);
  let last = lines.length - 1;
  while (last >= 0 && lines[last].trim() === '') last -= 1;
  const status = last >= 0 ? lines[last] : '';
  const sections = [];
  let current = null;
  for (const line of lines) {
    const m = CHUNK_HEADER_RE.exec(line);
    if (m) {
      current = { id: m[1], body: [] };
      sections.push(current);
    } else if (current) {
      current.body.push(line);
    }
  }
  const out = new Map();
  for (const id of ids) {
    const mine = sections.filter((s) => s.id === id);
    if (mine.length !== 1) {
      out.set(id, null);
      continue;
    }
    const body = [...mine[0].body];
    while (body.length > 0 && body[body.length - 1].trim() === '') body.pop();
    // The last section runs to the end of the reply, so it already ends on the status line.
    if (mine[0] !== sections[sections.length - 1]) body.push(status);
    out.set(id, body.join('\n'));
  }
  return out;
}

// One finding and its reply text -> { verdict, reason }; a null verdict is not judged.
function settleReply(finding, text, treeRoot) {
  const { lens, path: findingPath, line, claim, severity, kind } = finding;
  const r = resolveTiebreak(
    { lens, path: findingPath, line, claim, reporterSeverity: severity, kind },
    text,
    { readFile: (p) => fs.readFileSync(path.join(treeRoot, p), 'utf8') },
  );
  if (r.outcome === 'confirmed') return { verdict: 'confirmed', reason: r.reason };
  if (r.outcome === 'drop') return { verdict: 'refuted', reason: r.reason };
  if (CANT_TELL_REASONS.includes(r.reason)) return { verdict: 'cant-tell', reason: r.reason };
  return { verdict: null, reason: r.reason };
}

function messageText(message) {
  if (!message) return '';
  if (typeof message.content === 'string') return message.content;
  if (Array.isArray(message.content)) return message.content.filter((b) => b && b.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('\n');
  return '';
}

function parseLines(text) {
  const out = [];
  for (const l of split(text)) {
    if (l === '') continue;
    try {
      out.push(JSON.parse(l));
    } catch { /* a truncated transcript line is skipped */ }
  }
  return out;
}

// The label from the first user entry of an agent transcript, or null.
function agentIdentity(transcriptText) {
  const first = parseLines(transcriptText).find((e) => e && e.type === 'user');
  if (!first) return null;
  const m = IDENTITY_RE.exec(messageText(first.message));
  return m ? m[1] : null;
}

// Messages deduplicated by id at their largest usage; seconds from the first to the last timestamp.
function transcriptCost(transcriptText) {
  const messages = new Map();
  let first = null;
  let last = null;
  for (const e of parseLines(transcriptText)) {
    const t = Date.parse(e && e.timestamp);
    if (!Number.isNaN(t)) {
      if (first === null || t < first) first = t;
      if (last === null || t > last) last = t;
    }
    if (e && e.type === 'assistant' && e.message && e.message.id && e.message.usage) {
      const u = e.message.usage;
      const p = messages.get(e.message.id) || { output: 0, cacheRead: 0, cacheCreate: 0 };
      p.output = Math.max(p.output, u.output_tokens || 0);
      p.cacheRead = Math.max(p.cacheRead, u.cache_read_input_tokens || 0);
      p.cacheCreate = Math.max(p.cacheCreate, u.cache_creation_input_tokens || 0);
      messages.set(e.message.id, p);
    }
  }
  const sum = { requests: messages.size, output: 0, cacheRead: 0, cacheCreate: 0, seconds: first === null ? 0 : Math.round((last - first) / 1000) };
  for (const p of messages.values()) {
    sum.output += p.output;
    sum.cacheRead += p.cacheRead;
    sum.cacheCreate += p.cacheCreate;
  }
  return sum;
}

function readJson(fsImpl, file) {
  return JSON.parse(fsImpl.readFileSync(file, 'utf8'));
}

// The journal's started agent ids (in order) and each agent's result string; anything but a string is no reply.
function readJournal(fsImpl, file) {
  const started = [];
  const results = new Map();
  split(fsImpl.readFileSync(file, 'utf8')).forEach((l, i) => {
    if (l.trim() === '') return;
    let e;
    try {
      e = JSON.parse(l);
    } catch {
      throw new Error(`${file}: line ${i + 1} is not JSON`);
    }
    if (!e || !JOURNAL_EVENT_TYPES.includes(e.type) || typeof e.agentId !== 'string') return;
    if (e.type === 'started') {
      if (!started.includes(e.agentId)) started.push(e.agentId);
    } else if (typeof e.result === 'string') {
      results.set(e.agentId, e.result);
    }
  });
  return { started, results };
}

// Which replay slot (arm, repeat, prompt) each started agent judged, read from its own transcript.
function identifyAgents(fsImpl, dir, started, slots) {
  let unidentified = 0;
  const costs = [];
  for (const agentId of started) {
    const file = path.join(dir, `agent-${agentId}.jsonl`);
    const text = fsImpl.existsSync(file) ? fsImpl.readFileSync(file, 'utf8') : null;
    const parsed = text === null ? null : parseArmLabel(agentIdentity(text));
    const slot = parsed ? slots.get(armLabel(parsed.arm, parsed.repeat, parsed.name)) : undefined;
    if (!slot) {
      unidentified += 1;
      continue;
    }
    slot.agents.push(agentId);
    costs.push({ arm: slot.arm.name, cost: transcriptCost(text) });
  }
  return { unidentified, costs };
}

function stripTree(text, treeRoot) {
  return text.split(`${treeRoot}/`).join('').split(`${treeRoot}${path.sep}`).join('');
}

function score(opts, deps) {
  const fsImpl = deps.fs;
  const manifest = readJson(fsImpl, path.join(opts.out, MANIFEST_FILE));
  const problems = validateManifest(manifest);
  if (problems.length > 0) {
    deps.err(`review-replay.js: ${path.join(opts.out, MANIFEST_FILE)}: ${problems[0]}`);
    return 1;
  }
  const fixture = readJson(fsImpl, path.join(opts.out, FIXTURE_FILE));
  const archived = readJson(fsImpl, path.join(opts.out, VERDICTS_FILE)).verdicts;
  const reference = opts.reference === undefined ? manifest.arms[0].name : opts.reference;
  if (!manifest.arms.some((a) => a.name === reference)) {
    deps.err(`review-replay.js: --reference: no arm "${reference}" (arms: ${manifest.arms.map((a) => a.name).join(', ')})`);
    return 2;
  }

  const runs = new Map(fixture.runs.map((r) => [r.run, r]));
  const slots = new Map();
  for (const arm of manifest.arms) {
    for (let repeat = 1; repeat <= arm.repeat; repeat += 1) {
      for (const prompt of arm.prompts) slots.set(armLabel(arm.name, repeat, prompt.name), { arm, repeat, prompt, agents: [], reply: null });
    }
  }
  const { started, results } = readJournal(fsImpl, path.join(opts.transcripts, JOURNAL_FILE));
  const { unidentified, costs } = identifyAgents(fsImpl, opts.transcripts, started, slots);
  for (const slot of slots.values()) {
    for (const agentId of slot.agents) if (results.has(agentId)) slot.reply = results.get(agentId);
  }

  const arms = {};
  const verdictsByArm = {};
  for (const arm of manifest.arms) {
    arms[arm.name] = {
      judged: 0,
      notJudged: 0,
      notJudgedByReason: {},
      cantTell: 0,
      total: tally(),
      byClass: Object.fromEntries(VERDICT_CLASSES.map((c) => [c, tally()])),
      bySeverity: {},
      vsReference: tally(),
      cost: { agents: 0, requests: 0, output: 0, cacheRead: 0, cacheCreate: 0, seconds: 0 },
    };
    verdictsByArm[arm.name] = new Map();
  }
  for (const { arm, cost } of costs) {
    const c = arms[arm].cost;
    c.agents += 1;
    for (const k of ['requests', 'output', 'cacheRead', 'cacheCreate', 'seconds']) c[k] += cost[k];
  }

  for (const slot of slots.values()) {
    const a = arms[slot.arm.name];
    const run = runs.get(slot.prompt.run);
    const ids = slot.prompt.findingIds;
    const text = typeof slot.reply === 'string' ? stripTree(slot.reply, run.tree) : null;
    const sections = text !== null && ids.length >= 2 ? splitChunkReply(text, ids) : null;
    for (const id of ids) {
      const finding = run.findings.find((f) => f.id === id);
      const key = `${slot.prompt.run}/${id}`;
      const noReason = slot.agents.length === 0 && unidentified > 0 ? 'unidentified-agent' : 'no-reply';
      let settled;
      if (text === null) settled = { verdict: null, reason: noReason };
      else if (sections && sections.get(id) === null) settled = { verdict: null, reason: 'chunk-split' };
      else settled = settleReply(finding, sections ? sections.get(id) : text, run.tree);
      if (settled.verdict === null) {
        a.notJudged += 1;
        bump(a.notJudgedByReason, settled.reason);
        continue;
      }
      const want = archived[key];
      if (!VERDICT_CLASSES.includes(want)) throw new Error(`${VERDICTS_FILE}: no archived verdict for ${key}`);
      const agree = settled.verdict === want;
      a.judged += 1;
      if (settled.verdict === 'cant-tell') a.cantTell += 1;
      a.total.n += 1;
      if (agree) a.total.agree += 1;
      a.byClass[want].n += 1;
      if (agree) a.byClass[want].agree += 1;
      tallyInto(a.bySeverity, finding.severity, agree);
      verdictsByArm[slot.arm.name].set(`${key}|${slot.repeat}`, settled.verdict);
    }
  }

  const ref = verdictsByArm[reference];
  for (const arm of manifest.arms) {
    for (const [k, v] of verdictsByArm[arm.name]) {
      if (!ref.has(k)) continue;
      arms[arm.name].vsReference.n += 1;
      if (ref.get(k) === v) arms[arm.name].vsReference.agree += 1;
    }
  }

  const baseline = { agents: 0, out: 0, cc: 0, cr: 0, seconds: 0 };
  for (const r of fixture.runs) for (const k of Object.keys(baseline)) baseline[k] += r.baselineTiebreak[k];
  deps.log(JSON.stringify({
    findings: fixture.totals.findings, reference, counts: fixture.counts, baseline, unidentifiedAgents: unidentified, arms,
  }, null, 2));
  return Object.values(arms).some((a) => a.notJudged > 0) ? EXIT_NOT_CLEAN : 0;
}

module.exports = { score, splitChunkReply, settleReply, agentIdentity };
