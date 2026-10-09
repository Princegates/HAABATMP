-- Two-step sign-in is optional. A person who has turned it on must use it, so we record that here
-- (the identity provider's token alone cannot say "this account has a second factor").
alter table users add column mfa_enrolled boolean not null default false;
