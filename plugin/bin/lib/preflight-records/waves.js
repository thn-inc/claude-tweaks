// bin/lib/preflight-records/waves.js
// Parallel-wave planner for /flow's opt-in multi-spec `parallel` mode (#2677).
// Turns the run's in-run blocked-by DAG into ordered waves: longest-path
// levels, each split so two records sharing a Key Files file path never share
// a wave — groupByFileOverlap with hub paths NOT exempt, since a widely shared
// file is exactly what conflicts at merge-back. A record with no Key Files, or
// with any bare-directory entry (trailing "/", which groupByFileOverlap never
// bridges on), cannot be proven independent, so it gets a wave of its own. A
// wave of one runs exactly as a sequential run does. Execution model:
// skills/flow/multispec-parallel-waves.md.
'use strict';

const { groupByFileOverlap } = require('../issues/grouping');

// records: buildRecords output ({ "<n>": { blockedBy, keyFiles } }), numbers:
// the run's targets in run order -> { waves: number[][], parallel: boolean }.
function planParallelWaves({ records, numbers }) {
  const inRun = new Set(numbers);
  const rec = (n) => records[String(n)] || {};
  const blockersOf = (n) => (rec(n).blockedBy || []).filter((b) => inRun.has(b) && b !== n);
  const keyFilesOf = (n) => rec(n).keyFiles || [];
  const isKnown = (n) => keyFilesOf(n).length > 0 && !keyFilesOf(n).some((f) => f.endsWith('/'));

  const level = new Map();
  const visiting = new Set();
  const levelOf = (n) => {
    if (level.has(n)) return level.get(n);
    if (visiting.has(n)) throw new Error(`dependency cycle through #${n}`);
    visiting.add(n);
    const l = blockersOf(n).reduce((max, b) => Math.max(max, levelOf(b) + 1), 0);
    visiting.delete(n);
    level.set(n, l);
    return l;
  };
  numbers.forEach(levelOf);

  const waves = [];
  const maxLevel = numbers.reduce((max, n) => Math.max(max, level.get(n)), -1);
  for (let l = 0; l <= maxLevel; l++) {
    const members = numbers.filter((n) => level.get(n) === l);
    const known = members.filter(isKnown);
    const groups = groupByFileOverlap(known.map((n) => ({ id: n, keyFiles: keyFilesOf(n) })), { hubPathMinCount: Infinity });
    const depth = groups.reduce((max, g) => Math.max(max, g.length), 0);
    for (let i = 0; i < depth; i++) waves.push(known.filter((n) => groups.some((g) => g[i] === n)));
    for (const n of members) if (!isKnown(n)) waves.push([n]);
  }
  return { waves, parallel: waves.some((w) => w.length > 1) };
}

module.exports = { planParallelWaves };
