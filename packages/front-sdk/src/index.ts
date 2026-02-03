/**
 * @skillrecordings/front-sdk
 * Typed Front API SDK with Zod validation
 */

// Common schemas
export {
  LinksSchema,
  PaginationSchema,
  PaginatedResponseSchema,
  ErrorResponseSchema,
  type Links,
  type Pagination,
  type PaginatedResponse,
  type ErrorResponse,
} from './schemas/common'

// Conversation schemas
export {
  RecipientSchema,
  ConversationStatusSchema,
  TagSchema as ConversationTagSchema,
  LinkSchema,
  AssigneeSchema,
  ReminderSchema,
  ConversationMetadataSchema,
  ConversationSchema,
  ConversationListSchema,
  UpdateConversationSchema,
  type Recipient,
  type ConversationStatus,
  type Tag as ConversationTag,
  type Link,
  type Assignee,
  type Reminder,
  type ConversationMetadata,
  type Conversation,
  type ConversationList,
  type UpdateConversation,
} from './schemas/conversation'

// Message schemas
export {
  AuthorSchema,
  AttachmentSchema,
  SignatureSchema,
  MessageSchema,
  MessageListSchema,
  CreateMessageSchema,
  type Author,
  type Attachment,
  type Signature,
  type Message,
  type MessageList,
  type CreateMessage,
} from './schemas/message'

// Draft schemas
export {
  DraftSchema,
  DraftListSchema,
  CreateDraftSchema,
  EditDraftSchema,
  type Draft,
  type DraftList,
  type CreateDraft,
  type EditDraft,
} from './schemas/draft'

// Template schemas
export {
  MessageTemplateSchema,
  MessageTemplateListSchema,
  MessageTemplateFolderSchema,
  MessageTemplateFolderListSchema,
  CreateMessageTemplateSchema,
  UpdateMessageTemplateSchema,
  type MessageTemplate,
  type MessageTemplateList,
  type MessageTemplateFolder,
  type MessageTemplateFolderList,
  type CreateMessageTemplate,
  type UpdateMessageTemplate,
} from './schemas/template'

// Tag schemas
export {
  TagHighlightSchema,
  TagSchema,
  TagListSchema,
  CreateTagSchema,
  UpdateTagSchema,
  type Tag,
  type TagList,
} from './schemas/tag'

// Inbox schemas
export {
  InboxSchema,
  InboxListSchema,
  CreateInboxSchema,
  type Inbox,
  type InboxList,
  type CreateInbox,
} from './schemas/inbox'

// Channel schemas
export {
  ChannelTypeSchema,
  ChannelSchema,
  ChannelListSchema,
  CreateChannelSchema,
  UpdateChannelSchema,
  type Channel,
  type ChannelList,
} from './schemas/channel'

// Contact schemas
export {
  ContactHandleSourceSchema,
  ContactHandleSchema,
  ContactGroupSchema,
  ContactSchema,
  ContactListSchema,
  CreateContactSchema,
  UpdateContactSchema,
  type ContactHandle,
  type Contact,
  type ContactList,
} from './schemas/contact'

// Teammate schemas
export {
  TeammateSchema,
  TeammateListSchema,
  UpdateTeammateSchema,
  type Teammate,
  type TeammateList,
} from './schemas/teammate'

// Export base client utilities
export {
  FRONT_API_BASE,
  FrontApiError,
  createBaseClient,
  type FrontClientConfig,
  type BaseClient,
} from './client/base'

// Export individual client factories (for instrumented clients)
export { createChannelsClient } from './client/channels'
export { createContactsClient } from './client/contacts'
export { createConversationsClient } from './client/conversations'
export { createDraftsClient } from './client/drafts'
export { createInboxesClient } from './client/inboxes'
export { createMessagesClient } from './client/messages'
export { createTagsClient } from './client/tags'
export { createTeammatesClient } from './client/teammates'
export { createTemplatesClient } from './client/templates'

// Import client factories
import { type FrontClientConfig, createBaseClient } from './client/base'
import { createChannelsClient } from './client/channels'
import { createContactsClient } from './client/contacts'
import { createConversationsClient } from './client/conversations'
import { createDraftsClient } from './client/drafts'
import { createInboxesClient } from './client/inboxes'
import { createMessagesClient } from './client/messages'
import { createTagsClient } from './client/tags'
import { createTeammatesClient } from './client/teammates'
import { createTemplatesClient } from './client/templates'

/**
 * Pagination helper that automatically follows _pagination.next links.
 * Collects all results across pages into a single array.
 *
 * @example
 * ```ts
 * const allConversations = await paginate(
 *   () => front.conversations.list(),
 *   (url) => front.conversations.listFromUrl(url)
 * )
 * ```
 */
export async function paginate<
  T extends { _results: unknown[]; _pagination?: { next?: string | null } },
>(
  firstPage: () => Promise<T>,
  getPage: (url: string) => Promise<T>
): Promise<T['_results']> {
  const results: T['_results'] = []
  let page = await firstPage()
  results.push(...page._results)

  while (page._pagination?.next) {
    page = await getPage(page._pagination.next)
    results.push(...page._results)
  }

  return results
}

/**
 * Create a fully typed Front API client.
 *
 * @example
 * ```ts
 * const front = createFrontClient({ apiToken: 'xxx' })
 *
 * // Get a conversation
 * const conv = await front.conversations.get('cnv_xxx')
 *
 * // List messages
 * const messages = await front.conversations.listMessages('cnv_xxx')
 *
 * // Create a draft
 * const draft = await front.drafts.createReply('cnv_xxx', {
 *   body: 'Hello!',
 *   channel_id: 'cha_xxx',
 * })
 * ```
 */
export function createFrontClient(config: FrontClientConfig) {
  const baseClient = createBaseClient(config)

  return {
    /** Raw HTTP methods for custom requests */
    raw: baseClient,

    /** Conversation operations */
    conversations: createConversationsClient(baseClient),

    /** Message operations */
    messages: createMessagesClient(baseClient),

    /** Draft operations */
    drafts: createDraftsClient(baseClient),

    /** Message template operations */
    templates: createTemplatesClient(baseClient),

    /** Tag operations */
    tags: createTagsClient(baseClient),

    /** Inbox operations */
    inboxes: createInboxesClient(baseClient),

    /** Channel operations */
    channels: createChannelsClient(baseClient),

    /** Contact operations */
    contacts: createContactsClient(baseClient),

    /** Teammate operations */
    teammates: createTeammatesClient(baseClient),
  }
}

/** Type for the full Front client instance */
export type FrontClient = ReturnType<typeof createFrontClient>
