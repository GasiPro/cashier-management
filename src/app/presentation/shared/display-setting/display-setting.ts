import { Component, OnInit, OnDestroy, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { invoke } from '@tauri-apps/api/core';
import { Navbar } from '../navbar/navbar';
import { LeftSidebar } from '../sidebar/left-sidebar/left-sidebar';
import { BottomBar } from '../bottom-bar/bottom-bar';
const MIN_FONT_SIZE = 8;
const MAX_FONT_SIZE = 32;
const FONT_SIZE_STEP = 1;
const LS_USERNAME = 'gasipro:username';
const LS_DISPLAY_NAME = 'gasipro:displayName';
export type ThemeOption = 'clair' | 'sombre' | 'systeme';
interface ThemeChoice {
  value: ThemeOption;
  label: string;
}
const BACKGROUND_PRESETS: string[] = ['#FAFAFA', '#FFFFFF', '#F1F5F9', '#1E293B', '#0F172A'];
@Component({
  selector: 'app-display-setting',
  standalone: true,
  imports: [CommonModule, FormsModule, Navbar, LeftSidebar, BottomBar],
  templateUrl: './display-setting.html',
  styleUrl: './display-setting.css',
})
export class DisplaySetting implements OnInit, OnDestroy {
  readonly minFontSize = MIN_FONT_SIZE;
  readonly maxFontSize = MAX_FONT_SIZE;
  readonly backgroundPresets = BACKGROUND_PRESETS;
  readonly themeChoices: ThemeChoice[] = [
    { value: 'clair', label: 'Clair' },
    { value: 'sombre', label: 'Sombre' },
    { value: 'systeme', label: 'Système' },
  ];
  username = localStorage.getItem(LS_USERNAME) ?? 'Caisse';
  private displayName = localStorage.getItem(LS_DISPLAY_NAME) ?? '';
  /** Name shown in the navbar — the account display name when one exists, otherwise the username. */
  get displayLabel(): string {
    return this.displayName.trim() ? this.displayName : this.username;
  }
  currentTime = signal('');
  private clockInterval?: ReturnType<typeof setInterval>;
  loading = signal(true);
  saving = signal(false);
  statusMessage = signal('');
  statusIsError = signal(false);
  theme = signal<ThemeOption>('clair');
  themeDraft = signal<ThemeOption>('clair');
  backgroundColor = signal('#FFFFFF');
  backgroundColorDraft = signal('#FFFFFF');
  fontSize = signal(16);
  fontSizeDraft = signal(16);
  dirty = computed(
    () =>
      this.themeDraft() !== this.theme() ||
      this.backgroundColorDraft() !== this.backgroundColor() ||
      this.fontSizeDraft() !== this.fontSize(),
  );
  constructor(private router: Router) {}
  ngOnInit(): void {
    this.loadSettings();
    this.tick();
    this.clockInterval = setInterval(() => this.tick(), 1000);
  }
  ngOnDestroy(): void {
    if (this.clockInterval) {
      clearInterval(this.clockInterval);
    }
  }
  private tick(): void {
    const now = new Date();
    this.currentTime.set(
      now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    );
  }
  private async loadSettings(): Promise<void> {
    this.loading.set(true);
    try {
      const [theme, backgroundColor, fontSize] = await Promise.all([
        invoke<ThemeOption>('get_theme'),
        invoke<string>('get_background_color'),
        invoke<number>('get_font_size'),
      ]);
      this.theme.set(theme);
      this.themeDraft.set(theme);
      this.backgroundColor.set(backgroundColor);
      this.backgroundColorDraft.set(backgroundColor);
      this.fontSize.set(fontSize);
      this.fontSizeDraft.set(fontSize);
    } catch (e) {
      console.error('failed to load display settings', e);
      this.setStatus("Impossible de charger les réglages d'affichage.", true);
    } finally {
      this.loading.set(false);
    }
  }
  selectTheme(value: ThemeOption): void {
    this.themeDraft.set(value);
  }
  selectBackgroundPreset(value: string): void {
    this.backgroundColorDraft.set(value);
  }
  onBackgroundColorInput(value: string): void {
    this.backgroundColorDraft.set(value);
  }
  decrementFontSize(): void {
    this.fontSizeDraft.update((v) => Math.max(this.minFontSize, v - FONT_SIZE_STEP));
  }
  incrementFontSize(): void {
    this.fontSizeDraft.update((v) => Math.min(this.maxFontSize, v + FONT_SIZE_STEP));
  }
  onFontSizeInput(value: string): void {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return;
    const clamped = Math.min(this.maxFontSize, Math.max(this.minFontSize, Math.round(parsed)));
    this.fontSizeDraft.set(clamped);
  }
  resetDraft(): void {
    this.themeDraft.set(this.theme());
    this.backgroundColorDraft.set(this.backgroundColor());
    this.fontSizeDraft.set(this.fontSize());
    this.setStatus('', false);
  }
  async save(): Promise<void> {
    if (!this.dirty() || this.saving()) return;
    this.saving.set(true);
    this.setStatus('', false);
    try {
      const [theme, backgroundColor, fontSize] = await Promise.all([
        invoke<ThemeOption>('set_theme', { value: this.themeDraft() }),
        invoke<string>('set_background_color', { value: this.backgroundColorDraft() }),
        invoke<number>('set_font_size', { value: this.fontSizeDraft() }),
      ]);
      this.theme.set(theme);
      this.themeDraft.set(theme);
      this.backgroundColor.set(backgroundColor);
      this.backgroundColorDraft.set(backgroundColor);
      this.fontSize.set(fontSize);
      this.fontSizeDraft.set(fontSize);
      this.setStatus('Réglages d\'affichage enregistrés.', false);
    } catch (e) {
      console.error('failed to save display settings', e);
      const message = typeof e === 'string' ? e : "Échec de l'enregistrement. Réessayez.";
      this.setStatus(message, true);
    } finally {
      this.saving.set(false);
    }
  }
  private setStatus(message: string, isError: boolean): void {
    this.statusMessage.set(message);
    this.statusIsError.set(isError);
  }
  goBack(): void {
    this.router.navigate(['/reglages']);
  }
}