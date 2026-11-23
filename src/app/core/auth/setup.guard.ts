import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { getActivated } from '../../data/settings/settings.api';
import { ModeStore } from './mode.store';
async function isSetupComplete(modeStore: ModeStore): Promise<boolean> {
  try {
    return (await getActivated()) && (await modeStore.load()) !== null;
  } catch (e) {
    console.error('failed to read setup status', e);
    return false;
  }
}
export const setupGuard: CanActivateFn = async () => {
  const modeStore = inject(ModeStore);
  const router = inject(Router);
  return (await isSetupComplete(modeStore)) ? true : router.createUrlTree(['/setup']);
};
export const setupPageGuard: CanActivateFn = async () => {
  const modeStore = inject(ModeStore);
  const router = inject(Router);
  return (await isSetupComplete(modeStore)) ? router.createUrlTree(['/login']) : true;
};
