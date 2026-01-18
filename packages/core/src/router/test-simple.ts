import { generateObject } from 'ai'
import { z } from 'zod'

const SimpleSchema = z.object({
  name: z.string(),
})

async function test() {
  const result = await generateObject({
    model: 'anthropic/claude-haiku-4-5',
    prompt: 'test',
    schema: SimpleSchema,
  })
  return result.object.name
}
