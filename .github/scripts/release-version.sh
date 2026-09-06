#!/usr/bin/env bash
#
# Bumps the patch version in db-viewer-backend/pom.xml (1.0.0 -> 1.0.1), then commits,
# tags and pushes the change back to the branch being built.
#
# The version is the single source of truth for what the app reports: the backend serves it
# from GET /version and the UI shows it in the info modal, so it has to be bumped *before*
# the artifact is built, not after.
#
# Writes `version=<new>` to $GITHUB_OUTPUT when running under GitHub Actions.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
branch="${GITHUB_REF_NAME:-master}"

cd "$repo_root/db-viewer-backend"
chmod +x mvnw

# Ask Maven rather than parsing the POM: <version> appears for the parent and for every
# pinned dependency too, and only the project's own one may change.
current="$(./mvnw -q help:evaluate -Dexpression=project.version -DforceStdout | tail -n 1 | tr -d '[:space:]')"
current="${current%-SNAPSHOT}"

if [[ ! "$current" =~ ^([0-9]+)\.([0-9]+)\.([0-9]+)$ ]]; then
  echo "Refusing to bump non-semantic version '$current'" >&2
  exit 1
fi
next="${BASH_REMATCH[1]}.${BASH_REMATCH[2]}.$(( BASH_REMATCH[3] + 1 ))"

echo "Bumping version $current -> $next" >&2
./mvnw -q versions:set -DnewVersion="$next" -DgenerateBackupPoms=false

cd "$repo_root"
git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
git add db-viewer-backend/pom.xml

# [skip ci] belongs in the message because a push made with GITHUB_TOKEN does not start a new
# workflow run anyway - this keeps the intent obvious and covers a PAT being used later.
git commit -m "chore(release): v$next [skip ci]"

# Land on top of anything merged while this job was running, then tag the final commit.
git pull --rebase --autostash origin "$branch"
git tag -a "v$next" -m "Release $next"
git push --follow-tags origin "HEAD:$branch"

if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
  echo "version=$next" >> "$GITHUB_OUTPUT"
fi
echo "$next"
