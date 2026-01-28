/**
 * POC: Crear campos de formulario interactivos con pdf-lib
 *
 * Objetivo: Validar que podemos crear campos que funcionen en Adobe Reader
 *
 * Ejecutar con: npx tsx poc/pdf-fields-poc.ts
 * Resultado: poc/output-form.pdf
 */

import { PDFDocument, PDFTextField, PDFCheckBox, rgb, StandardFonts } from 'pdf-lib'
import { writeFileSync } from 'fs'

async function createFormPDF() {
  // Crear documento PDF nuevo
  const pdfDoc = await PDFDocument.create()

  // Agregar una página
  const page = pdfDoc.addPage([595, 842]) // A4
  const { width, height } = page.getSize()

  // Cargar fuente
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica)
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold)

  // Obtener el formulario del documento
  const form = pdfDoc.getForm()

  // ============================================
  // TÍTULO
  // ============================================
  page.drawText('Formulario de Prueba - VuePDF', {
    x: 50,
    y: height - 50,
    size: 20,
    font: fontBold,
    color: rgb(0.1, 0.1, 0.5),
  })

  page.drawText('POC: Campos interactivos con pdf-lib', {
    x: 50,
    y: height - 75,
    size: 12,
    font: font,
    color: rgb(0.4, 0.4, 0.4),
  })

  // ============================================
  // CAMPO 1: Text Field - Nombre
  // ============================================
  page.drawText('Nombre completo:', {
    x: 50,
    y: height - 120,
    size: 12,
    font: font,
  })

  const nameField = form.createTextField('nombre')
  nameField.setText('')
  nameField.addToPage(page, {
    x: 50,
    y: height - 160,
    width: 250,
    height: 25,
    borderWidth: 1,
    borderColor: rgb(0.6, 0.6, 0.6),
  })

  // ============================================
  // CAMPO 2: Text Field - Email
  // ============================================
  page.drawText('Email:', {
    x: 50,
    y: height - 200,
    size: 12,
    font: font,
  })

  const emailField = form.createTextField('email')
  emailField.setText('')
  emailField.addToPage(page, {
    x: 50,
    y: height - 240,
    width: 250,
    height: 25,
    borderWidth: 1,
    borderColor: rgb(0.6, 0.6, 0.6),
  })

  // ============================================
  // CAMPO 3: Text Field Multilinea - Comentarios
  // ============================================
  page.drawText('Comentarios:', {
    x: 50,
    y: height - 280,
    size: 12,
    font: font,
  })

  const commentsField = form.createTextField('comentarios')
  commentsField.enableMultiline()
  commentsField.setText('')
  commentsField.addToPage(page, {
    x: 50,
    y: height - 380,
    width: 400,
    height: 80,
    borderWidth: 1,
    borderColor: rgb(0.6, 0.6, 0.6),
  })

  // ============================================
  // CAMPO 4: Checkbox - Acepto términos
  // ============================================
  page.drawText('Acepto los términos y condiciones', {
    x: 75,
    y: height - 420,
    size: 12,
    font: font,
  })

  const termsCheckbox = form.createCheckBox('acepto_terminos')
  termsCheckbox.addToPage(page, {
    x: 50,
    y: height - 435,
    width: 18,
    height: 18,
    borderWidth: 1,
    borderColor: rgb(0.4, 0.4, 0.4),
  })

  // ============================================
  // CAMPO 5: Radio Buttons - Preferencia de contacto
  // ============================================
  page.drawText('Preferencia de contacto:', {
    x: 50,
    y: height - 480,
    size: 12,
    font: font,
  })

  const contactPreference = form.createRadioGroup('preferencia_contacto')

  page.drawText('Email', { x: 75, y: height - 510, size: 11, font })
  contactPreference.addOptionToPage('email', page, {
    x: 50,
    y: height - 525,
    width: 18,
    height: 18,
    borderWidth: 1,
    borderColor: rgb(0.4, 0.4, 0.4),
  })

  page.drawText('Teléfono', { x: 75, y: height - 545, size: 11, font })
  contactPreference.addOptionToPage('telefono', page, {
    x: 50,
    y: height - 560,
    width: 18,
    height: 18,
    borderWidth: 1,
    borderColor: rgb(0.4, 0.4, 0.4),
  })

  page.drawText('WhatsApp', { x: 75, y: height - 580, size: 11, font })
  contactPreference.addOptionToPage('whatsapp', page, {
    x: 50,
    y: height - 595,
    width: 18,
    height: 18,
    borderWidth: 1,
    borderColor: rgb(0.4, 0.4, 0.4),
  })

  // ============================================
  // CAMPO 6: Dropdown - País
  // ============================================
  page.drawText('País:', {
    x: 320,
    y: height - 120,
    size: 12,
    font: font,
  })

  const countryDropdown = form.createDropdown('pais')
  countryDropdown.addOptions(['España', 'México', 'Argentina', 'Colombia', 'Chile', 'Perú', 'Otro'])
  countryDropdown.select('España')
  countryDropdown.addToPage(page, {
    x: 320,
    y: height - 160,
    width: 200,
    height: 25,
    borderWidth: 1,
    borderColor: rgb(0.6, 0.6, 0.6),
  })

  // ============================================
  // FOOTER
  // ============================================
  page.drawText('Generado con pdf-lib - VuePDF POC', {
    x: 50,
    y: 30,
    size: 10,
    font: font,
    color: rgb(0.6, 0.6, 0.6),
  })

  // Guardar el PDF
  const pdfBytes = await pdfDoc.save()

  // Escribir archivo
  writeFileSync('poc/output-form.pdf', pdfBytes)

  console.log('✅ PDF creado exitosamente: poc/output-form.pdf')
  console.log('')
  console.log('Campos creados:')
  console.log('  - nombre (TextField)')
  console.log('  - email (TextField)')
  console.log('  - comentarios (TextField multilinea)')
  console.log('  - acepto_terminos (CheckBox)')
  console.log('  - preferencia_contacto (RadioGroup: email, telefono, whatsapp)')
  console.log('  - pais (Dropdown)')
  console.log('')
  console.log('📋 Próximo paso: Abrir el PDF en Adobe Reader y verificar que los campos son interactivos')
}

createFormPDF().catch(console.error)
