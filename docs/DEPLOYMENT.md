# Deploying to production

How the server apps (web, admin, api, worker) go live on AWS, and how the desktop installers get published.
Do the first deploy once, top to bottom (about 1–2 hours). After that, **every push to `main` deploys itself.**

```
                 DNS: example.com, www., api., admin.  →  Elastic IP
                                     │
 ┌───────────────────────── EC2 (Ubuntu 24.04, Docker) ─────────────────────────┐
 │  Caddy :443 (automatic HTTPS)                                                │
 │    ├── example.com        → web    (Next.js)                                 │
 │    ├── admin.example.com  → admin  (Next.js)                                 │
 │    └── api.example.com    → api    (Fastify + WebSockets) ──┐                │
 │                              worker (BullMQ) ───────────────┼── redis        │
 └─────────────────────────────────────────────────────────────┼────────────────┘
                                                               └── Supabase (Postgres + Auth)

 GitHub Actions ──(OIDC, no stored keys)──► ECR (images) + S3 (release bundle) ──► SSM runs deploy.sh on the server
 Desktop installers ──► GitHub Releases
```

| What | Where |
|---|---|
| `Dockerfile` | One multi-stage file; `--target api / worker / web / admin` builds each image |
| `deploy/` | What runs on the server: `compose.yml`, `Caddyfile`, `deploy.sh` |
| `infra/` | Terraform for all AWS resources, plus `scripts/push-secrets.sh` and secret templates |
| `.github/workflows/deploy.yml` | Push to `main` → build 4 images → deploy → smoke test |
| `.github/workflows/ci.yml` | Pull requests: typecheck + build every image |
| `.github/workflows/uptime.yml` | Hourly health check; also keeps a free Supabase project from pausing |
| `.github/workflows/desktop.yml` | `desktop-v*` tag → installers for Windows, macOS, Linux → draft GitHub Release |

**Rough cost:** about $20–25/month (t3.small, public IPv4, 30 GB disk; ECR and S3 cost cents). New AWS accounts
get free-plan credits that cover this for several months. `t3.micro` (about $8/month) also works: the whole
stack idles at about 250 MB of RAM.

---

## 1. Tools on your laptop

| Tool | Install |
|---|---|
| AWS CLI v2 | https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html |
| Session Manager plugin (shell into the server) | https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-working-with-install-plugin.html |
| Terraform ≥ 1.6 | https://developer.hashicorp.com/terraform/install |
| GitHub CLI (optional, makes step 6 one paste) | https://cli.github.com, then `gh auth login` |

## 2. AWS account

1. Create an AWS account. Then, **before anything else**, open **Billing → Budgets → Create budget →
   "Zero spend budget"** (or a $10 monthly budget). AWS emails you as soon as anything costs money.
2. Make a login for the CLI. Don't use the root user. The simplest option is **IAM → Users → Create user**
   with `AdministratorAccess`, then **Security credentials → Create access key (CLI)**.
3. Configure the CLI in the region you'll use for everything (Mumbai shown here):
   ```bash
   aws configure          # paste the key, region ap-south-1, output json
   aws sts get-caller-identity   # prints your account id if it worked
   ```

## 3. Supabase (production project)

1. At supabase.com, create a **new project** for production, in the **same region** as AWS
   (e.g. *South Asia (Mumbai)*). Save the database password.
2. Push the schema from this repo:
   ```bash
   npx supabase link --project-ref <your-project-ref>
   npx supabase db push
   ```
3. **Authentication → URL Configuration:** set Site URL to `https://example.com`, and add Redirect URL
   `https://example.com/**`.
4. **Authentication → Emails → Templates:** paste each file from `supabase/templates/` into the matching template.
5. **Authentication → Emails → SMTP Settings:** enter your Brevo SMTP details. Supabase's built-in sender
   is limited to a few emails an hour.
6. Google sign-in (optional): in Google Cloud, add the redirect URI `https://<ref>.supabase.co/auth/v1/callback`,
   then enable **Authentication → Providers → Google** with the client id and secret.
7. Note these for later:
   - Project URL (`https://<ref>.supabase.co`)
   - Publishable key
   - **Connect → Session pooler** connection string. Use the pooler, not "Direct connection": that one is
     IPv6-only on the free plan, and the server can't reach it.

## 4. Create the AWS infrastructure

```bash
cd infra
cp terraform.tfvars.example terraform.tfvars   # set domain, acme_email, region
terraform init
terraform apply                                # review the plan, type "yes"
```

This takes about 2 minutes, and the server then spends about 5 more minutes installing Docker. It prints:
- `server_ip`
- `dns_records`
- `github_variables`
- `shell`

Run `terraform output` any time to see them again.

> `terraform.tfstate` in `infra/` is now the record of what exists in AWS. It's git-ignored, so back it up
> (or move it to an S3 backend). Without it, Terraform can't manage or delete these resources.

## 5. DNS

At your domain registrar (or Route 53), create the four **A records** from `dns_records`, all pointing at
`server_ip`:
- `example.com`
- `www`
- `api`
- `admin`

Do this **before the first deploy**: Caddy requests HTTPS certificates as soon as it starts.
Check that they resolve with `dig +short api.example.com`.

## 6. Secrets and GitHub settings

**Server secrets** are stored encrypted in AWS SSM Parameter Store, never in git or on GitHub:

```bash
cp infra/secrets/api.env.example    infra/secrets/api.env      # git-ignored
cp infra/secrets/worker.env.example infra/secrets/worker.env   # git-ignored
# fill both in (Session pooler DATABASE_URL, API keys, Brevo, admin password…)
infra/scripts/push-secrets.sh api    infra/secrets/api.env
infra/scripts/push-secrets.sh worker infra/secrets/worker.env
```

**GitHub variables.** Paste the `gh variable set …` lines from the `github_variables` output, then add the
public build settings:

```bash
gh variable set NEXT_PUBLIC_SUPABASE_URL             --body 'https://<ref>.supabase.co'
gh variable set NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY --body 'sb_publishable_…'
gh variable set NEXT_PUBLIC_DESKTOP_VERSION          --body '0.1.0'
gh variable set NEXT_PUBLIC_DOWNLOADS_URL            --body 'https://github.com/arvindydv/interview-ai/releases/download/desktop-v0.1.0'
```

Without the CLI, add the same names under **repo → Settings → Secrets and variables → Actions → Variables**.
These are variables, not secrets, because none of them is secret: the publishable key ships in the browser anyway.

**GitHub environment.** Go to **repo → Settings → Environments → New environment** and name it `production`.
Optionally, add yourself under *Required reviewers* so every deploy waits for one click.

## 7. First deploy

Merge your branch into `main` and push (or run **Actions → Deploy → Run workflow** on `main`). The workflow:
1. builds the 4 images, in parallel, and pushes them to ECR,
2. uploads `deploy/` to S3 and runs `deploy.sh` on the server through SSM,
3. confirms `https://api.example.com/health` reports this exact commit, and that the website responds.

The first run takes about 10 minutes; later runs take 3–5, thanks to the build cache. Then open `https://example.com`
and sign in end to end.

## 8. Day-to-day operations

| Task | How |
|---|---|
| Deploy | Push to `main` |
| Shell on the server | `aws ssm start-session --target <instance-id>` (no SSH keys, no open port 22) |
| Logs | On the server: `cd /opt/parakeet/current && sudo docker compose logs -f --tail 100 api` |
| Status | `sudo docker compose ps` (same directory) |
| Change a secret | Edit `infra/secrets/*.env`, run `push-secrets.sh` again, then redeploy (re-run the last Deploy workflow) |
| Roll back | **Actions → Deploy → re-run** an older successful run, or on the server: `sudo /opt/parakeet/releases/<sha>/deploy.sh <sha>` |
| Bigger server | Set `instance_type = "t3.medium"` in `terraform.tfvars`, then `terraform apply` (about a minute of downtime) |
| Uptime alerts | A failing **Uptime** workflow emails you. GitHub pauses scheduled workflows after 60 days without commits; re-enable it under Actions if that happens. |

Every deploy only restarts containers whose image changed. While a container restarts, Caddy holds incoming
requests for up to 10 seconds instead of returning errors. Desktop apps on a live WebSocket reconnect on their own.

## 9. Desktop app

1. **Before the first public release**, set a permanent `identifier` in `apps/desktop/src-tauri/tauri.conf.json`
   (it's `com.bidyourstay.parakeet` now). Changing it later loses users' saved sign-in and app data.
2. Add repo variables so installers talk to production. They're compiled into the app:
   ```bash
   gh variable set PARAKEET_WEB_URL                  --body 'https://example.com'
   gh variable set PARAKEET_API_URL                  --body 'https://api.example.com'
   gh variable set PARAKEET_SUPABASE_URL             --body 'https://<ref>.supabase.co'
   gh variable set PARAKEET_SUPABASE_PUBLISHABLE_KEY --body 'sb_publishable_…'
   ```
3. Bump `version` in `tauri.conf.json`, then tag the release:
   ```bash
   git tag desktop-v0.1.0 && git push origin desktop-v0.1.0
   ```
4. After about 20 minutes, **Releases** shows a draft with every installer. Click **Publish**.
5. If the version changed, update `NEXT_PUBLIC_DESKTOP_VERSION` and `NEXT_PUBLIC_DOWNLOADS_URL` (step 6), then
   redeploy so the website's download buttons point at the new files.

**Code signing (needed before real users).** Unsigned apps show *"Windows protected your PC"* on Windows,
and *"app is damaged"* on macOS.
- **macOS:** Apple Developer Program ($99/year) → *Developer ID Application* certificate → add the `APPLE_*`
  secrets to the repo and pass them to `tauri-action` in `desktop.yml`. Tauri notarizes automatically.
- **Windows:** Azure Trusted Signing (about $10/month) or an OV certificate.
- **Linux:** no signing needed.

## 10. When you have revenue

In this order:
1. **Supabase Pro** ($25/month): no pausing, daily backups, dedicated compute.
2. **Auto-updates** for the desktop app (`tauri-plugin-updater`).
3. **Terraform state in S3**, and a **staging** copy of this setup.
4. **More scale:** the same images run unchanged on ECS Fargate behind a load balancer, with ElastiCache for Redis.
