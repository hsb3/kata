# M2: Fork build and install pipeline

How fork binaries are produced for the two Macs and for the Railway daemon, and how you
tell a fork build apart from an upstream one. Fork issue `ark1` (epic `bgrz`). Every
command below was run on BigMac against fork `main` `67346c5` on 2026-09-13/14 UTC,
except the ones explicitly marked "not executed".

Decisions, short version:

- **Mac = `make install` from the checkout** with mise's pinned Go and Bun. No Homebrew
  formula, no fork release workflow, no tags (`AGENTS.md`: releases happen externally;
  do not add local release scripts or workflows that create tags).
- **Railway = `deploy/railway/Dockerfile`**, a multi-stage build from source in this
  repo. No prebuilt release tarball, which is what the live service uses today.
- **Version stamp = upstream's, unchanged.** Both paths print
  `v<last-upstream-tag>-<commits>-g<sha>`; the `g<sha>` is the fork commit and is the
  fork identifier. No change to `internal/version`, the `Makefile`, or `.goreleaser.yaml`.

## Version identification

`make build`/`make install` compute `VERSION` from `git describe --tags --always --dirty`
(`Makefile:4`) and stamp it through `-ldflags -X .../internal/version.Version=...`. On
fork `main` `67346c5` that is:

```console
$ ./kata --version
kata v0.17.2-20-g67346c5
  commit:  67346c5
  built:   2026-09-13T21:42:55-04:00
  go:      go1.27.0
  os/arch: darwin/arm64
```

Read it as: 20 commits past upstream tag `v0.17.2`, at fork commit `67346c5`. Resolve the
suffix with `git -C <fork checkout> show 67346c5` — if the sha is in `hsb3/kata` and not in
`kenn-io/kata`, it is a fork build. `kata version --json` exposes the same fields plus
`distribution` (empty for fork builds; `homebrew` for the installed 0.16.0 client), and
`/api/v1/health` and `/api/v1/ping` report `version` for a running daemon.

**Why no `-fork.N` suffix or fork tag**, despite the issue text suggesting one: the
self-updater treats a `git describe`-shaped version as a dev build
(`gitDescribePattern = -\d+-g[0-9a-f]+(-dirty)?$`, anchored at the end, in
`go.kenn.io/kit@v0.21.1/selfupdate/selfupdate.go:1657`), so `kata update` on a fork build
stops at "dev build, pass --force". Appending `+fork` or `-fork.1` breaks that anchor and
`kata update` would then treat the fork binary as a release and happily overwrite it with
an upstream download. Keeping upstream's string preserves that guard, needs zero
divergence in shared files, and still identifies the build uniquely. Revisit only if the
fork ever cuts real tags.

## (a) Macs: darwin/arm64

Toolchain comes from `mise.toml` (Go 1.27.0, Bun 1.3.14). `mise install` once per
checkout; run commands through `mise exec --` if mise is not activated in that shell.

```sh
cd <fork checkout>
mise install
make web-install     # bun install --frozen-lockfile (workspace root)
make build           # web-embed (bun build + validate + embed) then go build -o ./kata
```

`make build` leaves `./kata` in the checkout (gitignored) and restores the embedded-asset
stub afterwards. `make install` is the same pipeline with `go install`, and the Makefile
sets and exports `GOBIN ?= $HOME/.local/bin` (`Makefile:3`), so it lands at
`~/.local/bin/kata`.

**PATH-order check, before and after installing.** On BigMac `~/.local/bin` (position 19)
comes *before* `/opt/homebrew/bin` (position 20), so `make install` silently takes over
the `kata` command:

```console
$ which -a kata
/opt/homebrew/bin/kata          # today: Homebrew 0.16.0, nothing else on PATH

$ brew list --pinned
                                # empty: 0.16.0 is NOT brew-pinned, only un-upgraded
```

So:

- Until the Railway daemon is on the fork (M4), do **not** run `make install` on either
  Mac. Build with `make build` and run `./kata` by explicit path, against an isolated
  `KATA_HOME`, with `KATA_SERVER` and `KATA_AUTH_TOKEN` unset.
- If you want a fork binary on disk without shadowing Homebrew, install it elsewhere:
  `make install GOBIN=$HOME/.local/share/kata-fork/bin` and call it by full path.
- After a deliberate client cutover (M5), `which -a kata` must list `~/.local/bin/kata`
  first and `kata --version` must print the `g<sha>` string above.
- Separately: `brew upgrade` would move the Homebrew client to 0.17.2, which is broken
  against the live 0.15.1 daemon (`RECON.md`, `project_id` int→string). It is not pinned
  today; pinning it (`brew pin kata`) is a one-line hardening, out of scope for this
  issue and not executed here.

### Rollback on a Mac

The Homebrew keg is untouched by everything above, so rollback is removing the fork
binary:

```sh
rm ~/.local/bin/kata          # or the alternate GOBIN used above
hash -r                       # zsh: rehash
which -a kata                 # must print /opt/homebrew/bin/kata
kata --version                # must print 0.16.0
```

If the keg itself was ever removed or upgraded, reinstall the 0.16.0 keg
(`/opt/homebrew/Cellar/kata/0.16.0`, still present) with `brew link --overwrite kata`,
or reinstall from the versioned bottle and `brew pin kata`.

## (b) Railway daemon: linux/amd64 container

`deploy/railway/Dockerfile` (context = repository root, `deploy/railway/README.md` covers
the Railway-side steps, which are M4 and were not executed):

```sh
docker build -f deploy/railway/Dockerfile \
  --build-arg KATA_VERSION="$(git describe --tags --always --dirty)" \
  --build-arg KATA_COMMIT="$(git rev-parse --short=7 HEAD)" \
  --build-arg KATA_BUILD_DATE="$(git show -s --format=%cI HEAD)" \
  -t kata-fork:m2 .
```

Three stages: `oven/bun:1.3.14` (the `packageManager` pin in `web/package.json`) runs the
same build/validate/embed steps as `make web-embed`; `golang:1.27-bookworm` cross-compiles
`./cmd/kata` with `CGO_ENABLED=0`, `-trimpath -buildvcs=false` and the version ldflags;
`debian:bookworm-slim` plus `ca-certificates` carries the binary and `entrypoint.sh`.

- The version comes from build args because the build context excludes `.git` (a linked
  worktree's `.git` is a file, so `git describe` cannot run inside the image). Omit them
  and the image reports `dev`.
- The build stage is pinned to `$BUILDPLATFORM` and cross-compiles to `$TARGETARCH`, so
  `--platform linux/amd64` on an arm64 Mac takes ~30 s and never runs Bun or Go under
  QEMU. Railway builds amd64 natively, so this only matters for local verification.
- `internal/web/dist` is created inside the same `RUN` as the embed step: `embed-assets.ts`
  swaps the directory with `rename(2)`, which fails with `EXDEV` on overlayfs when the
  directory arrived from an earlier `COPY` layer. (Measured; the first build attempt failed
  exactly this way.)

### Verified locally

```console
$ docker build -f deploy/railway/Dockerfile --build-arg KATA_VERSION=... -t kata-fork:m2 .
... naming to docker.io/library/kata-fork:m2 done

$ docker run --rm --entrypoint kata kata-fork:m2 --version
kata v0.17.2-20-g67346c5
  commit:  67346c5
  built:   2026-09-13T21:42:55-04:00
  go:      go1.27.1
  os/arch: linux/arm64

$ docker run --rm --platform linux/amd64 --entrypoint kata kata-fork:m2-amd64 --version
kata v0.17.2-20-g67346c5
  ...
  os/arch: linux/amd64
```

Hosted-mode smoke test against a throwaway SQLite home (no Postgres needed: `KATA_DSN` is
optional and the SQLite path exercises the same migration and health code):

```sh
mkdir -p /tmp/kt/m2home
printf '[auth]\ntoken = "%s"\ntrust_private_network = true\n' "$(openssl rand -hex 16)" \
  > /tmp/kt/m2home/config.toml
docker run -d --name kata-m2-smoke \
  -e PORT=8080 -e KATA_HOME=/data -e PUBLIC_ORIGIN=http://localhost:18080 \
  -v /tmp/kt/m2home:/data -p 18080:8080 kata-fork:m2
curl -s localhost:18080/api/v1/health
docker stop kata-m2-smoke && docker rm kata-m2-smoke
```

```console
kata daemon: WARNING: listening on non-loopback TCP with bearer auth; operator has asserted private-network confidentiality.
kata daemon: listening on 0.0.0.0:8080

{"ok":true,"db_path":"/data/kata.db","schema_version":27,"api_schema_version":"0.18.0",
 "version":"v0.17.2-20-g67346c5","uptime":"7s","started_at":"2026-09-14T01:52:15Z"}
```

Both log lines match the live service's startup log in `RECON.md`, i.e. the image
reproduces the hosted contract. The token was supplied through the mounted
`config.toml` (`[auth].token`, which `KATA_AUTH_TOKEN` merely overrides,
`internal/config/daemon_config.go:704`) so that no `KATA_AUTH_TOKEN` env var existed in
any process during this work; on Railway the env var stays the source, unchanged.
`PUBLIC_ORIGIN` was appended by the entrypoint as `[web].public_origin` and the daemon
accepted requests on that authority.

Embedded UI check (the stub would mean an unbuilt UI):

```console
$ grep -ac "kata-web-distribution" kata                 # Mac build
2
$ grep -ac "Kata UI assets are not built" kata
0
$ docker run --rm --entrypoint sh kata-fork:m2 -c 'grep -c "kata-web-distribution" /usr/local/bin/kata'
2
```

### Rollback for the daemon

Out of scope here and covered by M4: the rollback for the Railway service is redeploying
the previous deployment (the 0.15.1 image built from the untracked snapshot) plus the
Postgres restore ceremony in `docs/operations/postgres.md:260-279`, since schema 25→27 has
no down migrations.

## Gates run

```console
$ gofmt -l .                     # no output
$ go vet ./...                   # clean
$ go test ./cmd/kata/ ./internal/version/...
ok  go.kenn.io/kata/cmd/kata
ok  go.kenn.io/kata/internal/version
```

No Go, Makefile, or web source changed in this issue; the additions are
`deploy/railway/` and this document.
