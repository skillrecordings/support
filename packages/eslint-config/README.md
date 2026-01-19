# packages/eslint-config

Shared ESLint configurations for the monorepo.

## Configs

- `base` - TypeScript + Biome interop
- `next` - Next.js apps
- `react` - React libraries

## Usage

```javascript
// eslint.config.js
import { base } from '@skillrecordings/eslint-config'

export default [...base]
```
