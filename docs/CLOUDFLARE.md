# Putting Cloudflare in front

Cloudflare (free plan) sits between visitors and the web app: it filters attacks and bots, absorbs floods, rate-limits sign-in
routes, and hides the app's real address. The steps below keep the site working at every stage and can be undone in a minute.

**What the code already does** (nothing changes until you set the variables in step 7):

- `ORIGIN_LOCK_SECRET` on the web service: when set, the web app serves only requests carrying the header `x-origin-lock` with that
  value. Cloudflare adds the header, so anyone who goes round Cloudflare to the `onrender.com` address gets a 403.
- `TRUST_CLOUDFLARE=true`: the app then reads the visitor's real address from Cloudflare's `cf-connecting-ip` header. It is
  honoured **only while the lock is on**, because without the lock anyone could send a made-up address and dodge the rate limits.
- `/healthz` is exempt from the lock and returns only `ok`, for Render's health check.

**Why both variables matter:** behind Cloudflare, every request reaches Render from a Cloudflare address. Without
`TRUST_CLOUDFLARE`, all visitors would share a handful of addresses and the rate limits and audit-log addresses would be wrong.

The API stays on its own public Render address for now (see "What this does not cover").

## Before you start

1. Deploy this release to staging first (`render.staging.yaml`) and rehearse the whole list there with a staging hostname.
2. In Render, open each web service's settings and set **Health Check Path** to `/healthz` (the blueprint now says so, but a
   service created earlier keeps its old value until you change it or sync the blueprint).
3. Copy every DNS record from GoDaddy (screenshot the list). **Moving nameservers moves all of the domain's DNS**, including mail
   records (MX, SPF, DKIM, DMARC) for the main domain. Cloudflare imports what it finds; compare it line by line.
4. Create a secret and keep it in your password manager: `openssl rand -hex 32`.

## Steps

1. **Add the site** at cloudflare.com (Free plan). Check the imported DNS records against your copy. Missing records must be added
   before the next step.
2. **Change the nameservers** at GoDaddy to the two Cloudflare gives you. Wait until Cloudflare shows the site as **Active**
   (minutes to a few hours). The site and email keep working throughout.
3. **DNS:** the `training` record is a CNAME to your web service's `onrender.com` name (as Render shows it). Switch it to
   **Proxied** (orange cloud). Leave every mail record as **DNS only**. Do not add a record for the API.
4. **SSL/TLS:** set the mode to **Full (strict)**; turn on **Always Use HTTPS**; minimum TLS version 1.2.
   If Render cannot renew the certificate while proxied, set the record to DNS only for a few minutes, let Render verify, then proxy it again.
5. **Add the lock header:** Rules > Transform Rules > Modify Request Header > Create rule.
   - When: Hostname equals `training.yourdomain.com`
   - Then: **Set static** header `x-origin-lock` = your secret.
6. **Protect the sign-in routes and tidy the settings:**
   - Security > WAF: turn the free managed ruleset on. Security > Bots: turn **Bot Fight Mode** on.
   - Rate-limiting rule (the free plan allows one): when URI Path equals `/api/session` and Method is POST, more than 30 requests in 10 seconds
     from one IP, then Block for 10 seconds. The app has its own, finer limits behind this.
   - Caching > Cache Rules: **Bypass cache** when URI Path starts with `/api/`. Cloudflare does not cache pages by default; this makes it explicit.
   - Speed > Optimization: turn **off** Rocket Loader and Auto Minify, and Scrape Shield > **Email Address Obfuscation**. They rewrite
     page code and can break the app.
   - Do not use "I'm Under Attack" mode during exams: it puts a challenge page in front of every trainee.

   **Check now, before step 7:** open the site through its normal address, sign in, and click around. The lock is still off, so it should work exactly as before.

7. **Turn the lock on** (Render > web service > Environment), then let it restart:

   | Variable | Value |
   |---|---|
   | `ORIGIN_LOCK_SECRET` | the secret from step 4 |
   | `TRUST_CLOUDFLARE` | `true` |

   Both go in together. The API service needs no change.

## Check it worked

- `https://training.yourdomain.com` loads and you can sign in.
- `https://<your-web-service>.onrender.com` now answers **403 Forbidden**.
- Sign in, then open Audit log: your entry shows **your own** address, not one starting 104., 172.64 to 172.71 or 188.114 (Cloudflare ranges).
- Render shows the web service as healthy.

## Undo

- Quickest: delete `ORIGIN_LOCK_SECRET` and `TRUST_CLOUDFLARE` in Render and let the service restart. The site is open again at once.
- Or set the `training` DNS record to **DNS only** (grey cloud). Do this with the variables removed, otherwise the site refuses visitors.

## What this does not cover

- The **API's own `onrender.com` address** is still public, so Cloudflare cannot protect it. Making it a Render private service
  closes that (see `docs/SECURITY-AUDIT.md`).
- Cloudflare **Access** (a login wall in front of the whole site) is not recommended here: trainees and client staff would have to
  pass it too. It suits a staging copy.
- Rotate the lock secret from time to time: change it in Cloudflare (step 5) and Render (step 7) within the same few minutes.
