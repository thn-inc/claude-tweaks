'use strict';
// tools/pipeline-cost-report/spend.js — prices the model requests in a Claude Code transcript (#5914).
//
// scanTranscript streams a transcript's raw JSONL lines and returns one Request per message.id, in transcript
// order. Per message.id it keeps the maximum of input_tokens, output_tokens, cache_read_input_tokens and
// cache_creation_input_tokens across the lines that repeat the id (the usage grows while a response streams, so
// neither the first line nor a per-line sum is right), and the 5-minute / 1-hour cache-write split read from the
// line holding the largest cache write. Both are mergeUsage's (plugin/bin/lib/timing/transcript.js), loaded via
// the `pluginRoot` dep: a line without a split prices all of the write at the 5-minute rate. The compaction
// marker and message.id are tracked here.
//
// Each Request also carries `cause`, why a cache re-write (write > 40,000 tokens and > half the prompt) happened,
// first match wins: session start, model switch, compaction, idle (>= 1 hour since the previous model call),
// else ordinary growth. A request that is not a re-write is ordinary growth. The previous call is tracked
// across the whole file, so calls before any reporting window still count.
//
// The same pass records three facts for the dispatch-firing count: `firstTs` (the first line that carries a string timestamp),
// `pluginVersion` (the first `claude-tweaks vX.Y.Z @` in the raw line text — the SessionStart hook injects it inside
// hook content, sometimes JSON-escaped, so it is matched before JSON.parse), and `reachedRoute`. Route evidence is
// strict: only a Bash tool_use whose command passes isRouteCommand counts — `drive.js --check` mentioned in prose
// or a file read into the transcript is not.
//
// The price table and per-request pricer live in plugin/bin/lib/pricing/prices.js. An unrecognised model id is
// `unpriced`: counted and returned with zero cost.

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const PLUGIN_ROOT = path.join(__dirname, '..', '..', 'plugin');
const { PRICES, familyOf, priceRequest } = require('../../plugin/bin/lib/pricing/prices.js');

// Claude Code writes `<synthetic>` assistant lines (zero usage) for API errors such as usage_limit_reached. They are
// kept in `requests` (zero cost) but are left out of every spend tally, `unpriced` included. They are not model
// calls: they never serve as the previous call for the family or idle-gap check and never use up a pending
// compaction marker. Any other unpriced id is a real call of an unknown family and stays in the chain.
const SYNTHETIC_MODEL = '<synthetic>';
const REWRITE_MIN_TOKENS = 40000;
const IDLE_MS = 60 * 60 * 1000;
const BUCKET_EDGES = [50000, 100000, 150000, 200000, 300000, 400000, 500000, 700000];
const BUCKET_NAMES = ['<50', '50-100', '100-150', '150-200', '200-300', '300-400', '400-500', '500-700', '>700'];

function bucketOf(promptTokens) {
  const i = BUCKET_EDGES.findIndex((edge) => promptTokens < edge);
  return BUCKET_NAMES[i === -1 ? BUCKET_NAMES.length - 1 : i];
}

function textOf(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map((b) => (b && b.type === 'text' && typeof b.text === 'string' ? b.text : '')).join('\n');
}

const COMMAND_RE = /<command-name>\s*\/?claude-tweaks:([^<\s]+?)\s*<\/command-name>/;
const SKILL_RE = /^claude-tweaks:(.+)$/;

function skillOfLine(line) {
  const message = line.message;
  if (!message) return null;
  if (line.type === 'user') {
    const m = COMMAND_RE.exec(textOf(message.content));
    return m ? m[1] : null;
  }
  if (line.type === 'assistant' && Array.isArray(message.content)) {
    for (const block of message.content) {
      if (block && block.type === 'tool_use' && block.name === 'Skill' && block.input && typeof block.input.skill === 'string') {
        const m = SKILL_RE.exec(block.input.skill);
        if (m) return m[1];
      }
    }
  }
  return null;
}

function isCompactionMarker(line) {
  return (line.type === 'system' && line.subtype === 'compact_boundary') || line.isCompactSummary === true;
}

// A misconfigured pluginRoot must fail the run loudly: left to scanTranscript, collectSpend's per-file catch would
// count every transcript unreadable instead.
function loadMergeUsage(pluginRoot) {
  const file = path.join(pluginRoot, 'bin', 'lib', 'timing', 'transcript.js');
  const { mergeUsage } = require(file);
  if (typeof mergeUsage !== 'function') throw new Error(`${file} does not export mergeUsage`);
  return mergeUsage;
}

const PLUGIN_VERSION_RE = /claude-tweaks v(\d+\.\d+\.\d+) @/;
const CHECK_FLAG_RE = /(^|\s)--check(\s|$)/;

// Does a Bash command show the session reached the pipeline driver route: a `drive.js --check` call, or the
// `Driver route (skipped)` decision the skill logs when it declines the driver.
function isRouteCommand(command) {
  if (typeof command !== 'string') return false;
  if (command.includes('drive.js') && CHECK_FLAG_RE.test(command)) return true;
  return command.includes('log-decision.js') && command.includes('Driver route (skipped)');
}

function hasRouteCall(line) {
  const content = line.message && line.message.content;
  if (line.type !== 'assistant' || !Array.isArray(content)) return false;
  return content.some((b) => b && b.type === 'tool_use' && b.name === 'Bash' && b.input && isRouteCommand(b.input.command));
}

async function scanTranscript(file, { fsImpl = fs, pluginRoot = PLUGIN_ROOT } = {}) {
  const mergeUsage = loadMergeUsage(pluginRoot);
  const out = { cwd: null, firstSkill: null, firstTs: null, pluginVersion: null, reachedRoute: false, requests: [] };
  const byId = new Map();
  let compactionPending = false;
  const rl = readline.createInterface({ input: fsImpl.createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
  let nonEmpty = 0;
  let parsed = 0;
  for await (const raw of rl) {
    if (!raw) continue;
    nonEmpty += 1;
    if (out.pluginVersion === null) {
      const m = PLUGIN_VERSION_RE.exec(raw);
      if (m) out.pluginVersion = m[1];
    }
    let line;
    try {
      line = JSON.parse(raw);
    } catch {
      continue;
    }
    parsed += 1;
    if (!line || typeof line !== 'object') continue;
    if (out.cwd === null && typeof line.cwd === 'string' && line.cwd) out.cwd = line.cwd;
    if (out.firstSkill === null) out.firstSkill = skillOfLine(line);
    if (out.firstTs === null && typeof line.timestamp === 'string' && line.timestamp) out.firstTs = line.timestamp;
    if (!out.reachedRoute && hasRouteCall(line)) out.reachedRoute = true;
    if (isCompactionMarker(line)) compactionPending = true;
    const message = line.message;
    if (line.type !== 'assistant' || !message || typeof message.id !== 'string' || !message.usage) continue;
    const usage = message.usage;
    let r = byId.get(message.id);
    if (!r) {
      const synthetic = message.model === SYNTHETIC_MODEL;
      r = { id: message.id, ts: line.timestamp || null, model: message.model || '', synthetic, usage: null, afterCompaction: compactionPending && !synthetic };
      if (!synthetic) compactionPending = false;
      byId.set(message.id, r);
      out.requests.push(r);
    }
    r.usage = mergeUsage(r.usage, usage);
    if (!r.model && message.model) r.model = message.model;
  }

  // One malformed line among good ones is a live transcript cut mid-line; no parseable line at all is a corrupt file.
  if (nonEmpty > 0 && parsed === 0) throw new Error(`no line of ${file} parses as JSON`);

  let prev = null;
  out.requests = out.requests.map((r) => {
    const { input, output, cacheRead, cacheCreate: cacheWrite, cacheWrite1h, cacheWrite5m } = r.usage;
    const priced = priceRequest({ model: r.model, input, output, cacheRead, cacheWrite5m, cacheWrite1h });
    const rewrite = cacheWrite > REWRITE_MIN_TOKENS && cacheWrite > priced.prompt / 2;
    let cause = 'ordinary growth';
    if (rewrite) {
      const gap = prev && r.ts && prev.ts ? Date.parse(r.ts) - Date.parse(prev.ts) : NaN;
      if (!prev) cause = 'session start';
      else if (prev.family !== priced.family) cause = 'model switch';
      else if (r.afterCompaction) cause = 'compaction';
      else if (gap >= IDLE_MS) cause = 'idle';
    }
    if (!r.synthetic) prev = { family: priced.family, ts: r.ts };
    return {
      id: r.id,
      ts: r.ts,
      model: r.model,
      family: priced.family,
      input,
      output,
      cacheRead,
      cacheWrite,
      cacheWrite5m,
      cacheWrite1h,
      prompt: priced.prompt,
      usd: priced.usd,
      cacheWriteUsd: priced.cacheWriteUsd,
      cause,
    };
  });
  return out;
}

// Is `cwd` the directory `root` or inside it? `root` is normalized with the platform's resolve, because git prints
// forward slashes on Windows (`C:/Users/u/repo`) while a transcript's cwd is native (`C:\Users\u\repo`).
function isUnderRoot(cwd, root, pathImpl = path) {
  if (typeof cwd !== 'string' || !cwd) return false;
  const base = pathImpl.resolve(root);
  return cwd === base || cwd.startsWith(base.endsWith(pathImpl.sep) ? base : base + pathImpl.sep);
}

// The transcript scope `match`/`root` describe, as a (cwd, slug) predicate — shared with funnel.js so the dispatch-firing
// figure keeps spend's scope (see collectSpend below).
function transcriptScope({ match = null, root = null }) {
  return (cwd, slug) => (!match || (cwd || slug).includes(match)) && (!root || isUnderRoot(cwd, root));
}

const DAY_MS = 24 * 60 * 60 * 1000;
const NO_SKILL = 'no skill invoked';
const UNATTRIBUTED = 'unattributed';

function dayStart(date) {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function add(map, key, usd) {
  map[key] = (map[key] || 0) + usd;
}

function addCount(map, key, usd) {
  const e = map[key] || (map[key] = { requests: 0, usd: 0 });
  e.requests += 1;
  e.usd += usd;
}

// Spend over the transcripts under `roots` ({root}/{slug}/{session}.jsonl, plus the subagent files under
// {root}/{slug}/{session}/subagents/ and subagents/workflows/{id}/). The window is `since`'s UTC day through
// `until`'s UTC day, both inclusive; a request belongs to it by its own timestamp. A directory or file that cannot be
// read (live sessions are reaped mid-scan) is counted in `unreadable` and the scan goes on. Roots are scanned as given;
// de-duplicating aliased roots is the caller's job. Money figures are unrounded dollars. Synthetic API-error lines
// carry no spend and are left out of every tally, `unpriced` included. `match` keeps the transcripts whose working
// directory (the slug when the transcript names none) contains that substring; `root` keeps those whose working
// directory is that path or under it (a transcript naming no working directory is not kept); both given: both hold.
// A session dir whose subagent files are all outside the window is skipped without reading its parent transcript.
async function collectSpend(
  { roots, since, until, match = null, root: scopeRoot = null },
  { fsImpl = fs, pluginRoot = PLUGIN_ROOT, transcriptCache = null } = {},
) {
  loadMergeUsage(pluginRoot);
  const startMs = dayStart(since);
  const endMs = dayStart(until) + DAY_MS;
  const res = {
    total: 0,
    bySessionType: {},
    byModel: {},
    byAgent: { main: 0, subagent: 0 },
    byBucket: {},
    cacheWrites: {},
    unpriced: { requests: 0, tokens: 0 },
    sessions: 0,
    unreadable: 0,
  };
  const failed = new Set();
  const fail = (file) => {
    if (!failed.has(file)) {
      failed.add(file);
      res.unreadable += 1;
    }
  };
  // optional: a missing directory is "nothing there", not a failure (a session dir need not have subagents/)
  const list = (dir, optional = false) => {
    try {
      return fsImpl.readdirSync(dir, { withFileTypes: true });
    } catch (e) {
      if (!(optional && e && e.code === 'ENOENT')) fail(dir);
      return [];
    }
  };
  const inWindow = (file) => {
    try {
      return fsImpl.statSync(file).mtimeMs >= startMs;
    } catch {
      fail(file);
      return null;
    }
  };
  const wanted = transcriptScope({ match, root: scopeRoot });

  // returns how many of the requests were counted
  function tally(requests, sessionType, agent) {
    let counted = 0;
    for (const r of requests) {
      if (r.model === SYNTHETIC_MODEL) continue;
      const t = Date.parse(r.ts);
      if (!(t >= startMs && t < endMs)) continue;
      counted += 1;
      res.total += r.usd;
      add(res.bySessionType, sessionType, r.usd);
      add(res.byModel, r.family, r.usd);
      res.byAgent[agent] += r.usd;
      addCount(res.byBucket, bucketOf(r.prompt), r.usd);
      if (r.cacheWrite > 0) {
        const e = res.cacheWrites[r.cause] || (res.cacheWrites[r.cause] = { requests: 0, tokens: 0, usd: 0 });
        e.requests += 1;
        e.tokens += r.cacheWrite;
        e.usd += r.cacheWriteUsd;
      }
      if (r.family === 'unpriced') {
        res.unpriced.requests += 1;
        res.unpriced.tokens += r.prompt + r.output;
      }
    }
    return counted;
  }

  // Main transcripts are scanned once; only { type } (the session type) or the failure is kept, so a subagent can look
  // its parent up without holding every request list in memory. A main inside the window is tallied as it is scanned.
  const mainInfo = new Map();
  function scanMain(file, slug, tallyIt) {
    if (!mainInfo.has(file)) {
      mainInfo.set(
        file,
        scanTranscript(file, { fsImpl, pluginRoot }).then(
          ({ cwd, firstSkill, firstTs, pluginVersion, reachedRoute, requests }) => {
            transcriptCache?.set(file, { cwd, firstSkill, firstTs, pluginVersion, reachedRoute });
            const type = firstSkill || NO_SKILL;
            if (tallyIt && wanted(cwd, slug) && tally(requests, type, 'main') > 0) res.sessions += 1;
            return { type };
          },
          () => {
            transcriptCache?.set(file, { error: true });
            fail(file);
            return { error: true };
          },
        ),
      );
    }
    return mainInfo.get(file);
  }

  async function scanSubagent(file, slug, sessionType) {
    try {
      const { cwd, requests } = await scanTranscript(file, { fsImpl, pluginRoot });
      if (wanted(cwd, slug)) tally(requests, sessionType, 'subagent');
    } catch {
      fail(file);
    }
  }

  for (const root of roots) {
    for (const slugEntry of list(root)) {
      if (!slugEntry.isDirectory()) continue;
      const slug = slugEntry.name;
      const slugDir = path.join(root, slug);
      const entries = list(slugDir);
      const mains = new Set(entries.filter((e) => e.isFile() && e.name.endsWith('.jsonl')).map((e) => e.name.slice(0, -'.jsonl'.length)));

      for (const session of mains) {
        const file = path.join(slugDir, `${session}.jsonl`);
        if (inWindow(file) === true) await scanMain(file, slug, true);
      }

      for (const dirEntry of entries) {
        if (!dirEntry.isDirectory()) continue;
        const session = dirEntry.name;
        const subDir = path.join(slugDir, session, 'subagents');
        const files = [];
        for (const e of list(subDir, true)) {
          if (e.isFile() && e.name.startsWith('agent-') && e.name.endsWith('.jsonl')) files.push(path.join(subDir, e.name));
          else if (e.isDirectory() && e.name === 'workflows') {
            for (const wf of list(path.join(subDir, 'workflows'), true)) {
              if (!wf.isDirectory()) continue;
              const wfDir = path.join(subDir, 'workflows', wf.name);
              for (const a of list(wfDir)) if (a.isFile() && a.name.startsWith('agent-') && a.name.endsWith('.jsonl')) files.push(path.join(wfDir, a.name));
            }
          }
        }
        // Only subagent files in the window matter; an old session's parent is never read for them.
        const live = files.filter((f) => inWindow(f) === true);
        if (live.length === 0) continue;
        let parentType = UNATTRIBUTED;
        if (mains.has(session)) {
          const parent = await scanMain(path.join(slugDir, `${session}.jsonl`), slug, false);
          if (parent.type) parentType = parent.type;
        }
        for (const file of live) await scanSubagent(file, slug, parentType);
      }
    }
  }
  // Buckets are created as first seen; list them smallest prompt first so the rendered table reads as a distribution.
  res.byBucket = Object.fromEntries(BUCKET_NAMES.filter((b) => b in res.byBucket).map((b) => [b, res.byBucket[b]]));
  return res;
}

module.exports = { PRICES, isUnderRoot, transcriptScope, familyOf, bucketOf, priceRequest, scanTranscript, isRouteCommand, collectSpend };
