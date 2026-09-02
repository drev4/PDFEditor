import { describe, it, expect } from 'vitest'
import {
  rotateFieldRect,
  unrotateFieldPoint,
  unrotatedPageSize,
  type FieldRect
} from './pdfCoordinates'

// An A4-ish page at the base scale, unrotated.
const PAGE_W = 600
const PAGE_H = 800

describe('rotateFieldRect', () => {
  const rect: FieldRect = { x: 100, y: 50, width: 200, height: 30 }

  it('leaves the rect alone when the page is not rotated', () => {
    expect(rotateFieldRect(rect, PAGE_W, PAGE_H, 0)).toEqual(rect)
  })

  it('swaps the axes at 90 degrees', () => {
    // Turning the page clockwise: what was 50px from the top is now 50px from
    // the right, and a wide field becomes a tall one.
    expect(rotateFieldRect(rect, PAGE_W, PAGE_H, 90)).toEqual({
      x: PAGE_H - (50 + 30), // 720
      y: 100,
      width: 30,
      height: 200
    })
  })

  it('mirrors both axes at 180 degrees and keeps the shape', () => {
    expect(rotateFieldRect(rect, PAGE_W, PAGE_H, 180)).toEqual({
      x: PAGE_W - (100 + 200), // 300
      y: PAGE_H - (50 + 30), // 720
      width: 200,
      height: 30
    })
  })

  it('swaps the axes the other way at 270 degrees', () => {
    expect(rotateFieldRect(rect, PAGE_W, PAGE_H, 270)).toEqual({
      x: 50,
      y: PAGE_W - (100 + 200), // 300
      width: 30,
      height: 200
    })
  })

  it('applies the scale factor after rotating, not before', () => {
    // Order matters: scaling first would multiply the page dimensions used to
    // mirror the coordinate, and put the field off the page.
    expect(rotateFieldRect(rect, PAGE_W, PAGE_H, 90, 2)).toEqual({
      x: 1440,
      y: 200,
      width: 60,
      height: 400
    })
  })

  it('keeps a rotated field inside the rotated page', () => {
    // The corner case that shows a sign error: a field flush against the
    // bottom-right must land flush against a corner, never outside.
    const corner: FieldRect = { x: PAGE_W - 200, y: PAGE_H - 30, width: 200, height: 30 }

    for (const rotation of [0, 90, 180, 270]) {
      const turned = rotateFieldRect(corner, PAGE_W, PAGE_H, rotation)
      const viewW = rotation === 90 || rotation === 270 ? PAGE_H : PAGE_W
      const viewH = rotation === 90 || rotation === 270 ? PAGE_W : PAGE_H

      expect(turned.x).toBeGreaterThanOrEqual(0)
      expect(turned.y).toBeGreaterThanOrEqual(0)
      expect(turned.x + turned.width).toBeLessThanOrEqual(viewW)
      expect(turned.y + turned.height).toBeLessThanOrEqual(viewH)
    }
  })

  it('treats 360 as 0 and a negative rotation as its positive equivalent', () => {
    expect(rotateFieldRect(rect, PAGE_W, PAGE_H, 360)).toEqual(rect)
    expect(rotateFieldRect(rect, PAGE_W, PAGE_H, -90))
      .toEqual(rotateFieldRect(rect, PAGE_W, PAGE_H, 270))
  })
})

describe('unrotateFieldPoint', () => {
  // This is the half that decides where a click *saves*, so it is the half that
  // silently corrupts data if it disagrees with the other one.
  it('is the inverse of rotateFieldRect for the rect origin', () => {
    const rect: FieldRect = { x: 137, y: 209, width: 200, height: 30 }

    for (const rotation of [0, 90, 180, 270]) {
      const turned = rotateFieldRect(rect, PAGE_W, PAGE_H, rotation)

      // The screen point that corresponds to the stored origin depends on which
      // corner rotation moved it to; taking the rect back through the inverse
      // must land on the original corner set.
      const back = unrotateFieldPoint(turned, PAGE_W, PAGE_H, rotation)
      const backFar = unrotateFieldPoint(
        { x: turned.x + turned.width, y: turned.y + turned.height },
        PAGE_W,
        PAGE_H,
        rotation
      )

      const xs = [back.x, backFar.x].sort((a, b) => a - b)
      const ys = [back.y, backFar.y].sort((a, b) => a - b)

      expect(xs[0]).toBeCloseTo(rect.x, 6)
      expect(xs[1]).toBeCloseTo(rect.x + rect.width, 6)
      expect(ys[0]).toBeCloseTo(rect.y, 6)
      expect(ys[1]).toBeCloseTo(rect.y + rect.height, 6)
    }
  })

  it('divides out the scale factor', () => {
    expect(unrotateFieldPoint({ x: 200, y: 100 }, PAGE_W, PAGE_H, 0, 2))
      .toEqual({ x: 100, y: 50 })
  })
})

describe('unrotatedPageSize', () => {
  it('returns the canvas as-is when upright', () => {
    expect(unrotatedPageSize(900, 1200, 0, 1.5))
      .toEqual({ pageWidth: 600, pageHeight: 800 })
  })

  it('swaps the axes back at a quarter turn', () => {
    // pdf.js renders a 90-degree page into a canvas whose width is the page's
    // height. Reading that canvas as the page size is the mistake this exists
    // to stop.
    expect(unrotatedPageSize(1200, 900, 90, 1.5))
      .toEqual({ pageWidth: 600, pageHeight: 800 })
    expect(unrotatedPageSize(1200, 900, 270, 1.5))
      .toEqual({ pageWidth: 600, pageHeight: 800 })
  })
})
