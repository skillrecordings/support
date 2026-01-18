# Do / Don’t

- Do keep workflows in Inngest
- Do keep Front as conversation source of truth
- Do use `getDb()` in workflow steps, not `database` singleton
- Don't add alternative workflow engines
- Don't bypass approval gates for risky actions
- Don't import `drizzle-orm` directly in packages that consume `@skillrecordings/database`
