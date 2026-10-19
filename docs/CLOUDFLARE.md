# Putting Cloudflare in front

Cloudflare (free plan) sits between visitors and the web app: it filters attacks and bots, absorbs floods, rate-limits sign-in
routes, and hides the app's real address. The steps below keep the site working at every stage and can be undone in a minute.

**What the code already does** (nothing changes until you set the variables in step 7):

- `ORIGIN_LOCK_SECRET` on the web service: when set, the web app serves only requests carrying the header `x-origin-lock` with that
  value. Cloudflare adds the header, so anyone who goes round Cloudflare to the `onrender.com` address gets a 403.
- `TRUST_CLOUDFLARE=true`: the app then reads the visitor's real address from the `x-haab-client-ip` header set by your Cloudflare rule (or, failing that, `cf-connecting-ip`). It is
  honoured **only while the lock is on**, because without the lock anyone could send a made-up address and dodge the rate limits.
- `/healthz` is exempt from the lock and returns only `ok`, for Render's health check.

**Why both variables matter:** behind Cloudflare, every request reaches Render from a Cloudflare address. Without
`TRUST_CLOUDFLARE`, all visitors would share a handful of addresses and the rate limits and audit-log addresses would be wrong.

The API stays on its own public Render address for now (see "What this does not cover").

## HAAB's setup (haabaviation.com)

The live site is the **staging blueprint** (`render.staging.yaml`), deployed from `claude/charming-dijkstra-6bb7fq`. Wherever this guide says
"the web service", it means **`haab-atmp-web-staging`**, and the app is served at `training.haabaviation.com`. Because there is no separate
staging copy, the safe rehearsal is the order below: put Cloudflare in front with the lock **off**, check the site, then turn the lock on
(step 7). The lock can be removed again in a minute.

Records found in public DNS on 2026-10-17 (the GoDaddy table is the source of truth; compare it with what Cloudflare imports):

| Name | Type | Value | In Cloudflare |
|---|---|---|---|
| `haabaviation.com` | A | `132.148.176.101` (GoDaddy hosting) | DNS only |
| `www`, `mail`, `webmail`, `cpanel`, `autodiscover`, `autoconfig` | A / CNAME | the same GoDaddy hosting | DNS only |
| `haabaviation.com` | MX | `0 mail.haabaviation.com` | DNS only |
| `haabaviation.com` | TXT | `v=spf1 a mx ptr include:secureserver.net ~all` | copy exactly |
| `_dmarc` | TXT | `v=DMARC1; p=reject; adkim=r; aspf=r; rua=mailto:dmarc_rua@onsecureserver.net;` | copy exactly |
| `resend._domainkey` | TXT | the long `p=MIGf...` key | **copy every character** (DMARC is `p=reject`) |
| `send` | CNAME | `send.forge.rmta.net` | DNS only |
| `_autodiscover._tcp` | SRV | `0 0 443 cpanelemaildiscovery.cpanel.net` | copy exactly |
| `_domainconnect` | CNAME | `_domainconnect.gd.domaincontrol.com` | optional (GoDaddy helper) |
| `training` | CNAME | `haab-atmp-web-staging.onrender.com` | **Proxied** (the only orange cloud) |

Nameservers today: `ns13.domaincontrol.com`, `ns14.domaincontrol.com`. There is no DNSSEC, so nothing to switch off at GoDaddy first.
Mail and the main website live on GoDaddy hosting, so keep every one of those records, and leave the website records unproxied.
The Cloudflare header rule's hostname is `training.haabaviation.com`.

## Before you start

1. There is no separate staging copy (the live site runs from the staging blueprint), so follow the order in "HAAB's setup": Cloudflare first with the lock off, then the lock.
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
5. **Add the lock header and the visitor's address:** Rules > Transform Rules > Modify Request Header > Create rule.
   - When: Hostname equals `training.yourdomain.com`
   - Then, header 1: **Set static** `x-origin-lock` = your secret.
   - Then, header 2 (**Add** another header): **Set dynamic** `x-haab-client-ip` = `ip.src`.

   The second header carries the visitor's real address. It is needed because Render sits behind Cloudflare too, and Render's layer can
   replace `cf-connecting-ip` with the address of your own Cloudflare. If the audit log shows Cloudflare addresses (104., 172.64 to 172.71,
   188.114.) after step 7, this header is the fix. It must be **Set** (not Add) so a visitor cannot send their own.
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

   Both go in together.

   **Then point every link at the public address.** The API builds the links in invitation and reset emails, the QR code on certificates
   and the "Sign in" link in notices from `PUBLIC_WEB_URL`. If that still holds the `onrender.com` address, all of them hit the origin lock
   and show "Forbidden". On the **API service and the jobs service** set `PUBLIC_WEB_URL` and `WEB_ORIGIN` to `https://training.yourdomain.com`
   (no trailing slash). In Supabase (Authentication > URL Configuration) set the **Site URL** to the same address and add
   `https://training.yourdomain.com/**` to the **Redirect URLs**. Invitations and resets sent before the change must be sent again.

## Check it worked

- `https://training.yourdomain.com` loads and you can sign in.
- `https://<your-web-service>.onrender.com` now answers **403 Forbidden**.
- Sign in, then open Audit log: your entry shows **your own** address, not one starting 104., 172.64 to 172.71 or 188.114 (Cloudflare ranges).
- Render shows the web service as healthy.

## If the audit log shows Cloudflare addresses

Work through these in order. After each change, sign out, sign in, and read the newest `auth.login` entry.

1. Open `https://training.yourdomain.com/healthz?diag=1`. It answers only requests that came through your Cloudflare (they carry the lock
   header) and returns yes/no facts, never addresses: the release running, whether the lock and `TRUST_CLOUDFLARE` are on, which
   headers arrived, and which one the app used. You want `address_taken_from: x-haab-client-ip`. If the release is old, wait for the deploy. If
   `x-haab-client-ip` is missing, the second header in the Cloudflare rule is missing or not deployed.
2. If the app takes the address from `x-haab-client-ip` and the log still shows Cloudflare, **`PROXY_SHARED_SECRET` differs between the
   web service and the API service**. The API then ignores the address the web app sends. Copy the API's value into the web service.
3. A VPN, Cloudflare WARP or iCloud Private Relay really does make your own address a Cloudflare one. Check `cloudflare.com/cdn-cgi/trace`.

## Undo

- Quickest: delete `ORIGIN_LOCK_SECRET` and `TRUST_CLOUDFLARE` in Render and let the service restart. The site is open again at once.
- Or set the `training` DNS record to **DNS only** (grey cloud). Do this with the variables removed, otherwise the site refuses visitors.

## What this does not cover

- The **API's own `onrender.com` address** is still public, so Cloudflare cannot protect it. Making it a Render private service
  closes that (see `docs/SECURITY-AUDIT.md`).
- Cloudflare **Access** (a login wall in front of the whole site) is not recommended here: trainees and client staff would have to
  pass it too. It suits a staging copy.
- Rotate the lock secret from time to time: change it in Cloudflare (step 5) and Render (step 7) within the same few minutes.
