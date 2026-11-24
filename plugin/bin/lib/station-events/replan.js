// plugin/bin/lib/station-events/replan.js — reads the station-events log for a run's latest plan per
// record and emits a `replanned` event through a caller-supplied sink when a changed manifest setting
// (lane, ceremony profile) changes the stations (#6148). Reference: docs/reference/station-events.md.
// The only emitting caller is the Manifesto; wrap-up and express changes go through the `set-config.js`
// CLI, which passes no sink. Never throws: emission never blocks or fails a transition.
'use strict';

const fs = require('fs');
const path = require('path');
const { planOf, replanEvent, LANE_UNKNOWN } = require('./plan');
const { stationEventPath } = require('./emit');
const { KIND, REASON } = require('./stations');
const { mainCheckoutRoot } = require('../hooks/worktree-detect');

// recordNumber -> { repoName, lane, stations } from the last `planned`/`replanned` line of `runId`.
function latestPlans({ mainRoot, runId, fs: fsDep } = {}) {
  const plans = new Map();
  if (typeof mainRoot !== 'string' || mainRoot === '' || typeof runId !== 'string' || runId === '') return plans;
  let text;
  try {
    text = (fsDep || fs).readFileSync(stationEventPath(mainRoot), 'utf8');
  } catch {
    return plans;
  }
  for (const raw of String(text).split('\n')) {
    if (!raw) continue;
    let line;
    try { line = JSON.parse(raw); } catch { continue; }
    if (line === null || typeof line !== 'object') continue;
    if (line.kind !== KIND.PLANNED && line.kind !== KIND.REPLANNED) continue;
    if (line.runId !== runId || !Number.isInteger(line.recordNumber)) continue;
    const stations = line.payload && line.payload.stations;
    if (!Array.isArray(stations) || !stations.every((s) => typeof s === 'string')) continue;
    plans.set(line.recordNumber, {
      repoName: line.repoName, lane: typeof line.lane === 'string' ? line.lane : null, stations: [...stations],
    });
  }
  return plans;
}

// Emits one `replanned` per record whose recomputed list differs from its latest one; returns the count.
function replanRun({ runDir, manifest, ref, deps } = {}) {
  let emitted = 0;
  try {
    const d = deps !== null && typeof deps === 'object' ? deps : {};
    if (typeof d.stationEvent !== 'function') return 0;
    const m = manifest !== null && typeof manifest === 'object' ? manifest : {};
    const runId = path.basename(runDir);
    const mainRoot = d.mainRoot ?? mainCheckoutRoot(runDir);
    const at = (d.now || (() => new Date()))().toISOString();
    for (const [recordNumber, plan] of latestPlans({ mainRoot, runId, fs: d.fs })) {
      try {
        const listLane = typeof plan.lane === 'string' && plan.lane !== LANE_UNKNOWN ? plan.lane : m.lane;
        const afterPlan = planOf({ lane: listLane, ceremonyProfile: m.ceremonyProfile });
        const downgrade = plan.stations.some((s) => !afterPlan.stations.includes(s));
        const event = replanEvent({
          repoName: plan.repoName, recordNumber, before: plan.stations, after: afterPlan.stations,
          reasonCode: downgrade ? REASON.CEREMONY_DOWNGRADE : REASON.OTHER,
          reasonText: downgrade ? undefined : afterPlan.reasonText,
          cause: { kind: 'config', ref }, sessionId: d.sessionId ?? null, runId, at, lane: plan.lane,
        });
        if (event === null) continue;
        d.stationEvent(event);
        emitted += 1;
      } catch { /* one record's failure never stops the next */ }
    }
  } catch { /* emission never fails the transition */ }
  return emitted;
}

module.exports = { latestPlans, replanRun };
