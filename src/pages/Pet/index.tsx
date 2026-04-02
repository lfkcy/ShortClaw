import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { invokeIpc } from '@/lib/api-client';
import type { PetStateSnapshot } from '../../../shared/pet';
import { getPetCopy } from '../../../shared/pet-copy';

const SPRITE_COLUMNS = 6;
const SPRITE_RENDER_SIZE = 112;
const IDLE_FRAMES = [0, 1] as const;
const WORKING_FRAMES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] as const;
const ERROR_FRAMES = [4, 5] as const;
const DRAG_THRESHOLD = 6;

type DragSession = Readonly<{
  pointerId: number;
  startPointerX: number;
  startPointerY: number;
  startWindowX: number;
  startWindowY: number;
  moved: boolean;
}>;

function getFrameIndex(status: PetStateSnapshot['status'], tick: number): number {
  switch (status) {
    case 'working':
      return WORKING_FRAMES[tick % WORKING_FRAMES.length];
    case 'error':
      return ERROR_FRAMES[tick % ERROR_FRAMES.length];
    default:
      return IDLE_FRAMES[tick % IDLE_FRAMES.length];
  }
}

export function Pet() {
  const [petState, setPetState] = useState<PetStateSnapshot>({
    status: 'idle',
    updatedAt: Date.now(),
    reason: null,
  });
  const [tick, setTick] = useState(0);
  const dragSessionRef = useRef<DragSession | null>(null);

  useEffect(() => {
    const prevBodyBackground = document.body.style.background;
    const prevHtmlBackground = document.documentElement.style.background;
    document.body.style.background = 'transparent';
    document.documentElement.style.background = 'transparent';
    return () => {
      document.body.style.background = prevBodyBackground;
      document.documentElement.style.background = prevHtmlBackground;
    };
  }, []);

  useEffect(() => {
    void invokeIpc<PetStateSnapshot>('pet:get-state')
      .then((snapshot) => {
        setPetState(snapshot);
      })
      .catch(() => {});

    const unsubscribe = window.electron.ipcRenderer.on(
      'pet:state-changed',
      (...args: unknown[]) => {
        const nextState = args[0] as PetStateSnapshot | undefined;
        if (nextState) {
          setPetState(nextState);
        }
      }
    );

    return () => {
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      }
    };
  }, []);

  useEffect(() => {
    const intervalMs =
      petState.status === 'working' ? 120 : petState.status === 'error' ? 180 : 420;
    const timer = window.setInterval(() => {
      setTick((current) => current + 1);
    }, intervalMs);
    return () => {
      window.clearInterval(timer);
    };
  }, [petState.status]);

  const petCopy = getPetCopy(document.documentElement.lang || navigator.language);
  const frameIndex = getFrameIndex(petState.status, tick);
  const spritePositionX = -(frameIndex % SPRITE_COLUMNS) * SPRITE_RENDER_SIZE;
  const spritePositionY = 0;

  const spriteStyle = useMemo(
    () => ({
      width: `${SPRITE_RENDER_SIZE}px`,
      height: `${SPRITE_RENDER_SIZE}px`,
      backgroundImage: 'url(/assets/pets/star-working-spritesheet-grid.png)',
      backgroundRepeat: 'no-repeat',
      backgroundPosition: `${spritePositionX}px ${spritePositionY}px`,
      backgroundSize: `${SPRITE_COLUMNS * SPRITE_RENDER_SIZE}px auto`,
      filter:
        petState.status === 'error'
          ? 'drop-shadow(0 0 18px rgba(239, 68, 68, 0.46)) saturate(1.1)'
          : petState.status === 'working'
            ? 'drop-shadow(0 0 14px rgba(34, 197, 94, 0.26))'
            : 'drop-shadow(0 0 8px rgba(15, 23, 42, 0.16))',
      transform:
        petState.status === 'error'
          ? `translateX(${tick % 2 === 0 ? -2 : 2}px)`
          : petState.status === 'working'
            ? `translateY(${tick % 2 === 0 ? -2 : 0}px)`
            : `translateY(${tick % 2 === 0 ? 0 : -1}px)`,
      transition: 'transform 120ms ease-out, filter 160ms ease-out',
    }),
    [petState.status, spritePositionX, spritePositionY, tick]
  );

  const handleOpenMainWindow = () => {
    void invokeIpc<{ success: boolean }>('pet:focus-main-window');
  };

  const startDrag = async (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) {
      return;
    }

    const bounds = await invokeIpc<{ x: number; y: number } | null>('pet:drag-start');
    if (!bounds) {
      return;
    }

    dragSessionRef.current = {
      pointerId: event.pointerId,
      startPointerX: event.screenX,
      startPointerY: event.screenY,
      startWindowX: bounds.x,
      startWindowY: bounds.y,
      moved: false,
    };

    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const moveDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const currentSession = dragSessionRef.current;
    if (!currentSession || currentSession.pointerId !== event.pointerId) {
      return;
    }

    const deltaX = event.screenX - currentSession.startPointerX;
    const deltaY = event.screenY - currentSession.startPointerY;
    const moved =
      currentSession.moved ||
      Math.abs(deltaX) >= DRAG_THRESHOLD ||
      Math.abs(deltaY) >= DRAG_THRESHOLD;

    dragSessionRef.current = {
      ...currentSession,
      moved,
    };

    if (!moved) {
      return;
    }

    window.electron.ipcRenderer.send('pet:drag-move', {
      x: currentSession.startWindowX + deltaX,
      y: currentSession.startWindowY + deltaY,
    });
  };

  const endDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const currentSession = dragSessionRef.current;
    if (!currentSession || currentSession.pointerId !== event.pointerId) {
      return;
    }

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    dragSessionRef.current = null;

    if (!currentSession.moved) {
      handleOpenMainWindow();
    }
  };

  const cancelDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    dragSessionRef.current = null;
  };

  return (
    <div className="h-screen w-screen overflow-hidden bg-transparent">
      <div className="flex h-full w-full items-end justify-center pb-3">
        <button
          type="button"
          onPointerDown={startDrag}
          onPointerMove={moveDrag}
          onPointerUp={endDrag}
          onPointerCancel={cancelDrag}
          className="group relative flex select-none items-end justify-center bg-transparent outline-none"
          aria-label={`${petCopy.menuOpen} (${petCopy.status[petState.status]})`}
          title={`ShortClaw: ${petCopy.status[petState.status]}`}
        >
          <div
            className={`pointer-events-none absolute bottom-2 h-14 w-16 rounded-full blur-xl transition-opacity duration-150 ${
              petState.status === 'error'
                ? 'bg-red-500/28'
                : petState.status === 'working'
                  ? 'bg-emerald-500/24'
                  : 'bg-slate-500/16'
            }`}
          />
          <div className="pointer-events-none relative z-10">
            <div style={spriteStyle} />
          </div>
        </button>
      </div>
    </div>
  );
}
