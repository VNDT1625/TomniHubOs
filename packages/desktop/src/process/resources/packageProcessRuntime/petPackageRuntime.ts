/**
 * Fixed Main host for the reviewed desktop-pet package. The settings bridge
 * stores preferences here, while window control exists only while the package
 * lifecycle has admitted the Pet runtime.
 */

import { ProcessConfig } from '@process/utils/initStorage';
import type { PetSize } from '@process/pet/petTypes';

type PetRuntimeOperations = Readonly<{
  isSupported: () => boolean;
  create: () => void;
  destroy: () => void;
  resize: (size: PetSize) => void;
  setDnd: (dnd: boolean) => void;
  setConfirmEnabled: (enabled: boolean) => void;
}>;

let operations: PetRuntimeOperations | undefined;

const requirePetPackage = (): PetRuntimeOperations => {
  if (!operations) throw new Error('PET_PACKAGE_INACTIVE');
  return operations;
};

export const activatePetPackageRuntime = async (next: PetRuntimeOperations): Promise<void> => {
  operations = next;
  if ((await ProcessConfig.get('pet.enabled')) !== true) return;
  if (!next.isSupported()) {
    console.warn('[PetPackage] Desktop pet is not supported in headless mode');
    return;
  }
  next.create();
};

export const deactivatePetPackageRuntime = (): void => {
  operations?.destroy();
  operations = undefined;
};

export const setPetPackageEnabled = async (enabled: boolean): Promise<void> => {
  const runtime = requirePetPackage();
  if (enabled && !runtime.isSupported()) {
    console.warn('[PetPackage] Desktop pet is not supported in headless mode');
    return;
  }
  await ProcessConfig.set('pet.enabled', enabled);
  if (enabled) runtime.create();
  else runtime.destroy();
};

export const setPetPackageSize = async (size: PetSize): Promise<void> => {
  await ProcessConfig.set('pet.size', size);
  requirePetPackage().resize(size);
};

export const setPetPackageDnd = async (dnd: boolean): Promise<void> => {
  await ProcessConfig.set('pet.dnd', dnd);
  requirePetPackage().setDnd(dnd);
};

export const setPetPackageConfirmEnabled = async (enabled: boolean): Promise<void> => {
  await ProcessConfig.set('pet.confirmEnabled', enabled);
  requirePetPackage().setConfirmEnabled(enabled);
};
