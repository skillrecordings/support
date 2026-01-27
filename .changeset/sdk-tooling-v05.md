---
"@skillrecordings/sdk": minor
---

Add optional SDK methods for agent intelligence:
- getActivePromotions / getCouponInfo — promotion and coupon lookup
- getRefundPolicy — dynamic per-app refund policy
- getContentAccess — granular content access checking
- getRecentActivity — user activity and progress tracking
- getLicenseInfo — team license and seat management
- getAppInfo — app metadata (URLs, instructor, support email)

All methods are optional — existing integrations are unaffected.

New Zod schemas: PromotionSchema, CouponInfoSchema, RefundPolicySchema,
ContentAccessSchema, UserActivitySchema, LicenseInfoSchema, AppInfoSchema.

Client handles 501 (Not Implemented) gracefully for optional methods,
returning null or empty arrays instead of throwing.
