import { readFileSync } from 'node:fs';

for (const file of ['.env.core', '.env.sbha.node.b', '.env.pooler']) {
  try {
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      const match = line.match(/^([A-Z_0-9]+)=(.*)$/);
      process.env[match[1]] = match[2];
    }
  } catch {
    void 0;
  }
}

if (!process.env.SUPABASE_DB_URL) {
  console.error('SUPABASE_DB_URL not found in .env.* files');
  process.exit(2);
}

const url = new URL(process.env.SUPABASE_DB_URL);
const ref = process.env.SUPABASE_PROJECT_ID || url.hostname.split('.')[0].replace('db.', '');
const baseUser = process.env.SUPABASE_DB_USER || 'postgres';
const user = baseUser.startsWith('postgres.') ? baseUser : `postgres.${ref}`;
process.stdout.write(
  `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(url.password)}@aws-0-${process.env.SUPABASE_PROJECT_REGION}.pooler.supabase.com:5432/${process.env.SUPABASE_DB_NAME}`
);
