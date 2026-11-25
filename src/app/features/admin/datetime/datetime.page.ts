import { Component, OnDestroy, OnInit, computed, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { errorMessage } from '../../../core/error/error-messages';
import {
  applyDateTimeSettings,
  systemTimeZone,
  timeZoneList,
  wallClock,
  zoneOffsetSecs,
  zonedToInstant,
} from '../../../core/display/datetime-settings';
import {
  DATE_FORMAT_CHOICES,
  DEFAULT_DATETIME_SETTINGS,
  DateFormat,
  DateTimeSettings,
} from '../../../data/settings/datetime.model';
import * as settingsApi from '../../../data/settings/settings.api';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';
import { translate } from '../../../core/i18n/translate';
@Component({
  selector: 'app-admin-datetime',
  standalone: true,
  imports: [RouterLink, TranslatePipe],
  templateUrl: './datetime.page.html',
})
export class DateTimePage implements OnInit, OnDestroy {
  readonly dateFormatChoices = DATE_FORMAT_CHOICES;
  readonly timeZones = timeZoneList();
  loading = signal(true);
  saving = signal(false);
  statusMessage = signal('');
  statusIsError = signal(false);
  saved = signal<DateTimeSettings>(DEFAULT_DATETIME_SETTINGS);
  autoDraft = signal(true);
  timezoneDraft = signal(systemTimeZone());
  hour12Draft = signal(false);
  dateFormatDraft = signal<DateFormat>('long');
  dateDraft = signal('');
  timeDraft = signal('');
  manualEdited = signal(false);
  private clockInterval?: ReturnType<typeof setInterval>;
  dirty = computed(() => {
    const s = this.saved();
    return (
      this.autoDraft() !== s.auto ||
      this.hour12Draft() !== s.hour12 ||
      this.dateFormatDraft() !== s.dateFormat ||
      (!this.autoDraft() && (this.timezoneDraft() !== s.timezone || this.manualEdited()))
    );
  });
  ngOnInit(): void {
    void this.loadSettings();
    this.clockInterval = setInterval(() => this.tick(), 1000);
  }
  ngOnDestroy(): void {
    if (this.clockInterval) {
      clearInterval(this.clockInterval);
    }
  }
  private baseOffset(): number {
    const s = this.saved();
    return s.auto ? 0 : s.offsetSecs;
  }
  private tick(): void {
    if (this.manualEdited()) return;
    const auto = this.autoDraft();
    const clock = wallClock(Date.now() + (auto ? 0 : this.baseOffset() * 1000), auto ? undefined : this.timezoneDraft());
    this.dateDraft.set(clock.date);
    this.timeDraft.set(clock.time);
  }
  private applyDrafts(s: DateTimeSettings): void {
    this.autoDraft.set(s.auto);
    this.timezoneDraft.set(s.timezone || systemTimeZone());
    this.hour12Draft.set(s.hour12);
    this.dateFormatDraft.set(s.dateFormat);
    this.manualEdited.set(false);
    this.tick();
  }
  private async loadSettings(): Promise<void> {
    this.loading.set(true);
    try {
      const settings = await settingsApi.getDateTime();
      this.saved.set(settings);
      this.applyDrafts(settings);
    } catch (e) {
      console.error('failed to load date and time settings', e);
      this.setStatus(translate('Impossible de charger la date et l\'heure.'), true);
    } finally {
      this.loading.set(false);
    }
  }
  selectAuto(auto: boolean): void {
    this.autoDraft.set(auto);
    this.manualEdited.set(false);
    this.tick();
  }
  selectTimeZone(value: string): void {
    this.timezoneDraft.set(value);
    this.tick();
  }
  onDateInput(value: string): void {
    this.dateDraft.set(value);
    this.manualEdited.set(true);
  }
  onTimeInput(value: string): void {
    this.timeDraft.set(value);
    this.manualEdited.set(true);
  }
  resetDraft(): void {
    this.applyDrafts(this.saved());
    this.setStatus('', false);
  }
  async save(): Promise<void> {
    if (!this.dirty() || this.saving()) return;
    const auto = this.autoDraft();
    let offsetSecs = 0;
    let utcOffsetSecs = 0;
    if (!auto) {
      let instant: number;
      if (this.manualEdited()) {
        if (!this.dateDraft() || !this.timeDraft()) {
          this.setStatus(translate('Date ou heure invalide.'), true);
          return;
        }
        instant = zonedToInstant(this.dateDraft(), this.timeDraft(), this.timezoneDraft());
        offsetSecs = Math.round((instant - Date.now()) / 1000);
      } else {
        offsetSecs = this.baseOffset();
        instant = Date.now() + offsetSecs * 1000;
      }
      utcOffsetSecs = zoneOffsetSecs(instant, this.timezoneDraft());
    }
    this.saving.set(true);
    this.setStatus('', false);
    try {
      const settings = await settingsApi.setDateTime({
        auto,
        timezone: auto ? '' : this.timezoneDraft(),
        hour12: this.hour12Draft(),
        dateFormat: this.dateFormatDraft(),
        offsetSecs,
        utcOffsetSecs,
      });
      this.saved.set(settings);
      this.applyDrafts(settings);
      applyDateTimeSettings(settings);
      this.setStatus(translate('Date et heure enregistrées.'), false);
    } catch (e) {
      console.error('failed to save date and time settings', e);
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
