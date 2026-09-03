import { Router } from 'express'
import { upload, newPdfKey } from '../middleware/upload.js'
import { authenticate, AuthRequest } from '../middleware/auth.js'
import { requireOrganizationId } from '../middleware/membership.js'
import { prisma } from '../services/db.js'
import { AppError } from '../middleware/errorHandler.js'
import { pdfProcessor } from '../services/pdf-processor.js'
import { pdfStorage } from '../services/pdf-storage.js'
import { canonicalPdfUrl } from '../services/pdf-url.js'
import { logger } from '../services/logger.js'
import { asyncHandler } from '../middleware/asyncHandler.js'

export const uploadRouter = Router()

// POST /api/upload - Upload PDF file
//
// **Validate first, store second** (features/0016). The upload arrives in
// memory rather than on disk, which turns out to be the better order anyway:
// the old code wrote the file, read it back, and deleted it again when it was
// not a PDF, so every corrupt or hostile upload became a file that had to be
// cleaned up. Nothing is stored here until the bytes are known to be a PDF.
uploadRouter.post('/', authenticate, upload.single('pdf'), asyncHandler(async (req: AuthRequest, res, next) => {
  if (!req.file) {
    throw new AppError(400, 'No file uploaded')
  }

  // An upload has to land in an organization, because that is what owns it and
  // what every later check reads (features/0039). Resolved before the bytes are
  // touched: a caller with no membership has nowhere to put a document, and
  // storing it first would leave an object no row will ever own.
  //
  // No real account is in that state — registration creates a personal
  // organization transactionally — so this is a boundary rather than a flow.
  const organizationId = await requireOrganizationId(req)

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

  // Bytes first, row second — the **opposite** order from deletion in
  // `services/pdf-gc.ts`, and for the same reason: it is the arrangement whose
  // failure is the reversible one. A row written before a `put` that then fails
  // is a key the customer may point a form at and which 404s on every read; an
  // object written before a row that then fails is an orphan, which is waste
  // and is recoverable.
  //
  // `uploadedByUserId` is provenance and nothing reads it for authorization —
  // the same split `Form.createdByUserId` documents.
  await prisma.upload.create({
    data: {
      key: filename,
      organizationId,
      uploadedByUserId: req.userId!,
      originalName: req.file.originalname,
      size: req.file.size
    }
  })

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
}))
