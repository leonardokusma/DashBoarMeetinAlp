import {
  diferencasPorCte,
  normalizeDestino,
  perdaPorDestino,
  perdaPorMes,
  perdaPorPlaca,
  perdaTotal,
  selectComparativo,
} from '../../data/model';
import type { FreteComparado } from '../../data/types';
import { chartCard, grid, kpi, kpiRow, section, table } from '../components';
import { el } from '../dom';
import { formatBRL, formatBRLCents, formatBRLCompact, formatDateBR, formatInt, formatMonth, formatPct } from '../format';
import { baseGrid, baseLegend, baseOption, categoryAxis, colors, toNumber, valueAxis } from '../theme';
import type { PageContext } from './types';

export function freightPage(ctx: PageContext): HTMLElement[] {
  const { filter } = ctx;
  const total = perdaTotal(filter);

  if (filter.mes === '2026-07') {
    return [
      section('Queda de frete', [
        el('p', { className: 'empty', text: 'Julho não tem comparativo. Escolha Ago, Set, Out ou "Todos os meses".' }),
      ]),
    ];
  }

  const kpis = kpiRow([
    kpi({ label: 'Perda de frete', value: formatBRL(total.perda), sub: `${formatPct(total.perdaPct)} sobre o frete anterior`, tone: 'loss' }),
    kpi({ label: 'Frete anterior', value: formatBRL(total.freteAnterior), sub: `${formatInt(total.comparaveis)} fretes com CTE anterior` }),
    kpi({ label: 'Frete atual', value: formatBRL(total.freteAtual), sub: 'mesmos fretes' }),
    kpi({ label: 'Não comparáveis', value: formatInt(total.naoComparaveis), sub: 'sem CTE anterior' }),
  ]);

  const meses = perdaPorMes(filter);
  const mesesChart = chartCard(
    {
      title: 'Frete anterior × frete atual por mês',
      height: 330,
      span: 6,
      option: {
        ...baseOption,
        legend: { ...baseLegend },
        grid: { ...baseGrid, right: 48 },
        tooltip: {
          ...baseOption.tooltip,
          trigger: 'axis',
          formatter: (params: unknown) => {
            const p = (params as Array<{ dataIndex: number }>)[0];
            if (!p) return '';
            const m = meses[p.dataIndex]!;
            return `<b>${formatMonth(m.key)}</b><br/>Anterior: ${formatBRL(m.freteAnterior)}<br/>Atual: ${formatBRL(m.freteAtual)}<br/>Perda: <b>${formatBRL(m.perda)}</b> · ${formatPct(m.perdaPct)}<br/>Fretes: ${m.comparaveis}`;
          },
        },
        xAxis: categoryAxis(meses.map((m) => formatMonth(m.key))),
        yAxis: [
          valueAxis((v) => formatBRLCompact(toNumber(v))),
          { ...valueAxis((v) => formatPct(toNumber(v))), splitLine: { show: false }, min: 0 },
        ],
        series: [
          { name: 'Frete anterior', type: 'bar', barMaxWidth: 42, itemStyle: { color: colors.neutralSoft }, data: meses.map((m) => m.freteAnterior) },
          { name: 'Frete atual', type: 'bar', barMaxWidth: 42, itemStyle: { color: colors.brand }, data: meses.map((m) => m.freteAtual) },
          {
            name: 'Perda %',
            type: 'line',
            yAxisIndex: 1,
            symbolSize: 8,
            lineStyle: { width: 3 },
            itemStyle: { color: colors.loss },
            data: meses.map((m) => (m.comparaveis > 0 ? m.perdaPct : null)),
            label: { show: true, color: colors.loss, fontWeight: 600, formatter: (p) => formatPct(toNumber(p.value)) },
          },
        ],
      },
      ariaLabel: `Frete anterior e atual por mês. Perda total ${formatBRL(total.perda)}, ${formatPct(total.perdaPct)}.`,
    },
    ctx.pending,
  );

  const destinos = perdaPorDestino(filter).slice(0, 12);
  const destinosChart = chartCard(
    {
      title: 'Perda de frete por destino',
      height: 330,
      span: 6,
      option: {
        ...baseOption,
        grid: { ...baseGrid, top: 8, right: 64 },
        tooltip: {
          ...baseOption.tooltip,
          trigger: 'axis',
          formatter: (params: unknown) => {
            const p = (params as Array<{ dataIndex: number }>)[0];
            if (!p) return '';
            const d = [...destinos].reverse()[p.dataIndex]!;
            return `<b>${d.key}</b><br/>Perda: ${formatBRL(d.perda)} · ${formatPct(d.perdaPct)}<br/>Fretes: ${d.comparaveis}`;
          },
        },
        xAxis: valueAxis((v) => formatBRLCompact(toNumber(v))),
        yAxis: categoryAxis([...destinos].reverse().map((d) => d.key)),
        series: [
          {
            type: 'bar',
            barMaxWidth: 20,
            itemStyle: { color: colors.loss },
            data: [...destinos].reverse().map((d) => d.perda),
            label: { show: true, position: 'right', color: colors.textMuted, fontSize: 11, formatter: (p) => formatBRLCompact(toNumber(p.value)) },
          },
        ],
      },
      ariaLabel: 'Perda de frete por destino, em reais.',
    },
    ctx.pending,
  );

  const ctes = diferencasPorCte(filter);
  const cteChart = chartCard(
    {
      title: 'Diferença de cada frete, CTE atual × CTE anterior',
      height: 360,
      span: 12,
      option: {
        ...baseOption,
        grid: { ...baseGrid, bottom: 56 },
        tooltip: {
          ...baseOption.tooltip,
          trigger: 'axis',
          formatter: (params: unknown) => {
            const p = (params as Array<{ dataIndex: number }>)[0];
            if (!p) return '';
            const c = ctes[p.dataIndex]!;
            return `<b>CTE ${c.cte}</b> · ${c.placa} · ${normalizeDestino(c.destino)}<br/>${formatDateBR(c.data)}<br/>Anterior, CTE ${c.cteAnterior}: ${formatBRLCents(c.freteAnterior ?? 0)}<br/>Atual: ${formatBRLCents(c.freteAtual)}<br/>Diferença: <b>${formatBRLCents(-(c.perda ?? 0))}</b>`;
          },
        },
        dataZoom: [{ type: 'inside' }, { type: 'slider', height: 18, bottom: 8 }],
        xAxis: { ...categoryAxis(ctes.map((c) => String(c.cte))), axisLabel: { show: false } },
        yAxis: valueAxis((v) => formatBRL(toNumber(v))),
        series: [
          {
            name: 'Diferença atual − anterior',
            type: 'bar',
            barMaxWidth: 12,
            data: ctes.map((c) => ({ value: -(c.perda ?? 0), itemStyle: { color: (c.perda ?? 0) > 0 ? colors.loss : colors.gain } })),
          },
        ],
      },
      ariaLabel: `Diferença de valor de ${ctes.length} fretes entre o CTE atual e o anterior.`,
    },
    ctx.pending,
  );

  const placas = perdaPorPlaca(filter);
  const placaChart = chartCard(
    {
      title: 'Perda de frete por caminhão',
      height: 300,
      span: 6,
      option: {
        ...baseOption,
        grid: { ...baseGrid, top: 8, right: 64 },
        tooltip: { ...baseOption.tooltip, trigger: 'axis', valueFormatter: (v) => formatBRL(toNumber(v)) },
        xAxis: valueAxis((v) => formatBRLCompact(toNumber(v))),
        yAxis: categoryAxis([...placas].reverse().map((p) => p.key)),
        series: [
          {
            type: 'bar',
            barMaxWidth: 20,
            itemStyle: { color: colors.loss },
            data: [...placas].reverse().map((p) => p.perda),
            label: { show: true, position: 'right', color: colors.textMuted, fontSize: 11, formatter: (p) => formatBRLCompact(toNumber(p.value)) },
          },
        ],
      },
      ariaLabel: 'Perda de frete por caminhão, em reais.',
    },
    ctx.pending,
  );

  const destTable = table({
    title: 'Perda por destino',
    span: 6,
    rows: perdaPorDestino(filter),
    scroll: true,
    columns: [
      { header: 'Destino', cell: (r) => r.key },
      { header: 'Fretes', numeric: true, cell: (r) => formatInt(r.comparaveis) },
      { header: 'Perda', numeric: true, cell: (r) => formatBRL(r.perda) },
      { header: '%', numeric: true, cell: (r) => formatPct(r.perdaPct) },
    ],
  });

  const todos = selectComparativo(filter).sort((a, b) => (b.perda ?? -1e9) - (a.perda ?? -1e9));
  const cteTable = table<FreteComparado>({
    title: 'CTEs atuais × anteriores',
    rows: todos,
    scroll: true,
    rowClass: (c) => (c.perda === null ? 'row--muted' : undefined),
    columns: [
      { header: 'Data', cell: (c) => formatDateBR(c.data) },
      { header: 'CTE', cell: (c) => String(c.cte) },
      { header: 'Placa', cell: (c) => c.placa },
      { header: 'Destino', cell: (c) => normalizeDestino(c.destino) },
      { header: 'Frete atual', numeric: true, cell: (c) => formatBRLCents(c.freteAtual) },
      { header: 'CTE anterior', cell: (c) => (c.cteAnterior === null ? '—' : String(c.cteAnterior)) },
      { header: 'Frete anterior', numeric: true, cell: (c) => (c.freteAnterior === null ? '—' : formatBRLCents(c.freteAnterior)) },
      { header: 'Perda', numeric: true, cell: (c) => (c.perda === null ? 'não comparável' : formatBRLCents(c.perda)) },
    ],
  });

  return [
    kpis,
    section('Queda de frete', [
      grid([mesesChart, destinosChart, cteChart, placaChart, destTable]),
      cteTable,
    ]),
  ];
}
