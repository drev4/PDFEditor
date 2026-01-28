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

export function usePDFCoordinates() {
  const hexToRgb = (hex: string) => {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
    return result && result[1] && result[2] && result[3] ? {
      r: parseInt(result[1], 16) / 255,
      g: parseInt(result[2], 16) / 255,
      b: parseInt(result[3], 16) / 255
    } : { r: 0, g: 0, b: 0 }
  }

  const calculateTransform = (pageHeight: number, canvasHeight: number, containerPaddingX = 12, containerPaddingY = 8): CoordinateTransform => {
    const scaleFactor = pageHeight / canvasHeight
    
    return {
      scaleFactor,
      pageHeight,
      canvasHeight,
      containerPaddingX,
      containerPaddingY
    }
  }

  const canvasToPDF = (canvas: CanvasCoordinates, transform: CoordinateTransform): PDFCoordinates => {
    const { scaleFactor, pageHeight, containerPaddingX = 12, containerPaddingY = 8 } = transform
    
    // PDF coordinates are from bottom-left, canvas is from top-left
    const pdfX = (canvas.x + containerPaddingX) * scaleFactor
    const pdfY = pageHeight - ((canvas.y + containerPaddingY) * scaleFactor)
    
    const result: PDFCoordinates = { x: pdfX, y: pdfY }
    
    if (canvas.width !== undefined) {
      result.width = canvas.width * scaleFactor
    }
    
    if (canvas.height !== undefined) {
      result.height = canvas.height * scaleFactor
      // Adjust Y position for height (text elements need this)
      result.y -= canvas.height * scaleFactor
    }
    
    return result
  }

  const pdfToCanvas = (pdf: PDFCoordinates, transform: CoordinateTransform): CanvasCoordinates => {
    const { scaleFactor, pageHeight, containerPaddingX = 12, containerPaddingY = 8 } = transform
    
    // Canvas coordinates are from top-left, PDF is from bottom-left
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

  return {
    hexToRgb,
    calculateTransform,
    canvasToPDF,
    pdfToCanvas
  }
}