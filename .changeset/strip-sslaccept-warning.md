---
"@skillrecordings/database": patch
"@skillrecordings/cli": patch
---

Strip `sslaccept` query param from DATABASE_URL before passing to mysql2

PlanetScale URLs include `?sslaccept=strict` which mysql2 doesn't recognize,
causing a noisy warning on every connection. SSL is already configured via
the `ssl: { rejectUnauthorized: true }` option. Also include `.env.encrypted`
in published CLI package for global install secret loading.
