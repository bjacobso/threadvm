#!/usr/bin/env bash

set -uo pipefail

readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

usage() {
  cat <<'EOF'
Usage: setup-base.sh <setup|check> [github] [codex] [claude]

Commands:
  setup  Walk through authentication for every requested tool.
  check  Verify authentication without printing account details or tokens.

When no tools are provided, the script reads base.setup.auth from harness.yaml.
EOF
}

configured_tools() {
  local config_path="${HARNESS_CONFIG:-${SCRIPT_DIR}/../harness.yaml}"
  local tool
  local found=0

  if ! command -v yq >/dev/null 2>&1; then
    printf 'yq is required to read base.setup.auth from %s.\n' "$config_path" >&2
    return 2
  fi
  if [[ ! -f "$config_path" ]]; then
    printf 'Harness config does not exist: %s\n' "$config_path" >&2
    return 2
  fi

  while IFS= read -r tool; do
    if [[ -n "$tool" ]]; then
      printf '%s\n' "$tool"
      found=1
    fi
  done < <(yq -r '.base.setup.auth[]' "$config_path")

  if (( found == 0 )); then
    printf 'No tools are configured in base.setup.auth: %s\n' "$config_path" >&2
    return 2
  fi
}

tool_label() {
  case "$1" in
    github) printf '%s' "GitHub CLI" ;;
    codex) printf '%s' "Codex" ;;
    claude) printf '%s' "Claude Code" ;;
    *) return 1 ;;
  esac
}

tool_binary() {
  case "$1" in
    github) printf '%s' "gh" ;;
    codex) printf '%s' "codex" ;;
    claude) printf '%s' "claude" ;;
    *) return 1 ;;
  esac
}

check_auth() {
  case "$1" in
    github) gh auth status --active >/dev/null 2>&1 ;;
    codex) codex login status >/dev/null 2>&1 ;;
    claude) claude auth status >/dev/null 2>&1 ;;
    *) return 1 ;;
  esac
}

login() {
  case "$1" in
    github)
      gh auth login --web && gh auth setup-git
      ;;
    codex)
      codex login
      ;;
    claude)
      claude auth login
      ;;
    *)
      return 1
      ;;
  esac
}

validate_tools() {
  local tool
  for tool in "$@"; do
    if ! tool_label "$tool" >/dev/null; then
      printf 'Unsupported authentication tool: %s\n' "$tool" >&2
      return 2
    fi
  done
}

check_tools() {
  local failed=0
  local tool label binary

  for tool in "$@"; do
    label="$(tool_label "$tool")"
    binary="$(tool_binary "$tool")"

    if ! command -v "$binary" >/dev/null 2>&1; then
      printf '[missing] %s (%s is not installed)\n' "$label" "$binary"
      failed=1
    elif check_auth "$tool"; then
      printf '[ready]   %s\n' "$label"
    else
      printf '[needed]  %s\n' "$label"
      failed=1
    fi
  done

  return "$failed"
}

prompt_to_login() {
  local label="$1"
  local reply

  while true; do
    printf 'Authenticate %s now? [Y/n] ' "$label"
    IFS= read -r reply
    case "$reply" in
      ""|y|Y|yes|YES) return 0 ;;
      n|N|no|NO) return 1 ;;
      *) printf 'Please answer yes or no.\n' ;;
    esac
  done
}

setup_tools() {
  if [[ ! -t 0 || ! -t 1 ]]; then
    printf 'Base authentication setup requires an interactive terminal.\n' >&2
    return 2
  fi

  local incomplete=0
  local tool label binary

  printf '\nPersonalize this ThreadVM base\n'
  printf 'Authentication output is interactive and is not written to Harness metadata.\n\n'

  for tool in "$@"; do
    label="$(tool_label "$tool")"
    binary="$(tool_binary "$tool")"

    if ! command -v "$binary" >/dev/null 2>&1; then
      printf '[missing] %s: install %s through mise before continuing.\n\n' \
        "$label" "$binary"
      incomplete=1
      continue
    fi

    if check_auth "$tool"; then
      printf '[ready]   %s is already authenticated.\n\n' "$label"
      continue
    fi

    printf '[needed]  %s needs authentication.\n' "$label"
    if ! prompt_to_login "$label"; then
      printf '[skipped] %s remains unauthenticated.\n\n' "$label"
      incomplete=1
      continue
    fi

    if login "$tool" && check_auth "$tool"; then
      printf '\n[ready]   %s authentication verified.\n\n' "$label"
    else
      printf '\n[failed]  %s authentication could not be verified.\n\n' "$label"
      incomplete=1
    fi
  done

  if (( incomplete != 0 )); then
    printf 'Base setup is incomplete. Rerun this command to retry.\n'
    return 1
  fi

  printf 'Base setup complete. This VM is ready to be marked cloneable.\n'
}

main() {
  if (( $# == 0 )); then
    usage >&2
    return 2
  fi

  local command="$1"
  shift

  case "$command" in
    -h|--help|help)
      usage
      return 0
      ;;
  esac

  local tools=("$@")
  local configured tool
  if (( ${#tools[@]} == 0 )); then
    configured="$(configured_tools)" || return $?
    while IFS= read -r tool; do
      tools+=("$tool")
    done <<< "$configured"
  fi

  validate_tools "${tools[@]}" || return $?

  case "$command" in
    setup) setup_tools "${tools[@]}" ;;
    check) check_tools "${tools[@]}" ;;
    *)
      printf 'Unknown command: %s\n\n' "$command" >&2
      usage >&2
      return 2
      ;;
  esac
}

main "$@"
