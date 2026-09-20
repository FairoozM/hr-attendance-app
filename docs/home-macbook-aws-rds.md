# Home MacBook: connect to private HR & BI AWS RDS

Use this only on the home branch laptop setup. The database is private; do not make
RDS public. Ordinary save / edit / delete in the app writes **live company data**.

## Prerequisites

- AWS CLI + Session Manager plugin
- IAM permission to `ssm:StartSession` on the HR backend EC2 instance
- Local `backend/.env` (gitignored) already pointed at the tunnel (see env names below)
- Local Postgres on `:5432` can stay running; the tunnel uses `:15432`

## 1. Start the SSM tunnel

```bash
~/.hr-attendance-home/bin/hr-rds-ssm-tunnel.sh
```

Leave that terminal open. It forwards `127.0.0.1:15432` → private
`hr-attendance-production` PostgreSQL via EC2. Wait until you see
`Waiting for connections…`.

## 2. Start the backend

```bash
cd /Users/urviabdi/Desktop/hr-attendance-app-home/backend
npm start
```

Confirm boot logs include:

- `tls=verified-rds-tunnel`
- `DB_SKIP_SCHEMA_CHANGES=1 — skipping automatic schema ensure/migrate steps`
- `DISABLE_STARTUP_BACKGROUND_JOBS=1 — skipping inventory warm and subscription sync timers`

API: `http://localhost:5001`

## 3. Start the frontend

```bash
cd /Users/urviabdi/Desktop/hr-attendance-app-home
npm run dev
```

Vite proxies `/api` to `http://localhost:5001`.

## Required environment variable names

Set these in gitignored `backend/.env` (values never belong in Git):

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Loopback tunnel URL (`127.0.0.1:15432`, database `hr_attendance`, app role) |
| `DATABASE_TLS_SERVERNAME` | Real `*.rds.amazonaws.com` hostname (verified TLS through the tunnel) |
| `DB_SKIP_SCHEMA_CHANGES` | `1` — connectivity check only; no automatic schema ensure/migrate |
| `DISABLE_STARTUP_BACKGROUND_JOBS` | `1` — no Zoho boot sync, inventory warm, or subscription timers |
| `ZOHO_AUTO_SYNC_ON_START` | Keep `0` |
| `INVENTORY_HEALTH_WARM_ON_START` | Keep `0` |
| `PORT` | `5001` |

Credentials come from Secrets Manager `hr-attendance/rds/app` (not from chat or Git).
Do not point this home setup at the website database `lifesmiledbnew`.

Production EC2 leaves `DB_SKIP_SCHEMA_CHANGES`, `DISABLE_STARTUP_BACKGROUND_JOBS`, and
`DATABASE_TLS_SERVERNAME` unset and connects to the RDS hostname directly.

## Live-data warning

This connection is intentional. Normal app actions (save, edit, delete, imports,
payment posting, etc.) can change live AWS data. Prefer read-only use unless you
mean to write production.

## Safely stop

1. Stop the frontend (Ctrl+C in the Vite terminal).
2. Stop the backend (Ctrl+C in the `npm start` terminal).
3. Stop the tunnel (Ctrl+C in the SSM tunnel terminal).

Local Postgres on `:5432` and its backups are separate; do not merge local records
into AWS. Do not deploy from this home branch unless that is an explicit separate task.

Env backups (outside Git): `~/.hr-attendance-home/env-backups/`
