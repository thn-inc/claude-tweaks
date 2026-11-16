'use strict';

// Claim release times for dispatch's shipped-candidate pass (#4432).
//
// classifyShipped (issues/shipped-candidate.js) rates a merged mention with a
// second signal `weak` at most when the record's claim was released after that
// PR merged: a run saw that merge and left the record open (a shaping-only
// release downgrades too, the safe direction). It is pure, so the caller hands
// it `opts.lastReleasedAt`. This module is where that value comes from: the
// `releasedAt` of each candidate's claim tombstone on the claims-registry.
//
// Only candidates with a merged mention are read — a record with no merged
// mention never reaches the downgrade, and a claim read costs a network call.
// The reader is built lazily for the same reason: a queue with no such
// candidate builds none.
//
// A missing or unreadable release time never downgrades and never upgrades, so
// every failure here (a failed read, a thrown read, a corrupt blob, an
// unwritable file) leaves the record out of the map and says so on `log`; the
// caller falls back to the prior behaviour. The map is persisted so later
// steps of the queue-pull script can read it without a second round of reads.

const fs = require('node:fs');
const { createClaimReader } = require('../issues/claim-store');
const { releaseTimeFromClaim } = require('../issues/claims');

function hasMergedMention(linkedPRs, number) {
  const entry = linkedPRs && linkedPRs[number];
  return Boolean(entry && Array.isArray(entry.mentions) && entry.mentions.some((m) => m && m.merged));
}

// file: where to persist the { [number]: isoString } map.
// candidates: issue objects ({ number }). linkedPRs: { [number]: { mentions: [{ merged, ... }] } }.
// deps: { reader?: { read(n) -> {content}|{failure} }, log?: (line) => void }.
// Returns the map, whether or not it could be written.
function writeReleaseTimes(file, candidates, linkedPRs, deps = {}) {
  const log = deps.log || ((line) => console.error(line));
  const targets = candidates.filter((c) => hasMergedMention(linkedPRs, c.number));

  const times = {};
  const unreadable = [];
  if (targets.length > 0) {
    const reader = deps.reader || createClaimReader();
    for (const { number } of targets) {
      let result = null;
      let cause = 'no answer';
      try {
        result = reader.read(number);
      } catch (err) {
        cause = (err && err.message) || 'read threw';
      }
      if (!result || !Object.prototype.hasOwnProperty.call(result, 'content')) {
        unreadable.push('#' + number + ' (' + ((result && result.failure) || cause) + ')');
        continue;
      }
      const release = releaseTimeFromClaim(result.content);
      if (release.unreadable) unreadable.push('#' + number + ' (corrupt claim blob)');
      else if (release.releasedAt) times[number] = release.releasedAt;
    }
  }

  if (unreadable.length > 0) {
    log('AUTO — dispatch: shipped-candidate claim read failed for ' + unreadable.join(', ') + '; release time unknown, no downgrade');
  }
  try {
    fs.writeFileSync(file, JSON.stringify(times));
  } catch (err) {
    // A map left by an earlier pull would be read by the second pass as this
    // pull's, so remove it: the logged "no downgrade" must hold there too.
    try {
      fs.unlinkSync(file);
    } catch {
      /* nothing to remove, or not removable */
    }
    log('AUTO — dispatch: shipped-candidate release times not written to ' + file + ' (' + (err && err.message) + '); release time unknown, no downgrade');
  }
  return times;
}

// The map writeReleaseTimes persisted; {} for a missing, corrupt or non-object file.
function readReleaseTimes(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

module.exports = { writeReleaseTimes, readReleaseTimes };
