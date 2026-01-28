import { Request, Response, NextFunction } from 'express'
import { ZodError } from 'zod'

export class AppError extends Error {
  constructor(
    public statusCode: number,
    public message: string
  ) {
    super(message)
    this.name = 'AppError'
  }
}

export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
) {
  console.error('Error:', err)

  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      error: err.message
    })
  }

  // Check for ZodError both by instanceof and by checking for 'issues' property
  // This handles both real ZodErrors and mocked ones in tests
  if (err instanceof ZodError || (err as any).issues) {
    return res.status(400).json({
      error: 'Validation error',
      details: (err as ZodError).errors || (err as any).issues
    })
  }

  return res.status(500).json({
    error: 'Internal server error'
  })
}
