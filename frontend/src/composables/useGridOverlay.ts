import type { Ref } from 'vue'
import { useDrawingStore } from '@/stores/drawing.store'

export function useGridOverlay(
  canvasRef: Ref<HTMLCanvasElement | null>,
  gridCanvasRef: Ref<HTMLCanvasElement | null>
) {
  const drawingStore = useDrawingStore()

  const drawGrid = () => {
    if (!gridCanvasRef.value || !canvasRef.value) return

    const gridCanvas = gridCanvasRef.value
    const mainCanvas = canvasRef.value

    gridCanvas.width = mainCanvas.width
    gridCanvas.height = mainCanvas.height

    const ctx = gridCanvas.getContext('2d')
    if (!ctx) return

    ctx.clearRect(0, 0, gridCanvas.width, gridCanvas.height)

    if (!drawingStore.gridEnabled) return

    const gridSize = drawingStore.gridSize

    ctx.strokeStyle = 'rgba(200, 200, 200, 0.3)'
    ctx.lineWidth = 1

    for (let x = 0; x <= gridCanvas.width; x += gridSize) {
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x, gridCanvas.height)
      ctx.stroke()
    }

    for (let y = 0; y <= gridCanvas.height; y += gridSize) {
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(gridCanvas.width, y)
      ctx.stroke()
    }
  }

  return {
    drawGrid
  }
}
