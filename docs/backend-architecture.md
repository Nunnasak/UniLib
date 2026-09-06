# UniLib backend architecture

## Role model

UniLib intentionally uses one role per account. Permissions are not inherited:

- `STUDENT` and `LECTURER`: self-service search, own loans, own reservations,
  own fines and payment history.
- `LIBRARIAN`: catalog and physical-copy management, borrower lookup,
  circulation, reservation queues, payments, overdue and inventory reports.
- `ADMIN`: user/role/status governance, fine waivers, audit logs and aggregate
  system reports. Admin does not automatically receive librarian circulation
  permissions.

Every protected route reloads the user from the database. A disabled account is
therefore rejected even when it still holds an unexpired access token.

## Authentication

Passwords are stored as bcrypt hashes. Access JWTs default to 15 minutes and are
verified server-side. Opaque 256-bit refresh tokens are stored only as SHA-256
hashes in `auth_sessions`, expire after 30 days and rotate on every refresh.
Logout revokes the matching session. Staff seed passwords are accepted only
through environment variables and are never embedded in source code.

## Transactions and concurrency

Borrow, renewal, return, lost confirmation, reservation allocation and financial
credits use database transactions. Circulation transactions use serializable
isolation plus conditional status updates, so two application instances cannot
successfully claim the same available copy.

## Idempotency

Critical mutation routes require an `Idempotency-Key` header. The key is scoped
to actor and operation. A SHA-256 request fingerprint prevents reuse with a
different payload. Completed responses are replayed for 24 hours; an in-progress
duplicate receives `409 REQUEST_IN_PROGRESS`.

## Audit and history retention

Critical actions write immutable append-only `audit_logs` records in the same
transaction as the domain change. No normal API exposes update or delete methods
for audit logs, loans, reservations, financial transactions or financial
entries. Foreign keys use restrictive deletion for transaction history, so a
user with referenced history cannot be hard-deleted without violating database
referential integrity.

## Error contract

All error responses are normalized to:

```json
{
  "error": {
    "code": "MACHINE_READABLE_CODE",
    "message": "Human-readable explanation"
  }
}
```

Validation uses `400`, authentication `401`, authorization `403`, missing
resources `404`, and state/idempotency conflicts `409`.
