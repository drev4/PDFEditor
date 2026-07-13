import { ref } from 'vue'
import { defineStore } from 'pinia'

interface DocumentSnapshot {
  id: string
  arrayBuffer: ArrayBuffer
  timestamp: number
}

export const useDocumentSnapshotsStore = defineStore('documentSnapshots', () => {
  // State
  const snapshots = ref<DocumentSnapshot[]>([])
  const maxSnapshots = 10

  // Actions
  const addSnapshot = (documentId: string, arrayBuffer: ArrayBuffer): void => {
    const snapshot: DocumentSnapshot = {
      id: `${documentId}-${Date.now()}`,
      arrayBuffer: arrayBuffer.slice(0), // Create a copy
      timestamp: Date.now()
    }

    snapshots.value.push(snapshot)

    // Keep only the latest snapshots
    if (snapshots.value.length > maxSnapshots) {
      snapshots.value.shift()
    }
  }

  const getLatestSnapshot = (documentId: string): ArrayBuffer | null => {
    const documentSnapshots = snapshots.value.filter(s => s.id.startsWith(documentId))
    if (documentSnapshots.length === 0) return null

    const latest = documentSnapshots[documentSnapshots.length - 1]
    if (!latest) return null
    
    return latest.arrayBuffer.slice(0) // Return a copy
  }

  const removeSnapshot = (documentId: string): void => {
    const index = snapshots.value.findIndex(s => s.id.startsWith(documentId))
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
    maxSnapshots,
    addSnapshot,
    getLatestSnapshot,
    removeSnapshot,
    clearSnapshots,
    getSnapshotsCount
  }
}, {
  persist: false
})