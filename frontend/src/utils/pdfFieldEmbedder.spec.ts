import { describe, it, expect } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import { embedFieldsInPDF, type EmbedField } from './pdfFieldEmbedder'

/**
 * The browser's own embedder (features/0052).
 *
 * There are **two** implementations of one mapping — this one, used by the
 * download and the export, and `pdfProcessor` on the server — and until this
 * file existed neither was pinned to the other. They had already drifted: the
 * callers here were dividing the stored position by the **zoom**.
 *
 * So the worked example below is deliberately the same one
 * `backend/tests/pdf-processor.spec.ts` asserts, with the same expected
 * rectangle in PDF points. Change one and the other must be changed with it,
 * which is the whole point: a field is stored once, and both sides have to
 * agree what that means.
 */

/** A stored position at the base scale of 1.5, on a 700pt page. */
const WORKED_EXAMPLE: EmbedField = {
  type: 'text',
  name: 'worked_example',
  label: 'Worked example',
  required: false,
  position: { x: 150, y: 120, width: 300, height: 45, page: 1 }
}

async function pageOf(width: number, height: number): Promise<PDFDocument> {
  const doc = await PDFDocument.create()
  doc.addPage([width, height])
  return doc
}

function widgetRect(doc: PDFDocument, name: string) {
  const field = doc.getForm().getField(name) as unknown as {
    acroField: { getWidgets: () => Array<{ getRectangle: () => { x: number; y: number; width: number; height: number } }> }
  }
  return field.acroField.getWidgets()[0]!.getRectangle()
}

describe('embedFieldsInPDF', () => {
  /**
   * `x/1.5 = 100`, `700 - 120/1.5 - 45/1.5 = 590`, `200x30` — and then
   * `pdf-lib` expands the rectangle by half the border on each side, giving
   * `(99.5, 589.5) 201x31`. Identical to the backend's assertion, on purpose.
   */
  it('maps a stored position exactly as the server does', async () => {
    const doc = await pageOf(400, 700)

    await embedFieldsInPDF(doc, [WORKED_EXAMPLE])

    expect(widgetRect(doc, 'worked_example')).toMatchObject({
      x: 99.5,
      y: 589.5,
      width: 201,
      height: 31
    })
  })

  it('flips the y axis, so a field low on the page is not high on it', async () => {
    const doc = await pageOf(400, 700)

    await embedFieldsInPDF(doc, [
      { ...WORKED_EXAMPLE, name: 'low', position: { x: 30, y: 900, width: 120, height: 45, page: 1 } }
    ])

    // 900 stored pixels down a 1050-pixel page is 100pt up from the bottom,
    // less the field's own height.
    expect(widgetRect(doc, 'low').y).toBeCloseTo(69.5, 5)
  })

  it('skips a field whose page does not exist rather than throwing', async () => {
    const doc = await pageOf(400, 700)

    await embedFieldsInPDF(doc, [
      { ...WORKED_EXAMPLE, name: 'off_the_end', position: { ...WORKED_EXAMPLE.position, page: 9 } }
    ])

    expect(doc.getForm().getFields()).toHaveLength(0)
  })
})
