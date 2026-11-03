# Build — Operational Checklist

Loaded by `/claude-tweaks:build` when the diff touches files matching Category A or B triggers: Common Step 5 reads the Category A section before its verification run; Common Step 5.5 reads the whole file after it, for Category B and every ledger row (#3489).

Operational tasks are not code quality issues — they're deployment and environment concerns that slip through code review. This file contains the full check tables plus the ledger format used to record findings that survive triage.

> **Parallel execution:** Use parallel tool calls — all checks are independent Grep/Glob operations.

---

## Category A — Fix in code

These findings have an in-codebase fix. Common Step 5 applies them before its verification run, committing each fix, so the verified tree includes them.

| Check | Detect | Action |
|-------|--------|--------|
| Schema changes | `git diff --name-only` includes schema/migration files | Run the project's schema push command (check CLAUDE.md). If no command is documented, Common Step 5.5 records it in the ledger as `open`. |
| Shared constant value changed | `git diff` shows a constant's value changed in a shared package | Grep all test files for the old literal value. Update any hardcoded assertions to import the constant instead. |
| New environment variables | Grep changed files for new `process.env.*` or env access patterns | Check `.env.example` (or equivalent) includes the new variable. Add if missing. |
| New package exports | `package.json` `exports` field changed | Run the package build to verify exports resolve correctly. |

Common Step 5.5 appends each Category A finding to the open items ledger (see `/claude-tweaks:ledger`) with the appropriate phase and status `fixed` once its Common Step 5 action completed — `open` for a schema change with no documented push command, or for any action that did not complete.

---

## Category B — Operational tasks (probe-then-classify)

These tasks live outside source code, but most have a CLI. "Requires human action" applies only after a probe confirms the action is not auto-executable on this machine. Run the platform probe first:

| Signal in repo | Platform | Probe | Automation candidates |
|----------------|----------|-------|----------------------|
| `vercel.json` | Vercel | `which vercel && vercel whoami` | env vars, deploys |
| `fly.toml` | Fly.io | `which fly && fly auth whoami` | env vars, secrets, deploys |
| `wrangler.toml` | Cloudflare Workers | `which wrangler && wrangler whoami` | env vars, secrets, deploys |
| `.github/workflows/` modified | GitHub Actions | `gh auth status` | secrets, workflow runs |
| `*.tf` / `*.tfvars` modified | Terraform | `which terraform` | plan (auto), apply (explicit confirmation — destructive) |
| `prisma/migrations/` added | Prisma | `npx prisma migrate status` | deploy migrations |
| `alembic/` added | Alembic | check CLAUDE.md for project command | run migration |
| `*_STRIPE_*` env vars | Stripe | `which stripe && stripe config --list` | webhook subscription, key rotation |
| `Dockerfile*` modified | Docker | `which docker` | build (auto), push (explicit confirmation) |

Then, for each finding below, apply the Step 2.5 triage (auto-executable / auth-gap / truly manual):

| Check | Detect | Default action if probe passes |
|-------|--------|--------------------------------|
| New environment variables needing values | New `process.env.*`, `import.meta.env.*`, `os.environ`, `ENV[...]` patterns | Platform CLI: `vercel env add`, `fly secrets set`, `gh secret set` |
| Infrastructure-as-code changes | Changed `*.tf`, `*.tfvars`, `**/cdk/**`, `**/pulumi/**`, `serverless.yml` | `terraform plan` (auto); `terraform apply` only after explicit user confirmation — destructive |
| Database migrations added | New files in `migrations/`, `prisma/migrations/`, `drizzle/`, `alembic/` | Project migration command from CLAUDE.md or framework default |
| CI/CD pipeline changes | Changed `.github/workflows/*`, `.gitlab-ci.yml`, `Jenkinsfile`, `.circleci/*` | No auto-execute — surface the diff for review. Always seed as `ops` with `(reason-not-auto: requires-signoff)` |
| New secrets/API keys referenced | New `*_API_KEY`, `*_SECRET`, `*_TOKEN` patterns | If vendor CLI exists (`stripe`, `aws`, `gcloud`) with auth, surface the create-key command; otherwise `ops` with `(reason-not-auto: no-cli)` |
| Docker/container config changes | Changed `Dockerfile*`, `docker-compose*`, `*.containerfile` | `docker build` (auto); push only after explicit confirmation |

---

## Ledger format for operational items

- **Auto-executed items** are logged to `decisions.md` (auto mode) or surfaced inline (interactive) and do NOT seed the ledger.
- **Auth-gap items** surface the one-time `{tool} login` command. In `auto` mode, seed as `ops` with `(reason-not-auto: auth-not-configured)`.
- **Truly manual items** (no CLI, or destructive ops requiring explicit signoff) seed as `ops` with the matching `(reason-not-auto: …)` qualifier. De-duplicate against existing `ops` items.

Items that remain `open` after this step carry through to the final summary and are acknowledged at wrap-up's Phase 3 ledger gate.
