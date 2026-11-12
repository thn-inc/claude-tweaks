// plugin/bin/lib/ci-health/billing.js — the Actions budget headroom half of
// /claude-tweaks:harness-health's CI health check (#5161): owner-type-routed GitHub billing reads
// behind an injected `runner(args, opts)`, and the pure `headroomFrom`.
//
// Never logs or returns an amount — only the headroom percentage. Reasons name a field or a status,
// and an unparseable body gets a fixed reason (a JSON SyntaxError message can quote body text).
// The legacy `orgs/{org}/settings/billing/actions` (410) is never called.
//
// Routing on Task 3's readRepo result: an unreadable owner type makes no call (gh absence included;
// it renders from the runs half's `ghAbsent`); `Organization` reads budgets, then the usage summary,
// stopping at the first failure; `User` reads the user usage endpoint, whose 200 only proves
// readability — it exposes no budget, so headroom is always null there. Each read is
// `gh api --method GET <path>` with { timeout: CI_HEALTH_GH_TIMEOUT_MS }; the path starts with a
// literal segment and the login comes from GitHub's own repo response.
//
// A billing read that finds gh gone (ENOENT) adds no failure row only when the caller passes the
// runs half's `ghAbsent: true` (gh absent from the start: the render's `billing unavailable (gh
// absent)` line covers it). With gh vanishing after runs page 1, `ghAbsent` is false, so the read is
// a failed query like any other and is named in `failures[]`.
//
// An Actions budget is a `budgets[]` entry whose `budget_product_sku` lower-cases to `actions` and
// whose `budget_scope` is `organization`; SKU-level (`actions_linux`) and repository- or
// cost-center-scoped budgets are not. Spend is the sum of `netAmount` over `usageItems[]` whose
// `product` lower-cases to `actions`. A needed field absent or not a finite number gives
// `headroomPct: null` and a reason naming it, never a guess.
'use strict';

const { CI_HEALTH_GH_TIMEOUT_MS } = require('./constants');
const { errorText, httpStatusOf, isGhAbsent } = require('./fetch');
// The envelope, the render and the headroom floor compare all read this one 2-dp value, rounded
// like stats.js's trend ratio.
const { round2 } = require('./stats');

const NO_BUDGET = 'no Actions budget to compare';
const STATUS_REASONS = new Set([403, 404, 410]);

const isActions = (value) => typeof value === 'string' && value.toLowerCase() === 'actions';
const isNum = (value) => typeof value === 'number' && Number.isFinite(value);

function headroomFrom(budgetsJson, summaryJson) {
  const firstPageOnly = Boolean(budgetsJson) && budgetsJson.has_next_page === true;
  const none = (reason) => ({ headroomPct: null, reason, firstPageOnly });
  const list = budgetsJson && budgetsJson.budgets;
  if (!Array.isArray(list)) return none('budgets response has no budgets array');
  const actionsBudgets = list.filter((b) => b && isActions(b.budget_product_sku) && b.budget_scope === 'organization');
  if (actionsBudgets.some((b) => !isNum(b.budget_amount))) return none('an Actions budget has no numeric budget_amount');
  const amounts = actionsBudgets.map((b) => b.budget_amount).filter((a) => a > 0);
  if (amounts.length === 0) return none(NO_BUDGET);
  const items = summaryJson && summaryJson.usageItems;
  if (!Array.isArray(items)) return none('usage summary has no usageItems array');
  const actionsItems = items.filter((i) => i && isActions(i.product));
  if (actionsItems.some((i) => !isNum(i.netAmount))) return none('an Actions usage item has no numeric netAmount');
  const spend = actionsItems.reduce((sum, i) => sum + i.netAmount, 0);
  const headroomPct = round2(Math.min(...amounts.map((budget) => ((budget - spend) / budget) * 100)));
  return { headroomPct, reason: null, firstPageOnly };
}

// One GET read: {ok: true, body} or {ok: false, billing, failure}; failure is null only when gh is
// absent and `ghAbsent` (the runs half's) says so, since that absence renders from `ghAbsent`.
function readOne(query, apiPath, runner, ghAbsent) {
  let out;
  try {
    out = runner(['api', '--method', 'GET', apiPath], { timeout: CI_HEALTH_GH_TIMEOUT_MS });
  } catch (err) {
    const status = httpStatusOf(err);
    const error = errorText(err);
    return {
      ok: false,
      billing: { available: false, status, reason: STATUS_REASONS.has(status) ? `HTTP ${status}` : error },
      failure: ghAbsent && isGhAbsent(err) ? null : { query, status, error },
    };
  }
  try {
    return { ok: true, body: typeof out === 'string' ? JSON.parse(out) : out };
  } catch {
    const error = `${apiPath}: response is not valid JSON`;
    return { ok: false, billing: { available: false, status: null, reason: error }, failure: { query, status: null, error } };
  }
}

function unavailable(r) {
  return { billing: r.billing, failures: r.failure ? [r.failure] : [] };
}

// `ghAbsent` is the runs half's (fetchRuns's) flag; absent or false, every failed read is named.
function readBilling({ repoRead, ghAbsent = false }, { runner }) {
  if (!repoRead || repoRead.ok !== true) {
    return { billing: { available: false, status: null, reason: 'owner type unreadable' }, failures: [] };
  }
  const login = repoRead.ownerLogin;
  if (repoRead.ownerType === 'User') {
    const usage = readOne('billing usage', `users/${login}/settings/billing/usage`, runner, ghAbsent);
    if (!usage.ok) return unavailable(usage);
    return { billing: { available: true, scope: 'user', headroomPct: null, reason: NO_BUDGET }, failures: [] };
  }
  if (repoRead.ownerType !== 'Organization') {
    return { billing: { available: false, status: null, reason: 'unsupported owner type' }, failures: [] };
  }
  const budgets = readOne('billing budgets', `organizations/${login}/settings/billing/budgets`, runner, ghAbsent);
  if (!budgets.ok) return unavailable(budgets);
  const summary = readOne('billing usage summary', `organizations/${login}/settings/billing/usage/summary`, runner, ghAbsent);
  if (!summary.ok) return unavailable(summary);
  const { headroomPct, reason, firstPageOnly } = headroomFrom(budgets.body, summary.body);
  const billing = { available: true, scope: 'org', headroomPct };
  if (reason !== null) billing.reason = reason;
  if (firstPageOnly) billing.firstPageOnly = true;
  return { billing, failures: [] };
}

module.exports = { NO_BUDGET, headroomFrom, readBilling };
