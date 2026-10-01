#!/usr/bin/env bash
# Build www/ and publish it as the gh-pages branch, which GitHub Pages serves at https://key.gregy.cz/.
# The branch holds only the generated page, as a single commit replaced on every deploy.
set -euo pipefail
cd "$(dirname "$0")"
[ "${1:-}" = "--no-build" ] || ./knockpage.py
REMOTE=$(git remote get-url origin)
REV=$(git rev-parse --short HEAD)$(git diff --quiet HEAD -- src knockpage.py || echo -dirty)
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
cp -a www/. "$TMP"/
git -C "$TMP" init -q -b gh-pages
git -C "$TMP" add -A
git -C "$TMP" -c user.name="$(git config user.name)" -c user.email="$(git config user.email)" commit -q -m "Build of $REV"
git -C "$TMP" push -q -f "$REMOTE" gh-pages
echo "pushed gh-pages ($REV); live at https://key.gregy.cz/ within a minute or two"
