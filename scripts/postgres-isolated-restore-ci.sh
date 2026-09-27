#!/usr/bin/env bash
set -euo pipefail

# Isolated CI drill only: never point PGDATABASE at production.
: "${PGDATABASE:?PGDATABASE must be set to an isolated test database}"
if [[ "$PGDATABASE" != "zaffiliate_test" ]]; then
  echo 'Refusing to run outside the dedicated zaffiliate_test CI database.' >&2
  exit 2
fi

restore_db="zaffiliate_restore_ci_${GITHUB_RUN_ID:-local}"
restore_db="${restore_db//[^a-zA-Z0-9_]/_}"
workspace="$(mktemp -d)"
cleanup() {
  dropdb --if-exists "$restore_db" >/dev/null 2>&1 || true
  rm -rf "$workspace"
}
trap cleanup EXIT

sample_tenant='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
psql -v ON_ERROR_STOP=1 <<SQL
INSERT INTO tenants (id, slug, name)
VALUES ('$sample_tenant', 'isolated-dr-ci', 'Isolated Restore CI')
ON CONFLICT (id) DO NOTHING;
INSERT INTO tenant_memberships (tenant_id, user_id, role)
VALUES ('$sample_tenant', 'dr-ci-operator', 'owner')
ON CONFLICT (tenant_id, user_id) DO NOTHING;
INSERT INTO products (tenant_id, platform, external_product_id, title, currency)
VALUES ('$sample_tenant', 'test', 'dr-ci-product', 'Isolated restore product', 'THB')
ON CONFLICT (tenant_id, platform, external_product_id) DO NOTHING;
SQL

start_ms="$(date +%s%3N)"
pg_dump --format=custom --no-owner --no-privileges --file "$workspace/backup.dump" "$PGDATABASE"
test -s "$workspace/backup.dump"
backup_sha="$(sha256sum "$workspace/backup.dump" | cut -d' ' -f1)"

createdb "$restore_db"
restore_start_ms="$(date +%s%3N)"
pg_restore --exit-on-error --no-owner --no-privileges --dbname "$restore_db" "$workspace/backup.dump"
restore_ms="$(( $(date +%s%3N) - restore_start_ms ))"

source_count="$(psql --dbname "$PGDATABASE" -Atqc "SELECT count(*) FROM products WHERE tenant_id='$sample_tenant' AND external_product_id='dr-ci-product'")"
restored_count="$(psql --dbname "$restore_db" -Atqc "SELECT count(*) FROM products WHERE tenant_id='$sample_tenant' AND external_product_id='dr-ci-product'")"
test "$source_count" = '1'
test "$restored_count" = "$source_count"
source_members="$(psql --dbname "$PGDATABASE" -Atqc "SELECT count(*) FROM tenant_memberships WHERE tenant_id='$sample_tenant' AND user_id='dr-ci-operator'")"
restored_members="$(psql --dbname "$restore_db" -Atqc "SELECT count(*) FROM tenant_memberships WHERE tenant_id='$sample_tenant' AND user_id='dr-ci-operator'")"
test "$source_members" = '1'
test "$restored_members" = "$source_members"

# Preserve the source RLS settings and the exact number of policies.
for relation in tenants tenant_memberships products offers affiliate_links; do
  source_rls="$(psql --dbname "$PGDATABASE" -Atqc "SELECT relrowsecurity::text || ':' || relforcerowsecurity::text FROM pg_class WHERE relname='$relation'")"
  restore_rls="$(psql --dbname "$restore_db" -Atqc "SELECT relrowsecurity::text || ':' || relforcerowsecurity::text FROM pg_class WHERE relname='$relation'")"
  test -n "$source_rls"
  test "$source_rls" = "$restore_rls"
done
source_policies="$(psql --dbname "$PGDATABASE" -Atqc "SELECT count(*) FROM pg_policies WHERE schemaname='public'")"
restore_policies="$(psql --dbname "$restore_db" -Atqc "SELECT count(*) FROM pg_policies WHERE schemaname='public'")"
test "$source_policies" = "$restore_policies"

mkdir -p dist
elapsed_ms="$(( $(date +%s%3N) - start_ms ))"
cat > dist/postgres-isolated-restore-evidence.json <<JSON
{
  "kind": "ci_isolated_postgres_restore",
  "source_database": "zaffiliate_test",
  "restored_database": "$restore_db",
  "backup_sha256": "$backup_sha",
  "restore_duration_ms": $restore_ms,
  "drill_duration_ms": $elapsed_ms,
  "verified_product_rows": $restored_count,
  "verified_membership_rows": $restored_members,
  "verified_rls_policies": $restore_policies,
  "result": "PASS",
  "scope": "ephemeral CI only; not production RPO/RTO evidence"
}
JSON
echo 'Isolated PostgreSQL backup and restore passed; CI evidence written.'
