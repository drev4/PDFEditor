import { describe, it, expect, beforeEach, vi } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import { setActivePinia, createPinia } from 'pinia'
import { useFormFieldsExport } from './useFormFieldsExport'
import { useDocumentStore } from '@/stores/document.store'
import { useFormFieldsStore } from '@/stores/formFields.store'

vi.mock('@/services/fields')

/**
 * Exporting the document with its fields embedded (features/0052).
 *
 * **The first test here was written before the fix and failed against
 * `develop`**: this composable read `documentStore.activeDocument.scale` and
 * handed it to the embedder as if it were the base scale. It is the *zoom* —
 * `setScale` writes it from the viewer's buttons, clamped to 0.5–3.0 — while a
 * field's position is stored at 1.5 whatever the zoom is. So a document
 * downloaded after zooming in carried every field in the wrong place, and it
 * was invisible at the default zoom because the default zoom happens to be
 * exactly the base scale.
 */

const WORKED_EXAMPLE = {
  id: 'field-1',
  type: 'text' as const,
  name: 'worked_example',
  label: 'Worked example',
  required: false,
  border: true,
  position: { x: 150, y: 120, width: 300, height: 45, page: 1 }
}

async function blankPage(width: number, height: number): Promise<ArrayBuffer> {
  const doc = await PDFDocument.create()
  doc.addPage([width, height])
  const bytes = await doc.save()
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

async function widgetRectOf(bytes: Uint8Array, name: string) {
  const doc = await PDFDocument.load(bytes)
  const field = doc.getForm().getField(name) as unknown as {
    acroField: { getWidgets: () => Array<{ getRectangle: () => { x: number; y: number; width: number; height: number } }> }
  }
  return field.acroField.getWidgets()[0]!.getRectangle()
}

describe('useFormFieldsExport', () => {
  let documentStore: ReturnType<typeof useDocumentStore>

  beforeEach(async () => {
    setActivePinia(createPinia())

    documentStore = useDocumentStore()
    documentStore.documents.push({
      id: 'doc-1',
      name: 'form.pdf',
      file: null as never,
      arrayBuffer: await blankPage(400, 700),
      numPages: 1,
      currentPage: 1,
      scale: 1.5,
      rotation: 0,
      snapshots: []
    } as never)
    documentStore.setActiveDocument('doc-1')

    const fields = useFormFieldsStore()
    fields.loadFieldsFromForm([WORKED_EXAMPLE] as never[])
  })

  /**
   * The same worked example the other two specs use — `(150, 120) 300x45`
   * stored at the base scale of 1.5 on a 700pt page is `(100, 590) 200x30` in
   * PDF points.
   *
   * Without the half-border expansion the other two see, because
   * `loadFieldsFromForm` gives every field that came from the server
   * `border: false` (`toFormField`), and `pdf-lib` only grows the rectangle when
   * there is a border to draw around it.
   */
  it('embeds the field where the stored position says, at the default zoom', async () => {
    const bytes = await useFormFieldsExport().exportPDFWithFields()

    expect(await widgetRectOf(bytes, 'worked_example')).toMatchObject({
      x: 100,
      y: 590,
      width: 200,
      height: 30
    })
  })

  it('embeds it in the same place after the author has zoomed in', async () => {
    documentStore.setScale(3)

    const bytes = await useFormFieldsExport().exportPDFWithFields()

    // Unchanged: the zoom is what the author is looking through, not what the
    // position is stored in. Against the unfixed code this was `(50, 645)`.
    expect(await widgetRectOf(bytes, 'worked_example')).toMatchObject({
      x: 100,
      y: 590
    })
  })

  it('embeds it in the same place after the author has zoomed out', async () => {
    documentStore.setScale(0.5)

    const bytes = await useFormFieldsExport().exportPDFWithFields()

    // Against the unfixed code this was `(300, 370)` — off the page it belongs
    // on, in the other direction.
    expect(await widgetRectOf(bytes, 'worked_example')).toMatchObject({
      x: 100,
      y: 590
    })
  })
})
