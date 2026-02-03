export interface CategoryThreshold {
  autoSendMinConfidence: number
  autoSendMinVolume: number
  escalateAlways?: boolean
  escalateOnKeywords?: string[]
}

export const DEFAULT_CATEGORY_THRESHOLD: CategoryThreshold = {
  autoSendMinConfidence: 0.95,
  autoSendMinVolume: 50,
}

export const CATEGORY_THRESHOLDS: Record<string, CategoryThreshold> = {
  'support_team-license': {
    autoSendMinConfidence: 0.98,
    autoSendMinVolume: 50,
    escalateAlways: true,
  },
  'support_bug-report': {
    autoSendMinConfidence: 0.95,
    autoSendMinVolume: 30,
    escalateOnKeywords: ['multiple users', 'widespread', 'everyone'],
  },
  support_refund: {
    autoSendMinConfidence: 0.95,
    autoSendMinVolume: 100,
  },
  default: DEFAULT_CATEGORY_THRESHOLD,
}

export function getCategoryThreshold(category?: string): CategoryThreshold {
  if (!category) return DEFAULT_CATEGORY_THRESHOLD
  return CATEGORY_THRESHOLDS[category] ?? DEFAULT_CATEGORY_THRESHOLD
}
