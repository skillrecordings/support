import { spawn, execSync } from 'child_process'
import Database from 'duckdb'
import crypto from 'crypto'
import { createSwarmQueue } from '/home/joel/Code/joelhooks/swarm-tools/packages/swarm-queue/src/index'

const DB_PATH = '../ralph-gold-data/gold.duckdb'
const QUEUE_NAME = 'template-review'

// Start Vite dev server
const vite = spawn('bunx', ['vite', '--host', '0.0.0.0'], {
  stdio: 'inherit',
  env: { ...process.env }
})

// Queue client (lazy init)
let queue: Awaited<ReturnType<typeof createSwarmQueue>> | null = null

async function getQueue() {
  if (!queue) {
    queue = createSwarmQueue({
      name: QUEUE_NAME,
      connection: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379', 10),
      },
    })
  }
  return queue
}

// API server
Bun.serve({
  port: 3458,
  async fetch(req) {
    const url = new URL(req.url)
    
    const headers = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, PATCH, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Content-Type': 'application/json',
    }
    
    if (req.method === 'OPTIONS') {
      return new Response(null, { headers })
    }
    
    // GET /api/templates - list all (latest versions only)
    if (url.pathname === '/api/templates' && req.method === 'GET') {
      const db = new Database.Database(DB_PATH)
      const conn = db.connect()
      
      const rows = await new Promise((res, rej) => {
        conn.all(`
          WITH latest AS (
            SELECT conversation_id, MAX(version) as max_version
            FROM templates
            GROUP BY conversation_id
          )
          SELECT t.id, t.category, t.pattern, t.template, t.variables, 
                 t.confidence, t.version, t.parent_id,
                 COALESCE(c.subject, t.source, 'Unknown') as source_subject,
                 COALESCE(t.status, 'pending') as status,
                 t.steering as feedback
          FROM templates t
          LEFT JOIN conversations c ON t.conversation_id = c.id
          LEFT JOIN latest l ON t.conversation_id = l.conversation_id AND t.version = l.max_version
          WHERE l.conversation_id IS NOT NULL OR t.parent_id IS NULL
          ORDER BY t.category, t.confidence DESC
        `, (err, rows) => err ? rej(err) : res(rows))
      })
      
      conn.close()
      db.close()
      
      return new Response(JSON.stringify(rows), { headers })
    }

    // GET /api/templates/:id/history - version history
    if (url.pathname.match(/\/api\/templates\/[^/]+\/history/) && req.method === 'GET') {
      const id = url.pathname.split('/')[3]
      const db = new Database.Database(DB_PATH)
      const conn = db.connect()
      
      // Walk up the parent chain
      const history = await new Promise((res, rej) => {
        conn.all(`
          WITH RECURSIVE chain AS (
            SELECT * FROM templates WHERE id = ?
            UNION ALL
            SELECT t.* FROM templates t
            JOIN chain c ON t.id = c.parent_id
          )
          SELECT id, version, template, steering, status, parent_id
          FROM chain
          ORDER BY version DESC
        `, id, (err, rows) => err ? rej(err) : res(rows))
      })
      
      conn.close()
      db.close()
      
      return new Response(JSON.stringify(history), { headers })
    }
    
    // PATCH /api/templates/:id
    if (url.pathname.startsWith('/api/templates/') && !url.pathname.includes('/history') && req.method === 'PATCH') {
      const id = url.pathname.split('/').pop()
      const body = await req.json() as { action: 'approve' | 'feedback' | 'kill', feedback?: string }
      
      console.log(`PATCH ${id}:`, body)
      
      const db = new Database.Database(DB_PATH)
      const conn = db.connect()
      
      // Get current template
      const current = await new Promise<any>((res, rej) => {
        conn.all(`SELECT * FROM templates WHERE id = ?`, id, (err, rows) => err ? rej(err) : res(rows?.[0]))
      })
      
      if (!current) {
        conn.close()
        db.close()
        return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers })
      }

      let queued = false
      
      if (body.action === 'approve') {
        // Mark as approved
        await new Promise((res, rej) => {
          conn.run(`UPDATE templates SET status = 'approved' WHERE id = ?`, id,
            (err) => err ? rej(err) : res(null))
        })
        
        // Notify
        try {
          execSync(`moltbot message send --channel telegram --target [PHONE] --message "✅ Template approved"`, { stdio: 'pipe' })
        } catch (e) {}
        
      } else if (body.action === 'kill') {
        // Mark as killed (permanently rejected)
        await new Promise((res, rej) => {
          conn.run(`UPDATE templates SET status = 'killed' WHERE id = ?`, id,
            (err) => err ? rej(err) : res(null))
        })
        
        // Notify
        try {
          execSync(`moltbot message send --channel telegram --target [PHONE] --message "🗑️ Template killed"`, { stdio: 'pipe' })
        } catch (e) {}
        
      } else if (body.action === 'feedback' && body.feedback) {
        // Submit regeneration job
        try {
          const q = await getQueue()
          const traceId = crypto.randomUUID()
          
          await q.addJob('template.regenerate', {
            templateId: id,
            currentTemplate: current.template,
            steering: body.feedback,
            pattern: current.pattern,
            category: current.category,
            conversationId: current.conversation_id,
            variables: current.variables,
            confidence: current.confidence,
            source: current.source,
            traceId,
          })
          
          // Mark as processing
          await new Promise((res, rej) => {
            conn.run(`UPDATE templates SET status = 'processing', steering = ? WHERE id = ?`, 
              body.feedback, id,
              (err) => err ? rej(err) : res(null))
          })
          
          queued = true
          console.log(`Submitted regeneration job: ${traceId}`)
          
          // Notify
          try {
            execSync(`moltbot message send --channel telegram --target [PHONE] --message "💬 Feedback submitted, regenerating..."`, { stdio: 'pipe' })
          } catch (e) {}
        } catch (e) {
          console.error('Queue submission failed:', e)
        }
      }
      
      conn.close()
      db.close()
      
      return new Response(JSON.stringify({ 
        success: true, 
        queued,
        action: body.action
      }), { headers })
    }
    
    return new Response('Not found', { status: 404, headers })
  }
})

console.log('API server running at http://localhost:3458')
console.log('Vite dev server starting on http://localhost:3457')

process.on('SIGINT', () => {
  vite.kill()
  process.exit()
})
