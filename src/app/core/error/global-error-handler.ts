import { ErrorHandler, Injectable } from '@angular/core';
import { errorMessage } from './error-messages';
@Injectable()
export class GlobalErrorHandler implements ErrorHandler {
  handleError(error: unknown): void {
    console.error('Unhandled error:', errorMessage(error, '') || error);
  }
}
