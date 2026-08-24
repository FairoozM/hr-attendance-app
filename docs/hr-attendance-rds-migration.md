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

## Rollback

The previous `backend/.env` is preserved on the host as a root-owned `0600` backup. To
roll back: restore that file, `systemctl restart hr-attendance-backend.service`, confirm
`/api/health`. EC2-local PostgreSQL stays installed, running and untouched, so a rollback
needs no data movement.

Retained after the migration: EC2-local PostgreSQL and its `hr_attendance` database, the
S3 dumps under `s3://hr-lifesmile-artifacts/hr-attendance-db/`, and EBS snapshot
`snap-0507aaddc68ff7826`.

## Monitoring and cost

CloudWatch alarms on `CPUUtilization`, `FreeableMemory`, `DatabaseConnections`,
`FreeStorageSpace` and `CPUCreditBalance`. Performance Insights uses the free 7-day
retention; Enhanced Monitoring is off; no paid dashboards were created.

Expected cost is roughly USD 18–25/month (db.t4g.micro, Single-AZ, 20 GB gp3, Frankfurt).

Consider `db.t4g.small` only on evidence of sustained pressure: `FreeableMemory`
persistently below ~200 MB, sustained high CPU, a declining `CPUCreditBalance`, elevated
query latency, or connection saturation. Do not upgrade pre-emptively.

## Note on file types

The backend is CommonJS JavaScript executed directly by Node (`node src/server.js`) with
no TypeScript toolchain or build step, so the repository's TypeScript-only rule cannot
apply here: a `.ts` module in `backend/src/db` would not load at runtime. Converting the
backend to TypeScript is a separate piece of work and was deliberately not attempted
during a production database migration.
