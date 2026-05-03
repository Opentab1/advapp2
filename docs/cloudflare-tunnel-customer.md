# VenueScope — Camera Connection Setup (Cloudflare Tunnel)

**Estimated time:** 5 minutes
**You will need:** any always-on Mac, Windows, or Linux PC at your venue (back-office desktop, POS server, or a spare laptop you'll leave on)

---

## What this does

Connects your camera system to VenueScope **without any router configuration, port forwarding, or static IP**. A small program called `cloudflared` runs in the background on your venue's PC and creates a private, encrypted tunnel to our cloud. We pull video through that tunnel for analysis.

It's the same technology used by ~hundreds of thousands of small businesses, costs you **nothing** ($0/mo), and leaves no inbound ports open at your venue.

---

## Step 1 — Download the connector

Go to the Cloudflare downloads page:

> **https://github.com/cloudflare/cloudflared/releases/latest**

Pick the right installer for your PC:

| Your computer | Download |
|---------------|----------|
| Windows | `cloudflared-windows-amd64.msi` |
| Mac (Intel) | `cloudflared-darwin-amd64.tgz` |
| Mac (Apple Silicon — M1/M2/M3) | `cloudflared-darwin-arm64.tgz` |
| Linux | `cloudflared-linux-amd64.deb` (or `.rpm`) |

Run the installer. It takes 30 seconds.

---

## Step 2 — Run the install command we sent you

We will send you a single command in your onboarding email. It looks like:

```
cloudflared service install eyJhIjoi...long-string...
```

**Open a terminal** (on Mac: Spotlight → "Terminal" · on Windows: Start → "Command Prompt"), paste the command, hit Enter.

You should see:

```
2026-05-03T19:00:00Z INF Generated Argo Tunnel credentials
2026-05-03T19:00:01Z INF Connection registered connIndex=0 ...
```

**That's it.** The connector is now installed as a background service that auto-starts on boot, survives reboots, and reconnects if your internet briefly drops.

---

## Step 3 — Verify it's running (optional)

In the terminal:

| Your computer | Command |
|---------------|---------|
| Mac / Linux | `sudo launchctl list \| grep cloudflared` (Mac) or `systemctl status cloudflared` (Linux) |
| Windows | `Get-Service cloudflared` (PowerShell) |

You should see a "running" or "active" state.

You can close the terminal — the service keeps running in the background.

---

## How to tell us it's connected

Reply to our onboarding email with one word: **"running"**. We'll confirm the tunnel is live on our side and turn on your cameras within a few minutes.

---

## What happens next

- We pull video from your existing NVR through the tunnel
- Our AI analyzes drink count, occupancy, and other metrics in real time
- Your dashboard fills in within ~5 minutes of activation
- **Nothing changes about your existing camera system** — we just observe

---

## FAQ

**Does the PC need to stay on?**
Yes. The connector runs on it. Any always-on PC works — POS server, back-office desktop, or a spare laptop you leave plugged in.

**What if the PC is rebooted?**
The connector auto-starts on boot. After a reboot, it reconnects within 30 seconds.

**Can I use a Mac that goes to sleep?**
Disable sleep on that Mac (System Settings → Battery → never sleep when plugged in). Or use a different always-on machine.

**Is this safe?**
Yes. The tunnel is outbound-only — Cloudflare cannot reach into your network. It's the same technology used by thousands of restaurants, hotels, and small businesses for safe remote access. **No ports are opened on your router.**

**Can I cancel anytime?**
Yes. Run `cloudflared service uninstall` and the connector stops. We'll lose access to your cameras immediately.

**Does it slow down my internet?**
Negligible. The connector uses ~10 KB/s when idle and ~1-2 Mbps per active camera stream. A typical bar with 16 cameras uses about as much bandwidth as one Netflix HD stream.

---

If anything is unclear or doesn't work, reply to our onboarding email or call us at [your support number]. We'll walk you through it.
