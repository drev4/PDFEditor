import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useFormFieldsStore, type FormField } from './formFields.store'
import { fieldsService } from '../services/fields'
import { setupPinia } from '../test/helpers/pinia-setup'

vi.mock('../services/fields')

/**
 * Removing a whole selection (features/0050).
 *
 * What this pins down is not "the request was sent" but the three decisions
 * around it: the fields that never left the browser are not in the request, the
 * local list is only changed once the server has committed, and the server's
 * split between archived and deleted is handed back rather than swallowed —
 * the caller needs it to build one undo entry and one message.
 */

const aField = (id: string): FormField => ({
  id,
  type: 'text',
  name: `name_${id}`,
  label: `Label ${id}`,
  required: false,
  border: false,
  position: { x: 10, y: 10, width: 100, height: 20, page: 1 }
})

describe('deleteFieldsFromServer', () => {
  let store: ReturnType<typeof useFormFieldsStore>

  beforeEach(() => {
    setupPinia()
    vi.clearAllMocks()
    store = useFormFieldsStore()
    store.setCurrentForm('form-1')
  })

  it('sends every selected field in one request and drops them all locally', async () => {
    store.loadFieldsFromForm([aField('f1'), aField('f2'), aField('f3')] as never[])
    vi.mocked(fieldsService.deleteMany).mockResolvedValue({
      archived: [{ id: 'f1', answerCount: 3 }],
      deleted: ['f2']
    })
    vi.mocked(fieldsService.listArchived).mockResolvedValue([])

    const result = await store.deleteFieldsFromServer(['f1', 'f2'])

    expect(fieldsService.deleteMany).toHaveBeenCalledTimes(1)
    expect(fieldsService.deleteMany).toHaveBeenCalledWith('form-1', ['f1', 'f2'])
    expect(store.fields.map(f => f.id)).toEqual(['f3'])
    expect(result).toEqual({
      archived: [{ id: 'f1', answerCount: 3 }],
      deleted: ['f2'],
      localOnly: []
    })
  })

  /**
   * A field placed and never saved has no row to delete, and sending its local
   * id would fail the whole request — the endpoint rejects any id that is not a
   * live field of the form.
   */
  it('leaves fields that only exist in the browser out of the request', async () => {
    store.loadFieldsFromForm([aField('f1')] as never[])
    const local = store.addField({ ...aField('ignored'), id: undefined } as never)

    vi.mocked(fieldsService.deleteMany).mockResolvedValue({ archived: [], deleted: ['f1'] })

    const result = await store.deleteFieldsFromServer([local.id, 'f1'])

    expect(fieldsService.deleteMany).toHaveBeenCalledWith('form-1', ['f1'])
    expect(result?.localOnly).toEqual([local.id])
    expect(store.fields).toHaveLength(0)
  })

  it('sends no request at all when the selection was never saved', async () => {
    const local = store.addField({ ...aField('x'), id: undefined } as never)

    const result = await store.deleteFieldsFromServer([local.id])

    expect(fieldsService.deleteMany).not.toHaveBeenCalled()
    expect(result).toEqual({ archived: [], deleted: [], localOnly: [local.id] })
    expect(store.fields).toHaveLength(0)
  })

  /**
   * The editor must keep showing exactly what the form still has. Removing them
   * locally first and rolling back on failure is the version that leaves the two
   * disagreeing when the rollback is the thing that fails.
   */
  it('keeps the fields when the request fails', async () => {
    store.loadFieldsFromForm([aField('f1'), aField('f2')] as never[])
    vi.mocked(fieldsService.deleteMany).mockRejectedValue(new Error('nope'))

    // The rejection reaches the caller — the panel needs it to keep the
    // confirmation open and say nothing was changed.
    await expect(store.deleteFieldsFromServer(['f1', 'f2'])).rejects.toThrow('nope')

    expect(store.fields.map(f => f.id)).toEqual(['f1', 'f2'])
    expect(store.error).toBeTruthy()
  })

  it('re-reads the archived list only when something was archived', async () => {
    store.loadFieldsFromForm([aField('f1')] as never[])
    vi.mocked(fieldsService.deleteMany).mockResolvedValue({ archived: [], deleted: ['f1'] })

    await store.deleteFieldsFromServer(['f1'])

    expect(fieldsService.listArchived).not.toHaveBeenCalled()
  })
})
