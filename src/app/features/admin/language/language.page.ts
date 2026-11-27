import { Component, OnDestroy, OnInit, computed, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { errorMessage } from '../../../core/error/error-messages';
import { activeLocale, setLocaleSelection } from '../../../core/i18n/locale';
import {
  DEFAULT_LOCALE_SETTINGS,
  LANGUAGE_CHOICES,
  LocaleSettings,
  OTHER_REGION,
  regionChoices,
} from '../../../data/settings/locale.model';
import * as settingsApi from '../../../data/settings/settings.api';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';
import { translate } from '../../../core/i18n/translate';
@Component({
  selector: 'app-admin-language',
  standalone: true,
  imports: [RouterLink, TranslatePipe],
  templateUrl: './language.page.html',
})
export class LanguagePage implements OnInit, OnDestroy {
  readonly languageChoices = LANGUAGE_CHOICES;
  readonly regionOptions = computed(() => [
    ...regionChoices(activeLocale()),
    { value: OTHER_REGION, label: translate('Autre') },
  ]);
  loading = signal(true);
  saving = signal(false);
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
  ngOnDestroy(): void {
    if (this.dirty()) setLocaleSelection(this.saved());
  }
  private applyDrafts(value: LocaleSettings): void {
    this.languageDraft.set(value.language);
    this.regionDraft.set(value.region);
  }
  private async loadSettings(): Promise<void> {
    this.loading.set(true);
    try {
      const value = await settingsApi.getLocale();
      this.saved.set(value);
      this.applyDrafts(value);
    } catch (e) {
      console.error('failed to load language and region settings', e);
      this.setStatus(translate('Impossible de charger la langue et la région.'), true);
    } finally {
      this.loading.set(false);
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
    this.applyDrafts(this.saved());
    setLocaleSelection(this.saved());
    this.setStatus('', false);
  }
  async save(): Promise<void> {
    if (!this.dirty() || this.saving()) return;
    this.saving.set(true);
    this.setStatus('', false);
    try {
      const value = await settingsApi.setLocale({
        language: this.languageDraft(),
        region: this.regionDraft(),
      });
      this.saved.set(value);
      this.applyDrafts(value);
      setLocaleSelection(value);
      this.setStatus(translate('Langue et région enregistrées.'), false);
    } catch (e) {
      console.error('failed to save language and region settings', e);
      this.setStatus(errorMessage(e, translate('Échec de l\'enregistrement. Réessayez.')), true);
    } finally {
      this.saving.set(false);
    }
  }
  private setStatus(message: string, isError: boolean): void {
    this.statusMessage.set(message);
    this.statusIsError.set(isError);
  }
}
