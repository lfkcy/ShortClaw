import { app, BrowserWindow, Menu, screen } from 'electron';
import { join } from 'node:path';
import { getSetting } from '../utils/store';
import type { PetStateSnapshot } from '../../shared/pet';
import { getPetCopy } from '../../shared/pet-copy';
import { isQuitting } from './app-state';

type PetWindowStoreState = {
  bounds: {
    x?: number;
    y?: number;
    width: number;
    height: number;
  };
};

type CreatePetWindowOptions = {
  getMainWindow: () => BrowserWindow | null;
  getPetState: () => PetStateSnapshot;
  onHideRequest: () => void;
};

const DEFAULT_WIDTH = 144;
const DEFAULT_HEIGHT = 156;
const DEFAULT_RIGHT_MARGIN = 24;
const DEFAULT_BOTTOM_OFFSET = 96;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let petWindowStore: any = null;

async function getPetWindowStore() {
  if (!petWindowStore) {
    const Store = (await import('electron-store')).default;
    petWindowStore = new Store<PetWindowStoreState>({
      name: 'pet-window-state',
      defaults: {
        bounds: {
          width: DEFAULT_WIDTH,
          height: DEFAULT_HEIGHT,
        },
      },
    });
  }
  return petWindowStore;
}

async function getSavedBounds(): Promise<PetWindowStoreState['bounds']> {
  const store = await getPetWindowStore();
  const bounds = store.get('bounds');
  const isLegacyBounds = bounds.width !== DEFAULT_WIDTH || bounds.height !== DEFAULT_HEIGHT;
  if (isLegacyBounds) {
    return getDefaultBounds();
  }

  const normalizedBounds = {
    width: DEFAULT_WIDTH,
    height: DEFAULT_HEIGHT,
    ...(bounds.x !== undefined ? { x: bounds.x } : {}),
    ...(bounds.y !== undefined ? { y: bounds.y } : {}),
  };

  if (normalizedBounds.x === undefined || normalizedBounds.y === undefined) {
    return getDefaultBounds();
  }

  const isVisible = screen.getAllDisplays().some((display) => {
    const { x, y, width, height } = display.workArea;
    return (
      normalizedBounds.x >= x &&
      normalizedBounds.x < x + width &&
      normalizedBounds.y >= y &&
      normalizedBounds.y < y + height
    );
  });

  return isVisible ? normalizedBounds : getDefaultBounds();
}

function getDefaultBounds(): PetWindowStoreState['bounds'] {
  const currentDisplay = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const { workArea } = currentDisplay;
  return {
    width: DEFAULT_WIDTH,
    height: DEFAULT_HEIGHT,
    x: workArea.x + workArea.width - DEFAULT_WIDTH - DEFAULT_RIGHT_MARGIN,
    y: workArea.y + workArea.height - DEFAULT_HEIGHT - DEFAULT_BOTTOM_OFFSET,
  };
}

async function saveWindowBounds(win: BrowserWindow): Promise<void> {
  const store = await getPetWindowStore();
  const bounds = win.getBounds();
  store.set('bounds', {
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
  });
}

function resolvePetRouteUrl(): string {
  if (process.env.VITE_DEV_SERVER_URL) {
    return `${process.env.VITE_DEV_SERVER_URL}#/pet`;
  }
  return '';
}

export class PetWindowController {
  private petWindow: BrowserWindow | null = null;
  private currentState: PetStateSnapshot;

  constructor(private readonly options: CreatePetWindowOptions) {
    this.currentState = options.getPetState();
  }

  getState(): PetStateSnapshot {
    return this.currentState;
  }

  isVisible(): boolean {
    return Boolean(this.petWindow && !this.petWindow.isDestroyed() && this.petWindow.isVisible());
  }

  async show(): Promise<void> {
    const win = await this.ensureWindow();
    win.showInactive();
    this.pushState();
  }

  async hide(): Promise<void> {
    if (!this.petWindow || this.petWindow.isDestroyed()) {
      return;
    }
    this.petWindow.hide();
  }

  async destroy(): Promise<void> {
    if (!this.petWindow || this.petWindow.isDestroyed()) {
      this.petWindow = null;
      return;
    }
    const win = this.petWindow;
    this.petWindow = null;
    win.destroy();
  }

  focusMainWindow(): void {
    const mainWindow = this.options.getMainWindow();
    if (!mainWindow || mainWindow.isDestroyed()) {
      return;
    }

    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    mainWindow.show();
    mainWindow.focus();
  }

  updateState(snapshot: PetStateSnapshot): void {
    this.currentState = snapshot;
    this.pushState();
  }

  getBounds(): { x: number; y: number } | null {
    if (!this.petWindow || this.petWindow.isDestroyed()) {
      return null;
    }

    const { x, y } = this.petWindow.getBounds();
    return { x, y };
  }

  moveTo(x: number, y: number): void {
    if (!this.petWindow || this.petWindow.isDestroyed()) {
      return;
    }

    this.petWindow.setPosition(Math.round(x), Math.round(y));
  }

  private async ensureWindow(): Promise<BrowserWindow> {
    if (this.petWindow && !this.petWindow.isDestroyed()) {
      return this.petWindow;
    }

    const savedBounds = await getSavedBounds();
    const preloadPath = join(__dirname, '../preload/index.js');
    const win = new BrowserWindow({
      width: savedBounds.width,
      height: savedBounds.height,
      x: savedBounds.x,
      y: savedBounds.y,
      minWidth: DEFAULT_WIDTH,
      minHeight: DEFAULT_HEIGHT,
      maxWidth: DEFAULT_WIDTH,
      maxHeight: DEFAULT_HEIGHT,
      frame: false,
      transparent: true,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      alwaysOnTop: true,
      movable: true,
      skipTaskbar: true,
      hasShadow: false,
      show: false,
      backgroundColor: '#00000000',
      webPreferences: {
        preload: preloadPath,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: false,
      },
    });

    win.on('close', (event) => {
      if (!isQuitting()) {
        event.preventDefault();
        this.options.onHideRequest();
      }
    });

    win.on('move', () => {
      void saveWindowBounds(win);
    });

    win.webContents.on('context-menu', () => {
      void this.openContextMenu(win);
    });

    win.on('closed', () => {
      if (this.petWindow === win) {
        this.petWindow = null;
      }
    });

    const devUrl = resolvePetRouteUrl();
    if (devUrl) {
      await win.loadURL(devUrl);
    } else {
      await win.loadFile(join(__dirname, '../../dist/index.html'), { hash: '/pet' });
    }

    this.petWindow = win;
    this.pushState();
    return win;
  }

  private pushState(): void {
    if (!this.petWindow || this.petWindow.isDestroyed()) {
      return;
    }
    this.petWindow.webContents.send('pet:state-changed', this.currentState);
  }

  private async openContextMenu(win: BrowserWindow): Promise<void> {
    const copy = getPetCopy(await getSetting('language'));
    const contextMenu = Menu.buildFromTemplate([
      {
        label: copy.menuOpen,
        click: () => this.focusMainWindow(),
      },
      {
        label: copy.menuHide,
        click: () => {
          this.options.onHideRequest();
        },
      },
      {
        type: 'separator',
      },
      {
        label: copy.menuQuit,
        click: () => {
          app.quit();
        },
      },
    ]);
    contextMenu.popup({ window: win });
  }
}
