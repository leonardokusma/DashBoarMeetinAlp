import { plateRanking } from '../../data/model';
import type { PlateRow } from '../../data/model';
import { chartCard, grid, kpi, kpiRow, section, table } from '../components';
import { formatBRL, formatBRLCompact, formatDecimal2, formatInt, formatPct } from '../format';
import { baseGrid, baseOption, categoryAxis, colors, toNumber, valueAxis } from '../theme';
import type { PageContext } from './types';

export function trucksPage(ctx: PageContext): HTMLElement[] {
  const ranking = plateRanking(ctx.filter);
  const byMargin = [...ranking].sort((a, b) => a.margemPct - b.margemPct);
  const worst = byMargin[0]!;
  const best = byMargin[byMargin.length - 1]!;
  const top = ranking[0]!;

  const kpis = kpiRow([
    kpi({ label: 'Maior Livre G1', value: top.placa, sub: `${formatBRL(top.livreG1)} · margem ${formatPct(top.margemPct)}` }),
    kpi({ label: 'Melhor margem', value: best.placa, sub: `${formatPct(best.margemPct)} do frete` }),
    kpi({ label: 'Pior margem', value: worst.placa, sub: `${formatPct(worst.margemPct)} do frete · Livre G1 ${formatBRL(worst.livreG1)}` }),
  ]);

  const isWorst = (p: string): boolean => p === worst.placa;
  const reversed = [...ranking].reverse();

  const rankChart = chartCard(
    {
      title: 'Ranking de Livre G1 por caminhão',
      height: 340,
      span: 7,
      option: {
        ...baseOption,
        grid: { ...baseGrid, top: 8, right: 64 },
        tooltip: {
          ...baseOption.tooltip,
          trigger: 'axis',
          formatter: (params: unknown) => {
            const p = (params as Array<{ dataIndex: number }>)[0];
            if (!p) return '';
            const r = reversed[p.dataIndex]!;
            return `<b>${r.placa}</b><br/>Livre G1: ${formatBRL(r.livreG1)}<br/>Margem: ${formatPct(r.margemPct)}<br/>Fretes: ${r.fretes}`;
          },
        },
        xAxis: valueAxis((v) => formatBRLCompact(toNumber(v))),
        yAxis: categoryAxis(reversed.map((r) => r.placa)),
        series: [
          {
            type: 'bar',
            barMaxWidth: 26,
            data: reversed.map((r) => ({ value: r.livreG1, itemStyle: { color: isWorst(r.placa) ? colors.loss : colors.brand } })),
            label: { show: true, position: 'right', color: colors.textMuted, fontSize: 11, formatter: (p) => formatBRLCompact(toNumber(p.value)) },
          },
        ],
      },
      ariaLabel: `Ranking de Livre G1 por caminhão. Maior: ${top.placa}; pior margem: ${worst.placa}.`,
    },
    ctx.pending,
  );

  const marginChart = chartCard(
    {
      title: 'Margem do Livre G1 sobre o frete',
      height: 340,
      span: 5,
      option: {
        ...baseOption,
        grid: { ...baseGrid, top: 8, right: 48 },
        tooltip: { ...baseOption.tooltip, trigger: 'axis', valueFormatter: (v) => formatPct(toNumber(v)) },
        xAxis: valueAxis((v) => formatPct(toNumber(v))),
        yAxis: categoryAxis(byMargin.map((r) => r.placa)),
        series: [
          {
            type: 'bar',
            barMaxWidth: 26,
            data: byMargin.map((r) => ({ value: r.margemPct, itemStyle: { color: isWorst(r.placa) ? colors.loss : colors.neutralSoft } })),
            label: { show: true, position: 'right', color: colors.textMuted, fontSize: 11, formatter: (p) => formatPct(toNumber(p.value)) },
          },
        ],
      },
      ariaLabel: `Margem por caminhão. Pior: ${worst.placa} com ${formatPct(worst.margemPct)}.`,
    },
    ctx.pending,
  );

  const tbl = table<PlateRow>({
    title: 'Detalhe por caminhão',
    rows: ranking,
    rowClass: (r) => (isWorst(r.placa) ? 'row--alert' : undefined),
    scroll: true,
    columns: [
      { header: 'Placa', cell: (r) => r.placa },
      { header: 'Fretes', numeric: true, cell: (r) => formatInt(r.fretes) },
      { header: 'Peso em t', numeric: true, cell: (r) => (r.pesoKg === null ? '—' : formatInt(r.pesoKg / 1000)) },
      { header: 'Frete', numeric: true, cell: (r) => formatBRL(r.faturamento) },
      { header: 'Contrato', numeric: true, cell: (r) => formatBRL(r.despesaAlp) },
      { header: 'Combustível', numeric: true, cell: (r) => formatBRL(r.combustivel) },
      { header: 'Livre G1', numeric: true, cell: (r) => formatBRL(r.livreG1) },
      { header: 'Margem', numeric: true, cell: (r) => formatPct(r.margemPct) },
      { header: 'Resultado G1', numeric: true, cell: (r) => (r.resultadoG1 === null ? '—' : formatBRL(r.resultadoG1)) },
      { header: 'Litros', numeric: true, cell: (r) => (r.litros === null ? '—' : formatInt(r.litros)) },
      { header: 'km/l', numeric: true, cell: (r) => (r.kmPorLitro === null ? '—' : formatDecimal2(r.kmPorLitro)) },
    ],
  });

  return [
    kpis,
    section('Por caminhão', [
      grid([rankChart, marginChart]),
      tbl,
    ]),
  ];
}
