# M1 Recon: Railway daemon deployment and fork Postgres migrations

Read-only recon for kata issue a2bp (epic bgrz, run kata from the fork). Every claim
carries the command run or a file:line in this tree (fork main `1577ad9`). Dated
2026-09-13/14 UTC. Nothing on Railway, the hosted daemon, or its database was changed.

## Headline corrections to the epic's assumptions

| Assumed | Measured |
|---|---|
| Daemon build source unverified | Railway `kata-daemon` runs the **upstream release binary v0.15.1** (`kata_0.15.1_linux_amd64.tar.gz`), not 0.16.0 and not a repo build. |
| Postgres on service `agentsview-db` | The only Postgres service in `railway-infra` is `railway-infra-postgresql-server` (image `ghcr.io/railwayapp-templates/postgres-ssl:18`); the daemon reaches it as `postgres.railway.internal`. |
| Daemon API is 0.16.0-era | Health reports `api_schema_version 0.11.0`, `schema_version 25`. |
| 0.17.2 failed because of an apiVersion check | No check fired. 0.17.0 changed the generated client's `project_id` request field from int64 to **string** and the 0.15.1 daemon rejects it. |

## (a) Railway: project `railway-infra`, service `kata-daemon`

Source: `mcp__railway__list-projects`, `describe-environment`, `describe-service`
(kata-daemon `357ba7db-1ac0-4889-b405-46db17c3ad9c`, project
`f97bd6f2-dc51-4ac8-9032-97369479acc8`, env `production` `81441906-...`),
`list-deployments`, `get-logs` (build + deploy), plus
`curl https://kata-daemon-production.up.railway.app/api/v1/health`.

### Build: a `railway up` snapshot with a Dockerfile, not a repo or image link

- `describe-service` → `config.build.builder: RAILPACK`, `source: null` (no repo, no image).
  `describe-environment` shows `kata-daemon.source: null` while every other service names
  a repo or image.
- Build log of the live deployment `1c303f72` (2026-08-26T20:26Z): `fetching snapshot
  ... (728 B)`, then a 5-step Dockerfile: `FROM debian:bookworm-slim@sha256:88200866...`,
  `apt-get install curl ca-certificates`, `RUN curl -fsSL -o /tmp/kata.tar.gz
  https://github.com/kenn-io/kata/releases/download/v0.15.1/kata_0.15.1_linux_amd64.tar.gz
  && tar -xzf ... -C /usr/local/bin kata`, `COPY entrypoint.sh /entrypoint.sh`,
  `RUN chmod +x /entrypoint.sh`. Image digest
  `sha256:9de6fed331944200bb563135a8267e18919aec52f49e7d1e9e6869acbac6758d` (identical for
  the first deploy `bb30b8ad` and the live redeploy, all layers cached).
- The Dockerfile and `entrypoint.sh` are **not in any repo I could find**: not in
  `hsb3/railway-infra` (`gh api repos/hsb3/railway-infra/contents/` lists no kata dir; its
  `MOVED.md` covers pocketbase/provisioner only), not in `hsb3/kata-oversight/deploy/`
  (only `sweep/`), and `rg "kenn-io/kata/releases/download"` over `~/Developer` and
  `~/dotfiles` hits only Homebrew templates. The only description is
  `~/dotfiles/_docs/reference/kata-hosted-daemon.md:29`: "`entrypoint.sh` writes
  `config.toml` (`public_origin`) from the `PUBLIC_ORIGIN` env var at container start;
  listens on 8080". The 728-byte snapshot was uploaded from a local directory that is
  not tracked. **Not determined:** the exact entrypoint text and the exact
  `kata daemon start` flags.

### Running version

- `curl .../api/v1/health` →
  `{"ok":true,"db_path":"postgres://postgres.railway.internal/kata","schema_version":25,
  "api_schema_version":"0.11.0","version":"v0.15.1","uptime":"437h...",
  "started_at":"2026-08-26T20:26:25Z"}`.
- `kata health` (Homebrew 0.16.0 client) → `ok=true schema_version=25 ... db=postgres://postgres.railway.internal/kata`.
- Cross-check in this tree: `git show v0.15.1:internal/daemon/openapi.go` → `APISchemaVersion = "0.11.0"`;
  `git show v0.15.1:internal/db/schema_version.go` → `currentSchemaVersion = 25`. Consistent.

### Start command, port, health check, restart policy, volumes

- No `startCommand`, no `healthcheckPath`, no `restartPolicyType` in
  `describe-service.config.deploy` (only `runtime: V2`, `multiRegionConfig`
  `us-east4-eqdc4a: 1 replica`). Start command therefore comes from the image
  `ENTRYPOINT`/`CMD` (the untracked `entrypoint.sh`). Restart policy is Railway's
  default (not verified which). No Railway health check is configured; the daemon's
  unauthenticated probes are `GET /api/v1/health` and `/api/v1/ping`
  (`docs/operations/hosted-mode.md:53-62`).
- Port: service domain `kata-daemon-production.up.railway.app` → `targetPort 8080`.
  Deploy log first lines: `kata daemon: WARNING: listening on non-loopback TCP with
  bearer auth; operator has asserted private-network confidentiality.` then
  `kata daemon: listening on 0.0.0.0:8080`. That is the `$PORT` hosted-mode path:
  `cmd/kata/daemon_cmd.go:1783-1787` binds `0.0.0.0:$PORT` when `PORT` is set and
  `KATA_AUTOSTART` is not `1`.
- Volumes: none on `kata-daemon` (`volumeMounts: []`). `KATA_HOME` is therefore
  ephemeral container disk; all durable state is in Postgres.
- Postgres service `railway-infra-postgresql-server` (`cca90dc4-...`): image
  `ghcr.io/railwayapp-templates/postgres-ssl:18`, volume `postgres-volume`
  (`239ae56c-...`, 50000 MB) at `/var/lib/postgresql/data`, last deployed
  2026-08-26T20:25:55Z (same minute as the daemon redeploy).

### Environment variable names (values deliberately not fetched)

`describe-service.variableNames` for kata-daemon:
`KATA_AUTH_TOKEN`, `KATA_DSN`, `KATA_GITHUB_TOKEN`, `KATA_HOME`,
`KATA_POSTGRES_ALLOW_INSECURE`, `KATA_TRUST_PRIVATE_NETWORK`, `PUBLIC_ORIGIN`.
Shared (environment-level) names: `AGENTSVIEW_AUTH_TOKEN`, `AGENTSVIEW_CURSOR_SECRET`,
`KATA_AUTH_TOKEN`, `KATA_CURSOR_SECRET`, `RAILWAY_INFRA_POSTGRES_PASSWORD`.

What is absent matters: no `KATA_POSTGRES_SCHEMA_MODE`, no `KATA_POSTGRES_SCHEMA_OWNER`,
no `KATA_POSTGRES_SCHEMA`. So the daemon runs the **default `bootstrap` schema mode with
a single role** (`internal/db/pgstore/config.go:37-38` `DefaultConfig` = schema `kata`,
`SchemaModeBootstrap`; env override points at `internal/config/daemon_config.go:743-752`).
`PUBLIC_ORIGIN` is not read by kata itself (`rg '"PUBLIC_ORIGIN"' internal cmd` → no hit);
the entrypoint translates it into `[web].public_origin`.

### Postgres role

The 2026-08-26 crash loop (deployment `2574afec`, 02:07Z, repeated every ~1.5 s) logged:
`kata: postgres schema "kata" function "enforce_links_uid_consistency" owner "postgres"
does not match trusted owner "kata"`. That message is
`internal/db/pgstore/open.go:518-521` (`validateSchemaOwnership`), and in bootstrap mode
the trusted owner defaults to the **authenticated role** (`open.go:123-126`). So the DSN
role is `kata` and every object in schema `kata` must be owned by `kata`. Redeploys
`bb30b8ad` (00:49Z) and `d2e8f68d` (00:54Z) started cleanly; the ownership failure appeared
after something ran DDL as `postgres` in between. Deployment history: 13 deployments, all
on 2026-08-26 (first `deploy` 00:48Z, the rest `redeploy`), live one at 20:25Z.

### Live log state (2026-09-13/14)

Every deploy-log line in the last hours is `github sync binding failed`:
`binding_id=3` → `301 Moved Permanently ... api.github.com/repositories/1250814367`
(a repo that was renamed/transferred; kata's fetcher does not follow the redirect) and
`binding_id=6` → `not found`. Every 10 minutes. Pre-existing, unrelated to the cutover,
but the bindings live in the database and will carry over.

### The `kata-sweep` cron sidecar

- `describe-service` (`d9fb4b51-...`): source repo `hsb3/kata-oversight` branch `main`,
  builder `DOCKERFILE` at `deploy/sweep/Dockerfile`, `cronSchedule "0 6 * * *"`,
  `restartPolicyType NEVER`, variables `KATA_AUTH_TOKEN`, `KATA_SERVER`; last run
  2026-09-09T07:20Z SUCCESS.
- `gh api repos/hsb3/kata-oversight/contents/deploy/sweep/Dockerfile`: `FROM
  python:3.13-slim`, `COPY scripts/audit_board.py /app/audit_board.py`, `CMD python3
  /app/audit_board.py --post kata-oversight#dpsa`. **It bundles no kata binary.**
- `scripts/audit_board.py` (248 lines) uses `urllib` against: `GET /api/v1/projects`
  (l.97), `GET /api/v1/audit/closes?project_id=<id>[&no_evidence=true]` (l.111, 114),
  `GET /api/v1/digest?since=` (l.121), `GET /api/v1/issues?status=open&limit=0` (l.124),
  and posts a comment under `/api/v1/projects/<id>/issues/<ref>` (l.161). It passes
  numeric `project_id` query params, so any fork change to the audit/digest endpoints or
  to numeric project ids breaks it.
- Runbook: `hsb3/kata-oversight` `deploy/sweep/README.md` (read via `gh api`); it also
  records that `kata-daemon.railway.internal:8080` answers `400 host_invalid`, so the
  sidecar uses the public URL, and that `KATA_AUTH_TOKEN` is a reference to the daemon's
  variable.

## (b) Fork code: how Postgres migrations run

### Registry

`internal/db/pgstore/migrations.go:33-46` `migrationAssets`: `{25→26,
000026_external_root_bridges.up.sql}`, `{26→27, 000027_comment_teammate.up.sql}`;
embedded at lines 14-18. `migrationPath` (lines 54-79) walks the chain and errors
`no postgres migration path from schema_version N to M` when a link is missing.
Binary target: `internal/db/schema_version.go:8` `currentSchemaVersion = 27`.

### Where they run

- Daemon startup: `cmd/kata/daemon_cmd.go:719-733` builds `pgstore.ConfigFromValues(
  schema, mode, schema_owner, allow_insecure)` from `[storage.postgres]` (env fallbacks
  `internal/config/daemon_config.go:743-752`); `daemon_cmd.go:953`
  `storeopen.OpenWithConfig(ctx, dbPath, startup.StoreConfig, db.Serving())` →
  `internal/db/storeopen/storeopen.go:114` → `pgstore.OpenWithConfig`.
- `internal/db/pgstore/open.go:278-290` `prepareSchema`: `validate` mode only checks;
  `bootstrap` mode (the Railway default) calls `bootstrap()` (lines 295-395): advisory
  lock `pg_advisory_xact_lock(hashtextextended('kata:pgstore:migrations',0))` (l.455-457),
  `CREATE SCHEMA` + `REVOKE CREATE ... FROM PUBLIC` if missing (l.313-317), refuse a
  schema with tables but no `meta.schema_version` (l.334, 352), refuse a DB newer than
  the binary (l.355), then either install `schema.sql` (l.367-370) or apply
  `migrationPath(current, binary)` and `recordSchemaVersion` per step **inside one
  transaction** (l.374-383). Then `validateSchema` (l.461-483): ownership, runtime
  privileges, catalog manifest, exact version match (l.480).
- **Consequence for the cutover:** with the current env (no schema mode set), simply
  deploying a fork binary makes the daemon itself run 25→26→27 at first start, as the
  DSN role, under the advisory lock. That is the "in-place upgrade" path with zero extra
  commands, and also why the docs insist on stopping writers first.

### Explicit migrate / dry-run

- `kata storage postgres migrate` (`cmd/kata/storage_postgres.go:40-73`): forces
  `SchemaModeBootstrap` and opens the store, i.e. the same `bootstrap()` as the daemon.
  Flags: `--dsn`, `--schema` only (`kata storage postgres migrate --help` on 0.16.0;
  same flag set at lines 70-71 here). **No `--dry-run`.**
- `kata storage postgres status` (lines 75-108): forces `SchemaModeValidate` and opens
  `db.ReadOnly()`; no DDL, exits nonzero if version/owner/grants mismatch. Against the
  live DB with the fork binary it would report `postgres schema_version 25 does not match
  binary schema 27` (`open.go:480`), which is the closest thing to a pre-flight.
- `kata daemon --help` (0.16.0 and this tree's `daemon_cmd.go`) has no migrate
  subcommand; `kata daemon start` migrates implicitly in bootstrap mode.

### Role / owner requirement

- Bootstrap requires authenticated role == configured `schema_owner` when one is set
  (`open.go:127-131`); with none set the owner is the DSN role (`open.go:123-126`).
- `validateSchemaOwnership` (`open.go:506-560`) checks the namespace owner and every
  relation/function owner against the trusted owner and rejects `CREATE` grants to
  non-owners. `validateRuntimePrivileges` (`runtime_privileges.go:21-38`) needs USAGE,
  table DML, sequence USAGE/SELECT/UPDATE on 18 canonical sequences (l.12-17, includes
  `external_root_bindings_id_seq` and `external_field_mappings_id_seq`, which exist only
  from schema 26), and EXECUTE on `rewrite_project_uid_for_adoption(bigint,text)`.
- Therefore migrations 26/27 must run as role `kata` (the DSN role). Running them by
  hand as `postgres` recreates the 2026-08-26 crash loop.

### What 000026 and 000027 do

- `migrations/000026_external_root_bridges.up.sql`: creates `external_root_bindings`
  (identity PK, FKs to `projects`, `issues`, `import_mappings`, partial unique indexes on
  active issue and active `(connector_instance, external_root_key)`),
  `external_field_mappings`, `external_field_states`. Additive, no data rewrite, no
  changes to existing tables.
- `migrations/000027_comment_teammate.up.sql`: one statement, `ALTER TABLE comments ADD
  COLUMN teammate TEXT;` (nullable; `docs/operations/postgres.md:87-92`).
- Both are additive DDL; 25→27 on a small database is sub-second. No down migrations
  exist (`docs/development/postgres-migrations.md:33-36`).

### Documented upgrade ceremony (`docs/operations/postgres.md`)

- Lines 224-238: stop every daemon (advisory lock does not quiesce old-binary writes);
  take a native snapshot **and** `kata export` JSONL; run the new binary's
  `kata storage postgres migrate` as the schema owner; reapply/audit grants; run the new
  binary's `kata storage postgres status` with the runtime credential in `validate`
  mode; start the new daemon. Example commands lines 242-255 (`pg_dump --format=custom
  --schema=kata`).
- Rollback lines 260-279: no down migrations; restore the pre-upgrade snapshot into a
  clean database, restore roles/grants, run `status` with the **old** binary, restart the
  old binary. `pg_dump --schema=kata` excludes the `unaccent`/`vector` extensions and
  roles (l.276-279).
- Common failures table lines 281-291 maps `schema_version ... does not match`,
  `runtime role lacks ... privilege`, `no postgres migration path`.
- For the Railway single-role deployment the split-role steps collapse: same role
  migrates and serves (`postgres.md:12-14` allows this "for a small, trusted
  deployment"). Downtime = the redeploy window; Railway's zero-downtime overlap would run
  old 0.15.1 and new binaries concurrently against one DB for seconds, which the doc
  step 1 forbids. Scale to zero (or stop) before the new deploy, or accept the risk.

## (c) Client/daemon compatibility rules

### The only version check in the client

`cmd/kata/api_compat.go:12-19` constants: `apiVersionReadyAndSearchFilters "0.8.0"`,
`apiVersionGlobalListFilters "0.9.0"`, `apiVersionMCPServer "0.11.0"`.
`requireDaemonAPIVersionHealth` (l.40-72) GETs `/api/v1/health`, parses
`api_schema_version`, and fails **only if the daemon is older** than the required
floor (`apiVersionAtLeast`, l.74-89, lexical major.minor.patch, pre-release suffix
stripped). A newer daemon always passes. Callers: `ready_client.go:91`, `list.go:55`,
`search.go:83`, `mcp.go:218` (`kata mcp serve` needs ≥ 0.11.0, exactly what the hosted
daemon reports, which is why the plugin works today), and `teammate.go:33` /
`internal/mcp/handlers.go:628-631` (comment `--teammate` needs ≥ 0.18.0). Identical
constants at `v0.16.0:cmd/kata/api_compat.go:13-18`.

There is no schema_version check in the client; `schema_version` is display-only
(`cmd/kata/health.go:55-56`). Daemon-side, the only schema_version gate is federation
ingest (`internal/daemon/handlers_federation.go:654-662`).

### 0.16.0 client → schema-27 / API-0.18.0 fork daemon

Passes every floor above (0.18.0 ≥ 0.11.0). The 0.16.0 client sends numeric
`project_id` in its own request structs (`v0.16.0:cmd/kata/move.go:40`,
`github_sync.go:44,56`), and the fork daemon still declares those fields `int64`
(`HEAD:internal/api/events.go:49`, `federation.go:84,114`, `external_roots.go:143`).
The epic records that this direction was verified in rehearsal; the code shows no gate
that would block it. Not re-tested here (no fork binary against the hosted daemon).

### Why 0.17.2 failed against the 0.15.1 daemon (`project_id: invalid integer`)

- v0.17.0 release notes (`gh release view v0.17.0 --repo kenn-io/kata`): "Send simple
  remote `create`, `edit`, `comment`, and `label add` commands with one HTTP request
  instead of three. **Upgrade the remote daemon alongside the CLI because older daemons
  reject the new project selectors.**"
- Code: `git diff v0.16.0 v0.17.2 -- pkg/client` changes four request bodies from
  `ProjectID int64` to `ProjectID string ... validate:"required"`
  (`v0.17.2:pkg/client/generated/paths.go:184,202,374,403`); commit `ec3a945 Reduce
  remote CLI mutation round trips (#347)` plus new `cmd/kata/project_mutation.go`. The
  0.15.1 daemon still parses `project_id` as an integer, so it answers a validation error.
  `api_compat.go` never fires because 0.17.x's `APISchemaVersion` bump to `0.17.0`
  (`v0.17.0:internal/daemon/openapi.go:19`) added no client-side floor for the new
  selector. Version ladder measured: v0.15.1 API 0.11.0/schema 25; v0.16.0 API
  0.14.0/schema 26; v0.17.0-0.17.2 API 0.17.0/schema 26; fork HEAD API 0.18.0/schema 27.
- Consequence: daemon first, clients second, as the epic already says; and a fork client
  older than the daemon is safe while a client newer than the daemon is not.

## (d) State that must survive the cutover

- **Auth token**: `KATA_AUTH_TOKEN` on kata-daemon; `kata-sweep` references it
  (`README.md` in kata-oversight: `${{kata-daemon.KATA_AUTH_TOKEN}}`). Both Macs export
  `KATA_SERVER` and `KATA_AUTH_TOKEN` (`env | grep -o '^KATA_[A-Z_]*'` → `KATA_AUTH_TOKEN
  KATA_AUTHOR KATA_SERVER`). In-place upgrade keeps all of this untouched.
- **GitHub sync**: `KATA_GITHUB_TOKEN` env on the daemon (`docs/operations/github-sync.md:31-35`,
  must be a classic PAT per `~/dotfiles/claude-code/.claude/memory/reference-kata-hosted-daemon.md`);
  bindings are DB rows (`issue_sync_bindings`, sequence listed in
  `runtime_privileges.go:14`). Currently bindings 3 and 6 fail every cycle (see logs
  above); expect the same warnings after cutover, not new ones.
- **Hosted-mode settings**: `PORT`=8080 (Railway-injected, read at `daemon_cmd.go:1783`),
  `KATA_TRUST_PRIVATE_NETWORK` + `KATA_AUTH_TOKEN` gate the non-loopback bind
  (`docs/operations/hosted-mode.md:14-27`), `PUBLIC_ORIGIN` → `[web].public_origin` via
  the entrypoint (`hosted-mode.md:29-42` explains why it is a security input). A fork
  image must reproduce the entrypoint behaviour or set `[web].public_origin` another way.
- **TLS to Postgres**: `KATA_POSTGRES_ALLOW_INSECURE` is set because the private
  `postgres.railway.internal` link is plaintext; the fork keeps the same check
  (`open.go:201-229` `validatePostgresTransport`, `docs/operations/postgres.md:203-222`).
- **Federation**: no federation env vars on the service; the live deploy log shows the
  federation runner starting (`federation: federation runner leadership` at
  2026-08-26T20:26:59Z) but only as part of normal startup. Whether any hub/spoke
  enrollments exist in the DB was not queried (no DB access in this recon).
- **Embedded UI**: served by the same binary; nothing separate to migrate (epic text).
- **Backups**: no Railway volume on the daemon, so the only durable state is the
  `postgres-volume`. The doc's ceremony wants both `pg_dump --schema=kata` and
  `kata export` JSONL before touching schema 25.

## Not determined

1. The exact `entrypoint.sh` and Dockerfile text for kata-daemon (untracked local
   snapshot; only the build-log layer commands and the dotfiles doc summary exist).
2. Railway's effective restart policy for kata-daemon (unset in config; default not
   verified).
3. Whether federation enrollments or external-root bindings exist in the live DB (would
   need `kata storage postgres status`/psql with the DSN, which was out of scope).
4. Live behaviour of a 0.16.0 client against the fork daemon (rehearsal claim in the
   epic, not re-run here).
