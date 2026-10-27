import { Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { of, timer } from 'rxjs';
import { map, switchMap, take } from 'rxjs/operators';

const RETRY_SECONDS = /(\d+)(\s*seconde\(s\))/;

/**
 * Returns the message as-is, except for lock messages such as
 * "Réessayez dans 9 seconde(s)": those count down once per second and
 * become empty when the delay is over.
 */
export function withRetryCountdown(message: Signal<string>): Signal<string> {
  const display$ = toObservable(message).pipe(
    switchMap((text) => {
      const match = RETRY_SECONDS.exec(text);
      if (!match) return of(text);
      const seconds = Number(match[1]);
      return timer(0, 1000).pipe(
        take(seconds + 1),
        map((elapsed) => {
          const left = seconds - elapsed;
          return left > 0 ? text.replace(RETRY_SECONDS, `${left}$2`) : '';
        }),
      );
    }),
  );
  return toSignal(display$, { initialValue: message() });
}
