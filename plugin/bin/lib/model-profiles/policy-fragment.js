// bin/lib/model-profiles/policy-fragment.js
//
// Minimal hand-rolled reader for the resolver's five policy keys, from policy.yml
// or factory-layer text (POLICY_KEYS_READ in ./profiles.js). bin/lib/policy-schema.js's
// parseFlatLines is deliberately flat-only; the nested model-profiles map
// needs this dedicated reader. No YAML library — the plugin ships zero
// runtime npm deps.
'use strict';

// The flat-key comment rule (parseFlatLines' `[^#]*`): a `#` anywhere ends the
// line. That is exact here because no `model-profiles` row name or field value
// can hold a `#`. `trimEnd()` also drops a CRLF's trailing `\r`. Both readers of
// the block use this one function: parsePolicyModelConfig below and
// policy-schema.js's extractMapEntry. risk-path-globs.js keeps its own
// quote-aware rule on purpose (a glob may hold `#`).
function stripComment(line) {
  const hash = line.indexOf('#');
  return (hash === -1 ? line : line.slice(0, hash)).trimEnd();
}

function parsePolicyModelConfig(raw) {
  const out = {};
  if (!raw) return out;
  const lines = raw.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = stripComment(lines[i]);
    if (!line.trim() || line.startsWith(' ')) continue;
    const m = /^([A-Za-z-]+):\s*(.*)$/.exec(line);
    if (!m) continue;
    const [, key, value] = m;
    if (key === 'model-stance' || key === 'model-ceiling' || key === 'model-effort') {
      out[key] = value.trim();
    } else if (key === 'frontier-run-cap') {
      const n = Number.parseInt(value.trim(), 10);
      if (Number.isNaN(n) || String(n) !== value.trim()) {
        throw new Error(`frontier-run-cap must be an integer, got "${value.trim()}"`);
      }
      out[key] = n;
    } else if (key === 'model-profiles') {
      const map = {};
      let profile = null;
      let j = i + 1;
      for (; j < lines.length; j += 1) {
        const sub = stripComment(lines[j]);
        if (!sub.trim()) continue;
        const rowM = /^ {2}([A-Za-z-]+):\s*$/.exec(sub);
        const fieldM = /^ {4}(model|effort):\s*(\S+)$/.exec(sub);
        const badField = /^ {4}([A-Za-z-]+):/.exec(sub);
        if (rowM) { profile = rowM[1]; map[profile] = {}; continue; }
        if (fieldM && profile) { map[profile][fieldM[1]] = fieldM[2]; continue; }
        if (badField && profile) {
          throw new Error(`model-profiles.${profile}: unknown field "${badField[1]}" (only model/effort)`);
        }
        break; // dedent — nested block ended
      }
      // Resume the outer scan ON the dedented line, not after it: a flat key
      // following the block is still one of the five we read.
      i = j - 1;
      out[key] = map;
    }
  }
  return out;
}

// The `model-profiles` block's own text — its column-0 header line through the
// line before the next non-blank column-0 line — or null when absent. The last
// block wins, matching parsePolicyModelConfig's last-wins assignment. The header
// is matched by prefix, so an inline value (`model-profiles: {}`) still opens a
// block, as it does in parsePolicyModelConfig.
function cutModelProfilesBlock(raw) {
  const lines = raw.split('\n');
  let start = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (!lines[i].startsWith(' ') && /^model-profiles:/.test(stripComment(lines[i]))) start = i;
  }
  if (start === -1) return null;
  let end = start + 1;
  for (; end < lines.length; end += 1) {
    const text = stripComment(lines[end]);
    if (text.trim() && !text.startsWith(' ')) break;
  }
  return lines.slice(start, end).join('\n');
}

// The resolve-policy entry for the `model-profiles` key, shared by the CLI and
// the driver's policy read. Only the block is parsed (#5917): a malformed
// sibling key such as `frontier-run-cap: abc` never marks it invalid.
function modelProfilesEntry(policyRaw, factoryRaw = null, onInvalid = null) {
  const repo = readProfilesSide(policyRaw);
  const factory = readProfilesSide(factoryRaw);
  // A malformed factory block never changes the entry beside a valid repo block, so say so through the caller's channel.
  if (factory.present && !factory.ok && onInvalid) onInvalid('model-profiles', null, 'factory');
  if (!repo.ok && !factory.ok) {
    return repo.present || factory.present ? { value: null, source: 'default', invalid: true } : { value: null, source: 'default' };
  }
  // #6006: whole profile rows merge, repo over factory. A malformed side never hides a valid one; a malformed
  // repo block that yields to the factory's rows is marked repoInvalid (additive, as resolvePolicyKeys' block keys).
  const { rows, source } = mergeBlockRows(repo, factory);
  return { value: rows, source, ...(repo.present && !repo.ok ? { repoInvalid: true } : {}) };
}

// The row merge every block key shares (#6006; policy-schema.js's resolvePolicyKeys calls it for risk-path-globs and
// express-driver-models). Each side is { ok, value } with value a row map; at least one side is ok. Rows merge repo over
// factory; the source is 'factory' when the repo side adds no row and the factory side does (a block present but empty
// on the repo side, or absent or malformed there), 'policy' otherwise.
function mergeBlockRows(repo, factory) {
  const repoRows = repo.ok ? repo.value : {};
  const factoryRows = factory.ok ? factory.value : {};
  const fromFactory = factory.ok && (!repo.ok || (Object.keys(repoRows).length === 0 && Object.keys(factoryRows).length > 0));
  return { rows: { ...factoryRows, ...repoRows }, source: fromFactory ? 'factory' : 'policy' };
}

// One source's model-profiles block: { present: false } | { present: true, ok: true, value } | { present: true, ok: false }.
function readProfilesSide(raw) {
  const block = raw ? cutModelProfilesBlock(raw) : null;
  if (block === null) return { present: false, ok: false };
  try {
    return { present: true, ok: true, value: parsePolicyModelConfig(block)['model-profiles'] };
  } catch {
    return { present: true, ok: false };
  }
}

module.exports = { parsePolicyModelConfig, stripComment, modelProfilesEntry, mergeBlockRows };
