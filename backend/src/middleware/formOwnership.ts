import { prisma } from '../services/db.js'
import { AppError } from './errorHandler.js'
import type { AuthRequest } from './auth.js'

export async function verifyFormOwnership(req: AuthRequest, formId: string) {
  const form = await prisma.form.findFirst({
    where: { id: formId, userId: req.userId }
  })

  if (!form) {
    throw new AppError(404, 'Form not found')
  }

  return form
}

export async function verifyFieldOwnership(req: AuthRequest, formId: string, fieldId: string) {
  await verifyFormOwnership(req, formId)

  const field = await prisma.field.findFirst({
    where: { id: fieldId, formId }
  })

  if (!field) {
    throw new AppError(404, 'Field not found')
  }

  return field
}
