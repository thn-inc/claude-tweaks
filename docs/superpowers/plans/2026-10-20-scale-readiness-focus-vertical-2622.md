# focus=scale-readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `/code-health focus=scale-readiness`, a ninth focus-mode vertical that statically flags pre-scale hardening gaps (queries, inline slow work, caching, pooling, monitoring) and always lists a manual k6 load-test row.

**Architecture:** One new generator module `plugin/bin/lib/code-health/candidates-scale-readiness.js`, modelled on `candidates-prelaunch.js` (checklist rows, `notApplicable` gate, `listTrackedFiles` discovery) and `candidates-security-hardening.js` (route-path heuristic, AI-call patterns). It registers itself in the shared `FOCUS_GENERATORS` registry. A `scale-readiness` criterion plus judge fragment, the `focus-mode.md` rows, and the docs count complete the registration set from `.claude/skills/code-health-focus-vertical/SKILL.md`.

**Tech Stack:** Node 18+ CommonJS, `node:test`, git (`git ls-files` discovery). No npm dependencies.

**Spec:** `.claude-tweaks/pipelines/2026-10-20T070358-record-2622/work/2622-spec.md` (record #2622)

**Scope keywords:** 2622, scale-readiness

## Global Constraints

- Focus key, criterion id and fragment basename are exactly `scale-readiness` / `scale-readiness` / `criteria-scale-readiness.md`.
- Static checks only: the generator never runs anything against a live app. The k6 load test is a `group: 'manual'` row.
- Every checklist row carries `phase: 'pre-launch'|'pre-scale'`: queries, background jobs and load test are `pre-launch`; caching, pooling and monitoring are `pre-scale`.
- `notApplicable: true` when the repo shows no server/data-access signal.
- `require('./focus-generators')` comes before `require('./candidates-dead-code')` in the new module (pitfall 1).
- Repo-level candidates anchor to a real file (`package.json#no-monitoring`), never a directory (pitfall 2).
- Fixtures use real framework layouts: Next.js App Router `app/api/**/route.ts`, Express `routes/`, a Prisma schema (pitfall 3).
- The fragment carries a row-status reconciliation rule (pitfall 4). `/review` participation is explicitly not carried (Deliverable 1).
- Commit messages say `refs #2622`, never `closes`/`fixes`.

## Review Focus

1. `Array.prototype.find`/`.map` on plain arrays inside a loop must not read as a DB query: the query regex needs a DB receiver (`prisma.<model>.`, `db.`/`pool.`/`client.`, or a capitalized model name). Pinned in Task 2 (`does not flag array .find inside a loop`).
2. Unbalanced brackets (an unclosed `for (`, a truncated file) must not throw or hang: every bracket scan is capped at `MAX_SCAN_CHARS`. Pinned in Task 2 (`unbalanced brackets do not throw`).
3. A malformed `package.json` must not throw; it contributes no dependencies. Pinned in Task 1.
4. CRLF line endings (Windows checkout) must not break Prisma schema parsing or line numbers. Pinned in Task 2 (`parses a CRLF prisma schema`).
5. Composite `@@index([a, b])` indexes only its leading column for a single-field `where`. Pinned in Task 2.

---

## File Structure

| File | Responsibility |
|---|---|
| `plugin/bin/lib/code-health/candidates-scale-readiness.js` (create) | Generator: discovery, applicability gate, eight candidate kinds, six-row checklist, registration |
| `plugin/bin/lib/code-health/focus-generators.js` (modify, autoload block at the end) | One `require('./candidates-scale-readiness');` line after `./candidates-app-store-readiness` |
| `plugin/bin/lib/code-health/criteria.js` (modify) | New `scale-readiness` entry with a scope comment; repoint the `:172` `#2622` comment |
| `plugin/skills/_shared/criteria-scale-readiness.md` (create) | Judge fragment |
| `plugin/skills/code-health/focus-mode.md` (modify) | Coverage pointer, Criterion pinning row, F1 checklist sentence, F2 not-applicable line (20,536 B now; rail 52,500 B, ~31 KB headroom) |
| `docs/getting-started.md` (modify, `/claude-tweaks:code-health` paragraph) | "nine verticals shipped" + `scale-readiness` |
| `candidates-{prelaunch,security-hardening,app-store-readiness}.js`, `criteria-{prelaunch,security-hardening,app-store-readiness}.md` (modify) | Repoint the `#2622` scope-boundary mentions to name `focus=scale-readiness` |
| `tests/bin-lib/code-health/candidates-scale-readiness.test.js` (create) | Generator tests |
| `tests/code-health-scale-readiness-wiring.test.js` (create) | Wiring test |

## Shared interfaces (all tasks)

- Module exports: `scanScaleReadiness(rootDir) -> { candidates, scannedFiles, skippedFiles, discoveryFailed, discoveryReason?, notApplicable, notApplicableReason?, checklist }`, `candidatesScaleReadiness(rootDir) -> candidates[]`, `CHECKLIST_ITEMS`, `isRouteFile(rel) -> boolean`, `NON_APP_SEGMENT_RE`.
- Candidate: `{ file, kind, evidence }`. Kinds: `query-in-loop`, `unbounded-list-query`, `unindexed-where-field`, `inline-slow-work`, `no-cache-layer`, `per-request-db-client`, `unbounded-pool`, `no-monitoring`.
- Checklist row: `{ id, label, group, phase, status, evidence }`, `status` one of `pass|fail|manual|n/a`.
- Scanner context `ctx` built once in `scanScaleReadiness`: `{ sourceTexts: [{ rel, text }], routeFiles: Set<string>, deps: Set<string>, packageFiles: string[], prismaSchemas: [{ rel, text }], anchorFile: string }`. Each check is `scanX(ctx, candidates)` and pushes candidates; `SCANNERS` is the ordered array the scan calls.

---

### Task 1: Generator skeleton, applicability gate, checklist, registration

**Files:**
- Create: `plugin/bin/lib/code-health/candidates-scale-readiness.js`
- Modify: `plugin/bin/lib/code-health/focus-generators.js` (append one autoload require line after `require('./candidates-app-store-readiness');`)
- Test: `tests/bin-lib/code-health/candidates-scale-readiness.test.js`

**Interfaces:**
- Produces: the module exports and `ctx` shape above; `SCANNERS` starts empty and Tasks 2–3 append to it.

- [ ] **Step 1: Write the failing tests** (helpers `tmpGitRepo()` and `write(root, rel, content)` copied from `tests/bin-lib/code-health/candidates-prelaunch.test.js:9-23`)

```js
test('AC2.3: a repo with no server signal is notApplicable with no candidates', () => {
  // root: package.json {"name":"lib","dependencies":{"lodash":"^4"}}, src/index.js exporting a helper
  const r = scanScaleReadiness(root);
  assert.equal(r.notApplicable, true);
  assert.equal(r.notApplicableReason, 'no server or data-access signal detected');
  assert.deepEqual(r.candidates, []);
  assert.deepEqual(r.checklist.map((x) => x.status), ['n/a', 'n/a', 'n/a', 'n/a', 'n/a', 'n/a']);
});
test('AC3.1: every firing lists the manual load-test row and a phase on every row', () => {
  // run on three repos: the notApplicable repo above, an applicable Express repo
  // (package.json deps {express}, routes/health.js), and a non-git tmp dir (discoveryFailed)
  for (const r of results) {
    assert.deepEqual(r.checklist.map((x) => x.id), ['queries', 'background-jobs', 'load-test', 'caching', 'pooling', 'monitoring']);
    assert.deepEqual(r.checklist.map((x) => x.phase), ['pre-launch', 'pre-launch', 'pre-launch', 'pre-scale', 'pre-scale', 'pre-scale']);
  }
  const loadTest = applicable.checklist.find((x) => x.id === 'load-test');
  assert.equal(loadTest.group, 'manual');
  assert.equal(loadTest.status, 'manual');
  assert.match(loadTest.evidence, /k6/);
});
test('a route file under tests/fixtures does not make a repo applicable', () => {
  // only tests/fixtures/app/api/users/route.ts + a dependency-free package.json
  assert.equal(scanScaleReadiness(root).notApplicable, true);
});
test('each applicability signal on its own makes a repo applicable', () => {
  // four repos: (a) app/api/users/route.ts only, (b) package.json dep "express",
  // (c) package.json dep "pg", (d) prisma/schema.prisma only -> each notApplicable === false
});
test('a malformed package.json contributes no dependencies and does not throw', () => {
  // package.json content '{ not json' plus src/index.js -> notApplicable === true, no throw
});
test('discovery failure is reported, not read as a clean repo', () => {
  // non-git tmp dir -> discoveryFailed === true, notApplicable === false, candidates []
});
test('isRouteFile recognizes App Router, pages/api, SvelteKit and route directories', () => {
  for (const f of ['app/api/users/route.ts', 'app/dashboard/route.js', 'src/app/api/x/route.ts', 'pages/api/users.ts', 'src/routes/api/+server.ts', 'routes/orders.js', 'src/handlers/user.ts', 'controllers/post.js']) assert.ok(isRouteFile(f), f);
  for (const f of ['lib/db.ts', 'src/components/Route.tsx', 'app/page.tsx']) assert.ok(!isRouteFile(f), f);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/code-health/candidates-scale-readiness.test.js`
Expected: FAIL with "Cannot find module '../../../plugin/bin/lib/code-health/candidates-scale-readiness'"

- [ ] **Step 3: Implement the skeleton in `candidates-scale-readiness.js`**

- Module header: purpose, a "Scope boundary vs. sibling verticals" paragraph (owns exactly the six checklist items; `scalability`/`observability` rotating criteria and the `prelaunch`/`security-hardening`/`app-store-readiness` verticals are out of scope), and a `Coverage (stated explicitly, never implied total — IL-110)` block. Tasks 2–3 add one Coverage bullet per check. Task 1 writes these bullets: discovery reuses `listTrackedFiles` with no extension filter; files under `NON_APP_SEGMENT_RE` are never scanned; per-file scans read JS/TS only (`/\.(jsx?|tsx?|mjs|cjs)$/`, minus `.d.ts`); route detection is a path heuristic (`isRouteFile`); applicability reads only route paths, `package.json` dependencies and `.prisma` files.
- Require order: `require('./focus-generators')`, then `require('./candidates-dead-code')` for `listTrackedFiles`.
- `NON_APP_SEGMENT_RE` = `candidates-prelaunch.js`'s `NON_SITE_SEGMENT_RE` plus `__mocks__|mocks?|\.next|\.nuxt|\.svelte-kit|\.output`.
- `isRouteFile(rel)`: false under `NON_APP_SEGMENT_RE`. True when the basename is `route.(js|ts|mjs)` (App Router), the basename is `+server.(js|ts)` (SvelteKit), the path has a `pages/api/` segment, or it matches `ROUTE_DIR_RE` re-derived from `candidates-security-hardening.js:148`: `/(^|\/)(routes?|api|handlers?|controllers?|endpoints?)\//i`. The source file must be JS/TS. Do not require the security-hardening module: copy and re-check the constant (pitfall 5). `app/dashboard/route.js` lives outside `api/`, which is why the basename rule exists.
- `CHECKLIST_ITEMS` in this exact order:
  `queries` "Query patterns (N+1, unpaginated lists, unindexed filters)" automated pre-launch kinds `['query-in-loop','unbounded-list-query','unindexed-where-field']`;
  `background-jobs` "Slow work off the request path" automated pre-launch `['inline-slow-work']`;
  `load-test` "Load test (k6: signup, login, main dashboard)" manual pre-launch;
  `caching` "Cache layer for DB-backed routes" automated pre-scale `['no-cache-layer']`;
  `pooling` "Connection pooling (shared client, capped pool)" automated pre-scale `['per-request-db-client','unbounded-pool']`;
  `monitoring` "Error tracking / APM" automated pre-scale `['no-monitoring']`.
- Applicability is true when any of the following holds: a route file exists; any non-excluded `package.json` lists (in `dependencies`/`devDependencies`) a name in `SERVER_DEPS` (`express, fastify, koa, @koa/router, hono, @hapi/hapi, @nestjs/core`) or `DATA_DEPS` (`@prisma/client, prisma, pg, postgres, mysql, mysql2, mongoose, mongodb, knex, drizzle-orm, sequelize, typeorm, kysely, better-sqlite3, @supabase/supabase-js, @neondatabase/serverless, @planetscale/database`); or a non-excluded `*.prisma` file exists. `next` alone is not a signal, because a static Next.js site has no server work. Wrap `JSON.parse` in try/catch.
- `anchorFile`: the shallowest non-excluded `package.json`; else the first route file; else the first `.prisma` file (by depth, then path).
- Result shape matches `candidates-prelaunch.js:293-450`. A discovery failure, or `notApplicable`, gives every row `status: 'n/a'` with `phase` kept. A manual row's evidence is `needs manual check — run a k6 load test against signup, login and the main dashboard; record p95 latency and error rate before and after (see criteria-scale-readiness.md)`. An automated row is `fail` with `${n} candidate(s)` when any candidate's kind is in its `kinds`, else `pass` with evidence from the scanner (`passEvidenceById`, default `no issues found`). Sort candidates by file, then evidence.
- `registerGenerator('scale-readiness', scanScaleReadiness);` and the one autoload line in `focus-generators.js`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/code-health/candidates-scale-readiness.test.js tests/bin-lib/code-health/candidates-require-order.test.js tests/code-health-prelaunch-wiring.test.js`
Expected: the first two files PASS. `code-health-prelaunch-wiring.test.js`'s registry-equality test FAILS until Task 4 adds the pinning row; note this, do not fix it here.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/code-health/candidates-scale-readiness.js plugin/bin/lib/code-health/focus-generators.js tests/bin-lib/code-health/candidates-scale-readiness.test.js
git commit -m "Add focus=scale-readiness generator skeleton — refs #2622"
```

### Task 2: Query checks

**Files:**
- Modify: `plugin/bin/lib/code-health/candidates-scale-readiness.js`
- Test: `tests/bin-lib/code-health/candidates-scale-readiness.test.js`

**Interfaces:**
- Consumes: `ctx`, `SCANNERS`, the `queries` checklist row from Task 1.
- Produces: `scanQueryInLoop`, `scanUnboundedListQuery`, `scanUnindexedWhereField`, appended to `SCANNERS`; `QUERY_CALL_RE`; `MAX_SCAN_CHARS = 4000`.

- [ ] **Step 1: Write the failing tests** (AC2.1/AC2.2: one positive and one negative fixture per kind, real layouts)

```js
test('AC2.1 AC2.2 query-in-loop: flags a Prisma call inside a for loop in an App Router route', () => {
  // app/api/users/route.ts: export async function GET(){ for (const id of ids) { await prisma.user.findUnique({ where: { id } }); } }
  // + package.json deps {"@prisma/client":"^5"}
  const c = scanScaleReadiness(root).candidates.filter((x) => x.kind === 'query-in-loop');
  assert.equal(c.length, 1);
  assert.equal(c[0].file, 'app/api/users/route.ts');
  assert.match(c[0].evidence, /app\/api\/users\/route\.ts:\d+/);
});
test('AC2.1 AC2.2 query-in-loop: flags a Mongoose call inside .map(async in an Express route', () => {
  // routes/orders.js: await Promise.all(ids.map(async (id) => Order.findOne({ _id: id })))
});
test('AC2.2 query-in-loop negative: a batched query outside the loop is not flagged', () => {
  // same route: const users = await prisma.user.findMany({ where: { id: { in: ids } }, take: 50 }); for (const u of users) { log(u) }
  // -> zero query-in-loop candidates
});
test('does not flag array .find inside a loop', () => {
  // for (const x of xs) { items.find((i) => i.id === x) } -> zero query-in-loop
});
test('AC2.1 AC2.2 unbounded-list-query: flags findMany with no take in an Express route', () => {
  // routes/users.js: router.get('/', async (req,res) => res.json(await prisma.user.findMany({ where: { active: true } })))
});
test('AC2.2 unbounded-list-query negative: findMany with take is not flagged', () => {
  // prisma.user.findMany({ take: 20 }); Sequelize User.findAll({ limit: 20 }); Mongoose User.find({}).limit(20) -> none flagged
});
test('AC2.1 AC2.2 unindexed-where-field: flags a where on an unindexed Prisma field', () => {
  // prisma/schema.prisma: model Post { id Int @id  authorId Int  title String }
  // app/api/posts/route.ts: prisma.post.findMany({ where: { authorId: userId }, take: 10 })
  const c = r.candidates.filter((x) => x.kind === 'unindexed-where-field');
  assert.equal(c.length, 1);
  assert.equal(c[0].file, 'app/api/posts/route.ts');
  assert.match(c[0].evidence, /Post\.authorId/);
  assert.match(c[0].evidence, /prisma\/schema\.prisma/);
});
test('AC2.2 unindexed-where-field negative: @@index, @unique and @id fields are not flagged', () => {
  // model Post { id Int @id  authorId Int  slug String @unique  @@index([authorId]) }; where { authorId }, where { slug }, where { id } -> none
});
test('a composite @@index covers only its leading column', () => {
  // @@index([authorId, createdAt]); where { createdAt } flagged, where { authorId } not flagged
});
test('parses a CRLF prisma schema', () => {
  // the positive unindexed-where-field fixture written with \r\n line endings -> same single candidate
});
test('unbalanced brackets do not throw', () => {
  // app/api/x/route.ts content: 'for (const a of b) { await prisma.user.findMany(' (truncated) -> scan returns, no throw
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/code-health/candidates-scale-readiness.test.js`
Expected: FAIL, with the query-kind assertions failing (0 candidates found)

- [ ] **Step 3: Implement the three scanners**

- `QUERY_CALL_RE` (global, read and write calls): `prisma.<model>.(findMany|findFirst|findUnique|findFirstOrThrow|findUniqueOrThrow|count|aggregate|groupBy|create|update|upsert|delete)(`; `(db|pool|client|sql|knex|connection|conn).(query|execute)(`; a capitalized receiver `[A-Z]\w*.(find|findOne|findById|findAll|findByPk|countDocuments)(`; `supabase.from(`.
- `findClose(text, openIdx, open, close)` returns the matching close index or `-1`. It is a depth counter with no string or comment awareness, capped at `MAX_SCAN_CHARS`. State that limitation in Coverage.
- `scanQueryInLoop`: loop openers `/\bfor\s*(?:await\s*)?\(|\bwhile\s*\(|\.(?:map|forEach|flatMap)\s*\(\s*async\b/g`. For `for`/`while`, the body is the brace-matched block after the condition's `)` when the next non-space char is `{`, else the text up to the next `;`. For `.map(async`, the body is the inside of the call's parens. Emit one candidate per query match inside a body (dedupe by file and line). Evidence: `${rel}:${line} query call inside a loop (${opener}) — N+1 pattern`. Scope: every `ctx.sourceTexts` file.
- `scanUnboundedListQuery`: `prisma.<m>.findMany(` and `[A-Z]\w*.findAll(` whose paren-matched args lack `/\b(take|limit)\s*:/`; a capitalized `X.find(` whose statement (up to the next `;`, at most 300 chars) lacks `.limit(`. Evidence names the call and `no take/limit`.
- `scanUnindexedWhereField`: parse each `ctx.prismaSchemas` text. Normalize `\r\n` first and strip `//` comments. For each `model Name { ... }`, collect scalar field names (`^\s*(\w+)\s+\w`, skipping `@@` lines). Indexed fields are those with `@id` or `@unique`, plus the first entry of each `@@id([..])`, `@@unique([..])` and `@@index([..])`. The client name is the lowerCamel model name. Over `ctx.sourceTexts`, find `prisma.<client>.<op>(`, take its args, and locate `where\s*:\s*{` at the args' top level. Collect the where object's depth-1 keys (`key:` and shorthand `key,`/`key }`), skipping `AND|OR|NOT`. Flag a key that is a known scalar field of that model and not indexed. Dedupe by (file, model, field). Evidence: `${rel}:${line} prisma.${client}.${op} filters on ${Model}.${field}, which has no @id/@unique/@@index in ${schemaRel}`.
- Coverage bullets: text-window and bracket-depth matching rather than an AST; JS/TS only; the recognized ORM/driver shapes; the index check is Prisma-schema-only and needs a schema file the generator can parse.
- `passEvidenceById.queries`: `${n} source file(s) checked, ${m} Prisma schema(s) parsed`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/code-health/candidates-scale-readiness.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/code-health/candidates-scale-readiness.js tests/bin-lib/code-health/candidates-scale-readiness.test.js
git commit -m "Add scale-readiness query checks — refs #2622"
```

### Task 3: Inline slow work, pooling, caching, monitoring

**Files:**
- Modify: `plugin/bin/lib/code-health/candidates-scale-readiness.js`
- Test: `tests/bin-lib/code-health/candidates-scale-readiness.test.js`

**Interfaces:**
- Consumes: `ctx`, `SCANNERS`, `QUERY_CALL_RE`, `findClose`, `MAX_SCAN_CHARS` from Task 2.
- Produces: `scanInlineSlowWork`, `scanPooling`, `scanCacheLayer`, `scanMonitoring`, appended to `SCANNERS`.

- [ ] **Step 1: Write the failing tests**

```js
test('AC2.1 AC2.2 inline-slow-work: flags an OpenAI call in an App Router route with no queue signal', () => {
  // app/api/summarize/route.ts: const out = await openai.chat.completions.create({...})
  const c = cands('inline-slow-work');
  assert.equal(c.length, 1);
  assert.equal(c[0].file, 'app/api/summarize/route.ts');
  assert.match(c[0].evidence, /AI call/);
});
test('AC2.1 AC2.2 inline-slow-work: flags an email send and a third-party fetch in an Express route', () => {
  // routes/signup.js: await resend.emails.send({...}); await fetch('https://api.example.com/x')
  // -> two candidates on routes/signup.js, evidence /email/ and /third-party fetch/
});
test('AC2.2 inline-slow-work negative: a queue signal in the route suppresses it', () => {
  // routes/signup.js: await emailQueue.add('welcome', {...}) next to resend.emails.send -> zero
  // also app/api/chat/route.ts using streamText(...) -> zero (streamed responses are request-bound by design)
});
test('inline-slow-work ignores slow calls outside route/handler files', () => {
  // lib/mailer.js with resend.emails.send -> zero
});
test('AC2.1 AC2.2 per-request-db-client: flags new PrismaClient inside a handler', () => {
  // app/api/users/route.ts: export async function GET(){ const prisma = new PrismaClient(); ... }
});
test('AC2.2 per-request-db-client negative: a module-scope client is not flagged', () => {
  // const prisma = new PrismaClient(); export async function GET(){ ... } -> zero
});
test('AC2.1 AC2.2 unbounded-pool: flags a pg Pool with no max', () => {
  // lib/db.ts: export const pool = new Pool({ connectionString: process.env.DATABASE_URL })
  // + package.json deps {"pg":"^8"}
});
test('AC2.2 unbounded-pool negative: a capped pool is not flagged', () => {
  // new Pool({ connectionString, max: 10 }); mysql.createPool({ connectionLimit: 5 }); new MongoClient(url, { maxPoolSize: 20 }) -> zero
});
test('AC2.1 AC2.2 no-cache-layer: DB-backed routes with no cache signal anchor to package.json', () => {
  // package.json deps {"@prisma/client":"^5"}; routes/users.js with prisma.user.findMany({ take: 10 })
  const c = cands('no-cache-layer');
  assert.equal(c.length, 1);
  assert.equal(c[0].file, 'package.json');
});
test('AC2.2 no-cache-layer negative: a redis dependency or unstable_cache counts as a cache layer', () => {
  // two variants: deps add "ioredis"; or a route using unstable_cache(...) -> zero
});
test('AC2.1 AC2.2 no-monitoring: a server repo with no error-tracking dependency anchors to package.json', () => {
  // package.json deps {"express":"^4"}; routes/health.js
  const c = cands('no-monitoring');
  assert.equal(c.length, 1);
  assert.equal(c[0].file, 'package.json');
});
test('AC2.2 no-monitoring negative: @sentry/node counts as monitoring', () => {});
test('a clean Express + Prisma repo passes every automated row', () => {
  // module-scope client, take on findMany, @@index on filtered field, ioredis + @sentry/node deps, queue signal
  // -> candidates [], automated rows all 'pass', load-test 'manual'
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/code-health/candidates-scale-readiness.test.js`
Expected: FAIL, with the new kinds' assertions failing (0 candidates found)

- [ ] **Step 3: Implement the four scanners**

- `scanInlineSlowWork` runs over route files only. It has three categories, each emitting at most one candidate per file, at the first match's line. AI call: `chat.completions.create(`, `responses.create(`, `messages.create(`, `embeddings.create(`, `createChatCompletion(`, `generateText(`, `generateObject(`; re-derive these from `AI_CALL_PATTERNS` at `candidates-security-hardening.js:166`. `streamText`/`streamObject` are excluded and say so in Coverage. Email: `.sendMail(`, `emails.send(`, `sgMail.send(`, `sendEmail(`, `SendEmailCommand`. Third-party fetch: `fetch(`, `axios(` or `axios.<verb>(`, `got(`, `ky(` whose first argument is a string literal starting `http://` or `https://`. A file is suppressed by a queue signal: `/\b(bullmq|bee-queue|inngest|@trigger\.dev|qstash|pg-boss|graphile-worker|SendMessageCommand|enqueue\w*|waitUntil)\b|\b\w*[qQ]ueue\.add\s*\(|\bnew\s+Queue\s*\(|\bafter\s*\(\s*(?:async\b|\()/`. Evidence: `${rel}:${line} ${category} on the request path with no queue/background-job signal in the file`, where category is `AI call`, `email send` or `third-party fetch`.
- `scanPooling`. `per-request-db-client` runs over route files: `new PrismaClient(`, `new Pool(`, `new Client(`, `new MongoClient(`, `mysql.createConnection(`/`createPool(`, `postgres(`, at brace depth > 0. Depth is `{` minus `}` counted before the match, capped at `MAX_SCAN_CHARS`. `unbounded-pool` runs over all source: `new Pool(` with args lacking `max:`, `createPool(` lacking `connectionLimit`, and `new MongoClient(` lacking `maxPoolSize`. Evidence names the driver default (`pg default max 10 per instance`).
- `scanCacheLayer`. DB-backed route files are route files matching `QUERY_CALL_RE`. With none, pass evidence is `no DB-backed routes detected`. Otherwise flag when neither `ctx.deps` holds a cache dep (`redis, ioredis, @upstash/redis, @vercel/kv, lru-cache, node-cache, keyv, cache-manager, memcached`) nor any source matches `/unstable_cache|['"]use cache['"]|export\s+const\s+revalidate|Cache-Control|s-maxage/`. The candidate anchors to `ctx.anchorFile`, with evidence `${n} DB-backed route file(s) (e.g. ${first}) and no cache-layer signal (looked for: ...)`.
- `scanMonitoring` flags when `ctx.deps` holds no name matching `/^(@sentry\/|@bugsnag\/|rollbar$|@honeybadger-io\/|newrelic$|dd-trace$|@datadog\/|@opentelemetry\/|@highlight-run\/|@appsignal\/|elastic-apm-node$|raygun$|@airbrake\/)/`. It anchors to `ctx.anchorFile`.
- Coverage bullets for each: route-file-only scopes, a queue signal anywhere in the file suppresses everything, presence not quality for the repo-level signals, and the dependency lists named.
- `passEvidenceById` for `background-jobs`, `caching`, `pooling`, `monitoring`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/code-health/candidates-scale-readiness.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/code-health/candidates-scale-readiness.js tests/bin-lib/code-health/candidates-scale-readiness.test.js
git commit -m "Add scale-readiness slow-work, pooling, caching and monitoring checks — refs #2622"
```

### Task 4: Criterion, fragment, focus-mode rows, docs, sibling repoints, wiring test

**Files:**
- Modify: `plugin/bin/lib/code-health/criteria.js` (append after the `app-store-readiness` entry; repoint `:172`)
- Create: `plugin/skills/_shared/criteria-scale-readiness.md`
- Modify: `plugin/skills/code-health/focus-mode.md` (`## Coverage` paragraph, `## Criterion pinning` table, the F1 `checklist` sentence, the `## F2` paragraph)
- Modify: `docs/getting-started.md` (the `/claude-tweaks:code-health` paragraph)
- Modify: `plugin/bin/lib/code-health/candidates-prelaunch.js:14`, `candidates-security-hardening.js:31`, `candidates-app-store-readiness.js:18`, `plugin/skills/_shared/criteria-prelaunch.md:59`, `criteria-security-hardening.md:41`, `criteria-app-store-readiness.md:34`
- Test: `tests/code-health-scale-readiness-wiring.test.js`

**Interfaces:**
- Consumes: `CHECKLIST_ITEMS` and the eight kind names from Tasks 1–3.

- [ ] **Step 1: Write the failing wiring test** (shape of `tests/code-health-agent-trust-scope-wiring.test.js:74-81`, plus its `section()` helper)

```js
test('AC1.1: FOCUS_GENERATORS lists scale-readiness', () => {
  const out = execFileSync(process.execPath, ['-e', "console.log(Object.keys(require('./plugin/bin/lib/code-health/focus-generators.js').FOCUS_GENERATORS).join(', '))"], { cwd: ROOT, encoding: 'utf8' });
  assert.match(out, /\bscale-readiness\b/);
});
test('the scale-readiness criterion is registered with its fragment', () => {
  assert.deepStrictEqual(getCriterion('scale-readiness'), { id: 'scale-readiness', appliesTo: ['backend', 'data'], confidenceFloor: 'medium', fragment: 'criteria-scale-readiness.md' });
});
test('AC4.1: focus-mode.md pins scale-readiness and points Coverage and F2 at it', () => {
  assert.match(section(FOCUS_MODE, 'Criterion pinning', 'F0'), /^\| `scale-readiness` \| `scale-readiness` \| `criteria-scale-readiness\.md` \|$/m);
  assert.match(section(FOCUS_MODE, 'Coverage', 'Criterion pinning'), /candidates-scale-readiness\.js/);
  assert.match(section(FOCUS_MODE, 'F2', 'F3'), /focus=scale-readiness: not applicable — no server or data-access signal detected/);
});
test('AC4.1: docs/getting-started.md says nine verticals shipped and names scale-readiness', () => {
  assert.match(docs, /nine verticals shipped/);
  assert.match(docs, /`scale-readiness`/);
});
test('AC4.1: the fragment names every kind and checklist id, the reconciliation rule, and the scalability overlap', () => {
  // every kind from Tasks 1-3 and every CHECKLIST_ITEMS id appears in backticks
  assert.match(fragment, /`fail` whose candidates you all rejected → `pass \(N rejected: \{reason\}\)`/);
  assert.match(fragment, /open `scalability` issue at the same anchor/);
  assert.match(fragment, /`pre-launch`/);
  assert.match(fragment, /`pre-scale`/);
});
test('every #2622 mention under plugin/ names focus=scale-readiness on the same line', () => {
  // git grep -n '#2622' -- plugin -> every hit line also contains 'scale-readiness'; at least 6 hits
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/code-health-scale-readiness-wiring.test.js`
Expected: FAIL with "getCriterion('scale-readiness')" deepStrictEqual against `undefined`

- [ ] **Step 3: Land the registration rows**

- `criteria.js`: add `{ id: 'scale-readiness', appliesTo: ['backend', 'data'], confidenceFloor: 'medium', fragment: 'criteria-scale-readiness.md' }`, with a comment naming the six checks and the scope against `scalability`/`observability` and the sibling verticals. Repoint the `:172` comment to "`focus=scale-readiness` (#2622, pre-scale)".
- `criteria-scale-readiness.md`: follow `criteria-prelaunch.md`'s section order.
  - "What the generator hands you": the eight kinds, and the repo-level anchor rule `{file}#{kind}`, e.g. `package.json#no-monitoring`.
  - "The checklist": a table with columns Item / Phase / Group / How it is checked, covering all six ids. Include a sentence that the pre-launch subset (queries, background jobs, load test) and the pre-scale subset (caching, pooling, monitoring) are reported separately.
  - "What to flag" and "What NOT to flag". The latter must cover: a loop over a small fixed-size input; `findMany` on a bounded admin/seed path; a `streamText` response; a serverless platform's own pooling (Prisma Accelerate, a Neon/Supabase pooler URL); a CDN/edge cache configured outside the repo.
  - "Severity calibration": high is `query-in-loop` or `per-request-db-client` in a route, and `inline-slow-work` for an AI call on a user-facing route. Medium is `unbounded-list-query`, `unindexed-where-field`, email/fetch `inline-slow-work`, `no-monitoring`, and `unbounded-pool` on serverless. Low is `no-cache-layer`, and `query-in-loop` in a script with bounded input.
  - "Scope boundary". Before filing a `query-in-loop`/`unbounded-list-query`/`unindexed-where-field` finding, treat an open `scalability` issue at the same anchor as covered (reject with `covered by open scalability issue #N`). Treat an open `observability` issue the same way for `no-monitoring`. Fingerprints differ by criterion (`fingerprint.js:36-43`) and `dedup.js` matches fingerprints only. On a generalist (non-focus) slice, a finding that fits `scalability` or `observability` files under that criterion, never this one. AI-endpoint auth and rate-limiting belongs to `security-hardening`; site launch items belong to `prelaunch`.
  - "Manual item — load test": a k6 run against signup, login and the main dashboard, recording p95 and error rate before and after. Never machine-judged.
  - "Reporting": `| Item | Phase | Group | Status | Evidence |`, with the pre-launch rows grouped before the pre-scale rows, and the three reconciliation bullets copied from `criteria-prelaunch.md`'s Reporting section.
  - "What this vertical never does".
- `focus-mode.md`:
  - Append to `## Coverage`: "For `scale-readiness`, the Coverage block at the top of `bin/lib/code-health/candidates-scale-readiness.js` (…one-clause summary per check…)".
  - Add the pinning row `| \`scale-readiness\` | \`scale-readiness\` | \`criteria-scale-readiness.md\` |` after `app-store-readiness`.
  - In F1, widen the `checklist` sentence to name `scale-readiness` and its extra `phase` field.
  - In F2, add: "`scale-readiness` sets `notApplicable: true` when the repo shows no server or data-access signal — report exactly `focus=scale-readiness: not applicable — no server or data-access signal detected (scanned: <scannedFiles> files)` and stop. A zero-candidate `scale-readiness` firing is still reported with its checklist (the manual load-test row still needs a human)."
- `docs/getting-started.md`: change "eight verticals shipped" to "nine verticals shipped" and append `` and `scale-readiness` `` to the list (keep the Oxford-comma form).
- Sibling repoints: replace each "#2622's pre-scale hardening" with "`focus=scale-readiness`'s pre-scale hardening (#2622)", keeping each surrounding parenthetical.

- [ ] **Step 4: Run the wiring and neighbor suites**

Run: `node --test tests/code-health-scale-readiness-wiring.test.js tests/code-health-prelaunch-wiring.test.js tests/code-health-agent-trust-scope-wiring.test.js tests/code-health-app-store-readiness-wiring.test.js tests/bin-lib/code-health/criteria.test.js`
Expected: PASS (AC1.2: the prelaunch wiring's pinning-table/registry equality passes with the new row)

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/code-health/criteria.js plugin/skills/_shared/criteria-scale-readiness.md plugin/skills/code-health/focus-mode.md docs/getting-started.md plugin/bin/lib/code-health/candidates-prelaunch.js plugin/bin/lib/code-health/candidates-security-hardening.js plugin/bin/lib/code-health/candidates-app-store-readiness.js plugin/skills/_shared/criteria-prelaunch.md plugin/skills/_shared/criteria-security-hardening.md plugin/skills/_shared/criteria-app-store-readiness.md tests/code-health-scale-readiness-wiring.test.js
git commit -m "Wire focus=scale-readiness criterion, fragment and docs — refs #2622"
```

### Task 5: Verification (folded into build Common Step 5)

- [ ] **Step 1: Revert probes (AC5.1).** For each automated kind, temporarily neutralize its scanner's push line (`git show HEAD:<file>` stays the baseline) and run the generator test file. The kind's positive test must FAIL; then restore. Do the same for the wiring test by deleting the F2 line and the pinning row in turn. Record each probe's failing test name in the task report.
- [ ] **Step 2: Real-input probe.** Run `node -e "const r=require('./plugin/bin/lib/code-health/candidates-scale-readiness.js').scanScaleReadiness(process.cwd()); console.log(JSON.stringify({na:r.notApplicable, reason:r.notApplicableReason, n:r.candidates.length, scanned:r.scannedFiles}))"` from the worktree root. Expected: `na:true`, `reason:"no server or data-access signal detected"`, `n:0`. This repo has no route files, no server or DB dependencies, and no `.prisma` file; `plugin/bin/lib/visual-decide/server.js` uses only `node:http`.
- [ ] **Step 3: Full suite (AC6.1).** Run `npm test > {session-scratchpad}/scale-readiness-npm-test.txt 2>&1; echo exit=$?` (the orchestrator runs this centrally, never a dispatched implementer). Expected: `exit=0`.

## AC coverage outside test steps

Waived AC1.2: an existing test (`tests/code-health-prelaunch-wiring.test.js`'s registry-equality test), re-run in Task 4 Step 4, not a new test.
Waived AC5.1: a verification activity (Task 5 Step 1 revert probes), not a test assertion.
Waived AC6.1: the full-suite run in Task 5 Step 3, owned by the orchestrator's Common Step 5.

## Build deviations (Common Step 4.5, classified Beneficial)

The spec's architecture held: one focus vertical generator registered in `FOCUS_GENERATORS`, a pinned criterion and fragment, static checks only, the six phased checklist rows. The whole-branch review's probes of real layouts produced these implementation-level deviations from this plan. Each is kept as built and disclosed in the module's Coverage block.

1. A file matched only by `ROUTE_DIR_RE` counts as a route only when its nearest non-excluded `package.json` declares a `SERVER_DEPS`/`DATA_DEPS` entry. Framework-explicit shapes (`route.*`, `pages/api/`, `+server.*`) stay unconditional. This is pitfall 5: the copied directory gate read Vite/TanStack `src/routes/` and browser `src/api/` clients as server code.
2. A module whose first statement is a `"use server"` directive is a handler (Next.js server actions).
3. Prisma calls are recognized through any receiver chain whose segment before the op is a known schema model (T3 `ctx.db.post.findMany`), through `prisma`/`db` receivers when no schema parses, and across `?.`/`!.` separators.
4. Seed files (`prisma/seed.*`, `seed(s)/`) are skipped by the query checks.
5. `unbounded-list-query` accepts only a top-level `take`/`limit` key. Mongoose `.limit(` is read from the call's own chain. `CONST.find(fn)` with a function argument is not a query.
6. Any `.map(`/`.forEach(`/`.flatMap(` callback counts as a loop body, not only an `async` one.
7. Cache-disabling directives (`revalidate = 0`, `no-store`/`no-cache`/`max-age=0`) do not count as a cache layer.
8. An SMS send (Twilio) is its own `inline-slow-work` category, not an AI call.
9. The `"use server"` leading-trivia check is a linear hand-written scan. A regex alternation backtracked catastrophically on a `////…` first line.
