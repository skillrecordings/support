/**
 * Generate template quality report
 */
import fs from 'fs'
import path from 'path'
import Database from 'duckdb'

const DB_PATH = path.resolve('gold.duckdb')
const MD_OUTPUT = path.resolve('reports/template-quality.md')
const JSON_OUTPUT = path.resolve('reports/template-quality.json')

interface TemplateRow {
  id: string
  pattern: string
  template: string
  variables: string | object
  category: string
  confidence: number
  source: string | null
}

interface CategoryStats {
  category: string
  count: number
  avgConfidence: number
  withVariables: number
  samples: Array<{ pattern: string; template: string; confidence: number }>
}

function parseVariables(raw: string | object): string[] {
  try {
    const arr = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (!Array.isArray(arr)) return []
    return arr.map(v => v.name || 'unknown')
  } catch {
    return []
  }
}

async function main(): Promise<void> {
  console.log('=== Generate Template Quality Report ===\n')
  
  const db = new Database.Database(DB_PATH)
  const connection = db.connect()
  
  const rows = await new Promise<TemplateRow[]>((resolve, reject) => {
    connection.all(
      `SELECT id, pattern, template, variables, category, confidence, source FROM templates ORDER BY category, confidence DESC`,
      (err, rows) => {
        if (err) reject(err)
        else resolve(rows as TemplateRow[])
      }
    )
  })
  
  console.log(`Processing ${rows.length} templates`)
  
  // Group by category
  const byCategory = new Map<string, TemplateRow[]>()
  for (const row of rows) {
    if (!byCategory.has(row.category)) {
      byCategory.set(row.category, [])
    }
    byCategory.get(row.category)!.push(row)
  }
  
  // Calculate stats
  const stats: CategoryStats[] = []
  const variableUsage = new Map<string, number>()
  const confidenceBuckets = { high: 0, medium: 0, low: 0 }
  const unclearTemplates: Array<{ id: string; pattern: string; issues: string[] }> = []
  
  for (const [category, templates] of byCategory) {
    const avgConfidence = templates.reduce((sum, t) => sum + t.confidence, 0) / templates.length
    const withVars = templates.filter(t => parseVariables(t.variables).length > 0).length
    
    // Track variable usage
    for (const t of templates) {
      for (const varName of parseVariables(t.variables)) {
        variableUsage.set(varName, (variableUsage.get(varName) || 0) + 1)
      }
    }
    
    // Confidence distribution
    for (const t of templates) {
      if (t.confidence >= 0.9) confidenceBuckets.high++
      else if (t.confidence >= 0.7) confidenceBuckets.medium++
      else confidenceBuckets.low++
    }
    
    // Check for unclear templates
    for (const t of templates) {
      const issues: string[] = []
      const vars = parseVariables(t.variables)
      
      // Check for undefined/unknown variables
      if (vars.some(v => v.includes('undefined') || v === 'unknown')) {
        issues.push('Contains undefined/unknown variable')
      }
      
      // Check for very short templates
      if (t.template.length < 50) {
        issues.push('Template too short (<50 chars)')
      }
      
      // Check for missing pattern
      if (t.pattern.length < 10) {
        issues.push('Pattern description too vague')
      }
      
      if (issues.length > 0) {
        unclearTemplates.push({ id: t.id, pattern: t.pattern, issues })
      }
    }
    
    stats.push({
      category,
      count: templates.length,
      avgConfidence: Math.round(avgConfidence * 100) / 100,
      withVariables: withVars,
      samples: templates.slice(0, 3).map(t => ({
        pattern: t.pattern,
        template: t.template.slice(0, 200) + (t.template.length > 200 ? '...' : ''),
        confidence: t.confidence
      }))
    })
  }
  
  // Sort by count
  stats.sort((a, b) => b.count - a.count)
  
  // Generate Markdown
  const mdLines: string[] = [
    '# Template Quality Report',
    '',
    `Generated: ${new Date().toISOString()}`,
    `Total Templates: ${rows.length}`,
    '',
    '## Summary by Category',
    '',
    '| Category | Count | Avg Confidence | With Variables |',
    '|----------|-------|----------------|----------------|',
  ]
  
  for (const s of stats) {
    mdLines.push(`| ${s.category} | ${s.count} | ${(s.avgConfidence * 100).toFixed(0)}% | ${s.withVariables} |`)
  }
  
  mdLines.push('')
  mdLines.push('## Confidence Distribution')
  mdLines.push('')
  mdLines.push(`- High (≥90%): ${confidenceBuckets.high}`)
  mdLines.push(`- Medium (70-89%): ${confidenceBuckets.medium}`)
  mdLines.push(`- Low (<70%): ${confidenceBuckets.low}`)
  mdLines.push('')
  
  mdLines.push('## Variable Usage')
  mdLines.push('')
  const sortedVars = [...variableUsage.entries()].sort((a, b) => b[1] - a[1])
  for (const [varName, count] of sortedVars) {
    mdLines.push(`- \`{{${varName}}}\`: ${count} templates`)
  }
  mdLines.push('')
  
  mdLines.push('## Sample Templates (Top 3 per Category)')
  mdLines.push('')
  for (const s of stats) {
    mdLines.push(`### ${s.category}`)
    mdLines.push('')
    for (const sample of s.samples) {
      mdLines.push(`**Pattern:** ${sample.pattern}`)
      mdLines.push('')
      mdLines.push(`> ${sample.template.replace(/\n/g, '\n> ')}`)
      mdLines.push('')
      mdLines.push(`Confidence: ${(sample.confidence * 100).toFixed(0)}%`)
      mdLines.push('')
      mdLines.push('---')
      mdLines.push('')
    }
  }
  
  if (unclearTemplates.length > 0) {
    mdLines.push('## Templates Needing Review')
    mdLines.push('')
    for (const t of unclearTemplates) {
      mdLines.push(`- **${t.pattern}**: ${t.issues.join(', ')}`)
    }
    mdLines.push('')
  }
  
  // Write Markdown
  fs.writeFileSync(MD_OUTPUT, mdLines.join('\n'))
  console.log(`Wrote ${MD_OUTPUT}`)
  
  // Generate JSON
  const jsonReport = {
    generatedAt: new Date().toISOString(),
    totalTemplates: rows.length,
    categories: stats,
    confidenceDistribution: confidenceBuckets,
    variableUsage: Object.fromEntries(variableUsage),
    templatesNeedingReview: unclearTemplates
  }
  
  fs.writeFileSync(JSON_OUTPUT, JSON.stringify(jsonReport, null, 2))
  console.log(`Wrote ${JSON_OUTPUT}`)
  
  connection.close()
  db.close()
  
  console.log('\n✅ Report generation complete!')
}

main().catch(err => {
  console.error(err)
  process.exitCode = 1
})
