// Komponen kecil yang dipakai ulang (PRD 13.6).
import { type ReactNode, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, Pause, CheckCheck, SearchCheck, TriangleAlert, Minus } from 'lucide-react';
import { ago } from '../lib/format';

export function Panel({ title, right, children, flush, className, style }: { title?: ReactNode; right?: ReactNode; children: ReactNode; flush?: boolean; className?: string; style?: React.CSSProperties }) {
  return (
    <section className={`panel ${className ?? ''}`} style={style}>
      {(title || right) && <div className="ph">{typeof title === 'string' ? <h2>{title}</h2> : title}<div className="grow" />{right}</div>}
      <div className={`pb ${flush ? 'flush' : ''}`}>{children}</div>
    </section>
  );
}

export const DECISION_META: Record<string, { color: string; icon: ReactNode; short: string }> = {
  'Lanjut timbun': { color: 'var(--ok)', icon: <ArrowUpRight size={14} strokeWidth={1.8} />, short: 'LANJUT' },
  Tahan: { color: 'var(--waspada)', icon: <Pause size={14} strokeWidth={1.8} />, short: 'TAHAN' },
  'Siap bongkar surcharge': { color: 'var(--s1)', icon: <CheckCheck size={14} strokeWidth={1.8} />, short: 'SIAP BONGKAR' },
  'Perlu tinjauan': { color: 'var(--bahaya)', icon: <SearchCheck size={14} strokeWidth={1.8} />, short: 'TINJAU' },
};

export function Decision({ value, short }: { value: string; short?: boolean }) {
  const m = DECISION_META[value] ?? { color: 'var(--text-2)', icon: <Minus size={14} />, short: value };
  return <span className="dec" style={{ color: m.color }}>{m.icon}{short ? m.short : value}</span>;
}

export const LEVEL_COLOR: Record<string, string> = { Waspada: 'var(--waspada)', Siaga: 'var(--siaga)', Bahaya: 'var(--bahaya)' };

export function Level({ level }: { level: string | null | undefined }) {
  if (!level) return <span className="badge ok">Normal</span>;
  return <span className={`badge ${level}`}>{level === 'Bahaya' && <TriangleAlert size={11} />}{level}</span>;
}

/** Instrument chip: kode + titik status + usia data (PRD 13.6). */
export function InstrumentChip({ id, code, level, last, stale, to }: { id?: number; code: string; level?: string | null; last?: number | null; stale?: boolean; to?: string }) {
  const color = level ? LEVEL_COLOR[level] : stale ? 'var(--text-3)' : 'var(--ok)';
  const body = (
    <span className="chip" title={stale ? 'Data terlambat' : undefined}>
      <span className="dot" style={{ background: color, outline: stale ? '1px dashed var(--text-2)' : undefined, outlineOffset: 1 }} />
      {code}
      {last !== undefined && <span className="age">{ago(last)}</span>}
    </span>
  );
  if (to || id) return <Link to={to ?? `/instrumen/${id}`}>{body}</Link>;
  return body;
}

export function UnitInput({ value, onChange, unit, design, step = 'any', width, disabled }: {
  value: number | string | null; onChange: (v: string) => void; unit: string; design?: number | null; step?: string; width?: number; disabled?: boolean;
}) {
  return (
    <div className="unit-input" style={{ width }}>
      <input type="number" step={step} value={value ?? ''} onChange={(e) => onChange(e.target.value)} disabled={disabled} />
      {design != null && <span className="d" title="Nilai desain">{design}</span>}
      <span className="u">{unit}</span>
    </div>
  );
}

export function Seg<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void }) {
  return (
    <div className="seg">
      {options.map((o) => <button key={o.value} className={o.value === value ? 'on' : ''} onClick={() => onChange(o.value)}>{o.label}</button>)}
    </div>
  );
}

export function Crit({ c }: { c: { id: string; label: string; ok: boolean | null; detail: string } }) {
  const mark = c.ok === true ? <span style={{ color: 'var(--ok)' }}>✔</span> : c.ok === false ? <span style={{ color: 'var(--bahaya)' }}>✘</span> : <span className="dim">–</span>;
  return (
    <div className="crit">
      {mark}
      <span className="id">{c.id}</span>
      <div>
        <div>{c.label}</div>
        <div className="muted" style={{ fontSize: 11.5 }}>{c.detail}{c.ok === null ? ' · tidak dievaluasi' : ''}</div>
      </div>
    </div>
  );
}

let toastSet: ((m: { text: string; kind?: 'ok' | 'err' } | null) => void) | null = null;
export function toast(text: string, kind: 'ok' | 'err' = 'ok') { toastSet?.({ text, kind }); }
export function Toaster() {
  const [m, setM] = useState<{ text: string; kind?: 'ok' | 'err' } | null>(null);
  useEffect(() => { toastSet = setM; return () => { toastSet = null; }; }, []);
  useEffect(() => { if (!m) return; const t = setTimeout(() => setM(null), 4500); return () => clearTimeout(t); }, [m]);
  if (!m) return null;
  return <div className="toast glass" style={{ borderLeft: `3px solid ${m.kind === 'err' ? 'var(--bahaya)' : 'var(--ok)'}` }}>{m.text}</div>;
}

export function Loading({ what = 'data' }: { what?: string }) {
  return <div className="empty">Memuat {what}…</div>;
}

export function ErrorBox({ error }: { error: string | null }) {
  if (!error) return null;
  return <div className="panel" style={{ padding: 10, borderColor: 'var(--bahaya)' }}><span className="err">{error}</span></div>;
}

/** Tampilan angka + satuan (tidak ada angka tanpa satuan). */
export function Q({ v, unit, className }: { v: string; unit: string; className?: string }) {
  return <span className={`mono ${className ?? ''}`}>{v}<span className="unit">{unit}</span></span>;
}
