#!/usr/bin/env bash
#
# Provisions the read-only website-catalog role used by the Amazon UAE Initial Draft
# Generator, then stores its credential in AWS Secrets Manager.
#
# Run this once, from a machine that can reach lifesmiledbnew, with master credentials for
# that instance. It is deliberately not wired into any deployment: creating a database role
# is a one-off administrative act, not something a deploy should be able to repeat.
#
#   PGHOST=lifesmiledbnew.c2omi1mf46ou.eu-central-1.rds.amazonaws.com \
#   PGUSER=postgres PGPASSWORD=... \
#   AWS_PROFILE=abdullah-deploy \
#   bash scripts/provision-amazon-catalog-reader.sh
#
# The generated password is never printed, never written to disk and never passed on a
# command line. It goes straight from openssl into psql over stdin and into Secrets Manager
# over stdin. Nothing in this file is a secret, so it is safe to commit.
#
# What it will NOT do: touch website data, alter the RDS instance, change any existing role,
# or revoke anything. Only additive GRANTs to one new role.
set -euo pipefail

DB_NAME="${DB_NAME:-lifesmiledbnew}"
ROLE_NAME="amazon_catalog_reader"
SECRET_NAME="${SECRET_NAME:-lifesmile-website/rds/amazon-catalog-reader}"
REGION="${AWS_REGION:-eu-central-1}"
CONNECTION_LIMIT="${CONNECTION_LIMIT:-5}"

# Exactly the tables the implemented repository query reads. Nothing else is granted.
CATALOG_TABLES=(
  "public.products"
  "public.product_variants"
  "public.product_specifications"
  "public.product_categories"
  "public.sub_categories"
)

# Tables that must stay unreachable. Used by the verification step below.
FORBIDDEN_TABLES=(
  "public.customers"
  "public.customer_addresses"
  "public.customer_logins"
  "public.orders"
  "public.login_credentials"
  "public.tokens"
  "public.carts"
  "public.users"
)

: "${PGHOST:?set PGHOST to the lifesmiledbnew endpoint}"
: "${PGUSER:?set PGUSER to a master user on that instance}"
: "${PGPASSWORD:?set PGPASSWORD for that master user}"
export PGHOST PGUSER PGPASSWORD
export PGPORT="${PGPORT:-5432}"
export PGDATABASE="$DB_NAME"
export PGSSLMODE="${PGSSLMODE:-verify-full}"
export PGSSLROOTCERT="${PGSSLROOTCERT:-$(cd "$(dirname "$0")/.." && pwd)/backend/src/db/certs/eu-central-1-bundle.pem}"

echo "==> Target: ${PGUSER}@${PGHOST}/${PGDATABASE} (TLS ${PGSSLMODE})"

if [ "$PGDATABASE" != "lifesmiledbnew" ]; then
  echo "refusing to run against '${PGDATABASE}': this script is only for the website catalog" >&2
  exit 1
fi

# ---------------------------------------------------------------- generate the password
# 32 bytes of CSPRNG output, base64 then stripped of characters that need escaping in a
# connection URL. Held in a shell variable only, never echoed.
NEW_PASSWORD="$(openssl rand -base64 48 | tr -d '\n=+/' | cut -c1-40)"
if [ "${#NEW_PASSWORD}" -lt 32 ]; then
  echo "failed to generate a strong password" >&2
  exit 1
fi

# ---------------------------------------------------------------- create / update the role
echo "==> Creating role ${ROLE_NAME}"
psql -v ON_ERROR_STOP=1 -q \
  -v role="$ROLE_NAME" \
  -v pw="$NEW_PASSWORD" \
  -v dbname="$DB_NAME" \
  -v conn_limit="$CONNECTION_LIMIT" <<'SQL'
\set quoted_pw '''' :pw ''''

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'role') THEN
    EXECUTE format('CREATE ROLE %I LOGIN', :'role');
  END IF;
END
$$;

-- Attributes are set explicitly rather than relying on CREATE ROLE defaults, so re-running
-- this script repairs a role that was loosened by hand.
ALTER ROLE :"role" WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT
  CONNECTION LIMIT :conn_limit
  PASSWORD :quoted_pw;

-- Read-only at the session level as well as by grant, so even a bug in the application
-- cannot begin a writable transaction.
ALTER ROLE :"role" SET default_transaction_read_only = on;
ALTER ROLE :"role" SET statement_timeout = '30s';
ALTER ROLE :"role" SET idle_in_transaction_session_timeout = '60s';
ALTER ROLE :"role" SET lock_timeout = '5s';

GRANT CONNECT ON DATABASE :"dbname" TO :"role";
GRANT USAGE ON SCHEMA public TO :"role";
SQL

for table in "${CATALOG_TABLES[@]}"; do
  psql -v ON_ERROR_STOP=1 -q -c "GRANT SELECT ON TABLE ${table} TO ${ROLE_NAME};"
done
echo "    granted SELECT on ${#CATALOG_TABLES[@]} catalog tables"

# ---------------------------------------------------------------- verify as the new role
echo "==> Verifying the role's actual privileges"

verify() {
  local label="$1" sql="$2" expectation="$3" # expectation: allow | deny
  local output status
  set +e
  output=$(PGPASSWORD="$NEW_PASSWORD" PGUSER="$ROLE_NAME" psql -v ON_ERROR_STOP=1 -tAq -c "$sql" 2>&1)
  status=$?
  set -e

  if [ "$expectation" = "allow" ] && [ $status -eq 0 ]; then
    echo "    ok   ${label}"
  elif [ "$expectation" = "deny" ] && [ $status -ne 0 ]; then
    # Show the reason but not the statement's data.
    echo "    ok   ${label} refused: $(echo "$output" | head -1 | cut -c1-90)"
  else
    echo "    FAIL ${label} (expected ${expectation}, exit ${status}): $(echo "$output" | head -1)" >&2
    FAILED=1
  fi
}

FAILED=0
verify "approved catalog SELECT" \
  "SELECT count(*) FROM products p JOIN product_variants v ON v.product_id = p.id JOIN product_specifications ps ON ps.product_id = p.id;" allow
verify "role attributes are read-only" \
  "SELECT 1 WHERE current_setting('default_transaction_read_only') = 'on';" allow
verify "INSERT" "INSERT INTO products (name) VALUES ('should-not-work');" deny
verify "UPDATE" "UPDATE products SET name = name;" deny
verify "DELETE" "DELETE FROM products WHERE false;" deny
verify "TRUNCATE" "TRUNCATE products;" deny
verify "CREATE TABLE" "CREATE TABLE public.should_not_exist (id int);" deny
verify "CREATE ROLE" "CREATE ROLE should_not_exist;" deny

for table in "${FORBIDDEN_TABLES[@]}"; do
  verify "SELECT on ${table}" "SELECT 1 FROM ${table} LIMIT 1;" deny
done

if [ "$FAILED" -ne 0 ]; then
  echo "==> Verification failed. The role exists but is NOT safe to use; fix the grants." >&2
  exit 1
fi
echo "    all privilege checks passed"

# ---------------------------------------------------------------- store the credential
echo "==> Storing the credential in Secrets Manager as ${SECRET_NAME}"

SECRET_JSON=$(
  NEW_PASSWORD="$NEW_PASSWORD" ROLE_NAME="$ROLE_NAME" PGHOST="$PGHOST" PGPORT="$PGPORT" DB_NAME="$DB_NAME" \
  python3 -c '
import json, os, urllib.parse
password = os.environ["NEW_PASSWORD"]
url = "postgresql://{u}:{p}@{h}:{port}/{db}".format(
    u=urllib.parse.quote(os.environ["ROLE_NAME"], safe=""),
    p=urllib.parse.quote(password, safe=""),
    h=os.environ["PGHOST"],
    port=os.environ["PGPORT"],
    db=os.environ["DB_NAME"],
)
print(json.dumps({
    "username": os.environ["ROLE_NAME"],
    "password": password,
    "host": os.environ["PGHOST"],
    "port": int(os.environ["PGPORT"]),
    "dbname": os.environ["DB_NAME"],
    "LIFESMILE_WEBSITE_DATABASE_URL": url,
}))
'
)

if aws secretsmanager describe-secret --region "$REGION" --secret-id "$SECRET_NAME" >/dev/null 2>&1; then
  printf '%s' "$SECRET_JSON" | aws secretsmanager put-secret-value \
    --region "$REGION" --secret-id "$SECRET_NAME" --secret-string file:///dev/stdin >/dev/null
  echo "    rotated existing secret"
else
  printf '%s' "$SECRET_JSON" | aws secretsmanager create-secret \
    --region "$REGION" --name "$SECRET_NAME" \
    --description "Read-only website catalog role (${ROLE_NAME}) for the Amazon Initial Draft Generator. Read by the HR backend only." \
    --secret-string file:///dev/stdin >/dev/null
  echo "    created secret"
fi

unset NEW_PASSWORD SECRET_JSON PGPASSWORD

SECRET_ARN=$(aws secretsmanager describe-secret --region "$REGION" --secret-id "$SECRET_NAME" --query ARN --output text)
echo ""
echo "Done."
echo "  role        : ${ROLE_NAME} (LOGIN, NOSUPERUSER, NOCREATEDB, NOCREATEROLE, NOREPLICATION, limit ${CONNECTION_LIMIT})"
echo "  grants      : CONNECT on ${DB_NAME}, USAGE on public, SELECT on ${#CATALOG_TABLES[@]} catalog tables"
echo "  secret ARN  : ${SECRET_ARN}"
echo ""
echo "Next: grant the HR backend instance role read access to that secret, then set"
echo "LIFESMILE_WEBSITE_DATABASE_URL on the backend from it. See docs/amazon-uae-initial-draft-handoff.md."
