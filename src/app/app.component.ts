import { ChangeDetectionStrategy, Component, computed, DestroyRef, effect, signal } from '@angular/core';
import {
  LucideCoffee,
  LucideCircleCheckBig,
  LucidePlay,
  LucideSquare,
  LucideTarget,
  LucideTrash,
} from '@lucide/angular';

interface WorkPeriod {
  start: string;
  end: string;
  pause: number;
}

const PERIODS_KEY = 'workCalc.periods';
const TARGET_KEY = 'workCalc.targetTime';

function readPeriods(): WorkPeriod[] {
  if (typeof localStorage === 'undefined') {
    return [{ start: '', end: '', pause: 0 }];
  }

  try {
    const stored = localStorage.getItem(PERIODS_KEY);
    if (stored) {
      const periods: unknown = JSON.parse(stored);
      if (Array.isArray(periods) && periods.length > 0) {
        return periods.map((period: Partial<WorkPeriod>) => ({
          start: typeof period.start === 'string' ? period.start : '',
          end: typeof period.end === 'string' ? period.end : '',
          pause: typeof period.pause === 'number' ? Math.max(0, period.pause) : 0,
        }));
      }
    }
  } catch {
    localStorage.removeItem(PERIODS_KEY);
  }

  return [{ start: '', end: '', pause: 0 }];
}

function readTarget(): string {
  if (typeof localStorage === 'undefined') {
    return '08:00';
  }

  return localStorage.getItem(TARGET_KEY) || '08:00';
}

function isTime(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function toMinutes(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

function formatClock(date: Date): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function normalizeTarget(value: string): string | null {
  const digits = value.replace(/[^0-9]/g, '');
  let hours: number;
  let minutes: number;

  if (digits.length <= 2 && digits.length > 0) {
    hours = Number(digits);
    minutes = 0;
  } else if (digits.length === 3) {
    hours = Number(digits.slice(0, 1));
    minutes = Number(digits.slice(1));
  } else if (digits.length === 4) {
    hours = Number(digits.slice(0, 2));
    minutes = Number(digits.slice(2));
  } else {
    return /^([01]\d|2[0-3]):[0-5]\d$/.test(value) ? value : null;
  }

  if (hours > 23 || minutes > 59) {
    return null;
  }

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

@Component({
  selector: 'app-root',
  standalone: true,
  templateUrl: './app.component.html',
  styleUrl: './app.component.css',
  imports: [LucideCoffee, LucideCircleCheckBig, LucidePlay, LucideSquare, LucideTarget, LucideTrash],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppComponent {
  readonly periods = signal<WorkPeriod[]>(readPeriods());
  readonly targetTime = signal(readTarget());
  readonly targetDraft = signal(this.targetTime());
  readonly currentTime = signal(new Date());
  readonly currentTimeLabel = computed(() => formatClock(this.currentTime()));

  readonly targetMinutes = computed(() => this.targetTime() ? toMinutes(this.targetTime()) : 0);
  readonly closedMinutesWorked = computed(() => this.periods().reduce((total, period) => {
    if (!period.start || !period.end) {
      return total;
    }

    return total + Math.max(toMinutes(period.end) - toMinutes(period.start) - period.pause, 0);
  }, 0));
  // Perioden mit Startzeit, aber ohne Endzeit, laufen bis zur aktuellen Uhrzeit.
  readonly openMinutesWorked = computed(() => {
    const now = toMinutes(this.currentTimeLabel());
    return this.periods().reduce((total, period) => {
      if (!isTime(period.start) || period.end) {
        return total;
      }

      return total + Math.max(now - toMinutes(period.start) - period.pause, 0);
    }, 0);
  });
  readonly totalMinutesWorked = computed(() => this.closedMinutesWorked() + this.openMinutesWorked());
  readonly overtimeMinutes = computed(() => this.totalMinutesWorked() - this.targetMinutes());
  readonly hasStartedPeriod = computed(() => this.periods().some(period => isTime(period.start)));
  readonly leaveAt = computed(() => {
    const remaining = this.targetMinutes() - this.closedMinutesWorked();
    if (remaining <= 0) {
      return null;
    }

    const periods = this.periods();
    const openPeriod = [...periods].reverse().find(period => isTime(period.start) && !period.end);
    if (openPeriod) {
      return toMinutes(openPeriod.start) + openPeriod.pause + remaining;
    }

    const endTimes = periods.filter(period => period.end).map(period => toMinutes(period.end));
    const lastEnd = endTimes.length ? Math.max(...endTimes) : new Date().getHours() * 60 + new Date().getMinutes();
    return lastEnd + remaining;
  });

  constructor(destroyRef: DestroyRef) {
    effect(() => {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(PERIODS_KEY, JSON.stringify(this.periods()));
        localStorage.setItem(TARGET_KEY, this.targetTime());
      }
    });

    const clockInterval = setInterval(() => this.currentTime.set(new Date()), 10_000);
    destroyRef.onDestroy(() => clearInterval(clockInterval));
  }

  formatMinutes(value: number): string {
    const hours = Math.floor(value / 60);
    const minutes = value % 60;
    return `${hours}:${String(minutes).padStart(2, '0')}`;
  }

  formattedOvertime(): string {
    const overtime = this.overtimeMinutes();
    return `${overtime >= 0 ? '+' : '-'}${this.formatMinutes(Math.abs(overtime))}`;
  }

  updateTargetDraft(event: Event): void {
    this.targetDraft.set((event.target as HTMLInputElement).value);
  }

  commitTarget(): void {
    const normalized = normalizeTarget(this.targetDraft());
    this.targetTime.set(normalized ?? '');
    this.targetDraft.set(normalized ?? '');
  }

  updatePeriod(index: number, field: 'start' | 'end', event: Event): void;
  updatePeriod(index: number, field: 'pause', event: Event): void;
  updatePeriod(index: number, field: keyof WorkPeriod, event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.setPeriodValue(index, field, field === 'pause'
      ? Math.max(0, Number.parseInt(value, 10) || 0)
      : value);
  }

  normalizePeriodTime(index: number, field: 'start' | 'end'): void {
    const value = this.periods()[index]?.[field] ?? '';
    this.setPeriodValue(index, field, value ? normalizeTarget(value) ?? '' : '');
  }

  setTimeToNow(index: number, field: 'start' | 'end'): void {
    const now = new Date();
    this.currentTime.set(now);
    this.setPeriodValue(index, field, formatClock(now));
  }

  setPause(index: number, minutes: number): void {
    this.setPeriodValue(index, 'pause', minutes);
  }

  addPeriod(): void {
    this.periods.update(periods => [...periods, { start: '', end: '', pause: 0 }]);
  }

  removePeriod(index: number): void {
    this.periods.update(periods => periods.length <= 1
      ? periods
      : periods.filter((_, periodIndex) => periodIndex !== index));
  }

  private setPeriodValue(index: number, field: keyof WorkPeriod, value: string | number): void {
    this.periods.update(periods => periods.map((period, periodIndex) => {
      if (periodIndex !== index) {
        return period;
      }

      return { ...period, [field]: value };
    }));
  }
}