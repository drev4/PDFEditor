import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useFormFieldsStore, isLocalFieldId, type FormField } from './formFields.store'
import { setupPinia } from '../test/helpers/pinia-setup'

vi.mock('../services/fields')

/**
 * Selecting more than one field, and what can be done to a set (features/0048).
 *
 * The invariant these tests pin down: `selectedFieldId` is the field whose
 * properties the panel shows, and it is always a member of `selectedFieldIds`
 * when that is non-empty. Every path that changes a selection goes through one
 * helper for exactly that reason.
 */

const aField = (id: string, x = 10, y = 10, page = 1): FormField => ({
  id,
  type: 'text',
  name: `name_${id}`,
  label: `Label ${id}`,
  required: false,
  border: false,
  position: { x, y, width: 100, height: 20, page }
})

describe('Field selection', () => {
  let store: ReturnType<typeof useFormFieldsStore>

  beforeEach(() => {
    setupPinia()
    store = useFormFieldsStore()
    store.setCurrentForm('form-1')
    store.loadFieldsFromForm([aField('f1'), aField('f2', 200), aField('f3', 400)] as never[])
  })

  it('selects one field and keeps the two views of the selection in step', () => {
    store.selectField('f1')

    expect(store.selectedFieldId).toBe('f1')
    expect(store.selectedFieldIds).toEqual(['f1'])
    expect(store.hasMultiSelection).toBe(false)
  })

  it('adds a second field with toggle, and the primary follows the last one added', () => {
    store.selectField('f1')
    store.toggleFieldSelection('f2')

    expect(store.selectedFieldIds).toEqual(['f1', 'f2'])
    expect(store.selectedFieldId).toBe('f2')
    expect(store.hasMultiSelection).toBe(true)
    expect(store.isFieldSelected('f1')).toBe(true)
  })

  it('toggles a field back out, and never leaves a primary outside the selection', () => {
    store.selectFields(['f1', 'f2'])
    store.toggleFieldSelection('f2')

    expect(store.selectedFieldIds).toEqual(['f1'])
    expect(store.selectedFieldId).toBe('f1')
  })

  it('clears the primary when the last field is toggled out', () => {
    store.selectField('f1')
    store.toggleFieldSelection('f1')

    expect(store.selectedFieldIds).toEqual([])
    expect(store.selectedFieldId).toBeNull()
  })

  it('replaces the selection when a plain select follows a multi-selection', () => {
    store.selectFields(['f1', 'f2'])
    store.selectField('f3')

    expect(store.selectedFieldIds).toEqual(['f3'])
  })

  // Aligning a field on page 1 with one on page 3 means nothing, and a
  // selection that spans pages is only reachable from the panel's layer list.
  it('does not extend a selection across pages', () => {
    store.loadFieldsFromForm([aField('p1'), aField('p3', 10, 10, 3)] as never[])
    store.selectField('p1')
    store.toggleFieldSelection('p3')

    expect(store.selectedFieldIds).toEqual(['p3'])
  })

  it('drops a deleted field from the selection', () => {
    store.selectFields(['f1', 'f2'])
    store.deleteField('f2')

    expect(store.selectedFieldIds).toEqual(['f1'])
    expect(store.selectedFieldId).toBe('f1')
  })

  it('drops ids that name nothing when a snapshot is restored', () => {
    store.selectFields(['f1', 'f2'])

    store.restoreFieldsSnapshot([aField('f1')], 'f1')

    expect(store.selectedFieldIds).toEqual(['f1'])
  })
})

describe('moveFieldsBy', () => {
  let store: ReturnType<typeof useFormFieldsStore>

  beforeEach(() => {
    setupPinia()
    store = useFormFieldsStore()
    store.setCurrentForm('form-1')
    store.loadFieldsFromForm([aField('f1', 100, 50), aField('f2', 300, 90)] as never[])
  })

  it('moves every field by the same delta', () => {
    store.moveFieldsBy(['f1', 'f2'], 10, -5)

    expect(store.fields[0]?.position).toMatchObject({ x: 110, y: 45 })
    expect(store.fields[1]?.position).toMatchObject({ x: 310, y: 85 })
  })

  // Clamping each field on its own would squash the layout the author built:
  // the one at the edge stops and the rest keep going. The delta is clamped
  // instead, so the set moves as a set or not at all.
  it('clamps the delta, not the fields, at the edge of the page', () => {
    store.moveFieldsBy(['f1', 'f2'], -200, 0)

    expect(store.fields[0]?.position.x).toBe(0)
    expect(store.fields[1]?.position.x).toBe(200)
  })
})

describe('duplicateFields', () => {
  let store: ReturnType<typeof useFormFieldsStore>

  beforeEach(() => {
    setupPinia()
    store = useFormFieldsStore()
    store.setCurrentForm('form-1')
    store.loadFieldsFromForm([aField('server-1'), aField('server-2', 200)] as never[])
  })

  /**
   * The trap this whole action exists to avoid.
   *
   * `saveAllFields` sends `id` for every field whose id is not local, so two
   * payload entries carrying the same server id are two updates to one row —
   * the second overwrites the first and one of the two fields is never created,
   * with a `200` and nothing in any log.
   */
  it('gives every copy a new local id', () => {
    const copies = store.duplicateFields(['server-1', 'server-2'])

    expect(copies).toHaveLength(2)
    expect(copies.every(f => isLocalFieldId(f.id))).toBe(true)
    expect(new Set(store.fields.map(f => f.id)).size).toBe(4)
  })

  it('gives every copy a name no other field is using', () => {
    store.duplicateFields(['server-1', 'server-2'])

    const names = store.fields.map(f => f.name)
    expect(new Set(names).size).toBe(names.length)
  })

  it('offsets the copy so it is not hidden under the original', () => {
    const [copy] = store.duplicateFields(['server-1'])

    expect(copy?.position.x).toBeGreaterThan(10)
    expect(copy?.position.y).toBeGreaterThan(10)
    expect(copy?.position.page).toBe(1)
  })

  it('copies the options array rather than sharing it', () => {
    store.loadFieldsFromForm([
      { ...aField('server-3'), type: 'dropdown', options: ['A', 'B'] }
    ] as never[])

    const [copy] = store.duplicateFields(['server-3'])
    copy!.options!.push('C')

    expect(store.fields[0]?.options).toEqual(['A', 'B'])
  })

  it('selects the copies and marks the form dirty', () => {
    const copies = store.duplicateFields(['server-1', 'server-2'])

    expect(store.selectedFieldIds).toEqual(copies.map(f => f.id))
    expect(store.hasUnsavedChanges).toBe(true)
  })

  it('sends the copies as creations and the originals as updates', () => {
    store.duplicateFields(['server-1'])

    const payload = store.fields.map(f => (isLocalFieldId(f.id) ? {} : { id: f.id }))
    expect(payload.filter(p => 'id' in p)).toHaveLength(2)
    expect(payload.filter(p => !('id' in p))).toHaveLength(1)
  })
})
