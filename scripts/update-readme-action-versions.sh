#!/usr/bin/env bash

# Keep the GitHub Action versions in README examples current.
#
# For every `uses: owner/repo@vN` reference in the README, bump N to the
# action's latest released major (covers upstream actions like
# actions/checkout and peter-evans/create-pull-request as well as this
# action's own major alias). Also refresh the SHA-pinned example in the
# Security section to the latest release commit and tag.
#
# Dependabot updates `uses:` refs in real workflow files but never inside
# Markdown code fences, so without this the examples silently rot. The
# script only edits the file; the calling workflow opens the PR.
#
# Requires the `gh` CLI authenticated (GH_TOKEN in CI) and Bash 4+.

set -euo pipefail

if [[ ${BASH_VERSINFO[0]:-0} -lt 4 ]]; then
  echo "Error: this script requires Bash 4 or later (mapfile)." >&2
  exit 1
fi

if ! command -v gh > /dev/null 2>&1; then
  echo "Error: the gh CLI is required (GH_TOKEN in CI)." >&2
  exit 1
fi

README="${1:-README.md}"
SELF="michen00/boilerplate-sync"
changed=false

if [[ ! -f "$README" ]]; then
  echo "Error: $README not found" >&2
  exit 1
fi

# latest released major for owner/repo, or empty if it has no release
latest_major() {
  local repo="$1" tag
  tag=$(gh api "repos/${repo}/releases/latest" --jq '.tag_name' 2> /dev/null || true)
  [[ -z "$tag" ]] && return 0
  printf '%s' "$tag" | sed -E 's/^v?([0-9]+).*/\1/'
}

# --- 1. Major-pinned refs: owner/repo@vN -> latest released major ---
mapfile -t refs < <(
  { grep -oE 'uses: [A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+@v[0-9]+' "$README" || true; } |
    sed -E 's/^uses: //' | sort -u
)

if [[ ${#refs[@]} -gt 0 ]]; then
  for ref in "${refs[@]}"; do
    repo="${ref%@*}"
    cur="${ref##*@v}"
    latest=$(latest_major "$repo")
    if [[ -z "$latest" ]]; then
      echo "::warning::no latest release for ${repo}; leaving @v${cur}"
      continue
    fi
    if [[ "$latest" =~ ^[0-9]+$ ]] && ((10#$latest > 10#$cur)); then
      echo "Bump ${repo}: v${cur} -> v${latest}"
      # Escape the literal '.' (the only ERE metacharacter a GitHub repo name
      # can contain) via Bash parameter expansion -- no subshell, and Bash 4+
      # is required above. Trailing (non-digit|end) keeps @v6 out of @v60.
      repo_re="${repo//./\\.}"
      sed -i.bak -E "s#${repo_re}@v${cur}([^0-9]|\$)#${repo}@v${latest}\1#g" "$README"
      rm -f "${README}.bak"
      changed=true
    fi
  done
fi

# --- 2. SHA-pinned self example -> latest release commit + tag ---
self_tag=$(gh api "repos/${SELF}/releases/latest" --jq '.tag_name' 2> /dev/null || true)
if [[ -n "$self_tag" ]]; then
  self_sha=$(gh api "repos/${SELF}/commits/${self_tag}" --jq '.sha' 2> /dev/null || true)
  if [[ "$self_sha" =~ ^[0-9a-f]{40}$ ]] &&
    grep -qE "${SELF}@[0-9a-f]{40} # v[0-9][0-9.]*" "$README" &&
    ! grep -qF "${SELF}@${self_sha} # ${self_tag}" "$README"; then
    echo "Bump SHA example -> ${self_sha} (${self_tag})"
    sed -i.bak -E \
      "s|${SELF}@[0-9a-f]{40} # v[0-9][0-9.]*|${SELF}@${self_sha} # ${self_tag}|g" \
      "$README"
    rm -f "${README}.bak"
    changed=true
  fi
fi

echo "changed=${changed}"
if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
  echo "changed=${changed}" >> "$GITHUB_OUTPUT"
fi
