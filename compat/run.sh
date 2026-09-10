#!/usr/bin/env bash
# Drive a stock @bitwarden/cli against a running workwarden and assert it can
# log in, create an item, sync, and decrypt what it reads back.
#
# This is the claim FEASIBILITY.md §2.2 says nobody in this niche has made: a
# published suite proving a real client works. Unit tests cannot make it,
# because they assert the shape we chose.
#
#   BASE=https://localhost:8787 DATABASE_URL=postgres://... compat/run.sh
set -euo pipefail

BASE="${BASE:?set BASE to the server URL}"
: "${DATABASE_URL:?set DATABASE_URL so the test account can be removed}"
EMAIL="compat-$(date +%s)@workwarden.invalid"
PASSWORD="compat-master-password"

here="$(cd "$(dirname "$0")" && pwd)"
export BITWARDENCLI_APPDATA_DIR="$(mktemp -d)"
# wrangler dev serves a self-signed certificate.
export NODE_TLS_REJECT_UNAUTHORIZED=0
export NO_PROXY='*'
unset http_proxy https_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY all_proxy || true

cleanup() {
  node -e '
    const postgres = require("postgres")
    const sql = postgres(process.env.DATABASE_URL)
    sql`delete from users where email like ${"compat-%@workwarden.invalid"}`
      .then(() => sql.end())
      .catch(() => process.exit(0))
  ' 2>/dev/null || true
  rm -rf "$BITWARDENCLI_APPDATA_DIR"
}
trap cleanup EXIT

say() { printf 'ok   %s\n' "$1"; }

# The account has to be created with real Bitwarden client crypto, or `bw` can
# never derive a key that decrypts it.
EMAIL="$EMAIL" BASE="$BASE" node --input-type=module -e "
  import { makeAccount } from '$here/bitwarden-crypto.mjs'
  const acct = await makeAccount(process.env.EMAIL, '$PASSWORD')
  const r = await fetch(process.env.BASE + '/api/accounts/register', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...acct, name: 'Compat' }),
  })
  if (!r.ok) { console.error(await r.text()); process.exit(1) }
"
say "registered $EMAIL"

npx --no-install bw config server "$BASE" >/dev/null
BW_SESSION="$(npx --no-install bw login "$EMAIL" "$PASSWORD" --raw)"
export BW_SESSION
[ -n "$BW_SESSION" ] || { echo "FAIL login returned no session"; exit 1; }
say "bw login"

ITEM="$(npx --no-install bw get template item \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
      const t=JSON.parse(s); t.name="compat-item"; t.type=1
      t.login={username:"alice",password:"s3cret",totp:null,uris:[]}
      process.stdout.write(JSON.stringify(t))})' \
  | npx --no-install bw encode)"
npx --no-install bw create item "$ITEM" >/dev/null
say "bw create item"

npx --no-install bw sync >/dev/null
say "bw sync"

npx --no-install bw list items | node -e '
  let s = ""
  process.stdin.on("data", (d) => (s += d)).on("end", () => {
    const items = JSON.parse(s)
    const item = items.find((i) => i.name === "compat-item")
    if (!item) throw new Error("compat-item missing from the vault")
    if (item.login.username !== "alice") throw new Error("username did not round-trip")
    if (item.login.password !== "s3cret") throw new Error("password did not round-trip")
    console.log("ok   decrypted the item the client wrote")
  })
'
echo "PASS a stock Bitwarden client can use this server"
