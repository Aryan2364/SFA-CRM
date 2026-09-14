#!/usr/bin/env bash
# Run this ON THE SERVER to deploy the latest image from GHCR.
#   ./deploy.sh
# It pulls the newest image, restarts the container, and cleans up old images.
set -euo pipefail

COMPOSE_FILE="docker-compose.deploy.yml"

echo "==> Pulling latest image from GHCR..."
docker compose -f "$COMPOSE_FILE" pull

echo "==> Starting/restarting containers..."
docker compose -f "$COMPOSE_FILE" up -d

echo "==> Cleaning up old, unused images..."
docker image prune -f

echo "==> Done. Current status:"
docker compose -f "$COMPOSE_FILE" ps
