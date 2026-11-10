import { Component, OnDestroy, computed, signal } from '@angular/core';
import { Router } from '@angular/router';
import { activate } from '../../data/settings/settings.api';
const LAUNCH_MIN_DELAY_MS = 6000;
const CONTACT_EMAIL = 'fanambynana@duck.com';
const CONTACT_CLOSE_DELAY_MS = 10_000;
const KEY_SEGMENT_COUNT = 4;
const KEY_SEGMENT_LEN = 4;
/** Keeps only letters and digits, upper-cased, so a typed or pasted "-" is never part of a segment. */
function cleanKey(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '');
}
@Component({
  selector: 'app-activation',
  standalone: true,
  templateUrl: './activation.page.html',
})
export class ActivationPage implements OnDestroy {
  readonly contactEmail = CONTACT_EMAIL;
  readonly segmentIndexes = Array.from({ length: KEY_SEGMENT_COUNT }, (_, i) => i);
  readonly segments = signal<string[]>(this.segmentIndexes.map(() => ''));
  /** Full key in the XXXX-XXXX-XXXX-XXXX form expected by the backend; the dashes are added here, never typed. */
  readonly productKey = computed(() => this.segments().join('-'));
  readonly isKeyComplete = computed(() => this.segments().every((s) => s.length === KEY_SEGMENT_LEN));
  readonly error = signal('');
  readonly checking = signal(false);
  readonly launching = signal(false);
  readonly showContact = signal(false);
  readonly copied = signal(false);
  private contactTimer: ReturnType<typeof setTimeout> | null = null;
  constructor(private router: Router) {}
  ngOnDestroy(): void {
    this.clearContactTimer();
  }
  onSegmentInput(index: number, event: Event): void {
    const input = event.target as HTMLInputElement;
    const value = cleanKey(input.value).slice(0, KEY_SEGMENT_LEN);
    input.value = value;
    this.segments.update((list) => list.map((s, i) => (i === index ? value : s)));
    this.error.set('');
    if (value.length === KEY_SEGMENT_LEN && index < KEY_SEGMENT_COUNT - 1) {
      this.focusSegment(index + 1);
    }
  }
  onSegmentKeydown(index: number, event: KeyboardEvent): void {
    if (event.key === 'Backspace' && index > 0 && (event.target as HTMLInputElement).value === '') {
      event.preventDefault();
      this.focusSegment(index - 1);
    }
  }
  /** A pasted key (with or without dashes) is spread over the four segments. */
  onPaste(event: ClipboardEvent): void {
    event.preventDefault();
    const text = cleanKey(event.clipboardData?.getData('text') ?? '').slice(0, KEY_SEGMENT_COUNT * KEY_SEGMENT_LEN);
    if (!text) return;
    this.segments.set(this.segmentIndexes.map((i) => text.slice(i * KEY_SEGMENT_LEN, (i + 1) * KEY_SEGMENT_LEN)));
    this.error.set('');
    this.focusSegment(Math.min(Math.floor(text.length / KEY_SEGMENT_LEN), KEY_SEGMENT_COUNT - 1));
  }
  private focusSegment(index: number): void {
    document.getElementById(`key-seg-${index}`)?.focus();
  }
  /** Opens the contact message and (re)starts its auto-close countdown. */
  requestKey(): void {
    this.copied.set(false);
    this.showContact.set(true);
    this.startContactTimer();
  }
  async copyEmail(): Promise<void> {
    try {
      await navigator.clipboard.writeText(CONTACT_EMAIL);
      this.copied.set(true);
    } catch (e) {
      console.error('failed to copy email', e);
    }
    this.startContactTimer();
  }
  async submit(event: Event): Promise<void> {
    event.preventDefault();
    if (this.checking() || !this.isKeyComplete()) return;
    this.checking.set(true);
    this.error.set('');
    try {
      if (!(await activate(this.productKey()))) {
        this.error.set('Clé de produit invalide');
        return;
      }
    } catch (e) {
      console.error('activation failed', e);
      this.error.set('Activation impossible. Veuillez réessayer.');
      return;
    } finally {
      this.checking.set(false);
    }
    this.clearContactTimer();
    this.launching.set(true);
    await new Promise<void>((resolve) => setTimeout(resolve, LAUNCH_MIN_DELAY_MS));
    await this.router.navigate(['/login'], { replaceUrl: true });
  }
  private startContactTimer(): void {
    this.clearContactTimer();
    this.contactTimer = setTimeout(() => {
      this.showContact.set(false);
      this.contactTimer = null;
    }, CONTACT_CLOSE_DELAY_MS);
  }
  private clearContactTimer(): void {
    if (this.contactTimer) clearTimeout(this.contactTimer);
    this.contactTimer = null;
  }
}
