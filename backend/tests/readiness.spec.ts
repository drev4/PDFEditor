import { beforeEach, describe, expect, it, vi } from 'vitest'

const queryRaw = vi.fn()
const queueReadiness = vi.fn()

vi.mock('../src/services/db.js', () => ({
  prisma: { $queryRaw: queryRaw }
}))

vi.mock('../src/services/embed-queue.js', () => ({
  embedQueueReadiness: queueReadiness
}))

vi.mock('../src/services/logger.js', () => ({
  logger: { error: vi.fn() }
}))

const { checkDatabaseReadiness, checkQueueReadiness } =
  await import('../src/services/readiness.js')

describe('dependency readiness checks', () => {
  beforeEach(() => vi.clearAllMocks())

  it('runs a real database query before reporting ok', async () => {
    queryRaw.mockResolvedValue([{ '?column?': 1 }])

    await expect(checkDatabaseReadiness()).resolves.toEqual({ status: 'ok' })
    expect(queryRaw).toHaveBeenCalledOnce()
  })

  it('turns a database exception into a safe unavailable state', async () => {
    queryRaw.mockRejectedValue(new Error('postgresql://user:password@private-db'))

    const result = await checkDatabaseReadiness()

    expect(result).toEqual({ status: 'unavailable' })
    expect(JSON.stringify(result)).not.toContain('password')
  })

  it('returns the queue state unchanged when Redis answers', async () => {
    queueReadiness.mockResolvedValue({ status: 'ok', workers: 1 })
    await expect(checkQueueReadiness()).resolves.toEqual({ status: 'ok', workers: 1 })
  })

  it('turns a Redis exception into a safe unavailable state', async () => {
    queueReadiness.mockRejectedValue(new Error('rediss://user:password@private-redis'))
    await expect(checkQueueReadiness()).resolves.toEqual({ status: 'unavailable' })
  })
})
