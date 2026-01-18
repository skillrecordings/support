# Conventions

## Repo structure
- `apps/*`: deployable surfaces
- `packages/*`: shared libraries and core logic
- `docs/*`: product + engineering docs

## Naming
- Packages use `@skillrecordings/*`
- Env vars use `UPPER_SNAKE_CASE` with service prefixes

## Testing
- TDD required: red → green → refactor
- Prefer targeted tests over repo-wide
- Add tests alongside the change that requires them

## Tooling
- Prefer official CLIs for config/scaffolding
- Avoid manual boilerplate unless CLI fails

## Do / Don’t
- Do keep workflows in Inngest
- Do keep Front as conversation source of truth
- Don’t add alternative workflow engines
- Don’t bypass approval gates for risky actions
