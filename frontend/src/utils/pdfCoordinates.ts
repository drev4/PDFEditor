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

/**
 * Field geometry under page rotation.
 *
 * A field's position is stored once, in canvas pixels at `DEFAULT_SCALE` with
 * the page unrotated — that is the contract the backend embeds against
 * (`pdf-processor.ts`), and rotating the view must never change it. What has to
 * move is where the field is *drawn*, because pdf.js renders the rotated page
 * into the canvas and the canvas axes turn with it.
 *
 * The two functions below are inverses. `rotateFieldRect` takes a stored rect
 * to screen; `unrotateFieldPoint` takes a click on the rotated page back to
 * storage. Round-tripping one through the other is the property the tests
 * assert, and it is the only thing standing between a rotated page and fields
 * that save in the wrong place.
 *
 * `pageWidth`/`pageHeight` are the page's **unrotated** size in stored units
 * (canvas pixels at the base scale).
 */
export interface FieldRect {
  x: number
  y: number
  width: number
  height: number
}

function normalizeRotation(rotation: number): 0 | 90 | 180 | 270 {
  const r = ((rotation % 360) + 360) % 360
  return (r - (r % 90)) as 0 | 90 | 180 | 270
}

export function rotateFieldRect(
  rect: FieldRect,
  pageWidth: number,
  pageHeight: number,
  rotation: number,
  scaleFactor = 1
): FieldRect {
  const { x, y, width, height } = rect
  let out: FieldRect

  switch (normalizeRotation(rotation)) {
    case 90:
      // The page turns clockwise, so the rect's bottom-left corner becomes its
      // top-left, and the axes swap.
      out = { x: pageHeight - (y + height), y: x, width: height, height: width }
      break
    case 180:
      out = { x: pageWidth - (x + width), y: pageHeight - (y + height), width, height }
      break
    case 270:
      out = { x: y, y: pageWidth - (x + width), width: height, height: width }
      break
    default:
      out = { x, y, width, height }
  }

  return {
    x: out.x * scaleFactor,
    y: out.y * scaleFactor,
    width: out.width * scaleFactor,
    height: out.height * scaleFactor
  }
}

export function unrotateFieldPoint(
  point: { x: number; y: number },
  pageWidth: number,
  pageHeight: number,
  rotation: number,
  scaleFactor = 1
): { x: number; y: number } {
  const x = point.x / scaleFactor
  const y = point.y / scaleFactor

  switch (normalizeRotation(rotation)) {
    case 90:
      return { x: y, y: pageHeight - x }
    case 180:
      return { x: pageWidth - x, y: pageHeight - y }
    case 270:
      return { x: pageWidth - y, y: x }
    default:
      return { x, y }
  }
}

/**
 * The page's unrotated size, worked back out of the canvas pdf.js produced.
 * At 90 and 270 the rendered canvas has the page's axes swapped, so the caller
 * cannot use the canvas dimensions directly and every call site getting this
 * wrong is a field in the wrong place.
 */
export function unrotatedPageSize(
  canvasWidth: number,
  canvasHeight: number,
  rotation: number,
  scaleFactor = 1
): { pageWidth: number; pageHeight: number } {
  const w = canvasWidth / scaleFactor
  const h = canvasHeight / scaleFactor
  const quarterTurned = normalizeRotation(rotation) === 90 || normalizeRotation(rotation) === 270
  return quarterTurned ? { pageWidth: h, pageHeight: w } : { pageWidth: w, pageHeight: h }
}
