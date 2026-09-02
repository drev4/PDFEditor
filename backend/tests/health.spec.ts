import express from 'express'
import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const databaseCheck = vi.fn()
const queueCheck = vi.fn()

vi.mock('../src/services/readiness.js', () => ({
  checkDatabaseReadiness: databaseCheck,
  checkQueueReadiness: queueCheck
}))

const { healthRouter } = await import('../src/routes/health.js')

function testApp() {
  const app = express()
  app.use('/health', healthRouter)
  return app
}

describe('health endpoints', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    databaseCheck.mockResolvedValue({ status: 'ok' })
    queueCheck.mockResolvedValue({ status: 'disabled' })
  })

  it('keeps liveness independent from dependencies', async () => {
    databaseCheck.mockRejectedValue(new Error('database is down'))

    const response = await request(testApp()).get('/health/live')

    expect(response.status).toBe(200)
    expect(response.body.status).toBe('ok')
    expect(databaseCheck).not.toHaveBeenCalled()
  })

  it('is ready when the database is available and the queue is disabled', async () => {
    const response = await request(testApp()).get('/health/ready')

    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({
      status: 'ready',
      checks: { database: { status: 'ok' }, queue: { status: 'disabled' } }
    })
  })

  it('reports not ready without leaking a database error', async () => {
    databaseCheck.mockResolvedValue({ status: 'unavailable' })

    const response = await request(testApp()).get('/health/ready')

    expect(response.status).toBe(503)
    expect(response.body).toMatchObject({
      status: 'not_ready',
      checks: { database: { status: 'unavailable' } }
    })
    expect(JSON.stringify(response.body)).not.toContain('password')
  })

  it('reports not ready when Redis cannot be inspected', async () => {
    queueCheck.mockResolvedValue({ status: 'unavailable' })

    const response = await request(testApp()).get('/health/ready')

    expect(response.status).toBe(503)
    expect(response.body.checks.queue.status).toBe('unavailable')
  })

  it('reports not ready when Redis is configured but no worker is registered', async () => {
    queueCheck.mockResolvedValue({
      status: 'no_workers', workers: 0, waiting: 2, active: 0, delayed: 0, failed: 0
    })

    const response = await request(testApp()).get('/health/ready')

    expect(response.status).toBe(503)
    expect(response.body.checks.queue).toMatchObject({ status: 'no_workers', workers: 0, waiting: 2 })
  })

  it('keeps GET /health as the liveness compatibility alias', async () => {
    const response = await request(testApp()).get('/health')

    expect(response.status).toBe(200)
    expect(response.body.status).toBe('ok')
  })
})
