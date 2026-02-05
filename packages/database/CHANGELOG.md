# @skillrecordings/database

## 0.0.2

### Patch Changes

- Fix DATABASE_URL validation crash on CLI global install
  - Skip env validation when DATABASE_URL is not set (lazy validation)
  - Make DATABASE_URL optional in zod schema (validated at getDb() call instead)
  - getDb() throws clear error message when DATABASE_URL is missing
  - Fixes `skill -V` and `skill --help` crashing on global npm/bun install

## 0.0.1

### Patch Changes

- 435f929: Strip `sslaccept` query param from DATABASE_URL before passing to mysql2

  PlanetScale URLs include `?sslaccept=strict` which mysql2 doesn't recognize,
  causing a noisy warning on every connection. SSL is already configured via
  the `ssl: { rejectUnauthorized: true }` option. Also include `.env.encrypted`
  in published CLI package for global install secret loading.
