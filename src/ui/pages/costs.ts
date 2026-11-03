import {
  ALL_PLATES,
  dieselMensal,
  despesasOperacionais,
  kmGastoMensal,
  manutencaoMensal,
  marcaEstimado,
  siengeByGroup,
} from '../../data/model';
import type { DespesaOperacional } from '../../data/model';
import { chartCard, grid, kpi, kpiRow, section, table } from '../components';
import {
  formatBRL,
  formatBRLCents,
  formatBRLCompact,
  formatInt,
  formatMonth,
  formatMonthLong,
  formatPctSigned,
} from '../format';
import { baseGrid, baseLegend, baseOption, categoryAxis, colors, despesaColors, seriesColors, toNumber, valueAxis } from '../theme';
import type { PageContext } from './types';

const money = (v: unknown): string => formatBRL(toNumber(v));

export function costsPage(ctx: PageContext): HTMLElement[] {
  const { filter } = ctx;
  const placaLabel = filter.placa === ALL_PLATES ? '8 placas' : filter.placa;

  // ---------- Diesel por mês ----------
  const diesel = dieselMensal(filter);
  const first = diesel.find((d) => d.precoMedio > 0);
  const last = [...diesel].reverse().find((d) => d.precoMedio > 0);
  const variacao = first && last && first.precoMedio > 0 ? last.precoMedio / first.precoMedio - 1 : 0;

  const kpis = kpiRow([
    kpi({
      label: 'Preço do diesel no último mês',
      value: last ? `${formatBRLCents(last.precoMedio)}/L` : '—',
      sub: last ? `${formatMonthLong(last.mes)} · ${placaLabel}` : undefined,
    }),
    kpi({
      label: 'Variação do diesel',
      value: formatPctSigned(variacao),
      sub: first && last ? `${formatMonth(first.mes)} ${formatBRLCents(first.precoMedio)} → ${formatMonth(last.mes)} ${formatBRLCents(last.precoMedio)}` : undefined,
      tone: variacao > 0 ? 'loss' : 'neutral',
    }),
  ]);

  // ---------- Km rodado e gasto mensal ----------
  const kg = kmGastoMensal(filter.placa);
  const kmChart = chartCard(
    {
      title: 'Km rodado e gasto mensal com combustível',
      height: 340,
      span: 12,
      option: {
        ...baseOption,
        legend: { ...baseLegend },
        grid: { ...baseGrid, right: 64 },
        tooltip: {
          ...baseOption.tooltip,
          trigger: 'axis',
          formatter: (params: unknown) => {
            const p = (params as Array<{ dataIndex: number }>)[0];
            if (!p) return '';
            const m = kg[p.dataIndex]!;
            const kmTxt = m.km === null ? 'sem fonte' : `${formatInt(m.km)} km`;
            const rkm = m.reaisPorKm === null ? '' : `<br/>Gasto por km: <b>${formatBRLCents(m.reaisPorKm)}</b>`;
            return `<b>${formatMonthLong(m.mes)}</b><br/>Gasto com combustível: <b>${formatBRL(m.gasto)}</b><br/>Km rodado: <b>${kmTxt}</b>${rkm}`;
          },
        },
        xAxis: categoryAxis(kg.map((m) => formatMonth(m.mes))),
        // barras ocupam a metade de baixo e a linha de km fica acima delas
        yAxis: [
          valueAxis((v) => formatBRLCompact(toNumber(v)), { min: 0, max: Math.max(...kg.map((m) => m.gasto), 1) * 1.8 }),
          { ...valueAxis((v) => `${formatInt(toNumber(v))} km`, { min: 0, max: Math.max(...kg.map((m) => m.km ?? 0), 1) * 1.1 }), splitLine: { show: false } },
        ],
        series: [
          {
            name: 'Gasto com combustível',
            type: 'bar',
            barMaxWidth: 56,
            itemStyle: { color: colors.neutralSoft },
            data: kg.map((m) => m.gasto),
            label: { show: true, position: 'top', color: colors.textMuted, fontSize: 11, formatter: (p) => formatBRLCompact(toNumber(p.value)) },
          },
          {
            name: 'Km rodado',
            type: 'line',
            yAxisIndex: 1,
            symbolSize: 10,
            lineStyle: { width: 3 },
            itemStyle: { color: colors.brand },
            data: kg.map((m) => m.km),
            label: { show: true, position: 'top', color: colors.brand, fontWeight: 600, formatter: (p) => formatInt(toNumber(p.value)) },
          },
        ],
      },
      ariaLabel: 'Gasto mensal com combustível e km rodado por mês, de julho a outubro.',
    },
    ctx.pending,
  );

  // ---------- Manutenção ALP + G1 ----------
  const man = manutencaoMensal(filter);
  const manChart = chartCard(
    {
      title: 'Manutenção por mês',
      height: 320,
      span: 6,
      option: {
        ...baseOption,
        legend: { ...baseLegend },
        grid: baseGrid,
        tooltip: {
          ...baseOption.tooltip,
          trigger: 'axis',
          valueFormatter: (v) => (v === null || v === undefined || v === '-' ? 'sem dado' : money(v)),
        },
        xAxis: categoryAxis(man.map((m) => formatMonth(m.mes))),
        yAxis: valueAxis((v) => formatBRLCompact(toNumber(v))),
        series: [
          { name: 'ALP acerto', type: 'bar', stack: 'm', barMaxWidth: 52, itemStyle: { color: colors.alp }, data: man.map((m) => m.alp) },
          { name: 'G1 Sienge', type: 'bar', stack: 'm', barMaxWidth: 52, itemStyle: { color: colors.g1 }, data: man.map((m) => m.g1) },
        ],
      },
      ariaLabel: 'Manutenção por mês somando a parte da ALP e a parte da G1.',
    },
    ctx.pending,
  );

  const itens = despesasOperacionais(filter);
  const ORIGEM_TXT: Record<string, string> = { ALP: 'ALP acerto', G1: 'Custo G1', Extras: 'Custo G1' };
  const itensTable = table<DespesaOperacional>({
    title: 'Despesas operacionais',
    span: 6,
    rows: itens,
    scroll: true,
    columns: [
      { header: 'Origem', cell: (r) => ORIGEM_TXT[r.origem] ?? r.origem },
      { header: 'Conta', cell: (r) => r.conta },
      { header: 'Valor', numeric: true, cell: (r) => formatBRL(r.valor) },
    ],
    footer: ['', 'Total', formatBRL(itens.reduce((a, r) => a + r.valor, 0))],
  });

  // ---------- Sienge ----------
  const sienge = siengeByGroup(filter);
  const grupos = [...new Set(sienge.flatMap((s) => Object.keys(s.grupos)))];
  const siengeChart = chartCard(
    {
      title: 'Custos operacionais por grupo G1, * mês com parte estimada',
      height: 320,
      span: 12,
      option: {
        ...baseOption,
        legend: { ...baseLegend },
        grid: baseGrid,
        tooltip: { ...baseOption.tooltip, trigger: 'axis', valueFormatter: (v) => money(v) },
        xAxis: categoryAxis(sienge.map((s) => `${formatMonth(s.mes)}${marcaEstimado(s.mes)}`)),
        yAxis: valueAxis((v) => formatBRLCompact(toNumber(v))),
        series: grupos.map((g, i) => ({
          name: g,
          type: 'bar' as const,
          stack: 's',
          barMaxWidth: 52,
          itemStyle: { color: despesaColors[g] ?? seriesColors[i % seriesColors.length] },
          data: sienge.map((s) => Math.round((s.grupos[g] ?? 0) * 100) / 100),
        })),
      },
      ariaLabel: 'Custos operacionais por grupo G1, de julho a outubro (julho e agosto com parte estimada).',
    },
    ctx.pending,
  );

  return [
    kpis,
    section('Diesel', [grid([kmChart])]),
    section('Manutenção e despesas da G1', [
      grid([manChart, itensTable, siengeChart]),
    ]),
  ];
}
