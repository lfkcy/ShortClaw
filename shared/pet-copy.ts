import { resolveSupportedLanguage, type LanguageCode } from './language';
import type { PetStatus } from './pet';

type PetCopy = Readonly<{
  menuOpen: string;
  menuHide: string;
  menuQuit: string;
  status: Readonly<Record<PetStatus, string>>;
}>;

const PET_COPY_BY_LANGUAGE = {
  en: {
    menuOpen: 'Open ShortClaw',
    menuHide: 'Hide Pet',
    menuQuit: 'Quit ShortClaw',
    status: {
      idle: 'Idle',
      working: 'Working',
      error: 'Error',
    },
  },
  zh: {
    menuOpen: '打开 ShortClaw',
    menuHide: '隐藏桌宠',
    menuQuit: '退出 ShortClaw',
    status: {
      idle: '空闲',
      working: '工作中',
      error: '异常',
    },
  },
  ja: {
    menuOpen: 'ShortClaw を開く',
    menuHide: 'デスクトップペットを隠す',
    menuQuit: 'ShortClaw を終了',
    status: {
      idle: '待機中',
      working: '作業中',
      error: '異常',
    },
  },
} as const satisfies Record<LanguageCode, PetCopy>;

export function getPetCopy(language: string | null | undefined): PetCopy {
  return PET_COPY_BY_LANGUAGE[resolveSupportedLanguage(language)];
}
