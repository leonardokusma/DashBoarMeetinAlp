import { dataset, semReajusteAcumulado, semReajustePorMesCliente, semReajusteTotal } from '../../data/model';
import type { FreteSemReajuste } from '../../data/types';
import { chartCard, grid, kpi, kpiRow, section, table } from '../components';
import { formatBRL, formatBRLCents, formatBRLCompact, formatDateBR, formatDecimal2, formatInt, formatMonth, formatPct } from '../format';
import { baseGrid, baseLegend, baseOption, categoryAxis, colors, seriesColors, toNumber, valueAxis } from '../theme';
import type { PageContext } from './types';

export function semReajustePage(ctx: PageContext): HTMLElement[] {
  const sr = dataset.semReajuste;
  const total = semReajusteTotal();
  const pct = formatPct(sr.reajuste);

  const kpis = kpiRow([
    kpi({ label: 'Diferença não paga', value: formatBRLCents(total.diferenca), sub: `reajuste de ${pct} não aplicado`, tone: 'loss' }),
    kpi({ label: 'Faturado', value: formatBRLCents(total.frete), sub: `${formatInt(total.fretes)} fretes` }),
    kpi({ label: `Faturado com reajuste`, value: formatBRLCents(total.freteReajustado), sub: `frete + ${pct}` }),
  ]);

  const { meses, clientes, valor } = semReajustePorMesCliente();
  const porMes = chartCard(
    {
      title: 'Diferença não paga por mês e cliente',
      height: 320,
      span: 5,
      option: {
        ...baseOption,
        legend: { ...baseLegend },
        grid: { ...baseGrid },
        tooltip: {
          ...baseOption.tooltip,
          trigger: 'axis',
          formatter: (params: unknown) => {
            const p = (params as Array<{ dataIndex: number }>)[0];
            if (!p) return '';
            const mes = meses[p.dataIndex]!;
            const linhas = clientes.map((c) => {
              const g = valor(mes, c);
              return `${c}: ${formatBRLCents(g.diferenca)} · ${g.fretes} fretes`;
            });
            return `<b>${formatMonth(mes)}</b><br/>${linhas.join('<br/>')}`;
          },
        },
        xAxis: categoryAxis(meses.map(formatMonth)),
        yAxis: valueAxis((v) => formatBRLCompact(toNumber(v))),
        series: clientes.map((c, i) => ({
          name: c,
          type: 'bar' as const,
          stack: 'dif',
          barMaxWidth: 56,
          itemStyle: { color: seriesColors[i % seriesColors.length] },
          data: meses.map((m) => valor(m, c).diferenca),
        })),
      },
      ariaLabel: `Diferença não paga por mês e cliente. Total ${formatBRL(total.diferenca)}.`,
    },
    ctx.pending,
  );

  const acum = semReajusteAcumulado();
  const acumulado = chartCard(
    {
      title: 'Diferença não paga acumulada',
      height: 320,
      span: 7,
      option: {
        ...baseOption,
        grid: { ...baseGrid, top: 16, right: 24 },
        tooltip: {
          ...baseOption.tooltip,
          trigger: 'axis',
          formatter: (params: unknown) => {
            const p = (params as Array<{ dataIndex: number }>)[0];
            if (!p) return '';
            const r = acum[p.dataIndex]!;
            return `<b>CTE ${r.cte}</b> · ${r.cliente}<br/>${formatDateBR(r.data)}<br/>Frete: ${formatBRLCents(r.frete)}<br/>Diferença: ${formatBRLCents(r.diferenca)}<br/>Acumulado: <b>${formatBRLCents(r.acumulado)}</b>`;
          },
        },
        xAxis: categoryAxis(acum.map((r) => formatDateBR(r.data).slice(0, 5))),
        yAxis: valueAxis((v) => formatBRLCompact(toNumber(v)), { min: 0 }),
        series: [
          {
            type: 'line',
            step: 'end',
            symbolSize: 5,
            lineStyle: { width: 2, color: colors.loss },
            itemStyle: { color: colors.loss },
            areaStyle: { color: colors.loss, opacity: 0.08 },
            data: acum.map((r) => r.acumulado),
          },
        ],
      },
      ariaLabel: `Diferença não paga acumulada frete a frete, chegando a ${formatBRL(total.diferenca)}.`,
    },
    ctx.pending,
  );

  const resumoClientes = clientes.map((c) => {
    const itens = sr.itens.filter((i) => i.cliente === c);
    const frete = itens.reduce((a, i) => a + i.frete, 0);
    return { cliente: c, fretes: itens.length, frete, diferenca: frete * sr.reajuste, kg: itens.reduce((a, i) => a + i.pesoKg, 0) };
  });
  const clientesTable = table({
    title: 'Por cliente',
    span: 12,
    rows: resumoClientes,
    columns: [
      { header: 'Cliente', cell: (r) => r.cliente },
      { header: 'Fretes', numeric: true, cell: (r) => formatInt(r.fretes) },
      { header: 'Peso (kg)', numeric: true, cell: (r) => formatInt(r.kg) },
      { header: 'Faturado', numeric: true, cell: (r) => formatBRLCents(r.frete) },
      { header: 'R$/kg', numeric: true, cell: (r) => formatDecimal2(r.frete / r.kg) },
      { header: 'Diferença não paga', numeric: true, cell: (r) => formatBRLCents(r.diferenca) },
    ],
  });

  const repetidos = new Set(sr.ctesRepetidos);
  const linhas = [...sr.itens].sort((a, b) => a.data.localeCompare(b.data) || a.cte - b.cte);
  const fretesTable = table<FreteSemReajuste>({
    title: 'Relação de fretes sem reajuste',
    rows: linhas,
    scroll: true,
    columns: [
      { header: 'Data', cell: (r) => formatDateBR(r.data) },
      { header: 'CTE', cell: (r) => (repetidos.has(r.cte) ? `${r.cte} (repetido)` : String(r.cte)) },
      { header: 'Cliente', cell: (r) => r.cliente },
      { header: 'Peso (kg)', numeric: true, cell: (r) => formatInt(r.pesoKg) },
      { header: 'Frete', numeric: true, cell: (r) => formatBRLCents(r.frete) },
      { header: `Com reajuste (${pct})`, numeric: true, cell: (r) => formatBRLCents(r.freteReajustado) },
      { header: 'Diferença não paga', numeric: true, cell: (r) => formatBRLCents(r.diferenca) },
    ],
    footer: [
      'Total',
      `${formatInt(total.fretes)} fretes`,
      '',
      formatInt(linhas.reduce((a, r) => a + r.pesoKg, 0)),
      formatBRLCents(total.frete),
      formatBRLCents(total.freteReajustado),
      formatBRLCents(total.diferenca),
    ],
  });

  return [kpis, section('Fretes sem reajuste', [grid([porMes, acumulado, clientesTable]), fretesTable])];
}
