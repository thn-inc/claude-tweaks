// bin/lib/design-detect/index.js — deterministic re-implementation of
// design-wrapper's Layers 1-3 + track resolution (SKILL.md's "Universal
// preconditions" Step 1). Prose statement of record stays in
// skills/design-wrapper/SKILL.md and frontend-detection.md; this module is
// their code twin, the same pattern bin/lib/merge-verification.js follows
// for the merge-verification ladder. Pure functions only — no fs/gh/network
// calls except the two *FromFile convenience wrappers, which the CLI alone
// uses; every decision function takes already-resolved values so tests never
// need a real CLAUDE.md or a real Impeccable install.
'use strict';
const fs = require('fs');
const path = require('path');

// Skip-reason strings are the wire contract every caller of design-detect.js
// (and, before this extraction, every prose reader of SKILL.md) matches on
// verbatim — never paraphrase these once a consumer ships against them.
const SKIP_REASONS = {
  DISABLED: 'design integration disabled',
  MISSING: 'design integration not configured (run /claude-tweaks:init to enable)',
  NON_FRONTEND_SURFACE: 'non-frontend spec (surface declared)',
  NON_FRONTEND_SNIFF: 'non-frontend (sniff)',
  TEST_NATIVE: 'native surface — CLI detector is web-only',
  LIVE_NATIVE: 'native surface — live mode is web-only',
};

// Per-mode layer applicability — SKILL.md's "Universal preconditions"
// mode-specific notes. `layer2`/`layer3` false means structurally
// inapplicable (doctor/explore: no spec input, no file list — not merely
// skipped). `layer2: 'if-resolvable'` (survey) means the caller decides by
// whether it passes a `surface` value at all; evaluate() treats an omitted
// surface identically to "not resolvable", so no special case is needed
// below beyond documenting the mode table entry.
const MODE_LAYERS = {
  test: { layer1: true, layer2: true, layer3: true },
  review: { layer1: true, layer2: true, layer3: true },
  shape: { layer1: true, layer2: false, layer3: true },
  'pre-build': { layer1: true, layer2: true, layer3: true },
  polish: { layer1: true, layer2: true, layer3: true },
  survey: { layer1: true, layer2: 'if-resolvable', layer3: true },
  live: { layer1: true, layer2: false, layer3: true },
  doctor: { layer1: true, layer2: false, layer3: false },
  explore: { layer1: true, layer2: false, layer3: false },
  'reset-recommendations': { layer1: false, layer2: false, layer3: false },
};

const FRONTEND_SURFACES = new Set(['web', 'mobile', 'desktop', 'terminal']);
const NATIVE_PLATFORMS = new Set(['ios', 'android', 'adaptive']);

const TRIGGER_EXTENSIONS = new Set([
  '.tsx', '.jsx', '.vue', '.svelte', '.html', '.css', '.scss', '.sass', '.less', '.astro', '.mdx',
]);
const TRIGGER_PATH_SEGMENTS = ['components', 'pages', 'app', 'routes', 'views', 'ui'];

// Next.js API route handlers render nothing, but they live under the same
// `app/`/`pages/` segments the trigger-path table above matches for
// app-router `page.ts`/`layout.ts` files (#1786). Excluded here, before the
// segment scan, so the `app`/`pages` segment rule never fires for
// `app/api/**/route.ts` or `pages/api/**` — an extension match (e.g. a
// `.tsx` file that happens to sit under `app/api/`) still wins, since this
// only gates the segment fallback, not TRIGGER_EXTENSIONS.
const API_ROUTE_SEGMENTS = /(^|\/)(app|pages)\/api\//;

function modeLayers(mode) {
  const entry = MODE_LAYERS[mode];
  if (!entry) throw new Error(`design-detect: unknown mode "${mode}"`);
  return entry;
}

// Layer 1 — CLAUDE.md `design-integration` kill-switch.
function layer1(designIntegrationValue) {
  if (designIntegrationValue === 'enabled' || designIntegrationValue === 'plugin-only') {
    return { proceed: true };
  }
  if (designIntegrationValue === 'disabled') return { proceed: false, reason: SKIP_REASONS.DISABLED };
  return { proceed: false, reason: SKIP_REASONS.MISSING }; // missing/null/unrecognized
}

// Scans CLAUDE.md text for a `## Design integration` section and its
// `design-integration:` key within that section's body (before the next
// `## ` heading). Returns the raw value, or null when the section or key is
// absent — layer1() treats null as "missing" per its own table.
function readDesignIntegrationFlag(claudeMdText) {
  if (typeof claudeMdText !== 'string' || !claudeMdText) return null;
  const lines = claudeMdText.split(/\r?\n/);
  let inSection = false;
  for (const line of lines) {
    if (/^##\s+Design integration\s*$/i.test(line)) { inSection = true; continue; }
    if (inSection && /^##\s+/.test(line)) break; // next section — stop scanning
    if (!inSection) continue;
    const m = /^design-integration\s*:\s*(\S+)\s*$/i.exec(line.trim());
    if (m) return m[1].toLowerCase();
  }
  return null;
}

function readDesignIntegrationFlagFromFile(repoRoot) {
  try {
    const text = fs.readFileSync(path.join(repoRoot, 'CLAUDE.md'), 'utf8');
    return readDesignIntegrationFlag(text);
  } catch {
    return null;
  }
}

// Layer 2 — the record's `Surface:` body-metadata line (already lifted into
// the materialized header by materialize.md — this function receives the
// value, never reads a spec file itself). Legacy `frontend` reads as `web`;
// `mixed` is retired and not accepted here (materialize.md requires
// re-shaping before a record with that value reaches this far).
function layer2(surfaceValue) {
  if (surfaceValue == null || surfaceValue === '') return { proceed: true, surface: null };
  const s = String(surfaceValue).toLowerCase();
  const normalized = s === 'frontend' ? 'web' : s;
  if (normalized === 'backend' || normalized === 'infra') {
    return { proceed: false, reason: SKIP_REASONS.NON_FRONTEND_SURFACE };
  }
  if (FRONTEND_SURFACES.has(normalized)) return { proceed: true, surface: normalized };
  return { proceed: true, surface: null }; // unrecognized value — fall through as missing
}

// Track resolution — SKILL.md's track table, between Layers 2 and 3. Runs
// for every mode that reaches this point (Layer 1 proceeded, Layer 2 did not
// hard-skip). `platform` is `signals.setup.platform` (web|ios|android|
// adaptive|null); `surface` is layer2()'s surface (web|mobile|desktop|
// terminal|null).
function resolveTrack({ platform = null, surface = null } = {}) {
  const p = platform || null;
  const s = surface || null;

  if (s === 'terminal') {
    const result = { track: 'terminal' };
    if (p != null) {
      result.surface_track_override = { platform: p, surface: 'terminal', winner: 'surface' };
    }
    return result;
  }

  const surfaceImplies = s === 'mobile' ? 'native' : 'web'; // desktop/web/missing all imply web

  if (p === 'web') {
    const result = { track: 'web' };
    if (surfaceImplies === 'native') {
      result.surface_track_override = { platform: 'web', surface: s, winner: 'platform' };
    }
    return result;
  }

  if (NATIVE_PLATFORMS.has(p)) {
    const result = { track: 'native', platform: p };
    if (s != null && surfaceImplies !== 'native') {
      result.surface_track_override = { platform: p, surface: s, winner: 'platform' };
    }
    return result;
  }

  // p === null
  if (surfaceImplies === 'native') return { track: 'native', platform: 'adaptive', inferred: true };
  return { track: 'web' };
}

// Layer 3 — file-extension/path sniff (frontend-detection.md). Web-only by
// construction: no native extension appears in either table.
function fileMatchesFrontendPredicate(filePath) {
  if (typeof filePath !== 'string' || !filePath) return false;
  const normalized = filePath.replace(/\\/g, '/');
  const ext = path.extname(normalized).toLowerCase();
  if (TRIGGER_EXTENSIONS.has(ext)) return true;
  if (API_ROUTE_SEGMENTS.test(normalized.toLowerCase())) return false;
  const segments = normalized.split('/').filter(Boolean);
  return segments.some((seg) => TRIGGER_PATH_SEGMENTS.includes(seg.toLowerCase()));
}

function layer3(files) {
  const list = Array.isArray(files) ? files : [];
  const matched = list.some(fileMatchesFrontendPredicate);
  if (matched) return { proceed: true };
  return { proceed: false, reason: SKIP_REASONS.NON_FRONTEND_SNIFF };
}

// Whether Layer 3 actually runs for a resolved track, per SKILL.md's
// "Layer 3 is a fallback only, and only when nothing was declared" table.
function layer3Applies({ track, surfaceDeclared }) {
  if (track === 'terminal') return false; // declared-only; no terminal trigger table
  if (track === 'native' && surfaceDeclared) return false; // web-only sniff can't rule on native code
  return true; // web track (always), or native track with no Surface: declared
}

// evaluate() — the single entry point. Orchestrates Layer 1 -> Layer 2 ->
// track resolution -> mode-level native skip (test/live) -> Layer 3, per
// mode applicability, and returns the wrapper's decision shape:
//   { track, decision: 'proceed' | 'skip', reason?, surface_track_override? }
// `track` is present even on a skip when track resolution ran before the
// skip fired (Layer 3's skip, and the mode-level native skips) — absent
// when Layer 1 or Layer 2 skipped first, since track resolution never runs
// in that case.
function evaluate({ mode, designIntegrationValue, surface, platform, files } = {}) {
  const layers = modeLayers(mode);

  if (!layers.layer1 && !layers.layer2 && !layers.layer3) {
    // reset-recommendations: no preconditions at all.
    return { decision: 'proceed' };
  }

  const l1 = layer1(designIntegrationValue);
  if (!l1.proceed) return { decision: 'skip', reason: l1.reason };

  let surfaceValue = null;
  let surfaceDeclared = false;
  if (layers.layer2) {
    const l2 = layer2(surface);
    if (!l2.proceed) return { decision: 'skip', reason: l2.reason };
    surfaceValue = l2.surface;
    surfaceDeclared = surfaceValue != null;
  }
  // layers.layer2 === false (doctor/explore/live/shape): no Surface: read at
  // all — surfaceValue stays null, exactly as "resolves its track with no
  // Surface: value" states.

  const { track, platform: resolvedPlatform, inferred, surface_track_override: override } = resolveTrack({ platform, surface: surfaceValue });
  // Every outcome from here on carries the full track-resolution result
  // (track, platform when native, inferred when the adaptive row fired, and
  // any recorded disagreement) — a caller reading a skip must see the same
  // track shape as a proceed, since track resolution already ran either way.
  const trackFields = {
    track,
    ...(resolvedPlatform ? { platform: resolvedPlatform } : {}),
    ...(inferred ? { inferred } : {}),
    ...(override ? { surface_track_override: override } : {}),
  };

  if (mode === 'test' && track === 'native') {
    return { decision: 'skip', reason: SKIP_REASONS.TEST_NATIVE, ...trackFields };
  }
  if (mode === 'live' && track === 'native') {
    return { decision: 'skip', reason: SKIP_REASONS.LIVE_NATIVE, ...trackFields };
  }

  if (!layers.layer3 || !layer3Applies({ track, surfaceDeclared })) {
    return { decision: 'proceed', ...trackFields };
  }

  const l3 = layer3(files);
  if (!l3.proceed) {
    return { decision: 'skip', reason: l3.reason, ...trackFields };
  }
  return { decision: 'proceed', ...trackFields };
}

module.exports = {
  SKIP_REASONS,
  MODE_LAYERS,
  modeLayers,
  layer1,
  readDesignIntegrationFlag,
  readDesignIntegrationFlagFromFile,
  layer2,
  resolveTrack,
  fileMatchesFrontendPredicate,
  layer3,
  layer3Applies,
  evaluate,
};
