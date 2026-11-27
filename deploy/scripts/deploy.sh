#!/usr/bin/env sh
set -eu

NEW_TAG="${1:?Usage: deploy.sh <image_tag>}"
PREV_FILE=".last_deployed_tag"
PREV_TAG=""
if [ -f "$PREV_FILE" ]; then
  PREV_TAG=$(cat "$PREV_FILE")
fi

export IMAGE_TAG="$NEW_TAG"
docker compose pull
docker compose up -d

if curl -fsS http://localhost:4000/health >/dev/null && curl -fsS http://localhost:3000/api/health >/dev/null; then
  echo "$NEW_TAG" > "$PREV_FILE"
  echo "Deployment of $NEW_TAG succeeded and passed health checks."
  exit 0
fi

echo "Health check failed for $NEW_TAG; rolling back..."
if [ -n "$PREV_TAG" ]; then
  export IMAGE_TAG="$PREV_TAG"
  docker compose up -d
  echo "Rolled back to $PREV_TAG."
fi
exit 1
