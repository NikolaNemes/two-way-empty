#!/usr/bin/env bash
#
# One-way fast-forward sync of a single branch to a mirror remote.
#
# Run from inside a full (non-shallow) clone of the SOURCE repo. It compares the
# source branch against the same branch on the target remote and pushes only if
# the push is a clean fast-forward. Anything else is a no-op or a hard error:
# it never force-pushes, never merges, never rebases.
#
# Required:
#   MIRROR_TARGET_URL   SSH URL of the mirror to push to
#                       (e.g. git@github.com:NikolaNemes/two-way-empty.git)
# Optional:
#   BRANCH              branch to sync (default: develop)
#   MIRROR_SSH_KEY      private key with write access to the target. If set, it
#                       is used instead of the ambient ssh agent/identity.
#   MIRROR_KNOWN_HOSTS  known_hosts entries for the target host. If unset, the
#                       host key is fetched with ssh-keyscan (TOFU).
#
# Exit codes: 0 = pushed or already in sync, 1 = diverged / error.

set -euo pipefail

BRANCH="${BRANCH:-develop}"
TARGET_URL="${MIRROR_TARGET_URL:-}"
REMOTE_NAME="mirror-target"

log()  { printf '%s\n' "==> $*"; }
fail() { printf '%s\n' "ERROR: $*" >&2; exit 1; }

[ -n "$TARGET_URL" ] || fail "MIRROR_TARGET_URL is not set"
git rev-parse --git-dir >/dev/null 2>&1 || fail "not inside a git repository"

# --- ssh setup ---------------------------------------------------------------
TMPDIR_SSH=""
cleanup() { [ -n "$TMPDIR_SSH" ] && rm -rf "$TMPDIR_SSH"; }
trap cleanup EXIT

target_host() {
  # git@host:path  ->  host      ssh://git@host:port/path -> host
  case "$TARGET_URL" in
    ssh://*) printf '%s' "$TARGET_URL" | sed -E 's#^ssh://([^@]+@)?([^:/]+).*#\2#' ;;
    *)       printf '%s' "$TARGET_URL" | sed -E 's#^([^@]+@)?([^:]+):.*#\2#' ;;
  esac
}

if [ -n "${MIRROR_SSH_KEY:-}" ]; then
  TMPDIR_SSH="$(mktemp -d)"
  chmod 700 "$TMPDIR_SSH"

  printf '%s\n' "$MIRROR_SSH_KEY" > "$TMPDIR_SSH/id"
  # Tolerate keys stored with literal \n or with a missing trailing newline.
  if ! grep -q 'PRIVATE KEY' "$TMPDIR_SSH/id"; then
    printf '%b\n' "$MIRROR_SSH_KEY" > "$TMPDIR_SSH/id"
  fi
  chmod 600 "$TMPDIR_SSH/id"

  KNOWN_HOSTS="$TMPDIR_SSH/known_hosts"
  if [ -n "${MIRROR_KNOWN_HOSTS:-}" ]; then
    printf '%s\n' "$MIRROR_KNOWN_HOSTS" > "$KNOWN_HOSTS"
  else
    host="$(target_host)"
    log "scanning host key for $host (pin it via MIRROR_KNOWN_HOSTS to avoid TOFU)"
    ssh-keyscan -H "$host" > "$KNOWN_HOSTS" 2>/dev/null || fail "ssh-keyscan failed for $host"
  fi
  chmod 600 "$KNOWN_HOSTS"

  export GIT_SSH_COMMAND="ssh -i $TMPDIR_SSH/id -o IdentitiesOnly=yes -o UserKnownHostsFile=$KNOWN_HOSTS -o StrictHostKeyChecking=yes"
fi

# --- resolve source ----------------------------------------------------------
SRC_SHA="$(git rev-parse --verify --quiet "refs/heads/$BRANCH" || true)"
if [ -z "$SRC_SHA" ]; then
  # CI checkouts often land on a detached HEAD; fall back to the remote-tracking
  # ref, then to HEAD itself (which CI guarantees is the pushed commit).
  SRC_SHA="$(git rev-parse --verify --quiet "refs/remotes/origin/$BRANCH" || true)"
fi
if [ -z "$SRC_SHA" ] && [ -n "${CI_COMMIT_BRANCH:-}${GITHUB_REF_NAME:-}" ]; then
  SRC_SHA="$(git rev-parse --verify --quiet HEAD || true)"
fi
[ -n "$SRC_SHA" ] || fail "branch '$BRANCH' not found locally (need refs/heads/$BRANCH or refs/remotes/origin/$BRANCH)"

if [ "$(git rev-parse --is-shallow-repository)" = "true" ]; then
  fail "repository is a shallow clone; fast-forward cannot be verified (use fetch-depth: 0 / GIT_DEPTH: 0)"
fi

log "source $BRANCH = $SRC_SHA"

# --- resolve target ----------------------------------------------------------
git remote remove "$REMOTE_NAME" 2>/dev/null || true
git remote add "$REMOTE_NAME" "$TARGET_URL"

TGT_SHA="$(git ls-remote --heads "$REMOTE_NAME" "$BRANCH" | awk '{print $1}')"

if [ -z "$TGT_SHA" ]; then
  log "target has no '$BRANCH' yet; creating it"
  git push "$REMOTE_NAME" "$SRC_SHA:refs/heads/$BRANCH"
  log "done: created $BRANCH at $SRC_SHA"
  exit 0
fi

log "target $BRANCH = $TGT_SHA"

if [ "$SRC_SHA" = "$TGT_SHA" ]; then
  log "already in sync; nothing to do"
  exit 0
fi

# Need the target commit locally to reason about ancestry.
git fetch --no-tags "$REMOTE_NAME" "+refs/heads/$BRANCH:refs/remotes/$REMOTE_NAME/$BRANCH"

if ! git cat-file -e "$TGT_SHA^{commit}" 2>/dev/null; then
  fail "could not fetch target commit $TGT_SHA"
fi

# --- decide ------------------------------------------------------------------
if git merge-base --is-ancestor "$TGT_SHA" "$SRC_SHA"; then
  log "fast-forward: target is $(git rev-list --count "$TGT_SHA..$SRC_SHA") commit(s) behind"
  git push "$REMOTE_NAME" "$SRC_SHA:refs/heads/$BRANCH"
  log "done: $BRANCH fast-forwarded to $SRC_SHA"
  exit 0
fi

if git merge-base --is-ancestor "$SRC_SHA" "$TGT_SHA"; then
  log "target is ahead of source by $(git rev-list --count "$SRC_SHA..$TGT_SHA") commit(s); nothing to push"
  exit 0
fi

fail "branches have DIVERGED (source $SRC_SHA, target $TGT_SHA, merge-base $(git merge-base "$SRC_SHA" "$TGT_SHA" || echo none)); refusing to push. Reconcile '$BRANCH' manually."
