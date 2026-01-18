# TypeScript conventions

- Prefer `type` aliases unless an interface is required for declaration merging
- Use `satisfies` for object shape validation without widening
- Keep types close to usage; avoid global types unless shared across packages
- Favor explicit return types for exported functions

## Imports and module shape

- No `.js` extensions in TS/TSX imports
- Use package exports; no barrel files

## Typecheck policy

Types always pass. Do not blame pre-existing errors. Fix or revert.
