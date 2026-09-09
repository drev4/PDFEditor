import { ref } from 'vue'
import { defineStore } from 'pinia'

export const useDrawingStore = defineStore('drawing', () => {
  // State
  const gridEnabled = ref(false)
  const gridSize = ref(20)
  const snapToGrid = ref(false)
  const activeDrawingTool = ref<string | null>('cursor')
  const drawingToolbarPosition = ref({ x: 80, y: 150 })

  // Actions
  const toggleGrid = () => {
    gridEnabled.value = !gridEnabled.value
  }

  /**
   * Turning the magnet on shows the grid (features/0051).
   *
   * The two flags are independent, so a field could be snapping to lines nobody
   * had asked to see — a magnet whose grid is invisible looks like the editor
   * moving fields on its own. Turning it off leaves the grid alone: somebody who
   * wants the lines as a guide and no snapping is asking for something coherent.
   */
  const toggleSnapToGrid = () => {
    snapToGrid.value = !snapToGrid.value
    if (snapToGrid.value) gridEnabled.value = true
  }

  const setActiveDrawingTool = (toolId: string | null) => {
    activeDrawingTool.value = toolId
  }

  const updateDrawingToolbarPosition = (position: { x: number, y: number }) => {
    drawingToolbarPosition.value = position
  }

  return {
    // State
    gridEnabled,
    gridSize,
    snapToGrid,
    activeDrawingTool,
    drawingToolbarPosition,

    // Actions
    toggleGrid,
    toggleSnapToGrid,
    setActiveDrawingTool,
    updateDrawingToolbarPosition
  }
}, {
  persist: false
})
