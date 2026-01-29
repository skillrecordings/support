import { createFrontClient } from '@skillrecordings/front-sdk'

export async function frontStats() {
  const front = createFrontClient({ apiToken: process.env.FRONT_API_TOKEN! })

  // List all inboxes
  const inboxes = await front.inboxes.list()
  const inboxList = (inboxes as any)?._results ?? []

  console.log(`Found ${inboxList.length} inboxes\n`)
  console.log('Counting conversations (this may take a minute)...\n')

  let grandTotal = 0
  const results: { name: string; id: string; count: number }[] = []

  // Key inboxes to check
  const keyInboxes = [
    'Total TypeScript',
    'Epic Web',
    'AI Hero',
    'Pro Tailwind',
    'Epic AI',
  ]

  for (const inbox of inboxList) {
    // Only count key inboxes for speed
    if (!keyInboxes.some((k) => inbox.name.includes(k))) continue

    process.stdout.write(`📬 ${inbox.name}... `)

    try {
      // Count by paginating
      let count = 0
      let hasMore = true
      let pageToken: string | undefined

      while (hasMore && count < 10000) {
        // Cap at 10k
        const response = (await front.inboxes.listConversations(inbox.id, {
          limit: 100,
          ...(pageToken ? { page_token: pageToken } : {}),
        })) as any

        const convos = response?._results ?? []
        count += convos.length

        pageToken = response?._pagination?.next
        hasMore = !!pageToken && convos.length === 100

        // Rate limit
        await new Promise((r) => setTimeout(r, 100))
      }

      console.log(`${count}${count >= 10000 ? '+' : ''} conversations`)
      results.push({ name: inbox.name, id: inbox.id, count })
      grandTotal += count
    } catch (e: any) {
      console.log(`Error: ${e.message}`)
    }
  }

  console.log(`\n📊 Key inboxes total: ${grandTotal} conversations`)
  console.log(
    `   (${inboxList.length} total inboxes, only counted ${results.length} key ones)`
  )
}

frontStats()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
