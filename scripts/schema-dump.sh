#!/bin/sh
# Dump db/schema.sql from a pinned client. The host's pg_dump is whatever the
# distro ships -- 16, 17 and 18 all produce different output for the same
# database, so a host dump makes the CI drift check fail on version, not schema.
set -e
: "${DATABASE_URL:?set DATABASE_URL}"

docker run --rm --network host postgres:17-alpine \
  pg_dump --schema-only --no-owner --no-privileges --dbname "$DATABASE_URL" \
  > db/schema.sql
