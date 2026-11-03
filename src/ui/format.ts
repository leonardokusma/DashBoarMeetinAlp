/** Formatadores pt-BR. Sem lógica de negócio. */

const MINUS = '−';

const brl = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  maximumFractionDigits: 0,
});

const brlCents = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const brlCompact = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  notation: 'compact',
  maximumFractionDigits: 1,
});

const integer = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
const decimal1 = new Intl.NumberFormat('pt-BR', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

const pct1 = new Intl.NumberFormat('pt-BR', {
  style: 'percent',
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

function clean(text: string): string {
  return text.replace(/-/g, MINUS).replace(/ /g, ' ');
}

function signed(text: string, value: number): string {
  return value > 0 ? `+${text}` : text;
}

/** R$ 1.234 */
export function formatBRL(value: number): string {
  return clean(brl.format(value));
}

/** R$ 1.234,56 */
export function formatBRLCents(value: number): string {
  return clean(brlCents.format(value));
}

/** R$ 1,2 mi / R$ 850 mil */
export function formatBRLCompact(value: number): string {
  return clean(brlCompact.format(value));
}

/** +R$ 1.234 / −R$ 1.234 */
export function formatBRLSigned(value: number): string {
  return signed(formatBRL(value), value);
}

export function formatBRLCompactSigned(value: number): string {
  return signed(formatBRLCompact(value), value);
}

export function formatInt(value: number): string {
  return clean(integer.format(value));
}

export function formatIntSigned(value: number): string {
  return signed(formatInt(value), value);
}

/** Fração (0.123) para "12,3%". */
export function formatPct(fraction: number): string {
  return clean(pct1.format(fraction)).replace(' ', '');
}

export function formatPctSigned(fraction: number): string {
  return signed(formatPct(fraction), fraction);
}

/** Diferença em pontos percentuais a partir de fração: "−3,2 p.p.". */
export function formatPoints(fractionDiff: number): string {
  return signed(clean(`${decimal1.format(fractionDiff * 100)} p.p.`), fractionDiff);
}

/** R$ 6,12/L */
export function formatLiter(value: number): string {
  return `${formatBRLCents(value)}/L`;
}

/** 'YYYY-MM' -> 'jan/25' */
export function formatMonth(month: string): string {
  const [year, mm] = month.split('-');
  const name = MONTHS[Number(mm) - 1] ?? mm;
  return `${name}/${(year ?? '').slice(-2)}`;
}

const decimal2 = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** 1.234,56 (sem moeda) */
export function formatDecimal2(value: number): string {
  return clean(decimal2.format(value));
}

/** '2026-09-28' -> '28/09/2026' */
export function formatDateBR(iso: string | null): string {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

/** 'YYYY-MM' -> 'set/2026' */
export function formatMonthLong(month: string): string {
  const [year, mm] = month.split('-');
  return `${MONTHS[Number(mm) - 1] ?? mm}/${year}`;
}
