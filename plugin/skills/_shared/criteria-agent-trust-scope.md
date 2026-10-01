# Criteria: Agent Trust Scope (#2749)

Shared, criteria-only fragment — what to flag when judging `focus=agent-trust-scope`
candidates from `bin/lib/code-health/candidates-agent-trust-scope.js`. No workflow, no Next
Actions. Consumed by `/claude-tweaks:code-health`'s agent-trust-scope judgment lens
(`skills/code-health/focus-mode.md`'s Criterion pinning table) and by `/claude-tweaks:review`'s
Code-Mode Procedure step that invokes this focus as a component skill. One source of truth so
every sweep applies identical calibration. Confidence floor: `medium`.

## Scope boundary — not the `risk:*` blast-radius scoring

This criterion audits an **unattended autonomous agent's own standing reach** — what registries,
network destinations, or credential-shaped paths a dispatch/build agent could touch, independent
of what any one task actually does. It is deliberately distinct from `_shared/work-record.md`'s
`risk:*` label (also described in this codebase as "blast radius"), which judges how bad a
**specific code change** could be if it goes wrong. A record can score `risk:low` (a small, easily
reverted change) while being built by an agent whose standing config has no registry/network/
credential guardrails at all — the two questions are orthogonal, and this criterion answers only
the second one.

## What the generator hands you

Each candidate is `{ file, kind, evidence }` — `kind` is one of `registry-access`,
`network-egress`, `credential-scope`. A candidate fires only when the project's
`.claude-tweaks/policy.yml` sets `autonomy: unattended` or `autonomy: trusted` (a human is not
confirming each individual action) AND `.claude/settings.json`'s `permissions.deny` list carries
no pattern the generator recognizes as covering that dimension. This is a starting pointer, not a
finding: judge it holistically, the same as any other criterion.

## What to flag

- **`registry-access`** — an elevated-autonomy project with no deny rule covering
  package-registry-mutating commands (`npm publish`, `npm login`, `npm adduser`,
  `npm config set registry`, `yarn publish`, `pnpm publish`, `twine upload`, `gem push`, or
  equivalent). An unattended agent that can run these could push a compromised package to a public
  registry under the project's own credentials with no human in the loop.
- **`network-egress`** — an elevated-autonomy project with no deny rule restricting `WebFetch`,
  `curl`, or `wget`. An unattended agent with unrestricted outbound network access can exfiltrate
  repository contents, fetch and execute arbitrary remote payloads, or reach infrastructure well
  outside the task it was dispatched to do (the OpenAI-agents-vs-RubyGems incident this record
  cites is exactly this shape: an agent's own network reach, not a specific task's correctness).
- **`credential-scope`** — an elevated-autonomy project with no deny rule protecting
  secret-shaped paths (`.env`, `credentials`, `id_rsa`, `.pem`, `.netrc`, `.aws`, `.ssh`, or a
  path literally named `secret`/`secrets`). An unattended agent that can read these can harvest
  credentials for use well outside the current task.

## What NOT to flag

- A project with no `.claude-tweaks/policy.yml` at all (`notApplicable: true`) — it doesn't use
  claude-tweaks dispatch, so there is no autonomy level to audit. This is not a clean pass; it's
  "not applicable," and the summary must say so rather than implying the project was checked and
  found safe.
- A project whose `autonomy` resolves to anything other than `trusted`/`unattended` (default,
  `supervised`, or any other value) — a human confirms every action at that level, so the standing
  reach this criterion audits is not exercised unattended. Zero candidates here is a genuine clean
  result, not a missed check.
- A candidate whose `file` is `.claude-tweaks/policy.yml` (no `.claude/settings.json` present at
  all) — flag it, but note in the finding that the project has made no explicit permission
  decision whatsoever, which is a different (arguably worse) state than an explicit allow with no
  matching deny; don't understate it as equivalent to a merely-incomplete deny list.
- A deny rule that doesn't match the generator's recognized patterns but is still substantively
  equivalent (e.g. a broader `Bash(*)` deny that happens to cover registry/network/credential
  commands as a side effect) — read `.claude/settings.json`'s actual `permissions.deny` array
  before filing; if a broader rule already covers the gap the generator flagged, this is a false
  positive and should be dropped.
- Any claim about what the project's **effective** permissions are — this generator reads only
  the committed `.claude/settings.json` and cannot see `.claude/settings.local.json` (gitignored
  by convention) or the user's own `~/.claude/settings.json`. A finding here says "the committed
  project config carries no explicit guardrail for this dimension," never "this agent can
  actually reach X" — the judge's `evidence` field must preserve that distinction rather than
  overclaiming reach that was never verified.

## Severity calibration

- **high** — `autonomy: unattended` (no human review gate at all, per `_shared/autonomy-ceiling.md`)
  with the dimension's deny list entirely absent (no `permissions.deny` key at all in
  `.claude/settings.json`, or the file itself absent).
- **medium** — `autonomy: unattended` with some `permissions.deny` entries present but none
  covering this specific dimension; or `autonomy: trusted` with the dimension's deny list entirely
  absent.
- **low** — `autonomy: trusted` with some `permissions.deny` entries present but none covering
  this specific dimension — trusted still implies a lighter review cadence than unattended, so the
  same gap carries less weight.

## Reporting

Each finding proposes a record for the supervised/granted build pipeline
(`/claude-tweaks:specify` → `/claude-tweaks:build`) adding the missing `permissions.deny`
entry/entries to `.claude/settings.json` — never a direct edit, and never an automated grant or
revocation of the project's actual GitHub/registry credentials. Applying this criterion to a
project's own dispatch configuration is exactly `/claude-tweaks:code-health focus=agent-trust-scope`
run against that project's own checkout — there is no separate "apply to dispatch's config" mode;
dispatch's config IS the `.claude/settings.json` + `.claude-tweaks/policy.yml` pair this criterion
already reads.

## Copy-paste prompt (runnable standalone)

> Read this project's `.claude-tweaks/policy.yml` for its `autonomy:` value and its
> `.claude/settings.json` for its `permissions.deny` list. If autonomy is `unattended` or
> `trusted`, check whether the deny list covers three dimensions: package-registry-mutating
> commands (`npm publish`, `npm login`, etc.), outbound network access (`WebFetch`, `curl`,
> `wget`), and secret-shaped paths (`.env`, `credentials`, `id_rsa`, `.pem`, `.aws`, `.ssh`). For
> each dimension with no covering deny rule, report it as a gap and suggest the specific
> `permissions.deny` entry that would close it.

## What this vertical never does

This vertical never edits `.claude/settings.json` itself, never grants or revokes any actual
credential, and never claims to have verified an agent's real-world reach (network connectivity,
registry account scope, OS-level sandboxing) — it audits only the project's own committed,
declarative permission configuration for the three dimensions above.
