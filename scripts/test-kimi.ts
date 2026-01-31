import { generateText } from 'ai'

const result = await generateText({
  model: 'moonshotai/kimi-k2.5',
  prompt: 'Say hello in 5 words or less',
})

console.log('Response:', result.text)
