import { randomUUID } from 'crypto'
import { WebhookPayloadSnapshotsTable, getDb } from '@skillrecordings/database'
import { and, desc, eq } from 'drizzle-orm'

export type WebhookPayloadSource = 'webhook_preview' | 'front_api'

export interface WebhookPayloadSnapshotInput {
  source: WebhookPayloadSource
  eventType?: string
  conversationId?: string
  messageId?: string
  appId?: string
  inboxId?: string
  payload?: Record<string, unknown>
  payloadRaw?: string
  subject?: string | null
  body?: string | null
  senderEmail?: string | null
  previewDiffers?: boolean
  diffFields?: string[]
}

type PreviewSnapshot = {
  id: string
  subject?: string | null
  body?: string | null
  sender_email?: string | null
}

const PREVIEW_DIFF_FIELDS = {
  subject: 'subject',
  body: 'body',
  senderEmail: 'sender_email',
} as const

function computeDiffFields(
  preview: PreviewSnapshot,
  full: {
    subject?: string | null
    body?: string | null
    senderEmail?: string | null
  }
): string[] {
  const diffFields: string[] = []
  const previewSubject = preview.subject ?? ''
  const previewBody = preview.body ?? ''
  const previewSenderEmail = preview.sender_email ?? ''
  const fullSubject = full.subject ?? ''
  const fullBody = full.body ?? ''
  const fullSenderEmail = full.senderEmail ?? ''

  if (previewSubject !== fullSubject)
    diffFields.push(PREVIEW_DIFF_FIELDS.subject)
  if (previewBody !== fullBody) diffFields.push(PREVIEW_DIFF_FIELDS.body)
  if (previewSenderEmail !== fullSenderEmail)
    diffFields.push(PREVIEW_DIFF_FIELDS.senderEmail)

  return diffFields
}

async function findLatestPreviewSnapshot(
  messageId?: string
): Promise<PreviewSnapshot | null> {
  if (!messageId) return null
  const db = getDb()
  const snapshots = await db
    .select({
      id: WebhookPayloadSnapshotsTable.id,
      subject: WebhookPayloadSnapshotsTable.subject,
      body: WebhookPayloadSnapshotsTable.body,
      sender_email: WebhookPayloadSnapshotsTable.sender_email,
    })
    .from(WebhookPayloadSnapshotsTable)
    .where(
      and(
        eq(WebhookPayloadSnapshotsTable.source, 'webhook_preview'),
        eq(WebhookPayloadSnapshotsTable.message_id, messageId)
      )
    )
    .orderBy(desc(WebhookPayloadSnapshotsTable.created_at))
    .limit(1)

  return snapshots[0] ?? null
}

export async function recordWebhookPayloadSnapshot(
  input: WebhookPayloadSnapshotInput
): Promise<string | null> {
  if (!process.env.DATABASE_URL) return null
  if (!input.conversationId && !input.messageId) return null

  try {
    const db = getDb()
    const bodyValue = input.body ?? null
    const subjectValue = input.subject ?? null
    const senderEmailValue = input.senderEmail ?? null

    const snapshotId = randomUUID()
    await db.insert(WebhookPayloadSnapshotsTable).values({
      id: snapshotId,
      source: input.source,
      event_type: input.eventType ?? null,
      conversation_id: input.conversationId ?? null,
      message_id: input.messageId ?? null,
      app_id: input.appId ?? null,
      inbox_id: input.inboxId ?? null,
      payload: input.payload ?? null,
      payload_raw: input.payloadRaw ?? null,
      subject: subjectValue,
      body: bodyValue,
      sender_email: senderEmailValue,
      body_length: bodyValue ? bodyValue.length : 0,
      has_body: Boolean(bodyValue),
      has_subject: Boolean(subjectValue),
      has_sender_email: Boolean(senderEmailValue),
      preview_differs: input.previewDiffers ?? null,
      diff_fields: input.diffFields ?? null,
    })

    return snapshotId
  } catch (error) {
    console.warn('[webhook-payloads] Failed to record snapshot:', error)
    return null
  }
}

export async function recordFullMessageSnapshot(
  input: Omit<WebhookPayloadSnapshotInput, 'source'>
): Promise<string | null> {
  if (!process.env.DATABASE_URL) return null
  if (!input.messageId) return null

  try {
    const previewSnapshot = await findLatestPreviewSnapshot(input.messageId)
    const diffFields = previewSnapshot
      ? computeDiffFields(previewSnapshot, {
          subject: input.subject ?? null,
          body: input.body ?? null,
          senderEmail: input.senderEmail ?? null,
        })
      : []

    const previewDiffers = diffFields.length > 0

    return await recordWebhookPayloadSnapshot({
      ...input,
      source: 'front_api',
      previewDiffers: previewSnapshot ? previewDiffers : undefined,
      diffFields: previewSnapshot ? diffFields : undefined,
    })
  } catch (error) {
    console.warn(
      '[webhook-payloads] Failed to record full message snapshot:',
      error
    )
    return null
  }
}
