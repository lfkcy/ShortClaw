import { useEffect, useRef, useState, useCallback } from 'react'
import { OfficeState } from '@/lib/pixel-office/engine/officeState'
import { renderFrame } from '@/lib/pixel-office/engine/renderer'
import { syncAgentsToOffice, AgentActivity } from '@/lib/pixel-office/agentBridge'
import { EditorState } from '@/lib/pixel-office/editor/editorState'
import {
  paintTile, placeFurniture, removeFurniture, moveFurniture,
  rotateFurniture, canPlaceFurniture, expandLayout, getWallPlacementRow,
} from '@/lib/pixel-office/editor/editorActions'
import type { ExpandDirection } from '@/lib/pixel-office/editor/editorActions'
import { TILE_SIZE } from '@/lib/pixel-office/constants'
import { TileType, EditTool } from '@/lib/pixel-office/types'
import type { TileType as TileTypeVal, FloorColor, OfficeLayout } from '@/lib/pixel-office/types'
import { getCatalogEntry, isRotatable } from '@/lib/pixel-office/layout/furnitureCatalog'
import { createDefaultLayout, migrateLayoutColors } from '@/lib/pixel-office/layout/layoutSerializer'
import {
  playDoneSound, playBackgroundMusic, stopBackgroundMusic,
  skipToNextTrack, unlockAudio, setSoundEnabled, isSoundEnabled,
} from '@/lib/pixel-office/notificationSound'
import { loadCharacterPNGs, loadWallPNG } from '@/lib/pixel-office/sprites/pngLoader'
import { useTranslation } from 'react-i18next'
import { EditorToolbar } from './EditorToolbar'
import { EditActionBar } from './EditActionBar'

function mouseToTile(
  clientX: number, clientY: number, canvas: HTMLCanvasElement, office: OfficeState, zoom: number, pan: { x: number; y: number }
): { col: number; row: number; worldX: number; worldY: number } {
  const rect = canvas.getBoundingClientRect()
  const x = clientX - rect.left
  const y = clientY - rect.top
  const cols = office.layout.cols
  const rows = office.layout.rows
  const mapW = cols * TILE_SIZE * zoom
  const mapH = rows * TILE_SIZE * zoom
  const offsetX = (rect.width - mapW) / 2 + pan.x
  const offsetY = (rect.height - mapH) / 2 + pan.y
  const worldX = (x - offsetX) / zoom
  const worldY = (y - offsetY) / zoom
  const col = Math.floor(worldX / TILE_SIZE)
  const row = Math.floor(worldY / TILE_SIZE)
  return { col, row, worldX, worldY }
}

function getGhostBorderDirection(col: number, row: number, cols: number, rows: number): ExpandDirection | null {
  if (row === -1) return 'up'
  if (row === rows) return 'down'
  if (col === -1) return 'left'
  if (col === cols) return 'right'
  return null
}

const DESKTOP_CANVAS_ZOOM = 2.5
const MOBILE_CANVAS_ZOOM = 1.9
const AGENT_ACTIVITY_POLL_INTERVAL_MS = 1000

let cachedOfficeState: OfficeState | null = null
let cachedEditorState: EditorState | null = null
let cachedSavedLayout: OfficeLayout | null = null
let cachedAgents: AgentActivity[] = []
let cachedAgentIdMap = new Map<string, number>()
let cachedNextCharacterId = 1
let spriteAssetsPromise: Promise<void> | null = null

export default function PixelOfficePage() {
  const { t, i18n } = useTranslation()
  const locale = i18n.language
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const officeRef = useRef<OfficeState | null>(null)
  const editorRef = useRef<EditorState>(cachedEditorState ?? new EditorState())
  const agentIdMapRef = useRef<Map<string, number>>(new Map(cachedAgentIdMap))
  const nextIdRef = useRef<{ current: number }>({ current: cachedNextCharacterId })
  const zoomRef = useRef<number>(DESKTOP_CANVAS_ZOOM)
  const panRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 })
  const savedLayoutRef = useRef<OfficeLayout | null>(cachedSavedLayout)
  const animationFrameIdRef = useRef<number | null>(null)
  const officeReadyRef = useRef<boolean>(false)
  const prevAgentStatesRef = useRef<Map<string, string>>(new Map())

  const [agents, setAgents] = useState<AgentActivity[]>(cachedAgents)
  const [hoveredAgentId, setHoveredAgentId] = useState<number | null>(null)
  const [isEditMode, setIsEditMode] = useState(false)
  const [soundOn, setSoundOn] = useState(true)
  const [editorTick, setEditorTick] = useState(0)
  const [officeReady, setOfficeReady] = useState(false)

  const forceEditorUpdate = useCallback(() => setEditorTick(t => t + 1), [])

  useEffect(() => {
    officeReadyRef.current = officeReady
  }, [officeReady])

  // Load layout
  useEffect(() => {
    const loadLayout = async () => {
      if (cachedOfficeState) {
        officeRef.current = cachedOfficeState
        savedLayoutRef.current = cachedSavedLayout
        if (!spriteAssetsPromise) {
          spriteAssetsPromise = Promise.all([loadCharacterPNGs(), loadWallPNG()]).then(() => undefined)
        }
        await spriteAssetsPromise
        setOfficeReady(true)
        return
      }
      try {
        const data = await window.electron.ipcRenderer.invoke('office:getLayout')
        if (data?.layout) {
          const migrated = migrateLayoutColors(data.layout)
          officeRef.current = new OfficeState(migrated, locale as 'zh-TW' | 'zh' | 'en')
          savedLayoutRef.current = migrated
        } else {
          officeRef.current = new OfficeState(undefined, locale as 'zh-TW' | 'zh' | 'en')
        }
      } catch {
        officeRef.current = new OfficeState(undefined, locale as 'zh-TW' | 'zh' | 'en')
      }
      cachedOfficeState = officeRef.current
      cachedSavedLayout = savedLayoutRef.current
      if (!spriteAssetsPromise) {
        spriteAssetsPromise = Promise.all([loadCharacterPNGs(), loadWallPNG()]).then(() => undefined)
      }
      await spriteAssetsPromise
      setOfficeReady(true)
    }
    loadLayout()

    const savedSound = localStorage.getItem('pixel-office-sound')
    if (savedSound !== null) {
      const enabled = savedSound !== 'false'
      setSoundOn(enabled)
      setSoundEnabled(enabled)
    }

    return () => {
      stopBackgroundMusic()
      cachedOfficeState = officeRef.current
      cachedEditorState = editorRef.current
      cachedSavedLayout = savedLayoutRef.current
      if (animationFrameIdRef.current !== null) {
        cancelAnimationFrame(animationFrameIdRef.current)
      }
    }
  }, [locale])

  // Game loop
  useEffect(() => {
    if (!canvasRef.current || !officeRef.current || !containerRef.current) return
    const canvas = canvasRef.current
    const office = officeRef.current
    const container = containerRef.current
    const editor = editorRef.current
    let lastTime = 0

    const render = (time: number) => {
      const dt = lastTime === 0 ? 0 : Math.min((time - lastTime) / 1000, 0.1)
      lastTime = time

      const width = container.clientWidth
      const height = container.clientHeight
      const dpr = window.devicePixelRatio || 1
      office.update(dt)

      canvas.width = width * dpr
      canvas.height = height * dpr
      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`

      const ctx = canvas.getContext('2d')
      if (ctx) {
        ctx.imageSmoothingEnabled = false
        ctx.scale(dpr, dpr)

        let editorRender = undefined
        if (editor.isEditMode) {
          const sel = editor.selectedFurnitureUid
          const selItem = sel ? office.layout.furniture.find(f => f.uid === sel) : null
          const selEntry = selItem ? getCatalogEntry(selItem.type) : null
          const ghostEntry = (editor.activeTool === EditTool.FURNITURE_PLACE)
            ? getCatalogEntry(editor.selectedFurnitureType) : null

          editorRender = {
            showGrid: true,
            ghostSprite: ghostEntry?.sprite ?? null,
            ghostCol: editor.ghostCol,
            ghostRow: editor.ghostRow,
            ghostValid: editor.ghostValid,
            selectedCol: selItem?.col ?? 0,
            selectedRow: selItem?.row ?? 0,
            selectedW: selEntry?.footprintW ?? 0,
            selectedH: selEntry?.footprintH ?? 0,
            hasSelection: !!selItem,
            isRotatable: selItem ? isRotatable(selItem.type) : false,
            deleteButtonBounds: null,
            rotateButtonBounds: null,
            showGhostBorder: editor.activeTool === EditTool.TILE_PAINT || editor.activeTool === EditTool.WALL_PAINT || editor.activeTool === EditTool.ERASE,
            ghostBorderHoverCol: editor.ghostCol,
            ghostBorderHoverRow: editor.ghostRow,
          }
        }

        renderFrame(ctx, width, height, office.tileMap, office.furniture, office.getCharacters(),
          zoomRef.current, panRef.current.x, panRef.current.y,
          { selectedAgentId: null, hoveredAgentId, hoveredTile: null, seats: office.seats, characters: office.characters },
          editorRender, office.layout.tileColors, office.layout.cols, office.layout.rows,
          undefined, undefined, undefined, true)
      }
      animationFrameIdRef.current = requestAnimationFrame(render)
    }
    animationFrameIdRef.current = requestAnimationFrame(render)
    return () => {
      if (animationFrameIdRef.current !== null) cancelAnimationFrame(animationFrameIdRef.current)
    }
  }, [hoveredAgentId, editorTick, officeReady, agents])

  // Poll for agent activity
  useEffect(() => {
    if (cachedAgents.length > 0) {
      setAgents(cachedAgents)
      if (officeRef.current && officeReadyRef.current) {
        syncAgentsToOffice(cachedAgents, officeRef.current, agentIdMapRef.current, nextIdRef.current)
      }
    }
    const fetchAgents = async () => {
      try {
        const data = await window.electron.ipcRenderer.invoke('office:getAgentActivity')
        const newAgents: AgentActivity[] = data?.agents || []
        setAgents(newAgents)
        cachedAgents = newAgents

        const office = officeRef.current
        if (office && officeReadyRef.current) {
          syncAgentsToOffice(newAgents, office, agentIdMapRef.current, nextIdRef.current)
          cachedAgentIdMap = new Map(agentIdMapRef.current)
          cachedNextCharacterId = nextIdRef.current.current
        }

        for (const agent of newAgents) {
          const prev = prevAgentStatesRef.current.get(agent.agentId)
          if (agent.state === 'waiting' && prev && prev !== 'waiting') {
            playDoneSound()
          }
        }
        const stateMap = new Map<string, string>()
        for (const a of newAgents) stateMap.set(a.agentId, a.state)
        prevAgentStatesRef.current = stateMap
      } catch (e) {
        console.error('Failed to fetch agents:', e)
      }
    }
    fetchAgents()
    const interval = setInterval(fetchAgents, AGENT_ACTIVITY_POLL_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [])

  // Editor helpers
  const applyEdit = useCallback((newLayout: OfficeLayout) => {
    const office = officeRef.current
    const editor = editorRef.current
    if (!office || newLayout === office.layout) return
    editor.pushUndo(office.layout)
    editor.clearRedo()
    editor.isDirty = true
    office.rebuildFromLayout(newLayout)
    forceEditorUpdate()
  }, [forceEditorUpdate])

  const handleUndo = useCallback(() => {
    const office = officeRef.current
    const editor = editorRef.current
    if (!office) return
    const prev = editor.popUndo()
    if (!prev) return
    editor.pushRedo(office.layout)
    office.rebuildFromLayout(prev)
    editor.isDirty = true
    editor.clearSelection()
    forceEditorUpdate()
  }, [forceEditorUpdate])

  const handleRedo = useCallback(() => {
    const office = officeRef.current
    const editor = editorRef.current
    if (!office) return
    const next = editor.popRedo()
    if (!next) return
    editor.pushUndo(office.layout)
    office.rebuildFromLayout(next)
    editor.isDirty = true
    editor.clearSelection()
    forceEditorUpdate()
  }, [forceEditorUpdate])

  const handleSave = useCallback(async () => {
    const office = officeRef.current
    const editor = editorRef.current
    if (!office) return
    try {
      await window.electron.ipcRenderer.invoke('office:saveLayout', { layout: office.layout })
      savedLayoutRef.current = office.layout
      editor.isDirty = false
      forceEditorUpdate()
    } catch (e) {
      console.error('Failed to save layout:', e)
    }
  }, [forceEditorUpdate])

  const handleReset = useCallback(() => {
    const office = officeRef.current
    const editor = editorRef.current
    if (!office) return
    const defaultLayout = savedLayoutRef.current || createDefaultLayout()
    editor.pushUndo(office.layout)
    editor.clearRedo()
    office.rebuildFromLayout(defaultLayout)
    editor.isDirty = false
    editor.clearSelection()
    forceEditorUpdate()
  }, [forceEditorUpdate])

  // Keyboard events
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const editor = editorRef.current
      const office = officeRef.current
      if (!editor.isEditMode || !office) return

      if (e.key === 'r' || e.key === 'R') {
        if (editor.selectedFurnitureUid) {
          applyEdit(rotateFurniture(office.layout, editor.selectedFurnitureUid, e.shiftKey ? 'ccw' : 'cw'))
        }
      } else if (e.key === 'z' && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
        e.preventDefault()
        handleUndo()
      } else if ((e.key === 'y' && (e.ctrlKey || e.metaKey)) || (e.key === 'z' && (e.ctrlKey || e.metaKey) && e.shiftKey)) {
        e.preventDefault()
        handleRedo()
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (editor.selectedFurnitureUid) {
          applyEdit(removeFurniture(office.layout, editor.selectedFurnitureUid))
          editor.clearSelection()
          forceEditorUpdate()
        }
      } else if (e.key === 'Escape') {
        if (editor.activeTool === EditTool.FURNITURE_PICK) {
          editor.activeTool = EditTool.FURNITURE_PLACE
        } else if (editor.selectedFurnitureUid) {
          editor.clearSelection()
        } else if (editor.activeTool !== EditTool.SELECT) {
          editor.activeTool = EditTool.SELECT
        } else {
          editor.isEditMode = false
          setIsEditMode(false)
        }
        forceEditorUpdate()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [applyEdit, handleUndo, handleRedo, forceEditorUpdate])

  // Toolbar callbacks
  const handleToolChange = useCallback((tool: EditTool) => {
    editorRef.current.activeTool = tool
    editorRef.current.clearSelection()
    forceEditorUpdate()
  }, [forceEditorUpdate])

  const handleTileTypeChange = useCallback((type: TileTypeVal) => {
    editorRef.current.selectedTileType = type
    forceEditorUpdate()
  }, [forceEditorUpdate])

  const handleFloorColorChange = useCallback((color: FloorColor) => {
    editorRef.current.floorColor = color
    forceEditorUpdate()
  }, [forceEditorUpdate])

  const handleWallColorChange = useCallback((color: FloorColor) => {
    editorRef.current.wallColor = color
    forceEditorUpdate()
  }, [forceEditorUpdate])

  const handleFurnitureTypeChange = useCallback((type: string) => {
    editorRef.current.selectedFurnitureType = type
    forceEditorUpdate()
  }, [forceEditorUpdate])

  const handleSelectedFurnitureColorChange = useCallback((color: FloorColor | null) => {
    const editor = editorRef.current
    const office = officeRef.current
    if (!office || !editor.selectedFurnitureUid) return
    const newLayout = {
      ...office.layout,
      furniture: office.layout.furniture.map(f =>
        f.uid === editor.selectedFurnitureUid ? { ...f, color: color ?? undefined } : f
      ),
    }
    applyEdit(newLayout)
  }, [applyEdit])

  const toggleEditMode = useCallback(() => {
    const editor = editorRef.current
    editor.isEditMode = !editor.isEditMode
    if (!editor.isEditMode) {
      editor.reset()
    }
    setIsEditMode(editor.isEditMode)
  }, [])

  const toggleSound = useCallback(() => {
    const newVal = !isSoundEnabled()
    setSoundEnabled(newVal)
    setSoundOn(newVal)
    localStorage.setItem('pixel-office-sound', String(newVal))
    if (newVal) {
      void playBackgroundMusic()
    } else {
      stopBackgroundMusic()
    }
  }, [])

  const editor = editorRef.current
  const selectedItem = editor.selectedFurnitureUid
    ? officeRef.current?.layout.furniture.find(f => f.uid === editor.selectedFurnitureUid) : null

  return (
    <div className="relative flex flex-col overflow-hidden h-full">
      <div className="flex items-center justify-between gap-2 p-3 border-b border-[var(--border)]">
        <span className="text-sm font-bold text-[var(--text)]">{t('pixelOffice.title')}</span>
        <div className="flex gap-2">
          <button onClick={toggleSound}
            className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
              soundOn ? 'bg-[var(--accent)]/10 border-[var(--accent)]/30 text-[var(--accent)]'
                : 'bg-[var(--card)] border-[var(--border)] text-[var(--text-muted)]'
            }`}>
            {soundOn ? '🔔' : '🔕'} {t('pixelOffice.sound')}
          </button>
          {soundOn && (
            <button onClick={skipToNextTrack}
              className="px-3 py-1.5 text-xs rounded-lg border transition-colors bg-[var(--card)] border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)]">
              ⏭
            </button>
          )}
          <button onClick={toggleEditMode}
            className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
              isEditMode ? 'bg-[var(--accent)]/10 border-[var(--accent)]/30 text-[var(--accent)]'
                : 'bg-[var(--card)] border-[var(--border)] text-[var(--text-muted)]'
            }`}>
            {isEditMode ? t('pixelOffice.exitEdit') : t('pixelOffice.editMode')}
          </button>
        </div>
      </div>

      <div ref={containerRef} className="flex-1 relative overflow-hidden bg-[#1a1a2e]">
        <canvas ref={canvasRef}
          onMouseMove={handleMouseMove}
          onMouseDown={handleMouseDown}
          onMouseUp={handleMouseUp}
          className="w-full h-full"
          style={{ touchAction: 'none' }} />
        {!officeReady && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-[#1a1a2e]/85">
            <div className="px-4 py-2 rounded-lg border border-[var(--border)] bg-[var(--card)] text-sm text-[var(--text-muted)]">
              {t('common.loading')}
            </div>
          </div>
        )}

        {isEditMode && (
          <>
            <EditActionBar
              isDirty={editor.isDirty}
              canUndo={editor.undoStack.length > 0}
              canRedo={editor.redoStack.length > 0}
              onUndo={handleUndo}
              onRedo={handleRedo}
              onSave={handleSave}
              onReset={handleReset} />
            <EditorToolbar
              activeTool={editor.activeTool}
              selectedTileType={editor.selectedTileType}
              selectedFurnitureType={editor.selectedFurnitureType}
              selectedFurnitureUid={editor.selectedFurnitureUid}
              selectedFurnitureColor={selectedItem?.color ?? null}
              floorColor={editor.floorColor}
              wallColor={editor.wallColor}
              onToolChange={handleToolChange}
              onTileTypeChange={handleTileTypeChange}
              onFloorColorChange={handleFloorColorChange}
              onWallColorChange={handleWallColorChange}
              onSelectedFurnitureColorChange={handleSelectedFurnitureColorChange}
              onFurnitureTypeChange={handleFurnitureTypeChange}
              onDeleteFurniture={() => {
                const office = officeRef.current
                const editor = editorRef.current
                if (!office || !editor.selectedFurnitureUid) return
                applyEdit(removeFurniture(office.layout, editor.selectedFurnitureUid))
                editor.clearSelection()
                forceEditorUpdate()
              }} />
          </>
        )}
      </div>
    </div>
  )
}
