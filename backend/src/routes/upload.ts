import { Router } from 'express'
import { upload } from '../middleware/upload.js'
import { authenticate, AuthRequest } from '../middleware/auth.js'
import { AppError } from '../middleware/errorHandler.js'
import { pdfProcessor } from '../services/pdf-processor.js'
import fs from 'fs'

export const uploadRouter = Router()

// POST /api/upload - Upload PDF file
uploadRouter.post('/', authenticate, upload.single('pdf'), async (req: AuthRequest, res, next) => {
  try {
    if (!req.file) {
      throw new AppError(400, 'No file uploaded')
    }

    // Read the PDF file buffer
    const pdfBuffer = fs.readFileSync(req.file.path)

    // Validate the PDF
    const isValid = await pdfProcessor.validatePDF(pdfBuffer)
    if (!isValid) {
      // Delete the invalid file
      fs.unlinkSync(req.file.path)
      throw new AppError(400, 'Invalid PDF file. The file is corrupted or not a valid PDF.')
    }

    // Extract fields from the PDF if they exist
    let extractedFields: Awaited<ReturnType<typeof pdfProcessor.extractFieldsFromPDF>> = []
    try {
      extractedFields = await pdfProcessor.extractFieldsFromPDF(pdfBuffer)
      console.log(`Extracted ${extractedFields.length} fields from uploaded PDF`)
    } catch (error) {
      console.warn('Could not extract fields from PDF:', error)
      // Continue even if extraction fails - some PDFs may not have form fields
    }

    // Get the base URL from environment or default to localhost
    const baseUrl = process.env.BASE_URL || 'http://localhost:3000'
    const pdfUrl = `${baseUrl}/uploads/pdfs/${req.file.filename}`

    res.status(201).json({
      url: pdfUrl,
      filename: req.file.filename,
      size: req.file.size,
      fields: extractedFields // Return extracted fields to the frontend
    })
  } catch (error) {
    next(error)
  }
})
