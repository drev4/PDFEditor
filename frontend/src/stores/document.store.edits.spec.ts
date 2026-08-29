import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useDocumentStore } from './document.store'

/**
 * Edits made with the text and image tools are held in the browser until an
 * explicit save. This flag is the only thing that knows there is anything to
 * lose, so the editor's warning and its Save all button both hang off it.
 */
describe('document store — unsaved editor edits', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('starts clean', () => {
    expect(useDocumentStore().hasUnsavedEdits).toBe(false)
  })

  it('is dirty once an edit is recorded', () => {
    const store = useDocumentStore()

    store.markEdited()

    expect(store.hasUnsavedEdits).toBe(true)
  })

  it('stays dirty across several edits', () => {
    const store = useDocumentStore()

    store.markEdited()
    store.markEdited()

    expect(store.hasUnsavedEdits).toBe(true)
  })

  it('is clean again once the document has been saved', () => {
    const store = useDocumentStore()
    store.markEdited()

    store.markSaved()

    expect(store.hasUnsavedEdits).toBe(false)
  })
})
