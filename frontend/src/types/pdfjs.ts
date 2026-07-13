export interface PDFPageViewport {
  height: number
  width: number
}

export interface PDFPageTextItem {
  str: string
  width: number
  height: number
  transform: [number, number, number, number, number, number]
  fontName?: string
}

export interface PDFPageTextContent {
  items: PDFPageTextItem[]
}

export interface PDFPage {
  getViewport(options: { scale: number; rotation?: number }): PDFPageViewport
  getTextContent(): Promise<PDFPageTextContent>
  render(context: { canvasContext: CanvasRenderingContext2D; viewport: PDFPageViewport }): PDFRenderTask
}

export interface PDFDocumentProxy {
  numPages: number
  getPage(pageNumber: number): Promise<PDFPage>
  destroy(): Promise<void>
}

export interface PDFRenderTask {
  cancel(): void
  promise: Promise<void>
}
