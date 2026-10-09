# Going live

Work through this in order. Each step says how to check it worked.

## 1. Supabase (database, sign-in, files)

1. Create a project. Choose the region closest to your users that your data-protection advice allows.
2. **Authentication > Sign In / Providers**: switch **"Allow new users to sign up" OFF**. This matters. People are only
   ever invited from inside the platform.
3. **Authentication > Multi-Factor**: enable TOTP. This only makes it available; nobody is forced to use it unless the Super Admin requires it for a role.
4. **Authentication > URL Configuration**: set **Site URL** to the platform's address (for example `https://training.yourdomain.com`) and add
   `https://training.yourdomain.com/set-password` under **Redirect URLs**. Invitation and password-reset links open that page.
   Leave the default email templates for now; you can brand them later.
5. **Storage**: create a bucket named `atmp-documents` and make it **private**.
6. **Database > Backups**: turn on point-in-time recovery on a paid plan. The SRS targets are a 24 hour RPO and 4 hour RTO.
   Point-in-time recovery gets you to minutes, which is better.
7. Collect: project URL, the publishable key (or legacy `anon`), the secret key (or legacy `service_role`; both styles work), the pooled database URL (Transaction pooler, port 6543). A separate direct URL is optional: Render cannot reach the IPv6-only direct connection, and migrations work through the pooler.
   If the project uses the newer asymmetric signing keys, nothing more is needed. If it still uses the legacy shared secret,
   also set `SUPABASE_JWT_SECRET`.

Check: you can open the project's SQL editor.

## 2. Secrets

Generate two values and keep a sealed copy of the first somewhere safe (a password manager the directors control):

```bash
openssl rand -base64 32    # DATA_ENCRYPTION_KEY. If lost, saved integration keys and ID numbers cannot be recovered.
openssl rand -hex 24       # PROXY_SHARED_SECRET. Set the same value on the API and on the web service.
```

## 3. Render

1. Create a branch called `production` from the release you tested on staging. Production deploys only from it.
2. In Render choose **New > Blueprint**, select the repository, set the branch to `production`, and the Blueprint path to `render.yaml`.
3. Render asks for each secret (the ones marked `sync: false`) for the API, the web service and the housekeeping job. The API and the housekeeping job take the same values.
   `DATABASE_URL` is the Supabase **Transaction pooler** string with your password in it (letters and digits only avoids encoding problems).
   `WEB_ORIGIN` and `PUBLIC_WEB_URL` are your final address (for example `https://training.yourdomain.com`; use the `onrender.com` address until the domain is connected).
   `PROXY_SHARED_SECRET` must be identical on the API, the web service and the job. `API_URL` is the API's own address.
4. Choose the Frankfurt region unless advised otherwise. There is no African region.
5. Deploy. The API applies database migrations before each release.

Check: `https://<api-url>/health` answers `{"status":"ok"}` and the web address shows the sign-in page.

## 4. Domain (GoDaddy)

Use a subdomain such as `training.yourdomain.com` so the main website and any existing email stay untouched.
In Render, add the custom domain to the web service and create the CNAME it shows at GoDaddy. HTTPS is automatic.
Before changing anything, copy your current DNS records.

Optional but recommended: put the domain's DNS on Cloudflare (free) for a firewall and rate limiting in front of the app,
and Cloudflare Access if you want to restrict the platform to staff and known client networks. Set SSL mode to Full (strict).

## 5. The first super administrator

Nobody can sign up and nobody exists yet to invite you, so run this once from the API service's shell in Render:

```bash
npm run create-super-admin -w apps/api -- you@yourdomain.com "Your Name"
```

An invitation email arrives. The link opens the set-password page; choose a password, and sign in. Two-step sign-in is optional and off by default: turn it on yourself under **My profile**, or require it for chosen roles under **System setting > Security Setting**. The command refuses to
run again once a super administrator exists.

### Load HAAB's course categories

From the API service's shell, once:

```bash
npm run seed-catalogue -w apps/api
```

It adds the eight training categories and one draft placeholder course for each offering. It creates no people and no passwords, and running it again changes nothing. The courses stay drafts until HAAB sets their real duration, fee and validity.

## 6. Email

Create a Resend account, verify your sending domain (it gives you DNS records to add; **merge** its SPF entry into any
existing one, a domain should have only one), then in the platform go to **System setting > API & Integrations > Email**,
paste the key and sender, save, and press **Test connection**. Do the same for malware scanning if you run ClamAV.

## 7. Branding

The HAAB logo is already in the repository (`apps/web/public/brand/haab-logo.png`). It shows in white on the dark sidebar and sign-in
screen, and in navy on certificates, invoices and receipts, with no setting needed. To use a different file, replace that one.

## 8. Before you let anyone in

- [ ] Sign in as the super administrator and confirm two-step sign-in works: turn it on under My profile, sign out and in again, then turn it off.
- [ ] **System setting > General Setting**: organisation name, address, registration number.
- [ ] **Currency**, **Payment Methods** (bank and mobile money details printed on invoices), **Training Rules**.
- [ ] Activate real courses with their true duration, fee, validity and approving body. The seeded courses are drafts with placeholders.
- [ ] Create the other staff and the first client organisations; invite people.
- [ ] Run a **backup restore drill** and record it under System setting > Backup Restore.
- [ ] Run `select * from audit_verify();` (or press "Verify the chain" on the Audit screen). It must report no problems.
- [ ] Have someone independent carry out a penetration test. The platform holds identity documents and results.
- [ ] Confirm the Ghana Data Protection Act position: registration with the Commission, retention periods, and hosting abroad.
- [ ] Agree the exact wording shown to trainees about how long records are kept.

## Operations

- **Releases**: merge to `main`. Test on the staging blueprint first (`render.staging.yaml`, separate Supabase project).
- **Housekeeping** runs every 15 minutes as a cron job. If it stops, emails stop and exams that timed out stay open until the trainee returns.
- **Logs** are in Render. Add Sentry or similar for error alerts.
- **Lost authenticator device**: another administrator presses **Reset two-step** on the person in System setting > Users. They then sign in with their password and set it up again. (If the only super administrator loses their phone, remove the factor in the Supabase dashboard and run `update users set mfa_enrolled = false where email = '...';`.)
