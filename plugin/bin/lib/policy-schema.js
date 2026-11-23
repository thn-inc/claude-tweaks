// bin/lib/policy-schema.js — canonical data + deterministic validator for every
// project-config lever documented in skills/_shared/policy-schema.md. If the two
// disagree, one of them has a bug — fix, don't fork.
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { PROFILES } = require('./model-profiles/profiles');
const { stripComment, mergeBlockRows } = require('./model-profiles/policy-fragment');
const { parseRiskPathGlobs } = require('./risk-path-globs');
const { locatePolicyFile } = require('./policy-file');
const { DEFER_REASONS } = require('./issues/record-payload');

const { DRIVER_ROLE_PROFILES, POLICY_DRIVER_ROLES } = require('./driver/roles');

const PROFILE_NAMES = Object.keys(PROFILES);

// express-driver-models (#5917): the four policy-settable driver roles' shipped profiles. `explorer` is not
// here: its `standard` default lives only in roles.js's DRIVER_ROLE_PROFILES.
const POLICY_DRIVER_DEFAULTS = Object.freeze(Object.fromEntries(POLICY_DRIVER_ROLES.map((role) => [role, DRIVER_ROLE_PROFILES[role]])));

const POLICY_CATEGORIES = ['autonomy-trust', 'pipeline-behavior', 'merge-safety', 'health-sweeps', 'models', 'housekeeping'];

// Control mode (#4609). The four built-in invisible-risk category slugs, verbatim;
// `risk-categories` entries are additional slugs beside these.
const BUILTIN_RISK_CATEGORIES = ['migrations', 'auth', 'public-contract', 'irreversible-side-effect'];

// A `list` row's optional `element` names the rule every comma-separated entry
// must match (isValidValue): a login, a slug, a defer-reason, or a glob. A list row with
// no `element` accepts any text.
const LIST_ELEMENT_PATTERNS = {
  login: /^[A-Za-z0-9][A-Za-z0-9_-]*(\[bot\])?$/, // a GitHub user/org login, bot logins included
  slug: /^[a-z0-9][a-z0-9-]*$/,
  'defer-reason': new RegExp(`^(?:${DEFER_REASONS.join('|')})$`), // a Defer-reason: value (#5932), built from DEFER_REASONS so the two never drift
  glob: /^[^\s"'[\]{}?\\]+$/, // a path glob (#6020): refuses whitespace, quotes, brackets, braces, `?` and a backslash, so a YAML-flow or shell-quoted spelling never becomes one literal glob that protects nothing
};

// The explicit empty list on a list row with `emptyList: true` (#5932). A blank
// value reads as unset (parseFlatLines), so `[]` is the only way a run config can
// override a configured list with nothing. console-resolve.js's base-branch reader
// imports it.
const EMPTY_LIST_RE = /^\[\s*\]$/;

// A `string` row's optional `pattern` the whole value must also match. The
// authority holds no `@`: policy.yml is committed, so a URL never carries a credential.
const HTTP_URL = /^https?:\/\/[^\s/?#@]+(?:[/?#]\S*)?$/;

// A `type: 'boolean'` entry's value — in policy.yml examples, routing-table prose, and
// tests — must use the literal strings 'true'/'false', never 'on'/'off': resolveValue()
// below does a strict string match and silently falls back to the entry's `default` on
// any other spelling (#660 caught this on review, before merge, for a first-draft lever
// documented with on/off wording that isValidValue() would have rejected).
const POLICY_KEYS = [
  { key: 'worktree-always', type: 'boolean', default: false, summary: "Every covered edit and commit must happen inside a linked worktree — the hook denies it elsewhere.", category: 'pipeline-behavior', tier: 'core' },
  // One key, two value classes since #331: plain 'subagent'/'batched' are
  // overridable defaults; the '-only' forms carry the full lock semantics the
  // retired execution.always key used to hold (a lock beats an explicit CLI
  // argument). RENAMED_KEYS migrates stray execution.always lines.
  { key: 'execution-strategy', type: 'enum', values: ['subagent', 'batched', 'subagent-only', 'batched-only'], default: 'subagent', summary: "Sets whether build defaults to subagent or batched execution, and can lock that choice against override.", category: 'pipeline-behavior', tier: 'core' },
  { key: 'git-strategy', type: 'enum', values: ['current-branch', 'worktree'], default: 'worktree', summary: "Sets whether new work defaults to an isolated worktree/working directory or continues on the current branch.", category: 'pipeline-behavior', tier: 'core' },
  { key: 'project-maturity', type: 'enum', values: ['greenfield', 'pre-launch', 'early-production', 'established'], default: 'greenfield', summary: "Scales how strict test discipline and task breakdown are, from a greenfield project up to an established one.", category: 'pipeline-behavior', tier: 'core' },
  { key: 'integration-branch', type: 'string', summary: "Names the branch where finished work lands and new work starts, for a repo whose active branch is not its default.", category: 'merge-safety', tier: 'advanced' },
  // pr-first (origin is truth, GitHub PR integration) vs local-merge (today's
  // local merge into the integration branch — the permanent no-forge
  // fallback). Deliberately no static `default`: an absent value's default is
  // computed by bin/resolve-policy.js's detectIntegrationModel (forge
  // detection), not a schema literal — see skills/_shared/integration-model.md.
  { key: 'integration-model', type: 'enum', values: ['pr-first', 'local-merge'], summary: "Whether finished work lands through GitHub pull requests or by local merges into the integration branch.", category: 'merge-safety', tier: 'core' },
  // merge-verification (#559): how much CI verification a merge into the
  // integration branch requires. Like integration-model, deliberately no
  // static `default` — an absent value is derived by
  // bin/lib/merge-verification.js's four-branch ladder (stated once in
  // skills/_shared/policy-schema-coverage.md's coverage block), wired through
  // bin/resolve-policy.js. `wait` is explicit-config-only: the ladder never
  // derives it. Tier is `advanced` only because the core tier sits at its
  // enforced cap of 12 (tests/policy-schema-metadata.test.js); by the decision
  // rule it is core-shaped (a merge default).
  { key: 'merge-verification', type: 'enum', values: ['merge-when-green', 'wait', 'off'], summary: "Sets how much CI a merge waits for — merge once green, wait for checks, or off (a derived off still waits on and parks on reported checks).", category: 'merge-safety', tier: 'advanced' },
  // merge-authorization (#715): lets a human present at the run (the /flow
  // `pre-authorize-merge` token, #2734, or a Manifesto override) pre-authorize
  // "merge once every HARD-GATE is green" for this run only.
  // Deliberately excluded from the policy.yml source below (see the
  // `policySourceExcluded` special case in resolvePolicyKeys and the
  // matching auditPolicy() category, both generic on this flag rather than
  // hardcoded to this key — #839) — a project-wide standing default here
  // would remove the "a human decided, live, for this run" property that a
  // run never originates its own merge authorization depends on; see
  // _shared/auto-mode-contract.md's Merge authorization lever row.
  { key: 'merge-authorization', type: 'enum', values: ['ask', 'pre-authorized'], default: 'ask', policySourceExcluded: true, summary: "Lets a human pre-authorize, for one run, that it merges itself once every HARD-GATE is green — never a standing default.", category: 'merge-safety', tier: 'advanced' },
  { key: 'design-ceremony', type: 'enum', values: ['fast-lane', 'standard'], default: 'standard', summary: "Trims /specify's brainstorming handoff to fewer per-section approval stops once the design approach is chosen.", category: 'pipeline-behavior', tier: 'advanced' },
  // review-lens-dispatch (#5599): how /claude-tweaks:review Step 3 runs its lens reviewers — `task` (parallel Task dispatch) or `workflow` (one plugin workflow script, step3-workflow-dispatch.md). Neither policyOnly nor policySourceExcluded: Step 3 resolves it with --run, so a run config may set it for one review.
  // Removal condition: the `task` value and the key are removed, and `workflow` becomes the only primary path, one minor release after the default flips to `workflow`. The flip is its own record, filed when the parked measurement record (#5599 Deliverable 7) passes; the Task dispatch stays as the fallback for a host without the Workflow tool.
  { key: 'review-lens-dispatch', type: 'enum', values: ['task', 'workflow'], default: 'task', summary: "Picks how review runs its lens reviewers: parallel Task agents, or one plugin workflow script (opt-in, while it is measured).", category: 'pipeline-behavior', tier: 'advanced' },
  // review-lens-selection (#6001): which lenses /claude-tweaks:review Step 3 dispatches — `tier` (the tier's whole set, unchanged) or `adaptive` (the set bin/review-lens-select.js picks from the diff facts, per-lens history and skip streaks, step3-lens-selection.md). Neither policyOnly nor policySourceExcluded: Step 3 resolves it with --run, so a run config may set it for one review. Its reader ships in this same PR, so it carries no "Not yet used" marker.
  { key: 'review-lens-selection', type: 'enum', values: ['tier', 'adaptive'], default: 'tier', summary: "Picks whether review runs every lens its tier allows or only those the diff and lens history call for (opt-in).", category: 'pipeline-behavior', tier: 'advanced' },
  { key: 'dispatch-retry-ceiling', type: 'integer', default: 3, summary: "Sets how many consecutive autonomous build failures a record tolerates before it is flagged blocked and pulled from auto-pilot.", category: 'merge-safety', tier: 'advanced' },
  { key: 'dispatch-batch-size', type: 'integer', default: 3, summary: "Caps how many queued records one dispatch run works through in sequence before leaving the rest for next time.", category: 'merge-safety', tier: 'advanced' },
  // Deprecated alias for dispatch-batch-size (renamed in #295 — the value is a
  // sequential batch count, never a concurrency slot count). Still recognized so a
  // project's existing policy.yml validates; removal condition in
  // skills/dispatch/deprecated-aliases.md.
  { key: 'dispatch-pick-max-concurrent', type: 'integer', default: 3, summary: "Caps how many queued records one dispatch run works through in sequence — an older name for the same cap, kept for migration.", category: 'merge-safety', tier: 'advanced' },
  { key: 'dispatch-group-size-guard', type: 'integer', default: 10, summary: "Caps a dispatch group's size before bare-drain selection excludes it; since per-record grouping only a large fast-lane bundle can exceed it.", category: 'merge-safety', tier: 'advanced' },
  // #1910: merges up to this many non-overlapping ceremony:fast-lane
  // singleton groups into one multi-spec dispatch run, sharing one
  // preflight/wrap-up tail instead of paying it per record. 0 disables —
  // every record stays its own group, no bundling (bundleFastLaneSingletons's
  // own doc comment, bin/lib/issues/grouping.js).
  { key: 'dispatch-fastlane-bundle-cap', type: 'integer', default: 3, summary: "Caps how many non-overlapping ceremony:fast-lane singleton groups dispatch merges into one multi-spec run; 0 disables bundling.", category: 'merge-safety', tier: 'advanced' },
  // #4025: the express lane — opt-in, plus the post-merge review sampling cadence (skills/_shared/express-lane.md).
  { key: 'express-lane', type: 'boolean', default: false, summary: "Opts into the express lane: a small, low-risk singleton record builds, tests and merges-on-green in one agent, not the full /flow frame.", category: 'merge-safety', tier: 'advanced' },
  { key: 'express-review-sample-every', type: 'integer', min: 1, default: 5, summary: "Sends every Nth express-lane merge through the normal review lenses after merge, filing what they find as records.", category: 'merge-safety', tier: 'advanced' },
  // #5216: the pipeline driver's admission lane (express-lane's driver design). policyOnly: the ceilings bound autonomous spend and express-driver routes records to autonomous machinery, so a --run config must never loosen them.
  // #5222: express-driver-review — whether the driver runs its read-only evidence reviewer; policyOnly for the same reason.
  { key: 'express-driver', type: 'enum', values: ['off', 'split', 'on'], default: 'off', policyOnly: true, summary: "Routes admitted records to the pipeline driver: off, on, or split by record-number parity.", category: 'merge-safety', tier: 'advanced' },
  { key: 'express-driver-wall-clock-minutes', type: 'integer', min: 1, default: 30, policyOnly: true, summary: "Wall-clock ceiling in minutes for each driver worker launch, not the whole record.", category: 'merge-safety', tier: 'advanced' },
  { key: 'express-driver-spend-ceiling-dollars', type: 'integer', min: 1, default: 10, policyOnly: true, summary: "Spend ceiling in whole dollars for each driver worker launch, not the whole record.", category: 'merge-safety', tier: 'advanced' },
  { key: 'express-driver-review', type: 'enum', values: ['off', 'on', 'beyond-express'], default: 'beyond-express', policyOnly: true, summary: "Whether the driver runs its reviewer: off, on (also admits any recognised ceremony label), or only past express bounds or above low risk.", category: 'merge-safety', tier: 'advanced' },
  // #5224: the driver's lane bounds — policyOnly like its siblings, since they bound what autonomous machinery may take on. A record beyond the express bounds is admitted only with the reviewer step on. express-driver-max-lines is a Shape B derived default (_shared/policy-schema-read-path.md): the base default 40 equals auto-merge-max-lines' own, and resolvePolicyKeys derives the value from the resolved auto-merge-max-lines whenever it resolves source 'default' (deriveExpressDriverMaxLines); the driver reads source !== 'default' to decide whether to pass check --max-lines.
  { key: 'express-driver-max-size', type: 'enum', values: ['low', 'medium'], default: 'low', policyOnly: true, summary: "Largest size label the driver admits into its lane: low (the express bound) or medium; size:high is never admitted.", category: 'merge-safety', tier: 'advanced' },
  { key: 'express-driver-max-key-files', type: 'integer', min: 1, default: 3, policyOnly: true, summary: "Most Key Files a record may list for the driver to admit it; the default equals the express lane's own limit.", category: 'merge-safety', tier: 'advanced' },
  { key: 'express-driver-max-lines', type: 'integer', min: 1, default: 40, policyOnly: true, summary: "Diff-line bound the driver's check applies to a record the reviewer step is on for; unset, the express bound applies.", category: 'merge-safety', tier: 'advanced' },
  // #6018: the highest risk label the driver admits. policyOnly because it bounds what autonomous machinery may take on, so a --run config never widens it. A record admitted above risk:low is admitted only with the reviewer step on and always stops at pending-review for a human merge. Factory decision (#6006): factory-settable (not in FACTORY_REFUSED_KEYS), safe as a user-wide default because a widened record needs the reviewer on and always ends at a human merge.
  { key: 'express-driver-max-risk', type: 'enum', values: ['low', 'medium', 'high'], default: 'low', policyOnly: true, summary: "Highest risk label the driver will take on: low, medium or high; above low it needs the reviewer step and a human merge.", category: 'merge-safety', tier: 'advanced' },
  // #6019: what the driver does with a record whose Key Files touch a protected path. policyOnly because it decides whether autonomous machinery may take a protected path, so a --run config never loosens it. Under `reviewer`, merge-time families (hooks/, hooks.js, hooks.sh, skills/_shared/, CODEOWNERS) pass behind the reviewer step and the record always stops at pending-review for a human merge; build-time families (.github/, .gitlab-ci.yml, .circleci/, .githooks/, .husky/, package.json, .claude/settings*.json, .mcp.json, .claude-tweaks/policy.yml, .claude-tweaks/verify-scope.json) refuse under both values. Factory decision (#6006): factory-settable (not in FACTORY_REFUSED_KEYS), safe as a user-wide default because `reviewer` admits nothing without the reviewer step on and always ends at a human merge.
  { key: 'express-driver-protected-paths', type: 'enum', values: ['refuse', 'reviewer'], default: 'refuse', policyOnly: true, summary: "What the driver does with a protected path: refuse it, or reviewer to pass merge-time paths behind the reviewer step and a human merge.", category: 'merge-safety', tier: 'advanced' },
  // #6020: the protected-path list as a policy value; when set it replaces eligibility.js's SHIPPED_PROTECTED_PATHS (unset keeps it, [] protects nothing). policyOnly because it decides what autonomous machinery may merge, so a --run config never shrinks it. Consumers read it from the main checkout (express/policy.js's resolveProtectedPathsEntry), never the record's worktree. A malformed value (element: 'glob'; hashInvalid refuses an inline # that parseFlatLines would cut at) resolves invalid and the shipped list applies, never an empty one.
  { key: 'protected-paths', type: 'list', default: [], element: 'glob', emptyList: true, hashInvalid: true, policyOnly: true, summary: "Root-anchored path globs the express lane and the driver refuse to take; unset keeps the shipped list, and [] protects nothing.", category: 'merge-safety', tier: 'advanced' },
  { key: 'auto-merge-max-lines', type: 'integer', default: 40, summary: "Bounds how large a diff an unattended merge will accept before a human is required — a weighted guideline, not a hard cutoff.", category: 'merge-safety', tier: 'core' },
  { key: 'auto-merge-max-files', type: 'integer', default: 2, summary: "Bounds how many changed files an unattended merge will accept before a human is required — the same weighted guideline, by file count.", category: 'merge-safety', tier: 'core' },
  { key: 'merge-sensitive-paths', type: 'list', default: [], summary: "Lists path patterns that always require a human to sign off on a merge, no matter how small the change looks.", category: 'merge-safety', tier: 'advanced' },
  // risk-categories (#4609): project-added invisible-risk slugs, beside the four BUILTIN_RISK_CATEGORIES. `element: 'slug'` validates each comma-separated entry. policyOnly: risk-path-globs validates against it from policy.yml, so the two can never disagree.
  { key: 'risk-categories', type: 'list', default: [], element: 'slug', policyOnly: true, summary: "Read only with control mode on: extra risk categories added to the four built-in ones; pairs with risk-path-globs.", category: 'merge-safety', tier: 'advanced' },
  // risk-path-globs (#4609): the second block-style key. A slug -> glob-list map, read by parseRiskPathGlobs (not parseFlatLines, which ignores indented lines); `keys` names the built-in slugs, and risk-categories adds more at resolve time.
  { key: 'risk-path-globs', type: 'map', keys: BUILTIN_RISK_CATEGORIES, default: {}, summary: "Read only with control mode on: maps each risk category to its signal path globs, as an indented block; pairs with risk-categories.", category: 'merge-safety', tier: 'advanced' },
  // commit-scope / commit-scope-paths (#3298): the merge-subject scope source bin/compose-subject.js resolves when --scope is absent — explicit flag > a commit-scope-paths match over the changed files > commit-scope > unscoped. Both advanced: the core tier is at its cap.
  { key: 'commit-scope', type: 'string', summary: "Names the one Conventional-Commits scope every merge subject carries, and the fallback when a path rule is ambiguous.", category: 'merge-safety', tier: 'advanced' },
  { key: 'commit-scope-paths', type: 'list', default: [], summary: "Maps changed-path prefixes to the Conventional-Commits scope a merge subject carries when the matched files all agree on one scope.", category: 'merge-safety', tier: 'advanced' },
  // Sweep-backstop thresholds (#414) — how long a green, gate-passed PR may sit
  // with `--auto` unarmed, or a claimed/pushed run may sit with no PR progress,
  // before the repo-wide scan surfaces it. See _shared/github-pr-scan.md's
  // 'unarmed ready PR' and 'unsettled run' checks.
  { key: 'pr-unarmed-age-hours', type: 'integer', default: 24, summary: "Sets how long a ready, passing pull request may sit without being armed to merge before it is flagged as stalled.", category: 'merge-safety', tier: 'advanced' },
  { key: 'unsettled-age-hours', type: 'integer', default: 24, summary: "Sets how long a claimed piece of work may sit with no visible progress before it is flagged as stalled.", category: 'merge-safety', tier: 'advanced' },
  { key: 'grant-veto-window-hours', type: 'integer', min: 1, default: 24, summary: "Sets how long a machine-granted auto:merge-pending grant must sit unvetoed before the merge gate matures it to auto:merge.", category: 'merge-safety', tier: 'advanced' },
  // The row default (false) is the `supervised` base only: the EFFECTIVE
  // unset default is derived in resolvePolicyKeys from the resolved autonomy
  // ceiling — trusted/unattended derive true (#580; was opt-in-only, #414).
  // See deriveHousekeepingAutoMerge below and tidy/SKILL.md Step 7.
  { key: 'housekeeping-auto-merge', type: 'boolean', default: false, summary: "Lets routine cleanup pull requests merge themselves once green, instead of waiting for a person to arm them.", category: 'merge-safety', tier: 'core' },
  { key: 'work-links', type: 'enum', values: ['native', 'body-text'], default: 'body-text', summary: "Chooses whether related records link through native issue relationships or a plain-text reference in the body.", category: 'housekeeping', tier: 'advanced' },
  { key: 'review-effort-floor', type: 'enum', values: ['low', 'medium', 'high', 'xhigh', 'max'], summary: "Sets a minimum thoroughness level a code review is never allowed to fall below, even for a small-looking diff.", category: 'pipeline-behavior', tier: 'advanced' },
  { key: 'harness-health-scoped-rule-budget', type: 'integer', default: 30, summary: "Caps how many lines a path-scoped rule file may hold before a health sweep flags it as too long.", category: 'health-sweeps', tier: 'advanced' },
  { key: 'harness-health-always-loaded-budget', type: 'integer', default: 150, summary: "Caps how many lines the project's always-loaded instructions may hold before a health sweep flags them as too long.", category: 'health-sweeps', tier: 'advanced' },
  // #5757: /claude-tweaks:ci-health hands the text to `ci-audit.js gather --thresholds`, whose parseThresholds owns validation. No default (unset is empty); neither policyOnly nor policySourceExcluded — a thresholds text is data, never executed, so a run config may override it for one run. Not a Manifesto lever.
  { key: 'ci-health-thresholds', type: 'string', summary: "Overrides the CI health checklist's thresholds and floors, as comma-separated id=value pairs with no spaces, such as queue-wait=0.5.", category: 'health-sweeps', tier: 'advanced' },
  // Per-origin open-singleton cap for the five health sweeps' digest filing
  // (_shared/health-filing-digest.md). Documented in _shared/policy-schema.md
  // since #235 but never registered here until #330's migration hit the gap.
  { key: 'health-open-cap', type: 'integer', default: 10, summary: "Sets how many open findings a health sweep will file as separate issues before folding new ones into a shared digest instead.", category: 'health-sweeps', tier: 'advanced' },
  { key: 'scope-creep', type: 'enum', values: ['add-to-plan', 'stop-and-ask', 'drop'], default: 'add-to-plan', summary: "Decides what happens when new work surfaces mid-build that was not in the original plan: fold it in, pause and ask, or drop it.", category: 'pipeline-behavior', tier: 'advanced' },
  { key: 'overlap', type: 'enum', values: ['companion', 'extend', 'skip', 'replace'], default: 'companion', summary: "Decides how a new spec is treated when it duplicates an existing one: run beside it, extend it, skip it, or replace it.", category: 'pipeline-behavior', tier: 'advanced' },
  { key: 'design-intent', type: 'enum', values: ['none', 'bold', 'quiet', 'minimal', 'delightful', 'onboarding'], default: 'none', summary: "Sets the visual and UX ambition a build aims for — bold, quiet, minimal, delightful, onboarding-focused, or none at all.", category: 'pipeline-behavior', tier: 'advanced' },
  { key: 'ui-stack', type: 'string', summary: "Names the UI component library / styling approach a frontend build should use, or an explicit no-preference answer.", category: 'pipeline-behavior', tier: 'advanced' },
  // #2540: Step 2.5b-ii's variant-exploration tournament/live offers were
  // mandatory ceremony with no off-switch, and `explore` silently skips on
  // any current Impeccable pin anyway. Default 'off' formalizes the
  // already-observed no-op behavior rather than removing a working feature.
  { key: 'design-variant-exploration', type: 'enum', values: ['off', 'offer'], default: 'off', summary: "Turns specify's layout-tournament and scaffold-live variant-exploration offers on or off before decomposition.", category: 'pipeline-behavior', tier: 'advanced' },
  { key: 'design-critique', type: 'enum', values: ['off', 'auto', 'full'], default: 'auto', summary: "Sets whether project-local design critics run at review time: never, when the project shows design investment or the record asks, or always.", category: 'pipeline-behavior', tier: 'advanced' },
  { key: 'leftover-default', type: 'enum', values: ['defer', 'backlog', 'drop'], default: 'defer', summary: "Decides what happens to loose ends found at the end of a run: leave them for later, file them as backlog, or drop them.", category: 'pipeline-behavior', tier: 'advanced' },
  { key: 'auto-fix-threshold', type: 'enum', values: ['lint-only', 'lint+type', 'lint+type+test'], default: 'lint+type', summary: "Sets how much a test pass auto-fixes before stopping — lint alone, lint and types, or lint, types, and tests.", category: 'pipeline-behavior', tier: 'advanced' },
  { key: 'review-auto-apply-ceiling', type: 'enum', values: ['none', 'low', 'medium'], default: 'low', summary: "Sets the severity cutoff at or below which review findings are applied without asking — anything above it is staged or prompted.", category: 'pipeline-behavior', tier: 'advanced' },
  { key: 'review-auto-apply-prose-exempt', type: 'boolean', default: true, summary: "Lets a prose-only fix auto-apply one severity tier above the ceiling instead of the plain ceiling — see step3-routing.md.", category: 'pipeline-behavior', tier: 'advanced' },
  { key: 'specify-auto-continue', type: 'boolean', default: false, summary: "Lets a session invoke /claude-tweaks:specify on an approved brainstorming design doc immediately instead of a manual command.", category: 'pipeline-behavior', tier: 'advanced' },
  // #3128: gates /specify's decomposition Ceremony tally (record-creation-subissues.md).
  // Default false — the durable log is a maintainer watch-item aid, so a consumer
  // project never gets docs/ writes it did not opt into.
  { key: 'specify-decomposition-log', type: 'boolean', default: false, summary: "When on, /specify logs each decomposition yielding 2+ ceremony:standard sub-issues to a git-tracked file for later confirmation.", category: 'pipeline-behavior', tier: 'advanced' },
  { key: 'tidy-aggressiveness', type: 'enum', values: ['conservative', 'moderate', 'aggressive'], default: 'moderate', summary: "Sets how boldly cleanup sweeps act on what they find — from keep-unless-certain to delete-unless-doubtful.", category: 'pipeline-behavior', tier: 'advanced' },
  { key: 'auto-mode', type: 'enum', values: ['default-on', 'default-off'], summary: "Sets whether a pipeline run (/flow), a standalone build, or an unattended cleanup run starts hands-off by default, without being asked.", category: 'pipeline-behavior', tier: 'advanced' },
  { key: 'backlog-fetch-limit', type: 'integer', default: 1000, summary: "Caps how many backlog issues or PRs one scan pulls (every queue, PR-scan, and triage fetch) before warning that the list was truncated.", category: 'housekeeping', tier: 'advanced' },
  // Session-scoped record snapshot (#645) — how long /tmp/ct-records-{session-id}.json stays
  // fresh before a consumer (backlog/capture/specify/trust-table/help/tidy/visualize) re-fetches
  // instead of reading the cached snapshot. See _shared/record-queue-fetch.md.
  { key: 'record-snapshot-ttl-seconds', type: 'integer', default: 300, summary: "Sets how many seconds the session-scoped record snapshot stays fresh before a consumer re-fetches instead of reading the cache.", category: 'housekeeping', tier: 'advanced' },
  // #2567: the `gh` subprocess timeout shared by every direct execFileSync/
  // execFile('gh', ...) call routed through bin/lib/shared-primitives.js's
  // GH_TIMEOUT_MS export. Bounded 1s-60s: below 1s no real `gh` call could
  // ever complete (every value under that is effectively "always fail"), and
  // above 60s a single hung call would stall a pipeline step for a minute
  // before its one automatic retry even starts. CLAUDE_TWEAKS_GH_TIMEOUT_MS
  // (an env var, not a policy key) takes precedence over this when both are
  // set — see shared-primitives.js's resolution order.
  { key: 'gh-timeout-ms', type: 'integer', min: 1000, max: 60000, default: 5000, summary: "Bounds one `gh` call (killed; retried once only where a caller opts in); batched and exec-seam calls get max(30000, this value).", category: 'housekeeping', tier: 'advanced' },
  // #3051: the `git` subprocess timeout for claims-git-cas.js's compare-and-
  // swap reads/writes against the claims-registry branch, routed through
  // bin/lib/shared-primitives.js's GIT_TIMEOUT_MS export — mirrors
  // gh-timeout-ms's shape exactly, but with its own default and range: a
  // claims-branch fetch/push is not retried automatically the way a gh call
  // is, and was observed taking 8.6s on a loaded machine, so the default is
  // higher (30s) and the ceiling wider (120s) than gh-timeout-ms's.
  // CLAUDE_TWEAKS_GIT_TIMEOUT_MS (an env var, not a policy key) takes
  // precedence over this when both are set — see shared-primitives.js's
  // resolution order.
  { key: 'git-timeout-ms', type: 'integer', min: 1000, max: 120000, default: 30000, summary: "Bounds one `git` call on runners incl. claims-registry, pr-checks, compose-subject, console-resolve, release-preflight; killed on timeout.", category: 'housekeeping', tier: 'advanced' },
  { key: 'depth-survey', type: 'enum', values: ['off'], summary: "When set, turns off the end-of-run prompt asking whether recently changed code deserves a deeper architectural pass.", category: 'housekeeping', tier: 'advanced' },
  { key: 'creative-survey', type: 'enum', values: ['off'], summary: "When set, turns off the end-of-run prompt suggesting creative or UX improvement ideas for what was just built.", category: 'housekeeping', tier: 'advanced' },
  { key: 'declare-claude-tweaks', type: 'boolean', default: true, summary: "When false, /init stops declaring claude-tweaks in committed project settings and the cloud setup script; superpowers stays.", category: 'housekeeping', tier: 'advanced' },
  { key: 'scope-keywords-required', type: 'boolean', default: false, summary: "When on, a build refuses to start over files outside its plan unless the plan names its intended scope; otherwise it is only a warning.", category: 'pipeline-behavior', tier: 'advanced' },
  // Renamed from merge-check in #331 (default-parity: that key also defaulted
  // true) — the old name collided with assess-agent-autonomy's merge-check
  // verdict mode, a different concept that keeps its name.
  { key: 'branch-divergence-check', type: 'boolean', default: true, summary: "Whether a build or pipeline run checks the current branch against its upstream and offers a rebase before starting.", category: 'pipeline-behavior', tier: 'advanced' },
  // Default attempt-count budget for a bare /specify drain invocation (#1491).
  // Sibling of dispatch-batch-size, same shape; the shared n/all --budget
  // semantics live in _shared/record-batch-input.md, not restated here.
  { key: 'specify-budget', type: 'integer', default: 5, summary: "Caps how many eligible backlog records one bare /specify drain attempts before stopping.", category: 'pipeline-behavior', tier: 'advanced' },
  { key: 'autonomy', type: 'enum', values: ['supervised', 'trusted', 'unattended'], default: 'supervised', summary: "Caps how much the pipeline may do without a human — trust that classes earn can never exceed this ceiling.", category: 'autonomy-trust', tier: 'core' },
  // Control mode (#4609, human-in-control #4608): twelve flat keys here, plus `risk-categories` and `risk-path-globs` in the merge-safety group above. A summary opens "Not yet used" until a record wires its key; #4618 and #4619 wired `risk-categories` and `risk-path-globs` (bin/lib/policy.js's readRiskPolicy, which reads `control-mode` only as their gate, and bin/accept-park.js's `decide`, which reads them under the project's control-mode result) and #4615 wired `acceptance-target` (bin/accept-park.js's `decide`), so those three carry no marker. The #4608 leaves wire them: control-mode -> #4620 (the bookkeeping ceiling, bin/lib/issues/autonomy.js's effectiveCeiling) and #4624 (the rest of its implied set), and every control-mode-gated leaf through isControlModeOn (bin/lib/policy.js); deploy-reach, deploy-command, deploy-live-workflow, deploy-version-url, dev-base-url, dev-test-account, deploy-wait-seconds, deploy-poll-seconds -> #4616; owned-owners -> #4621; trusted-authors -> #4622. The record that wires a key drops its marker and its entry in tests/resolve-policy-control-mode.test.js's NOT_YET_USED. All but `control-mode` itself are consulted only with control mode on. All advanced — the core tier is at its cap.
  // #5830: control-mode is policyOnly, in both directions — the resolver skips the --run overlay for it. It is the single human-in-control switch (#4608) and a run's own agent writes that run's config.yml, so a run config must not be able to switch the park gate off. The per-run opt-in (a run config turning control mode ON for one run) is dropped on purpose: policy-only both ways was chosen over a raise-only carve-out, so a project turns control mode on in policy.yml or not at all.
  { key: 'control-mode', type: 'enum', values: ['off', 'on'], default: 'off', policyOnly: true, summary: "The single human-in-control switch; implied levers default at skill-default precedence, so any explicitly set lever wins.", category: 'autonomy-trust', tier: 'advanced' },
  { key: 'acceptance-target', type: 'enum', values: ['local', 'dev'], default: 'local', summary: "Control mode only: where a human accepts work, locally or on the dev environment; pairs with deploy-reach when dev.", category: 'pipeline-behavior', tier: 'advanced' },
  { key: 'deploy-reach', type: 'enum', values: ['on-merge', 'command', 'none'], default: 'none', summary: "Not yet used; control mode only: how a merge reaches the dev environment, if at all; pairs with acceptance-target set to dev.", category: 'pipeline-behavior', tier: 'advanced' },
  // deploy-command is an executed string: consumers read it from the base branch's policy only (never from a PR's own copy). policyOnly (here and on the two trust lists below) — the resolver skips the --run overlay, so a run config can name neither what executes nor who is trusted; the base-branch read stays the consumer's, since the resolver only sees the checkout it runs in. allowWhitespace — it is a shell command, like release-hook. closedQuote on the three allowWhitespace rows below: a quoted value holding a `#` is cut mid-quote by parseFlatLines, so an opening quote that never closes is invalid rather than a malformed command.
  { key: 'deploy-command', type: 'string', allowWhitespace: true, closedQuote: true, policyOnly: true, summary: "Not yet used. Executed string, read only from the base branch's policy; meaningful only with deploy-reach command and control mode on.", category: 'pipeline-behavior', tier: 'advanced' },
  { key: 'deploy-live-workflow', type: 'string', allowWhitespace: true, closedQuote: true, summary: "Not yet used; control mode only: names the CI workflow whose success means dev is live; pairs with deploy-reach other than none.", category: 'pipeline-behavior', tier: 'advanced' },
  { key: 'deploy-version-url', type: 'string', pattern: HTTP_URL, summary: "Not yet used; control mode only: a URL returning the deployed version; pairs with deploy-reach other than none.", category: 'pipeline-behavior', tier: 'advanced' },
  { key: 'dev-base-url', type: 'string', pattern: HTTP_URL, summary: "Not yet used; control mode only: the dev environment's base URL, where acceptance runs; pairs with acceptance-target set to dev.", category: 'pipeline-behavior', tier: 'advanced' },
  { key: 'dev-test-account', type: 'string', allowWhitespace: true, closedQuote: true, summary: "Not yet used; control mode only: the vault entry name of the dedicated test account the smoke check signs in with; pairs with dev-base-url.", category: 'pipeline-behavior', tier: 'advanced' },
  { key: 'deploy-wait-seconds', type: 'integer', min: 0, default: 900, summary: "Not yet used; control mode only: how long to wait for a deploy to go live; 0 skips the wait. Pairs with a live signal.", category: 'pipeline-behavior', tier: 'advanced' },
  { key: 'deploy-poll-seconds', type: 'integer', min: 1, default: 30, summary: "Not yet used; control mode only: how often the live signal is polled while waiting; pairs with deploy-wait-seconds.", category: 'pipeline-behavior', tier: 'advanced' },
  { key: 'owned-owners', type: 'list', default: [], element: 'login', policyOnly: true, summary: "Control mode only, from base-branch policy: orgs and users, beside the repo owner, whose repos are owned. Pairs with nothing.", category: 'autonomy-trust', tier: 'advanced' },
  { key: 'trusted-authors', type: 'list', default: [], element: 'login', policyOnly: true, summary: "Not yet used; control mode only, from base-branch policy: GitHub logins trusted as record roots, beside the repo owner. Pairs with nothing.", category: 'autonomy-trust', tier: 'advanced' },
  { key: 'trust-revert-window-days', type: 'integer', min: 1, default: 14, summary: "Sets how many days a closed record must age before its outcome counts as proven-good evidence toward earned trust.", category: 'autonomy-trust', tier: 'advanced' },
  { key: 'trust-evaluation-window-days', type: 'integer', min: 1, default: 30, summary: "Sets how many days back a closed record still counts toward its class's trust verdict.", category: 'autonomy-trust', tier: 'advanced' },
  { key: 'trust-follow-up-rate-max-percent', type: 'integer', min: 0, max: 100, default: 30, summary: "Sets the largest share of a class's recent records, in percent, that may draw a corrective follow-up while the class still reads clean.", category: 'autonomy-trust', tier: 'advanced' },
  // The reserved second opt-in named by skills/_shared/autonomy-ceiling.md —
  // read by permittedGrants as grantOriginationEnabled. false by default: the
  // 'unattended' ceiling alone never authorizes a machine-originated grant.
  { key: 'grant-origination-enabled', type: 'boolean', default: false, summary: "A separate, deliberate opt-in a human must set before the pipeline is ever allowed to originate its own grants.", category: 'autonomy-trust', tier: 'core' },
  // Shared floors read by bin/lib/issues/oversight-floor.js's exceedsOversightFloor
  // — the point past which a machine-originated grant (grant-gate.js gate 5) or a
  // /claude-tweaks:accept binary-gate check is denied and a human review is
  // required. 'always' is the reserved unconditional-deny opt-out value. Not
  // prefixed 'demo-' or 'grant-': more than one consumer reads the same pair. #366.
  { key: 'risk-floor', type: 'enum', values: ['low', 'medium', 'high', 'always'], default: 'high', summary: "The risk tier at which machine-originated grants and demo fast-paths stop and require human review.", category: 'autonomy-trust', tier: 'core' },
  { key: 'size-floor', type: 'enum', values: ['low', 'medium', 'high', 'always'], default: 'high', summary: "The size tier at which machine-originated grants and demo fast-paths stop and require human review.", category: 'autonomy-trust', tier: 'core' },
  // Positive integer counting machine grants issued today (audit-comment
  // markers dated today, UTC) — /claude-tweaks:backlog refine's headless posture's own floor.
  // Absent = uncapped (optional-when-absent, see #269's Deliverables).
  { key: 'fleet-daily-grant-cap', type: 'integer', min: 1, summary: "Caps how many machine-issued grants may be handed out across one calendar day; leave it unset for no cap.", category: 'autonomy-trust', tier: 'advanced' },
  // Sampling floor (#310): counts machine-granted merged records in closedAt
  // order and flags every Nth one, so a human /demo verdict keeps entering
  // the trust table even though #267 lets a class promote purely on
  // merged-and-unreverted survival signal. bin/lib/issues/grant-sampling.js
  // is the sole reader.
  { key: 'grant-sampling-every', type: 'integer', min: 1, default: 10, summary: "Flags every Nth machine-granted merged record for a real /demo verdict, so human calibration evidence keeps entering the trust table.", category: 'autonomy-trust', tier: 'advanced' },
  // experiment-cleanup vertical (code-health focus mode) — the repo's own
  // feature-flag idiom, as regex-source strings (first capture group =
  // flag identifier). Empty/absent = the vertical is inactive; there is no
  // whole-repo-scan fallback (see bin/lib/code-health/candidates-experiment-
  // cleanup.js and skills/code-health/focus-mode.md).
  { key: 'experiment-flag-patterns', type: 'list', default: [], summary: "Teaches the experiment-cleanup sweep this repo's own feature-flag idiom; leave it unset and that sweep stays inactive.", category: 'health-sweeps', tier: 'advanced' },
  // Kill-switch name substrings, extending (never replacing) the shipped
  // defaults ["emergency", "circuit", "kill"] — a flag whose identifier
  // matches is never emitted as a candidate, regardless of decision signals.
  { key: 'experiment-flag-exclude', type: 'list', default: [], summary: "Names extra flag-name substrings the experiment-cleanup sweep should never flag, on top of the built-in kill-switch defaults.", category: 'health-sweeps', tier: 'advanced' },
  { key: 'doc-convention-adr', type: 'enum', values: ['plugin', 'project'], summary: "Records which side wins when this repo's existing decision-record convention disagrees with the plugin's own.", category: 'housekeeping', tier: 'advanced' },
  { key: 'doc-convention-tutorial', type: 'enum', values: ['plugin', 'project'], summary: "Records which side wins when this repo's existing Tutorial-genre convention disagrees with the plugin's own.", category: 'housekeeping', tier: 'advanced' },
  { key: 'doc-convention-how-to', type: 'enum', values: ['plugin', 'project'], summary: "Records which side wins when this repo's existing How-To-genre convention disagrees with the plugin's own.", category: 'housekeeping', tier: 'advanced' },
  { key: 'doc-convention-reference', type: 'enum', values: ['plugin', 'project'], summary: "Records which side wins when this repo's existing Reference-genre convention disagrees with the plugin's own.", category: 'housekeeping', tier: 'advanced' },
  { key: 'doc-convention-explanation', type: 'enum', values: ['plugin', 'project'], summary: "Records which side wins when this repo's existing Explanation-genre convention disagrees with the plugin's own.", category: 'housekeeping', tier: 'advanced' },
  { key: 'doc-convention-journey', type: 'enum', values: ['plugin', 'project'], summary: "Records which side wins when this repo's existing Journey-genre convention disagrees with the plugin's own.", category: 'housekeeping', tier: 'advanced' },
  // Retention for docs/superpowers/plans/*.md at /wrap-up's cleanup-planning
  // item 1. Default keep-forever preserves today's unconditional-retention
  // behavior (ADR-0007's own convention) for every project that never sets
  // this — the ADR describes this plugin's own repo, not every consumer.
  { key: 'superpowers-plans-retention', type: 'enum', values: ['keep-forever', 'prune-after-wrapup', 'ask'], default: 'keep-forever', summary: "Decides whether finished planning files are kept (tidy may propose a bulk prune), pruned after wrap-up, or decided case by case.", category: 'housekeeping', tier: 'advanced' },
  // Model-profile resolver levers (#216's bin/lib/model-profiles/profiles.js is
  // the runtime reader for these five key names — POLICY_KEYS_READ pins them;
  // registration here is schema/audit only, deliberately shallow (#219): this
  // file checks model-profiles' row keys are real profile names, never the
  // shape of a row's own fields — that's the resolver's job, at resolve time.
  { key: 'model-stance', type: 'enum', values: ['economy', 'default', 'max-rigor'], default: 'default', summary: "Shifts every dispatched agent's reasoning effort one notch cheaper or more rigorous, without changing which model profile is chosen.", category: 'models', tier: 'advanced' },
  { key: 'frontier-run-cap', type: 'integer', default: 3, summary: "Caps how many Frontier model dispatches one pipeline run may use before falling back to a cheaper profile.", category: 'models', tier: 'advanced' },
  { key: 'model-ceiling', type: 'enum', values: PROFILE_NAMES, summary: "Sets the highest model profile a skill's own default may resolve to, without limiting a person's explicit choice.", category: 'models', tier: 'advanced' },
  { key: 'model-profiles', type: 'map', keys: PROFILE_NAMES, summary: "Lets a project override which model and effort level each named profile resolves to, replacing the shipped table row by row.", category: 'models', tier: 'advanced' },
  // model-effort (#5941): policyOnly — every consumer reads policy.yml directly (resolve-profile.js), never a --run overlay, and no per-run route exists (model-stance has Manifesto lever 10 and --stance; this key does not), so an overlay would report a value no consumer reads.
  { key: 'model-effort', type: 'enum', values: ['inherit', 'profile'], default: 'inherit', policyOnly: true, summary: "Chooses whether a launched agent runs at the harness default effort or at the effort its work profile resolves to.", category: 'models', tier: 'advanced' },
  // express-driver-models (#5917): a block of `role: profile` rows, read by parseDriverModels from policy.yml only, like risk-path-globs. policyOnly: it chooses the model autonomous machinery spends on, so a --run config never sets it. `keys` is the four policy-settable roles; `explorer` is not one, so a row naming it is a schema error.
  { key: 'express-driver-models', type: 'map', keys: POLICY_DRIVER_ROLES, default: POLICY_DRIVER_DEFAULTS, policyOnly: true, summary: "Picks the work profile each pipeline driver worker role launches on; a role left out keeps its shipped default.", category: 'models', tier: 'advanced' },
  // implementer-tier (#5996): read by plugin/bin/implementer-tier.js. Resolved per run, so not policyOnly: one run may try `record` through its config.yml without changing the project file. Not policySourceExcluded: a standing project opt-in is the point. Not a Manifesto lever, so _shared/auto-mode-contract.md's new-lever checklist does not apply. No build calls the CLI yet; #5997 (driver) and #5999 (standard lane) wire the first consumers and drop the `Not yet used` marker and the NOT_YET_USED entry.
  { key: 'implementer-tier', type: 'enum', values: ['lane', 'record'], default: 'lane', summary: "Not yet used. Picks an implementer's work profile from the record's size and Key File count, or from size alone as today.", category: 'models', tier: 'advanced' },
  // Read from /claude-tweaks:research's own `## Input` --mode= flag (IL-24:
  // that file is authoritative for the vocabulary, not this schema).
  { key: 'research-mode', type: 'enum', values: ['quick', 'standard', 'deep', 'ultradeep'], summary: "Sets the default depth of a research run — quick, standard, deep, or ultradeep — when nothing else specifies one.", category: 'pipeline-behavior', tier: 'advanced' },
  // Port isolation (#1791/#1792): not an auto-mode lever — read directly by
  // SessionStart (bin/lib/hooks/session-start.js), never surfaced as a
  // Manifesto question. Per _shared/auto-mode-contract.md's "Adding a new
  // policy lever" checklist: no Manifesto row (not an auto-mode behavior),
  // no CLI arg (nothing about port allocation is per-invocation), no
  // reversibility/confidence-floor entry (it writes .env.local, not code or
  // history). It IS a POLICY_KEYS row (this one) and a policy-schema.md row.
  { key: 'port-services', type: 'list', default: [], summary: "Names the services that get a port from this checkout's leased block; empty keeps port isolation off.", category: 'pipeline-behavior', tier: 'advanced' },
  // release-hook / release-train (#2253, unit 3 of #2250): schema scaffolding
  // only — /claude-tweaks:init Step 21 seeds both as commented-out rows;
  // bin/release-local.js (unit 4) reads release-hook, /claude-tweaks:release
  // --train (unit 6) reads release-train. Neither is a Manifesto lever, so
  // _shared/auto-mode-contract.md's five-site checklist does not apply.
  // Non-core by design: promoting either would widen what the Manifesto
  // surfaces by default (tests/policy-schema-metadata.test.js pins it).
  // release-hook is a shell command and may contain spaces, so it opts out
  // of the string type's whitespace rule via allowWhitespace.
  { key: 'release-hook', type: 'string', allowWhitespace: true, summary: "Names the command the local release engine runs once its tag lands — publish, mirror, or deploy; ignored under pr-first.", category: 'housekeeping', tier: 'advanced' },
  { key: 'release-train', type: 'boolean', default: false, summary: "Lets the unattended release train cut minor and patch releases on its own; honored only when autonomy resolves unattended.", category: 'housekeeping', tier: 'advanced' },
  // release-tip-moves (#4041): /claude-tweaks:release Step 5 reads it when origin/{branch} has
  // moved past the tip Step 3 reviewed. Not a Manifesto lever.
  { key: 'release-tip-moves', type: 'integer', min: 0, default: 2, summary: "Caps how many times the integration branch may move between a release's review and its merge before the release is held.", category: 'merge-safety', tier: 'advanced' },
  // Efficiency budgets (#4029): one ceiling per measure per ceremony profile,
  // compared against a finished run's totals by phase-timing.js --check-budgets
  // (reader: policy.js readEfficiencyCeilings). 0 disables that budget. Defaults
  // are the p90 of 143 archived runs on 2026-10-24, rounded up (derivation in
  // _shared/policy-schema-efficiency-budgets.md). Not Manifesto levers.
  { key: 'fast-lane-run-round-trip-ceiling', type: 'integer', min: 0, default: 420, summary: "Sets how many tool round trips a fast-lane run may use before it is flagged as over budget; 0 turns the check off.", category: 'housekeeping', tier: 'advanced' },
  { key: 'fast-lane-run-procedure-kb-ceiling', type: 'integer', min: 0, default: 560, summary: "Sets how many kilobytes of skill procedure a fast-lane run may read before it is flagged as over budget; 0 turns the check off.", category: 'housekeeping', tier: 'advanced' },
  { key: 'fast-lane-run-verify-minutes-ceiling', type: 'integer', min: 0, default: 21, summary: "Sets how many minutes of verification a fast-lane run may spend before it is flagged as over budget; 0 turns the check off.", category: 'housekeeping', tier: 'advanced' },
  { key: 'standard-run-round-trip-ceiling', type: 'integer', min: 0, default: 900, summary: "Sets how many tool round trips a standard run may use before it is flagged as over budget; 0 turns the check off.", category: 'housekeeping', tier: 'advanced' },
  { key: 'standard-run-procedure-kb-ceiling', type: 'integer', min: 0, default: 580, summary: "Sets how many kilobytes of skill procedure a standard run may read before it is flagged as over budget; 0 turns the check off.", category: 'housekeeping', tier: 'advanced' },
  { key: 'standard-run-verify-minutes-ceiling', type: 'integer', min: 0, default: 37, summary: "Sets how many minutes of verification a standard run may spend before it is flagged as over budget; 0 turns the check off.", category: 'housekeeping', tier: 'advanced' },
  // #5563: read by release-notes-publish.js and release-local.js via policy.js readChangelogMaxReleases, from policy.yml alone. Not a Manifesto lever; policyOnly so a run config never sets a value the engines would not read.
  { key: 'changelog-max-releases', type: 'integer', min: 0, default: 0, summary: "Keeps only this many of the newest releases in CHANGELOG.md, moving the rest behind a footer that names where they are; 0 never trims.", category: 'housekeeping', tier: 'advanced', policyOnly: true },
  // #5119: reaches verify.js only as --default-suite-slots (verify.js never reads
  // policy.yml); a declared concurrency.suiteSlots wins. Not a Manifesto lever; policyOnly so a run config never sets it.
  { key: 'verify-suite-slots', type: 'integer', min: 1, default: 1, summary: "Sets how many test suites verify.js may run at once on one machine when verify-scope.json declares no concurrency.suiteSlots.", category: 'housekeeping', tier: 'advanced', policyOnly: true },
  // #5932: read by bin/deferral-route.js (routeDeferral's policy-reason rule) through resolve-policy.js's resolvePolicy, so a run's config.yml overlays it via --run: neither policyOnly nor policySourceExcluded. Each element must be a DEFER_REASONS value; [] is the explicit empty list. Not a Manifesto lever.
  { key: 'deferral-digest-reasons', type: 'list', default: [], element: 'defer-reason', emptyList: true, summary: "Defer-reasons that send an agent-raised deferral to the digest instead of a record; human input and high severity still file.", category: 'pipeline-behavior', tier: 'advanced' },
  // #5933: read by bin/deferral-route.js through resolve-policy.js's resolvePolicy (routeDeferral's no-evidence and run-cap rules). policyOnly: both bound what a run may file, so a run's own config.yml must never loosen them (set-config.js writes neither). Not Manifesto levers.
  { key: 'filed-record-evidence', type: 'enum', values: ['off', 'required'], default: 'off', policyOnly: true, summary: "Requires an agent-filed record of three Defer-reasons to name a test file or record; without it the item goes to the digest.", category: 'pipeline-behavior', tier: 'advanced' },
  { key: 'run-filed-record-cap', type: 'integer', min: 0, policyOnly: true, summary: "Caps how many records one pipeline run's agents may file; past it an item goes to the digest. Leave it unset for no cap.", category: 'pipeline-behavior', tier: 'advanced' },
  // #6051: read only by build/plan-review.md's pointer, through resolve-policy.js --values with no --run, so policyOnly (no per-run route; not a Manifesto lever, so auto-mode-contract.md's new-lever checklist does not apply). Not policySourceExcluded: a standing opt-in is the point. Factory-settable: a user-wide preference for fewer planning questions is safe, since it only changes which gaps are asked and an older build ignores an unknown key. Its first consumer lands in this same PR, so no "Not yet used." marker.
  { key: 'planning-decisions', type: 'enum', values: ['ask-all', 'asked-classes'], default: 'ask-all', policyOnly: true, summary: "Lets plan review settle low-level planning questions itself under asked-classes and ask only the high-impact ones; ask-all asks every gap.", category: 'pipeline-behavior', tier: 'advanced' },
  // #6056: read only by specify/shaping-mode.md's Planning at specify paragraph, through resolve-policy.js --values with no --run, so policyOnly (no per-run route). /claude-tweaks:specify has no Manifesto, so it is not a Manifesto lever and auto-mode-contract.md's new-lever checklist does not apply. Not policySourceExcluded: a standing opt-in is the point. Factory-settable: a user-wide opt-in only moves planning to shaping time, and an older build ignores an unknown key. resolvePolicyKeys refuses `on` while planning-decisions resolves ask-all (planningDecisionsFrom): the entry resolves `off`, keeps its source and gains conflict: 'planning-decisions'; resolve-policy.js warns on stderr. Its first consumer lands in this same PR, so no "Not yet used." marker.
  { key: 'plan-at-specify', type: 'enum', values: ['off', 'on'], default: 'off', policyOnly: true, summary: "Writes, reviews and stores a record's plan while specify shapes it; needs planning-decisions set to asked-classes.", category: 'pipeline-behavior', tier: 'advanced' },
];

const SCHEMA_BY_KEY = new Map(POLICY_KEYS.map((entry) => [entry.key, entry]));

// execution.always's migrate function, named out of the RENAMED_KEYS literal
// below to avoid a nested ternary: a valid lock value migrates to its -only
// lock form, anything else null-migrates to the schema default.
function migrateExecutionAlways(value) {
  if (value === 'subagent') return 'subagent-only';
  if (value === 'batched') return 'batched-only';
  return null;
}

// Keys retired from POLICY_KEYS but still worth detecting in a project's live
// policy.yml, so a stray value migrates instead of silently reporting as an
// unrecognized typo. `migrate` maps the retired key's old value to a suggested
// value for `replacedBy` -- null means "delete the stray key, no replacement
// value needs setting" (unattended-tier's own 'off' never unlocked anything
// autonomy's own 'supervised' default doesn't already match, so there is
// nothing to carry forward).
// `replacedBy: null` means the key is retired outright — no replacement key
// exists. auditPolicy reports such keys as deliberate retirements (delete the
// stray line); the resolver treats the old key's line as contributing nothing
// and a request for the retired name as unknown-key.
const RENAMED_KEYS = [
  // Merged into the autonomy ceiling in #289, first shipped v6.76.0. Removal
  // condition in skills/_shared/policy-deprecations.md.
  {
    key: 'unattended-tier',
    replacedBy: 'autonomy',
    migrate: (value) => (value === 'on' ? 'unattended' : null),
  },
  // Renamed in #295 (the value is a sequential batch count, never a concurrency
  // slot count). Unlike unattended-tier, the old key ALSO still sits in
  // POLICY_KEYS — it runs its own removal course; removal condition in
  // skills/dispatch/deprecated-aliases.md.
  {
    key: 'dispatch-pick-max-concurrent',
    replacedBy: 'dispatch-batch-size',
    migrate: (value) => value,
  },
  // Merged into execution-strategy in #331: the lock key's two valid values
  // map to the '-only' lock forms; anything malformed null-migrates so the
  // resolver falls through to execution-strategy's schema default ('subagent',
  // unlocked) rather than minting a malformed '-only' value. Removal
  // condition in skills/_shared/policy-deprecations.md.
  {
    key: 'execution.always',
    replacedBy: 'execution-strategy',
    migrate: migrateExecutionAlways,
  },
  // Renamed in #331 (boolean semantics unchanged — identity migrate); the old
  // name collided with assess-agent-autonomy's merge-check verdict mode.
  // Removal condition in skills/_shared/policy-deprecations.md.
  {
    key: 'merge-check',
    replacedBy: 'branch-divergence-check',
    migrate: (value) => value,
  },
  // Retired outright in #331 (replacedBy: null — delete the stray line, no
  // replacement key). The thresholds became stated constants in
  // skills/review/review-effort-derivation.md. Removal condition in
  // skills/_shared/policy-deprecations.md.
  { key: 'review-diff-heuristic-thresholds', replacedBy: null, migrate: () => null },
  // Retired outright in #331 — the value 4 is hardcoded at its read sites.
  // Removal condition in skills/_shared/policy-deprecations.md.
  { key: 'promise-register-min-leaves', replacedBy: null, migrate: () => null },
  // Retired outright in #331 — adaptive batching is deepen's sole behavior.
  // Removal condition in skills/_shared/policy-deprecations.md.
  { key: 'section-confirmation', replacedBy: null, migrate: () => null },
  // Renamed in #332 (naming convention + rename program). All seven are
  // identity migrates — the value's shape and meaning did not change, only
  // the name. Removal condition for each: skills/_shared/policy-deprecations.md.
  //
  // review-severity-floor was a misnomer: it is the MAX severity that gets
  // auto-applied (`medium` -> Low AND Medium auto-apply), i.e. a ceiling, and
  // this schema already spells "max" as -ceiling (model-ceiling,
  // dispatch-retry-ceiling). The old name also collided with
  // review-effort-floor, which IS a floor.
  { key: 'review-severity-floor', replacedBy: 'review-auto-apply-ceiling', migrate: (value) => value },
  // automerge -> auto-merge: one spelling, matching housekeeping-auto-merge
  // and the auto:merge label.
  { key: 'automerge-max-lines', replacedBy: 'auto-merge-max-lines', migrate: (value) => value },
  { key: 'automerge-max-files', replacedBy: 'auto-merge-max-files', migrate: (value) => value },
  // dot -> dash: keys are flat kebab-case identifiers; grouping is the
  // `category` metadata, never the key (a dotted key reads as a nested-YAML
  // path in a flat-line parser and silently defaults when written nested).
  { key: 'project.maturity', replacedBy: 'project-maturity', migrate: (value) => value },
  { key: 'harness-health.scoped-rule-budget', replacedBy: 'harness-health-scoped-rule-budget', migrate: (value) => value },
  { key: 'harness-health.always-loaded-budget', replacedBy: 'harness-health-always-loaded-budget', migrate: (value) => value },
  { key: 'doc-convention.adr', replacedBy: 'doc-convention-adr', migrate: (value) => value },
  // Renamed in #602 — the last dotted key, carved out of #332 because the
  // hook reads it by literal (bin/lib/policy.js isWorktreeAlwaysOn), which
  // this alias alone does not reach; policy.js consults this entry to honor
  // the old spelling. Identity migrate; boolean semantics unchanged. Removal
  // condition in skills/_shared/policy-deprecations.md.
  { key: 'worktree.always', replacedBy: 'worktree-always', migrate: (value) => value },
];
const RENAMED_KEY_NAMES = new Set(RENAMED_KEYS.map((entry) => entry.key));

function readFileSafe(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
}

// policy.yml text found through locatePolicyFile (#4492); null when unreadable or
// when `repoRoot` is not a string (locatePolicyFile returns a null path then).
function readLocatedPolicy(repoRoot) {
  const policyPath = locatePolicyFile(repoRoot).path;
  return policyPath === null ? null : readFileSafe(policyPath);
}

// Flat `key: value` line matcher, tolerant of a trailing `# comment` and of
// living inside a fenced code block — matches bin/lib/policy.js's convention.
// bin/hooks.sh's policy_verdict mirrors this for `worktree-always` (#5392):
// change both, plus its hooks.sh AC9 differential fixtures.
// hashInvalid rows (#6020): parseFlatLines cuts a value at its first `#`, which would
// silently drop every list element after one (`docs/#x/**`). True when the column-0
// `{key}:` line has a `#` directly after a non-whitespace character in its value; a
// `#` after whitespace is a comment and parses as usual.
function hasInlineHash(raw, key) {
  if (!raw) return false;
  const prefix = `${key}:`;
  for (const rawLine of raw.split('\n')) {
    if (!rawLine.startsWith(prefix)) continue;
    if (/\S#/.test(rawLine.slice(prefix.length))) return true;
  }
  return false;
}

function parseFlatLines(raw) {
  const result = {};
  if (!raw) return result;
  for (const rawLine of raw.split('\n')) {
    // Every top-level key starts in column 0 — nesting is never expressed by
    // indentation. Dotted names still parse (the RENAMED_KEYS aliases such as
    // harness-health.scoped-rule-budget are dotted inputs), but new keys are
    // flat kebab-case per skills/_shared/policy-key-naming.md.
    // An indented line belongs to a nested block's own field (model-profiles'
    // risk-path-globs' and express-driver-models' rows, the three block keys) and must never be read as
    // a flat key in its own right.
    if (/^\s/.test(rawLine)) continue;
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^([a-zA-Z0-9_.-]+):\s*([^#]*)/);
    if (!match) continue;
    const value = match[2].trim();
    if (value) result[match[1]] = value;
  }
  return result;
}

// True when `value` ends inside a quote — what a `#` inside quotes leaves
// behind once parseFlatLines cuts the line there. Shell-style: a `"` opens
// anywhere (`-m"fix #12"`, `>"a#b"`); a `'` only at the start of a word (line
// start, after whitespace, `=`, `(`, `;`, `|`, `&`), so an apostrophe inside a
// word (`Bob's`) opens none; `\` escapes the next character except inside
// single quotes.
function endsInsideQuote(value) {
  let quote = null;
  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i];
    if (ch === '\\' && quote !== "'") {
      i += 1;
    } else if (quote !== null) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || (ch === "'" && (i === 0 || /[\s=(;|&]/.test(value[i - 1])))) {
      quote = ch;
    }
  }
  return quote !== null;
}

function isValidValue(schemaEntry, value) {
  switch (schemaEntry.type) {
    case 'boolean':
      return value === 'true' || value === 'false';
    case 'integer': {
      if (!/^-?\d+$/.test(value)) return false;
      const parsed = Number(value);
      return (schemaEntry.min === undefined || parsed >= schemaEntry.min)
        && (schemaEntry.max === undefined || parsed <= schemaEntry.max);
    }
    case 'enum':
      return schemaEntry.values.includes(value);
    case 'string':
      // Non-blank (trimmed); whitespace-free by default. Enough to catch a
      // mistyped branch name ("dev branch") without reimplementing git
      // check-ref-format's full rules — a name git itself would reject is
      // worth flagging, but this validator has no repo to resolve the name
      // against. allowWhitespace: true opts a command-shaped key (e.g.
      // release-hook) out of the whitespace-free rule, but not out of the
      // non-blank rule — a whitespace-only value is still invalid.
      // An optional `pattern` (#4609) must also match — e.g. a URL key.
      // A `closedQuote` key (the #4609 keys only — release-hook's pinned F6/#2253
      // contract keeps an unbalanced quote as an ordinary value) also rejects an
      // opening quote that never closes — what a `#` inside the quotes leaves
      // behind, since parseFlatLines cuts at any `#` — and a blank value inside
      // its quotes (`""`).
      if (schemaEntry.closedQuote === true) {
        const trimmed = value.trim();
        if (endsInsideQuote(trimmed)) return false;
        if (stripEnclosingQuotes(trimmed).trim().length === 0) return false;
      }
      return value.trim().length > 0 && (schemaEntry.allowWhitespace === true || !/\s/.test(value))
        && (schemaEntry.pattern === undefined || schemaEntry.pattern.test(value));
    case 'list':
      // An optional `element` (#4609) names the rule each comma-separated entry
      // must match; an empty entry (a trailing or doubled comma) never does.
      // A row with no `element` accepts anything, as before.
      if (schemaEntry.element === undefined) return true;
      if (schemaEntry.emptyList === true && EMPTY_LIST_RE.test(value.trim())) return true;
      return value.split(',').every((entry) => LIST_ELEMENT_PATTERNS[schemaEntry.element].test(entry.trim()));
    case 'opaque':
      return true;
    case 'map':
      // Shallow by design (#219 Non-Goals): every row key must name a real
      // profile; a row's own value shape is never inspected here — the
      // resolver (bin/lib/model-profiles/policy-fragment.js) validates that
      // deeply, at resolve time, and rejects an unknown field there instead.
      return Object.keys(value).every((k) => schemaEntry.keys.includes(k));
    default:
      return true;
  }
}

// key, rawValue (string | number | undefined | null) -> the coerced, valid
// value for that key: `rawValue` itself when it type-checks (parsed to a
// number for 'integer', to a boolean for 'boolean'), the schema's own
// `default` when `rawValue` is absent/empty or fails validation, or
// `rawValue` unchanged when `key` names no known lever (nothing to coerce
// against). The one place malformed-value coercion is decided for a
// programmatic (non-audit) reader — a caller with a raw policy.yml string
// (or nothing at all) calls this once and trusts what comes back without
// re-validating it itself.
// Strips exactly one matched pair of surrounding quotes ("…" or '…') — an
// unmatched leading quote (a typo, e.g. an unterminated `"foo`) is left
// alone rather than silently dropped.
function stripMatchedQuotes(value) {
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' || first === "'") && first === last) return value.slice(1, -1);
  }
  return value;
}

// A closedQuote row's stripping: the outer pair goes only when it encloses the
// whole value, meaning the first unescaped same quote is the last character, so
// `"a" "b"` stays exactly as written. A `\` escapes except inside single quotes,
// as in endsInsideQuote. Nothing is unescaped.
function stripEnclosingQuotes(value) {
  const quote = value[0];
  if (quote !== '"' && quote !== "'") return value;
  for (let i = 1; i < value.length; i += 1) {
    if (value[i] === '\\' && quote === '"') i += 1;
    else if (value[i] === quote) return i === value.length - 1 ? value.slice(1, -1) : value;
  }
  return value;
}

function resolveValue(key, rawValue) {
  const entry = SCHEMA_BY_KEY.get(key);
  if (!entry) return rawValue;
  if (rawValue === undefined || rawValue === null || rawValue === '') return entry.default;
  let strValue = String(rawValue);
  // A closedQuote row validates the value as written, then strips: the rule reads
  // quotes, so judging the stripped text would re-read `"a 'b"` as an unclosed `'`.
  if (entry.closedQuote === true) {
    const trimmed = strValue.trim();
    return isValidValue(entry, trimmed) ? stripEnclosingQuotes(trimmed) : entry.default;
  }
  // allowWhitespace entries (a shell command, e.g. release-hook) may be
  // quoted for readability in policy.yml — strip one matched pair before
  // validating, so a quoted command validates and resolves unquoted.
  if (entry.allowWhitespace === true) strValue = stripMatchedQuotes(strValue.trim());
  if (!isValidValue(entry, strValue)) return entry.default;
  if (entry.type === 'list' && entry.emptyList === true && EMPTY_LIST_RE.test(strValue.trim())) return [];
  if (entry.type === 'integer') return parseInt(strValue, 10);
  if (entry.type === 'boolean') return strValue === 'true';
  return entry.allowWhitespace === true ? strValue : rawValue;
}

function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

// Multi-key resolver behind bin/resolve-policy.js (#329). Pure — callers hand
// in raw file contents as strings; no fs, no process state. Returns a plain
// object keyed by each requested key name (never an array — IL-121), each
// entry one of:
//   { value, source }                      source: "run-config" | "policy" | "factory" | "default"
//   { value, source, "renamed-from": k }   value arrived via a RENAMED_KEYS migration
//   { value: default, source: "default", invalid: true }   present-but-invalid at
//                                          the winning source (never cascades;
//                                          risk-path-globs: null, not its default)
//   { value, source: "factory", repoInvalid: true }   a block key whose policy.yml
//                                          block is malformed, resolved from the
//                                          factory's rows (#6006)
//   { error: "unknown-key" }               key in neither POLICY_KEYS nor RENAMED_KEYS
// onInvalid(key, raw, sourceName) receives each rejected raw value; sourceName is
// "run-config", "policy" or "factory" (the factory for a refused key, too).
// Precedence per key: run-config (only when runConfigRaw is a string, and never
// for a policyOnly row) -> policy -> factory (factoryRaw, the merged user-wide
// factory policy text — policy-factory.js reads it, this function never does;
// an explicit value like policy, so integration-model's source !== "default"
// guard counts it) -> schema default. A key in FACTORY_REFUSED_KEYS is skipped
// in the factory source and reported through onInvalid. Alias normalization
// happens per source, BEFORE precedence: old key alone -> migrate() contributes
// under the new name with a renamed-from tag (a null migration contributes
// nothing, but still tags renamed-from when the final resolution falls to the
// default); old + new in
// one source -> the new key wins with no tag (the stray old key is
// auditPolicy's business).

// housekeeping-auto-merge's effective default derives from the resolved
// autonomy ceiling (skills/_shared/autonomy-ceiling.md): a project declaring
// trusted/unattended has already opted into click-free bookkeeping, and a
// tidy housekeeping PR is bookkeeping whose content judgment passed at tidy
// Step 6, before the PR opened (#580). Invariants: (1) autonomy is resolved
// HERE, from the same parsed sources — never via requestedKeys, whose per-key
// loop shares no resolved-so-far state, so requesting the key alone still
// derives correctly; (2) positive-list mapping — a future autonomy enum value
// lands on false until this mapping is deliberately revisited; (3) the
// derived entry keeps source: 'default' — that field is the derived-vs-
// explicit attribution surface tidy Step 7.5 reads (#581); never tag a
// distinct source for a derived value.
function deriveHousekeepingAutoMerge(sources) {
  const autonomy = firstSourceValue(sources, 'autonomy');
  return autonomy === 'trusted' || autonomy === 'unattended';
}

// The one first-source-wins read the derived keys share (#6056 review): the first source holding
// `key` (after `skip`) wins, and an invalid value resolves the key's schema default, never the next
// source's value, mirroring the main loop's invalid handling.
function firstSourceValue(sources, key, skip = () => false) {
  const schemaEntry = SCHEMA_BY_KEY.get(key);
  for (const source of sources) {
    if (skip(source) || !hasOwn(source.values, key)) continue;
    const raw = source.values[key];
    return isValidValue(schemaEntry, raw) ? resolveValue(key, raw) : schemaEntry.default;
  }
  return schemaEntry.default;
}

// express-driver-max-lines' effective default (#5224, Shape B): the resolved
// auto-merge-max-lines value, read through the same sources with the same
// invalid handling as the main loop — the first source holding the key wins,
// and an invalid value resolves that key's schema default, never the next
// source's value. Unlike express-driver-max-lines itself, auto-merge-max-lines
// is not policyOnly, so the --run overlay reaches this read, as it reaches
// express-lane.js check.
function deriveExpressDriverMaxLines(sources) {
  return firstSourceValue(sources, 'auto-merge-max-lines');
}

// The planning-decisions read plan-at-specify's refusal makes (#6056), through firstSourceValue:
// run-config skipped (the key is policyOnly), and the factory source skipped when the key is in
// FACTORY_REFUSED_KEYS, as the main loop skips it. refusedKeys is resolvePolicyKeys' lazily
// required FACTORY_REFUSED_KEYS (require cycle with policy-factory.js). Returns 'ask-all' | 'asked-classes'.
function planningDecisionsFrom(sources, refusedKeys) {
  return firstSourceValue(sources, 'planning-decisions', (source) => source.name === 'run-config'
    || (source.name === 'factory' && refusedKeys.includes('planning-decisions')));
}

// express-driver-models (#5917): { present: false } | { present: true, ok: true, value } | { present: true, ok: false, raw }.
// A column-0 `express-driver-models:` line opens the block; rows are two-space `role: profile` lines until the next
// non-blank column-0 line. Anything else (inline value, second block, unknown or repeated role, unknown profile,
// other indent) rejects the whole block. No row can hold `#`, so stripComment's cut is safe.
function parseDriverModels(policyRaw) {
  if (typeof policyRaw !== 'string') return { present: false };
  const lines = policyRaw.split('\n');
  const KEY = 'express-driver-models';
  let present = false;
  let ok = true;
  const rows = {};
  const rawLines = [];
  let inBlock = false;
  for (const line of lines) {
    const text = stripComment(line);
    const columnZero = text !== '' && !/^[ \t]/.test(text);
    if (columnZero) {
      inBlock = false;
      if (text.startsWith(`${KEY}:`)) {
        if (present) ok = false; // a second block
        present = true;
        rawLines.push(text);
        if (text !== `${KEY}:`) ok = false; // inline value
        else inBlock = true;
      }
      continue;
    }
    if (!inBlock || text.trim() === '') continue;
    rawLines.push(text);
    const m = /^ {2}([a-z-]+):[ \t]*([a-z]+)$/.exec(text);
    if (!m || !POLICY_DRIVER_ROLES.includes(m[1]) || !PROFILE_NAMES.includes(m[2]) || Object.hasOwn(rows, m[1])) {
      ok = false;
      continue;
    }
    rows[m[1]] = m[2];
  }
  if (!present) return { present: false };
  return ok ? { present: true, ok: true, value: rows } : { present: true, ok: false, raw: rawLines.join('\n') };
}

// A block key across the two block-bearing sources (#6006): each side is a parser reply ({ present: false } |
// { present, ok: true, value } | { present, ok: false, raw }). The row merge and source rule are mergeBlockRows'. A
// malformed side is reported through onInvalid and never hides a valid one; only when no side resolves does the key
// come back invalid. Returns { rows, source, repoInvalid } | { invalid } | null (unset); repoInvalid is true when a
// malformed repo block yielded to the factory's rows.
function mergeBlockSides(key, repo, factory, onInvalid) {
  const repoOk = repo.present && repo.ok;
  const factoryOk = factory.present && factory.ok;
  if (repo.present && !repo.ok && onInvalid) onInvalid(key, repo.raw, 'policy');
  if (factory.present && !factory.ok && onInvalid) onInvalid(key, factory.raw, 'factory');
  if (!repoOk && !factoryOk) return repo.present || factory.present ? { invalid: true } : null;
  const merged = mergeBlockRows({ ok: repoOk, value: repo.value }, { ok: factoryOk, value: factory.value });
  return { ...merged, repoInvalid: repo.present && !repo.ok };
}

// A merged block's entry. repoInvalid is additive and appears only beside factory rows, so an entry with no
// factory side keeps exactly { value, source }.
function blockEntry(value, merged) {
  return { value, source: merged.source, ...(merged.repoInvalid ? { repoInvalid: true } : {}) };
}

// The text whose risk-categories widens risk-path-globs' allowed slugs: any non-empty risk-categories line in policy.yml decides
// alone (an invalid one leaves the built-ins, as it always did), and the factory's applies only when policy.yml has
// none. A typo in policy.yml never activates a different value configured elsewhere (no cascade).
function riskSlugsFor(policyRaw, factoryRaw) {
  const policyHasLine = parseFlatLines(typeof policyRaw === 'string' ? policyRaw : null)['risk-categories'] !== undefined;
  return riskAllowedSlugs(policyHasLine ? policyRaw : factoryRaw);
}

function resolvePolicyKeys(requestedKeys, { policyRaw, runConfigRaw, factoryRaw, onInvalid } = {}) {
  // Lazy: policy-factory.js requires this module at top level (require cycle).
  const { FACTORY_REFUSED_KEYS } = require('./policy-factory');
  const sources = [
    { name: 'run-config', raw: typeof runConfigRaw === 'string' ? runConfigRaw : null },
    { name: 'policy', raw: typeof policyRaw === 'string' ? policyRaw : null },
    { name: 'factory', raw: typeof factoryRaw === 'string' ? factoryRaw : null },
  ].map(({ name, raw }) => {
    const entries = parseFlatLines(raw);
    const values = { ...entries }; // canonical-name -> raw string value
    const renamedFrom = {}; // canonical-name -> old name, when the value arrived via migrate
    const emptyRenames = {}; // canonical-name -> old name, when migrate returned null (no value)
    for (const alias of RENAMED_KEYS) {
      if (!hasOwn(entries, alias.key)) continue;
      delete values[alias.key]; // an old name never resolves as a flat key of its own
      // A retired key (replacedBy: null) contributes nothing — there is no
      // canonical key to migrate under or tag renamed-from; the stray line is
      // auditPolicy's business, and every other requested key stays unaffected.
      if (alias.replacedBy === null) continue;
      if (hasOwn(entries, alias.replacedBy)) continue; // new key wins, no renamed-from
      const migrated = alias.migrate(entries[alias.key]);
      if (migrated === null) {
        emptyRenames[alias.replacedBy] = alias.key;
        continue;
      }
      values[alias.replacedBy] = String(migrated);
      renamedFrom[alias.replacedBy] = alias.key;
    }
    return { name, raw, values, renamedFrom, emptyRenames };
  });

  const result = {};
  for (const requested of requestedKeys) {
    // model-profiles is a block-style key — invisible to this flat
    // resolver by design. Emit its documented absent shape; the CLI overwrites
    // this entry via its parsePolicyModelConfig delegation before printing.
    if (requested === 'model-profiles') {
      result[requested] = { value: null, source: 'default' };
      continue;
    }
    // risk-path-globs is the other block-style key, resolved here from the
    // policy and factory sources (run configs hold flat lever lines, never blocks)
    // by its own parser. A rejected block never hides the other source's valid
    // rows; only when neither source resolves does the key come back null, flagged
    // invalid — never a partial map or the {} that means unset (the absent shape
    // model-profiles uses too, unlike the flat keys' schema default).
    if (requested === 'risk-path-globs') {
      // #6006: rows merge per category, repo over factory (mergeBlockSides).
      const slugs = riskSlugsFor(policyRaw, factoryRaw);
      const merged = mergeBlockSides(requested, parseRiskPathGlobs(policyRaw, slugs), parseRiskPathGlobs(factoryRaw, slugs), onInvalid);
      if (merged === null) result[requested] = { value: {}, source: 'default' };
      else if (merged.invalid) result[requested] = { value: null, source: 'default', invalid: true };
      else result[requested] = blockEntry(merged.rows, merged);
      continue;
    }
    // express-driver-models (#5917): a policyOnly block, read from policy.yml and the factory text, never a run config. Unset and rejected differ from
    // risk-path-globs: unset resolves the four role defaults, and null with invalid: true comes back only when neither
    // source's block resolves (a rejected block on one side leaves the other side's rows).
    if (requested === 'express-driver-models') {
      // #6006: rows merge per role over the defaults, repo over factory (mergeBlockSides).
      const merged = mergeBlockSides(requested, parseDriverModels(policyRaw), parseDriverModels(factoryRaw), onInvalid);
      if (merged === null) result[requested] = { value: { ...POLICY_DRIVER_DEFAULTS }, source: 'default' };
      else if (merged.invalid) result[requested] = { value: null, source: 'default', invalid: true };
      else result[requested] = blockEntry({ ...POLICY_DRIVER_DEFAULTS, ...merged.rows }, merged);
      continue;
    }
    // A request by an alias's old name resolves the replacement key. A
    // RETIRED name (replacedBy: null) has no replacement to resolve — it is
    // an unknown key, not a silent fall-through to some other entry.
    const aliasEntry = RENAMED_KEYS.find((alias) => alias.key === requested);
    if (aliasEntry && aliasEntry.replacedBy === null) {
      result[requested] = { error: 'unknown-key' };
      continue;
    }
    const canonical = aliasEntry ? aliasEntry.replacedBy : requested;
    const schemaEntry = SCHEMA_BY_KEY.get(canonical);
    if (!schemaEntry) {
      result[requested] = { error: 'unknown-key' };
      continue;
    }
    // No schema default is itself null, so `?? null` only fires on absent.
    const defaultValue = schemaEntry.default ?? null;
    let resolved = null;
    // A key a factory layer may not set: report it and leave that source out, so the
    // entry resolves exactly as with no factory layer.
    const factorySource = sources.find((source) => source.name === 'factory');
    const factoryHoldsRefused = FACTORY_REFUSED_KEYS.includes(canonical) && hasOwn(factorySource.values, canonical);
    if (factoryHoldsRefused && onInvalid) onInvalid(requested, factorySource.values[canonical], 'factory');
    for (const source of sources) {
      if (schemaEntry.policyOnly && source.name === 'run-config') continue;
      if (factoryHoldsRefused && source.name === 'factory') continue;
      if (!hasOwn(source.values, canonical)) continue;
      const raw = source.values[canonical];
      if (isValidValue(schemaEntry, raw) && !(schemaEntry.hashInvalid && hasInlineHash(source.raw, canonical))) {
        resolved = { value: resolveValue(canonical, raw), source: source.name };
      } else {
        // A typo must never activate a different configured value: resolve to
        // the schema default here, never the next source's value.
        resolved = { value: defaultValue, source: 'default', invalid: true };
        // Side channel for a caller that reports the rejected raw value (#4141);
        // the entry shape above is unchanged.
        if (onInvalid) onInvalid(requested, raw, source.name);
      }
      if (hasOwn(source.renamedFrom, canonical)) resolved['renamed-from'] = source.renamedFrom[canonical];
      break;
    }
    if (!resolved) {
      resolved = { value: defaultValue, source: 'default' };
      const tagged = sources.find((source) => hasOwn(source.emptyRenames, canonical));
      if (tagged) resolved['renamed-from'] = tagged.emptyRenames[canonical];
    }
    // Derived default (#580): source 'default' covers both unset and
    // set-but-invalid — both fall back to the autonomy-derived value, the
    // same set-but-invalid posture resolveIntegrationModel documents.
    if (canonical === 'housekeeping-auto-merge' && resolved.source === 'default') {
      resolved = { ...resolved, value: deriveHousekeepingAutoMerge(sources) };
    }
    // Shape B derived default (#5224): unset and set-but-invalid both take the
    // auto-merge-max-lines value; source stays 'default' (the driver's signal
    // to pass no --max-lines) and invalid: true survives the spread.
    if (canonical === 'express-driver-max-lines' && resolved.source === 'default') {
      resolved = { ...resolved, value: deriveExpressDriverMaxLines(sources) };
    }
    // policySourceExcluded (generalized from #715's merge-authorization-only
    // special case — #839): a key so flagged is never validly sourced from
    // policy.yml — a standing project default would silently make a
    // this-run-only decision into a permanent one, defeating whatever
    // per-run property the key exists to protect (for merge-authorization,
    // "a human decided, live, for this run"). The factory layer (#6006) is a
    // standing default too, so it is excluded the same way. Only run-config
    // (the `pre-authorize-merge` /flow token or a live Manifesto
    // confirm/hybrid override answer) may set it; a policy.yml or factory
    // value is discarded, falling back to the schema default exactly as if
    // nothing had set it at all. (merge-authorization is also in
    // FACTORY_REFUSED_KEYS, which skips its factory value before this guard.)
    // Registering a second such lever needs only this flag on its POLICY_KEYS
    // entry — no change here or in auditPolicy()'s matching category below.
    if (schemaEntry.policySourceExcluded && (resolved.source === 'policy' || resolved.source === 'factory')) {
      resolved = { value: defaultValue, source: 'default' };
    }
    // #6056: plan-at-specify needs planning-decisions: asked-classes. `on` beside ask-all resolves
    // `off`, keeps its source, and carries the conflict for resolve-policy.js's warning.
    if (canonical === 'plan-at-specify' && resolved.value === 'on' && planningDecisionsFrom(sources, FACTORY_REFUSED_KEYS) === 'ask-all') {
      resolved = { ...resolved, value: 'off', conflict: 'planning-decisions' };
    }
    result[requested] = resolved;
  }
  return result;
}

// Shallow extractor for a nested `{topKey}:` block's first-level indented key
// names — parseFlatLines only sees flat `key: value` lines, so a block-style
// value (model-profiles, the one caller) is otherwise invisible to auditPolicy.
// risk-path-globs and express-driver-models, the other block keys, have their own parsers
// (bin/lib/risk-path-globs.js; parseDriverModels above).
// Shares stripComment with the resolver (model-profiles/policy-fragment.js) so the
// two never disagree on a comment (the old `/#.*$/` missed one on a CRLF line,
// since `.` does not match `\r`, #4816).
// Returns undefined when the block is absent, distinct from an empty map.
function extractMapEntry(raw, topKey) {
  if (!raw) return undefined;
  const lines = raw.split('\n');
  let found = false;
  const map = {};
  for (let i = 0; i < lines.length; i += 1) {
    const rawLine = lines[i];
    const stripped = stripComment(rawLine);
    if (!found) {
      if (/^\S/.test(rawLine) && new RegExp(`^${topKey}:\\s*$`).test(stripped.trim())) found = true;
      continue;
    }
    if (!stripped.trim()) continue;
    if (!/^\s/.test(rawLine)) break; // dedent — block ended
    const rowMatch = /^ {2}([A-Za-z0-9_-]+):/.exec(stripped);
    if (rowMatch) map[rowMatch[1]] = true;
    // Deeper-nested field lines (4-space `model:`/`effort:`) are ignored —
    // shallow means only the row's own key name is read here.
  }
  return found ? map : undefined;
}

// The slugs a risk-path-globs row may name: BUILTIN_RISK_CATEGORIES plus what
// `risk-categories` adds — only from a value that passes its own validation, so
// a malformed list can never widen them (#4609).
function riskAllowedSlugs(policyRaw) {
  const raw = parseFlatLines(typeof policyRaw === 'string' ? policyRaw : null)['risk-categories'];
  if (raw === undefined || !isValidValue(SCHEMA_BY_KEY.get('risk-categories'), raw)) return BUILTIN_RISK_CATEGORIES;
  return [...BUILTIN_RISK_CATEGORIES, ...raw.split(',').map((slug) => slug.trim())];
}

// Bound on detectIntegrationModel's `git remote get-url origin` probe — local
// and fixed, never the gh budget (a git remote read is not a network call).
const GIT_REMOTE_PROBE_TIMEOUT_MS = 5000;
// How many times detectIntegrationModel runs the `gh repo view` probe before giving up on a
// timeout (the first attempt plus one retry, record #4578 Decision Q4). The single source for
// the probe loop, the degrade object's `attempts`, and every worst-case budget derived from
// it (the hook budget below, and the bound phase-exit's call-site comment cites).
const FORGE_PROBE_ATTEMPTS = 2;
// The per-attempt `gh` bound both lifecycle hooks (session-start, pre-tool-use)
// pass as `timeoutMs`. Hook worst case: git 5 s + two 5 s gh attempts = 15 s
// (record #4578 Decision Q2) — one constant so the two hooks cannot drift.
const HOOK_FORGE_PROBE_TIMEOUT_MS = 5000;
// Freshness window of the run-scoped forge degrade memo (#4830). While `gh` stays
// hung, the PreToolUse PR-stamp gate pays at most one hook-bounded probe per TTL of
// hooked activity: GIT_REMOTE_PROBE_TIMEOUT_MS + FORGE_PROBE_ATTEMPTS x
// HOOK_FORGE_PROBE_TIMEOUT_MS = 15 s worst case; the memo then answers for the next
// TTL. Concurrent hook processes that start with no fresh memo each probe (see
// resolveRunPinnedIntegrationModel).
const FORGE_DEGRADE_MEMO_TTL_MS = 60000;

// The `gh` timeout for detectIntegrationModel's `gh repo view` probe. Ladder:
// explicit positive-integer `opts.timeoutMs` (returns before any read) > the
// shared gh ladder, `shared-primitives.ghTimeoutMsAt(repoRoot, { env })`: env
// CLAUDE_TWEAKS_GH_TIMEOUT_MS > `gh-timeout-ms` in repoRoot's policy.yml, located
// through locatePolicyFile (a linked worktree falls back to the main checkout's, #4492)
// > 5000. The ladder lives there so every gh bound shares one definition. It reads
// from repoRoot rather than the cwd, the right root for a caller probing a repo other
// than the cwd's. `opts.env` (optional) replaces process.env as the place the env var
// is read from. The require sits inside the body so loading policy-schema never loads
// shared-primitives.
function resolveForgeProbeTimeoutMs(repoRoot, opts = {}) {
  const explicit = opts && opts.timeoutMs;
  if (Number.isInteger(explicit) && explicit > 0) return explicit;
  const { ghTimeoutMsAt } = require('./shared-primitives');
  return ghTimeoutMsAt(repoRoot, { env: opts && opts.env });
}

// The reason codes of detectIntegrationModel's degrade object — the one
// producer-side list: the producer below and every consumer that validates a
// reason code (lib/flow/manifesto-write.js) read it, so they cannot drift.
const FORGE_DEGRADE_REASON = Object.freeze({ TIMEOUT: 'timeout', TIMEOUT_THEN_EXIT: 'timeout-then-exit' });
const FORGE_DEGRADE_REASONS = Object.freeze(Object.values(FORGE_DEGRADE_REASON));

// Renders detectIntegrationModel's degrade object for a human: one string per
// reason, shared by every surface that reports it.
function formatForgeDegrade(degrade) {
  if (degrade.reason === FORGE_DEGRADE_REASON.TIMEOUT_THEN_EXIT) {
    return `forge detection timed out after ${degrade.timeoutMs} ms, then gh failed on retry`;
  }
  return `forge detection timed out after ${degrade.timeoutMs} ms (x2)`;
}

// Computed default for `integration-model` when absent from every config
// source (run-config, policy.yml) — bin/resolve-policy.js's code twin of
// skills/_shared/forge-detection.md's three-check ladder. Impure (shells out),
// unlike resolvePolicyKeys above; kept separate so that function stays pure.
// Never throws — fails open to 'local-merge' on any error, including no git
// remote at all (checked first, so a local-files project with no remote never
// shells out to gh).
//
// Bounds: the `git remote get-url origin` probe has its own fixed bound,
// GIT_REMOTE_PROBE_TIMEOUT_MS, and never draws on the gh budget. The `gh repo
// view` probe runs under resolveForgeProbeTimeoutMs's ladder (explicit
// `opts.timeoutMs` > env CLAUDE_TWEAKS_GH_TIMEOUT_MS > `gh-timeout-ms` in
// policy.yml > 5000). A gh call that TIMES OUT on the first attempt is retried
// once with the same timeout; a first attempt that exits non-zero or finds no
// `gh` binary is definitive — one invocation, no retry. 'local-merge' therefore
// means two different things: DETECTED (no remote, gh absent, gh exiting
// non-zero first time — the forge really isn't there) or DEGRADED (a timeout,
// then a failed retry — the forge was never reached, so the answer is a guess).
// A degraded fallback is reported through the optional `opts.onDegrade(d)`
// callback with `d = { reason, timeoutMs, attempts: FORGE_PROBE_ATTEMPTS }` — reason 'timeout'
// when the retry timed out too, 'timeout-then-exit' when it failed any other
// way; a callback that throws is swallowed. The return value stays a bare
// string for every caller.
//
// `opts.mcpReachable` (optional, default undefined/falsy) is a caller-supplied
// override — never resolved inside this function, per docs/incident-log.md
// IL-63: a spawned-subprocess-style module cannot invoke MCP tools itself, so
// this function can only accept the answer, never derive it. When true AND a
// git remote exists, short-circuits straight to 'pr-first', skipping the `gh`
// probe entirely — a remote is still required, since an MCP reachability
// signal is meaningless with nothing to integrate through. The one caller
// positioned to supply this (bin/resolve-policy.js's CLI, invoked inside an
// agent turn) is documented in that file; pre-tool-use.js's hook call site
// runs with no agent turn active and can never supply it (see
// resolveRunPinnedIntegrationModel's own comment).
//
// `opts.env`, `opts.stderr` and `opts.homeDir` (all optional) let a caller run this
// against an environment that is not the process's own: `env` is handed to both children
// and to ghOptions, `stderr` receives ghOptions' GitHub Enterprise note, and `homeDir`
// (a function) is read only if gh's hosts.yml lookup falls through to the home directory.
function detectIntegrationModel(repoRoot, opts = {}) {
  const { mcpReachable, onDegrade, env, stderr, homeDir } = opts;
  // Required here, not at the top: repo-resolve -> shared-primitives lazily requires
  // policy-schema and policy back, so a load-time edge from this file would close a cycle.
  const { ghOptions, injectedGhDeps } = require('./repo-resolve');
  const ghDeps = injectedGhDeps({ env, stderr, homeDir });
  try {
    execFileSync('git', ['remote', 'get-url', 'origin'], {
      cwd: repoRoot, stdio: ['ignore', 'pipe', 'ignore'], timeout: GIT_REMOTE_PROBE_TIMEOUT_MS, encoding: 'utf8', windowsHide: true,
      ...(env ? { env } : {}),
    });
  } catch {
    return 'local-merge';
  }
  if (mcpReachable === true) return 'pr-first';
  const ghTimeoutMs = resolveForgeProbeTimeoutMs(repoRoot, opts);
  const args = ['repo', 'view', '--json', 'owner,name'];
  const probe = () => {
    try {
      // windowsHide restated in the call: the windows-hide scan reads a bare
      // options object, never one wrapped in ghOptions (#4505's GH_HOST seam).
      execFileSync('gh', args, ghOptions(args, {
        cwd: repoRoot, stdio: ['ignore', 'pipe', 'ignore'], timeout: ghTimeoutMs, encoding: 'utf8', windowsHide: true,
        ...(env ? { env } : {}),
      }, ghDeps));
      return 'ok';
    } catch (err) {
      // execFileSync's `timeout` kills the child, so a timed-out probe surfaces as ETIMEDOUT or
      // as the kill signal on err.signal (platform-dependent). Any signal-killed gh counts: it
      // is retried once and, if it dies again, reported as a degrade, never as a definitive
      // "not a GitHub repo". Deliberately broader than shared-primitives' isTimeoutError
      // (spec Technical Approach, record #4578).
      if (err && (err.code === 'ETIMEDOUT' || err.signal)) return 'timeout';
      if (err && err.code === 'ENOENT') return 'absent';
      return 'exit';
    }
  };
  let last = probe();
  if (last === 'ok') return 'pr-first';
  if (last !== 'timeout') return 'local-merge'; // definitive: gh absent, or exited non-zero
  for (let attempt = 1; attempt < FORGE_PROBE_ATTEMPTS && last === 'timeout'; attempt += 1) last = probe();
  if (last === 'ok') return 'pr-first';
  if (typeof onDegrade === 'function') {
    try {
      onDegrade({ reason: last === 'timeout' ? FORGE_DEGRADE_REASON.TIMEOUT : FORGE_DEGRADE_REASON.TIMEOUT_THEN_EXIT, timeoutMs: ghTimeoutMs, attempts: FORGE_PROBE_ATTEMPTS });
    } catch {
      // A reporting callback must never break "never throws".
    }
  }
  return 'local-merge';
}

// Full integration-model resolution for a caller that just wants the answer
// — an explicit policy.yml value, else a factory-layer pin (#6006; both by
// ordinary validation, either wins outright), else the computed
// forge-detection default, in one call. The shared entry point for
// both bin/resolve-policy.js's CLI and bin/lib/reconcile/index.js (#407),
// which needs the identical resolution in-process rather than shelling out
// to the CLI. Never returns null: falls through to detection whenever the
// key isn't cleanly set (absent, or set-but-invalid — a typo'd value still
// gets a usable default here, unlike the raw resolvePolicyKeys/CLI path,
// which surfaces `invalid: true` for a caller that wants to report it).
// `opts` (optional): `opts.env` (default the inherited environment),
// `opts.homeDir` and `opts.factoryReadFile` (a throwing reader, test seam)
// drive the factory read; `opts` then forwards unchanged to
// detectIntegrationModel — see that function's own comment for the
// mcpReachable override contract.
function resolveIntegrationModel(repoRoot, opts = {}) {
  // A non-string repoRoot locates no policy file and falls through to detection — deliberate.
  const policyRaw = readLocatedPolicy(repoRoot);
  // factoryRaw: a factory pin is explicit, so the source !== 'default' return below honours it without detection.
  const { readFactoryPolicy } = require('./policy-factory'); // lazy: require cycle
  const factoryRaw = readFactoryPolicy({ env: opts.env || process.env, homeDir: opts.homeDir, ...(opts.factoryReadFile ? { readFile: opts.factoryReadFile } : {}) }).raw;
  const resolved = resolvePolicyKeys(['integration-model'], { policyRaw, runConfigRaw: null, factoryRaw });
  const entry = resolved['integration-model'];
  if (entry && entry.source !== 'default') return entry.value;
  return detectIntegrationModel(repoRoot, opts);
}

// Shared root-resolution + policy.yml/config.yml read + resolvePolicyKeys
// orchestration for bin/resolve-policy.js's CLI and
// bin/lib/blast-radius-cli.js's resolveBlastRadiusConfig — both independently
// reimplemented this exact pathway before #916 (each resolving repo root via
// `git rev-parse --show-toplevel`, falling back to `process.cwd()` on
// failure, then reading `.claude-tweaks/policy.yml` and an optional
// `{runDir}/config.yml` overlay). `git`/`readFile` stay caller-injected (the
// fake-runner test seam blast-radius-cli.js already uses) rather than owned
// here, since the two callers deliberately differ in read-fail-safe-vs-fail-
// loud judgment (resolve-policy.js's `readFileSafe` swallows every read
// error; blast-radius-cli.js's `defaultReadFile` swallows only ENOENT and
// rethrows the rest) — only the orchestration around them is shared. `root`
// is returned too since a caller such as resolve-policy.js's
// integration-model default needs it independent of any resolved key.
// `cwd` (optional) replaces `process.cwd()` as that fallback root. The policy
// file is found through locatePolicyFile (#4492), so from a linked worktree
// without its own copy the main checkout's is read; `policyPath` is the file
// read (null only for a non-string root) and `policySource` is `checkout` or
// `main-checkout`.
//
// The factory layer (#6006) is read here too, below policy.yml: `env` (default the
// inherited environment — hook rule 2) and `homeDir` locate CLAUDE_TWEAKS_FACTORY_POLICY and
// ~/.claude-tweaks/factory-policy.yml. The factory read never goes through the caller's
// `readFile` (the CLIs' swallows every error, so an unreadable factory file would read as
// absent and warn nothing); `factoryReadFile` is a throwing reader (test seam). The return
// adds `factoryRaw`, `factoryOrigin` and `factoryWarnings` (newline-terminated stderr lines).
function resolvePolicyConfig({ git, readFile, runDir = null, keys, onInvalid, cwd, env = process.env, homeDir, factoryReadFile }) {
  let root;
  try {
    root = git(['rev-parse', '--show-toplevel']).trim();
  } catch {
    root = cwd || process.cwd();
  }
  const { path: policyPath, source: policySource } = locatePolicyFile(root);
  const policyRaw = policyPath === null ? null : readFile(policyPath);
  const runConfigRaw = runDir ? readFile(path.join(runDir, 'config.yml')) : null;
  const { readFactoryPolicy } = require('./policy-factory'); // lazy: require cycle
  const { raw: factoryRaw, origin: factoryOrigin, warnings: factoryWarnings } = readFactoryPolicy({
    env, homeDir, ...(factoryReadFile ? { readFile: factoryReadFile } : {}),
  });
  const result = resolvePolicyKeys(keys, { policyRaw, runConfigRaw, factoryRaw, onInvalid });
  return { root, policyRaw, runConfigRaw, result, policyPath, policySource, factoryRaw, factoryOrigin, factoryWarnings };
}

function auditPolicy(repoRoot) {
  const policyRaw = readLocatedPolicy(repoRoot);
  const claudeMdRaw = readFileSafe(path.join(repoRoot, 'CLAUDE.md'));
  const policyEntries = parseFlatLines(policyRaw);
  const claudeMdEntries = parseFlatLines(claudeMdRaw);
  // model-profiles is one of three block-style (non-flat) keys; parseFlatLines
  // can't see it, so it's read separately and merged in under its own name —
  // this never collides with a flat-line entry of the same key. The others,
  // risk-path-globs and express-driver-models, are checked by their own parsers
  // after the flat loop below.
  const modelProfilesEntry = extractMapEntry(policyRaw, 'model-profiles');
  if (modelProfilesEntry !== undefined) policyEntries['model-profiles'] = modelProfilesEntry;

  const unrecognizedKeys = Object.keys(policyEntries)
    .filter((key) => !SCHEMA_BY_KEY.has(key) && !RENAMED_KEY_NAMES.has(key));

  // A renamed key reports exactly once, under renamedKeys -- never also under
  // unrecognizedKeys (excluded above). policyEntries only: this check is
  // policy.yml-only, since that's the only file code ever reads.
  const renamedKeys = [];
  for (const entry of RENAMED_KEYS) {
    if (hasOwn(policyEntries, entry.key)) {
      const value = policyEntries[entry.key];
      renamedKeys.push({
        key: entry.key,
        value,
        replacedBy: entry.replacedBy,
        suggestedValue: entry.migrate(value),
        // A retirement (replacedBy: null) has no replacement key to look up.
        currentReplacementValue: entry.replacedBy !== null && hasOwn(policyEntries, entry.replacedBy)
          ? policyEntries[entry.replacedBy]
          : null,
      });
    }
  }

  // policy.yml is the only config home, so it is the only thing worth validating.
  const invalidValues = [];
  // sourceExcludedKeys (#839): a key that is recognized AND valid, but whose
  // schema entry carries `policySourceExcluded: true` (resolvePolicyKeys'
  // generalized special case above) — policy.yml is a structurally
  // ineffective place to set it, so a value sitting here silently never
  // takes effect. Distinct from invalidValues (a bad value for a key that
  // *would* apply) and from unrecognizedKeys (a key nothing reads at all):
  // this key is real and the value is well-formed, it simply never reaches
  // the resolved value from this source. Generalizes to any future
  // resolver-special-case-excluded lever with zero changes here — only
  // registering `policySourceExcluded: true` on that lever's POLICY_KEYS row.
  const sourceExcludedKeys = [];
  for (const [key, value] of Object.entries(policyEntries)) {
    const schemaEntry = SCHEMA_BY_KEY.get(key);
    if (!schemaEntry) continue;
    if (!isValidValue(schemaEntry, value)) {
      invalidValues.push({ key, value, expected: schemaEntry });
    } else if (schemaEntry.policySourceExcluded) {
      sourceExcludedKeys.push({ key, value });
    }
  }
  // A rejected risk-path-globs block (an inline value on the key line is also
  // seen by the flat loop above, which flags it first — report it once).
  const riskGlobs = parseRiskPathGlobs(policyRaw, riskAllowedSlugs(policyRaw));
  if (riskGlobs.present && !riskGlobs.ok && !invalidValues.some((row) => row.key === 'risk-path-globs')) {
    invalidValues.push({ key: 'risk-path-globs', value: riskGlobs.raw, expected: SCHEMA_BY_KEY.get('risk-path-globs') });
  }
  // Same for express-driver-models (#5917): once, and never for a valid block.
  const driverModels = parseDriverModels(policyRaw);
  if (driverModels.present && !driverModels.ok && !invalidValues.some((row) => row.key === 'express-driver-models')) {
    invalidValues.push({ key: 'express-driver-models', value: driverModels.raw, expected: SCHEMA_BY_KEY.get('express-driver-models') });
  }

  // A recognized key still sitting in CLAUDE.md no longer applies to anything.
  // Its value is not audited — correcting a value nobody reads is not the fix;
  // moving the key is. `alsoInPolicy` separates the two remedies: false means
  // "move it," true means "delete the dead copy, policy.yml already wins."
  // Deliberately restricted to POLICY_KEYS: CLAUDE.md prose is full of
  // key-shaped lines ("Lifecycle:", "Status:"), and the /init migration this
  // feeds deletes lines from a file users hand-tune.
  const migratableKeys = [];
  for (const [key, value] of Object.entries(claudeMdEntries)) {
    if (!SCHEMA_BY_KEY.has(key)) continue;
    migratableKeys.push({
      key,
      value,
      alsoInPolicy: hasOwn(policyEntries, key),
    });
  }

  return { unrecognizedKeys, invalidValues, migratableKeys, renamedKeys, sourceExcludedKeys };
}

module.exports = {
  POLICY_KEYS, POLICY_CATEGORIES, BUILTIN_RISK_CATEGORIES, LIST_ELEMENT_PATTERNS, EMPTY_LIST_RE, RENAMED_KEYS, auditPolicy, resolveValue, parseFlatLines, resolvePolicyKeys, parseDriverModels, riskAllowedSlugs,
  detectIntegrationModel, resolveIntegrationModel, resolvePolicyConfig,
  GIT_REMOTE_PROBE_TIMEOUT_MS, FORGE_PROBE_ATTEMPTS, HOOK_FORGE_PROBE_TIMEOUT_MS, resolveForgeProbeTimeoutMs, formatForgeDegrade,
  FORGE_DEGRADE_REASONS, FORGE_DEGRADE_MEMO_TTL_MS,
};
