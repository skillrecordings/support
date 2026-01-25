/**
 * Health check for local eval environment
 */

import { createOllamaClient } from '@skillrecordings/core/adapters/ollama'
import { createQdrantClient } from '@skillrecordings/core/adapters/qdrant'

interface HealthResult {
  service: string
  healthy: boolean
  message: string
}

interface HealthOptions {
  json?: boolean
}

export async function health(options: HealthOptions): Promise<void> {
  const results: HealthResult[] = []

  // Check MySQL
  const mysqlResult = await checkMySQL()
  results.push(mysqlResult)

  // Check Redis
  const redisResult = await checkRedis()
  results.push(redisResult)

  // Check Qdrant
  const qdrantResult = await checkQdrant()
  results.push(qdrantResult)

  // Check Ollama
  const ollamaResult = await checkOllama()
  results.push(ollamaResult)

  if (options.json) {
    const allHealthy = results.every((r) => r.healthy)
    console.log(
      JSON.stringify({ healthy: allHealthy, services: results }, null, 2)
    )
    process.exit(allHealthy ? 0 : 1)
  }

  // Pretty print results
  console.log('\n🏥 Local Eval Environment Health Check\n')

  for (const result of results) {
    const icon = result.healthy ? '✅' : '❌'
    console.log(`${icon} ${result.service}: ${result.message}`)
  }

  const allHealthy = results.every((r) => r.healthy)
  console.log(
    `\n${allHealthy ? '✅ All services healthy' : '❌ Some services unhealthy'}\n`
  )

  if (!allHealthy) {
    console.log(
      '💡 Tip: Run `docker compose -f docker/eval.yml up -d` to start services\n'
    )
    process.exit(1)
  }
}

async function checkMySQL(): Promise<HealthResult> {
  try {
    // Use mysql2 directly for health check
    const mysql = await import('mysql2/promise')
    const connection = await mysql.createConnection({
      host: 'localhost',
      port: 3306,
      user: 'eval_user',
      password: 'eval_pass',
      database: 'support_eval',
      connectTimeout: 5000,
    })

    const [rows] = await connection.execute('SELECT 1')
    await connection.end()

    return {
      service: 'MySQL',
      healthy: true,
      message: 'Connected to support_eval database',
    }
  } catch (error) {
    return {
      service: 'MySQL',
      healthy: false,
      message: error instanceof Error ? error.message : 'Connection failed',
    }
  }
}

async function checkRedis(): Promise<HealthResult> {
  try {
    const response = await fetch('http://localhost:6379', {
      method: 'GET',
      signal: AbortSignal.timeout(5000),
    }).catch(() => null)

    // Redis doesn't speak HTTP, so we'll use a simple TCP check
    // For now, just check if something is listening
    const net = await import('net')

    return new Promise((resolve) => {
      const socket = new net.Socket()
      socket.setTimeout(5000)

      socket.on('connect', () => {
        socket.write('PING\r\n')
      })

      socket.on('data', (data) => {
        const response = data.toString()
        socket.destroy()
        if (response.includes('PONG')) {
          resolve({
            service: 'Redis',
            healthy: true,
            message: 'Redis responding to PING',
          })
        } else {
          resolve({
            service: 'Redis',
            healthy: false,
            message: 'Unexpected response',
          })
        }
      })

      socket.on('timeout', () => {
        socket.destroy()
        resolve({
          service: 'Redis',
          healthy: false,
          message: 'Connection timeout',
        })
      })

      socket.on('error', (err) => {
        socket.destroy()
        resolve({
          service: 'Redis',
          healthy: false,
          message: err.message,
        })
      })

      socket.connect(6379, 'localhost')
    })
  } catch (error) {
    return {
      service: 'Redis',
      healthy: false,
      message: error instanceof Error ? error.message : 'Connection failed',
    }
  }
}

async function checkQdrant(): Promise<HealthResult> {
  try {
    const client = createQdrantClient()
    const info = await client.getCollectionInfo()

    return {
      service: 'Qdrant',
      healthy: true,
      message:
        info.status === 'not_found'
          ? 'Running (collection not yet created)'
          : `Collection has ${info.pointsCount} points`,
    }
  } catch (error) {
    return {
      service: 'Qdrant',
      healthy: false,
      message: error instanceof Error ? error.message : 'Connection failed',
    }
  }
}

async function checkOllama(): Promise<HealthResult> {
  try {
    const client = createOllamaClient()
    const healthy = await client.healthCheck()

    if (!healthy) {
      return {
        service: 'Ollama',
        healthy: false,
        message: 'Not responding',
      }
    }

    const modelAvailable = await client.isModelAvailable()
    return {
      service: 'Ollama',
      healthy: true,
      message: modelAvailable
        ? `Model ${process.env.EMBEDDING_MODEL || 'nomic-embed-text'} available`
        : `Running but model needs to be pulled (run: ollama pull nomic-embed-text)`,
    }
  } catch (error) {
    return {
      service: 'Ollama',
      healthy: false,
      message: error instanceof Error ? error.message : 'Connection failed',
    }
  }
}
