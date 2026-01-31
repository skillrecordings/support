import { generateObject } from 'ai'
import { z } from 'zod'

const result = await generateObject({
  model: 'moonshotai/kimi-k2.5',
  schema: z.object({
    topics: z.array(z.object({
      id: z.string(),
      name: z.string(),
    }))
  }),
  prompt: 'List 3 programming topics',
})

console.log('Response:', JSON.stringify(result.object, null, 2))
