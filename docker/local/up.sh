#!/usr/bin/env bash
set -euo pipefail

compose=(docker compose -f "$(dirname "$0")/compose.yml")
"${compose[@]}" up --build -d kata
