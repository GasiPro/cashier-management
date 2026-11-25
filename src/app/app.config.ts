import {
  ApplicationConfig,
  ErrorHandler,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { provideRouter } from '@angular/router';
import { routes } from './app.routes';
import { GlobalErrorHandler } from './core/error/global-error-handler';
import { I18n } from './core/i18n/i18n.service';
import { loadMachineIdentity } from './core/realtime/ws-client';
import { OrganizationStore } from './data/settings/organization.store';
export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    { provide: ErrorHandler, useClass: GlobalErrorHandler },
    provideAppInitializer(() => inject(I18n).init()),
    provideAppInitializer(loadMachineIdentity),
    provideAppInitializer(() => inject(OrganizationStore).load()),
    provideRouter(routes)
  ]
};
