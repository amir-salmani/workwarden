#!/bin/sh
# Dump db/schema.sql from a pinned client. The host's pg_dump is whatever the
# distro ships -- 16, 17 and 18 all produce different output for the same
# database, so a host dump makes the CI drift check fail on version, not schema.
#
# The \restrict / \unrestrict lines carry a fresh random nonce on every run, so
# they are stripped: left in, no two dumps of the same schema ever match.
set -e
: "${DATABASE_URL:?set DATABASE_URL}"

docker run --rm --network host postgres:18-alpine \
  pg_dump --schema-only --no-owner --no-privileges --dbname "$DATABASE_URL" \
  | grep -vE '^\\(un)?restrict ' \
  > db/schema.sql
