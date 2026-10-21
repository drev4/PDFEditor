import { describe, it, expect } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import { pdfProcessor } from '../src/services/pdf-processor.js'
import fs from 'fs'
import path from 'path'

describe('PDFProcessor', () => {
  const fixturesDir = path.join(process.cwd(), 'test-fixtures')

  describe('validatePDF', () => {
    it('should validate a correct PDF', async () => {
      const buffer = fs.readFileSync(path.join(fixturesDir, 'valid.pdf'))
      const result = await pdfProcessor.validatePDF(buffer)
      expect(result).toBe(true)
    })

    it('should reject a corrupted PDF', async () => {
      const buffer = Buffer.from('not a valid pdf')
      const result = await pdfProcessor.validatePDF(buffer)
      expect(result).toBe(false)
    })

    it('should reject an empty buffer', async () => {
      const buffer = Buffer.from('')
      const result = await pdfProcessor.validatePDF(buffer)
      expect(result).toBe(false)
    })
  })

  describe('extractFieldsFromPDF', () => {
    it('should extract a text field', async () => {
      const buffer = fs.readFileSync(path.join(fixturesDir, 'text-field.pdf'))
      const fields = await pdfProcessor.extractFieldsFromPDF(buffer)

      expect(fields).toHaveLength(1)
      expect(fields[0]?.type).toBe('text')
      expect(fields[0]?.name).toBe('nombre')
      expect(fields[0]?.position.page).toBe(1)
      expect(fields[0]?.position.x).toBeGreaterThan(0)
      expect(fields[0]?.position.y).toBeGreaterThan(0)
      expect(fields[0]?.position.width).toBeGreaterThan(0)
      expect(fields[0]?.position.height).toBeGreaterThan(0)
    })

    it('should extract a checkbox field', async () => {
      const buffer = fs.readFileSync(path.join(fixturesDir, 'checkbox-field.pdf'))
      const fields = await pdfProcessor.extractFieldsFromPDF(buffer)

      expect(fields).toHaveLength(1)
      expect(fields[0]?.type).toBe('checkbox')
      expect(fields[0]?.name).toBe('accept_terms')
    })

    it('should extract multiple fields of different types', async () => {
      const buffer = fs.readFileSync(path.join(fixturesDir, 'multiple-fields.pdf'))
      const fields = await pdfProcessor.extractFieldsFromPDF(buffer)

      expect(fields).toHaveLength(5)

      // Check that we have all expected field types
      const fieldTypes = fields.map(f => f.type)
      expect(fieldTypes).toContain('text')
      expect(fieldTypes).toContain('checkbox')
      expect(fieldTypes).toContain('dropdown')
      expect(fieldTypes).toContain('radio')
      expect(fieldTypes).toContain('textarea')

      // Check that dropdown and radio have options
      const dropdownField = fields.find(f => f.type === 'dropdown')
      expect(dropdownField?.options).toBeDefined()
      expect(dropdownField?.options?.length).toBeGreaterThan(0)

      const radioField = fields.find(f => f.type === 'radio')
      expect(radioField?.options).toBeDefined()
      expect(radioField?.options?.length).toBeGreaterThan(0)
    })

    it('should return an empty array for a PDF without fields', async () => {
      const buffer = fs.readFileSync(path.join(fixturesDir, 'empty.pdf'))
      const fields = await pdfProcessor.extractFieldsFromPDF(buffer)

      expect(fields).toHaveLength(0)
    })

    it('should throw an error for an invalid PDF', async () => {
      const buffer = Buffer.from('not a valid pdf')

      await expect(pdfProcessor.extractFieldsFromPDF(buffer)).rejects.toThrow(
        'Failed to extract fields from PDF'
      )
    })
  })

  describe('embedFieldsInPDF', () => {
    it('should embed a text field correctly', async () => {
      const buffer = fs.readFileSync(path.join(fixturesDir, 'empty.pdf'))
      const fields = [
        {
          type: 'text' as const,
          name: 'test_name',
          label: 'Test Name',
          required: true,
          position: { x: 150, y: 150, width: 300, height: 45, page: 1 }
        }
      ]

      const modifiedBuffer = await pdfProcessor.embedFieldsInPDF(buffer, fields)

      // Validate that the PDF is still valid
      expect(await pdfProcessor.validatePDF(modifiedBuffer)).toBe(true)

      // Extract fields to verify embedding worked
      const extractedFields = await pdfProcessor.extractFieldsFromPDF(modifiedBuffer)
      expect(extractedFields).toHaveLength(1)
      expect(extractedFields[0]?.name).toBe('test_name')
      expect(extractedFields[0]?.type).toBe('text')
    })

    it('should embed multiple field types correctly', async () => {
      const buffer = fs.readFileSync(path.join(fixturesDir, 'empty.pdf'))
      const fields = [
        {
          type: 'text' as const,
          name: 'full_name',
          label: 'Full Name',
          required: true,
          position: { x: 150, y: 100, width: 300, height: 45, page: 1 }
        },
        {
          type: 'checkbox' as const,
          name: 'agree',
          label: 'I Agree',
          required: true,
          position: { x: 150, y: 200, width: 30, height: 30, page: 1 }
        },
        {
          type: 'dropdown' as const,
          name: 'country',
          label: 'Country',
          required: false,
          position: { x: 150, y: 300, width: 200, height: 40, page: 1 },
          options: ['USA', 'Canada', 'Mexico']
        },
        {
          type: 'textarea' as const,
          name: 'comments',
          label: 'Comments',
          required: false,
          position: { x: 150, y: 400, width: 350, height: 150, page: 1 }
        }
      ]

      const modifiedBuffer = await pdfProcessor.embedFieldsInPDF(buffer, fields)

      // Validate and extract
      expect(await pdfProcessor.validatePDF(modifiedBuffer)).toBe(true)
      const extractedFields = await pdfProcessor.extractFieldsFromPDF(modifiedBuffer)

      expect(extractedFields).toHaveLength(4)
      expect(extractedFields.map(f => f.name)).toEqual(
        expect.arrayContaining(['full_name', 'agree', 'country', 'comments'])
      )
    })

    it('should preserve the original PDF content', async () => {
      const buffer = fs.readFileSync(path.join(fixturesDir, 'valid.pdf'))
      const originalSize = buffer.length

      const fields = [
        {
          type: 'text' as const,
          name: 'test',
          label: 'Test',
          required: false,
          position: { x: 100, y: 100, width: 200, height: 30, page: 1 }
        }
      ]

      const modifiedBuffer = await pdfProcessor.embedFieldsInPDF(buffer, fields)

      // Modified PDF should be larger (has additional form fields)
      expect(modifiedBuffer.length).toBeGreaterThan(originalSize)

      // But it should still be a valid PDF
      expect(await pdfProcessor.validatePDF(modifiedBuffer)).toBe(true)
    })

    it('should handle empty field array', async () => {
      const buffer = fs.readFileSync(path.join(fixturesDir, 'valid.pdf'))
      const fields: any[] = []

      const modifiedBuffer = await pdfProcessor.embedFieldsInPDF(buffer, fields)

      // Should still produce a valid PDF
      expect(await pdfProcessor.validatePDF(modifiedBuffer)).toBe(true)

      // Should have no fields
      const extractedFields = await pdfProcessor.extractFieldsFromPDF(modifiedBuffer)
      expect(extractedFields).toHaveLength(0)
    })

    it('should throw an error for an invalid PDF', async () => {
      const buffer = Buffer.from('not a valid pdf')
      const fields = [
        {
          type: 'text' as const,
          name: 'test',
          label: 'Test',
          required: false,
          position: { x: 100, y: 100, width: 200, height: 30, page: 1 }
        }
      ]

      await expect(pdfProcessor.embedFieldsInPDF(buffer, fields)).rejects.toThrow(
        'Failed to embed fields in PDF'
      )
    })
  })

  describe('round-trip (extract → embed → extract)', () => {
    it('should maintain field integrity through extraction and re-embedding', async () => {
      // Extract fields from a PDF with multiple fields
      const originalBuffer = fs.readFileSync(path.join(fixturesDir, 'multiple-fields.pdf'))
      const extractedFields = await pdfProcessor.extractFieldsFromPDF(originalBuffer)

      expect(extractedFields.length).toBeGreaterThan(0)

      // Embed those fields into a blank PDF
      const blankBuffer = fs.readFileSync(path.join(fixturesDir, 'empty.pdf'))
      const reembeddedBuffer = await pdfProcessor.embedFieldsInPDF(blankBuffer, extractedFields)

      // Extract again and compare
      const finalFields = await pdfProcessor.extractFieldsFromPDF(reembeddedBuffer)

      expect(finalFields).toHaveLength(extractedFields.length)

      // Check that all field names are preserved
      const originalNames = extractedFields.map(f => f.name).sort()
      const finalNames = finalFields.map(f => f.name).sort()
      expect(finalNames).toEqual(originalNames)

      // Check that all field types are preserved
      for (const originalField of extractedFields) {
        const matchingField = finalFields.find(f => f.name === originalField.name)
        expect(matchingField).toBeDefined()
        expect(matchingField?.type).toBe(originalField.type)
      }
    })
  })

  describe('edge cases', () => {
    it('should handle radio buttons with multiple options', async () => {
      const buffer = fs.readFileSync(path.join(fixturesDir, 'empty.pdf'))
      const fields = [
        {
          type: 'radio' as const,
          name: 'gender',
          label: 'Gender',
          required: false,
          position: { x: 150, y: 500, width: 20, height: 60, page: 1 },
          options: ['Male', 'Female', 'Other']
        }
      ]

      const modifiedBuffer = await pdfProcessor.embedFieldsInPDF(buffer, fields)
      const extractedFields = await pdfProcessor.extractFieldsFromPDF(modifiedBuffer)

      expect(extractedFields).toHaveLength(1)
      expect(extractedFields[0]?.type).toBe('radio')
      expect(extractedFields[0]?.options).toHaveLength(3)
    })

    it('should handle fields on different pages (if multi-page PDF)', async () => {
      // Note: Our test fixtures are single-page, so this test just ensures
      // the page property is correctly handled
      const buffer = fs.readFileSync(path.join(fixturesDir, 'empty.pdf'))
      const fields = [
        {
          type: 'text' as const,
          name: 'field_page_1',
          label: 'Field on Page 1',
          required: false,
          position: { x: 100, y: 100, width: 200, height: 30, page: 1 }
        }
      ]

      const modifiedBuffer = await pdfProcessor.embedFieldsInPDF(buffer, fields)
      const extractedFields = await pdfProcessor.extractFieldsFromPDF(modifiedBuffer)

      expect(extractedFields).toHaveLength(1)
      expect(extractedFields[0]?.position.page).toBe(1)
    })

    it('should update existing fields without duplicates when re-embedding', async () => {
      // First, create a PDF with a field
      const buffer = fs.readFileSync(path.join(fixturesDir, 'empty.pdf'))
      const initialFields = [
        {
          type: 'text' as const,
          name: 'username',
          label: 'Username',
          required: false,
          position: { x: 100, y: 100, width: 200, height: 30, page: 1 }
        }
      ]

      const pdfWithField = await pdfProcessor.embedFieldsInPDF(buffer, initialFields)

      // Verify the field was created
      const extracted1 = await pdfProcessor.extractFieldsFromPDF(pdfWithField)
      expect(extracted1).toHaveLength(1)
      expect(extracted1[0]?.name).toBe('username')

      // Now, modify the same field (same name but different position)
      const modifiedFields = [
        {
          type: 'text' as const,
          name: 'username', // Same name
          label: 'Username Updated',
          required: false,
          position: { x: 150, y: 150, width: 250, height: 35, page: 1 } // Different position
        }
      ]

      // Re-embed the field (should update, not duplicate)
      const pdfWithUpdatedField = await pdfProcessor.embedFieldsInPDF(pdfWithField, modifiedFields)

      // Verify there's still only one field, not two
      const extracted2 = await pdfProcessor.extractFieldsFromPDF(pdfWithUpdatedField)
      expect(extracted2).toHaveLength(1)
      expect(extracted2[0]?.name).toBe('username')

      // Verify the position was updated (approximately, considering coordinate conversions)
      expect(extracted2[0]?.position.x).toBeCloseTo(150, -1)
      expect(extracted2[0]?.position.y).toBeCloseTo(150, -1)
    })
  })

  /**
   * The trip a field's position makes, and the one property nothing in this
   * repository asserted (features/0052).
   *
   * A position is stored **once**, in canvas pixels at the base scale of 1.5
   * with the page upright, and two different pieces of code convert it: this
   * service, and `frontend/src/utils/pdfFieldEmbedder.ts` for the browser's own
   * download. `pdfFieldEmbedder.spec.ts` asserts the *same worked example* as
   * the second test here, on purpose — the two mappings are one contract in two
   * places, and pinning each to itself is what let them drift.
   *
   * The existing "update without duplicates" test does check a position, with
   * `toBeCloseTo(150, -1)` — a tolerance of five pixels, on one axis of one
   * field, on a page whose size the test never states. That cannot catch a
   * scale that is out by a factor, which is what these are for.
   */
  describe('a stored position round-trips', () => {
    /**
     * How far a position may legitimately move on the way out and back.
     *
     * `pdf-lib` **expands** a widget rectangle by half the border on each side,
     * so a field asked for at `(100, 590) 200x30` with `borderWidth: 1` is
     * stored in the PDF as `(99.5, 589.5) 201x31`. Back in stored units that is
     * 0.75px of offset and 1.5px of size, fixed and explainable rather than
     * drift — the border is drawn around the box the author drew, not inside
     * it. It does not accumulate: nothing writes an extracted position back
     * over a stored one except `syncFieldsFromPDF`, and only for a form that has
     * never had a field.
     */
    const TOLERANCE = 1.5

    const near = (actual: number, expected: number) =>
      expect(Math.abs(actual - expected)).toBeLessThanOrEqual(TOLERANCE)

    /** A page that is **not** square: a swapped axis survives a square page. */
    async function pageOf(width: number, height: number): Promise<Buffer> {
      const doc = await PDFDocument.create()
      doc.addPage([width, height])
      return Buffer.from(await doc.save())
    }

    const field = (name: string, position: { x: number; y: number; width: number; height: number }) => ({
      type: 'text' as const,
      name,
      label: name,
      required: false,
      position: { ...position, page: 1 }
    })

    it('comes back at the position it went in at', async () => {
      const buffer = await pageOf(400, 700)

      // 700pt of page is 1050 stored pixels at the base scale, so `low` sits
      // near the bottom — where an off-by-a-page-height in the `y` flip hides.
      const high = field('high', { x: 150, y: 120, width: 300, height: 45 })
      const low = field('low', { x: 30, y: 900, width: 120, height: 45 })

      const embedded = await pdfProcessor.embedFieldsInPDF(buffer, [high, low])
      const extracted = await pdfProcessor.extractFieldsFromPDF(embedded)
      const byName = Object.fromEntries(extracted.map(f => [f.name, f.position]))

      expect(byName.high?.page).toBe(1)
      near(byName.high!.x, 150)
      near(byName.high!.y, 120)
      near(byName.high!.width, 300)
      near(byName.high!.height, 45)

      near(byName.low!.x, 30)
      near(byName.low!.y, 900)
      near(byName.low!.width, 120)
      near(byName.low!.height, 45)
    })

    /**
     * The worked example, in PDF points, that `pdfFieldEmbedder.spec.ts`
     * asserts on the other side. A stored `(150, 120) 300x45` at the base scale
     * of 1.5 on a 700pt page is `x/1.5 = 100`,
     * `700 - 120/1.5 - 45/1.5 = 590`, `200x30` — and then `pdf-lib`'s border
     * expansion makes the stored rectangle `(99.5, 589.5) 201x31`.
     *
     * Exact numbers rather than a tolerance here: this is the contract the two
     * embedders share, and a tolerance is what would let one of them drift by
     * the width of a border and stay green.
     */
    it('puts the widget where the PDF coordinate system expects it', async () => {
      const buffer = await pageOf(400, 700)

      const embedded = await pdfProcessor.embedFieldsInPDF(buffer, [
        field('worked_example', { x: 150, y: 120, width: 300, height: 45 })
      ])

      const doc = await PDFDocument.load(embedded)
      const widget = (doc.getForm().getField('worked_example') as any).acroField.getWidgets()[0]
      const rect = widget.getRectangle()

      expect(rect.x).toBe(99.5)
      expect(rect.y).toBe(589.5)
      expect(rect.width).toBe(201)
      expect(rect.height).toBe(31)
    })
  })
})
