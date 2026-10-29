import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { SessionStore, UserRole } from './session.store';

export const roleGuard = (...allowedRoles: UserRole[]): CanActivateFn => () => {
  const session = inject(SessionStore);
  const router = inject(Router);
  const role = session.role();
  if (role === null) return router.createUrlTree(['/login']);
  // An authenticated user reaching another role's route (e.g. a stale history
  // entry) stays where they are instead of being sent to the login page.
  return allowedRoles.includes(role);
};
