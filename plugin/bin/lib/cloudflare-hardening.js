'use strict';

// cloudflare-hardening.js — pre-launch Cloudflare WAF/rate-limiting hardening
// checks for auth endpoints (#2665), extending the pre-launch security
// hardening checklist landed by #2624 (`_shared/criteria-security-hardening.md`,
// `code-health/candidates-security-hardening.js`, both now shipped).
//
// Deliberately NOT wired into code-health's focus-mode generator registry
// (`code-health/focus-generators.js`): that registry's contract is repo-file
// scanning — a deterministic candidate generator over this repo's own
// tracked source files (`listTrackedSourceFiles`). A Cloudflare zone's
// rate-limiting rules, bot-management settings, and WAF custom rules live in
// Cloudflare's own account/API state, never in this repo's working tree, so
// there is nothing here for that file-scanning contract to discover. This
// module instead exports pure classifier functions over an
// already-fetched-or-assembled zone-configuration object; the caller is
// responsible for producing that object, either via the Cloudflare REST API
// (see "API-based check" below) or by hand for the manual-review fallback.
//
// Scope boundary vs #2624 (`criteria-security-hardening.md`'s own "Scope
// boundary" section documents that file's three checks the same way): #2624's
// checks (client-bundle secrets, missing per-user ownership predicates,
// unguarded AI-calling endpoints) are all judged from this repo's own source
// text. This vertical's three checks (auth-path rate limiting, bot
// management, WAF custom rules) are judged from the edge/CDN configuration
// *in front of* the app — a layer #2624 never inspects. Cloudflare sitting
// "in front of" an app is not itself a security control (the source claim
// this record extends, per #2665's Current State) — the checks below exist
// specifically to distinguish blanket zone-level presence from
// endpoint-specific hardening, never collapsing back into a blanket
// "is Cloudflare enabled" check.
//
// API-based check (preferred, deliverable 4 of #2665): a Cloudflare API
// token with read access to the zone's rulesets/settings can list these
// directly —
//   - rate-limiting rules:  GET /zones/{zone_id}/rulesets/phases/http_ratelimit/entrypoint
//   - bot management:       GET /zones/{zone_id}/bot_management
//                            (or, Bot Fight Mode only: GET /zones/{zone_id}/settings/bot_fight_mode)
//   - WAF custom rules:     GET /zones/{zone_id}/rulesets/phases/http_request_firewall_custom/entrypoint
// Shape the response into the `rateLimitRules` / `botManagement` / `waf`
// inputs below and pass to `auditCloudflareZone`. No token configured, or the
// API unreachable: MANUAL_REVIEW_PROMPTS below names exactly what to look
// for in the Cloudflare dashboard instead — never silently report a pass
// because the API read was skipped (#2665's own Gotchas).

// Auth-path keywords a rate-limiting rule's match expression must target
// specifically — login, signup, and password-reset (or an equivalent
// spelling), per #2665's Deliverable 1.
const AUTH_PATH_KEYWORDS = [
  { name: 'login', re: /login/i },
  { name: 'signup', re: /sign[-_]?up/i },
  { name: 'password-reset', re: /(password[-_]?reset|reset[-_]?password)/i },
];

// A match expression that, once any quoted path literal is stripped out,
// reduces to one of these is a blanket zone-level rule — "matches
// everything", not "matches nothing recognized". Anything else with no
// extractable path literal is an unrecognized shape, not a confirmed
// blanket — flagged for review below rather than assumed either way.
const BLANKET_EXPRESSION_RE = /^(true|\*|\.\*)?$/;

function extractQuotedPaths(expression) {
  if (typeof expression !== 'string') return [];
  const out = [];
  const re = /"([^"]*)"/g;
  let m;
  while ((m = re.exec(expression))) {
    if (m[1].startsWith('/')) out.push(m[1]);
  }
  return out;
}

function classifyAuthCoverage(paths) {
  const covered = new Set();
  let hasBroadWildcard = false;
  for (const p of paths) {
    if (p === '/' || p === '/*' || p.includes('*')) {
      hasBroadWildcard = true;
    }
    for (const { name, re } of AUTH_PATH_KEYWORDS) {
      if (re.test(p)) covered.add(name);
    }
  }
  return { covered, hasBroadWildcard };
}

/**
 * Check 1 (deliverable 1): rate limiting specifically covering auth-path
 * routes (login, signup, password-reset) — not merely a blanket zone-level
 * rate limit that doesn't distinguish auth endpoints from the rest of the
 * app.
 *
 * @param {Array<{expression?: string, description?: string}>} rules
 * @returns {{check: string, status: 'pass'|'fail'|'review', message: string}}
 */
function checkAuthRateLimiting(rules) {
  const check = 'rate-limiting-auth-endpoints';
  if (!Array.isArray(rules) || rules.length === 0) {
    return {
      check,
      status: 'fail',
      message: 'No rate-limiting rules configured — auth endpoints (login/signup/password-reset) are unprotected.',
    };
  }

  const covered = new Set();
  let anyAmbiguous = false;
  let anyPathSpecific = false;

  for (const rule of rules) {
    const expr = (rule && typeof rule.expression === 'string') ? rule.expression : '';
    const paths = extractQuotedPaths(expr);
    if (paths.length === 0) {
      if (!BLANKET_EXPRESSION_RE.test(expr.trim())) {
        // Not empty/true/*, and no quoted path literal we recognize — an
        // expression shape this heuristic can't classify either way.
        anyAmbiguous = true;
      }
      continue;
    }
    anyPathSpecific = true;
    const { covered: ruleCovered, hasBroadWildcard } = classifyAuthCoverage(paths);
    for (const c of ruleCovered) covered.add(c);
    if (hasBroadWildcard) anyAmbiguous = true;
  }

  const missing = AUTH_PATH_KEYWORDS.filter(({ name }) => !covered.has(name)).map(({ name }) => name);

  if (missing.length === 0) {
    return { check, status: 'pass', message: `Auth endpoints specifically covered: ${[...covered].join(', ')}.` };
  }
  if (covered.size > 0) {
    return {
      check,
      status: anyAmbiguous ? 'review' : 'fail',
      message: `Only partial auth-path coverage (${[...covered].join(', ')}) — missing: ${missing.join(', ')}.`,
    };
  }
  if (anyAmbiguous) {
    return {
      check,
      status: 'review',
      message: 'Rate-limiting rule(s) use a broad or unrecognized match expression — could not confirm whether auth endpoints are specifically covered; needs human review.',
    };
  }
  if (anyPathSpecific) {
    return {
      check,
      status: 'fail',
      message: 'No rate-limiting rule targets auth endpoints (login/signup/password-reset) specifically.',
    };
  }
  return {
    check,
    status: 'fail',
    message: 'Rate-limiting rule(s) are scoped at the zone level with no path-specific match — auth endpoints are not specifically covered.',
  };
}

/**
 * Check 2 (deliverable 2): bot management (or, at minimum, Bot Fight Mode)
 * enabled on high-value pages.
 *
 * @param {{enabled?: boolean, fightMode?: boolean, fight_mode?: boolean}|null|undefined} settings
 * @returns {{check: string, status: 'pass'|'fail'|'review', message: string}}
 */
function checkBotManagement(settings) {
  const check = 'bot-management';
  if (!settings || typeof settings !== 'object') {
    return {
      check,
      status: 'review',
      message: 'Bot management settings unavailable — verify manually whether Bot Fight Mode or full bot management is enabled (Cloudflare dashboard: Security > Bots).',
    };
  }
  const enabled = Boolean(settings.enabled || settings.fightMode || settings.fight_mode || settings.botFightMode);
  if (enabled) {
    return { check, status: 'pass', message: 'Bot management (or Bot Fight Mode) is enabled.' };
  }
  return {
    check,
    status: 'fail',
    message: 'Bot management and Bot Fight Mode are both disabled — high-value pages (checkout, account creation) are exposed to credential-stuffing and scraping traffic.',
  };
}

/**
 * Check 3 (deliverable 3): custom WAF rules exist for known attack
 * signatures relevant to the app's stack, rather than relying solely on
 * Cloudflare's default managed rules.
 *
 * @param {{customRules?: Array<{name?: string, description?: string}>}|null|undefined} waf
 * @returns {{check: string, status: 'pass'|'fail'|'review', message: string}}
 */
function checkWafCustomRules(waf) {
  const check = 'waf-custom-rules';
  if (!waf || typeof waf !== 'object') {
    return {
      check,
      status: 'review',
      message: "WAF configuration unavailable — verify manually whether custom rules exist beyond Cloudflare's default managed ruleset (dashboard: Security > WAF > Custom rules).",
    };
  }
  const customRules = Array.isArray(waf.customRules) ? waf.customRules : [];
  const named = customRules.filter((r) => r && (r.description || r.name));
  if (named.length > 0) {
    return { check, status: 'pass', message: `${named.length} custom WAF rule(s) target named attack pattern(s).` };
  }
  if (customRules.length > 0) {
    return {
      check,
      status: 'review',
      message: 'Custom WAF rule(s) exist but none name a specific attack pattern — needs human review.',
    };
  }
  return {
    check,
    status: 'fail',
    message: "No custom WAF rules configured — relying solely on Cloudflare's default managed ruleset.",
  };
}

/**
 * Runs all three checks against a zone-configuration object. Each field is
 * independent and optional — a caller that could only fetch (or manually
 * assemble) some of the three still gets a `review` verdict on the rest
 * rather than a silent skip.
 *
 * @param {{rateLimitRules?: Array, botManagement?: object, waf?: object}} zoneConfig
 */
function auditCloudflareZone(zoneConfig) {
  const cfg = zoneConfig || {};
  return [
    checkAuthRateLimiting(cfg.rateLimitRules),
    checkBotManagement(cfg.botManagement),
    checkWafCustomRules(cfg.waf),
  ];
}

// Manual-review fallback (deliverable 4) — one copy-paste-able prompt per
// check, for when no Cloudflare API token is configured to run the
// API-based check above. Naming exactly what to look for in the dashboard,
// per #2665's own Gotchas ("the check's documentation should state this
// prerequisite explicitly rather than silently failing or reporting a false
// pass when no token is configured").
const MANUAL_REVIEW_PROMPTS = {
  'rate-limiting-auth-endpoints':
    'In the Cloudflare dashboard, go to Security > WAF > Rate limiting rules for this zone. ' +
    'Confirm at least one rule\'s match expression targets the login, signup, and password-reset ' +
    'paths specifically (e.g. `http.request.uri.path in {"/login" "/signup" "/password-reset"}`) — ' +
    'a rule that matches the whole zone with no path condition does not count.',
  'bot-management':
    'In the Cloudflare dashboard, go to Security > Bots for this zone. Confirm Bot Fight Mode ' +
    '(or, on a paid plan, full Bot Management) is enabled — not just present as an available feature.',
  'waf-custom-rules':
    'In the Cloudflare dashboard, go to Security > WAF > Custom rules for this zone. Confirm at ' +
    'least one custom rule exists targeting a named attack pattern relevant to this app\'s stack — ' +
    "relying only on the default managed ruleset does not satisfy this check.",
};

module.exports = {
  checkAuthRateLimiting,
  checkBotManagement,
  checkWafCustomRules,
  auditCloudflareZone,
  MANUAL_REVIEW_PROMPTS,
  AUTH_PATH_KEYWORDS,
};
