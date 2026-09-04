import { ref } from 'vue'
import { defineStore } from 'pinia'

interface DocumentSnapshot {
  id: string
  arrayBuffer: ArrayBuffer
  timestamp: number
}

let sequence = 0

/**
 * The bytes behind the editor's undo stack.
 *
 * This store holds documents and nothing else; **which snapshot belongs to
 * which undo step is `editor.store.ts`'s business**, and every snapshot here is
 * addressed by the id `addSnapshot` returns. That is deliberate. There used to
 * be a `getLatestSnapshot(documentId)` and it is what made undo one level deep:
 * `undoLastEdit` popped its own history and left the snapshot in place, so the
 * second press handed back the same bytes as the first and the button looked
 * broken (features/0047). Anything shaped like "the newest snapshot for this
 * document" reintroduces that, so there is no such function any more.
 */
export const useDocumentSnapshotsStore = defineStore('documentSnapshots', () => {
  // State
  const snapshots = ref<DocumentSnapshot[]>([])

  // Actions

  /** Stores a copy of the bytes and returns the id that addresses them. */
  const addSnapshot = (documentId: string, arrayBuffer: ArrayBuffer): string => {
    // The document id is a prefix so `clearSnapshots(documentId)` still works;
    // the counter is what makes the id unique. `Date.now()` was not enough —
    // two edits inside the same millisecond produced one id for two snapshots.
    const id = `${documentId}-${Date.now()}-${sequence++}`

    snapshots.value.push({
      id,
      arrayBuffer: arrayBuffer.slice(0), // Create a copy
      timestamp: Date.now()
    })

    return id
  }

  const getSnapshotById = (snapshotId: string): ArrayBuffer | null => {
    const snapshot = snapshots.value.find(s => s.id === snapshotId)
    return snapshot ? snapshot.arrayBuffer.slice(0) : null // Return a copy
  }

  const removeSnapshotById = (snapshotId: string): void => {
    const index = snapshots.value.findIndex(s => s.id === snapshotId)
    if (index !== -1) {
      snapshots.value.splice(index, 1)
    }
  }

  const clearSnapshots = (documentId?: string): void => {
    if (documentId) {
      snapshots.value = snapshots.value.filter(s => !s.id.startsWith(documentId))
    } else {
      snapshots.value = []
    }
  }

  const getSnapshotsCount = (documentId: string): number => {
    return snapshots.value.filter(s => s.id.startsWith(documentId)).length
  }

  return {
    snapshots,
    addSnapshot,
    getSnapshotById,
    removeSnapshotById,
    clearSnapshots,
    getSnapshotsCount
  }
}, {
  persist: false
})
