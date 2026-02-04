/**
 * HATEOAS wrapper for Front CLI JSON output
 *
 * Wraps raw data with _links and _actions so agents
 * can discover what to do next without reading help text.
 */

export interface HateoasLink {
  rel: string
  command: string
  description: string
}

export interface HateoasAction {
  action: string
  command: string
  description: string
  destructive?: boolean
}

export interface HateoasResponse<T> {
  data: T
  _links: HateoasLink[]
  _actions: HateoasAction[]
  _type: string
  _command: string
}

export function hateoasWrap<T>(opts: {
  type: string
  command: string
  data: T
  links?: HateoasLink[]
  actions?: HateoasAction[]
}): HateoasResponse<T> {
  return {
    _type: opts.type,
    _command: opts.command,
    data: opts.data,
    _links: opts.links ?? [],
    _actions: opts.actions ?? [],
  }
}

// ── Link/action builders for each resource type ──

export function inboxLinks(inboxId: string): HateoasLink[] {
  return [
    {
      rel: 'self',
      command: `skill front inbox ${inboxId} --json`,
      description: 'This inbox',
    },
    {
      rel: 'conversations',
      command: `skill front inbox ${inboxId} --json`,
      description: 'Conversations in this inbox',
    },
  ]
}

export function inboxActions(inboxId: string): HateoasAction[] {
  return [
    {
      action: 'report',
      command: `skill front report --inbox ${inboxId} --json`,
      description: 'Generate forensics report',
    },
    {
      action: 'triage',
      command: `skill front triage --inbox ${inboxId} --json`,
      description: 'Triage conversations',
    },
    {
      action: 'bulk-archive',
      command: `skill front bulk-archive --inbox ${inboxId} --dry-run --json`,
      description: 'Bulk archive with filters',
      destructive: true,
    },
  ]
}

export function inboxListLinks(
  inboxes: Array<{ id: string; name: string }>
): HateoasLink[] {
  return inboxes.map((inbox) => ({
    rel: 'inbox',
    command: `skill front inbox ${inbox.id} --json`,
    description: inbox.name,
  }))
}

export function conversationLinks(
  convId: string,
  inboxId?: string
): HateoasLink[] {
  const links: HateoasLink[] = [
    {
      rel: 'self',
      command: `skill front conversation ${convId} --json`,
      description: 'This conversation',
    },
    {
      rel: 'messages',
      command: `skill front conversation ${convId} --messages --json`,
      description: 'Full message history',
    },
  ]
  if (inboxId) {
    links.push({
      rel: 'inbox',
      command: `skill front inbox ${inboxId} --json`,
      description: 'Parent inbox',
    })
  }
  return links
}

export function conversationActions(convId: string): HateoasAction[] {
  return [
    {
      action: 'archive',
      command: `skill front archive ${convId}`,
      description: 'Archive this conversation',
      destructive: true,
    },
    {
      action: 'assign',
      command: `skill front assign ${convId} <teammate-id> --json`,
      description: 'Assign to a teammate',
    },
    {
      action: 'unassign',
      command: `skill front assign ${convId} --unassign --json`,
      description: 'Remove assignee',
    },
    {
      action: 'tag',
      command: `skill front tag ${convId} <tag-name-or-id> --json`,
      description: 'Add a tag',
    },
    {
      action: 'untag',
      command: `skill front untag ${convId} <tag-name-or-id> --json`,
      description: 'Remove a tag',
    },
    {
      action: 'reply',
      command: `skill front reply ${convId} --body "<text>" --json`,
      description: 'Create a draft reply',
    },
    {
      action: 'tags',
      command: `skill front tags list --json`,
      description: 'View available tags',
    },
  ]
}

export function conversationListLinks(
  conversations: Array<{ id: string; subject?: string }>,
  inboxId?: string
): HateoasLink[] {
  const links: HateoasLink[] = conversations.map((c) => ({
    rel: 'conversation',
    command: `skill front conversation ${c.id} --json`,
    description: c.subject || '(no subject)',
  }))
  if (inboxId) {
    links.push({
      rel: 'inbox',
      command: `skill front inbox ${inboxId} --json`,
      description: 'Parent inbox',
    })
  }
  return links
}

export function conversationListActions(inboxId?: string): HateoasAction[] {
  const actions: HateoasAction[] = []
  if (inboxId) {
    actions.push(
      {
        action: 'bulk-archive',
        command: `skill front bulk-archive --inbox ${inboxId} --dry-run --json`,
        description: 'Bulk archive with filters',
        destructive: true,
      },
      {
        action: 'triage',
        command: `skill front triage --inbox ${inboxId} --json`,
        description: 'Triage conversations',
      },
      {
        action: 'report',
        command: `skill front report --inbox ${inboxId} --json`,
        description: 'Generate inbox report',
      }
    )
  }
  return actions
}

export function messageLinks(msgId: string, convId?: string): HateoasLink[] {
  const links: HateoasLink[] = [
    {
      rel: 'self',
      command: `skill front message ${msgId} --json`,
      description: 'This message',
    },
  ]
  if (convId) {
    links.push({
      rel: 'conversation',
      command: `skill front conversation ${convId} --json`,
      description: 'Parent conversation',
    })
  }
  return links
}

export function tagLinks(tagId: string): HateoasLink[] {
  return [
    {
      rel: 'self',
      command: `skill front tags list --json`,
      description: 'All tags',
    },
  ]
}

export function tagListLinks(
  tags: Array<{ id: string; name: string }>
): HateoasLink[] {
  return tags.map((t) => ({
    rel: 'tag',
    command: `skill front tags list --json`,
    description: t.name,
  }))
}

export function tagListActions(): HateoasAction[] {
  return [
    {
      action: 'cleanup',
      command: `skill front tags cleanup`,
      description: 'Clean up duplicates, variants, obsolete tags',
    },
  ]
}

export function reportLinks(
  inboxId: string,
  unresolvedIds: string[]
): HateoasLink[] {
  const links: HateoasLink[] = [
    {
      rel: 'inbox',
      command: `skill front inbox ${inboxId} --json`,
      description: 'Source inbox',
    },
  ]
  for (const id of unresolvedIds.slice(0, 5)) {
    links.push({
      rel: 'unresolved',
      command: `skill front conversation ${id} --json`,
      description: 'Unresolved conversation',
    })
  }
  return links
}

export function reportActions(inboxId: string): HateoasAction[] {
  return [
    {
      action: 'triage',
      command: `skill front triage --inbox ${inboxId} --json`,
      description: 'Triage this inbox',
    },
    {
      action: 'bulk-archive',
      command: `skill front bulk-archive --inbox ${inboxId} --dry-run --json`,
      description: 'Bulk archive with filters',
      destructive: true,
    },
  ]
}

export function triageActions(inboxId: string): HateoasAction[] {
  return [
    {
      action: 'bulk-archive-noise',
      command: `skill front triage --inbox ${inboxId} --auto-archive`,
      description: 'Auto-archive noise and spam',
      destructive: true,
    },
    {
      action: 'bulk-archive',
      command: `skill front bulk-archive --inbox ${inboxId} --dry-run --json`,
      description: 'Bulk archive with custom filters',
      destructive: true,
    },
  ]
}

export function teammateLinks(teammateId: string): HateoasLink[] {
  return [
    {
      rel: 'self',
      command: `skill front teammate ${teammateId} --json`,
      description: 'This teammate',
    },
  ]
}

export function teammateListLinks(
  teammates: Array<{ id: string; email: string }>
): HateoasLink[] {
  return teammates.map((t) => ({
    rel: 'teammate',
    command: `skill front teammate ${t.id} --json`,
    description: t.email,
  }))
}
