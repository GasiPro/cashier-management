/** quiet = history only · alert = stronger visual · sound = stronger visual + short sound */
export type NotifyLevel = 'quiet' | 'alert' | 'sound';
let audio: AudioContext | null = null;
export function playAlertSound(): void {
  try {
    audio ??= new AudioContext();
    const ctx = audio;
    if (ctx.state === 'suspended') void ctx.resume();
    [880, 660].forEach((frequency, index) => {
      const start = ctx.currentTime + index * 0.16;
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.15, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.14);
      oscillator.connect(gain).connect(ctx.destination);
      oscillator.start(start);
      oscillator.stop(start + 0.15);
    });
  } catch {
    // Sound is optional: a blocked or missing audio device must never break the UI.
  }
}
