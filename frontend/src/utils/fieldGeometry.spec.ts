import { describe, it, expect } from 'vitest'
import { alignRects, distributeRects, bandBetween, idsWithinBand, snapToStep, type Rect } from './fieldGeometry'

/**
 * Align and distribute (features/0048).
 *
 * Pure geometry, tested apart from any store: these run on **stored**
 * coordinates — the upright, base-scale space the backend embeds against — and
 * never on screen pixels, which is why nothing here knows about rotation, zoom
 * or the canvas.
 */

const rect = (id: string, x: number, y: number, width = 100, height = 20): Rect =>
  ({ id, x, y, width, height })

const byId = (result: Array<{ id: string; x: number; y: number }>) =>
  Object.fromEntries(result.map(r => [r.id, { x: r.x, y: r.y }]))

describe('alignRects', () => {
  it('aligns left edges to the leftmost field', () => {
    const result = byId(alignRects([rect('a', 40, 0), rect('b', 10, 30), rect('c', 90, 60)], 'left'))

    expect(result.a?.x).toBe(10)
    expect(result.b?.x).toBe(10)
    expect(result.c?.x).toBe(10)
  })

  it('aligns right edges to the rightmost edge, not the rightmost x', () => {
    // `b` starts further left but is wide enough to reach furthest right. The
    // target is 10 + 300 = 310, so a 100-wide field lands at 210.
    const result = byId(alignRects([rect('a', 40, 0, 100), rect('b', 10, 30, 300)], 'right'))

    expect(result.b?.x).toBe(10)
    expect(result.a?.x).toBe(210)
  })

  it('aligns top edges', () => {
    const result = byId(alignRects([rect('a', 0, 40), rect('b', 0, 10)], 'top'))

    expect(result.a?.y).toBe(10)
    expect(result.b?.y).toBe(10)
  })

  it('aligns bottom edges to the lowest edge', () => {
    const result = byId(alignRects([rect('a', 0, 40, 100, 20), rect('b', 0, 10, 100, 80)], 'bottom'))

    // Bottom of `b` is 90, so `a` (20 high) lands at 70.
    expect(result.b?.y).toBe(10)
    expect(result.a?.y).toBe(70)
  })

  it('centres on the horizontal middle of the bounding box', () => {
    // Bounding box runs 0..200, so the centre is 100.
    const result = byId(alignRects([rect('a', 0, 0, 100), rect('b', 100, 30, 100)], 'center-x'))

    expect(result.a?.x).toBe(50)
    expect(result.b?.x).toBe(50)
  })

  it('centres on the vertical middle of the bounding box', () => {
    // The box runs 0..100, so its middle is 50 and a 20-high field lands at 40.
    const result = byId(alignRects([rect('a', 0, 0, 100, 20), rect('b', 0, 80, 100, 20)], 'center-y'))

    expect(result.a?.y).toBe(40)
    expect(result.b?.y).toBe(40)
  })

  it('leaves the other axis alone', () => {
    const result = byId(alignRects([rect('a', 40, 7), rect('b', 10, 33)], 'left'))

    expect(result.a?.y).toBe(7)
    expect(result.b?.y).toBe(33)
  })

  it('does nothing with fewer than two fields', () => {
    expect(alignRects([rect('a', 40, 0)], 'left')).toEqual([])
    expect(alignRects([], 'left')).toEqual([])
  })
})

describe('distributeRects', () => {
  it('spaces centres evenly and keeps the two outermost fields where they are', () => {
    const result = byId(distributeRects(
      [rect('a', 0, 0, 100), rect('b', 130, 0, 100), rect('c', 400, 0, 100)],
      'horizontal'
    ))

    // Centres run 50 -> 450, so the middle one belongs at 250, x = 200.
    expect(result.a?.x).toBe(0)
    expect(result.c?.x).toBe(400)
    expect(result.b?.x).toBe(200)
  })

  it('distributes vertically by centre too', () => {
    const result = byId(distributeRects(
      [rect('a', 0, 0, 100, 20), rect('b', 0, 20, 100, 20), rect('c', 0, 200, 100, 20)],
      'vertical'
    ))

    expect(result.a?.y).toBe(0)
    expect(result.c?.y).toBe(200)
    expect(result.b?.y).toBe(100)
  })

  it('does not care what order the fields arrive in', () => {
    const result = byId(distributeRects(
      [rect('c', 400, 0, 100), rect('a', 0, 0, 100), rect('b', 130, 0, 100)],
      'horizontal'
    ))

    expect(result.b?.x).toBe(200)
  })

  it('does nothing with fewer than three fields', () => {
    expect(distributeRects([rect('a', 0, 0), rect('b', 100, 0)], 'horizontal')).toEqual([])
  })
})

/**
 * The marquee's geometry (features/0050).
 *
 * The one part of this file that is not in stored coordinates: the band and the
 * rectangles only have to be in the *same* space, and the editor passes both in
 * overlay pixels — where the mouse is, and where `rotateFieldRect` has already
 * put the fields.
 */
describe('bandBetween', () => {
  it('normalises a drag that goes up and to the left', () => {
    expect(bandBetween({ x: 120, y: 90 }, { x: 20, y: 10 })).toEqual({
      x: 20,
      y: 10,
      width: 100,
      height: 80
    })
  })

  it('is the same band whichever corner the drag started from', () => {
    expect(bandBetween({ x: 20, y: 10 }, { x: 120, y: 90 })).toEqual(
      bandBetween({ x: 120, y: 90 }, { x: 20, y: 10 })
    )
  })
})

describe('idsWithinBand', () => {
  const rects = [
    rect('a', 0, 0, 100, 20),
    rect('b', 0, 40, 100, 20),
    rect('c', 400, 400, 100, 20)
  ]

  it('catches a field the band only touches, not just ones it swallows', () => {
    // A band drawn down the middle of a column of checkboxes overlaps every one
    // of them and contains none. Containment would select nothing here, which is
    // the whole gesture this feature exists for.
    const band = bandBetween({ x: 40, y: 10 }, { x: 60, y: 50 })

    expect(idsWithinBand(band, rects)).toEqual(['a', 'b'])
  })

  it('leaves out a field the band does not reach', () => {
    const band = bandBetween({ x: 0, y: 0 }, { x: 200, y: 100 })

    expect(idsWithinBand(band, rects)).toEqual(['a', 'b'])
  })

  it('touching edges is not an overlap', () => {
    // The band ends exactly where `a` begins. Selecting it would make a band
    // dragged *next to* a field select it.
    const band = bandBetween({ x: -50, y: 0 }, { x: 0, y: 20 })

    expect(idsWithinBand(band, rects)).toEqual([])
  })

  it('catches nothing when the band is empty page', () => {
    const band = bandBetween({ x: 200, y: 200 }, { x: 300, y: 300 })

    expect(idsWithinBand(band, rects)).toEqual([])
  })
})

/**
 * The magnet (features/0051). Shared by the two drags in the editor, which pass
 * **different steps** — the previews work in canvas pixels and a field is
 * stored in base-scale units.
 */
describe('snapToStep', () => {
  it('rounds to the nearest multiple', () => {
    expect(snapToStep(147, 20)).toBe(140)
    expect(snapToStep(153, 20)).toBe(160)
    expect(snapToStep(150, 20)).toBe(160)
  })

  it('works on negative values, so a field dragged past the origin still lands', () => {
    expect(snapToStep(-13, 20)).toBe(-20)
  })

  it('is the identity when there is no grid, rather than dividing by zero', () => {
    expect(snapToStep(147, 0)).toBe(147)
    expect(snapToStep(147, -20)).toBe(147)
  })

  /**
   * The step a field passes at twice the base scale: a visible line every 20
   * canvas pixels is every 10 stored units. Snapping the stored value to 20
   * would be a different grid from the one on the screen.
   */
  it('lands on the visible grid when the caller divides by the scale', () => {
    expect(snapToStep(147, 20 / 2)).toBe(150)
    expect(snapToStep(147, 20 / 0.5)).toBe(160)
  })
})
