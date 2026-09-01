import { Router } from 'express'
import { upload, newPdfKey } from '../middleware/upload.js'
import { authenticate, AuthRequest } from '../middleware/auth.js'
import { AppError } from '../middleware/errorHandler.js'
import { pdfProcessor } from '../services/pdf-processor.js'
import { pdfStorage } from '../services/pdf-storage.js'
import { canonicalPdfUrl } from '../services/pdf-url.js'
import { logger } from '../services/logger.js'

export const uploadRouter = Router()

// POST /api/upload - Upload PDF file
//
// **Validate first, store second** (features/0016). The upload arrives in
// memory rather than on disk, which turns out to be the better order anyway:
// the old code wrote the file, read it back, and deleted it again when it was
// not a PDF, so every corrupt or hostile upload became a file that had to be
// cleaned up. Nothing is stored here until the bytes are known to be a PDF.
uploadRouter.post('/', authenticate, upload.single('pdf'), async (req: AuthRequest, res, next) => {
  try {
    if (!req.file) {
      throw new AppError(400, 'No file uploaded')
    }

    const pdfBuffer = req.file.buffer

    const isValid = await pdfProcessor.validatePDF(pdfBuffer)
    if (!isValid) {
      throw new AppError(400, 'Invalid PDF file. The file is corrupted or not a valid PDF.')
    }

    // Extract fields from the PDF if they exist
    let extractedFields: Awaited<ReturnType<typeof pdfProcessor.extractFieldsFromPDF>> = []
    try {
      extractedFields = await pdfProcessor.extractFieldsFromPDF(pdfBuffer)
      logger.info(`Extracted ${extractedFields.length} fields from uploaded PDF`)
    } catch (error) {
      logger.warn({ err: error }, 'Could not extract fields from PDF')
      // Continue even if extraction fails - some PDFs may not have form fields
    }

    const filename = newPdfKey()
    await pdfStorage().put(filename, pdfBuffer)

    // Through `canonicalPdfUrl`, never assembled here: the unsigned canonical
    // URL is the only shape that may be persisted in `Form.pdfUrl`, and
    // `services/pdf-url.ts` is the only place allowed to build one
    // (features/0006).
    const pdfUrl = canonicalPdfUrl(filename)

    res.status(201).json({
      url: pdfUrl,
      filename,
      size: req.file.size,
      fields: extractedFields // Return extracted fields to the frontend
    })
  } catch (error) {
    next(error)
  }
})
