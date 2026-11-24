import { Component, OnDestroy, OnInit, WritableSignal, computed, signal } from '@angular/core';
import { Router } from '@angular/router';
import { ModeStore } from '../../core/auth/mode.store';
import {
  CONTACT_EMAIL,
  MAX_DISPLAY_NAME_LEN,
  MAX_USERNAME_LEN,
  MIN_PASSWORD_LEN,
} from '../../core/config/app.constants';
import { errorMessage } from '../../core/error/error-messages';
import { ipcEndSetup } from '../../core/ipc/tauri-ipc';
import { createInitialAdmin } from '../../data/account/account.api';
import { OrganizationStore } from '../../data/settings/organization.store';
import { activate, getActivated } from '../../data/settings/settings.api';
import {
  AppMode,
  Organization,
  PHONE_REGIONS,
} from '../../data/settings/settings.model';
import { PasswordInput } from '../../shared/ui/password-input/password-input';
import { credentialsRuleError, formatPhone, isValidEmail, isValidPhone } from '../../shared/utils/validators';
type SetupStep = 'key' | 'organization' | 'admin' | 'mode';
interface StepInfo {
  id: SetupStep;
  label: string;
}
interface ModeChoice {
  value: AppMode;
  label: string;
  title: string;
  description: string;
}
const LAUNCH_MIN_DELAY_MS = 6000;
const CONTACT_CLOSE_DELAY_MS = 10_000;
const KEY_SEGMENT_COUNT = 4;
const KEY_SEGMENT_LEN = 4;
const OTHER_PREFIX = 'other';
const MAX_ORGANIZATION_NAME_LEN = 60;
function cleanKey(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '');
}
@Component({
  selector: 'app-setup',
  standalone: true,
  imports: [PasswordInput],
  templateUrl: './setup.page.html',
})
export class SetupPage implements OnInit, OnDestroy {
  readonly steps: StepInfo[] = [
    { id: 'key', label: 'Clé de produit' },
    { id: 'organization', label: 'Organisation' },
    { id: 'admin', label: 'Administrateur' },
    { id: 'mode', label: 'Type de poste' },
  ];
  readonly choices: ModeChoice[] = [
    {
      value: 'caisse',
      label: 'Poste principal',
      title: 'Caisse',
      description: 'Caissier et administration. Ce poste héberge le serveur auquel les comptoirs se connectent.',
    },
    {
      value: 'comptoir',
      label: 'Poste service',
      title: 'Comptoir',
      description: 'Saisie des commandes clients, envoyées à la caisse par le réseau.',
    },
  ];
  readonly regions = PHONE_REGIONS;
  readonly otherPrefix = OTHER_PREFIX;
  readonly maxNameLen = MAX_ORGANIZATION_NAME_LEN;
  readonly maxUsernameLen = MAX_USERNAME_LEN;
  readonly maxDisplayNameLen = MAX_DISPLAY_NAME_LEN;
  readonly minPasswordLen = MIN_PASSWORD_LEN;
  readonly contactEmail = CONTACT_EMAIL;
  readonly segmentIndexes = Array.from({ length: KEY_SEGMENT_COUNT }, (_, i) => i);
  readonly ready = signal(false);
  readonly stepIndex = signal(0);
  readonly busy = signal(false);
  readonly launching = signal(false);
  readonly error = signal('');
  readonly segments = signal<string[]>(this.segmentIndexes.map(() => ''));
  readonly keyValidated = signal(false);
  readonly showContact = signal(false);
  readonly copied = signal(false);
  readonly orgName = signal('');
  readonly orgEmail = signal('');
  readonly prefixChoice = signal(OTHER_PREFIX);
  readonly customPrefix = signal('+');
  readonly phoneNumber = signal('');
  readonly adminDisplayName = signal('');
  readonly adminUsername = signal('');
  readonly adminPassword = signal('');
  readonly adminPasswordConfirm = signal('');
  readonly showAdminPassword = signal(false);
  readonly selectedMode = signal<AppMode | null>(null);
  /** Full key in the XXXX-XXXX-XXXX-XXXX form expected by the backend; the dashes are added here, never typed. */
  readonly productKey = computed(() => this.segments().join('-'));
  readonly isKeyComplete = computed(() => this.segments().every((s) => s.length === KEY_SEGMENT_LEN));
  readonly phonePrefix = computed(() =>
    this.prefixChoice() === OTHER_PREFIX ? this.customPrefix() : this.prefixChoice(),
  );
  readonly currentStep = computed(() => this.steps[this.stepIndex()].id);
  readonly isLastStep = computed(() => this.stepIndex() === this.steps.length - 1);
  readonly canNext = computed(() => {
    switch (this.currentStep()) {
      case 'key':
        return this.keyValidated() || this.isKeyComplete();
      case 'mode':
        return this.selectedMode() !== null;
      default:
        return true;
    }
  });
  private contactTimer: ReturnType<typeof setTimeout> | null = null;
  constructor(
    private router: Router,
    private modeStore: ModeStore,
    private organization: OrganizationStore,
  ) {}
  async ngOnInit(): Promise<void> {
    try {
      this.keyValidated.set(await getActivated());
    } catch (e) {
      console.error('failed to read activation status', e);
    }
    const saved = await this.organization.load();
    if (saved) this.fillOrganization(saved);
    else this.prefixChoice.set(this.detectPrefix());
    this.stepIndex.set(!this.keyValidated() ? 0 : saved ? 2 : 1);
    this.ready.set(true);
  }
  ngOnDestroy(): void {
    this.clearContactTimer();
  }
  setField(field: WritableSignal<string>, event: Event): void {
    field.set((event.target as HTMLInputElement).value);
    this.error.set('');
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
  selectMode(value: AppMode): void {
    if (this.busy()) return;
    this.selectedMode.set(value);
    this.error.set('');
  }
  previous(): void {
    if (this.busy() || this.stepIndex() === 0) return;
    this.error.set('');
    this.stepIndex.update((i) => i - 1);
  }
  async next(event: Event): Promise<void> {
    event.preventDefault();
    if (this.busy() || !this.canNext()) return;
    this.busy.set(true);
    this.error.set('');
    try {
      switch (this.currentStep()) {
        case 'key':
          await this.submitKey();
          break;
        case 'organization':
          await this.submitOrganization();
          break;
        case 'admin':
          await this.submitAdmin();
          break;
        case 'mode':
          await this.submitMode();
          break;
      }
    } finally {
      this.busy.set(false);
    }
  }
  private async submitKey(): Promise<void> {
    if (!this.keyValidated()) {
      try {
        if (!(await activate(this.productKey()))) {
          this.error.set('Clé de produit invalide');
          return;
        }
      } catch (e) {
        console.error('activation failed', e);
        this.error.set('Activation impossible. Veuillez réessayer.');
        return;
      }
      this.keyValidated.set(true);
    }
    this.clearContactTimer();
    this.showContact.set(false);
    this.stepIndex.set(1);
  }
  private async submitOrganization(): Promise<void> {
    const problem = this.organizationProblem();
    if (problem) {
      this.error.set(problem);
      return;
    }
    try {
      await this.organization.save({
        name: this.orgName().trim(),
        email: this.orgEmail().trim(),
        phone: formatPhone(this.phonePrefix(), this.phoneNumber()),
      });
    } catch (e) {
      console.error('failed to save organization', e);
      this.error.set(errorMessage(e, "Impossible d'enregistrer l'organisation. Veuillez réessayer."));
      return;
    }
    if (await this.modeStore.load()) {
      await this.launch();
      return;
    }
    this.stepIndex.set(2);
  }
  private async submitAdmin(): Promise<void> {
    const problem = this.adminProblem();
    if (problem) {
      this.error.set(problem);
      return;
    }
    try {
      await createInitialAdmin({
        username: this.adminUsername().trim(),
        password: this.adminPassword(),
        display_name: this.adminDisplayName().trim(),
      });
    } catch (e) {
      console.error('failed to create initial admin', e);
      this.error.set(errorMessage(e, "Impossible de créer l'administrateur. Veuillez réessayer."));
      return;
    }
    this.stepIndex.set(3);
  }
  private async submitMode(): Promise<void> {
    const value = this.selectedMode();
    if (!value) return;
    try {
      await this.modeStore.choose(value);
    } catch (e) {
      console.error('failed to set app mode', e);
      this.error.set(errorMessage(e, "Impossible d'enregistrer le mode. Veuillez réessayer."));
      return;
    }
    await this.launch();
  }
  private async launch(): Promise<void> {
    this.launching.set(true);
    await new Promise<void>((resolve) => setTimeout(resolve, LAUNCH_MIN_DELAY_MS));
    try {
      await ipcEndSetup();
    } catch (e) {
      console.error('failed to leave setup window', e);
    }
    await this.router.navigate(['/login'], { replaceUrl: true });
  }
  private organizationProblem(): string {
    if (!this.orgName().trim()) return "Veuillez saisir le nom de l'organisation.";
    if (!isValidEmail(this.orgEmail())) return 'Adresse e-mail invalide.';
    if (!isValidPhone(this.phonePrefix(), this.phoneNumber())) return 'Numéro de téléphone invalide.';
    return '';
  }
  private adminProblem(): string {
    const displayName = this.adminDisplayName().trim();
    if (!displayName) return 'Veuillez saisir le nom affiché.';
    if (displayName.length > MAX_DISPLAY_NAME_LEN) {
      return `Le nom affiché ne peut pas dépasser ${MAX_DISPLAY_NAME_LEN} caractères.`;
    }
    const rule = credentialsRuleError(this.adminUsername().trim(), this.adminPassword());
    if (rule) return rule;
    return this.adminPassword() === this.adminPasswordConfirm() ? '' : 'Les mots de passe ne correspondent pas.';
  }
  private fillOrganization(saved: Organization): void {
    this.orgName.set(saved.name);
    this.orgEmail.set(saved.email);
    const [prefix = '', ...number] = saved.phone.split(' ');
    if (PHONE_REGIONS.some((region) => region.prefix === prefix)) {
      this.prefixChoice.set(prefix);
    } else {
      this.prefixChoice.set(OTHER_PREFIX);
      this.customPrefix.set(prefix || '+');
    }
    this.phoneNumber.set(number.join(''));
  }
  private detectPrefix(): string {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const code = new Intl.Locale(navigator.language).region;
    const region =
      PHONE_REGIONS.find((r) => r.zones.includes(zone)) ?? PHONE_REGIONS.find((r) => !!code && r.codes.includes(code));
    return region?.prefix ?? OTHER_PREFIX;
  }
  private focusSegment(index: number): void {
    document.getElementById(`key-seg-${index}`)?.focus();
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