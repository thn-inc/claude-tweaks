# Criteria: Cloudflare WAF / Rate-Limiting Hardening (pre-launch, auth endpoints)

Standalone pre-launch checklist section (#2665) extending the security-hardening checklist
shipped by `#2624` (`_shared/criteria-security-hardening.md`, `bin/lib/code-health/candidates-security-hardening.js`,
merged in PR #2774 — `#2624` is no longer the "still-unbuilt" record earlier sibling records
(`#2657`, `#2663`) describe folding into; it has already shipped its own checklist section).

**Scope boundary vs `#2624`.** `#2624`'s three checks (client-bundle secrets, missing per-user
ownership predicates, unguarded AI-calling endpoints) are all judged from this repo's own source
text via a `code-health` focus-mode candidate generator. This section's three checks are judged
from the Cloudflare zone configuration *in front of* the app — a layer `#2624`'s file-scanning
generator never inspects and was never scoped to cover. The two never claim the same category, so
this section is **not** folded into `candidates-security-hardening.js`'s generator — it ships as
its own module, `bin/lib/cloudflare-hardening.js`, with its own tests
(`tests/bin-lib/cloudflare-hardening.test.js`). If `#2624`'s implementation is ever restructured to
cover non-repo-file configuration sources, this section is the natural fold-in candidate at that
point — until then, the two stand side by side, each cited independently, per the same
build-order convention `#2657`/`#2663` already established against `#2624` before it shipped.

**Related, not yet built as of this writing:** `#2657` (JWT algorithm-confusion checks) and
`#2663` (legal/compliance pre-launch questions) propose their own standalone sections against the
same pre-launch-security-checklist idea. None of the three checklist sections (this one, `#2657`'s,
`#2663`'s) currently share a parent skill or file — each stands alone, cross-referencing the
others by number, until a future record consolidates them under one checklist artifact.

## The claim this extends

Cloudflare sitting "in front of" an app is not itself a security control — rate limiting on auth
endpoints, bot management on high-value pages, and custom WAF rules for known attack patterns are
opt-in, not default. A checklist item that only confirms "Cloudflare is enabled" misses this
entirely; the three checks below exist specifically to distinguish blanket zone-level presence
from endpoint-specific hardening.

## What the checks need

`bin/lib/cloudflare-hardening.js`'s `auditCloudflareZone(zoneConfig)` takes an
already-fetched-or-assembled zone-configuration object:

```js
{
  rateLimitRules: [{ expression: '...', description: '...' }, ...],
  botManagement: { enabled: true } /* or { fightMode: true } / { fight_mode: true } */,
  waf: { customRules: [{ name: '...', description: '...' }, ...] },
}
```

Any of the three top-level fields may be omitted — a caller that could only fetch some of the
three still gets a `review` verdict on the rest, never a silent skip.

## Check 1: rate limiting on auth-path routes

**Verification mechanism — prefer API-based:** `GET /zones/{zone_id}/rulesets/phases/http_ratelimit/entrypoint`
lists the zone's rate-limiting rules; pass the `rules[].expression` values through as
`rateLimitRules` above.

**Manual-review fallback** (no Cloudflare API token configured — see Gotcha below):
> In the Cloudflare dashboard, go to Security > WAF > Rate limiting rules for this zone. Confirm
> at least one rule's match expression targets the login, signup, and password-reset paths
> specifically (e.g. `http.request.uri.path in {"/login" "/signup" "/password-reset"}`) — a rule
> that matches the whole zone with no path condition does not count.

**Pass/fail/review logic** (`checkAuthRateLimiting`): a rule with no path-specific literal in its
match expression (a blanket zone-level rule, or none configured at all) fails — it is exactly the
"Cloudflare is in front of it" non-signal this checklist exists to reject. A rule (or set of rules)
whose match expression names all three auth-path categories specifically passes. A broad wildcard
path (`/*`) or an unrecognized expression shape is neither confidently passed nor failed — it's
flagged `review`, per the judgment-call Gotcha below.

## Check 2: bot management on high-value pages

**Verification mechanism — prefer API-based:** `GET /zones/{zone_id}/bot_management` (full Bot
Management, paid plans) or `GET /zones/{zone_id}/settings/bot_fight_mode` (free-tier Bot Fight
Mode); pass the result as `botManagement` above.

**Manual-review fallback:**
> In the Cloudflare dashboard, go to Security > Bots for this zone. Confirm Bot Fight Mode (or,
> on a paid plan, full Bot Management) is enabled — not just present as an available feature.

**Pass/fail/review logic** (`checkBotManagement`): disabled fails. Enabled (either Bot Fight Mode
or full Bot Management) passes. Settings unavailable (no read at all, e.g. no API token and no
manual check recorded yet) is `review`, never a silent pass — an unread setting must never be
reported as satisfied.

## Check 3: custom WAF rules for known attack signatures

**Verification mechanism — prefer API-based:** `GET /zones/{zone_id}/rulesets/phases/http_request_firewall_custom/entrypoint`
lists the zone's custom WAF rules; pass `rules` as `waf.customRules` above.

**Manual-review fallback:**
> In the Cloudflare dashboard, go to Security > WAF > Custom rules for this zone. Confirm at least
> one custom rule exists targeting a named attack pattern relevant to this app's stack — relying
> only on the default managed ruleset does not satisfy this check.

**Pass/fail/review logic** (`checkWafCustomRules`): no custom rules (default managed ruleset only)
fails. At least one custom rule carrying a `name`/`description` (i.e., actually naming what it
targets) passes. A custom rule present but unnamed/undescribed is `review` — its existence alone
doesn't confirm it targets a *known attack signature* rather than something incidental.

## Gotchas

- **No API token configured is never a silent pass.** `checkBotManagement`/`checkWafCustomRules`
  return `review` (not `pass`) when their input is missing, and `checkAuthRateLimiting` returns
  `fail` on zero rules rather than assuming a token-less caller means "nothing to check." A caller
  driving these checks from the Cloudflare API must state the token prerequisite explicitly in
  whatever surface reports the result, rather than reporting a false pass when the token is absent.
- **"Rate limiting configured on auth endpoints" is a judgment call.** An exact-path match
  (`eq "/login"`) is unambiguous; a broader pattern that happens to include auth paths
  (`http.request.uri.path matches ".*"`, a wildcard `/*`) is not confidently one or the other —
  `checkAuthRateLimiting` reports `review` for these rather than guessing pass or fail.
- **This is not a "is Cloudflare enabled" check.** Every check here is scoped to a specific,
  endpoint-relevant configuration signal (an auth-path match expression, a bot-management toggle,
  a named custom rule) — zone-level presence alone never satisfies any of the three.

## What this vertical never does

These checks only classify an already-read (or manually inspected) zone configuration — they never
call the Cloudflare API themselves, never modify a zone's rules, and never file a work record
automatically. A finding here is an input to the pre-launch checklist a human is working through,
the same posture `_shared/criteria-security-hardening.md`'s own "What this vertical never does"
section states for `#2624`'s checks.
