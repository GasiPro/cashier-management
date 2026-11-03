import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { getActivated } from '../../data/settings/settings.api';
async function isActivated(): Promise<boolean> {
  try {
    return await getActivated();
  } catch (e) {
    console.error('failed to read activation status', e);
    return false;
  }
}
export const activationGuard: CanActivateFn = async () => {
  const router = inject(Router);
  return (await isActivated()) ? true : router.createUrlTree(['/activation']);
};
export const activationPageGuard: CanActivateFn = async () => {
  const router = inject(Router);
  return (await isActivated()) ? router.createUrlTree(['/login']) : true;
};
