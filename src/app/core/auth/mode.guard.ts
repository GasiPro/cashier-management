import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AppMode } from '../../data/settings/settings.model';
import { ModeStore } from './mode.store';
export const modeGuard =
  (allowed: AppMode): CanActivateFn =>
  async () => {
    const store = inject(ModeStore);
    const router = inject(Router);
    return (await store.load()) === allowed ? true : router.createUrlTree(['/login']);
  };
