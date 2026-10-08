import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { SessionStore, UserRole } from './session.store';

export const roleGuard = (...allowedRoles: UserRole[]): CanActivateFn => () => {
  const session = inject(SessionStore);
  const router = inject(Router);
  const role = session.role();
  return role !== null && allowedRoles.includes(role) ? true : router.createUrlTree(['/login']);
};
