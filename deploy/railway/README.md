# Railway image for the fork daemon

Fork-only. Builds the `kata-daemon` service of Railway project `railway-infra` from this
repository instead of the upstream release tarball it runs today.

- `Dockerfile` — three-stage build (bun web build → cross-compiled Go binary →
  `debian:bookworm-slim`). Build context is the **repository root**.
- `Dockerfile.dockerignore` — BuildKit picks this up for this Dockerfile only; it keeps
  `.git`, `node_modules`, and build output out of the context.
- `entrypoint.sh` — reproduces the runtime contract of the live service: translate
  `PUBLIC_ORIGIN` into `[web].public_origin` in `$KATA_HOME/config.toml`, then
  `exec kata daemon start --foreground` (hosted `$PORT` mode).

Local build, run, and verification commands: `docs/fork/migration/BUILD.md`.

## What runs there today

Measured in `docs/fork/migration/RECON.md` (2026-09-13/14): service
`kata-daemon` (`357ba7db-…`), builder `RAILPACK`, `source: null` — i.e. a `railway up`
snapshot of an **untracked** local directory whose Dockerfile downloads
`kata_0.15.1_linux_amd64.tar.gz` from upstream releases. Health reports `v0.15.1`,
`schema_version 25`. There is no volume; all durable state is in
`railway-infra-postgresql-server` (`postgres.railway.internal`, role `kata`, schema
`kata`, bootstrap mode).

## Cutover steps (M4 — none of this was executed)

Do them only under the epic's ceremony: daemon stopped, `pg_dump --format=custom
--schema=kata` plus `kata export` JSONL taken first, because the fork binary migrates
25→26→27 at first start with no down migrations (`docs/operations/postgres.md:224-279`).

1. **Point the service at this build.** Either
   - *repo-connected* (preferred, survives without a local checkout): connect
     `hsb3/kata` with the `serviceConnect` GraphQL mutation using the CLI's token — the
     Railway CLI has no repo-connect command — then set builder `DOCKERFILE` with
     `dockerfilePath = deploy/railway/Dockerfile` and the branch to deploy; or
   - *snapshot*: `railway up` from a fork checkout with
     `--dockerfile deploy/railway/Dockerfile`, which reproduces today's opaque shape and
     is only a fallback.
2. **Make the version stamp real.** The image defaults `KATA_VERSION` to `dev` when no
   build arg is passed. Railway exposes service variables to Dockerfile builds as build
   args (**not verified by this issue**), so either set `KATA_VERSION`, `KATA_COMMIT`,
   `KATA_BUILD_DATE` as service variables, or accept `dev` and identify the build by the
   deployment instead. Confirm after deploy with
   `curl -s https://kata-daemon-production.up.railway.app/api/v1/health` — `version` must
   not be `v0.15.1`, and `schema_version` must be `27`.
3. **Environment variables: change nothing.** The existing names all still apply, and
   this image reads them the same way:
   `KATA_AUTH_TOKEN`, `KATA_DSN`, `KATA_GITHUB_TOKEN`, `KATA_HOME`,
   `KATA_POSTGRES_ALLOW_INSECURE`, `KATA_TRUST_PRIVATE_NETWORK`, `PUBLIC_ORIGIN`.
   `PORT` is injected by Railway (8080 today). `KATA_HOME` stays ephemeral container
   disk; the image defaults it to `/data` if unset. Do **not** add
   `KATA_POSTGRES_SCHEMA_MODE`/`_OWNER`: their absence is what puts the daemon in
   single-role bootstrap mode, and the migration must run as the DSN role `kata`.
4. **Health check.** `/api/v1/health` and `/api/v1/ping` are unauthenticated. The service
   has no `healthcheckPath` configured today; setting it to `/api/v1/health` is optional
   and makes a failed migration fail the deploy instead of serving errors.
5. **Overlap.** Railway's zero-downtime deploy would run the old 0.15.1 binary and the new
   one against one database for a few seconds, which the upgrade ceremony forbids. Scale
   to zero (or stop the service) before the new deploy.
6. **Rollback.** Redeploy the previous deployment (`1c303f72`, the 0.15.1 image) and
   restore the pre-upgrade Postgres snapshot; schema 27 has no down path.

Unchanged by this cutover: the public URL, both Macs' `KATA_SERVER`, the Claude Code
plugin, the `kata-sweep` cron service (it bundles no kata binary and talks to the public
URL), and the GitHub sync bindings, which live in the database — including bindings 3 and
6, which already fail every 10 minutes for reasons unrelated to the fork.
