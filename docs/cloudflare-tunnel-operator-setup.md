# Cloudflare Tunnel — One-Time Operator Setup

This is YOUR (Stephanos / VenueScope ops) one-time setup. Once done, you can
onboard 25+ venues without ever touching this again.

**Estimated time:** ~30 minutes the first time, ~5 minutes per venue thereafter.

---

## Prerequisites

You need:
- A domain you own (we'll use a subdomain of it for tunnels)
- ~$10 if you don't have a domain yet (Cloudflare Registrar sells them at-cost)

If you don't have a domain, the cheapest option is buying a `.cloud`, `.bar`,
or `.app` from Cloudflare Registrar — costs $5-10/yr. Or you can use any
domain you already own (e.g., a subdomain of `advizia.ai` or
`venuescope.com`). The domain name doesn't matter for functionality —
customers never see it; it's only used as the tunnel hostname VenueScope
worker pulls from.

For this guide, I'll use `tunnels.venuescope.cloud` as the example. Replace
with whatever subdomain you choose.

---

## Step 1 — Cloudflare account

1. Go to https://dash.cloudflare.com/sign-up
2. Sign up with `steph@advizia.ai` (or whatever email you use for ops)
3. Verify the email
4. Free plan is fine — no upgrade needed

---

## Step 2 — Add your domain to Cloudflare

If your domain isn't already on Cloudflare:

1. In the Cloudflare dashboard, click **Add a Site**
2. Enter `venuescope.cloud` (or whatever your domain is)
3. Pick **Free** plan
4. Cloudflare will scan your DNS records — accept what it imports
5. Cloudflare gives you 2 nameservers (e.g., `dana.ns.cloudflare.com` + `gabe.ns.cloudflare.com`)
6. Go to your domain registrar (where you bought the domain — GoDaddy, Namecheap, etc.) and replace the existing nameservers with Cloudflare's two
7. Wait 5-30 minutes for DNS propagation. Cloudflare emails you when active.

If you bought the domain THROUGH Cloudflare Registrar, skip this step.

---

## Step 3 — Enable Cloudflare Zero Trust (free)

1. In the Cloudflare dashboard, click **Zero Trust** in the left sidebar
2. Pick a team name like `venuescope` (this is internal, doesn't matter much)
3. Pick the **Free** plan (covers up to 50 users — way more than enough)
4. You may be asked for a credit card — Cloudflare requires it to prevent abuse but won't charge you on Free plan

---

## Step 4 — Generate an API Token (for automation)

1. Top-right profile menu → **My Profile** → **API Tokens**
2. Click **Create Token**
3. Use the **"Custom token"** template
4. Give it a name: `venuescope-tunnels`
5. Permissions:
   - `Account` → `Cloudflare Tunnel` → `Edit`
   - `Account` → `Account Settings` → `Read`
   - `Zone` → `DNS` → `Edit` (scoped to your tunnel zone, e.g., `venuescope.cloud`)
6. Account Resources: include the account containing your tunnel zone
7. Zone Resources: include `venuescope.cloud` (or whatever your tunnel domain is)
8. **Continue to summary** → **Create Token**
9. **Copy the token immediately** — Cloudflare shows it once. Looks like `abc123def456...` (40 chars).

Store this token in 1Password or similar. You'll paste it into the Lambda env when ready to automate.

---

## Step 5 — Get your Account ID + Zone ID

1. Cloudflare dashboard home → click `venuescope.cloud` (or your tunnel domain)
2. **Right sidebar** shows:
   - **Account ID** — copy this
   - **Zone ID** — copy this

Store both somewhere safe. You'll paste them into the Lambda env later.

---

## Step 6 — Create your first tunnel manually (for Fergs)

The automation Lambda isn't built yet (that's CONN-2 follow-up work). For
Fergs THIS WEEK, do the tunnel creation manually — takes 5 minutes.

### 6a. Create the tunnel

1. Cloudflare Zero Trust dashboard → **Networks** → **Tunnels** (left sidebar)
2. Click **Create a tunnel**
3. Pick **Cloudflared** as the connector type
4. Tunnel name: `fergs` (use the venueId; one tunnel per venue)
5. Click **Save tunnel**
6. The next page shows the install commands for various OS. **Copy the token from the command** — it's the long string after `--token`. Looks like `eyJhIjoi...` (~150 chars).
7. Save this token — it's what you'll send Fergs in the onboarding email

### 6b. Configure the public hostname

1. Still on the tunnel setup page, click **Next**
2. Public hostname:
   - Subdomain: `fergs`
   - Domain: `venuescope.cloud` (your tunnel domain)
   - Path: leave empty
3. Service:
   - Type: `HTTP` (CORTEX IQ NVRs serve HLS over HTTP) or `RTSP` (if exposing RTSP directly)
   - URL: `10.20.20.48:80` (Fergs's NVR LAN IP and port — get from CORTEX IQ → System → System Information)
4. Click **Save tunnel**

That's it on your side. Now Fergs needs to install cloudflared.

### 6c. Email Fergs the install command

Send Fergs the customer-facing PDF (`docs/cloudflare-tunnel-customer.md` in
this repo) along with this command:

```
cloudflared service install eyJhIjoi...<the-token-from-step-6a>...
```

When Fergs runs that command on a back-office PC, the tunnel goes live within ~30 seconds.

### 6d. Verify in Cloudflare dashboard

Back in Cloudflare Zero Trust → Networks → Tunnels, the `fergs` tunnel
should now show "**Healthy**" with at least 1 connector.

### 6e. Add to VenueScope admin UI

1. Open VenueScope admin → **The Fergs Bar** → Cameras tab
2. Connection Method picker → pick **Cloudflare Tunnel**
3. Enter the public hostname: `https://fergs.venuescope.cloud`
4. Worker will start pulling cameras through the tunnel within ~60 seconds

---

## Step 7 — Done. For venue #2 onwards…

Repeat 6a-6e for each new venue. Each takes ~5 minutes.

When you have ~15 minutes, ping me to wire up the Lambda automation. After
that, the operator clicks "Generate Tunnel" in the admin UI and we'll do
6a-6c automatically — install command appears in a copy-paste box, no
Cloudflare dashboard visits needed for new venues.

---

## Cost summary

| Component | Cost |
|-----------|------|
| Cloudflare account | $0 |
| Cloudflare Zero Trust (Free plan, ≤50 users) | $0 |
| Tunnel bandwidth | $0 (no published cap on Free tier) |
| Domain registration | ~$10/yr (one-time per company, not per venue) |

**Per-venue marginal cost: $0/mo, forever.** This is why every serious
competitor uses this pattern — it's the cheapest reliable remote-access
method that exists for small business networks.
