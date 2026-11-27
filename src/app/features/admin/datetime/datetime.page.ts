import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
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
import { PendingStore } from '../../../data/pending/pending.store';
import * as settingsApi from '../../../data/settings/settings.api';
import { PendingFab } from '../../../shared/ui/pending-fab/pending-fab';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';
import { translate } from '../../../core/i18n/translate';
const DATETIME_KEY = 'datetime';
@Component({
  selector: 'app-admin-datetime',
  standalone: true,
  imports: [RouterLink, PendingFab, TranslatePipe],
  templateUrl: './datetime.page.html',
})
export class DateTimePage implements OnInit, OnDestroy {
  private readonly pending = inject(PendingStore);
  readonly dateFormatChoices = DATE_FORMAT_CHOICES;
  readonly timeZones = timeZoneList();
  loading = signal(true);
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
  readonly staged = computed(() => this.pending.get(DATETIME_KEY) !== undefined);
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
    this.pending.discard();
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
  private async loadSettings(silent = false): Promise<void> {
    if (!silent) this.loading.set(true);
    try {
      const settings = await settingsApi.getDateTime();
      this.saved.set(settings);
      this.applyDrafts(settings);
    } catch (e) {
      console.error('failed to load date and time settings', e);
      this.setStatus(translate('Impossible de charger la date et l\'heure.'), true);
    } finally {
      if (!silent) this.loading.set(false);
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
    this.pending.unstage(DATETIME_KEY);
    this.applyDrafts(this.saved());
    this.setStatus('', false);
  }
  onApplied(): void {
    void this.loadSettings(true);
    this.setStatus(translate('Modifications appliquées.'), false);
  }
  private changeLines(value: DateTimeSettings): string[] {
    const s = this.saved();
    const lines: string[] = [];
    if (value.auto !== s.auto) {
      lines.push(`${translate('Mode')} : ${value.auto ? translate('Automatique') : translate('Manuel')}`);
    }
    if (!value.auto && (value.timezone !== s.timezone || this.manualEdited())) {
      lines.push(`${translate('Fuseau horaire')} : ${value.timezone}`);
    }
    if (!value.auto && this.manualEdited()) {
      lines.push(`${translate('Date')} : ${this.dateDraft()} ${this.timeDraft()}`);
    }
    if (value.hour12 !== s.hour12) {
      lines.push(`${translate('Format de l\'heure')} : ${value.hour12 ? translate('12 heures') : translate('24 heures')}`);
    }
    if (value.dateFormat !== s.dateFormat) {
      const label = DATE_FORMAT_CHOICES.find((c) => c.value === value.dateFormat)?.label ?? value.dateFormat;
      lines.push(`${translate('Format de la date')} : ${translate(label)}`);
    }
    return lines;
  }
  save(): void {
    if (!this.dirty()) {
      this.pending.unstage(DATETIME_KEY);
      return;
    }
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
    const value: DateTimeSettings = {
      auto,
      timezone: auto ? '' : this.timezoneDraft(),
      hour12: this.hour12Draft(),
      dateFormat: this.dateFormatDraft(),
      offsetSecs,
      utcOffsetSecs,
    };
    const lines = this.changeLines(value);
    this.setStatus('', false);
    this.pending.stage({
      key: DATETIME_KEY,
      payload: value,
      counter: lines,
      cashier: lines,
      apply: async () => {
        applyDateTimeSettings(await settingsApi.setDateTime(value));
      },
    });
  }
  private setStatus(message: string, isError: boolean): void {
    this.statusMessage.set(message);
    this.statusIsError.set(isError);
  }
}
