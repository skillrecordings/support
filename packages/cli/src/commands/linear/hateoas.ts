/**
 * HATEOAS wrapper for Linear CLI JSON output
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
  /** Write operations require a personal API key */
  requires_personal_key?: boolean
}

export interface HateoasMeta {
  /** Hint about personal API key requirement */
  personal_key_hint?: string
  /** Setup command for personal keys */
  setup_command?: string
}

export interface HateoasResponse<T> {
  data: T
  _links: HateoasLink[]
  _actions: HateoasAction[]
  _meta?: HateoasMeta
  _type: string
  _command: string
}

export function hateoasWrap<T>(opts: {
  type: string
  command: string
  data: T
  links?: HateoasLink[]
  actions?: HateoasAction[]
  meta?: HateoasMeta
}): HateoasResponse<T> {
  const response: HateoasResponse<T> = {
    _type: opts.type,
    _command: opts.command,
    data: opts.data,
    _links: opts.links ?? [],
    _actions: opts.actions ?? [],
  }
  if (opts.meta) {
    response._meta = opts.meta
  }
  return response
}

/**
 * Standard metadata for responses that include write actions.
 * Provides clear hint about personal API key requirement.
 */
export const WRITE_ACTION_META: HateoasMeta = {
  personal_key_hint:
    '⚠️ Write operations require a personal LINEAR_API_KEY. Run `skill keys add` to set up your keys.',
  setup_command: 'skill keys add',
}

// ── Link/action builders for each resource type ──

export function issueLinks(
  identifier: string,
  teamKey?: string
): HateoasLink[] {
  const links: HateoasLink[] = [
    {
      rel: 'self',
      command: `skill linear issue ${identifier} --json`,
      description: 'This issue',
    },
    {
      rel: 'comments',
      command: `skill linear comments ${identifier} --json`,
      description: 'Comments on this issue',
    },
  ]
  if (teamKey) {
    links.push({
      rel: 'team-issues',
      command: `skill linear issues --team ${teamKey} --json`,
      description: 'All issues in this team',
    })
  }
  return links
}

export function issueActions(identifier: string): HateoasAction[] {
  return [
    {
      action: 'comment',
      command: `skill linear comment ${identifier} --body "<text>"`,
      description: 'Add a comment',
      requires_personal_key: true,
    },
    {
      action: 'assign',
      command: `skill linear assign ${identifier} --to <user-email>`,
      description: 'Assign this issue',
      requires_personal_key: true,
    },
    {
      action: 'unassign',
      command: `skill linear assign ${identifier} --unassign`,
      description: 'Unassign this issue',
      requires_personal_key: true,
    },
    {
      action: 'update-state',
      command: `skill linear state ${identifier} --state "<state-name>"`,
      description: 'Change workflow state',
      requires_personal_key: true,
    },
    {
      action: 'update-priority',
      command: `skill linear update ${identifier} --priority <0-4>`,
      description: 'Change priority (0=urgent, 4=none)',
      requires_personal_key: true,
    },
    {
      action: 'add-label',
      command: `skill linear label ${identifier} --add "<label-name>"`,
      description: 'Add a label',
      requires_personal_key: true,
    },
    {
      action: 'close',
      command: `skill linear close ${identifier}`,
      description: 'Close this issue',
      destructive: true,
      requires_personal_key: true,
    },
    {
      action: 'link',
      command: `skill linear link ${identifier} --blocks <other-id>`,
      description: 'Link to another issue',
      requires_personal_key: true,
    },
  ]
}

export function issueListLinks(
  issues: Array<{ identifier: string; title: string }>,
  teamKey?: string
): HateoasLink[] {
  const links: HateoasLink[] = issues.slice(0, 10).map((issue) => ({
    rel: 'issue',
    command: `skill linear issue ${issue.identifier} --json`,
    description: issue.title,
  }))
  if (teamKey) {
    links.push({
      rel: 'team',
      command: `skill linear team ${teamKey} --json`,
      description: 'Parent team',
    })
  }
  return links
}

export function issueListActions(teamKey?: string): HateoasAction[] {
  const actions: HateoasAction[] = [
    {
      action: 'create',
      command: `skill linear create "<title>"${teamKey ? ` --team ${teamKey}` : ''}`,
      description: 'Create a new issue',
      requires_personal_key: true,
    },
    {
      action: 'search',
      command: `skill linear search "<query>"`,
      description: 'Search issues',
    },
    {
      action: 'my-issues',
      command: `skill linear my --json`,
      description: 'View my assigned issues',
    },
  ]
  if (teamKey) {
    actions.push({
      action: 'team-states',
      command: `skill linear states ${teamKey} --json`,
      description: 'View workflow states',
    })
    actions.push({
      action: 'team-labels',
      command: `skill linear labels ${teamKey} --json`,
      description: 'View available labels',
    })
  }
  return actions
}

export function teamLinks(teamKey: string): HateoasLink[] {
  return [
    {
      rel: 'self',
      command: `skill linear team ${teamKey} --json`,
      description: 'This team',
    },
    {
      rel: 'issues',
      command: `skill linear issues --team ${teamKey} --json`,
      description: 'Issues in this team',
    },
    {
      rel: 'states',
      command: `skill linear states ${teamKey} --json`,
      description: 'Workflow states',
    },
    {
      rel: 'labels',
      command: `skill linear labels ${teamKey} --json`,
      description: 'Labels',
    },
  ]
}

export function teamListLinks(
  teams: Array<{ key: string; name: string }>
): HateoasLink[] {
  return teams.map((t) => ({
    rel: 'team',
    command: `skill linear issues --team ${t.key} --json`,
    description: `${t.name} (${t.key})`,
  }))
}

export function projectLinks(projectId: string): HateoasLink[] {
  return [
    {
      rel: 'self',
      command: `skill linear project ${projectId} --json`,
      description: 'This project',
    },
    {
      rel: 'issues',
      command: `skill linear issues --project ${projectId} --json`,
      description: 'Issues in this project',
    },
  ]
}

export function projectListLinks(
  projects: Array<{ id: string; name: string }>
): HateoasLink[] {
  return projects.map((p) => ({
    rel: 'project',
    command: `skill linear issues --project ${p.id} --json`,
    description: p.name,
  }))
}

export function commentLinks(
  commentId: string,
  issueIdentifier: string
): HateoasLink[] {
  return [
    {
      rel: 'issue',
      command: `skill linear issue ${issueIdentifier} --json`,
      description: 'Parent issue',
    },
    {
      rel: 'all-comments',
      command: `skill linear comments ${issueIdentifier} --json`,
      description: 'All comments',
    },
  ]
}

export function userLinks(userId: string): HateoasLink[] {
  return [
    {
      rel: 'assigned-issues',
      command: `skill linear issues --assignee ${userId} --json`,
      description: 'Issues assigned to this user',
    },
  ]
}

export function userListLinks(
  users: Array<{ id: string; email: string; name: string }>
): HateoasLink[] {
  return users.map((u) => ({
    rel: 'user-issues',
    command: `skill linear issues --assignee ${u.email} --json`,
    description: `${u.name} (${u.email})`,
  }))
}
