import {
  dataset,
  faturamentoDespesasMensal,
  marcaEstimado,
  monthlySeries,
  resultTotals,
  retornoResumo,
  selectPlacaMes,
  totalsOf,
  waterfallSteps,
} from '../../data/model';
import type { WaterfallStep } from '../../data/model';
import type { ChartOption } from '../echarts';
import { chartCard, grid, kpi, kpiRow, section, table } from '../components';
import {
  formatBRL,
  formatBRLCompact,
  formatBRLCompactSigned,
  formatInt,
  formatMonth,
  formatMonthLong,
  formatPct,
} from '../format';
import { baseGrid, baseLegend, baseOption, categoryAxis, colors, despesaColors, seriesColors, toNumber, valueAxis } from '../theme';
import type { PageContext } from './types';

interface Segment {
  /** parte acima de zero: base transparente + barra */
  posBase: number;
  pos: number;
  /** parte abaixo de zero: base transparente + barra (valores negativos) */
  negBase: number;
  neg: number;
  /** ponto do rótulo (topo visual da barra) */
  top: number;
  text: string;
  color: string;
}

/** Quebra cada barra em parte positiva e negativa: barras que cruzam o zero (Sienge) ficam corretas. */
function toSegments(steps: WaterfallStep[]): Segment[] {
  let running = 0;
  return steps.map((step) => {
    let from: number;
    let to: number;
    if (step.kind === 'delta') {
      from = running;
      to = running + step.value;
      running = to;
    } else {
      from = 0;
      to = step.value;
      running = step.value;
    }
    const low = Math.min(from, to);
    const high = Math.max(from, to);
    const color = step.kind === 'delta' ? (step.value >= 0 ? colors.gain : colors.loss) : colors.brand;
    return {
      posBase: Math.max(0, low),
      pos: Math.max(0, high) - Math.max(0, low),
      negBase: Math.min(0, high),
      neg: Math.min(0, low) - Math.min(0, high),
      top: high,
      text: step.kind === 'delta' ? formatBRLCompactSigned(step.value) : formatBRLCompact(step.value),
      color,
    };
  });
}

function waterfallOption(steps: WaterfallStep[]): ChartOption {
  const seg = toSegments(steps);
  const labels = steps.map((s) => s.label);
  const bar = (name: string, pick: (g: Segment) => number) => ({
    name,
    type: 'bar' as const,
    stack: 'w',
    barMaxWidth: 56,
    data: seg.map((g) => ({ value: pick(g), itemStyle: { color: g.color } })),
  });
  const hidden = (name: string, pick: (g: Segment) => number) => ({
    name,
    type: 'bar' as const,
    stack: 'w',
    silent: true,
    barMaxWidth: 56,
    itemStyle: { color: 'transparent' },
    data: seg.map(pick),
  });
  return {
    ...baseOption,
    grid: { ...baseGrid, top: 28, bottom: 24 },
    tooltip: {
      ...baseOption.tooltip,
      trigger: 'axis',
      formatter: (params: unknown) => {
        const p = (params as Array<{ dataIndex: number }>)[0];
        if (!p) return '';
        const s = steps[p.dataIndex]!;
        return `${s.label}<br/><b>${formatBRL(s.value)}</b>`;
      },
    },
    xAxis: {
      ...categoryAxis(labels),
      axisLabel: { color: colors.textMuted, fontSize: 11, interval: 0, width: 92, overflow: 'break' as const },
    },
    yAxis: valueAxis((v) => formatBRLCompact(toNumber(v))),
    series: [
      hidden('base+', (g) => g.posBase),
      bar('parte positiva', (g) => g.pos),
      hidden('base-', (g) => g.negBase),
      bar('parte negativa', (g) => g.neg),
      {
        name: 'rótulos',
        type: 'line',
        silent: true,
        symbol: 'circle',
        symbolSize: 1,
        itemStyle: { color: 'transparent', borderWidth: 0 },
        lineStyle: { width: 0 },
        tooltip: { show: false },
        data: seg.map((g) => ({
          value: g.top,
          label: { show: true, position: 'top' as const, color: g.color, fontSize: 11, fontWeight: 600, formatter: g.text },
        })),
      },
    ],
  };
}

export function overviewPage(ctx: PageContext): HTMLElement[] {
  const { filter } = ctx;
  const rows = selectPlacaMes(filter);
  const t = totalsOf(rows);
  const rt = resultTotals(rows);
  const pctFrete = (v: number): string => formatPct(t.faturamento ? v / t.faturamento : 0);

  const kpis = kpiRow([
    kpi({ label: 'Faturamento', value: formatBRL(t.faturamento), sub: `${formatInt(t.fretes)} fretes${t.pesoKg === null ? '' : ` · ${formatInt(t.pesoKg / 1000)} t`}` }),
    kpi({ label: 'Contrato', value: formatBRL(t.despesaAlp), sub: `${pctFrete(t.despesaAlp)} do frete` }),
    kpi({ label: 'Combustível', value: formatBRL(t.combustivel), sub: `${pctFrete(t.combustivel)} do frete` }),
    kpi({ label: 'Parcela', value: formatBRL(t.parcela), sub: 'descontada no acerto' }),
    kpi({ label: 'Manutenção/IPVA/seguro', value: formatBRL(t.manutencaoAlp), sub: 'acerto ALP' }),
    kpi({ label: 'Livre G1', value: formatBRL(t.livreG1), sub: `margem ${formatPct(t.margemPct)} do frete` }),
    kpi({
      label: 'Resultado G1',
      value: rt ? formatBRL(rt.resultadoG1) : '—',
      tone: rt && rt.resultadoG1 < 0 ? 'loss' : 'neutral',
    }),
  ]);

  const { steps } = waterfallSteps(rows);
  const wf = chartCard(
    {
      title: 'Do frete ao Livre G1 e ao Resultado G1',
      height: 360,
      span: 12,
      option: waterfallOption(steps),
      ariaLabel: `Cascata do frete de ${formatBRL(steps[0]?.value ?? 0)} até o Livre G1.`,
    },
    ctx.pending,
  );

  // ---------- Faturamento x despesas particionadas ----------
  const fd = faturamentoDespesasMensal(filter.placa);
  const nomesPartes = fd[0]?.partes.map((p) => p.nome) ?? [];
  const fatMax = Math.max(...fd.map((m) => m.faturamento), 1);
  const fretesMax = Math.max(...fd.map((m) => m.fretes), 1);
  const fatDespChart = chartCard(
    {
      title: 'Faturamento e fretes por mês',
      height: 380,
      span: 8,
      option: {
        ...baseOption,
        legend: { ...baseLegend },
        grid: baseGrid,
        tooltip: {
          ...baseOption.tooltip,
          trigger: 'axis',
          axisPointer: { type: 'shadow' },
          formatter: (params: unknown) => {
            const p = (params as Array<{ dataIndex: number }>)[0];
            if (!p) return '';
            const m = fd[p.dataIndex]!;
            return `<b>${formatMonthLong(m.mes)}</b><br/>Faturamento: <b>${formatBRL(m.faturamento)}</b><br/>Fretes: <b>${formatInt(m.fretes)}</b>`;
          },
        },
        xAxis: categoryAxis(fd.map((m) => `${formatMonth(m.mes)}${marcaEstimado(m.mes)}`)),
        // barras de faturamento embaixo e a linha de fretes acima delas
        yAxis: [
          valueAxis((v) => formatBRLCompact(toNumber(v)), { min: 0, max: fatMax * 1.9 }),
          { ...valueAxis((v) => String(v), { min: 0, max: fretesMax / 0.9 }), show: false, splitLine: { show: false } },
        ],
        series: [
          {
            name: 'Faturamento',
            type: 'bar',
            barMaxWidth: 64,
            itemStyle: { color: colors.gain },
            label: { show: true, position: 'top', color: colors.gain, fontSize: 11, fontWeight: 600, formatter: (p: { value: unknown }) => formatBRLCompact(toNumber(p.value)) },
            data: fd.map((m) => m.faturamento),
          },
          {
            name: 'Fretes',
            type: 'line',
            yAxisIndex: 1,
            symbolSize: 10,
            lineStyle: { width: 3 },
            itemStyle: { color: colors.brand },
            label: { show: true, position: 'top', color: colors.brand, fontSize: 11, fontWeight: 600, formatter: (p: { value: unknown }) => `${formatInt(toNumber(p.value))} fretes` },
            data: fd.map((m) => m.fretes),
          },
        ],
      },
      ariaLabel: 'Faturamento e quantidade de fretes por mês, de julho a outubro.',
    },
    ctx.pending,
  );

  // ---------- Retorno carregado ----------
  const ret = retornoResumo(filter);
  const retChart = chartCard(
    {
      title: 'Retorno carregado sobre o total de fretes',
      height: 380,
      span: 4,
      option: {
        ...baseOption,
        legend: { ...baseLegend, top: 'bottom' },
        title: {
          text: `${formatInt(ret.comRetorno)}`,
          subtext: ret.comRetorno === 1 ? 'retorno carregado' : 'retornos carregados',
          left: 'center',
          top: '34%',
          textAlign: 'center',
          textStyle: { color: colors.brand, fontSize: 32, fontWeight: 700 },
          subtextStyle: { color: colors.textMuted, fontSize: 12 },
        },
        tooltip: {
          ...baseOption.tooltip,
          trigger: 'item',
          formatter: (p: unknown) => {
            const d = p as { name: string; value: number; percent: number; dataIndex: number };
            const kg = d.dataIndex === 0 ? `<br/>Carga de retorno: <b>${formatInt(ret.kgRetorno / 1000)} t</b>` : '';
            return `${d.name}<br/><b>${formatInt(d.value)} fretes</b> (${formatPct(d.percent / 100)})${kg}`;
          },
        },
        series: [
          {
            type: 'pie',
            radius: ['48%', '72%'],
            center: ['50%', '45%'],
            avoidLabelOverlap: true,
            itemStyle: { borderColor: colors.surface, borderWidth: 2 },
            label: {
              show: true,
              color: colors.text,
              fontSize: 12,
              formatter: (p) => `${formatInt(toNumber(p.value))} fretes
${formatPct((p.percent ?? 0) / 100)}`,
            },
            labelLine: { show: true },
            data: [
              { name: 'Com retorno carregado', value: ret.comRetorno, itemStyle: { color: colors.brand } },
              { name: 'Sem retorno carregado', value: ret.semRetorno, itemStyle: { color: colors.neutralSoft } },
            ],
          },
        ],
      },
      ariaLabel: `${formatInt(ret.comRetorno)} de ${formatInt(ret.fretes)} fretes tiveram retorno carregado, ${formatPct(ret.pct)} do total.`,
    },
    ctx.pending,
  );

  const series = monthlySeries(filter.placa);
  const evo = chartCard(
    {
      title: 'Evolução mensal por competência',
      height: 320,
      span: 12,
      option: {
        ...baseOption,
        legend: { ...baseLegend },
        grid: baseGrid,
        tooltip: {
          ...baseOption.tooltip,
          trigger: 'axis',
          valueFormatter: (v) => (v === null || v === undefined || v === '-' ? 'sem dado' : formatBRL(toNumber(v))),
        },
        xAxis: categoryAxis(series.map((s) => formatMonth(s.mes))),
        yAxis: valueAxis((v) => formatBRLCompact(toNumber(v))),
        series: [
          { name: 'Frete', type: 'bar', barMaxWidth: 48, itemStyle: { color: colors.neutralSoft }, data: series.map((s) => s.faturamento) },
          { name: 'Livre G1', type: 'line', symbolSize: 8, lineStyle: { width: 3 }, itemStyle: { color: colors.brand }, data: series.map((s) => s.livreG1) },
          { name: 'Resultado G1', type: 'line', symbolSize: 8, lineStyle: { width: 3, type: 'dashed' }, itemStyle: { color: colors.loss }, data: series.map((s) => s.resultadoG1) },
        ],
      },
      ariaLabel: 'Evolução mensal de frete, Livre G1 e Resultado G1 de julho a outubro.',
    },
    ctx.pending,
  );

  const monthRows = dataset.meta.meses.map((mes) => {
    const r = selectPlacaMes({ mes, placa: filter.placa });
    return {
      mes,
      t: totalsOf(r),
      rt: resultTotals(r),
      sienge: r.reduce((a, x) => a + (x.siengeTotal ?? 0), 0),
      temSienge: r.every((x) => x.sienge !== null),
      estimado: r.some((x) => (x.siengeEstimado ?? 0) > 0),
    };
  });
  const tbl = table({
    title: 'Resumo por mês',
    rows: monthRows,
    scroll: true,
    columns: [
      { header: 'Mês', cell: (r) => formatMonthLong(r.mes) },
      { header: 'Fretes', numeric: true, cell: (r) => formatInt(r.t.fretes) },
      { header: 'Frete', numeric: true, cell: (r) => formatBRL(r.t.faturamento) },
      { header: 'Contrato', numeric: true, cell: (r) => formatBRL(r.t.despesaAlp) },
      { header: 'Combustível', numeric: true, cell: (r) => formatBRL(r.t.combustivel) },
      { header: 'Parcela', numeric: true, cell: (r) => formatBRL(r.t.parcela) },
      { header: 'Manut. ALP', numeric: true, cell: (r) => formatBRL(r.t.manutencaoAlp) },
      { header: 'Livre G1', numeric: true, cell: (r) => formatBRL(r.t.livreG1) },
      { header: 'Margem', numeric: true, cell: (r) => formatPct(r.t.margemPct) },
      { header: 'Custos G1', numeric: true, cell: (r) => (r.temSienge ? `${formatBRL(r.sienge)}${r.estimado ? '*' : ''}` : '—') },
      { header: 'Resultado G1', numeric: true, cell: (r) => (r.rt ? `${formatBRL(r.rt.resultadoG1)}${r.estimado ? '*' : ''}` : '—') },
      { header: 'Margem G1 líquida', numeric: true, cell: (r) => (r.rt && r.t.faturamento ? `${formatPct(r.rt.resultadoG1 / r.t.faturamento)}${r.estimado ? '*' : ''}` : '—') },
    ],
  });


  // ---------- Despesas ----------
  // mesma partição detalhada do gráfico acima, com o % de cada parte no total das despesas na legenda
  const totalPorParte = new Map<string, number>(nomesPartes.map((nome, i) => [nome, fd.reduce((a, m) => a + (m.partes[i]?.valor ?? 0), 0)]));
  const totalGeralDesp = [...totalPorParte.values()].reduce((a, b) => a + b, 0);
  const despChart = chartCard(
    {
      title: 'Despesas por mês',
      height: 400,
      span: 12,
      option: {
        ...baseOption,
        legend: {
          ...baseLegend,
          formatter: (nome: string) => `${nome} ${formatPct(totalGeralDesp ? (totalPorParte.get(nome) ?? 0) / totalGeralDesp : 0)}`,
        },
        grid: baseGrid,
        tooltip: {
          ...baseOption.tooltip,
          trigger: 'axis',
          axisPointer: { type: 'shadow' },
          formatter: (params: unknown) => {
            const p = (params as Array<{ dataIndex: number }>)[0];
            if (!p) return '';
            const m = fd[p.dataIndex]!;
            const linhas = m.partes
              .filter((x) => x.valor !== 0)
              .map((x) => `${x.nome}: ${formatBRL(x.valor)} (${formatPct(m.totalDespesas ? x.valor / m.totalDespesas : 0)})`);
            return `<b>${formatMonthLong(m.mes)}</b><br/>${linhas.join('<br/>')}<br/>Total das despesas: <b>${formatBRL(m.totalDespesas)}</b>`;
          },
        },
        xAxis: categoryAxis(fd.map((m) => `${formatMonth(m.mes)}${marcaEstimado(m.mes)}`)),
        yAxis: valueAxis((v) => formatBRLCompact(toNumber(v))),
        series: nomesPartes.map((nome, i) => ({
          name: nome,
          type: 'bar' as const,
          stack: 'd',
          barMaxWidth: 56,
          itemStyle: { color: despesaColors[nome] ?? seriesColors[i % seriesColors.length] },
          data: fd.map((m) => m.partes[i]?.valor ?? 0),
        })),
      },
      ariaLabel: 'Despesas por mês divididas em contrato, combustível, parcela, manutenção, grupos do Sienge e outras, com o percentual de cada parte na legenda.',
    },
    ctx.pending,
  );

  return [kpis, section('Visão geral', [grid([wf, fatDespChart, retChart, despChart, evo]), tbl])];
}
