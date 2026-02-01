import { useState, useEffect } from 'react'

interface TemplateVariable {
  name: string
  source: string
}

interface Template {
  id: string
  category: string
  pattern: string
  template: string
  variables: TemplateVariable[] | string
  confidence: number
  source_subject: string
  status?: 'pending' | 'approved' | 'killed' | 'processing' | 'superseded'
  feedback?: string
  version?: number
  parent_id?: string
}

function parseVariables(vars: TemplateVariable[] | string): TemplateVariable[] {
  if (!vars) return []
  if (Array.isArray(vars)) return vars
  try {
    return JSON.parse(vars)
  } catch {
    return []
  }
}

function TemplateCard({ template, onAction }: { 
  template: Template
  onAction: (id: string, action: 'approve' | 'feedback' | 'kill', feedback?: string) => void 
}) {
  const [showFeedback, setShowFeedback] = useState(false)
  const [feedbackText, setFeedbackText] = useState('')
  const status = template.status || 'pending'
  const vars = parseVariables(template.variables)
  
  const handleFeedback = () => {
    if (showFeedback && feedbackText.trim()) {
      onAction(template.id, 'feedback', feedbackText)
      setShowFeedback(false)
      setFeedbackText('')
    } else {
      setShowFeedback(true)
    }
  }
  
  const handleApprove = () => {
    setShowFeedback(false)
    onAction(template.id, 'approve')
  }

  const handleKill = () => {
    setShowFeedback(false)
    onAction(template.id, 'kill')
  }
  
  const statusColors: Record<string, string> = {
    approved: 'border-green-500/50 bg-green-950/20',
    killed: 'border-red-500/50 bg-red-950/20',
    processing: 'border-yellow-500/50 bg-yellow-950/20',
    superseded: 'border-zinc-600/50 bg-zinc-900/50',
    pending: 'border-zinc-700 bg-zinc-900',
  }

  const badgeColors: Record<string, string> = {
    approved: 'bg-green-600',
    killed: 'bg-red-600',
    processing: 'bg-yellow-600',
    superseded: 'bg-zinc-600',
    pending: 'bg-zinc-700',
  }
  
  return (
    <div className={`p-3 sm:p-4 rounded-lg border overflow-hidden ${statusColors[status] || statusColors.pending}`}>
      <div className="flex justify-between items-start mb-2 gap-2">
        <div className="flex gap-1.5 items-center">
          <span className={`text-[10px] sm:text-xs px-1.5 sm:px-2 py-0.5 sm:py-1 rounded shrink-0 ${badgeColors[status] || badgeColors.pending}`}>
            {status.toUpperCase()}
          </span>
          {(template.version && template.version > 1) && (
            <span className="text-[10px] sm:text-xs px-1.5 py-0.5 rounded bg-blue-600/50 text-blue-200">
              v{template.version}
            </span>
          )}
        </div>
        <span className="text-[10px] sm:text-xs text-zinc-500">
          {(template.confidence * 100).toFixed(0)}%
        </span>
      </div>
      
      <h3 className="font-semibold text-zinc-200 mb-2 text-sm sm:text-base leading-snug break-words">{template.pattern}</h3>
      
      <blockquote className="border-l-2 border-zinc-600 pl-2 sm:pl-3 text-xs sm:text-sm text-zinc-400 mb-3 whitespace-pre-wrap break-words overflow-wrap-anywhere max-h-32 sm:max-h-48 overflow-y-auto overflow-x-hidden">
        {template.template}
      </blockquote>
      
      {vars.length > 0 && (
        <div className="text-[10px] sm:text-xs text-zinc-500 mb-2 sm:mb-3 flex flex-wrap gap-1">
          <span>Vars:</span>
          {vars.map((v, i) => (
            <code key={i} className="bg-zinc-800 px-1 rounded">
              {v.name}
            </code>
          ))}
        </div>
      )}
      
      <div className="text-[10px] sm:text-xs text-zinc-600 mb-2 sm:mb-3 truncate" title={template.source_subject}>
        {template.source_subject || 'N/A'}
      </div>
      
      {/* Show previous feedback if exists */}
      {template.feedback && (
        <div className="mb-3 p-2 bg-blue-950/30 rounded border border-blue-800/50">
          <div className="text-[10px] sm:text-xs text-blue-400 font-medium mb-1">💬 Previous feedback:</div>
          <div className="text-xs sm:text-sm text-zinc-300">{template.feedback}</div>
        </div>
      )}
      
      {/* Feedback input */}
      {showFeedback && (
        <div className="mb-3">
          <div className="text-[10px] sm:text-xs text-zinc-400 mb-1">
            💬 How should this be improved?
          </div>
          <textarea
            value={feedbackText}
            onChange={e => setFeedbackText(e.target.value)}
            placeholder='e.g., "shorter", "more empathy", "remove personal details"...'
            className="w-full bg-zinc-800 border border-zinc-600 rounded p-2 text-xs sm:text-sm text-zinc-200 placeholder-zinc-500 resize-none"
            rows={2}
            autoFocus
          />
        </div>
      )}
      
      {/* Actions - only show for pending/processing */}
      {(status === 'pending' || status === 'processing') && (
        <div className="flex gap-1.5 sm:gap-2">
          <button
            onClick={handleApprove}
            className="flex-1 px-2 py-1.5 rounded text-xs font-medium transition-colors bg-zinc-800 hover:bg-green-600 text-zinc-300 hover:text-white"
            title="Approve"
          >
            ✓
          </button>
          <button
            onClick={handleFeedback}
            className={`flex-1 px-2 py-1.5 rounded text-xs font-medium transition-colors ${
              showFeedback ? 'bg-blue-500 text-white' : 'bg-zinc-800 hover:bg-blue-600 text-zinc-300 hover:text-white'
            }`}
            title="Give feedback to improve"
          >
            {showFeedback ? 'Submit' : '💬'}
          </button>
          <button
            onClick={handleKill}
            className="flex-1 px-2 py-1.5 rounded text-xs font-medium transition-colors bg-zinc-800 hover:bg-red-600 text-zinc-300 hover:text-white"
            title="Kill (unsalvageable)"
          >
            🗑️
          </button>
          {showFeedback && (
            <button
              onClick={() => setShowFeedback(false)}
              className="px-2 py-1.5 rounded text-xs text-zinc-500"
            >
              ×
            </button>
          )}
        </div>
      )}
    </div>
  )
}

export default function App() {
  const [templates, setTemplates] = useState<Template[]>([])
  const [filter, setFilter] = useState<'all' | 'pending' | 'approved' | 'killed'>('pending')
  const [categoryFilter, setCategoryFilter] = useState<string>('all')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  
  const fetchTemplates = () => {
    fetch('/api/templates')
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then(data => {
        setTemplates(data.map((t: Template) => ({ ...t, status: t.status || 'pending' })))
        setLoading(false)
      })
      .catch(err => {
        console.error('Failed to load:', err)
        setError(err.message)
        setLoading(false)
      })
  }

  useEffect(() => {
    fetchTemplates()
    // Poll every 5s to catch worker updates
    const interval = setInterval(fetchTemplates, 5000)
    return () => clearInterval(interval)
  }, [])
  
  const handleAction = async (id: string, action: 'approve' | 'feedback' | 'kill', feedback?: string) => {
    // Optimistic update
    setTemplates(prev => prev.map(t => 
      t.id === id ? { 
        ...t, 
        status: action === 'approve' ? 'approved' : action === 'kill' ? 'killed' : 'processing',
        feedback: action === 'feedback' ? feedback : t.feedback
      } : t
    ))
    
    try {
      await fetch('/api/templates/' + id, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, feedback })
      })
    } catch (e) {
      console.error('Failed to update:', e)
      // Revert on error
      fetchTemplates()
    }
  }
  
  const categories = [...new Set(templates.map(t => t.category))].sort()
  
  const filtered = templates.filter(t => {
    // Hide superseded
    if (t.status === 'superseded') return false
    if (filter !== 'all' && t.status !== filter) return false
    if (categoryFilter !== 'all' && t.category !== categoryFilter) return false
    return true
  })
  
  const stats = {
    total: templates.filter(t => t.status !== 'superseded').length,
    approved: templates.filter(t => t.status === 'approved').length,
    killed: templates.filter(t => t.status === 'killed').length,
    pending: templates.filter(t => t.status === 'pending' || t.status === 'processing').length,
  }
  
  if (loading) {
    return <div className="min-h-screen p-8 text-center text-white">Loading templates...</div>
  }
  
  if (error) {
    return (
      <div className="min-h-screen p-8 text-center">
        <h1 className="text-2xl text-red-500 mb-4">Error loading templates</h1>
        <p className="text-zinc-400">{error}</p>
      </div>
    )
  }
  
  return (
    <div className="min-h-screen p-4 sm:p-6 lg:p-8">
      <header className="max-w-6xl mx-auto mb-6">
        <h1 className="text-2xl sm:text-3xl font-bold mb-4">📝 Template Review</h1>
        
        <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 mb-4">
          <div className="flex flex-wrap gap-1.5 sm:gap-2">
            {(['all', 'pending', 'approved', 'killed'] as const).map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-2 py-1 rounded text-[11px] sm:text-sm ${
                  filter === f 
                    ? f === 'killed' ? 'bg-red-600' : f === 'approved' ? 'bg-green-600' : 'bg-blue-600'
                    : 'bg-zinc-800 hover:bg-zinc-700'
                }`}
              >
                {f.charAt(0).toUpperCase() + f.slice(1)}
                {f !== 'all' && ` (${stats[f as keyof typeof stats]})`}
              </button>
            ))}
          </div>
          
          <select
            value={categoryFilter}
            onChange={e => setCategoryFilter(e.target.value)}
            className="bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-sm w-full sm:w-auto"
          >
            <option value="all">All Categories ({stats.total})</option>
            {categories.map(c => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
        
        <div className="text-xs sm:text-sm text-zinc-500">
          Showing {filtered.length} of {stats.total} templates
        </div>
      </header>
      
      <main className="max-w-6xl mx-auto">
        {filtered.length === 0 ? (
          <p className="text-zinc-500 text-center py-8">No templates match filters</p>
        ) : (
          <div className="grid gap-3 sm:gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map(template => (
              <TemplateCard
                key={template.id}
                template={template}
                onAction={handleAction}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  )
}
