# M4 Cutover runbook: Railway `kata-daemon` → the fork build

Runbook for kata issue `j3v2` (epic `bgrz`). **Written, not executed:** the session that wrote it
touched nothing on Railway, the hosted daemon, or its database. Sources: `RECON.md`, `BUILD.md`,
`REHEARSAL.md`, `deploy/railway/README.md`, `docs/operations/postgres.md`,
`docs/operations/hosted-mode.md`; where they disagree, §8. Operator: Henry, or a session holding his
explicit go recorded on `j3v2`. Work in order; each step gives its command, expected output, and
abort condition. **Abort before 4.3 = change nothing. Abort at or after
4.3 = §6 rollback**, because 4.3 is where the fork binary migrates the live database. Announce
a 30-minute window; expect 15–20 min of downtime (the Railway build dominates — the 25→27 migration
itself took 0.56 s in rehearsal).

## 1. Preconditions and go/no-go

Any "no" is a stop. Record every answer for the §7 comment.

| # | Check | Required |
|---|---|---|
| 1.1 | `kata show j3v2` | a comment from Henry authorising this window, by date |
| 1.2 | `kata --version`, both Macs | `kata v0.16.0` |
| 1.3 | `brew list --pinned`, both Macs | contains `kata` (the pin stops a mid-window `brew upgrade` to 0.17.2, broken against any pre-0.17 daemon) |
| 1.4 | `git -C <fork checkout> rev-parse HEAD` | the fork `main` SHA to deploy; every later step uses it |
| 1.5 | image builds from that SHA | `kata-fork:m2-amd64` prints your `g<sha>` |
| 1.6 | window announced | Henry knows; no other agent session mid-task |
| 1.7 | board quiet | no writes in the last 15 min other than yours |

```sh
# 1.5 — BUILD.md recipe, amd64, from the exact deploy SHA
cd <fork checkout>
docker build -f deploy/railway/Dockerfile --platform linux/amd64 \
  --build-arg KATA_VERSION="$(git describe --tags --always)" \
  --build-arg KATA_COMMIT="$(git rev-parse --short=7 HEAD)" \
  --build-arg KATA_BUILD_DATE="$(git show -s --format=%cI HEAD)" -t kata-fork:m2-amd64 .
docker run --rm --platform linux/amd64 --entrypoint kata kata-fork:m2-amd64 --version
```

Expect `kata v0.17.2-<n>-g<sha>` with `<sha>` from 1.4. Abort on a build failure or a version string
without your SHA: Railway builds the same source and would fail the same way, inside the window
instead of before it.

```sh
# 1.7 + 1.8 — reads against the live 0.15.1 daemon, pinned 0.16.0 client
kata digest --since 15m --all-projects         # nothing you cannot account for
kata events --all-projects --limit 1 --json    # record the last event id
kata health                                    # schema_version=25, v0.15.1
kata projects list | wc -l                     # 41 on 2026-09-13 (§8: the API hides 11 of 52 DB rows)
kata list --all --status all --limit 0 | wc -l # 4063 on 2026-09-14
```

Abort 1.7 if another actor wrote in the last 15 minutes: find that session, let it finish. The two
counts are what §5 must reproduce — trust what you recorded, not the constants here.

## 2. Backup

REHEARSAL §1 procedure: containerised `postgres:18` client (a Mac-local `pg_dump` 17.x refuses an
18.6 server), password only ever in the environment. Run the dump in step 4.2, with the daemon
already down, so the archive is the exact pre-migration state.

```sh
umask 077
mkdir -p /tmp/kata-m4/rw && cd /tmp/kata-m4/rw
railway link --project railway-infra \
  --service railway-infra-postgresql-server --environment production  # --service is mandatory
railway variables --json > vars.json && chmod 600 vars.json
# derive a mode-600 /tmp/kata-m4/pgenv.sh exporting HOSTED_PGHOST/PGPORT/PGUSER/PGPASSWORD
# from RAILWAY_TCP_PROXY_DOMAIN, RAILWAY_TCP_PROXY_PORT, PGUSER, PGPASSWORD (REHEARSAL §1 jq)
set -a; . /tmp/kata-m4/pgenv.sh; set +a
export PGPASSWORD="$HOSTED_PGPASSWORD"   # `-e PGPASSWORD` with no value keeps it off argv
docker run --rm -e PGPASSWORD -e PGHOST="$HOSTED_PGHOST" -e PGPORT="$HOSTED_PGPORT" \
  -e PGUSER="$HOSTED_PGUSER" -e PGDATABASE=kata -e PGSSLMODE=require \
  -v /tmp/kata-m4:/out postgres:18 \
  pg_dump --schema=kata --no-owner --no-privileges -Fc -f /out/hosted-schema25.dump
chmod 600 /tmp/kata-m4/hosted-schema25.dump
ls -l /tmp/kata-m4/hosted-schema25.dump && shasum -a 256 /tmp/kata-m4/hosted-schema25.dump
```

Expect ~9 s and ~28 MiB (rehearsal: 9.21 s, 29,791,728 bytes). Abort if `pg_dump` errors, the file
is implausibly small, or you cannot record the sha256: with no down migrations this archive is the
only rollback artefact. **It is the whole board, including `api_tokens` rows** — mode 600, in `/tmp`
for the window only; §7 deletes it or moves it to `~/.local/share/agent-artifacts/kata/` for a
retention window Henry names.

## 3. Deploy path and one-time settings

**Recommendation: `railway up --service kata-daemon` for this cutover**, repo-connect afterwards as
its own change. `deploy/railway/README.md` ranks these the other way; the inversion applies to the
window only, because (a) `railway up` ships the exact checkout you verified in 1.5 while a branch
connect ships whatever `main` points at when the builder starts, and (b) connecting a repo
"create[s] deployment triggers" (`railway service source connect --help`) and fork `main` keeps
taking commits through M5–M7, so auto-deploy armed mid-migration means an unreviewed daemon redeploy
during client cutover. Rollback is the same either way. After §5 (or in M7):

```sh
railway service source connect --repo hsb3/kata --branch main --service kata-daemon
# then review/disable the auto-deploy trigger in the dashboard
```

**3.1 Dockerfile path.** Builder is `RAILPACK`, `source: null`, and the fork Dockerfile is not at
the context root. `railway up` has no `--dockerfile` flag (§8):

```sh
cd /tmp/kata-m4/rw
railway link --project railway-infra --service kata-daemon --environment production
railway variable set RAILWAY_DOCKERFILE_PATH=deploy/railway/Dockerfile \
  --service kata-daemon --skip-deploys      # --skip-deploys keeps 0.15.1 serving
```

Verify from the 4.3 build log: it must show the three stages (`oven/bun` → `golang` →
`debian:bookworm-slim`). A Railpack/Nixpacks plan means the path did not take — abort.

**3.2 Version stamp.** The image defaults `KATA_VERSION=dev`. Whether Railway passes service
variables to a Dockerfile build as args is the deploy README's open question and is **still
unverified**; set them hard-coded to the deploy SHA, then check the result.

```sh
cd <fork checkout>
railway variable set KATA_VERSION="$(git describe --tags --always)" \
  KATA_COMMIT="$(git rev-parse --short=7 HEAD)" \
  KATA_BUILD_DATE="$(git show -s --format=%cI HEAD)" --service kata-daemon --skip-deploys
```

If they never reach the build, health reports `"version":"dev"` — cosmetic, **not** an abort (the
binary is identical; the deployment id plus the recorded SHA identify it). `"version":"v0.15.1"`
*is* an abort: the old image is still serving.

**3.3 Environment: change nothing.** These names keep their current values untouched: `KATA_DSN`,
`KATA_AUTH_TOKEN`, `KATA_GITHUB_TOKEN`, `KATA_HOME`, `KATA_POSTGRES_ALLOW_INSECURE`,
`KATA_TRUST_PRIVATE_NETWORK`, `PUBLIC_ORIGIN`, `PORT` (Railway-injected). Confirm names with
`railway variable list --service kata-daemon`; do not add `--kv` or `--json`, both print raw values.
Do **not** add `KATA_POSTGRES_SCHEMA_MODE` or `KATA_POSTGRES_SCHEMA_OWNER`: their absence is what
keeps the daemon in single-role bootstrap mode, which is how it migrates 25→26→27 itself as the DSN
role `kata`.

**3.4 Health check and restart policy** (the service has neither today). Dashboard → `kata-daemon` →
Settings → Deploy: **Health Check Path** `/api/v1/health` (unauthenticated, `hosted-mode.md`),
**Restart Policy** `ON_FAILURE`, max 3 retries. No CLI command exists for either; read back with
`mcp__railway__describe-service` and confirm `healthcheckPath` and `restartPolicyType`. Not a hard
abort if they will not take (the 4.4 curl is the real evidence), but record which you got.

## 4. Execution

**4.1 Quiesce.** The advisory lock serialises migrators, not writes from the old binary, so 0.15.1
must be down first (`postgres.md:224-238`). Region key from `mcp__railway__describe-service` →
`multiRegionConfig` (`us-east4-eqdc4a: 1` at recon time):

```sh
railway service scale --service kata-daemon --environment production us-east4-eqdc4a=0
curl -s -m 5 https://kata-daemon-production.up.railway.app/api/v1/health  # must stop answering
```

Abort (scale back to 1) if the region key is rejected and the dashboard replica control is also
unavailable: deploying over a live 0.15.1 daemon is the one shape the ceremony forbids.

**4.2 Dump.** Run §2's `pg_dump` now; record size and sha256.

**4.3 Deploy — point of no return.** A build failure here is still safe: nothing in the database has
changed, scale back to 1 and you are on 0.15.1.

```sh
cd <fork checkout>
git status --porcelain    # must be empty; railway up uploads the working tree
railway up --service kata-daemon --environment production --ci
```

**4.4 Start and verify.**

```sh
railway service scale --service kata-daemon --environment production us-east4-eqdc4a=1
railway logs --service kata-daemon --deployment --lines 100
curl -s https://kata-daemon-production.up.railway.app/api/v1/health
```

Expect exactly the two startup lines the 0.15.1 service also logged:

```text
kata daemon: WARNING: listening on non-loopback TCP with bearer auth; operator has asserted private-network confidentiality.
kata daemon: listening on 0.0.0.0:8080
```

**The migration emits no log lines** (REHEARSAL correction to RECON): a successful 25→27 and a no-op
start look identical in the log. Health is the only evidence, and it must show `"ok":true`,
`"schema_version":27`, `"api_schema_version":"0.18.0"` and `"version"` = your fork string or `dev`
(§3.2), never `v0.15.1`. Rehearsal reached a schema-27 health response 0.56 s after container start;
allow a minute. A crash loop repeats a startup error every ~1.5 s — the 2026-08-25 shape was `kata:
postgres schema "kata" function "..." owner "postgres" does not match trusted owner "kata"`, i.e.
DDL that ran as the wrong role. Any repeating startup error, or health not at schema 27 within ~2
min, is an abort → §6. If you use `kata storage postgres status` as a pre/postflight, it
**requires** `KATA_POSTGRES_SCHEMA_OWNER=kata` on the command line (validate mode refuses without
it), and before the migration it reports `missing canonical relation "external_field_mappings"` —
the catalog check fires before the version check. That is the normal pre-upgrade signal, not
corruption.

## 5. Verification, both Macs, pinned 0.16.0 client

Nothing on either Mac changes in M4. Run everything on BigMac, then independently on the second Mac.

```sh
kata --version                     # still kata v0.16.0 (client cutover is M5/1002)
kata health                        # ok=true schema_version=27 db=postgres://postgres.railway.internal/kata
kata projects list | wc -l         # equal to 1.8 (41 on 2026-09-13)
kata list --all --status all --limit 0 | wc -l    # equal to 1.8, plus your own writes
kata projects create m4-cutover
kata create --project m4-cutover "M4 round trip" --body "cutover verification"
kata comment <ref> --project m4-cutover --body "0.16.0 client after cutover"
kata close <ref> --project m4-cutover --done --test "M4 cutover verification" --message "..."
kata events --all-projects --limit 5    # ids continue from the id recorded in 1.7
kata ui                                 # browser: the daemon switcher loads and lists the hosted daemon
# UI over curl: the SPA fallback is gated on Accept, so a bare curl 404 is NOT a failure
curl -s -o /dev/null -w '%{http_code}\n' -H 'Accept: text/html,application/xhtml+xml' \
  https://kata-daemon-production.up.railway.app/kata     # 200
# kata-sweep's four endpoints (the cron bundles no kata binary)
H="Authorization: Bearer $KATA_AUTH_TOKEN"; B=https://kata-daemon-production.up.railway.app/api/v1
ID=$(kata projects list --json | python3 -c 'import json,sys;print(json.load(sys.stdin)["projects"][0]["id"])')
for p in "/projects" "/audit/closes?project_id=$ID" "/digest?since=24h" "/issues?status=open&limit=0"; do
  curl -s -o /dev/null -w "%{http_code} $p\n" -H "$H" "$B$p"; done    # all 200
kata sync github status --project <project>      # per project; 11 bindings total
```

The cron runs `0 6 * * *` UTC — confirm the next run's status in Railway the following morning
rather than triggering it (a manual run posts a real comment to `kata-oversight#dpsa`). GitHub sync
passes when the 11 bindings are unchanged and **binding 3 (`outlook-mcp` → `hsb3/outlook-mcp`, `301
Moved Permanently`) and binding 6 (`keel` → `hsb3/kit-ui`, `not found`) still fail**: both predate
the fork, so their unchanged failure is the pass. A *new* failing binding is worth investigating,
not an automatic rollback. MCP: open a Claude Code session with the kata plugin and list its tools —
the plugin shims `kata mcp serve` from the 0.16.0 binary, which needs `api_schema_version` ≥ 0.11.0
(the fork daemon reports 0.18.0), and rehearsal counted 76 tools after the 14 loaders. Only a
failure to initialise is abort-worthy. Any remaining failure here → §6.

## 6. Rollback

Binary and database roll back **together**: the fork's migrations are additive, but a v0.15.1 binary
validating a schema-27 database fails `schema_version ... does not match` and refuses to start, so
restoring one without the other leaves the service down.

```sh
# 6.1 stop writers
railway service scale --service kata-daemon --environment production us-east4-eqdc4a=0
# 6.2 restore AS ROLE kata: --no-owner lands every object on the authenticated role, so
# authenticating as `postgres` here recreates the 2026-08-25 ownership crash loop. Role and
# password come from KATA_DSN on kata-daemon (mode-600 file, never printed); host/port from
# the Postgres TCP proxy as in §2.
pg() { docker run --rm -e PGPASSWORD -e PGHOST="$HOSTED_PGHOST" -e PGPORT="$HOSTED_PGPORT" \
  -e PGUSER=kata -e PGDATABASE=kata -e PGSSLMODE=require -v /tmp/kata-m4:/out postgres:18 "$@"; }
pg psql -Atc "SELECT extname FROM pg_extension WHERE extname='unaccent'"  # must print unaccent
pg psql -Atc 'DROP SCHEMA kata CASCADE'                                   # ~0.06 s
pg pg_restore -d kata --no-owner --no-privileges /out/hosted-schema25.dump  # ~1.7–1.8 s
# 6.3 confirm before starting any binary
pg psql -Atc "SELECT value FROM kata.meta WHERE key='schema_version'"     # 25
pg psql -Atc "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
              WHERE n.nspname='kata' AND pg_get_userbyid(c.relowner) <> 'kata'"   # 0
pg psql -Atc "SELECT count(*) FROM kata.projects"                         # 52
```

The dump carries no `public.unaccent`; you are restoring into the database that already has it, so
abort before the drop if that first query prints nothing. A non-zero ownership count is a stop: fix
ownership before any daemon starts.

**6.4 Redeploy 0.15.1.** The target is the pre-cutover deployment (`1c303f72`-era, upstream
v0.15.1). `railway redeploy` only redeploys the *latest* deployment, so use the dashboard →
`kata-daemon` → Deployments → that deployment → Redeploy (or the `deploymentRedeploy` GraphQL
mutation via `railway api`). Unset `RAILWAY_DOCKERFILE_PATH` and the three `KATA_*` build variables
from §3, or the next redeploy rebuilds the fork image.

```sh
railway service scale --service kata-daemon --environment production us-east4-eqdc4a=1
curl -s https://kata-daemon-production.up.railway.app/api/v1/health  # v0.15.1, schema_version 25
kata health                                                          # from a Mac: schema_version=25
```

Comment the failure and its evidence on `j3v2`, then stop. Do not retry in the same window.

## 7. Post-cutover

1. Comment on `j3v2`: deploy SHA, deployment id, dump size + sha256, health payload before and
after, the counts from 1.8 and §5, both Macs' output, binding state. Close with that.
2. `1002` (M5 client cutover on both Macs) unblocks when `j3v2` closes — confirm with
`kata show 1002` that `blocked-by: j3v2` is gone.
3. Dispose of the dump: `rm -P /tmp/kata-m4/hosted-schema25.dump`, or move it to
`~/.local/share/agent-artifacts/kata/` (mode 600) for the retention window Henry names. It carries
`api_tokens` rows and does not stay in `/tmp` either way. Remove `/tmp/kata-m4/pgenv.sh`,
`vars.json`, and the scratch `.railway/` directory too.
4. Update the `FORK_CHANGES.md` build-mode row (dated 2026-09-14): the hosted daemon now runs
a fork build from `deploy/railway/Dockerfile` at SHA `<deploy SHA>`, deployed by `<method used>`.
**That ledger edit belongs to the session that executes M4**, not to the one that wrote this
runbook.
5. If the repo connect was deferred, note it on `2r4t` (M7 docs and memory) so the service
does not stay an opaque snapshot forever.

## 8. Where the sources disagreed

| Disagreement | Resolution |
|---|---|
| `deploy/railway/README.md` + RECON: the CLI has no repo-connect (global memory: `serviceConnect` GraphQL only) | CLI 5.49.4 ships `railway service source connect --repo … --branch …` (read from `--help`, never run). Prefer it; GraphQL is the fallback. Both notes were written against an older CLI. |
| README suggests `railway up --dockerfile deploy/railway/Dockerfile` | No such flag in 5.49.4. Use the `RAILWAY_DOCKERFILE_PATH` service variable (§3.1) and verify from the build log. |
| README ranks repo-connect preferred, `railway up` fallback | Inverted **for the window only** (§3): ship the exact tested SHA, do not arm auto-deploy on a branch still taking M5–M7 commits. |
| The `j3v2` brief expects `kata projects list \| wc -l` = 52 | Measured 2026-09-13 against the live daemon: **41**. The table has 52 rows (REHEARSAL §1), so the API excludes 11. Compare against the number recorded in 1.8, not a constant. |
| `BUILD.md`: `brew list --pinned` is empty | Measured 2026-09-13 on BigMac: it prints `kata`. The pin is a precondition to verify (1.3), not to create. |
| RECON predicted `storage postgres status` would report a version mismatch | REHEARSAL measured `missing canonical relation "external_field_mappings"`, and the command refuses without `KATA_POSTGRES_SCHEMA_OWNER`. §4 follows the rehearsal. |
| RECON treats the deploy log as where you watch the migration | REHEARSAL: the migration is silent. Health is the only evidence (§4.4). |
