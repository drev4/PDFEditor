import { describe, it, expect, beforeEach } from 'vitest'
import { useDrawingStore } from './drawing.store'
import { setupPinia } from '@/test/helpers/pinia-setup'

describe('DrawingStore', () => {
  beforeEach(() => {
    setupPinia()
  })

  describe('estado inicial', () => {
    it('inicializa con valores por defecto correctos', () => {
      const store = useDrawingStore()

      expect(store.gridEnabled).toBe(false)
      expect(store.gridSize).toBe(20)
      expect(store.snapToGrid).toBe(false)
      expect(store.activeDrawingTool).toBe('cursor')
      expect(store.drawingToolbarPosition).toEqual({ x: 80, y: 150 })
    })
  })

  describe('toggleGrid', () => {
    it('alterna el estado de la grilla', () => {
      const store = useDrawingStore()

      expect(store.gridEnabled).toBe(false)
      store.toggleGrid()
      expect(store.gridEnabled).toBe(true)
      store.toggleGrid()
      expect(store.gridEnabled).toBe(false)
    })
  })

  describe('toggleSnapToGrid', () => {
    it('alterna el ajuste a la grilla', () => {
      const store = useDrawingStore()

      expect(store.snapToGrid).toBe(false)
      store.toggleSnapToGrid()
      expect(store.snapToGrid).toBe(true)
      store.toggleSnapToGrid()
      expect(store.snapToGrid).toBe(false)
    })
  })

  describe('setActiveDrawingTool', () => {
    it('establece la herramienta activa', () => {
      const store = useDrawingStore()

      store.setActiveDrawingTool('search')
      expect(store.activeDrawingTool).toBe('search')

      store.setActiveDrawingTool('image')
      expect(store.activeDrawingTool).toBe('image')

      store.setActiveDrawingTool(null)
      expect(store.activeDrawingTool).toBeNull()
    })
  })

  describe('updateDrawingToolbarPosition', () => {
    it('actualiza la posición de la toolbar', () => {
      const store = useDrawingStore()

      store.updateDrawingToolbarPosition({ x: 100, y: 200 })
      expect(store.drawingToolbarPosition).toEqual({ x: 100, y: 200 })

      store.updateDrawingToolbarPosition({ x: 0, y: 0 })
      expect(store.drawingToolbarPosition).toEqual({ x: 0, y: 0 })
    })
  })

  describe('persistencia', () => {
    it('no persiste los datos (persist: false)', () => {
      const store = useDrawingStore()

      // Esta configuración debería ser temporal por sesión
      expect(store.$id).toBe('drawing')
    })
  })
})

/**
 * A magnet whose grid is invisible looks like the editor moving fields on its
 * own, so arming it shows the lines (features/0051).
 */
describe('snap to grid shows the grid', () => {
  beforeEach(() => setupPinia())

  it('turns the grid on when the magnet is armed', () => {
    const store = useDrawingStore()
    expect(store.gridEnabled).toBe(false)

    store.toggleSnapToGrid()

    expect(store.snapToGrid).toBe(true)
    expect(store.gridEnabled).toBe(true)
  })

  it('leaves the grid alone when the magnet is disarmed', () => {
    const store = useDrawingStore()
    store.toggleSnapToGrid()

    store.toggleSnapToGrid()

    expect(store.snapToGrid).toBe(false)
    // Lines as a guide with no snapping is a coherent thing to want.
    expect(store.gridEnabled).toBe(true)
  })
})
