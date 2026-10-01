'use strict';

// candidates-agent-trust-scope.js — deterministic candidate generator for
// code-health's `focus=agent-trust-scope` scoping mode (#2749).
//
// Audits an unattended autonomous agent's own STANDING reach — registry
// access, network egress, credential scope — as configured by a project's
// `.claude/settings.json` permission posture combined with its
// `.claude-tweaks/policy.yml` autonomy level. This is deliberately distinct
// from the `risk:*` label's "blast radius" scoring
// (`bin/lib/issues/blast-radius.js` / `bin/blast-radius.js`): that mechanism
// judges how bad a SPECIFIC code change could be if it goes wrong. This
// vertical judges the agent's own outer boundary — what it could reach —
// independent of any one task's content. See `criteria-agent-trust-scope.md`
// for the judging side of this same distinction.
//
// Coverage (stated explicitly, never implied total — IL-110):
//   - Reads exactly two files, if present: `.claude/settings.json` (the
//     project's own committed permission posture) and
//     `.claude-tweaks/policy.yml` (the project's own `autonomy:` level).
//     A project's actual EFFECTIVE permissions are the union of this file,
//     any `.claude/settings.local.json` (gitignored, never committed, and
//     so invisible to a repo scan by construction), and the user's own
//     `~/.claude/settings.json` (outside the repo entirely) — none of which
//     this generator can see. A clean result here is evidence about the
//     committed project config only, never a guarantee about what an agent
//     actually running in this environment can reach.
//   - `autonomy` is read as a plain `autonomy: <value>` line straight out of
//     `.claude-tweaks/policy.yml` — no resolver precedence chain (CLI arg,
//     session overrides) applied, since a generator has no invocation
//     context to resolve against. A project that sets autonomy only via a
//     mechanism other than this flat key (none exists today) is invisible.
//   - Three dimensions only, each checked the same mechanical way: does
//     `.claude/settings.json`'s `permissions.deny` list contain at least one
//     pattern recognizable as covering that dimension? This is a presence
//     check, not a correctness check — a deny entry that looks relevant but
//     has a typo, wrong glob, or is shadowed by a broader `allow` entry is
//     invisible to this generator; so is a deny rule expressed in
//     `settings.local.json` instead of the committed file.
//   - No `.claude-tweaks/policy.yml` at all means the project does not use
//     claude-tweaks dispatch — not applicable, zero candidates (a negative
//     fixture, never silently treated as "clean").
//   - `autonomy` present but not an elevated value (`unattended`/`trusted`)
//     means a human is already in the loop for every action — zero
//     candidates, not a lower-severity finding; this vertical only fires
//     once a project has actually opted into unattended operation.

const fs = require('fs');
const path = require('path');
const { registerGenerator } = require('./focus-generators');

// Autonomy values at which an agent acts without a human confirming each
// step — the only values this vertical fires for (`_shared/autonomy-ceiling.md`).
const AUTONOMY_ELEVATED = new Set(['trusted', 'unattended']);

const REGISTRY_PATTERNS = [
  /\bnpm\s+publish\b/,
  /\bnpm\s+login\b/,
  /\bnpm\s+adduser\b/,
  /\bnpm\s+config\s+set\s+registry\b/,
  /\byarn\s+publish\b/,
  /\bpnpm\s+publish\b/,
  /\btwine\s+upload\b/,
  /\bpip\s+install\s+--index-url\b/,
  /\bgem\s+push\b/,
];

const NETWORK_PATTERNS = [/\bWebFetch\b/, /\bcurl\b/, /\bwget\b/];

const CREDENTIAL_PATH_PATTERNS = [
  /\.env(\.|$)/,
  /\bcredentials?\b/i,
  /\bid_rsa\b/,
  /\.pem\b/,
  /\.netrc\b/,
  /\.aws\b/,
  /\bsecrets?\b/i,
  /\.ssh\b/,
];

// One row per audited dimension: the candidate `kind`, the deny-list
// patterns that count as covering it, and the evidence phrase naming the gap.
const DIMENSIONS = [
  {
    kind: 'registry-access',
    patterns: REGISTRY_PATTERNS,
    gap: 'covering package-registry-mutating commands (npm publish/login/adduser, etc.)',
  },
  {
    kind: 'network-egress',
    patterns: NETWORK_PATTERNS,
    gap: 'restricting WebFetch/curl/wget',
  },
  {
    kind: 'credential-scope',
    patterns: CREDENTIAL_PATH_PATTERNS,
    gap: 'protecting secret-shaped paths (.env, credentials, id_rsa, .pem, .aws, .ssh, etc.)',
  },
];

const SETTINGS_REL = '.claude/settings.json';
const POLICY_REL = '.claude-tweaks/policy.yml';

function readAutonomy(policyText) {
  const m = policyText.match(/^autonomy:\s*["']?([a-z-]+)["']?\s*$/m);
  return m ? m[1] : null;
}

function denyListText(settings) {
  const deny = settings && settings.permissions && Array.isArray(settings.permissions.deny)
    ? settings.permissions.deny
    : [];
  return deny.join('\n');
}

function matchesAny(patterns, text) {
  return patterns.some((re) => re.test(text));
}

// The rich-shape scan — registered under 'agent-trust-scope' in
// FOCUS_GENERATORS. No policy-driven pattern configuration (unlike
// experiment-cleanup) — the three dimension patterns above are shipped
// defaults, not project-configurable, since they name command/path shapes
// generic to the tool ecosystem rather than a project-specific idiom.
function scanAgentTrustScope(rootDir) {
  const policyPath = path.join(rootDir, POLICY_REL);

  if (!fs.existsSync(policyPath)) {
    return {
      candidates: [],
      scannedFiles: 0,
      skippedFiles: [],
      discoveryFailed: false,
      notApplicable: true,
      notApplicableReason: 'no .claude-tweaks/policy.yml — project does not use claude-tweaks dispatch',
    };
  }

  let policyText;
  try {
    policyText = fs.readFileSync(policyPath, 'utf8');
  } catch {
    return {
      candidates: [],
      scannedFiles: 0,
      skippedFiles: [{ file: POLICY_REL, reason: 'unreadable' }],
      discoveryFailed: true,
      discoveryReason: `unreadable: ${POLICY_REL}`,
    };
  }

  const scannedFiles = [POLICY_REL];
  const skippedFiles = [];
  const autonomy = readAutonomy(policyText);

  let settings = null;
  const settingsPath = path.join(rootDir, SETTINGS_REL);
  if (fs.existsSync(settingsPath)) {
    try {
      settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      scannedFiles.push(SETTINGS_REL);
    } catch {
      skippedFiles.push({ file: SETTINGS_REL, reason: 'unparseable-json' });
    }
  }

  const candidates = [];

  if (AUTONOMY_ELEVATED.has(autonomy)) {
    const denyText = denyListText(settings);
    // Anchor to settings.json when it was parsed (even with an empty/absent
    // deny list) — it's the file a fix actually lands in. Fall back to the
    // policy file when settings.json is missing or unparseable, so the anchor
    // is always a real, already-scanned file (code-health anchor rule).
    const anchorFile = settings !== null ? SETTINGS_REL : POLICY_REL;

    for (const { kind, patterns, gap } of DIMENSIONS) {
      if (!matchesAny(patterns, denyText)) {
        candidates.push({
          file: anchorFile,
          kind,
          evidence: `autonomy: ${autonomy} (${POLICY_REL}) with no permissions.deny entry in ${SETTINGS_REL} ${gap}`,
        });
      }
    }
  }

  candidates.sort((a, b) => a.kind.localeCompare(b.kind));

  return {
    candidates,
    scannedFiles: scannedFiles.length,
    skippedFiles,
    discoveryFailed: false,
    notApplicable: false,
  };
}

// Spec-pinned Data/API Surface signature — a bare array, mirroring the
// sibling verticals' direct entry point for unit tests / a future
// non-focus-mode caller.
function candidatesAgentTrustScope(rootDir) {
  return scanAgentTrustScope(rootDir).candidates;
}

registerGenerator('agent-trust-scope', scanAgentTrustScope);

module.exports = {
  scanAgentTrustScope,
  candidatesAgentTrustScope,
  AUTONOMY_ELEVATED,
  REGISTRY_PATTERNS,
  NETWORK_PATTERNS,
  CREDENTIAL_PATH_PATTERNS,
  SETTINGS_REL,
  POLICY_REL,
};
