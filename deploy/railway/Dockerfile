# syntax=docker/dockerfile:1
#
# Fork-only image for the Railway service `kata-daemon` (hsb3/kata).
# Upstream ships no container build; the live service was built from an
# untracked snapshot that downloaded an upstream release tarball
# (docs/fork/migration/RECON.md). This builds the daemon from this checkout
# instead, with the web UI embedded and the version stamped.
#
# Build context is the repository root:
#   docker build -f deploy/railway/Dockerfile \
#     --build-arg KATA_VERSION="$(git describe --tags --always --dirty)" \
#     --build-arg KATA_COMMIT="$(git rev-parse --short=7 HEAD)" \
#     --build-arg KATA_BUILD_DATE="$(git show -s --format=%cI HEAD)" \
#     -t kata-fork:<tag> .
#
# The build args mirror the Makefile's VERSION/COMMIT/BUILD_DATE, because the
# context deliberately excludes .git (a linked worktree's .git is a file, so
# `git describe` cannot run inside the image).

# Stage 1: web UI. Bun version tracks web/package.json "packageManager".
FROM --platform=$BUILDPLATFORM oven/bun:1.3.14 AS web
WORKDIR /src
COPY package.json bun.lock ./
COPY web/package.json web/package.json
COPY packages packages
RUN bun install --frozen-lockfile
COPY web web
# Same three steps as the Makefile's web-embed target: build, validate the
# asset graph, then replace internal/web/dist (the go:embed target). All in
# one layer, and creating internal/web/dist here rather than COPYing it:
# embed-assets.ts swaps the directory with rename(2), which returns EXDEV on
# overlayfs when the directory came from a lower layer.
RUN mkdir -p internal/web/dist \
    && bun run --cwd web build \
    && bun run --cwd web scripts/validate-assets.ts dist \
    && bun run --cwd web scripts/embed-assets.ts dist

# Stage 2: Go binary. Built on the build platform and cross-compiled to the
# target arch (Railway runs linux/amd64; this Mac builds arm64), so
# `--platform linux/amd64` costs nothing and never runs bun or go under QEMU.
FROM --platform=$BUILDPLATFORM golang:1.27-bookworm AS build
WORKDIR /src
ARG TARGETOS
ARG TARGETARCH
ENV CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH
COPY go.mod go.sum ./
RUN go mod download
COPY . .
COPY --from=web /src/internal/web/dist internal/web/dist
ARG KATA_VERSION=dev
ARG KATA_COMMIT=unknown
ARG KATA_BUILD_DATE=unknown
RUN go build -trimpath -buildvcs=false \
      -ldflags="-s -w \
        -X go.kenn.io/kata/internal/version.Version=${KATA_VERSION} \
        -X go.kenn.io/kata/internal/version.Commit=${KATA_COMMIT} \
        -X go.kenn.io/kata/internal/version.BuildDate=${KATA_BUILD_DATE}" \
      -o /out/kata ./cmd/kata

# Stage 3: runtime. ca-certificates is required for GitHub sync and for
# Postgres TLS; everything else the daemon needs is in the static binary.
FROM debian:bookworm-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build /out/kata /usr/local/bin/kata
COPY deploy/railway/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
ENV KATA_HOME=/data
EXPOSE 8080
ENTRYPOINT ["/entrypoint.sh"]
