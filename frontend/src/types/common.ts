export type DrawingTool = 'cursor' | 'text' | 'image' | 'rectangle' | 'circle' | 'line'

export interface Position {
  x: number
  y: number
}

export interface Size {
  width: number
  height: number
}

export interface Rectangle extends Position, Size {}

export interface ColorRGB {
  r: number
  g: number
  b: number
}

export interface ImagePreview {
  dataUrl: string
  file: File
  x: number
  y: number
  width: number
  height: number
  originalWidth: number
  originalHeight: number
  maintainAspectRatio: boolean
}

export interface TextPreview {
  text: string
  x: number
  y: number
  fontSize: number
  color: string
  isBold: boolean
  isItalic: boolean
}

export interface ResizeHandle {
  type: 'nw' | 'ne' | 'sw' | 'se'
  cursor: string
}

export interface PDFOperationResult {
  success: boolean
  error?: string
  data?: any
}