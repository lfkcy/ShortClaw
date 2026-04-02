export const PET_STATUSES = ['idle', 'working', 'error'] as const;
export type PetStatus = (typeof PET_STATUSES)[number];

export const PET_RESTORE_POLICIES = ['always_show', 'remember_last_visibility'] as const;
export type DesktopPetRestorePolicy = (typeof PET_RESTORE_POLICIES)[number];

export type PetErrorReason = 'gateway-error' | 'activity-fetch-failed';

export type PetStateSnapshot = Readonly<{
  status: PetStatus;
  updatedAt: number;
  reason: PetErrorReason | null;
}>;

export function createPetStateSnapshot(
  status: PetStatus,
  reason: PetErrorReason | null = null,
  updatedAt = Date.now(),
): PetStateSnapshot {
  return {
    status,
    updatedAt,
    reason,
  };
}
