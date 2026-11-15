-- Clients from 2026.10 record the id of the user's current user key on the
-- server (POST /api/accounts/key-management/user-key-id) and read it back in
-- the login response; a server that does not answer gets the same POST again
-- after a 24-hour cooldown, and an error in the client log each time.
alter table users add column user_key_id text;
