import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useDocumentSnapshotsStore } from './snapshots.store'

describe('Document Snapshots Store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  const createMockArrayBuffer = () => {
    return new Uint8Array([1, 2, 3, 4, 5]).buffer
  }

  describe('addSnapshot', () => {
    it('should add snapshot', () => {
      const store = useDocumentSnapshotsStore()
      const buffer = createMockArrayBuffer()

      store.addSnapshot('doc-1', buffer)

      expect(store.snapshots).toHaveLength(1)
      expect(store.snapshots[0]?.id).toContain('doc-1')
    })

    it('should limit snapshots to maxSnapshots', () => {
      const store = useDocumentSnapshotsStore()

      for (let i = 0; i < 12; i++) {
        store.addSnapshot('doc-1', createMockArrayBuffer())
      }

      expect(store.snapshots).toHaveLength(store.maxSnapshots)
    })

    it('should create copy of buffer', () => {
      const store = useDocumentSnapshotsStore()
      const buffer = createMockArrayBuffer()

      store.addSnapshot('doc-1', buffer)

      expect(store.snapshots[0]?.arrayBuffer).not.toBe(buffer)
    })
  })

  describe('getLatestSnapshot', () => {
    it('should return latest snapshot', () => {
      const store = useDocumentSnapshotsStore()
      const buffer1 = createMockArrayBuffer()
      const buffer2 = new Uint8Array([6, 7, 8]).buffer

      store.addSnapshot('doc-1', buffer1)
      store.addSnapshot('doc-1', buffer2)

      const latest = store.getLatestSnapshot('doc-1')

      expect(latest).toBeDefined()
      expect(new Uint8Array(latest!)).toEqual(new Uint8Array(buffer2))
    })

    it('should return null if no snapshots', () => {
      const store = useDocumentSnapshotsStore()

      const result = store.getLatestSnapshot('doc-1')

      expect(result).toBeNull()
    })

    it('should return copy of buffer', () => {
      const store = useDocumentSnapshotsStore()
      store.addSnapshot('doc-1', createMockArrayBuffer())

      const snapshot = store.getLatestSnapshot('doc-1')

      expect(snapshot).not.toBe(store.snapshots[0]?.arrayBuffer)
    })
  })

  describe('removeSnapshot', () => {
    it('should remove first matching snapshot', () => {
      const store = useDocumentSnapshotsStore()
      store.addSnapshot('doc-1', createMockArrayBuffer())
      store.addSnapshot('doc-2', createMockArrayBuffer())

      store.removeSnapshot('doc-1')

      expect(store.snapshots).toHaveLength(1)
      expect(store.snapshots[0]?.id).toContain('doc-2')
    })
  })

  describe('clearSnapshots', () => {
    it('should clear all snapshots when no documentId', () => {
      const store = useDocumentSnapshotsStore()
      store.addSnapshot('doc-1', createMockArrayBuffer())
      store.addSnapshot('doc-2', createMockArrayBuffer())

      store.clearSnapshots()

      expect(store.snapshots).toHaveLength(0)
    })

    it('should clear specific document snapshots', () => {
      const store = useDocumentSnapshotsStore()
      store.addSnapshot('doc-1', createMockArrayBuffer())
      store.addSnapshot('doc-2', createMockArrayBuffer())

      store.clearSnapshots('doc-1')

      expect(store.snapshots).toHaveLength(1)
      expect(store.snapshots[0]?.id).toContain('doc-2')
    })
  })

  describe('getSnapshotsCount', () => {
    it('should count snapshots for document', () => {
      const store = useDocumentSnapshotsStore()
      store.addSnapshot('doc-1', createMockArrayBuffer())
      store.addSnapshot('doc-1', createMockArrayBuffer())
      store.addSnapshot('doc-2', createMockArrayBuffer())

      expect(store.getSnapshotsCount('doc-1')).toBe(2)
      expect(store.getSnapshotsCount('doc-2')).toBe(1)
    })
  })
})
