# Self-Hosting Supabase — the $0-forever path

Loomola needs a Postgres database and an auth system. The [README quickstart](../README.md#self-host-quickstart) uses a **free Supabase cloud project** for both — that's the easiest start and, with Loomola's egress optimizations, a single user stays comfortably inside the free tier (your video/audio is served from your own object storage, never through Supabase, so the only data crossing Supabase is small database query results).

This guide is the **alternative for people who want zero external accounts and zero usage caps**: run Supabase *itself* on your own VPS with [Coolify](https://coolify.io). Self-hosted Supabase is the same software — same `auth.users`, same auth, same row-level security — so Loomola talks to it with **no code changes**, just different connection values. Your only cost is the VPS you already run.

> **Is this for you?** If you just want Loomola working, use the cloud-Supabase quickstart — it's faster and the free tier is fine for one person. Choose this path if you're already comfortable with Coolify/VPS administration and want nothing metered. Self-hosted Supabase is ~13 containers and wants **4 GB RAM minimum** (8 GB if this same VPS also runs Loomola + MinIO).

---

## What you need first

- A VPS with **Coolify already installed** (Coolify's one-line installer sets up Docker + Traefik + Let's Encrypt for you). 4 GB RAM minimum for Supabase alone.
- A **domain** you control, with DNS pointing at the VPS — you'll attach a subdomain like `supabase.your-domain.com` to the Supabase API gateway.
- Loomola itself deployed (or about to be) — via the README's compose path or as a Coolify app from the Dockerfile. This guide covers the Supabase half and exactly which Loomola env vars to set.

---

## Step 1 — Deploy Supabase in Coolify

1. In Coolify: **Projects → Add**, create a project (e.g. `supabase`), Environment **production**.
2. **Add New Resource → Services → search "Supabase" → select the Supabase template.** Pick your server, then **Save** (don't deploy yet).
3. **Attach a domain to the API gateway _before_ the first deploy.** In the service's stack, click the **`supabase-kong`** container → **Settings → Domains**, and set:
   ```
   https://supabase.your-domain.com
   ```
   This is the single public URL that fronts the whole Supabase API (auth, REST, storage). Other services read it, so set it first. Traefik will issue the HTTPS certificate automatically.
4. **Randomize the pooler tenant id before first deploy.** In **Environment Variables**, change `POOLER_TENANT_ID` from the default `dev_tenant` to a random string (`openssl rand -hex 8`). It's baked into pooled connection strings and is painful to change later.
5. Click **Deploy**. First deploy pulls images and initializes Postgres — give it a few minutes.

> Coolify auto-generates all the secrets (Postgres password, JWT secret, anon/service keys, Studio login). You don't hand-write any JWTs — that's the big difference from the raw Supabase Docker guide.

---

## Step 2 — Collect four credentials from Coolify

Open the Supabase service's **Environment Variables** (Developer view) and copy these four values. The left column is the **exact Coolify variable name** (verify in your UI — variable names can drift slightly between Coolify/Supabase versions):

| Copy this Coolify value | It is your… |
|---|---|
| `SERVICE_SUPABASEANON_KEY` | Supabase **anon key** |
| `SERVICE_SUPABASESERVICE_KEY` | Supabase **service_role key** |
| `SERVICE_PASSWORD_POSTGRES` | Postgres **password** |
| the domain you set on `supabase-kong` (Step 1.3) | Supabase **API URL** |

You'll also see `SERVICE_USER_ADMIN` / `SERVICE_PASSWORD_ADMIN` — those are the **Supabase Studio dashboard** login (the admin UI at your Kong URL). Save them in a password manager; Studio is your only DB admin UI.

---

## Step 3 — Point Loomola at your self-hosted Supabase

Set these in Loomola's environment (`.env.compose` for the compose path, or the Coolify app's env vars). The mapping:

```bash
# Public API URL (the supabase-kong domain from Step 1.3). Used by both the
# browser and the server, so it MUST be the public https URL.
SUPABASE_URL=https://supabase.your-domain.com
NEXT_PUBLIC_SUPABASE_URL=https://supabase.your-domain.com

# Keys from Step 2.
SUPABASE_ANON_KEY=<SERVICE_SUPABASEANON_KEY>
NEXT_PUBLIC_SUPABASE_ANON_KEY=<SERVICE_SUPABASEANON_KEY>
SUPABASE_SERVICE_ROLE_KEY=<SERVICE_SUPABASESERVICE_KEY>

# Database connection — see the two options below.
DATABASE_URL=postgresql://postgres:<SERVICE_PASSWORD_POSTGRES>@supabase-db:5432/postgres
```

> **`NEXT_PUBLIC_*` are build-time.** Next.js bakes them into the browser bundle when the image is built, not at runtime. Compose users get this automatically (`docker compose up --build`). If you deploy Loomola as a Coolify app, set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` as **build args**, not just runtime env.

### Which `DATABASE_URL`?

**Option A — Loomola runs on the same Coolify server (recommended).** Use Supabase's internal Docker hostname `supabase-db` — the connection never leaves the VPS, so nothing extra is exposed:
```
postgresql://postgres:<SERVICE_PASSWORD_POSTGRES>@supabase-db:5432/postgres
```
For Loomola's container to resolve `supabase-db`, the two resources must share a Docker network. In Coolify, enable **"Connect To Predefined Network"** on both the Supabase service and the Loomola resource (or put them in the same project/network). If Loomola can't reach `supabase-db` at boot (migrations will fail with a connection error), this network step is almost always why.

**Option B — Loomola runs elsewhere.** Connect through the public pooler (note the **tenant-qualified username**) after exposing the pooler port:
```
postgresql://postgres.<POOLER_TENANT_ID>:<SERVICE_PASSWORD_POSTGRES>@supabase.your-domain.com:6543/postgres
```
Exposing Postgres publicly is a security step — restrict by source IP and enable SSL. Prefer Option A whenever possible.

---

## Step 4 — Auth email (mostly optional for Loomola)

Self-hosted Supabase ships with **no working email transport** until you configure SMTP. Good news: Loomola barely needs it.

- **Creating your admin account** (the first-run `/setup` screen) goes through the service-role admin API and **auto-confirms** — no email required. ✅
- **Inviting more users** uses Loomola's own Mailgun config, or shows a copy-paste link when email isn't set — no Supabase email required. ✅
- **Password reset** (`Forgot password?`) is the one flow that uses Supabase's email. Two choices:
  - Set `ENABLE_EMAIL_AUTOCONFIRM=true` in the Supabase env (harmless — Loomola already auto-confirms), and either wire SMTP for resets **or** accept that you'll reset a forgotten password from the **Supabase Studio** dashboard instead.
  - To enable reset emails, set the GoTrue SMTP vars in the Supabase service: `SMTP_HOST`, `SMTP_PORT` (587), `SMTP_USER`, `SMTP_PASS`, `SMTP_ADMIN_EMAIL`, `SMTP_SENDER_NAME` (any provider — Mailgun, SES, Postmark, Resend).

For a single-user instance, skipping SMTP is fine.

---

## Step 5 — Migrate, first run, verify

Loomola runs its database migrations automatically at boot. Once its env points at your self-hosted Supabase:

- **Compose path:** `docker compose --env-file .env.compose up -d --build` — migrations run as the container starts.
- **Coolify app path:** deploy; migrations run at boot.

Then verify the wiring with the built-in doctor (run from a checkout with the same env):
```bash
npm run doctor
```
It live-checks the database connection, Supabase auth, storage, and your AI keys — one line each. Fix anything that shows ✗ before moving on.

Open Loomola, and the first visit takes you to **`/setup`** to create your admin account. Sign in, record a short test, and confirm it transcribes and plays back.

---

## How auth works here (and a small performance note)

Loomola authenticates with `supabase.auth.getClaims()`. On a **default self-hosted Supabase** (symmetric `HS256` JWT secret), `getClaims` validates each token against your own GoTrue auth server — a fast, free, local-network call. **It works out of the box; no Loomola change needed.**

If you want the marginal optimization of fully offline token verification (no auth round-trip at all), enable **asymmetric (ES256) JWT signing keys** on Supabase — the current self-hosted stack supports it and keeps old tokens valid. It's optional and unnecessary for a single-tenant instance; see Supabase's [self-hosted auth keys doc](https://supabase.com/docs/guides/self-hosting/self-hosted-auth-keys).

---

## Security checklist

- **Change/secure the Studio dashboard login** (`SERVICE_USER_ADMIN` / `SERVICE_PASSWORD_ADMIN`). Studio is your live database admin UI — protected only by the gateway's basic auth.
- **Don't expose Postgres publicly** unless you're using Option B; the only thing the internet should reach is the Kong gateway on 443 (Traefik handles its TLS).
- **Randomized `POOLER_TENANT_ID`** (Step 1.4) so pooled connection strings aren't guessable.
- **Keep all keys in Coolify env / a secrets manager** — never in committed files.
- Consider stopping the `supabase-studio` container in production if you don't need the dashboard day-to-day.

---

## Cost reality check

This path costs **only your VPS** — the same machine already running Loomola and MinIO. No Supabase cloud bill, no egress meter. A Hostinger/Hetzner VPS with 8 GB RAM (enough for Supabase + Loomola + MinIO together) runs well under what Loom + Granola cost per month, and you own all of it.

---

*Recipe verified against the live Coolify Supabase template and official Supabase self-hosting docs as of 2026-06. Coolify/Supabase variable names and the container set can drift between versions — if a `SERVICE_*` name here doesn't match your deploy, trust what's in your Coolify Environment Variables panel.*
