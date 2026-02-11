import { pdfProcessor } from '../services/pdf-processor.js'
import fs from 'fs'
import path from 'path'

/**
 * Manual test script for PDFProcessor service
 * Tests validation, extraction, and embedding of PDF fields
 */

async function testProcessor() {
  console.log('🧪 Testing PDFProcessor...\n')

  const fixturesDir = path.join(process.cwd(), 'test-fixtures')
  const outputDir = path.join(process.cwd(), 'test-output')

  // Ensure output directory exists
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true })
  }

  // Test 1: Validation
  console.log('1️⃣  Testing validatePDF...')
  try {
    const validPdf = fs.readFileSync(path.join(fixturesDir, 'valid.pdf'))
    const isValid = await pdfProcessor.validatePDF(validPdf)
    console.log(`   Valid PDF: ${isValid ? '✅ PASSED' : '❌ FAILED'}`)

    const invalidPdf = Buffer.from('not a valid pdf')
    const isInvalid = await pdfProcessor.validatePDF(invalidPdf)
    console.log(`   Invalid PDF: ${!isInvalid ? '✅ PASSED' : '❌ FAILED'}`)
  } catch (error) {
    console.error('   ❌ Error in validation test:', error)
  }

  // Test 2: Extraction - Text field
  console.log('\n2️⃣  Testing extractFieldsFromPDF (text field)...')
  try {
    const textFieldPdf = fs.readFileSync(path.join(fixturesDir, 'text-field.pdf'))
    const textFields = await pdfProcessor.extractFieldsFromPDF(textFieldPdf)
    console.log(`   Extracted ${textFields.length} field(s):`)
    textFields.forEach(f => {
      console.log(`   - ${f.name} (${f.type}) at page ${f.position.page}`)
      console.log(`     Position: (${f.position.x.toFixed(1)}, ${f.position.y.toFixed(1)})`)
      console.log(`     Size: ${f.position.width.toFixed(1)}x${f.position.height.toFixed(1)}`)
    })
    console.log(`   ${textFields.length === 1 && textFields[0]?.type === 'text' ? '✅ PASSED' : '❌ FAILED'}`)
  } catch (error) {
    console.error('   ❌ Error in text field extraction:', error)
  }

  // Test 3: Extraction - Checkbox field
  console.log('\n3️⃣  Testing extractFieldsFromPDF (checkbox field)...')
  try {
    const checkboxPdf = fs.readFileSync(path.join(fixturesDir, 'checkbox-field.pdf'))
    const checkboxFields = await pdfProcessor.extractFieldsFromPDF(checkboxPdf)
    console.log(`   Extracted ${checkboxFields.length} field(s):`)
    checkboxFields.forEach(f => {
      console.log(`   - ${f.name} (${f.type}) at page ${f.position.page}`)
    })
    console.log(`   ${checkboxFields.length === 1 && checkboxFields[0]?.type === 'checkbox' ? '✅ PASSED' : '❌ FAILED'}`)
  } catch (error) {
    console.error('   ❌ Error in checkbox extraction:', error)
  }

  // Test 4: Extraction - Multiple fields
  console.log('\n4️⃣  Testing extractFieldsFromPDF (multiple fields)...')
  try {
    const multiplePdf = fs.readFileSync(path.join(fixturesDir, 'multiple-fields.pdf'))
    const multipleFields = await pdfProcessor.extractFieldsFromPDF(multiplePdf)
    console.log(`   Extracted ${multipleFields.length} field(s):`)
    multipleFields.forEach(f => {
      console.log(`   - ${f.name} (${f.type})${f.options ? ' with ' + f.options.length + ' options' : ''}`)
    })
    console.log(`   ${multipleFields.length === 5 ? '✅ PASSED' : '❌ FAILED (expected 5 fields)'}`)
  } catch (error) {
    console.error('   ❌ Error in multiple fields extraction:', error)
  }

  // Test 5: Extraction - Empty PDF (no fields)
  console.log('\n5️⃣  Testing extractFieldsFromPDF (no fields)...')
  try {
    const emptyPdf = fs.readFileSync(path.join(fixturesDir, 'empty.pdf'))
    const emptyFields = await pdfProcessor.extractFieldsFromPDF(emptyPdf)
    console.log(`   Extracted ${emptyFields.length} field(s)`)
    console.log(`   ${emptyFields.length === 0 ? '✅ PASSED' : '❌ FAILED'}`)
  } catch (error) {
    console.error('   ❌ Error in empty PDF extraction:', error)
  }

  // Test 6: Embedding - Single text field
  console.log('\n6️⃣  Testing embedFieldsInPDF (single field)...')
  try {
    const basePdf = fs.readFileSync(path.join(fixturesDir, 'valid.pdf'))
    const testFields = [{
      type: 'text' as const,
      name: 'test_field',
      label: 'Test Field',
      required: false,
      position: { x: 150, y: 150, width: 300, height: 45, page: 1 }
    }]

    const modifiedPdf = await pdfProcessor.embedFieldsInPDF(basePdf, testFields)
    const outputPath = path.join(outputDir, 'embedded-single-field.pdf')
    fs.writeFileSync(outputPath, modifiedPdf)
    console.log(`   Modified PDF saved to: ${outputPath}`)

    // Verify that the field was embedded
    const extractedFromModified = await pdfProcessor.extractFieldsFromPDF(modifiedPdf)
    console.log(`   Verification: ${extractedFromModified.length} field(s) found after embedding`)
    console.log(`   ${extractedFromModified.length === 1 ? '✅ PASSED' : '❌ FAILED'}`)
  } catch (error) {
    console.error('   ❌ Error in single field embedding:', error)
  }

  // Test 7: Embedding - Multiple fields of different types
  console.log('\n7️⃣  Testing embedFieldsInPDF (multiple field types)...')
  try {
    const basePdf = fs.readFileSync(path.join(fixturesDir, 'valid.pdf'))
    const testFields = [
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

    const modifiedPdf = await pdfProcessor.embedFieldsInPDF(basePdf, testFields)
    const outputPath = path.join(outputDir, 'embedded-multiple-fields.pdf')
    fs.writeFileSync(outputPath, modifiedPdf)
    console.log(`   Modified PDF saved to: ${outputPath}`)

    // Verify that all fields were embedded
    const extractedFromModified = await pdfProcessor.extractFieldsFromPDF(modifiedPdf)
    console.log(`   Verification: ${extractedFromModified.length} field(s) found after embedding`)
    extractedFromModified.forEach(f => {
      console.log(`   - ${f.name} (${f.type})`)
    })
    console.log(`   ${extractedFromModified.length === 4 ? '✅ PASSED' : '❌ FAILED'}`)
  } catch (error) {
    console.error('   ❌ Error in multiple fields embedding:', error)
  }

  // Test 8: Round-trip test (extract → embed → extract)
  console.log('\n8️⃣  Testing round-trip (extract → embed → extract)...')
  try {
    const originalPdf = fs.readFileSync(path.join(fixturesDir, 'multiple-fields.pdf'))
    const extractedFields = await pdfProcessor.extractFieldsFromPDF(originalPdf)
    console.log(`   Original PDF has ${extractedFields.length} field(s)`)

    const basePdf = fs.readFileSync(path.join(fixturesDir, 'valid.pdf'))
    const reembeddedPdf = await pdfProcessor.embedFieldsInPDF(basePdf, extractedFields)
    const outputPath = path.join(outputDir, 'round-trip-test.pdf')
    fs.writeFileSync(outputPath, reembeddedPdf)

    const finalFields = await pdfProcessor.extractFieldsFromPDF(reembeddedPdf)
    console.log(`   After re-embedding: ${finalFields.length} field(s)`)
    console.log(`   Modified PDF saved to: ${outputPath}`)
    console.log(`   ${finalFields.length === extractedFields.length ? '✅ PASSED' : '❌ FAILED'}`)
  } catch (error) {
    console.error('   ❌ Error in round-trip test:', error)
  }

  console.log('\n✨ All tests completed!')
  console.log(`📂 Output files saved in: ${outputDir}`)
  console.log('\nYou can open the generated PDFs in Adobe Reader or any PDF viewer')
  console.log('to manually verify that the form fields are working correctly.')
}

testProcessor().catch((error) => {
  console.error('Fatal error:', error)
  process.exit(1)
})
