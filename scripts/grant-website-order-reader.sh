#!/usr/bin/env bash
# Additive grant: let the existing read-only website role read order headers and order lines.
#
# Why: the Daily Ecommerce Report reads Life Smile website / app / shop orders server-to-server
# from the website database as `amazon_catalog_reader`. That role was provisioned with catalog
# tables only, so `SELECT ... FROM orders` failed with SQLSTATE 42501 (permission denied) and the
# report showed "Data Error". This grants exactly the two tables the report query needs.
#
# What it will NOT do: create or alter roles, touch website data, change passwords, grant write
# privileges, revoke anything, or grant access to customer tables (customers, customer_addresses,
# customer_logins, login_credentials, tokens, users stay unreachable).
#
# Run it on a host that can reach the website RDS instance, with master or table-owner credentials:
#   PGHOST=... PGUSER=... PGPASSWORD=... bash scripts/grant-website-order-reader.sh
set -euo pipefail

DB_NAME="${DB_NAME:-lifesmiledbnew}"
ROLE_NAME="${ROLE_NAME:-amazon_catalog_reader}"

# Exactly the tables `dailyEcommerceReport/providers/lifeSmileProvider.js` reads.
ORDER_TABLES=(
  "public.orders"
  "public.cart_items"
)

# Must stay unreachable for this role. Verified after the grant.
FORBIDDEN_TABLES=(
  "public.customers"
  "public.customer_addresses"
  "public.customer_logins"
  "public.login_credentials"
  "public.tokens"
  "public.users"
)

: "${PGHOST:?set PGHOST to the lifesmiledbnew endpoint}"
: "${PGUSER:?set PGUSER to a master or table-owner user on that instance}"
: "${PGPASSWORD:?set PGPASSWORD for that user}"
export PGHOST PGUSER PGPASSWORD
export PGPORT="${PGPORT:-5432}"
export PGDATABASE="$DB_NAME"
export PGSSLMODE="${PGSSLMODE:-require}"

if [ "$PGDATABASE" != "lifesmiledbnew" ]; then
  echo "refusing to run against '${PGDATABASE}': this script is only for the website database" >&2
  exit 1
fi

echo "==> Target: ${PGUSER}@${PGHOST}/${PGDATABASE}"

if ! psql -tAq -c "SELECT 1 FROM pg_roles WHERE rolname = '${ROLE_NAME}'" | grep -q 1; then
  echo "role ${ROLE_NAME} does not exist; run scripts/provision-amazon-catalog-reader.sh first" >&2
  exit 1
fi

GRANT_SQL=""
for table in "${ORDER_TABLES[@]}"; do
  GRANT_SQL="${GRANT_SQL}GRANT SELECT ON TABLE ${table} TO ${ROLE_NAME};"$'\n'
done

psql -v ON_ERROR_STOP=1 -q <<SQL
${GRANT_SQL}
SQL
echo "    granted SELECT on ${#ORDER_TABLES[@]} order tables"

echo "==> Verifying grants"
for table in "${ORDER_TABLES[@]}"; do
  schema="${table%%.*}"
  name="${table##*.}"
  ok=$(psql -tAq -c "SELECT has_table_privilege('${ROLE_NAME}', '${schema}.${name}', 'SELECT')")
  if [ "$ok" != "t" ]; then
    echo "    FAIL: ${table} is still not readable by ${ROLE_NAME}" >&2
    exit 1
  fi
  writable=$(psql -tAq -c "SELECT has_table_privilege('${ROLE_NAME}', '${schema}.${name}', 'INSERT') OR has_table_privilege('${ROLE_NAME}', '${schema}.${name}', 'UPDATE') OR has_table_privilege('${ROLE_NAME}', '${schema}.${name}', 'DELETE')")
  if [ "$writable" != "f" ]; then
    echo "    FAIL: ${table} is writable by ${ROLE_NAME}" >&2
    exit 1
  fi
  echo "    ok: ${table} SELECT only"
done

for table in "${FORBIDDEN_TABLES[@]}"; do
  schema="${table%%.*}"
  name="${table##*.}"
  exists=$(psql -tAq -c "SELECT to_regclass('${schema}.${name}') IS NOT NULL")
  [ "$exists" = "t" ] || continue
  readable=$(psql -tAq -c "SELECT has_table_privilege('${ROLE_NAME}', '${schema}.${name}', 'SELECT')")
  if [ "$readable" != "f" ]; then
    echo "    FAIL: ${table} became readable by ${ROLE_NAME}" >&2
    exit 1
  fi
  echo "    ok: ${table} still unreachable"
done

echo "==> Done. ${ROLE_NAME} can now read order headers and order lines, nothing else changed."
