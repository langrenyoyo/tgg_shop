# Deployment Notes

## Environment

- `NODE_ENV=production`
- `PORT`
- `TGG_STORE_DRIVER=pg`
- `TGG_PG_URL`
- `TGG_PG_SCHEMA`
- `TGG_PG_STATE_ID`
- `TGG_AUTH_SECRET`
- `TGG_AUTH_TOKEN_TTL_SECONDS`

## Run

```bash
npm start
```

## Health

- `GET /api/health`
- Returns driver and readiness state.

## Notes

- The backend serves `/admin` and `/user` statically.
- PG is the production store driver.
- SQLite and JSON remain available for dev and smoke tests.
- Production startup validates `TGG_AUTH_SECRET`, `PORT`, and PostgreSQL settings.
