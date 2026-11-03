/** Blocos de UI reutilizáveis: indicador, gráfico, tabela e seção. Tudo em texto simples. */
import type { ChartOption } from './echarts';
import { el } from './dom';

export type Tone = 'loss' | 'gain' | 'neutral';

export interface PendingChart {
  canvas: HTMLElement;
  option: ChartOption;
}

export interface ChartCardOptions {
  title: string;
  height: number;
  span: 4 | 5 | 6 | 7 | 8 | 12;
  option: ChartOption;
  ariaLabel: string;
}

export function chartCard(opts: ChartCardOptions, pending: PendingChart[]): HTMLElement {
  const canvas = el('div', {
    className: 'chart__canvas',
    attrs: { role: 'img', 'aria-label': opts.ariaLabel },
  });
  canvas.style.height = `${opts.height}px`;
  pending.push({ canvas, option: opts.option });
  return el('article', { className: `block span-${opts.span}` }, [el('h3', { className: 'block__title', text: opts.title }), canvas]);
}

export interface KpiOptions {
  label: string;
  value: string;
  sub?: string;
  tone?: Tone;
}

export function kpi(o: KpiOptions): HTMLElement {
  return el('article', { className: 'kpi' }, [
    el('h3', { className: 'kpi__label', text: o.label }),
    el('p', { className: `kpi__value${o.tone === 'loss' ? ' kpi__value--loss' : ''}`, text: o.value }),
    o.sub ? el('p', { className: 'kpi__sub', text: o.sub }) : null,
  ]);
}

export function kpiRow(items: HTMLElement[]): HTMLElement {
  return el('section', { className: 'kpis' }, items);
}

export function section(title: string, children: Array<HTMLElement | null>): HTMLElement {
  return el('section', { className: 'section' }, [el('h2', { className: 'section__title', text: title }), ...children]);
}

/** Nota de apoio (premissas, avisos). Lista curta de frases; o título é opcional. */
export function callout(title: string, lines: string[]): HTMLElement {
  return el('aside', { className: 'callout' }, [
    el('h3', { className: 'callout__title', text: title }),
    el('ul', { className: 'callout__list' }, lines.map((l) => el('li', { text: l }))),
  ]);
}

export function grid(children: Array<HTMLElement | null>): HTMLElement {
  return el('div', { className: 'grid' }, children);
}

export interface Column<T> {
  header: string;
  /** Texto ou nó da célula. */
  cell: (row: T) => string | Node;
  numeric?: boolean;
}

export interface TableOptions<T> {
  title: string;
  columns: Column<T>[];
  rows: T[];
  span?: 4 | 5 | 6 | 7 | 8 | 12;
  footer?: (string | Node)[];
  /** Classe de linha (destaque em negrito para grupos e totais). */
  rowClass?: (row: T) => string | undefined;
  scroll?: boolean;
  empty?: string;
}

export function table<T>(o: TableOptions<T>): HTMLElement {
  const head = el(
    'tr',
    {},
    o.columns.map((c) => el('th', { className: c.numeric ? 'num' : '', text: c.header, attrs: { scope: 'col' } })),
  );
  const body = o.rows.map((row) =>
    el(
      'tr',
      { className: o.rowClass?.(row) ?? '' },
      o.columns.map((c) => {
        const content = c.cell(row);
        return el('td', { className: c.numeric ? 'num' : '' }, [typeof content === 'string' ? document.createTextNode(content) : content]);
      }),
    ),
  );
  const foot = o.footer
    ? el('tfoot', {}, [
        el(
          'tr',
          {},
          o.footer.map((f, i) => el('td', { className: o.columns[i]?.numeric ? 'num' : '' }, [typeof f === 'string' ? document.createTextNode(f) : f])),
        ),
      ])
    : null;
  const tbl = el('table', { className: 'table' }, [el('thead', {}, [head]), el('tbody', {}, body), foot]);
  const wrap = el('div', { className: `table__wrap${o.scroll ? ' table__wrap--scroll' : ''}` }, [tbl]);
  return el('article', { className: `block span-${o.span ?? 12}` }, [
    el('h3', { className: 'block__title', text: o.title }),
    o.rows.length === 0 ? el('p', { className: 'empty', text: o.empty ?? 'Sem dados.' }) : wrap,
  ]);
}
