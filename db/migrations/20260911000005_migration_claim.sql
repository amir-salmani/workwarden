-- migrate:up

-- A vault imported from Vaultwarden arrives with all its key material but no
-- usable password hash, because the two are not convertible:
--
--   Vaultwarden stores PBKDF2(clientHash, salt, 600_000)
--   workwarden stores HMAC(pepper, PBKDF2(clientHash, salt, 10_000))
--
-- Both take the client-side hash as input, and the server only ever sees that
-- at login. Re-hashing a Vaultwarden row would mean verifying it once at 600k
-- iterations -- 74 ms against a 10 ms budget (PHASE0.md).
--
-- So an imported user lands with password_hash null and a single-use claim
-- token. The owner redeems it once with their client-side hash, which is the
-- same value a normal login sends, and the account becomes ordinary. The vault
-- data is untouched by any of this: it is still encrypted under the same master
-- key it always was.
alter table users alter column password_hash drop not null;
alter table users add column claim_token text unique;
alter table users add column claimed_at timestamptz;

-- A user is either claimable or logged-in-able, never both.
alter table users add constraint users_claimable_xor_usable
  check (num_nonnulls(password_hash, claim_token) = 1);

-- migrate:down

alter table users drop constraint users_claimable_xor_usable;
alter table users drop column claimed_at;
alter table users drop column claim_token;
delete from users where password_hash is null;
alter table users alter column password_hash set not null;
