#!/usr/bin/env bash
# Drive a stock @bitwarden/cli against a running workwarden and assert it can
# log in, create an item, sync, and decrypt what it reads back.
#
# This is the claim FEASIBILITY.md §2.2 says nobody in this niche has made: a
# published suite proving a real client works. Unit tests cannot make it,
# because they assert the shape we chose.
#
# The server must allow exactly this address to register, so start it with
#   npx wrangler dev --var OWNER_EMAIL:compat@workwarden.invalid
# and then
#   BASE=http://localhost:8787 compat/run.sh
set -euo pipefail

BASE="${BASE:?set BASE to the server URL}"
EMAIL="compat@workwarden.invalid"
PASSWORD="compat-master-password"

here="$(cd "$(dirname "$0")" && pwd)"
export BITWARDENCLI_APPDATA_DIR="$(mktemp -d)"
# wrangler dev serves a self-signed certificate.
export NODE_TLS_REJECT_UNAUTHORIZED=0
export NO_PROXY='*'
unset http_proxy https_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY all_proxy || true

# One account, once: the local D1 must be empty before and after.
reset_db() {
  npx --no-install wrangler d1 execute workwarden --local \
    --command "delete from users" >/dev/null 2>&1 || true
}
cleanup() {
  reset_db
  rm -rf "$BITWARDENCLI_APPDATA_DIR"
}
reset_db
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
FOLDER_ID="$(printf '{"name":"compat-folder"}' | npx --no-install bw encode | npx --no-install bw create folder | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).id))')"
[ -n "$FOLDER_ID" ] || { echo "FAIL folder has no id"; exit 1; }
say "bw create folder"

ITEM_ID="$(npx --no-install bw list items --search compat-item | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s)[0].id))')"
npx --no-install bw get item "$ITEM_ID" \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
      const t=JSON.parse(s); t.folderId=process.argv[1]; t.login.password="r0tated"
      process.stdout.write(JSON.stringify(t))})' "$FOLDER_ID" \
  | npx --no-install bw encode | npx --no-install bw edit item "$ITEM_ID" >/dev/null
npx --no-install bw sync >/dev/null
npx --no-install bw get item "$ITEM_ID" | node -e '
  let s = ""
  process.stdin.on("data", (d) => (s += d)).on("end", () => {
    const item = JSON.parse(s)
    if (item.folderId !== process.argv[1]) throw new Error("edit did not move the item into the folder")
    if (item.login.password !== "r0tated") throw new Error("edit did not change the password")
    if (!Array.isArray(item.passwordHistory) || item.passwordHistory.length !== 1)
      throw new Error("password history was not kept by the client round-trip")
    console.log("ok   bw edit item: folder, password and history round-trip")
  })
' "$FOLDER_ID"

npx --no-install bw delete item "$ITEM_ID" >/dev/null
npx --no-install bw sync >/dev/null
npx --no-install bw list items --trash | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
  const t=JSON.parse(s); if(!t.some(i=>i.id===process.argv[1])) throw new Error("soft delete did not land in the trash")})' "$ITEM_ID"
say "bw delete item (to trash)"

npx --no-install bw restore item "$ITEM_ID" >/dev/null
npx --no-install bw sync >/dev/null
npx --no-install bw list items | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
  const t=JSON.parse(s); if(!t.some(i=>i.id===process.argv[1])) throw new Error("restore did not bring the item back")})' "$ITEM_ID"
say "bw restore item"

npx --no-install bw delete folder "$FOLDER_ID" >/dev/null
npx --no-install bw sync --force >/dev/null
npx --no-install bw get item "$ITEM_ID" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
  if (JSON.parse(s).folderId != null) throw new Error("deleting the folder did not unfile its item")})'
say "bw delete folder: item survives, unfiled"

echo "PASS a stock Bitwarden client can use this server"
