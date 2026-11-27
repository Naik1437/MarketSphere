#!/usr/bin/env sh
set -eu

NEW_TAG="${1:?Usage: deploy.sh <image_tag>}"
PREV_FILE=".last_deployed_tag"
PREV_TAG=""
if [ -f "$PREV_FILE" ]; then
  PREV_TAG=$(cat "$PREV_FILE")
fi

export IMAGE_TAG="$NEW_TAG"
export IMAGE_OWNER="${IMAGE_OWNER:-naik1437}"
docker compose pull
docker compose up -d --no-build

wait_for_health() {
  attempts=0
  while [ "$attempts" -lt 30 ]; do
    if curl -fsS http://localhost:4000/health >/dev/null 2>&1 \
      && curl -fsS http://localhost:3000/api/health >/dev/null 2>&1 \
      && curl -fsS http://localhost:8000/health >/dev/null 2>&1; then
      return 0
    fi
    attempts=$((attempts + 1))
    sleep 2
  done
  return 1
}

if wait_for_health; then
  echo "$NEW_TAG" > "$PREV_FILE"
  echo "Deployment of $NEW_TAG succeeded and passed health checks."
  exit 0
fi

echo "Health check failed for $NEW_TAG; rolling back..."
if [ -n "$PREV_TAG" ]; then
  export IMAGE_TAG="$PREV_TAG"
  docker compose pull
  docker compose up -d --no-build
  if wait_for_health; then
    echo "Rolled back to $PREV_TAG and passed health checks."
  else
    echo "Rollback to $PREV_TAG failed health checks." >&2
  fi
else
  echo "No previous tag recorded; manual recovery is required." >&2
fi
exit 1
