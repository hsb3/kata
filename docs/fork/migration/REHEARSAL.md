# M3 Staging rehearsal: hosted dump, 25 → 27 migration, compatibility matrix

Rehearsal for kata issue `8r2y` (epic `bgrz`). Run on BigMac 2026-09-14 UTC against fork
`main` `13b9bf2`, from worktree `.worktrees/migration-rehearsal` (branch
`fork/migration-rehearsal`). Every command below was executed unless it is explicitly
marked "not executed".

**Nothing on Railway changed.** Only `SELECT` and `pg_dump` ran against the hosted
database. No fork binary and no fork image ever received the hosted DSN or `KATA_SERVER`.
The Homebrew 0.16.0 client was pointed only at `http://127.0.0.1:18090`.

Result in one line: both the host binary and the container image migrate a real copy of
the hosted board from schema 25 to 27 in well under a second with zero row loss, the
0.16.0 client and the fork MCP server both work against the migrated daemon, and the
rollback is a 1.7 s `pg_restore`.

## 0. Scratch layout and tool substitutions

| Thing | Value |
|---|---|
| Scratch root | `/tmp/kata-9bhq` (mode 700) |
| Fork binary | `/tmp/kata-9bhq/kata-m3`, `go build -o … ./cmd/kata` from the worktree |
| Fork image | `kata-fork:m2-amd64` (built in M2, `docs/fork/migration/BUILD.md`) |
| Throwaway DB | docker `postgres:18`, published on `127.0.0.1:15432` |
| Daemon homes | `/tmp/kata-9bhq/m3home` (host), `/tmp/kata-9bhq/ctrhome` (container) |

Two substitutions were forced and are recorded because they change how the commands read:

- **The Railway MCP server was not available to this run.** `mcp__railway__list-variables`
  and its siblings answered `No such tool available: … Its MCP server 'railway' is
  connected but does not offer this tool here.` Variable *names* were therefore read with
  the local CLI instead, which is still a read. No mutation command was issued.
- **The local `pg_dump` is older than the server.** `pg_dump (PostgreSQL) 17.10
  (Postgres.app)` against `PostgreSQL 18.6` would abort on the version check, so every
  `pg_dump`/`psql`/`pg_restore` in this document runs inside `docker run --rm postgres:18`.

## 1. Hosted database: endpoint discovery and read-only dump

### Endpoint

The daemon's `KATA_DSN` points at `postgres.railway.internal`, which is unreachable from a
Mac. The public route is the Postgres service's TCP proxy:

```sh
mkdir -p /tmp/kata-9bhq/rw && cd /tmp/kata-9bhq/rw
railway link --project railway-infra \
  --service railway-infra-postgresql-server --environment production
railway variables --json > /tmp/kata-9bhq/rw/vars.json
chmod 600 /tmp/kata-9bhq/rw/vars.json
jq -r 'keys[]' /tmp/kata-9bhq/rw/vars.json
```

`--service` was passed explicitly on every `railway link`; a bare `link` can repoint a live
service. Variable names present on `railway-infra-postgresql-server`:

```
DATABASE_URL  PGDATA  PGDATABASE  PGHOST  PGPASSWORD  PGPORT  PGUSER
POSTGRES_DB  POSTGRES_PASSWORD  POSTGRES_USER
RAILWAY_DEPLOYMENT_DRAINING_SECONDS  RAILWAY_ENVIRONMENT  RAILWAY_ENVIRONMENT_ID
RAILWAY_ENVIRONMENT_NAME  RAILWAY_PRIVATE_DOMAIN  RAILWAY_PROJECT_ID
RAILWAY_PROJECT_NAME  RAILWAY_SERVICE_AGENT_BUS_URL  RAILWAY_SERVICE_ID
RAILWAY_SERVICE_KATA_DAEMON_URL  RAILWAY_SERVICE_NAME
RAILWAY_SERVICE_OBSIDIAN_HEADCASE_URL  RAILWAY_SERVICE_OBSIDIAN_URL
RAILWAY_TCP_APPLICATION_PORT  RAILWAY_TCP_PROXY_DOMAIN  RAILWAY_TCP_PROXY_PORT
RAILWAY_VOLUME_ID  RAILWAY_VOLUME_MOUNT_PATH  RAILWAY_VOLUME_NAME  SSL_CERT_DAYS
```

No value was printed at any point. The connection parameters were materialised into a
mode-600 shell fragment and consumed through the environment:

```sh
umask 077
jq -r '"export HOSTED_PGHOST=\(.RAILWAY_TCP_PROXY_DOMAIN)\n…"' \
  /tmp/kata-9bhq/rw/vars.json > /tmp/kata-9bhq/pgenv.sh   # mode 600
set -a; . /tmp/kata-9bhq/pgenv.sh; set +a
export PGPASSWORD="$HOSTED_PGPASSWORD"

run() { docker run --rm -e PGPASSWORD \
  -e PGHOST="$HOSTED_PGHOST" -e PGPORT="$HOSTED_PGPORT" \
  -e PGUSER="$HOSTED_PGUSER" -e PGDATABASE=kata -e PGSSLMODE=require \
  postgres:18 psql "$@"; }
```

`-e PGPASSWORD` without a value makes Docker read it from the environment, so the secret
never reaches a command line. `sslmode=require` (not `verify-full`): the Railway TCP proxy
presents a certificate this run could not pin to a CA, and the alternative was plaintext.

Note the account used for reading is the Postgres service's own superuser, **not** the
daemon's `kata` role. The `kata` credential lives only in the daemon service's `KATA_DSN`
and was deliberately not fetched.

### What is there

```console
$ run -Atc 'select version()'
PostgreSQL 18.6 (Debian 18.6-1.pgdg13+2) on x86_64-pc-linux-gnu, …

$ run -c '\dn'
      List of schemas
  Name  |       Owner
--------+-------------------
 kata   | kata
 public | pg_database_owner

$ run -c 'SELECT * FROM kata.meta ORDER BY key'
        key         |           value
--------------------+----------------------------
 created_by_version | 0.1.0
 instance_uid       | 01M0MZ0HA96JH21KGQJHD8DJ22
 schema_version     | 25
```

The schema name is `kata` as RECON predicted, owned by role `kata`, 22 tables.

### Row counts (hosted, read-only `SELECT count(*)`)

```console
$ run -c "SELECT 'projects' AS tbl, count(*) FROM kata.projects UNION ALL …"
          tbl           | count
------------------------+-------
 api_tokens             |     2
 comments               |  5591
 events                 | 28055
 federation_bindings    |     0
 federation_enrollments |     0
 import_mappings        |  4558
 issue_labels           |  6544
 issues                 |  4357
 issue_sync_bindings    |    11
 issue_sync_status      |    11
 links                  |  2930
 projects               |    52
```

This answers RECON's open question 3: **no federation enrollments or bindings exist** in
the live database, so the cutover has no federation state to worry about.

### The dump

```console
$ /usr/bin/time -p docker run --rm -e PGPASSWORD … -v /tmp/kata-9bhq:/out postgres:18 \
    pg_dump --schema=kata --no-owner --no-privileges -Fc -f /out/hosted-schema25.dump
real 9.21

$ ls -l /tmp/kata-9bhq/hosted-schema25.dump
29791728 bytes (28.4 MiB)
$ shasum -a 256 /tmp/kata-9bhq/hosted-schema25.dump
9f4b7e77a9fc50c64edd3eb16c0bff3143e2943b26640a25811e5fe840000db5
```

A plain `-Fp` copy was also taken (7.59 s, 84 MB) purely to inspect the DDL, then deleted;
it confirmed the documented extension gap:

```console
$ grep -n 'public.unaccent' hosted-schema25.sql | head -2
220:    ADD MAPPING FOR word WITH public.unaccent, simple;
```

i.e. the archive references `public.unaccent` but does not create it
(`docs/operations/postgres.md:276-279`). A restore into a database without that extension
fails.

**The dump file is kept** at `/tmp/kata-9bhq/hosted-schema25.dump`. It is a full copy of
the board including `api_tokens` rows, so it is not a file to leave lying around
indefinitely — Henry decides whether to keep it or move it under
`~/.local/share/agent-artifacts/kata/`.

## 2. Restore into a throwaway Postgres

```sh
docker run -d --name kata-rehearsal-pg \
  -e POSTGRES_USER=kata -e POSTGRES_PASSWORD=kata -e POSTGRES_DB=kata \
  -p 15432:5432 postgres:18
docker exec kata-rehearsal-pg psql -U kata -d kata \
  -c 'CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA public;'
docker cp /tmp/kata-9bhq/hosted-schema25.dump kata-rehearsal-pg:/tmp/
docker exec kata-rehearsal-pg pg_restore -U kata -d kata \
  --no-owner --no-privileges /tmp/hosted-schema25.dump
```

`POSTGRES_USER=kata` makes `kata` the authenticated role, and `--no-owner` makes every
restored object land owned by it — the condition the 2026-08-25 crash loop violated when
DDL ran as `postgres`.

```console
real 1.80                                   # pg_restore

$ docker exec … psql -U kata -d kata -Atc "SELECT value FROM kata.meta WHERE key='schema_version'"
25

$ docker exec … psql -U kata -d kata -c "SELECT 'projects' …"
         tbl         | count
---------------------+-------
 api_tokens          |     2
 comments            |  5591
 events              | 28055
 import_mappings     |  4558
 issue_labels        |  6544
 issues              |  4357
 issue_sync_bindings |    11
 issue_sync_status   |    11
 links               |  2930
 projects            |    52

$ docker exec … psql -U kata -d kata -Atc \
    "SELECT c.relname, pg_get_userbyid(c.relowner) FROM pg_class c
     JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname='kata' AND pg_get_userbyid(c.relowner) <> 'kata'"
                                            # no rows
$ docker exec … psql -U kata -d kata -Atc \
    "SELECT nspname, pg_get_userbyid(nspowner) FROM pg_namespace WHERE nspname='kata'"
kata|kata
```

Every hosted count reproduced exactly, schema still 25, every object owned by `kata`.

## 3. Migration with the fork daemon

### Build

```console
$ cd .worktrees/migration-rehearsal
$ env -u KATA_SERVER -u KATA_AUTH_TOKEN -u KATA_AUTHOR TMPDIR=/tmp/kt \
    mise exec -- go build -o /tmp/kata-9bhq/kata-m3 ./cmd/kata
$ /tmp/kata-9bhq/kata-m3 --version
kata g13b9bf2
  commit:  13b9bf2
  built:   2026-09-14T01:58:53Z
  go:      go1.27.0
  os/arch: darwin/arm64
```

A plain `go build` carries no `-ldflags`, so the version string is the bare
`g13b9bf2` from VCS stamping rather than `v0.17.2-…-g13b9bf2` that `make build` produces.
That is expected for a rehearsal binary and is why the health output below says
`"version":"g13b9bf2"`. It also means **this binary has no embedded web UI**
(`grep -ac 'Kata UI assets are not built'` → 2 hits, i.e. the stub), which is why the web
check in §4e runs against the container image instead.

### Preflight — and a correction to RECON

RECON predicted `kata storage postgres status` would report the version mismatch. It
reports something else, and it first refuses outright:

```console
$ env … KATA_HOME=/tmp/kata-9bhq/m3home TMPDIR=/tmp/kt /tmp/kata-9bhq/kata-m3 \
    storage postgres status --dsn 'postgres://kata:kata@127.0.0.1:15432/kata?sslmode=disable'
kata: postgres schema owner is required in validation mode
exit=1

$ env … KATA_POSTGRES_SCHEMA_OWNER=kata /tmp/kata-9bhq/kata-m3 storage postgres status --dsn …
kata: postgres schema "kata" is missing canonical relation "external_field_mappings"
exit=1
```

Two facts the cutover runbook needs:

1. `status` in validate mode **requires** `KATA_POSTGRES_SCHEMA_OWNER` (or the config key).
   The Railway service does not set it, so a preflight there needs it supplied on the
   command line, not inherited from the service environment.
2. The message is the **catalog-manifest** failure, not the version mismatch, because
   `validateSchema` (`internal/db/pgstore/open.go:461-483`) runs ownership → runtime
   privileges → manifest → version, and a schema-25 database is missing the schema-26
   tables, so the manifest check fires first. Operators should expect
   `missing canonical relation "external_field_mappings"` as the normal pre-upgrade
   signal, and should not read it as corruption.

### Migrate by starting the daemon (the Railway path)

```sh
env -u KATA_SERVER -u KATA_AUTH_TOKEN -u KATA_AUTHOR \
  KATA_HOME=/tmp/kata-9bhq/m3home TMPDIR=/tmp/kt \
  PORT=18090 KATA_DSN='postgres://kata:kata@127.0.0.1:15432/kata?sslmode=disable' \
  KATA_TRUST_PRIVATE_NETWORK=1 PUBLIC_ORIGIN=http://127.0.0.1:18090 \
  /tmp/kata-9bhq/kata-m3 daemon start --foreground
```

`$KATA_HOME/config.toml` carried `[auth] token` (a fresh `openssl rand -hex 16`),
`trust_private_network = true`, and `[web] public_origin`, exactly as the M2 smoke recipe
does, so no `KATA_AUTH_TOKEN` existed in any process environment.

```console
health-ready after 0.14s        # polled /api/v1/health every 100 ms from process start

$ curl -s http://127.0.0.1:18090/api/v1/health
{"ok":true,"db_path":"postgres://127.0.0.1:15432/kata","schema_version":27,
 "api_schema_version":"0.18.0","version":"g13b9bf2","uptime":"0s",
 "started_at":"2026-09-14T02:04:02.020341Z"}

$ cat /tmp/kata-9bhq/daemon-go.log
kata daemon: WARNING: listening on non-loopback TCP with bearer auth; operator has asserted private-network confidentiality.
kata daemon: listening on 0.0.0.0:18090
```

**There are no migration log lines.** The 25→26→27 migration is completely silent: the
only evidence it ran is `schema_version` in `/api/v1/health` and the new objects in the
database. For the Railway cutover that means the deploy log will look identical to a
no-op start, so the post-deploy check must be the health payload, not the log.

Verification after migration:

```console
$ docker exec … psql -U kata -d kata -Atc "SELECT value FROM kata.meta WHERE key='schema_version'"
27

$ docker exec … psql -U kata -d kata -c "SELECT 'projects' …"
         tbl         | count        # identical to §2 and to the hosted counts
---------------------+-------
 api_tokens          |     2
 comments            |  5591
 events              | 28055
 import_mappings     |  4558
 issue_labels        |  6544
 issues              |  4357
 issue_sync_bindings |    11
 issue_sync_status   |    11
 links               |  2930
 projects            |    52

$ docker exec … psql -U kata -d kata -c \
    "SELECT tablename, tableowner FROM pg_tables WHERE schemaname='kata' AND tablename LIKE 'external%'"
        tablename        | tableowner
-------------------------+------------
 external_field_mappings | kata
 external_field_states   | kata
 external_root_bindings  | kata

$ docker exec … psql -U kata -d kata -Atc \
    "SELECT column_name FROM information_schema.columns
     WHERE table_schema='kata' AND table_name='comments' AND column_name='teammate'"
teammate

$ docker exec … psql -U kata -d kata -Atc "…pg_get_userbyid(c.relowner)<>'kata'"
                                            # no rows: no ownership drift
```

Both migrations landed (26 = the three `external_*` tables, 27 = `comments.teammate`),
every new object is owned by `kata`, and not one row moved.

Postflight with the same binary:

```console
$ env … KATA_POSTGRES_SCHEMA_OWNER=kata /tmp/kata-9bhq/kata-m3 storage postgres status --dsn …
Postgres schema "kata" is ready at version 27.
exit=0
```

### The container path, from a fresh schema 25

The database was dropped and re-restored so the image migrates from 25 as well:

```console
$ docker exec … psql -U kata -d kata -Atc 'DROP SCHEMA kata CASCADE'
$ docker exec … pg_restore -U kata -d kata --no-owner --no-privileges /tmp/hosted-schema25.dump
real 1.73
$ docker exec … psql -U kata -d kata -Atc "SELECT value FROM kata.meta WHERE key='schema_version'"
25
```

```sh
docker run -d --name kata-m3-ctr --platform linux/amd64 \
  --add-host=host.docker.internal:host-gateway \
  -e PORT=8080 -e KATA_HOME=/data -e PUBLIC_ORIGIN=http://127.0.0.1:18091 \
  -e KATA_TRUST_PRIVATE_NETWORK=1 \
  -e KATA_DSN='postgres://kata:kata@host.docker.internal:15432/kata?sslmode=disable' \
  -e KATA_POSTGRES_ALLOW_INSECURE=1 \
  -v /tmp/kata-9bhq/ctrhome:/data -p 18091:8080 kata-fork:m2-amd64
```

`KATA_POSTGRES_ALLOW_INSECURE=1` is required here for the same reason it is set on the
live service: `host.docker.internal` is not an exact loopback host, so the transport guard
(`open.go:201-229`) rejects plaintext without it.

```console
container health-ready after 0.56s      # includes docker run and image start

$ curl -s http://127.0.0.1:18091/api/v1/health
{"ok":true,"db_path":"postgres://host.docker.internal:15432/kata","schema_version":27,
 "api_schema_version":"0.18.0","version":"v0.17.2-20-g67346c5","uptime":"0s",
 "started_at":"2026-09-14T02:07:55.645974877Z"}

$ docker exec … psql -U kata -d kata -c "SELECT 'projects' …"
         tbl         | count        # identical to hosted, again
---------------------+-------
 comments            |  5591
 events              | 28055
 import_mappings     |  4558
 issue_labels        |  6544
 issues              |  4357
 issue_sync_bindings |    11
 links               |  2930
 projects            |    52
$ … "SELECT count(*) … pg_get_userbyid(c.relowner)<>'kata'"
0
```

Both paths reach schema 27 from 25 with byte-identical row counts. The container reports
the proper M2 version string because that image was built with the `KATA_VERSION` build
arg.

### Unexpected: the migrated daemon starts syncing GitHub immediately

The restored copy carries the live `issue_sync_bindings` rows, and the sync runner fires
at startup. On the **host** run it actually succeeded for two bindings:

```console
$ docker exec … psql -U kata -d kata -c \
    "SELECT binding_id, left(coalesce(last_error,''),30), last_error_at, last_success_at
     FROM kata.issue_sync_status ORDER BY binding_id"
 binding_id |              err               |      last_error_at       |     last_success_at
------------+--------------------------------+--------------------------+--------------------------
          2 |                                |                          | 2026-09-14T02:04:03.076Z   ← during this run
         11 |                                |                          | 2026-09-14T02:04:04.900Z   ← during this run
```

The daemon started at `02:04:02Z`. The cause is credential discovery, not a leaked token:
kata falls back to the `gh` CLI (`gh auth status` → logged in as `hsb3`), so a fork daemon
run on a Mac inherits a real GitHub identity. The container, which has no `gh`, logged the
opposite:

```console
$ docker logs kata-m3-ctr | head -3
level=WARN msg="github sync binding failed" binding_id=2 error="no GitHub credentials for
  github.com/hsb3/dotfiles: configure [[github_sync.app]], set KATA_GITHUB_TOKEN with
  [github_sync].token_host = \"github.com\", or run `gh auth login --hostname github.com`"
```

Nothing was imported — `import_mappings` stayed at 4558 and the only row deltas across the
whole host run were the two projects, two issues and one comment created by the §4a CLI
test. Unauthenticated/`gh`-authenticated reads of public repos are harmless here, but the
next person running a rehearsal on a Mac should know the daemon will talk to real GitHub
unless the bindings are disabled first or the process is run without `gh` credentials.

## 4. Compatibility matrix

| # | Direction | Command | Result |
|---|---|---|---|
| a | Homebrew client **0.16.0** → fork daemon (schema 27, API 0.18.0) | `kata health / list --all / show / projects create / create / label add / comment / claim / close / move / search / ready / events / digest` against `KATA_SERVER=http://127.0.0.1:18090` | **Pass**, every command. `kata --all-projects` does not exist in 0.16.0 (it is `--all`); `comment` needs `--body`; `close` needs a typed `--evidence`. Those are 0.16.0 CLI surface, not daemon incompatibilities. |
| b | Fork client → hosted **schema-25 / API-0.11.0** daemon | **Not exercised, by rule** (no fork binary may touch the hosted daemon). | Predicted pass for read/write basics, fail for `comment --teammate`. See below. |
| c | Fork `kata mcp serve` (stdio) → fork daemon | 14 `kata.load_*` loaders, then `tools/list` | **Pass**: 76 tools, zero root `oneOf`/`allOf`/`anyOf`. |
| d | GitHub sync configuration survives the migration | `kata sync github status --project <p>` on the migrated daemon | **Pass**: all 11 bindings intact, including both known-broken ones with their stored errors. |
| e | Embedded web UI on the migrated database | `curl` SPA root + one asset against the container daemon | **Pass**: `/` → 302 `/kata`, `/kata` → 200 with the production marker, 2.17 MB JS asset served. |

### (a) Homebrew 0.16.0 client against the fork daemon

This was the one sanctioned use of `/opt/homebrew/bin/kata` (`kata v0.16.0`, built
2026-08-27), and it was pointed only at `127.0.0.1:18090`.

```console
$ kata health
ok=true schema_version=27 uptime=24s db=postgres://127.0.0.1:15432/kata

$ kata list --all --limit 5
○ functionform-asmbl#nmfm  • P1  Build primitive list create and read spine (unowned)
○ dev-journey#9heh               Tests for packages, group 3: the remaining 13 packages (unowned)
○ kata#3xc9                • P0  [epic] waves: triage (living plan) (unowned)
○ kata#49jt                • P0  Session handoff (unowned)
● kata#2r4t                • P2  M7 Docs and memory after cutover (unowned)
Showing: 5 issues (4 open, 1 blocked)

$ kata list --all --status all --limit 0 | wc -l
    4063

$ kata show 8r2y --project kata
8r2y  M3 Staging rehearsal: … [open]  by claude@BigMac      # full body + links rendered

$ kata projects create m3-rehearsal
created project #99 (m3-rehearsal)

$ kata create --project m3-rehearsal "0.16.0 client write path" --body "…"
rcsn 0.16.0 client write path [open]

$ kata label add rcsn --project m3-rehearsal rehearsal
rcsn labeled "rehearsal"

$ kata comment rcsn --project m3-rehearsal --body "comment from Homebrew 0.16.0 client"
comment appended

$ kata claim rcsn --project m3-rehearsal
rcsn claimed by claude@BigMac

$ kata close rcsn --project m3-rehearsal --done \
    --test "0.16.0 client vs fork daemon g13b9bf2" --message "…"
rcsn 0.16.0 client write path [closed]

$ kata search "client write path" --project m3-rehearsal
rcsn      0.10  open      0.16.0 client write path  (title)

$ kata events --project m3-rehearsal --limit 5
28161   project.created  proj=99  -     by claude@BigMac  2026-09-14T02:04:49.835Z
28162   issue.created    proj=99  rcsn  by claude@BigMac  2026-09-14T02:04:49.867Z
28163   issue.labeled    proj=99  rcsn  by claude@BigMac  2026-09-14T02:04:55.838Z
28164   issue.commented  proj=99  rcsn  by claude@BigMac  2026-09-14T02:05:00.964Z
28165   issue.assigned   proj=99  rcsn  by claude@BigMac  2026-09-14T02:05:06.869Z
```

The decisive one for the epic's stated risk is `move`, which is one of the four request
bodies v0.17.0 changed from `int64` to `string`:

```console
$ kata projects create m3-rehearsal-b
created project #100 (m3-rehearsal-b)
$ kata create --project m3-rehearsal "move target probe" --body "…"
hjvj move target probe [open]
$ kata move hjvj m3-rehearsal-b --project m3-rehearsal
moved m3-rehearsal#hjvj to m3-rehearsal-b#hjvj
```

So the numeric-`project_id` request path that broke 0.17.2 against the 0.15.1 daemon works
in the direction that matters for the cutover: **0.16.0 client → fork daemon**. RECON's
prediction is confirmed by execution, and `kata ui` was skipped as instructed.

### (b) Fork client against the hosted schema-25 daemon — not exercised, by rule

No fork binary was pointed at the hosted daemon. What the code says would happen, from
this tree:

- The only client-side gates are in `cmd/kata/api_compat.go:12-19`
  (`0.8.0` ready/search filters, `0.9.0` global list filters, `0.11.0` MCP server) plus
  `cmd/kata/teammate.go:33` (`0.18.0` for comment teammate attribution).
  `requireDaemonAPIVersion` fails only when the daemon is *older* than the floor.
- The hosted daemon reports `api_schema_version 0.11.0`, so `list`, `search`, `ready` and
  `kata mcp serve` would pass their floors, and **`kata comment --teammate` would fail**
  with the 0.18.0 requirement — the one command that is guaranteed to break.
- The `project_id` hazard does **not** apply in this direction: the fork's generated client
  still declares `ProjectID int64` (`pkg/client/generated/paths.go:56,60,72,76,…`), so the
  fork CLI sends the integer the 0.15.1 daemon expects. The fork has not taken upstream
  v0.17.0's int→string selector change.
- Schema version is display-only on the client side, so 25 vs 27 alone blocks nothing.

Net: a fork client against the hosted daemon would mostly work, which is precisely why the
rule exists — "mostly works" is how a schema-27 expectation silently meets a schema-25
database. Daemon first, clients second.

### (c) Fork MCP server against the fork daemon

`kata mcp serve` was driven over stdio by `/tmp/kata-9bhq/mcp_probe.py` (adapted from
`~/.local/share/agent-artifacts/kata/mcp-schema-proof-2026-09-13/dump_tools.py`; the only
changes are keeping `KATA_SERVER`/`KATA_AUTH_TOKEN` so it targets the fork daemon, and
calling only the loaders rather than every tool).

```console
initialize: {"name": "kata", "title": "Kata issue tracker",
             "description": "Scoped Kata data and administration tools for coding agents.",
             "version": "g13b9bf2"} protocol 2025-06-18
tools before loaders: 14
loaders found: 14
  kata.load_activity                 isError=False
  kata.load_external_roots           isError=False
  kata.load_federation               isError=False
  kata.load_import                   isError=False
  kata.load_issue_discovery          isError=False
  kata.load_issue_lifecycle          isError=False
  kata.load_issue_mutation           isError=False
  kata.load_leases                   isError=False
  kata.load_projects                 isError=False
  kata.load_recurrence               isError=False
  kata.load_storage                  isError=False
  kata.load_sync                     isError=False
  kata.load_system                   isError=False
  kata.load_tokens                   isError=False
tools after loaders: 76
root oneOf/allOf/anyOf tools: (none)
```

76 tools, no root schema composition — no stdio shim flattening is needed. A real data read
through the MCP path, with the workspace bound to project `kata`:

```console
$ kata.list {"status":"open","limit":3}   → isError=False
{"issues":[{"labels":["migration"],"priority":1,"qualified_ref":"kata#bgrz",…},
           {"labels":["handoff"],"priority":0,"qualified_ref":"kata#49jt",…},
           {"labels":["epic","wave-plan"],"priority":0,"qualified_ref":"kata#3xc9",…}],
 "truncated":false}
```

`kata mcp serve` needs a workspace with a `.kata.toml` (or a git ancestor); without one it
exits `kata: no .kata.toml ancestor and no git ancestor` before answering `initialize`.

### (d) GitHub sync configuration survived

Read with the **fork** binary as a client against the migrated local daemon.
`KATA_GITHUB_TOKEN` was never set by this run.

```console
$ kata sync github status --project <p>
kata                     GitHub sync not_enabled
dotfiles                 GitHub sync enabled
dotfiles-agents          GitHub sync enabled
keel                     GitHub sync enabled  Last error: not found
outlook-mcp              GitHub sync enabled  Last error: GitHub repository request failed:
                           301 Moved Permanently … api.github.com/repositories/1250814367
lgx                      GitHub sync enabled
functionform-obsidian    GitHub sync disabled
```

All 11 bindings are present after the migration, with the same repositories RECON found:

```
 id | project                  | display_name                       | enabled
  1 | opencode-sandbox         | hsb3/opencode-sandbox              | 1
  2 | dotfiles                 | hsb3/dotfiles                      | 1
  3 | outlook-mcp              | hsb3/outlook-mcp                   | 1
  4 | carbon-ai-chat-langgraph | hsb3/carbon-ai-chat-langgraph      | 1
  5 | raptor-forecaster-be     | mhi-raptorxai/raptor-forecaster-be | 1
  6 | keel                     | hsb3/kit-ui                        | 1
  7 | lgx-platform             | hsb3/lgx-platform                  | 1
  8 | lgx                      | hsb3/lgx                           | 1
  9 | ra-platform-github       | hsb3/ra-platform                   | 1
 10 | functionform-obsidian    | hsb3/functionform-obsidian         | 0
 11 | dotfiles-agents          | hsb3/dotfiles-agents               | 1
```

The two failing bindings RECON saw in the live logs are exactly bindings 3 and 6, and the
migrated database reproduces both errors verbatim. Binding 6's cause is now visible:
project `keel` is bound to `hsb3/kit-ui` (`remote_id R_kgDOT36ivw`, last success
2026-08-27), a repository that no longer answers under that name. Both failures predate
the fork and will carry over to the cutover unchanged.

### (e) Embedded web UI

Against the container daemon (the host binary was built without the web embed):

```console
$ curl -s -D- -o /dev/null http://127.0.0.1:18091/
HTTP/1.1 302 Found
Location: /kata
Content-Security-Policy: default-src 'self'; base-uri 'none'; object-src 'none'; …

$ curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:18091/kata
404                                     # ← without an HTML Accept header

$ curl -s -D- -H 'Accept: text/html,application/xhtml+xml' http://127.0.0.1:18091/kata
HTTP/1.1 200 OK
Content-Length: 453
<meta name="kata-web-distribution" content="production" />
<title>Kata</title>

$ curl -s -o /dev/null -w '%{http_code} %{size_download} %{content_type}\n' \
    http://127.0.0.1:18091/assets/index-DgwyvaIw.js
200 2174797 text/javascript; charset=utf-8

$ curl -s http://127.0.0.1:18091/api/v1/ping
{"ok":true,"service":"kata","version":"v0.17.2-20-g67346c5","pid":1}
```

The SPA navigation fallback is gated on the request's `Accept` header, so a bare
`curl /kata` returns a plain-text 404 while a browser gets the app. **Any health probe or
smoke test for the UI must send `Accept: text/html`**, or it will report a broken UI that
is in fact fine. `/api/v1/health` remains the right probe for the service itself.

The Playwright screenshot was **skipped**: `web/node_modules` does not exist in the main
checkout (`ls -d /Users/henry/Developer/kata/web/node_modules` → no such file), and the
brief marked it optional.

## 5. Rollback drill

Stop the daemon, drop the schema, restore the pre-upgrade dump, confirm 25:

```console
$ docker stop kata-m3-ctr
$ curl -s -m 2 http://127.0.0.1:18091/api/v1/health   → no daemon on 18091
$ docker exec … psql -Atc "SELECT value FROM kata.meta WHERE key='schema_version'"
27
$ time docker exec … psql -U kata -d kata -Atc 'DROP SCHEMA kata CASCADE'
drop cascades to table external_field_mappings
drop cascades to table external_field_states
DROP SCHEMA
0.063 total
$ time docker exec … pg_restore -U kata -d kata --no-owner --no-privileges /tmp/hosted-schema25.dump
1.674 total
$ docker exec … psql -Atc "SELECT value FROM kata.meta WHERE key='schema_version'"
25
$ docker exec … psql -c "SELECT 'projects' …"
   tbl    | count
----------+-------
 comments |  5591
 events   | 28055
 issues   |  4357
 projects |    52
$ docker exec … psql -Atc "SELECT count(*) FROM pg_tables WHERE schemaname='kata' AND tablename LIKE 'external%'"
0
$ docker exec … psql -Atc "SELECT count(*) FROM information_schema.columns
    WHERE table_schema='kata' AND table_name='comments' AND column_name='teammate'"
0
```

Back at schema 25 with the original counts; both schema-26 tables and the schema-27 column
are gone. **The old binary was not run.** On Railway the matching rollback artefact is
deployment `1c303f72`, the upstream v0.15.1 image (`deploy/railway/README.md` step 6);
redeploying it is the second half of this drill and belongs to M4.

Note the asymmetry the drill makes concrete: forward is a sub-second in-process migration
with no operator command, backward is a full drop-and-restore of the whole schema. There
are no down migrations, so the dump is the only rollback artefact that exists.

## 6. Timings

| Step | Time | Notes |
|---|---|---|
| `pg_dump -Fc` from Railway over the TCP proxy | **9.21 s** | 28.4 MiB archive, containerised client |
| `pg_dump -Fp` (inspection copy, deleted) | 7.59 s | 84 MB |
| `pg_restore` into the throwaway DB | **1.80 s** / 1.73 s / 1.67 s | three runs |
| `DROP SCHEMA kata CASCADE` | 0.06 s | |
| Host binary: process start → `/api/v1/health` 200 with schema 27 | **0.14 s** | migration is inside this |
| Container: `docker run` → `/api/v1/health` 200 with schema 27 | **0.56 s** | includes image start |
| `storage postgres status` (preflight and postflight) | < 1 s | |

For the Railway cutover the migration itself is not the downtime; the deploy and the
mandatory scale-to-zero window are. Budget the dump (≈10 s from a Mac, likely faster
inside Railway) and a rollback restore of ≈2 s.

## 7. What this changes for M4

1. **The preflight command needs two things RECON did not record**:
   `KATA_POSTGRES_SCHEMA_OWNER=kata` on the command line, and the expectation of
   `missing canonical relation "external_field_mappings"` rather than a version-mismatch
   message.
2. **The deploy log will show nothing about the migration.** Verify with
   `curl …/api/v1/health` and require `schema_version: 27`; consider setting
   `healthcheckPath` to `/api/v1/health` so a failed migration fails the deploy.
3. **Take the dump with a `postgres:18` client**, not a Mac-local `pg_dump` 17.x, and
   remember the archive has no `unaccent` extension — a restore target needs
   `CREATE EXTENSION unaccent WITH SCHEMA public` first.
4. **Restore as role `kata`** (`--no-owner` plus a `kata`-authenticated session). Every
   object owned by `kata` is what keeps `validateSchemaOwnership` quiet.
5. **The 0.16.0 clients on both Macs can stay** through the cutover: every command tested,
   including `move`, works against the fork daemon. Only `comment --teammate` requires a
   fork client, and it requires the fork *daemon* too.
6. **No federation state exists**, so the federation parts of the ceremony are moot.
7. **Expect bindings 3 and 6 to keep failing** after cutover; they are database rows, not
   a fork regression. Binding 6 (`keel` → `hsb3/kit-ui`) looks like a repository rename
   that should be fixed independently.
8. **A UI smoke test must send `Accept: text/html`.**

## 8. Cleanup and residue

- `docker rm -f kata-m3-ctr kata-rehearsal-pg` — both removed, `docker ps -a` shows no
  kata containers.
- `/tmp/kata-9bhq/rw/vars.json`, the derived `pgenv.sh`, and the plain-text dump copy were
  deleted. No `~/.pgpass` file was ever created. No secret value appears in this document
  or in any committed file.
- `railway unlink` refused non-interactively (`Cannot prompt for confirmation in
  non-interactive mode. Use --yes to skip confirmation.`), and `railway unlink --yes` still
  reported the link, so the scratch directory's `.railway/` state directory was removed
  instead. `railway status` in `/tmp/kata-9bhq/rw` now answers `No linked project found`.
- **Kept**: `/tmp/kata-9bhq/hosted-schema25.dump`, 29,791,728 bytes, taken
  2026-09-14T02:02Z, sha256 `9f4b7e77a9fc50c64edd3eb16c0bff3143e2943b26640a25811e5fe840000db5`.
  It contains the whole board including `api_tokens`. Henry's call whether to keep it as
  the M4 rollback artefact (move it to `~/.local/share/agent-artifacts/kata/`) or delete
  it; a fresh dump must be taken immediately before the cutover regardless.
- Also left in the scratch root: `/tmp/kata-9bhq/kata-m3`, the temporary daemon homes
  (each with a throwaway `[auth] token` that exists nowhere else), and
  `/tmp/kata-9bhq/mcp-tools.json` (the 76-tool dump).
