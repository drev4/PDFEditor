import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useFormsStore } from './forms.store'
import { formsService } from '@/services/forms'
import { ApiError } from '@/services/api'

vi.mock('@/services/forms')

describe('Forms Store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  const mockForm = {
    id: 'form-1',
    userId: 'user-1',
    title: 'Test Form',
    description: 'Description',
    shareId: 'share-123',
    status: 'draft' as const,
    pdfUrl: null,
    settings: null,
    createdAt: '2024-01-01',
    updatedAt: '2024-01-01'
  }

  describe('fetchForms', () => {
    it('should fetch all forms', async () => {
      const store = useFormsStore()
      vi.mocked(formsService.list).mockResolvedValue([mockForm])

      await store.fetchForms()

      expect(store.forms).toHaveLength(1)
      expect(store.forms[0]?.title).toBe('Test Form')
      expect(store.loading).toBe(false)
    })

    it('should handle fetch error', async () => {
      const store = useFormsStore()
      vi.mocked(formsService.list).mockRejectedValue(new ApiError(500, 'Server error'))

      await expect(store.fetchForms()).rejects.toThrow()
      expect(store.error).toBe('Server error')
    })
  })

  describe('fetchForm', () => {
    it('should fetch single form', async () => {
      const store = useFormsStore()
      vi.mocked(formsService.get).mockResolvedValue(mockForm)

      await store.fetchForm('form-1')

      expect(store.currentForm?.id).toBe('form-1')
    })
  })

  describe('createForm', () => {
    it('should create new form', async () => {
      const store = useFormsStore()
      vi.mocked(formsService.create).mockResolvedValue(mockForm)

      await store.createForm({ title: 'New Form' })

      expect(store.forms).toHaveLength(1)
      expect(store.forms[0]?.title).toBe('Test Form')
    })

    it('should handle create error', async () => {
      const store = useFormsStore()
      vi.mocked(formsService.create).mockRejectedValue(new Error('Create failed'))

      await expect(store.createForm({ title: 'New' })).rejects.toThrow()
      expect(store.error).toBeTruthy()
    })
  })

  describe('updateForm', () => {
    it('should update existing form', async () => {
      const store = useFormsStore()
      store.forms = [mockForm]

      const updatedForm = { ...mockForm, title: 'Updated Form' }
      vi.mocked(formsService.update).mockResolvedValue(updatedForm)

      await store.updateForm('form-1', { title: 'Updated Form' })

      expect(store.forms[0]?.title).toBe('Updated Form')
    })

    it('should update currentForm if it matches', async () => {
      const store = useFormsStore()
      store.currentForm = mockForm

      const updatedForm = { ...mockForm, title: 'Updated' }
      vi.mocked(formsService.update).mockResolvedValue(updatedForm)

      await store.updateForm('form-1', { title: 'Updated' })

      expect(store.currentForm?.title).toBe('Updated')
    })
  })

  describe('deleteForm', () => {
    it('should delete form', async () => {
      const store = useFormsStore()
      store.forms = [mockForm]
      vi.mocked(formsService.delete).mockResolvedValue()

      await store.deleteForm('form-1')

      expect(store.forms).toHaveLength(0)
    })

    it('should clear currentForm if deleted', async () => {
      const store = useFormsStore()
      store.currentForm = mockForm
      vi.mocked(formsService.delete).mockResolvedValue()

      await store.deleteForm('form-1')

      expect(store.currentForm).toBeNull()
    })
  })

  describe('Computed Properties', () => {
    it('should calculate forms count', () => {
      const store = useFormsStore()
      store.forms = [mockForm, { ...mockForm, id: 'form-2' }]

      expect(store.formsCount).toBe(2)
    })

    it('should filter published forms', () => {
      const store = useFormsStore()
      store.forms = [
        mockForm,
        { ...mockForm, id: 'form-2', status: 'published' as const }
      ]

      expect(store.publishedForms).toHaveLength(1)
      expect(store.publishedForms[0]?.status).toBe('published')
    })

    it('should filter draft forms', () => {
      const store = useFormsStore()
      store.forms = [
        mockForm,
        { ...mockForm, id: 'form-2', status: 'published' as const }
      ]

      expect(store.draftForms).toHaveLength(1)
      expect(store.draftForms[0]?.status).toBe('draft')
    })
  })
})
