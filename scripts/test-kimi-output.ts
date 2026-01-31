import { generateText, Output } from 'ai'
import { z } from 'zod'

const { output } = await generateText({
  model: 'moonshotai/kimi-k2.5',
  output: Output.object({
    schema: z.object({
      topics: z.array(z.object({
        id: z.string(),
        name: z.string(),
      }))
    })
  }),
  prompt: 'List 3 programming topics',
})

console.log('Response:', JSON.stringify(output, null, 2))
