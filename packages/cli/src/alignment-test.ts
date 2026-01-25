import '../preload'
import { runSupportAgent } from '@skillrecordings/core/agent'
import { database } from '@skillrecordings/database'
import { IntegrationClient } from '@skillrecordings/sdk/client'
import { readFileSync } from 'fs'

interface Sample {
  triggerMessage: { subject: string; body: string }
  agentResponse: { text: string }
  app: string
}

async function main() {
  const dataset: Sample[] = JSON.parse(readFileSync('data/eval-dataset.json', 'utf-8'))
  
  // Pick samples with leakage patterns
  const leakyOnes = dataset.filter(s => 
    s.agentResponse.text.includes('No instructor routing') ||
    s.agentResponse.text.includes("can't route") ||
    s.agentResponse.text.includes('Per my guidelines')
  ).slice(0, 3)
  
  for (const sample of leakyOnes) {
    const appSlug = sample.app === 'unknown' ? 'ai-hero' : sample.app
    const app = await database.query.AppsTable.findFirst({
      where: (apps, { eq }) => eq(apps.slug, appSlug),
    })
    
    if (!app) continue
    
    const client = new IntegrationClient({
      baseUrl: app.integration_base_url,
      webhookSecret: app.webhook_secret,
    })
    
    console.log('\n' + '='.repeat(60))
    console.log('SUBJECT:', sample.triggerMessage.subject.slice(0, 60))
    console.log('PROD (leaky):', sample.agentResponse.text.slice(0, 120) + '...')
    
    try {
      const result = await runSupportAgent({
        message: sample.triggerMessage.body,
        conversationHistory: [],
        customerContext: { email: 'eval@test.com' },
        appId: appSlug,
        model: 'anthropic/claude-haiku-4-5',
        integrationClient: client,
        appConfig: {
          instructor_teammate_id: app.instructor_teammate_id || undefined,
          stripeAccountId: app.stripe_account_id || undefined,
        },
      })
      
      console.log('LOCAL:', result.response?.slice(0, 120) || '(no response - GOOD)')
      console.log('TOOLS:', result.toolCalls.map(t => t.name).join(', ') || '(none)')
      console.log('IMPROVED?:', !result.response ? '✅ Yes (silent)' : (result.response.includes('instructor') ? '❌ No' : '✅ Yes'))
    } catch (e: any) {
      console.log('ERROR:', e.message)
    }
  }
  
  process.exit(0)
}
main()
