import {
  MessageTemplateFolderListSchema,
  MessageTemplateFolderSchema,
  MessageTemplateListSchema,
  MessageTemplateSchema,
} from '../schemas/template'
import type {
  CreateMessageTemplate,
  MessageTemplate,
  MessageTemplateFolder,
  MessageTemplateFolderList,
  MessageTemplateList,
  UpdateMessageTemplate,
} from '../schemas/template'
import type { BaseClient } from './base'

/**
 * Client for Front message templates API
 * Provides methods for managing message templates and folders
 */
export function createTemplatesClient(client: BaseClient) {
  return {
    /**
     * List all message templates
     * @returns Paginated list of message templates
     */
    list: () =>
      client.get<MessageTemplateList>(
        '/message_templates',
        MessageTemplateListSchema
      ),

    /**
     * Get a specific message template by ID
     * @param id - Template ID (rsp_xxx)
     * @returns Message template
     */
    get: (id: string) =>
      client.get<MessageTemplate>(
        `/message_templates/${id}`,
        MessageTemplateSchema
      ),

    /**
     * Create a new message template
     * @param data - Template data (name, subject, body, folder_id, inbox_ids)
     * @returns Created message template
     */
    create: (data: CreateMessageTemplate) =>
      client.post<MessageTemplate>(
        '/message_templates',
        data,
        MessageTemplateSchema
      ),

    /**
     * Update an existing message template
     * @param id - Template ID (rsp_xxx)
     * @param data - Fields to update
     * @returns Updated message template
     */
    update: (id: string, data: UpdateMessageTemplate) =>
      client.patch<MessageTemplate>(
        `/message_templates/${id}`,
        data,
        MessageTemplateSchema
      ),

    /**
     * Delete a message template
     * @param id - Template ID (rsp_xxx)
     */
    delete: (id: string) => client.delete<void>(`/message_templates/${id}`),

    // Folder operations

    /**
     * List all message template folders
     * @returns Paginated list of folders
     */
    listFolders: () =>
      client.get<MessageTemplateFolderList>(
        '/message_template_folders',
        MessageTemplateFolderListSchema
      ),

    /**
     * Get a specific folder by ID
     * @param id - Folder ID (fld_xxx)
     * @returns Message template folder
     */
    getFolder: (id: string) =>
      client.get<MessageTemplateFolder>(
        `/message_template_folders/${id}`,
        MessageTemplateFolderSchema
      ),

    /**
     * Create a new template folder
     * @param name - Folder name
     * @returns Created folder
     */
    createFolder: (name: string) =>
      client.post<MessageTemplateFolder>(
        '/message_template_folders',
        { name },
        MessageTemplateFolderSchema
      ),

    /**
     * Delete a template folder
     * @param id - Folder ID (fld_xxx)
     */
    deleteFolder: (id: string) =>
      client.delete<void>(`/message_template_folders/${id}`),
  }
}
