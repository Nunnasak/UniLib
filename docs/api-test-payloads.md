# UniLib API test payloads

Base URL:

```text
http://localhost:8000
```

The sections below are request examples; destructive alternatives such as return
and confirm-lost should not be called for the same loan. Use the dedicated queue
sequence at the end when testing reservation allocation. Suggested
Postman/environment variables:

```text
token             Borrower's JWT
librarianToken    Librarian JWT
adminToken        Administrator JWT
borrowerId        Borrower's user ID
loanId            Loan ID returned by borrow
reservationId     Reservation ID returned by create reservation
```

## 1. Register

`POST /auth/register`

```json
{
  "universityId": "65000001",
  "fullName": "Example Student",
  "email": "student@example.com",
  "password": "password123",
  "role": "STUDENT"
}
```

Allowed public roles are `STUDENT` and `LECTURER`.

## 2. Login

`POST /auth/login`

```json
{
  "universityId": "65000001",
  "password": "password123"
}
```

## Authentication for protected routes

Use the token returned by register or login:

```text
Authorization: Bearer {{token}}
Content-Type: application/json
```

The JWT cookie returned by the API can be used instead when the client maintains
cookies automatically.

## 3. Borrow a seeded copy

`POST /books/00000000-0000-4000-8000-000000000101/borrow`

```json
{
  "copyId": "00000000-0000-4000-8000-000000001001"
}
```

Save `data.id` from the response as `loanId`.

## 4. Get a loan

`GET /loans/{{loanId}}`

GET requests have no JSON body.

## 5. Renew a loan

`POST /loans/{{loanId}}/renew`

```json
{}
```

## 6. Return a loan

`POST /loans/{{loanId}}/return`

```json
{
  "returnCondition": "NORMAL"
}
```

This endpoint requires `Authorization: Bearer {{librarianToken}}`. Valid return
conditions are:

```text
NORMAL
MINOR_DAMAGE
MAJOR_DAMAGE
UNUSABLE
```

For compatibility, the API also accepts `condition` instead of
`returnCondition`.

## 7. Create a reservation

`POST /books/00000000-0000-4000-8000-000000000101/reservations`

```json
{}
```

The book must have no `AVAILABLE` copies. Save `data.id` as `reservationId`.
Use a different borrower from the users currently borrowing the book when
testing the queue.

## 8. List my reservations

`GET /reservations`

GET requests have no JSON body. Reservations are returned in FIFO order using
`createdAt`, then `id` as the deterministic tie-breaker.

## 9. Cancel a reservation

`POST /reservations/{{reservationId}}/cancel`

```json
{}
```

If the reservation currently holds a copy, the API allocates that copy to the
next queued reservation or makes it `AVAILABLE` when the queue is empty.

## 10. Confirm a lost copy

`POST /loans/{{loanId}}/confirm-lost`

```json
{}
```

This endpoint requires `Authorization: Bearer {{librarianToken}}`. The response
contains replacement, processing, late-fine, and total charge amounts.
Use an active loan that has not already been returned.

## 11. View a financial account and ledger

`GET /financial-accounts/{{borrowerId}}`

GET requests have no JSON body. A borrower may view their own account. A
librarian or administrator may view another borrower's account. Each transaction
contains separate ledger entries such as `LATE_FINE`, `DAMAGE_CHARGE`,
`LOST_REPLACEMENT`, and `PROCESSING_FEE`.

## 12. List payment history

`GET /financial-accounts/{{borrowerId}}/payments?page=1&limit=20`

GET requests have no JSON body. This is the endpoint to use when retrieving
payments; `GET` must not be sent to the payment-creation endpoint unless this
listing route is intended.

## 13. Record a payment

`POST /financial-accounts/{{borrowerId}}/payments`

```json
{
  "amount": 500,
  "externalReference": "PAY-2026-0001",
  "reason": "Cash payment at circulation desk"
}
```

This endpoint requires `Authorization: Bearer {{librarianToken}}`. The amount
cannot exceed the current outstanding balance.

## 14. Record a waiver

`POST /financial-accounts/{{borrowerId}}/waivers`

```json
{
  "amount": 100,
  "reason": "Approved damaged-book charge waiver"
}
```

This endpoint requires `Authorization: Bearer {{adminToken}}`. Librarians cannot
approve waivers. `reason` is required, and the amount cannot make the balance
negative. The API records the approving admin and timestamp in the immutable
financial transaction and audit log.

## 15. Record a debit adjustment

`POST /financial-accounts/{{borrowerId}}/adjustments`

```json
{
  "amount": 75.5,
  "direction": "DEBIT",
  "reason": "Manual charge correction"
}
```

Only an administrator may call this endpoint.

## 16. Record a credit adjustment

`POST /financial-accounts/{{borrowerId}}/adjustments`

```json
{
  "amount": 25.5,
  "direction": "CREDIT",
  "reason": "Approved ledger correction"
}
```

A credit adjustment cannot make the outstanding balance negative.

## 17. Search books

`GET /books/search?isbn=978013&title=clean&author=martin&category=software&availability=AVAILABLE&page=1&limit=20&sortBy=title&sortOrder=asc`

GET requests have no JSON body. Every search field is optional and supplied as a
query parameter:

```text
isbn          Partial or complete ISBN
title         Partial title, case-insensitive
author        Partial author name, case-insensitive
category      Partial category name, case-insensitive
availability AVAILABLE, UNAVAILABLE, or ALL
page          Positive integer; default 1
limit         1-100; default 20 and capped at 100
sortBy        title, isbn13, publicationYear, or createdAt
sortOrder     asc or desc
```

Examples:

```text
GET /books/search?isbn=9780134494166
GET /books/search?title=architecture&page=1&limit=10
GET /books/search?author=martin&sortBy=publicationYear&sortOrder=desc
GET /books/search?category=databases&availability=AVAILABLE
```

## 18. Logout

`POST /auth/logout`

```json
{}
```

When testing cookie authentication, keep the `jwt` cookie from login so logout can
clear it.

## Useful seeded book and copy IDs

```text
Clean Architecture
bookId: 00000000-0000-4000-8000-000000000101
copyId: 00000000-0000-4000-8000-000000001001
copyId: 00000000-0000-4000-8000-000000001002

Designing Data-Intensive Applications
bookId: 00000000-0000-4000-8000-000000000102
copyId: 00000000-0000-4000-8000-000000001003
copyId: 00000000-0000-4000-8000-000000001004

Domain-Driven Design
bookId: 00000000-0000-4000-8000-000000000103
copyId: 00000000-0000-4000-8000-000000001005
copyId: 00000000-0000-4000-8000-000000001006
```

## Queue allocation test sequence

1. Borrow both copies of one seeded book using two different borrower accounts.
2. Create reservations for the same `bookId` using two more borrower accounts.
3. Return one copy as `NORMAL` using `librarianToken`.
4. Call `GET /reservations` with the first reserving user's token. Its status
   should be `HELD`, with `allocatedAt` and `holdExpiresAt` populated.
5. Cancel that held reservation. The same copy should be allocated to the second
   queued user.
