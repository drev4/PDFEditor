import { PDFDocument, rgb, StandardFonts } from 'pdf-lib'
import fs from 'fs'
import path from 'path'

/**
 * Script to generate test PDF fixtures for pdf-processor tests
 * Creates various PDFs with and without form fields for testing
 */

async function generateTestPDFs() {
  console.log('🔧 Generating test PDF fixtures...\n')

  const fixturesDir = path.join(process.cwd(), 'test-fixtures')

  // Ensure fixtures directory exists
  if (!fs.existsSync(fixturesDir)) {
    fs.mkdirSync(fixturesDir, { recursive: true })
  }

  // 1. Generate valid.pdf - Simple PDF without form fields
  console.log('1️⃣ Creating valid.pdf (no form fields)...')
  const validPdf = await PDFDocument.create()
  const page1 = validPdf.addPage([600, 800])
  const font = await validPdf.embedFont(StandardFonts.Helvetica)

  page1.drawText('Test PDF Document', {
    x: 50,
    y: 750,
    size: 24,
    font,
    color: rgb(0, 0, 0)
  })

  page1.drawText('This is a valid PDF without any form fields.', {
    x: 50,
    y: 700,
    size: 12,
    font,
    color: rgb(0.3, 0.3, 0.3)
  })

  const validPdfBytes = await validPdf.save()
  fs.writeFileSync(path.join(fixturesDir, 'valid.pdf'), validPdfBytes)
  console.log('   ✓ valid.pdf created\n')

  // 2. Generate text-field.pdf - PDF with a text field
  console.log('2️⃣ Creating text-field.pdf (with text field)...')
  const textFieldPdf = await PDFDocument.create()
  const page2 = textFieldPdf.addPage([600, 800])
  const form2 = textFieldPdf.getForm()

  page2.drawText('PDF with Text Field', {
    x: 50,
    y: 750,
    size: 20,
    font,
    color: rgb(0, 0, 0)
  })

  page2.drawText('Name:', {
    x: 50,
    y: 650,
    size: 12,
    font,
    color: rgb(0, 0, 0)
  })

  const nameField = form2.createTextField('nombre')
  nameField.addToPage(page2, {
    x: 120,
    y: 640,
    width: 200,
    height: 30,
    borderWidth: 1,
    borderColor: rgb(0.6, 0.6, 0.6)
  })

  const textFieldPdfBytes = await textFieldPdf.save()
  fs.writeFileSync(path.join(fixturesDir, 'text-field.pdf'), textFieldPdfBytes)
  console.log('   ✓ text-field.pdf created\n')

  // 3. Generate checkbox-field.pdf - PDF with a checkbox
  console.log('3️⃣ Creating checkbox-field.pdf (with checkbox)...')
  const checkboxPdf = await PDFDocument.create()
  const page3 = checkboxPdf.addPage([600, 800])
  const form3 = checkboxPdf.getForm()

  page3.drawText('PDF with Checkbox Field', {
    x: 50,
    y: 750,
    size: 20,
    font,
    color: rgb(0, 0, 0)
  })

  page3.drawText('Accept terms:', {
    x: 80,
    y: 650,
    size: 12,
    font,
    color: rgb(0, 0, 0)
  })

  const acceptCheckbox = form3.createCheckBox('accept_terms')
  acceptCheckbox.addToPage(page3, {
    x: 50,
    y: 640,
    width: 20,
    height: 20,
    borderWidth: 1,
    borderColor: rgb(0.6, 0.6, 0.6)
  })

  const checkboxPdfBytes = await checkboxPdf.save()
  fs.writeFileSync(path.join(fixturesDir, 'checkbox-field.pdf'), checkboxPdfBytes)
  console.log('   ✓ checkbox-field.pdf created\n')

  // 4. Generate multiple-fields.pdf - PDF with various field types
  console.log('4️⃣ Creating multiple-fields.pdf (with various fields)...')
  const multiplePdf = await PDFDocument.create()
  const page4 = multiplePdf.addPage([600, 800])
  const form4 = multiplePdf.getForm()

  page4.drawText('PDF with Multiple Field Types', {
    x: 50,
    y: 750,
    size: 20,
    font,
    color: rgb(0, 0, 0)
  })

  // Text field
  page4.drawText('Full Name:', {
    x: 50,
    y: 680,
    size: 12,
    font,
    color: rgb(0, 0, 0)
  })
  const fullNameField = form4.createTextField('full_name')
  fullNameField.addToPage(page4, {
    x: 150,
    y: 670,
    width: 300,
    height: 30,
    borderWidth: 1,
    borderColor: rgb(0.6, 0.6, 0.6)
  })

  // Checkbox
  page4.drawText('Subscribe to newsletter:', {
    x: 80,
    y: 620,
    size: 12,
    font,
    color: rgb(0, 0, 0)
  })
  const subscribeCheckbox = form4.createCheckBox('subscribe')
  subscribeCheckbox.addToPage(page4, {
    x: 50,
    y: 610,
    width: 20,
    height: 20,
    borderWidth: 1,
    borderColor: rgb(0.6, 0.6, 0.6)
  })

  // Dropdown
  page4.drawText('Country:', {
    x: 50,
    y: 560,
    size: 12,
    font,
    color: rgb(0, 0, 0)
  })
  const countryDropdown = form4.createDropdown('country')
  countryDropdown.addOptions(['USA', 'Canada', 'Mexico', 'Other'])
  countryDropdown.select('USA')
  countryDropdown.addToPage(page4, {
    x: 150,
    y: 550,
    width: 200,
    height: 30,
    borderWidth: 1,
    borderColor: rgb(0.6, 0.6, 0.6)
  })

  // Radio group
  page4.drawText('Gender:', {
    x: 50,
    y: 500,
    size: 12,
    font,
    color: rgb(0, 0, 0)
  })
  const genderRadio = form4.createRadioGroup('gender')

  page4.drawText('Male', {
    x: 170,
    y: 495,
    size: 10,
    font,
    color: rgb(0.2, 0.2, 0.2)
  })
  genderRadio.addOptionToPage('male', page4, {
    x: 150,
    y: 490,
    width: 15,
    height: 15,
    borderWidth: 1,
    borderColor: rgb(0.6, 0.6, 0.6)
  })

  page4.drawText('Female', {
    x: 170,
    y: 470,
    size: 10,
    font,
    color: rgb(0.2, 0.2, 0.2)
  })
  genderRadio.addOptionToPage('female', page4, {
    x: 150,
    y: 465,
    width: 15,
    height: 15,
    borderWidth: 1,
    borderColor: rgb(0.6, 0.6, 0.6)
  })

  // Textarea
  page4.drawText('Comments:', {
    x: 50,
    y: 420,
    size: 12,
    font,
    color: rgb(0, 0, 0)
  })
  const commentsField = form4.createTextField('comments')
  commentsField.enableMultiline()
  commentsField.addToPage(page4, {
    x: 150,
    y: 320,
    width: 350,
    height: 100,
    borderWidth: 1,
    borderColor: rgb(0.6, 0.6, 0.6)
  })

  const multiplePdfBytes = await multiplePdf.save()
  fs.writeFileSync(path.join(fixturesDir, 'multiple-fields.pdf'), multiplePdfBytes)
  console.log('   ✓ multiple-fields.pdf created\n')

  // 5. Generate empty.pdf - Empty PDF (alias for valid.pdf)
  console.log('5️⃣ Creating empty.pdf (same as valid.pdf)...')
  fs.copyFileSync(
    path.join(fixturesDir, 'valid.pdf'),
    path.join(fixturesDir, 'empty.pdf')
  )
  console.log('   ✓ empty.pdf created\n')

  console.log('✨ All test PDF fixtures generated successfully!')
  console.log(`📂 Location: ${fixturesDir}`)
  console.log('\nGenerated files:')
  console.log('  - valid.pdf (simple PDF, no fields)')
  console.log('  - empty.pdf (same as valid.pdf)')
  console.log('  - text-field.pdf (1 text field)')
  console.log('  - checkbox-field.pdf (1 checkbox)')
  console.log('  - multiple-fields.pdf (text, checkbox, dropdown, radio, textarea)')
}

// Run the script
generateTestPDFs().catch((error) => {
  console.error('❌ Error generating test PDFs:', error)
  process.exit(1)
})
