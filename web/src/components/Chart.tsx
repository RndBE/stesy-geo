// Pembungkus ECharts dengan tema yang dibaca dari token CSS (gelap/terang).
import { useEffect, useRef } from 'react';
import * as echarts from 'echarts';

export function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export function palette() {
  return {
    text: cssVar('--text'), text2: cssVar('--text-2'), text3: cssVar('--text-3'), line: cssVar('--line'), lineSoft: cssVar('--line-soft'),
    surface: cssVar('--surface'), bg: cssVar('--bg'), accent: cssVar('--accent'),
    s1: cssVar('--s1'), s2: cssVar('--s2'), s3: cssVar('--s3'), s4: cssVar('--s4'),
    ok: cssVar('--ok'), waspada: cssVar('--waspada'), siaga: cssVar('--siaga'), bahaya: cssVar('--bahaya'),
  };
}

export const SERIES_COLORS = () => { const p = palette(); return [p.s1, p.s2, p.s3, p.accent, p.s4, p.ok]; };

/** Opsi dasar: grid, sumbu berlabel, crosshair (PRD 13.6). */
export function baseOption(): echarts.EChartsOption {
  const p = palette();
  const axis = {
    axisLine: { lineStyle: { color: p.line } }, axisTick: { lineStyle: { color: p.line } },
    axisLabel: { color: p.text2, fontFamily: 'IBM Plex Mono', fontSize: 10.5 },
    splitLine: { lineStyle: { color: p.lineSoft } }, nameTextStyle: { color: p.text2, fontFamily: 'IBM Plex Sans', fontSize: 11 },
  };
  return {
    animation: false,
    color: SERIES_COLORS(),
    textStyle: { fontFamily: 'IBM Plex Sans', color: p.text },
    grid: { left: 56, right: 56, top: 30, bottom: 36, containLabel: false },
    tooltip: {
      trigger: 'axis', axisPointer: { type: 'cross', lineStyle: { color: p.text3 }, crossStyle: { color: p.text3 }, label: { backgroundColor: p.surface, color: p.text, borderColor: p.line, fontFamily: 'IBM Plex Mono' } },
      backgroundColor: p.surface, borderColor: p.line, textStyle: { color: p.text, fontSize: 12, fontFamily: 'IBM Plex Mono' }, confine: true,
    },
    legend: { top: 4, right: 8, textStyle: { color: p.text2, fontSize: 11 }, itemWidth: 16, itemHeight: 8, icon: 'roundRect' },
    xAxis: axis as any,
    yAxis: axis as any,
  };
}

export const axisStyle = () => (baseOption().xAxis as any);

export function Chart({ option, height = 300, onReady, onBrush, className }: {
  option: echarts.EChartsOption; height?: number | string; className?: string;
  onReady?: (c: echarts.ECharts) => void;
  onBrush?: (range: [number, number] | null) => void;
}) {
  const el = useRef<HTMLDivElement>(null);
  const chart = useRef<echarts.ECharts | null>(null);
  const brushRef = useRef(onBrush);
  brushRef.current = onBrush;

  useEffect(() => {
    if (!el.current) return;
    const c = echarts.init(el.current, undefined, { renderer: 'canvas' });
    chart.current = c;
    const ro = new ResizeObserver(() => c.resize());
    ro.observe(el.current);
    c.on('brushEnd', (e: any) => {
      const area = e.areas?.[0];
      brushRef.current?.(area?.coordRange ? [area.coordRange[0], area.coordRange[1]] : null);
    });
    onReady?.(c);
    return () => { ro.disconnect(); c.dispose(); chart.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    chart.current?.setOption(option, { notMerge: true });
  }, [option]);

  return <div ref={el} className={className} style={{ width: '100%', height }} />;
}

/** Garis vertikal bernomor untuk tahap timbunan (PRD 13.5). */
export function stageMarkLines(stages: { stage_no: number; actual_start: number | null; planned_start?: number | null; is_surcharge?: number }[]) {
  const p = palette();
  return {
    silent: true, symbol: 'none',
    lineStyle: { color: p.text3, type: 'dashed' as const, width: 1 },
    label: { formatter: (d: any) => d.name, color: p.text2, fontFamily: 'IBM Plex Mono', fontSize: 10, position: 'insideEndTop' as const },
    data: stages.filter((s) => s.actual_start != null).map((s) => ({ xAxis: s.actual_start!, name: `T${s.stage_no}${s.is_surcharge ? 'S' : ''}` })),
  };
}
