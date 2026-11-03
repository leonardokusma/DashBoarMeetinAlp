import { ALL_MONTHS, ALL_PLATES, dataset } from '../data/model';
import type { Filter } from '../data/types';
import type { PendingChart } from './components';
import { el } from './dom';
import { initChart } from './echarts';
import type { ChartInstance } from './echarts';
import { formatMonthLong } from './format';
import { costsPage } from './pages/costs';
import { freightPage } from './pages/freight';
import { overviewPage } from './pages/overview';
import { trucksPage } from './pages/trucks';
import type { PageContext } from './pages/types';

interface PageDef {
  id: string;
  label: string;
  build: (ctx: PageContext) => HTMLElement[];
  /** Quais filtros fazem sentido nesta página. */
  filters: { mes: boolean; placa: boolean };
}

const PAGES: PageDef[] = [
  { id: 'visao', label: 'Visão geral', build: overviewPage, filters: { mes: true, placa: true } },
  { id: 'caminhao', label: 'Por caminhão', build: trucksPage, filters: { mes: true, placa: false } },
  { id: 'frete', label: 'Queda de frete', build: freightPage, filters: { mes: true, placa: true } },
  { id: 'custos', label: 'Custos e diesel', build: costsPage, filters: { mes: true, placa: true } },
];

interface State {
  page: string;
  filter: Filter;
}

function readHash(): State {
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const page = PAGES.some((p) => p.id === params.get('p')) ? (params.get('p') as string) : 'visao';
  const mes = params.get('mes');
  const placa = params.get('placa');
  return {
    page,
    filter: {
      mes: mes && dataset.meta.meses.includes(mes) ? mes : ALL_MONTHS,
      placa: placa && dataset.meta.placas.includes(placa) ? placa : ALL_PLATES,
    },
  };
}

function writeHash(state: State): void {
  const params = new URLSearchParams({ p: state.page, mes: state.filter.mes, placa: state.filter.placa });
  history.replaceState(null, '', `#${params.toString()}`);
}

function select(label: string, value: string, options: Array<[string, string]>, enabled: boolean, onChange: (v: string) => void): HTMLElement {
  const sel = el('select', { className: 'filter__select', attrs: { 'aria-label': label } });
  for (const [v, text] of options) {
    const opt = el('option', { text, attrs: { value: v } });
    if (v === value) opt.selected = true;
    sel.append(opt);
  }
  sel.disabled = !enabled;
  sel.addEventListener('change', () => onChange(sel.value));
  return el('label', { className: `filter${enabled ? '' : ' filter--off'}` }, [el('span', { className: 'filter__label', text: label }), sel]);
}

export function mountApp(root: HTMLElement): void {
  let state = readHash();
  let charts: ChartInstance[] = [];
  const observer = new ResizeObserver((entries) => {
    for (const entry of entries) charts.find((c) => c.getDom() === entry.target)?.resize();
  });

  const header = el('header', { className: 'header' });
  const nav = el('nav', { className: 'tabs', attrs: { 'aria-label': 'Páginas' } });
  const main = el('main', { className: 'main' });
  root.replaceChildren(el('div', { className: 'page' }, [header, nav, main]));

  function renderAll(): void {
    writeHash(state);
    const def = PAGES.find((p) => p.id === state.page) ?? PAGES[0]!;

    header.replaceChildren(
      el('div', { className: 'header__brand' }, [
        el('img', { className: 'header__logo', attrs: { src: './logo-g1.png', alt: 'G1 Transporte', width: '220', height: '44' } }),
        el('h1', { className: 'header__title', text: 'G1 Transporte × ALP/Brucker' }),
      ]),
      el('div', { className: 'filters' }, [
        select(
          'Mês',
          state.filter.mes,
          [[ALL_MONTHS, 'Todos os meses'], ...dataset.meta.meses.map((m): [string, string] => [m, formatMonthLong(m)])],
          def.filters.mes,
          (v) => {
            state = { ...state, filter: { ...state.filter, mes: v } };
            renderAll();
          },
        ),
        select(
          'Placa',
          state.filter.placa,
          [[ALL_PLATES, 'Todas as placas'], ...dataset.meta.placas.map((p): [string, string] => [p, p])],
          def.filters.placa,
          (v) => {
            state = { ...state, filter: { ...state.filter, placa: v } };
            renderAll();
          },
        ),
      ]),
    );

    nav.replaceChildren(
      ...PAGES.map((p) => {
        const a = el('button', { className: `tab${p.id === state.page ? ' tab--active' : ''}`, text: p.label, attrs: { type: 'button' } });
        if (p.id === state.page) a.setAttribute('aria-current', 'page');
        a.addEventListener('click', () => {
          state = { ...state, page: p.id };
          renderAll();
          window.scrollTo({ top: 0 });
        });
        return a;
      }),
    );

    for (const c of charts) {
      observer.unobserve(c.getDom());
      c.dispose();
    }
    charts = [];

    const pending: PendingChart[] = [];
    const nodes = def.build({ filter: state.filter, pending });
    main.replaceChildren(...nodes);
    for (const { canvas, option } of pending) {
      const chart = initChart(canvas);
      chart.setOption(option);
      charts.push(chart);
      observer.observe(canvas);
    }
  }

  window.addEventListener('beforeprint', () => charts.forEach((c) => c.resize()));
  window.addEventListener('afterprint', () => charts.forEach((c) => c.resize()));
  renderAll();
}
