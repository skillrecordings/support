export type RouteType = 'rule' | 'canned' | 'classifier' | 'agent'

export interface RouterDecision {
  route: RouteType
  reason: string
  confidence: number
  category: string
  cannedResponseId?: string
  ruleId?: string
}

export interface Rule {
  id: string
  priority: number
  type: 'regex' | 'keyword' | 'sender_domain' | 'sender_pattern'
  pattern: string
  action: 'auto_respond' | 'no_respond' | 'escalate' | 'route_to_canned'
  response?: string
  cannedResponseId?: string
}

export interface RuleMatch {
  ruleId: string
  action: Rule['action']
  response?: string
  cannedResponseId?: string
}
