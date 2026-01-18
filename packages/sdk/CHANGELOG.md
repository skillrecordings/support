# @skillrecordings/sdk

## 0.2.1

### Patch Changes

- c4c0fc0: Fix SDK build: compile TypeScript to JavaScript for npm consumers
  - Add tsup build step with ESM output
  - Update exports to point to compiled dist/
  - Add files field to include only dist/

## 0.2.0

### Minor Changes

- 91c7136: Initial public release of the Skill Recordings Support SDK.

  Provides the integration contract for apps to connect to the support platform:
  - `IntegrationClient` for querying user data and purchases
  - Webhook handler utilities for SDK-to-platform communication
  - Type definitions for the integration interface
