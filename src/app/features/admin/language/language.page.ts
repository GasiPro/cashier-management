import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { activeLocale, setLocaleSelection } from '../../../core/i18n/locale';
import {
  DEFAULT_LOCALE_SETTINGS,
  LANGUAGE_CHOICES,
  LocaleSettings,
  OTHER_REGION,
  regionChoices,
} from '../../../data/settings/locale.model';
import { PendingStore } from '../../../data/pending/pending.store';
import * as settingsApi from '../../../data/settings/settings.api';
import { PendingFab } from '../../../shared/ui/pending-fab/pending-fab';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';
import { translate } from '../../../core/i18n/translate';
const LOCALE_KEY = 'locale';
@Component({
  selector: 'app-admin-language',
  standalone: true,
  imports: [RouterLink, PendingFab, TranslatePipe],
  templateUrl: './language.page.html',
})
export class LanguagePage implements OnInit, OnDestroy {
  private readonly pending = inject(PendingStore);
  readonly languageChoices = LANGUAGE_CHOICES;
  readonly regionOptions = computed(() => [
    { value: OTHER_REGION, label: translate('Par défaut') },
    ...regionChoices(activeLocale()),
  ]);
  loading = signal(true);
  statusMessage = signal('');
  statusIsError = signal(false);
  saved = signal<LocaleSettings>(DEFAULT_LOCALE_SETTINGS);
  languageDraft = signal(DEFAULT_LOCALE_SETTINGS.language);
  regionDraft = signal(DEFAULT_LOCALE_SETTINGS.region);
  dirty = computed(
    () =>
      this.languageDraft() !== this.saved().language || this.regionDraft() !== this.saved().region,
  );
  ngOnInit(): void {
    void this.loadSettings();
  }
  readonly staged = computed(() => this.pending.get(LOCALE_KEY) !== undefined);
  ngOnDestroy(): void {
    this.pending.discard();
    if (this.dirty()) setLocaleSelection(this.saved());
  }
  private applyDrafts(value: LocaleSettings): void {
    this.languageDraft.set(value.language);
    this.regionDraft.set(value.region);
  }
  private async loadSettings(silent = false): Promise<void> {
    if (!silent) this.loading.set(true);
    try {
      const value = await settingsApi.getLocale();
      this.saved.set(value);
      this.applyDrafts(value);
    } catch (e) {
      console.error('failed to load language and region settings', e);
      this.setStatus(translate('Impossible de charger la langue et la région.'), true);
    } finally {
      if (!silent) this.loading.set(false);
    }
  }
  selectLanguage(code: string): void {
    this.languageDraft.set(code);
    this.preview();
  }
  selectRegion(code: string): void {
    this.regionDraft.set(code);
    this.preview();
  }
  private preview(): void {
    setLocaleSelection({ language: this.languageDraft(), region: this.regionDraft() });
  }
  resetDraft(): void {
    this.pending.unstage(LOCALE_KEY);
    this.applyDrafts(this.saved());
    setLocaleSelection(this.saved());
    this.setStatus('', false);
  }
  onApplied(): void {
    void this.loadSettings(true);
    this.setStatus(translate('Modifications appliquées.'), false);
  }
  save(): void {
    if (!this.dirty()) {
      this.pending.unstage(LOCALE_KEY);
      return;
    }
    const value: LocaleSettings = { language: this.languageDraft(), region: this.regionDraft() };
    const before = this.saved();
    const lines: string[] = [];
    if (value.language !== before.language) {
      const label = this.languageChoices.find((c) => c.value === value.language)?.label ?? value.language;
      lines.push(`${translate('Langue')} : ${label}`);
    }
    if (value.region !== before.region) {
      const label = this.regionOptions().find((c) => c.value === value.region)?.label ?? value.region;
      lines.push(`${translate('Région')} : ${label}`);
    }
    this.setStatus('', false);
    this.pending.stage({
      key: LOCALE_KEY,
      payload: value,
      counter: lines,
      cashier: lines,
      apply: async () => {
        setLocaleSelection(await settingsApi.setLocale(value));
      },
    });
  }
  private setStatus(message: string, isError: boolean): void {
    this.statusMessage.set(message);
    this.statusIsError.set(isError);
  }
}
