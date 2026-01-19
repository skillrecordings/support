import { ContactListSchema, ContactSchema } from '../schemas/contact'
import type { Contact, ContactHandle, ContactList } from '../schemas/contact'
import type { BaseClient } from './base'

export function createContactsClient(client: BaseClient) {
  return {
    list: () => client.get<ContactList>('/contacts', ContactListSchema),
    get: (id: string) => client.get<Contact>(`/contacts/${id}`, ContactSchema),
    create: (data: {
      handles: ContactHandle[]
      name?: string
      description?: string
    }) => client.post<Contact>('/contacts', data, ContactSchema),
    update: (
      id: string,
      data: { name?: string; description?: string; is_spammer?: boolean }
    ) => client.patch<Contact>(`/contacts/${id}`, data, ContactSchema),
    delete: (id: string) => client.delete<void>(`/contacts/${id}`),
    merge: (targetId: string, sourceIds: string[]) =>
      client.post<Contact>(
        '/contacts/merge',
        { target_contact_id: targetId, contact_ids: sourceIds },
        ContactSchema
      ),
    listConversations: (id: string) =>
      client.get(`/contacts/${id}/conversations`),
    addHandle: (id: string, handle: ContactHandle) =>
      client.post<void>(`/contacts/${id}/handles`, handle),
    deleteHandle: (id: string, handle: string, source: string) =>
      client.delete<void>(
        `/contacts/${id}/handles?handle=${encodeURIComponent(handle)}&source=${encodeURIComponent(source)}`
      ),
    listNotes: (id: string) => client.get(`/contacts/${id}/notes`),
    addNote: (id: string, body: string, authorId?: string) =>
      client.post(`/contacts/${id}/notes`, { body, author_id: authorId }),
  }
}
