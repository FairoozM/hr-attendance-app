# HR & BI database migration: EC2-local PostgreSQL → private AWS RDS

Scope: the HR & BI database `hr_attendance` only. The Life Smile website database
`lifesmiledbnew` and the Amazon UAE Initial Draft Generator are out of scope and were
not touched.

## Target infrastructure

| Item | Value |
| --- | --- |
| RDS identifier | `hr-attendance-production` |
| Engine | PostgreSQL 16.15 (matches the EC2 source exactly) |
| Instance class | `db.t4g.micro`, Single-AZ |
| Storage | 20 GB gp3, autoscaling to 100 GB, no provisioned IOPS |
| Encryption | Enabled, AWS-managed key `alias/aws/rds` |
| Availability Zone | `eu-central-1b` (same AZ as the backend EC2) |
| Networking | `vpc-038c7dcccdfb70974`, subnet group `default-vpc-038c7dcccdfb70974` |
| Public access | Disabled; the endpoint resolves only to a private VPC address |
| Security group | `hr-attendance-rds`, ingress TCP 5432 from the backend EC2 security group only |
| Backups | 14-day automated retention, point-in-time recovery enabled |
| Protection | Deletion protection enabled, automatic minor-version upgrades enabled |
| Parameter group | `hr-attendance-pg16` (`postgres16` family) with `rds.force_ssl=1` |

`rds.force_ssl` is a dynamic parameter and the group was attached at instance creation,
so no reboot was required. Enforcement is verified by attempting a plaintext connection
from the EC2 host, which the server rejects.

## Credentials

Two AWS Secrets Manager secrets, holding the only copies of the generated passwords:

- `hr-attendance/rds/master` — RDS master user (`hr_master`). Break-glass only; the
  application never uses it.
- `hr-attendance/rds/app` — application role (`hr_app`). Used by the backend.

`hr_app` is a non-superuser login role (`NOSUPERUSER`, `NOCREATEDB`, `NOCREATEROLE`,
`NOREPLICATION`) that owns the `hr_attendance` database and the `public` schema, which is
exactly what the startup migrations in `backend/src/db/index.js` need. `CREATE` on
`public` is revoked from `PUBLIC`.

The EC2 instance role carries an inline policy scoped to these two secret ARNs, so the
host fetches credentials itself. Passwords are never passed through SSM command
parameters, deployment output, logs or Git.

## Application TLS

`backend/src/db/dbConnectionConfig.js` is the single authority on database TLS:

- **localhost** (`localhost`, `127.0.0.1`, `::1`, `*.localhost`) keeps `ssl: false`, so
  local development is unchanged.
- **`*.rds.amazonaws.com`** uses the committed Amazon RDS `eu-central-1` root CA bundle
  with `rejectUnauthorized: true`, `servername` set to the endpoint and a TLS 1.2 floor.
  Chain and hostname validation both stay on; `rejectUnauthorized: false` appears nowhere.
- Any other remote host still gets fully verified TLS, against the system trust store.

The CA bundle at `backend/src/db/certs/eu-central-1-bundle.pem` is Amazon's public
regional trust store (three root CAs, no private key material) and is refreshed from
`https://truststore.pki.rds.amazonaws.com/eu-central-1/eu-central-1-bundle.pem`.

### Why the URL is decomposed instead of passed through

node-postgres builds its connection parameters with

```js
config = Object.assign({}, config, parse(config.connectionString))
```

so a parsed connection string takes precedence over an explicit `ssl` object. A
`?sslmode=no-verify` in `DATABASE_URL` would therefore silently replace a verified
configuration with `{ rejectUnauthorized: false }` and drop the CA entirely. To make that
impossible, the module parses `DATABASE_URL` itself and hands the pool discrete
`host`/`port`/`user`/`password`/`database` fields — `connectionString` is never given to
the driver. SSL parameters found in the URL are reported by name and dropped;
`application_name` and `options` are forwarded.

Errors go through `sanitizeDbError`, which strips connection URLs and inline credentials
before anything is logged. Startup logs the host, port, database and TLS mode only.

Tests: `backend/tests/dbConnectionConfig.test.js` (20 tests) cover the localhost path,
verified RDS TLS, CA loading, the connection-string override defence and secret-safe
error handling.

## Migration procedure

Both the rehearsal and the cutover use the same mechanism:

```
pg_dump -Fc --no-owner --no-acl -d hr_attendance
pg_restore --no-owner --no-acl --dbname="host=… user=hr_app sslmode=verify-full sslrootcert=…"
```

Restoring as `hr_app` with `--no-owner` makes the application role the owner of every
restored object.

### Validation

`.migration-local/fingerprint.sql` produces a sorted `key|value` fingerprint of the
`public` schema — table count, per-table row counts, sequences and current values,
constraints, indexes, column definitions, extensions, view/trigger/large-object counts,
and business figures including employees, attendance, users, preferences, subscriptions,
the latest attendance date and md5 digests of the attendance, employee-code and username
sets. Source and target output is compared byte-for-byte via SHA-256.

Constraint and index expressions are normalised before comparison. A dump/restore
round-trip re-renders `col IN ('a','b')` on a `varchar` column from
`ANY ((ARRAY['a'::character varying, …])::text[])` to
`ANY (ARRAY[('a'::character varying)::text, …])`. The constraint is unchanged, so casts,
parentheses and spaces are stripped before diffing, which still exposes any real change
to columns, operators or allowed values.

## Outcome

Migrated 2026-08-24. Endpoint
`hr-attendance-production.c2omi1mf46ou.eu-central-1.rds.amazonaws.com:5432`, resolving to
the private address `172.31.39.5`.

### Timings (UTC)

| Phase | Measurement |
| --- | --- |
| Rehearsal, production online | dump complete 05:18:36, restore complete 05:18:43, fingerprint validation complete 05:18:55 |
| Cutover attempt 1 | 05:55:43.02 → 05:55:56.81, **13.8 s** — aborted at the S3 upload and auto-rolled back to localhost |
| Cutover attempt 2, authoritative | 06:04:14.78 → 06:04:48.27, **33.5 s** |
| **Total downtime** | **47.3 s** |
| Deploy restart | 06:14:31.324 → 06:14:31.330, 6 ms |

Attempt 1 failed because the checksum file was written under `umask 077` as root while
`aws s3 cp` runs as `ubuntu`, so the upload could not read it. The rollback path worked as
designed: the backend was returned to localhost automatically and no data was lost. The
cutover script now `chown`s the dump and checksum to `ubuntu` before uploading, and the
orphaned attempt-1 dump was retro-fitted with its checksum so both S3 objects verify.

The 33.5 s window covers the authoritative dump, checksum, encrypted S3 upload, RDS schema
reset, restore, full fingerprint validation and the configuration swap.

### Validation result

Source and target fingerprints are byte-identical: both 194,244 bytes,
SHA-256 `393cb5e8b97b5ebbe84806e0be62d278ef434349499c2b4f69a5c4abdfac0858`, empty diff.
That covers 113 tables, 283 per-table row counts, 321 constraints, 324 indexes, 1,496
column definitions, all sequences and current values, and the `plpgsql` extension.

Spot figures, identical on both sides: 13 employees, 1,971 attendance rows, 15 users,
latest attendance date 2026-10-14.

### Final S3 artefacts

Both under `s3://hr-lifesmile-artifacts/hr-attendance-db/`, `AES256`, checksum
independently re-verified after upload and confirmed restorable (1,056 TOC entries each):

- `hr_attendance_final_rds_cutover_2026-08-24T06-04-14Z.dump` (21,671,017 bytes) —
  authoritative cutover dump, SHA-256 `928cd009…e527`
- `hr_attendance_final_rds_cutover_2026-08-24T05-55-42Z.dump` (21,670,977 bytes) —
  attempt-1 dump, SHA-256 `72d85df2…8f39`

### Application verification

Verified through the real HTTP API with a temporary admin user that was deleted afterwards:
login and wrong-password rejection, `/api/employees`, `/api/attendance?month=&year=` (286
rows for the current month), `/api/annual-leave`, `/api/notifications`,
`/api/subscriptions`, `/api/document-expiry`, `/api/sim-cards`, `/api/projects`,
`/api/team/members`, `/api/purchase-planning/plans` and the Zoho-backed
`/api/zoho/inventory-health`, `/api/zoho/usage/today`, `/api/zoho/usage/summary`,
`/api/zoho/cache/stats`. A safe write (`PUT /api/user-preferences`) through CloudFront
persisted in RDS and did **not** appear in the EC2-local database, confirming the
application reads and writes RDS only. `pg_stat_ssl` reports the backend session as
TLS 1.3 with `hr_app` owning the database.

### Post-migration hardening

The EC2 instance role's inline policy was narrowed after setup to the application secret
only; it no longer grants access to the master secret. Migration helper files holding
credential material (`pgpass` and the bcrypt/password scratch files) were shredded on the
host, and the local dump copies were removed now that the S3 copies are verified.

## Rollback

The previous `backend/.env` is preserved on the host as a root-owned `0600` backup at
`/home/ubuntu/.hr-migration/env.localhost.bak`, verified to carry all 45 configuration
keys including `DATABASE_URL`. To roll back:

```sh
sudo install -o ubuntu -g ubuntu -m 600 \
  /home/ubuntu/.hr-migration/env.localhost.bak \
  /home/ubuntu/hr-attendance-app/backend/.env
sudo systemctl restart hr-attendance-backend
curl -sf http://127.0.0.1:5001/api/health
```

EC2-local PostgreSQL stays installed, running and untouched — 16.15, 113 tables, 112 MB,
same row counts as RDS — so a rollback needs no data movement.

Retained after the migration: EC2-local PostgreSQL and its `hr_attendance` database, the
S3 dumps under `s3://hr-lifesmile-artifacts/hr-attendance-db/`, and EBS snapshot
`snap-0507aaddc68ff7826`.

## Monitoring and cost

Five CloudWatch alarms, all scoped to `DBInstanceIdentifier=hr-attendance-production`:

| Alarm | Condition |
| --- | --- |
| `hr-attendance-production-cpu-high` | `CPUUtilization` > 80% for 3×5 min |
| `hr-attendance-production-memory-low` | `FreeableMemory` < 50 MB for 3×5 min |
| `hr-attendance-production-connections-high` | `DatabaseConnections` > 60 for 2×5 min |
| `hr-attendance-production-storage-low` | `FreeStorageSpace` < 4 GB for 1×5 min |
| `hr-attendance-production-cpucredit-low` | `CPUCreditBalance` < 30 for 2×5 min |

The first 10 CloudWatch alarms are free, so these cost nothing. Performance Insights uses
the free 7-day retention; Enhanced Monitoring is off (`MonitoringInterval=0`); no paid
dashboards were created.

### Why the memory threshold is 50 MB, not 200 MB

`FreeableMemory` on this instance settles at 77–86 MB and stays flat: a 1 GB instance runs
PostgreSQL with `shared_buffers` at 25% of RAM and lets the OS use the rest as page cache,
so RDS reports little "freeable" memory even when idle with zero connections. A 200 MB
threshold would sit permanently in `ALARM` and mask a genuine incident, so the paging
threshold is 50 MB — below the observed steady state, meaning it can only fire on real
pressure.

The ~200 MB figure from the operating brief is retained as the **upgrade-review** criterion
below, which is a different question from when to page.

### Instance sizing: measured, no upgrade needed

Measured over the first hours on RDS, against the five upgrade criteria:

| Signal | Observed | Verdict |
| --- | --- | --- |
| `FreeableMemory` | flat 77–86 MB, not declining | below 200 MB, but stable and expected for 1 GB |
| `CPUUtilization` | 5.6–8.6% steady (34% during the migration itself) | far below the 10% baseline |
| `CPUCreditBalance` | rising: 0.00 → 4.40, about +4.8/hour | accruing, not declining |
| Query latency | no elevated latency observed | fine |
| `DatabaseConnections` | 0–2 of roughly 112 available | no pressure |

Only the memory figure is below its criterion, and it is stable rather than trending down,
so `db.t4g.micro` is retained. Nothing was upgraded.

The instance launched with zero CPU credits and spent them on the dump/restore work, so
`CPUCreditBalance` starts near zero and climbs. Steady usage is ~7.2 credits/hour against
12 earned, so the balance grows toward the 288 cap and the credit alarm clears on its own
roughly five hours after cutover. A sustained *decline* in this metric is the real warning
sign; growth from a cold start is not.

Cost, from the AWS Pricing API for `eu-central-1`:

| Component | Rate | Monthly |
| --- | --- | --- |
| `db.t4g.micro` PostgreSQL Single-AZ | USD 0.019/hr × 730 | 13.87 |
| 20 GB gp3 Single-AZ SSD | USD 0.137/GB-month | 2.74 |
| Backups (112 MB database, 14 days) | within the free allowance equal to allocated storage | 0.00 |
| Performance Insights, Enhanced Monitoring, alarms | free tiers | 0.00 |
| EC2 ↔ RDS traffic | same AZ (`eu-central-1b`) | 0.00 |
| **Total** | | **≈ USD 16.61** |

That is below the USD 25/month gate. gp3's included 3,000 IOPS and 125 MB/s baseline is
used; no IOPS or throughput was purchased.

Consider `db.t4g.small` only on evidence of sustained pressure: `FreeableMemory`
persistently below ~200 MB, sustained high CPU, a declining `CPUCreditBalance`, elevated
query latency, or connection saturation. Do not upgrade pre-emptively.

## Note on file types

The backend is CommonJS JavaScript executed directly by Node (`node src/server.js`) with
no TypeScript toolchain or build step, so the repository's TypeScript-only rule cannot
apply here: a `.ts` module in `backend/src/db` would not load at runtime. Converting the
backend to TypeScript is a separate piece of work and was deliberately not attempted
during a production database migration.
