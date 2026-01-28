import { vi } from 'vitest'

// Mock PDFDocument from pdf-lib
export const createMockPDFLibDocument = () => ({
  getPages: vi.fn().mockReturnValue([
    {
      getWidth: vi.fn().mockReturnValue(612),
      getHeight: vi.fn().mockReturnValue(792),
      drawText: vi.fn(),
      drawImage: vi.fn(),
      setFont: vi.fn(),
      setFontSize: vi.fn(),
      setFontColor: vi.fn()
    }
  ]),
  embedPng: vi.fn().mockResolvedValue({
    width: 100,
    height: 100,
    scale: vi.fn().mockReturnValue({ width: 100, height: 100 })
  }),
  embedJpg: vi.fn().mockResolvedValue({
    width: 100,
    height: 100,
    scale: vi.fn().mockReturnValue({ width: 100, height: 100 })
  }),
  embedFont: vi.fn().mockResolvedValue({
    widthOfTextAtSize: vi.fn().mockReturnValue(100)
  }),
  save: vi.fn().mockResolvedValue(new ArrayBuffer(100)),
  addPage: vi.fn(),
  removePage: vi.fn(),
  insertPage: vi.fn()
})

// Mock PDFDocument static methods
export const mockPDFLib = {
  PDFDocument: {
    load: vi.fn().mockResolvedValue(createMockPDFLibDocument()),
    create: vi.fn().mockResolvedValue(createMockPDFLibDocument())
  },
  StandardFonts: {
    Helvetica: 'Helvetica',
    HelveticaBold: 'Helvetica-Bold',
    TimesRoman: 'Times-Roman'
  },
  rgb: vi.fn((r, g, b) => ({ r, g, b })),
  degrees: vi.fn((deg) => deg * (Math.PI / 180))
}

export default mockPDFLib
