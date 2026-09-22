// Format angka, satuan, waktu, STA — presisi mengikuti ketelitian instrumen (PRD 13.1).
export const DAY = 86400e3;
const TZ = 'Asia/Jakarta';

export function sta(v: number | null | undefined): string {
  if (v == null) return '—';
  const km = Math.floor(v / 1000);
  const m = v - km * 1000;
  return `${km}+${m.toFixed(0).padStart(3, '0')}`;
}

export function offsetLabel(o: number | null | undefined): string {
  if (o == null) return '—';
  if (Math.abs(o) < 0.05) return 'as';
  return `${o < 0 ? 'Ki' : 'Ka'} ${Math.abs(o).toFixed(1)} m`;
}

export const DECIMALS: Record<string, number> = { mm: 0, kPa: 1, m: 2, '%': 0, 'mm/hari': 1, 'mm/minggu': 1 };

export function num(v: number | null | undefined, d = 0): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return v.toLocaleString('id-ID', { minimumFractionDigits: d, maximumFractionDigits: d });
}

export function val(v: number | null | undefined, unit: string, d?: number): string {
  return `${num(v, d ?? DECIMALS[unit] ?? 1)}`;
}

export const pct = (v: number | null | undefined, d = 0) => (v == null || !Number.isFinite(v) ? '—' : `${(v * 100).toFixed(d)}`);

export function elev(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(3).replace('.', ',')}`;
}

export function date(t: number | null | undefined, withYear = true): string {
  if (t == null) return '—';
  return new Date(t).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', ...(withYear ? { year: 'numeric' } : {}), timeZone: TZ });
}

export function dateTime(t: number | null | undefined): string {
  if (t == null) return '—';
  return `${date(t)} ${new Date(t).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', timeZone: TZ })}`;
}

export function time(t: number): string {
  return new Date(t).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: TZ });
}

export function ago(t: number | null | undefined, now = Date.now()): string {
  if (t == null) return 'tidak ada';
  const s = (now - t) / 1000;
  if (s < 90) return 'baru saja';
  if (s < 3600) return `${Math.round(s / 60)} mnt lalu`;
  if (s < 86400 * 2) return `${Math.round(s / 3600)} j lalu`;
  return `${Math.round(s / 86400)} hr lalu`;
}

export function toInputDateTime(t: number): string {
  const d = new Date(t + 7 * 3600e3);
  return d.toISOString().slice(0, 16);
}
export function fromInputDateTime(s: string): number {
  return Date.parse(s + ':00+07:00');
}
export function toInputDate(t: number): string {
  return new Date(t + 7 * 3600e3).toISOString().slice(0, 10);
}
export function fromInputDate(s: string, end = false): number {
  return Date.parse(s + (end ? 'T23:59:59+07:00' : 'T00:00:00+07:00'));
}

export const PHASE_LABEL: Record<string, string> = {
  penimbunan: 'Penimbunan', 'masa tunggu': 'Masa tunggu', surcharge: 'Surcharge terpasang', pascabongkar: 'Pascabongkar',
};
