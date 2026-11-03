/** Tokens visuais e blocos reutilizáveis de opção do ECharts. */
import type { ChartOption } from './echarts';

export const colors = {
  brand: '#0057FF',
  brandSoft: '#7FA8FF',
  loss: '#C62828',
  lossSoft: '#E57373',
  gain: '#2E7D4F',
  text: '#1F2933',
  textMuted: '#52606D',
  grid: '#E4E7EB',
  axis: '#9AA5B1',
  surface: '#FFFFFF',
  neutral: '#6B7785',
  neutralSoft: '#BCC4CE',
  alp: '#0057FF',
  g1: '#B45309',
} as const;

export const FONT_FAMILY = "Inter, 'Segoe UI', system-ui, -apple-system, Roboto, Arial, sans-serif";

/** Paleta sóbria para séries categóricas (grupos de custo). */
export const seriesColors = ['#0057FF', '#5C8DFF', '#A3BFFF', '#3E4C59', '#7B8794', '#CBD2D9'];

/** Cores das partes de despesa: tons de azul e cinza para o que a ALP desconta, tons de laranja para a G1. */
export const despesaColors: Record<string, string> = {
  Contrato: '#0057FF',
  Combustível: '#5C8DFF',
  Parcela: '#A3BFFF',
  'Manutenção/IPVA/seguro': '#3E4C59',
  'Mão de obra': '#B45309',
  'Veículos, peças e pneus': '#D97706',
  'Encargos INSS e FGTS': '#F59E0B',
  Materiais: '#FCD34D',
  Outros: '#E8C99B',
  Outras: '#BCC4CE',
};

export const baseOption: ChartOption = {
  animation: false,
  color: [colors.brand, colors.neutral, colors.loss, colors.brandSoft],
  textStyle: { fontFamily: FONT_FAMILY, color: colors.text, fontSize: 12 },
  tooltip: {
    backgroundColor: colors.surface,
    borderColor: colors.grid,
    borderWidth: 1,
    textStyle: { color: colors.text, fontSize: 12, fontFamily: FONT_FAMILY },
    extraCssText: 'box-shadow: none; border-radius: 0;',
    axisPointer: { type: 'line', lineStyle: { color: colors.axis, width: 1 } },
  },
};

export const baseLegend = {
  top: 0,
  textStyle: { color: colors.textMuted, fontSize: 12 },
  icon: 'rect',
  itemWidth: 10,
  itemHeight: 10,
} as const;

export const baseGrid = { left: 8, right: 16, top: 40, bottom: 8, containLabel: true } as const;

export function categoryAxis(data: string[], extra: { rotate?: number } = {}) {
  return {
    type: 'category' as const,
    data,
    axisLine: { lineStyle: { color: colors.axis } },
    axisTick: { show: false },
    axisLabel: { color: colors.textMuted, fontSize: 11, ...extra },
  };
}

export function valueAxis(formatter: (value: number) => string, extra: { min?: number | 'dataMin'; max?: number } = {}) {
  return {
    type: 'value' as const,
    ...extra,
    axisLine: { show: false },
    axisTick: { show: false },
    axisLabel: { color: colors.textMuted, fontSize: 11, formatter },
    splitLine: { lineStyle: { color: colors.grid } },
  };
}

/** Converte o valor recebido por formatters do ECharts em número. */
export function toNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  if (Array.isArray(value)) return toNumber(value[value.length - 1]);
  return Number(value);
}
