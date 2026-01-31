import { generateText } from 'ai'

const { text } = await generateText({
  model: 'moonshotai/kimi-k2.5',
  prompt: `List 3 programming topics. Return ONLY valid JSON in this exact format:
{"topics": [{"id": "topic_1", "name": "Topic Name"}]}`,
})

console.log('Raw response:')
console.log(text)
