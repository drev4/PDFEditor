export interface CanvasCoordinates {
  x: number
  y: number
  width?: number
  height?: number
}

export interface PDFCoordinates {
  x: number
  y: number
  width?: number
  height?: number
}

export interface CoordinateTransform {
  scaleFactor: number
  pageHeight: number
  canvasHeight: number
  containerPaddingX?: number
  containerPaddingY?: number
}

export interface ColorRGB {
  r: number
  g: number
  b: number
}

export function hexToRgb(hex: string): ColorRGB {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
  return result && result[1] && result[2] && result[3] ? {
    r: parseInt(result[1], 16) / 255,
    g: parseInt(result[2], 16) / 255,
    b: parseInt(result[3], 16) / 255
  } : { r: 0, g: 0, b: 0 }
}

export function calculateTransform(
  pageHeight: number,
  canvasHeight: number,
  containerPaddingX = 12,
  containerPaddingY = 8
): CoordinateTransform {
  return {
    scaleFactor: pageHeight / canvasHeight,
    pageHeight,
    canvasHeight,
    containerPaddingX,
    containerPaddingY
  }
}

export function canvasToPDF(canvas: CanvasCoordinates, transform: CoordinateTransform): PDFCoordinates {
  const { scaleFactor, pageHeight, containerPaddingX = 12, containerPaddingY = 8 } = transform

  const pdfX = (canvas.x + containerPaddingX) * scaleFactor
  const pdfY = pageHeight - ((canvas.y + containerPaddingY) * scaleFactor)

  const result: PDFCoordinates = { x: pdfX, y: pdfY }

  if (canvas.width !== undefined) {
    result.width = canvas.width * scaleFactor
  }

  if (canvas.height !== undefined) {
    result.height = canvas.height * scaleFactor
    result.y -= canvas.height * scaleFactor
  }

  return result
}

export function pdfToCanvas(pdf: PDFCoordinates, transform: CoordinateTransform): CanvasCoordinates {
  const { scaleFactor, pageHeight, containerPaddingX = 12, containerPaddingY = 8 } = transform

  const canvasX = (pdf.x / scaleFactor) - containerPaddingX
  const canvasY = ((pageHeight - pdf.y) / scaleFactor) - containerPaddingY

  const result: CanvasCoordinates = { x: canvasX, y: canvasY }

  if (pdf.width !== undefined) {
    result.width = pdf.width / scaleFactor
  }

  if (pdf.height !== undefined) {
    result.height = pdf.height / scaleFactor
  }

  return result
}
