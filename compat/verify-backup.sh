#!/usr/bin/env bash
# Prove the backup is restorable, by destroying a vault and bringing it back.
#
# A backup nobody has restored is a rumour. This runs the whole cycle against a
# throwaway database: build a vault with a real client, export it, delete every
# row, restore from the encrypted file alone, then log in with a *fresh* client
# and check the passwords come back.
#
#   BASE=https://localhost:8787 DATABASE_URL=postgres://... \
#   AGE_RECIPIENT=age1... AGE_IDENTITY=key.txt compat/verify-backup.sh
set -euo pipefail

BASE="${BASE:?set BASE}"
: "${DATABASE_URL:?set DATABASE_URL}"
: "${AGE_RECIPIENT:?set AGE_RECIPIENT}"
: "${AGE_IDENTITY:?set AGE_IDENTITY}"

here="$(cd "$(dirname "$0")" && pwd)"
root="$(dirname "$here")"
EMAIL="restore-$(date +%s)@workwarden.invalid"
PASSWORD="restore-master-password"
OUT="$(mktemp -d)"

export BITWARDENCLI_APPDATA_DIR="$OUT/bw"
export NODE_TLS_REJECT_UNAUTHORIZED=0
export NO_PROXY='*'
unset http_proxy https_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY all_proxy || true
trap 'rm -rf "$OUT"' EXIT

psql_do() { node -e "
  const postgres = require('postgres')
  const sql = postgres(process.env.DATABASE_URL)
  sql.unsafe(process.argv[1]).then(() => sql.end()).catch((e) => { console.error(e.message); process.exit(1) })
" "$1"; }

EMAIL="$EMAIL" BASE="$BASE" node --input-type=module -e "
  import { makeAccount } from '$here/bitwarden-crypto.mjs'
  const acct = await makeAccount(process.env.EMAIL, '$PASSWORD')
  const r = await fetch(process.env.BASE + '/api/accounts/register', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...acct, name: 'Restore' }),
  })
  if (!r.ok) { console.error(await r.text()); process.exit(1) }
"
npx --no-install bw config server "$BASE" >/dev/null
BW_SESSION="$(npx --no-install bw login "$EMAIL" "$PASSWORD" --raw)"
export BW_SESSION

ITEM="$(npx --no-install bw get template item \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
      const t=JSON.parse(s); t.name="restore-item"; t.type=1
      t.login={username:"carol",password:"restore-me",totp:null,uris:[]}
      process.stdout.write(JSON.stringify(t))})' \
  | npx --no-install bw encode)"
npx --no-install bw create item "$ITEM" >/dev/null
echo "ok   built a vault with a real client"

node "$root/scripts/export-vault.mjs" "$OUT/export" >/dev/null
# Named for the vault, so pick this vault's: whatever else is on this database
# also has a backup file, and restoring someone else's proves nothing.
USER_ID="$(node -e '
  const postgres = require("postgres")
  const sql = postgres(process.env.DATABASE_URL)
  sql`select id from users where email = ${process.argv[1]}`
    .then((r) => { console.log(r[0]?.id ?? ""); return sql.end() })
' "$EMAIL")"
BACKUP="$OUT/export/$USER_ID.json.age"
[ -n "$USER_ID" ] && [ -f "$BACKUP" ] || { echo "FAIL no backup for $EMAIL"; exit 1; }
echo "ok   exported and encrypted"

psql_do "delete from users where email = '$EMAIL'"
REMAINING="$(node -e "
  const postgres = require('postgres')
  const sql = postgres(process.env.DATABASE_URL)
  sql\`select count(*)::int as n from users where email = \${'$EMAIL'}\`
    .then(r => { console.log(r[0].n); return sql.end() })
")"
[ "$REMAINING" = "0" ] || { echo "FAIL vault was not actually deleted"; exit 1; }
echo "ok   deleted the vault"

node "$root/scripts/restore-vault.mjs" "$BACKUP" >/dev/null
echo "ok   restored from the encrypted backup"

# What the server will actually authenticate against, so a failure below says
# which half is wrong: the row, or the client's view of it.
node -e '
  const postgres = require("postgres")
  const sql = postgres(process.env.DATABASE_URL)
  sql`select email, kdf_type, kdf_iterations, length(salt) as salt_len,
             left(password_hash, 8) as hash_head, claim_token is null as no_claim
        from users where email = ${process.argv[1]}`
    .then((r) => { console.log("     restored row:", JSON.stringify(r[0] ?? null)); return sql.end() })
' "$EMAIL"
curl -sk -X POST "$BASE/identity/accounts/prelogin/password" \
  -H 'content-type: application/json' -d "{\"email\":\"$EMAIL\"}" \
  | sed 's/^/     prelogin says: /'
echo

# A brand new client directory: nothing cached, nothing remembered.
export BITWARDENCLI_APPDATA_DIR="$OUT/bw-fresh"
npx --no-install bw config server "$BASE" >/dev/null
BW_SESSION="$(npx --no-install bw login "$EMAIL" "$PASSWORD" --raw)"
export BW_SESSION
npx --no-install bw sync >/dev/null

npx --no-install bw list items | node -e '
  let s = ""
  process.stdin.on("data", (d) => (s += d)).on("end", () => {
    const item = JSON.parse(s).find((i) => i.name === "restore-item")
    if (!item) throw new Error("the restored vault is missing its item")
    if (item.login.password !== "restore-me") throw new Error("the password did not survive the restore")
    console.log("ok   a fresh client decrypted the restored vault")
  })
'
psql_do "delete from users where email = '$EMAIL'"
echo "PASS the backup restores a working vault"
