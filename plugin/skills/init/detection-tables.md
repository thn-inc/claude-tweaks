# Phase 2: Detection Tables

Reference tables for codebase reconnaissance. Each detection step runs in parallel using glob/grep operations.

## 2a: Project Identity

```
Detect:
- README.md, CONTRIBUTING.md, docs/ — project purpose and domain
- LICENSE — open source vs proprietary
- .github/, .gitlab-ci.yml, Jenkinsfile, .circleci/ — CI/CD platform
- Monorepo vs single app (workspaces config, multiple package.json, apps/, packages/)
- Age — earliest commit date (`git log --reverse --format="%ai" -1`)
- Activity — commits in last 90 days, number of contributors
```

## 2b: Stack Detection

Analyze package manifests, lock files, and config files to build a stack profile.

| Signal File(s) | Detects |
|---|---|
| `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `nx.json`, `lerna.json` | JS/TS monorepo tooling |
| `tsconfig.json` | TypeScript config (strict mode, paths, module resolution) |
| `next.config.*`, `nuxt.config.*`, `vite.config.*`, `svelte.config.*`, `astro.config.*`, `remix.config.*` | Web framework |
| `angular.json` | Angular |
| `app.json`, `expo` in deps | React Native / Expo |
| `manifest.json` (with `manifest_version`) | Browser extension |
| `requirements.txt`, `pyproject.toml`, `Pipfile`, `setup.py`, `uv.lock` | Python stack |
| `go.mod` | Go |
| `Cargo.toml` | Rust |
| `Gemfile` | Ruby |
| `pom.xml`, `build.gradle`, `build.gradle.kts` | Java/Kotlin |
| `.csproj`, `*.sln`, `global.json` | .NET |
| `mix.exs` | Elixir |
| `Package.swift` | Swift |
| `docker-compose.yml`, `Dockerfile`, `compose.yaml` | Containerization |
| `terraform/`, `*.tf` | Terraform IaC |
| `pulumi/`, `Pulumi.yaml` | Pulumi IaC |
| `cdk.json` | AWS CDK |
| `.env.example`, `.env.local`, `.env.sample` | Environment variable patterns |

For each detected technology, note the **version** (from lock file or config).

## 2c: Architecture Detection

```
Detect:
- Directory structure (flat vs layered vs feature-based vs domain-driven)
- API layer (REST, GraphQL, tRPC, gRPC — check routes, resolvers, routers)
- Database (ORM config: Prisma schema, Drizzle config, TypeORM entities,
  SQLAlchemy models, ActiveRecord migrations, EF Core, GORM, Ecto)
- Auth (NextAuth/Auth.js, Passport, custom JWT, OAuth, Keycloak, Auth0,
  Clerk, Supabase Auth, Firebase Auth, Lucia)
- State management (Redux, Zustand, MobX, Jotai, Recoil, Pinia, Vuex, Signals)
- Styling (Tailwind config, CSS modules, styled-components, Sass, Emotion, Panda CSS)
- Queue/messaging (Bull, BullMQ, SQS, Service Bus, RabbitMQ, Kafka, Celery, Sidekiq)
- Caching (Redis config, Memcached, in-memory patterns)
- Search (Elasticsearch, OpenSearch, Algolia, Meilisearch, Typesense, AI Search)
- Realtime (Socket.io, SignalR, Pusher, Ably, SSE, Phoenix Channels, ActionCable)
- AI/ML (OpenAI, Anthropic, HuggingFace, Vercel AI SDK, LangChain, LlamaIndex)
- Observability (Sentry, DataDog, New Relic, Application Insights, Pino, Winston,
  structlog, OpenTelemetry)
- Payments (Stripe, Paddle, LemonSqueezy — check for webhook handlers)
- Email (SendGrid, Resend, Postmark, SES, Mailgun — check for templates)
```

## 2d: Convention Detection

Scan for patterns the team actually follows (not what they aspire to). Sample **at least 5 files** per pattern to distinguish one-off deviations from real conventions.

```
Detect:
- Naming: files (PascalCase vs kebab-case vs camelCase), DB tables, API routes
- Exports: default vs named (grep for "export default" frequency)
- Error handling: custom error classes, error boundaries, try/catch patterns,
  Result types, Either monads
- Validation: Zod, Yup, Joi, class-validator, io-ts, Valibot, ArkType
- Logging: structured vs console.log, logger library and call signature
- Testing: framework (Jest, Vitest, Pytest, Go test, RSpec, ExUnit),
  co-located vs separate test dirs, naming convention (.test.ts, .spec.ts, _test.go)
- Linting: ESLint/Biome config, Prettier, custom rules, auto-fix on save
- Git: conventional commits (check recent 20 commit messages), branch naming,
  PR templates, CODEOWNERS
- Code organization: barrel exports (index.ts), shared utils location,
  constants/config patterns, dependency injection
- Import style: absolute vs relative, path aliases, barrel re-exports
```

## 2e: Workflow Detection

```
Detect:
- CI/CD pipeline (what it runs: lint, test, build, deploy, type check)
- Deployment target (Vercel, AWS, Azure, GCP, Fly.io, Railway, Render, Netlify,
  Cloudflare, self-hosted k8s)
- Database migrations (tool + location of migration files)
- Seeding (seed scripts, fixture data)
- Environment management (how many envs, how secrets are managed)
- Pre-commit hooks (Husky, lint-staged, lefthook)
- Package scripts (all scripts in root package.json + key workspace scripts)
- Release process (semantic-release, changesets, manual tags) — destination: `bootstrap/step-21-release.md`'s `release` verdict (`fresh` / `already-bootstrapped` / `conflict`), which also writes the engine files; the finding itself is recorded as the `release` entry of this step's findings
```

## 2f: Pain Point Detection

Look for signs of technical debt or friction. **Categorize each finding** as it's detected — the category determines where it goes (CLAUDE.md Don'ts vs the backlog):

```
Detect:
- TODO/FIXME/HACK comments (count and categorize top 5 themes)
- Disabled lint rules (eslint-disable counts by rule — top 10)
- Type assertions (as any, as unknown, @ts-ignore, @ts-expect-error — counts + hotspot files)
- Dead code signals (unused exports, commented-out code blocks >5 lines)
- Dependency freshness (major versions behind on key deps)
- Test coverage gaps (dirs with code but no tests — list the dirs)
- Missing types (JS files in a TS project, untyped areas)
- Copy-paste patterns (near-duplicate files or functions — sample 3 if found)
- Inconsistency signals (same thing done 2+ different ways — e.g., both fetch and axios,
  both default and named exports in similar files)
```

### Pain point categorization

Each finding feeds into exactly one destination:

| Category | Test | Destination | Example |
|----------|------|-------------|---------|
| **Convention conflict** | Two patterns exist, one should win | Don't | "Both fetch and axios — standardize on fetch" |
| **Observed anti-pattern** | Pattern exists and is actively harmful | Don't | "47 `eslint-disable no-any` — don't use `any`" |
| **Security concern** | Existing pattern creates risk | Don't | "Tokens stored in localStorage" |
| **Missing infrastructure** | Something doesn't exist yet | Backlog | "No CI pipeline" |
| **Missing practice** | A healthy practice is absent | Backlog | "No tests in `src/utils/`" |
| **Stale dependency** | Key deps are behind | Backlog | "React 17 → 19 available" |
| **Dead code / tech debt** | Cleanup opportunity | Backlog | "12 commented-out blocks in {files}" |
| **Copy-paste / duplication** | Refactoring opportunity | Backlog | "3 near-duplicate handlers in {files}" |

**The distinction:** Convention conflicts and anti-patterns describe _how things are done wrong today_ — they become guardrails. Missing infrastructure and improvement opportunities describe _work to do_ — they become backlog items with Phase 2 context baked in.

## 2g: Existing AI Configuration (Initial Mode only)

Check for non-Claude AI config that might contain useful conventions to migrate:

```
Detect:
- .cursorrules, .cursor/ (Cursor IDE rules)
- .github/copilot-instructions.md (GitHub Copilot)
- .ai/, .aider*, coderabbit.yaml (other AI tools)
- Any of these contain useful conventions to preserve or migrate
```

If found, ask the user whether to **migrate and enhance** or **ignore**.

## 2h: Project Maturity Detection

Assess the project's maturity stage to inform the Philosophy section in CLAUDE.md. This determines the change philosophy — how aggressively to break, rebuild, and modernize vs. preserve, migrate, and maintain.

**Gather signals:**

> **Parallel execution:** Use parallel tool calls aggressively — all detection operations below are independent and should run concurrently.

| Signal | How to detect | Greenfield indicator | Brownfield indicator |
|--------|---------------|---------------------|---------------------|
| **Age** | `git log --reverse --format="%ai" -1` | < 3 months | > 6 months |
| **Migration history** | Glob for migration directories (prisma/migrations, db/migrate, alembic/versions, migrations/, etc.) | None found | Multiple migrations |
| **Production infrastructure** | Glob for k8s/, terraform/, .github/workflows/*deploy*, Dockerfile, docker-compose.yml | None found | Production deploy configs |
| **Monitoring/observability** | Grep for Sentry, DataDog, New Relic, Application Insights, OpenTelemetry | None found | Monitoring configured |
| **Contributor count** | `git shortlog -sn --no-merges \| wc -l` | 1-2 contributors | 3+ contributors |
| **API versioning** | Grep for `/v1/`, `/v2/`, `api-version`, version headers | No versioning | Versioned APIs |
| **Published packages** | Check for npm publish config, PyPI setup, gem spec, crate publish | Not published | Published/consumed |
| **User data signals** | Check for user tables with data, analytics, GDPR tooling, data exports | No user data patterns | User data management |
| **Environment count** | Count distinct environment configs (.env.production, .env.staging, etc.) | 0-1 environments | 2+ environments |
| **Schema management** | Check for `db:push` vs migration commands in scripts | Push-based or none | Migration-based |

**Classify the project:**

| Classification | Criteria | Change philosophy |
|---------------|----------|-------------------|
| **Greenfield** | < 3 months old, no migrations, no production infra, 1-2 contributors, no users | Break freely: rename columns, change types, restructure schemas, delete and rebuild |
| **Pre-launch** | Has structure but no production deploy, no user data, no monitoring | Break freely but with growing caution — foundations are solidifying |
| **Early production** | Has production infra and monitoring, but few users, limited migration history | Prefer correct solutions but be mindful of live data — migrations over push |
| **Established** | Multiple environments, migration history, published APIs, monitoring, user data | Expand-contract, safe migrations, backward compatibility, careful deprecation |

All signals feed into the maturity classification (greenfield → pre-launch → early production → established) which determines the Philosophy section content. Phase 3 is the single confirmation gate where the user confirms or overrides this classification.
