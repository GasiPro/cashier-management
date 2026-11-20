import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { getActivated } from '../../data/settings/settings.api';
import { AppMode } from '../../data/settings/settings.model';
import { ModeStore } from './mode.store';
/** Login is only reachable once the mode has been chosen. */
export const modeSelectedGuard: CanActivateFn = async () => {
  const store = inject(ModeStore);
  const router = inject(Router);
  return (await store.load()) ? true : router.createUrlTree(['/mode']);
};
/** The mode page is only for an activated install that has no mode yet. */
export const modePageGuard: CanActivateFn = async () => {
  const store = inject(ModeStore);
  const router = inject(Router);
  try {
    if (!(await getActivated())) return router.createUrlTree(['/activation']);
  } catch (e) {
    console.error('failed to read activation status', e);
    return router.createUrlTree(['/activation']);
  }
  return (await store.load()) ? router.createUrlTree(['/login']) : true;
};
/** Keeps the routes of the other mode unreachable. */
export const modeGuard =
  (allowed: AppMode): CanActivateFn =>
  async () => {
    const store = inject(ModeStore);
    const router = inject(Router);
    return (await store.load()) === allowed ? true : router.createUrlTree(['/login']);
  };
