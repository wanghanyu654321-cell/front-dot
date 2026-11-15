#!/usr/bin/env bash
# shellcheck disable=SC2034
# Variables are consumed by the entry point that sources this library.
set -euo pipefail

apply=0
allow_dirty=0
allow_non_main=0
DEPLOY_DIR=${DEPLOY_DIR:-/opt/front-dot}
for argument in "$@"; do
  case "$argument" in
    --apply) apply=1 ;;
    --allow-dirty) allow_dirty=1 ;;
    --allow-non-main) allow_non_main=1 ;;
    *) echo 'unknown argument' >&2; exit 2 ;;
  esac
done
if (( apply )); then echo 'apply: planned actions follow'; else echo 'dry-run: no changes'; fi

require_server_config() {
  : "${ENV_FILE:?server env file required}" "${DEPLOY_DIR:?deployment directory required}"
  test -f "$ENV_FILE" && test "$(stat -c '%a' "$ENV_FILE")" = 600 || { echo 'env file must have mode 600' >&2; exit 2; }
  case "$(realpath -m "$ENV_FILE")" in "$(git rev-parse --show-toplevel)"/*) echo 'env file must be outside repository' >&2; exit 2 ;; esac
  case "$(realpath -m "$DEPLOY_DIR")" in "$(git rev-parse --show-toplevel)"/*) echo 'state directory must be outside repository' >&2; exit 2 ;; esac
}
compose() {
  docker compose --env-file "$ENV_FILE" -p front-dot -f deploy/compose.json "$@"
}
stop_consumer() {
  echo 'stop old: gracefully stop core'
  compose stop core
  echo 'confirm no consumer: container stopped and PG lease released or expired'
  local running
  running=$(compose ps --status running -q core)
  [[ -z "$running" ]] || { echo 'consumer still running' >&2; return 1; }
  compose run --rm --no-deps -T admin verify-consumer
}
start_consumer() {
  echo 'start new: one long connection core'
  compose up -d --no-build --wait --wait-timeout 90 core
}
valid_sha() { [[ "$1" =~ ^[a-f0-9]{40}$ ]]; }
state_field() {
  local value
  if ! value=$(node --input-type=module - "$DEPLOY_DIR/state.json" "$1" <<'NODE'
import { readFileSync } from 'node:fs';
try {
  const state = JSON.parse(readFileSync(process.argv[2], 'utf8'));
  const value = state?.[process.argv[3]];
  if (!/^[a-f0-9]{40}$/.test(value ?? '')) throw Error();
  process.stdout.write(value);
} catch { process.exitCode = 2; }
NODE
  ); then
    echo 'rollback state unavailable: state.json must contain valid current and previous commit SHAs; restore reviewed state before retrying' >&2
    return 2
  fi
  printf '%s' "$value"
}

write_state() {
  mkdir -p "$DEPLOY_DIR"
  chmod 700 "$DEPLOY_DIR"
  node --input-type=module - "$DEPLOY_DIR/state.json" "$1" "$2" <<'NODE'
import { writeFileSync, renameSync } from 'node:fs';
const file = process.argv[2];
writeFileSync(file + '.new', JSON.stringify({ current: process.argv[3], previous: process.argv[4] }) + '\n', { mode: 0o600 });
renameSync(file + '.new', file);
NODE
}
