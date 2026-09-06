# UniLib API test payloads

Base URL:

```text
http://localhost:8000
```

Run the requests in the order below. Store the token returned by register/login as
`token`, and the ID returned by borrow as `loanId`.

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
{}
```

## 7. Logout

`POST /auth/logout`

```json
{}
```

When testing cookie authentication, keep the `jwt` cookie from login so logout can
clear it.
