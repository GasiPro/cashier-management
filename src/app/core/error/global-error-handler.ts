import { ErrorHandler, Injectable } from '@angular/core';
import { extractErrorText } from './error-messages';

@Injectable()
export class GlobalErrorHandler implements ErrorHandler {
  handleError(error: unknown): void {
    console.error('Unhandled error:', extractErrorText(error) || error);
  }
}
