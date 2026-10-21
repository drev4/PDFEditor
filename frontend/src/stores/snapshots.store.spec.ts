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

    it('should give every snapshot its own id, even within one millisecond', () => {
      const store = useDocumentSnapshotsStore()

      for (let i = 0; i < 12; i++) {
        store.addSnapshot('doc-1', createMockArrayBuffer())
      }

      // The stack in editor.store.ts addresses bytes by this id and caps its own
      // length; a repeated id would make it release somebody else's snapshot.
      expect(new Set(store.snapshots.map(s => s.id)).size).toBe(12)
    })

    it('should create copy of buffer', () => {
      const store = useDocumentSnapshotsStore()
      const buffer = createMockArrayBuffer()

      store.addSnapshot('doc-1', buffer)

      expect(store.snapshots[0]?.arrayBuffer).not.toBe(buffer)
    })
  })

  describe('getSnapshotById', () => {
    it('should return the snapshot that id names, not the newest', () => {
      const store = useDocumentSnapshotsStore()
      const buffer1 = createMockArrayBuffer()
      const buffer2 = new Uint8Array([6, 7, 8]).buffer

      const first = store.addSnapshot('doc-1', buffer1)
      store.addSnapshot('doc-1', buffer2)

      const restored = store.getSnapshotById(first)

      expect(new Uint8Array(restored!)).toEqual(new Uint8Array(buffer1))
    })

    it('should return null for an id it does not hold', () => {
      const store = useDocumentSnapshotsStore()

      expect(store.getSnapshotById('doc-1-nothing')).toBeNull()
    })

    it('should return copy of buffer', () => {
      const store = useDocumentSnapshotsStore()
      const id = store.addSnapshot('doc-1', createMockArrayBuffer())

      const snapshot = store.getSnapshotById(id)

      expect(snapshot).not.toBe(store.snapshots[0]?.arrayBuffer)
    })
  })

  describe('removeSnapshotById', () => {
    it('should remove the snapshot that id names', () => {
      const store = useDocumentSnapshotsStore()
      const first = store.addSnapshot('doc-1', createMockArrayBuffer())
      store.addSnapshot('doc-1', createMockArrayBuffer())

      store.removeSnapshotById(first)

      expect(store.snapshots).toHaveLength(1)
      expect(store.snapshots[0]?.id).not.toBe(first)
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
