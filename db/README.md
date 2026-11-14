# Database

`PgRepo` (src/core/repo-pg.ts) is a generic table store: it issues parameterized
queries against tables that feature modules create rows in. `schema.sql` is generated
from the tables actually referenced by the feature modules (`npm run schema`).

Every table carries: `id text primary key`, `"createdAt" timestamptz`, `"updatedAt" timestamptz`.
Domain columns are added per feature from the field names used on insert.
