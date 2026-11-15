// bin/lib/model-profiles/policy-fragment.js
//
// Minimal hand-rolled reader for the resolver's four policy.yml keys
// (POLICY_KEYS_READ in ./profiles.js). bin/lib/policy-schema.js's
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
    if (key === 'model-stance' || key === 'model-ceiling') {
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
      // following the block is still one of the four we read.
      i = j - 1;
      out[key] = map;
    }
  }
  return out;
}

module.exports = { parsePolicyModelConfig, stripComment };
