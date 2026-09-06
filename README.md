# UniLib Backend

Backend-only REST API for university library circulation, reservations, fines,
catalog administration and reporting.

## Local setup

Requirements: Node.js 24+, PostgreSQL, and npm.

```text
1. npm ci
2. Copy .env.example to .env and set DATABASE_URL and JWT_SECRET
3. npm exec prisma migrate deploy
4. npm run db:seed
5. npm start
```

`npm ci` generates the Prisma client through `postinstall`. The seed is
repeatable. Optional Librarian and Admin accounts are created only when
`SEED_LIBRARIAN_PASSWORD` and `SEED_ADMIN_PASSWORD` are present in `.env`.

Development mode (API and Prisma Studio):

```text
npm run dev
```

Backend documentation:

- API contract: `docs/openapi.yaml`
- Request examples: `docs/api-test-payloads.md`
- Role, authentication, idempotency and transaction design:
  `docs/backend-architecture.md`
- ER diagram: `docs/er-diagram.md`

All mutation authorization is enforced by the backend. This repository does not
contain or rely on frontend authorization logic.
