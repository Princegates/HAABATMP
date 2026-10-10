-- Security: the permanent per-session QR secret was included in the attendance roster response, so anyone who could read
-- a roster could compute valid check-in codes. The API no longer returns it; every existing secret is replaced.
update sessions set qr_secret = replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
