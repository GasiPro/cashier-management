import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { SessionStore } from './session.store';

/**
 * Blocks arriving on the login page through browser history (back button,
 * mouse/keyboard back) while a session is active: the login page clears the
 * session on init, so going "back" to it would silently log the user out.
 * Explicit navigations to /login (disconnect, registration failure) still work.
 */
export const loginGuard: CanActivateFn = () => {
  const session = inject(SessionStore);
  const router = inject(Router);
  const fromHistory = router.getCurrentNavigation()?.trigger === 'popstate';
  return !(session.isAuthenticated() && fromHistory);
};
