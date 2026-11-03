/** Agregações puras sobre o dataset real. Sem DOM, sem formatação. */
import raw from './real/dataset.json';
import type {
  Dataset,
  DieselMes,
  Filter,
  FreteComparado,
  KmPlaca,
  ManutencaoLinha,
  PlacaMes,
  SiengeLinha,
} from './types';

export const dataset = raw as unknown as Dataset;

export const ALL_MONTHS = 'todos';
export const ALL_PLATES = 'todas';

const sum = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0);
const round2 = (n: number): number => Math.round(n * 100) / 100;

function matchMes(f: Filter, mes: string): boolean {
  return f.mes === ALL_MONTHS || f.mes === mes;
}
function matchPlaca(f: Filter, placa: string): boolean {
  return f.placa === ALL_PLATES || f.placa === placa;
}

export function selectPlacaMes(f: Filter, ds: Dataset = dataset): PlacaMes[] {
  return ds.placaMes.filter((r) => matchMes(f, r.mes) && matchPlaca(f, r.placa));
}

export interface Totals {
  fretes: number;
  /** null quando algum mês do filtro não tem peso (só outubro tem). */
  pesoKg: number | null;
  faturamento: number;
  despesaAlp: number;
  combustivel: number;
  parcela: number;
  manutencaoAlp: number;
  livreG1: number;
  /** margem do Livre G1 sobre o faturamento (0..1) */
  margemPct: number;
}

export function totalsOf(rows: readonly PlacaMes[]): Totals {
  const faturamento = sum(rows.map((r) => r.faturamento));
  const livreG1 = sum(rows.map((r) => r.livreG1));
  return {
    fretes: sum(rows.map((r) => r.fretes)),
    pesoKg: rows.length > 0 && rows.every((r) => r.pesoKg !== null) ? sum(rows.map((r) => r.pesoKg ?? 0)) : null,
    faturamento,
    despesaAlp: sum(rows.map((r) => r.despesaAlp)),
    combustivel: sum(rows.map((r) => r.combustivel)),
    parcela: sum(rows.map((r) => r.parcela)),
    manutencaoAlp: sum(rows.map((r) => r.manutencaoAlp)),
    livreG1,
    margemPct: faturamento === 0 ? 0 : livreG1 / faturamento,
  };
}

/** Linhas com custo do Sienge (real ou estimado): únicas onde o Resultado G1 existe. */
export function rowsWithSienge(rows: readonly PlacaMes[]): PlacaMes[] {
  return rows.filter((r) => r.sienge !== null && r.resultadoG1 !== null);
}

export interface ResultTotals {
  livreG1: number;
  sienge: number;
  extras: number;
  /** parte do Sienge que é estimativa (jul/ago) */
  estimado: number;
  resultadoG1: number;
  meses: string[];
  /** meses do filtro que têm parte estimada */
  mesesEstimados: string[];
}

export function resultTotals(rows: readonly PlacaMes[]): ResultTotals | null {
  const r = rowsWithSienge(rows);
  if (r.length === 0) return null;
  const livreG1 = sum(r.map((x) => x.livreG1));
  const sienge = sum(r.map((x) => x.siengeTotal ?? 0));
  const extras = sum(r.map((x) => x.despesasExtrasRateio));
  return {
    livreG1,
    sienge,
    extras,
    estimado: sum(r.map((x) => x.siengeEstimado ?? 0)),
    resultadoG1: livreG1 - sienge - extras,
    meses: [...new Set(r.map((x) => x.mes))].sort(),
    mesesEstimados: [...new Set(r.filter((x) => (x.siengeEstimado ?? 0) > 0).map((x) => x.mes))].sort(),
  };
}

export interface WaterfallStep {
  label: string;
  value: number;
  kind: 'start' | 'delta' | 'total';
}

/** Cascata: frete -> Livre G1 (-> Resultado G1 quando há Sienge). */
export function waterfallSteps(rows: readonly PlacaMes[]): { steps: WaterfallStep[]; withResult: boolean } {
  const withS = rowsWithSienge(rows);
  const base = withS.length > 0 ? withS : [...rows];
  const t = totalsOf(base);
  const steps: WaterfallStep[] = [
    { label: 'Frete', value: t.faturamento, kind: 'start' },
    { label: 'Contrato', value: -t.despesaAlp, kind: 'delta' },
    { label: 'Combustível', value: -t.combustivel, kind: 'delta' },
    { label: 'Parcela', value: -t.parcela, kind: 'delta' },
    { label: 'Manutenção/IPVA/seguro', value: -t.manutencaoAlp, kind: 'delta' },
    { label: 'Livre G1', value: t.livreG1, kind: 'total' },
  ];
  if (withS.length === 0) return { steps, withResult: false };
  const rt = resultTotals(withS);
  if (!rt) return { steps, withResult: false };
  steps.push(
    { label: 'Custos G1', value: -rt.sienge, kind: 'delta' },
    { label: 'Outras', value: -rt.extras, kind: 'delta' },
    { label: 'Resultado G1', value: rt.resultadoG1, kind: 'total' },
  );
  return { steps, withResult: true };
}

export interface MonthPoint {
  mes: string;
  faturamento: number;
  livreG1: number;
  resultadoG1: number | null;
}

export function monthlySeries(placa: string, ds: Dataset = dataset): MonthPoint[] {
  return ds.meta.meses.map((mes) => {
    const rows = selectPlacaMes({ mes, placa }, ds);
    const t = totalsOf(rows);
    const rt = resultTotals(rows);
    return {
      mes,
      faturamento: t.faturamento,
      livreG1: t.livreG1,
      resultadoG1: rt ? rt.resultadoG1 : null,
    };
  });
}

export interface PlateRow extends Totals {
  placa: string;
  litros: number | null;
  kmPorLitro: number | null;
  resultadoG1: number | null;
}

export function plateRanking(f: Filter, ds: Dataset = dataset): PlateRow[] {
  const rows = ds.meta.placas.map((placa): PlateRow => {
    const sel = selectPlacaMes({ mes: f.mes, placa }, ds);
    const t = totalsOf(sel);
    const rt = resultTotals(sel);
    const km = ds.km.filter((k) => k.placa === placa && matchMes(f, k.mes));
    const litros = sum(km.map((k) => k.litros));
    const kmSum = sum(km.map((k) => k.km));
    return {
      ...t,
      placa,
      litros: km.length ? litros : null,
      kmPorLitro: km.length && litros > 0 ? kmSum / litros : null,
      resultadoG1: rt ? rt.resultadoG1 : null,
    };
  });
  return rows.sort((a, b) => b.livreG1 - a.livreG1);
}

// ---------- Queda de frete ----------

const COMPARATIVE_MONTHS = ['2026-08', '2026-09', '2026-10'];

export function selectComparativo(f: Filter, ds: Dataset = dataset): FreteComparado[] {
  return ds.comparativo.filter((c) => matchMes(f, c.mes) && matchPlaca(f, c.placa));
}

/** Padroniza destinos digitados com caixa diferente (LONDRINA, Londrina). */
export function normalizeDestino(destino: string): string {
  const lower = destino.trim().toLowerCase();
  return lower.replace(/(^|\s)\S/g, (m) => m.toUpperCase());
}

export interface PerdaResumo {
  key: string;
  fretes: number;
  comparaveis: number;
  naoComparaveis: number;
  freteAnterior: number;
  freteAtual: number;
  perda: number;
  perdaPct: number;
}

function resumir(key: string, items: readonly FreteComparado[]): PerdaResumo {
  const comp = items.filter((c) => c.perda !== null && c.freteAnterior !== null);
  const freteAnterior = sum(comp.map((c) => c.freteAnterior ?? 0));
  const perda = sum(comp.map((c) => c.perda ?? 0));
  return {
    key,
    fretes: items.length,
    comparaveis: comp.length,
    naoComparaveis: items.length - comp.length,
    freteAnterior,
    freteAtual: sum(comp.map((c) => c.freteAtual)),
    perda,
    perdaPct: freteAnterior === 0 ? 0 : perda / freteAnterior,
  };
}

export function perdaPorMes(f: Filter, ds: Dataset = dataset): PerdaResumo[] {
  const rows = selectComparativo({ mes: ALL_MONTHS, placa: f.placa }, ds);
  return COMPARATIVE_MONTHS.map((mes) => resumir(mes, rows.filter((c) => c.mes === mes)));
}

export function perdaTotal(f: Filter, ds: Dataset = dataset): PerdaResumo {
  return resumir('total', selectComparativo(f, ds));
}

export function perdaPorDestino(f: Filter, ds: Dataset = dataset): PerdaResumo[] {
  const groups = new Map<string, FreteComparado[]>();
  for (const c of selectComparativo(f, ds)) {
    const k = normalizeDestino(c.destino);
    groups.set(k, [...(groups.get(k) ?? []), c]);
  }
  return [...groups.entries()]
    .map(([k, items]) => resumir(k, items))
    .filter((r) => r.comparaveis > 0)
    .sort((a, b) => b.perda - a.perda);
}

export function perdaPorPlaca(f: Filter, ds: Dataset = dataset): PerdaResumo[] {
  return ds.meta.placas
    .map((p) => resumir(p, selectComparativo({ mes: f.mes, placa: p }, ds)))
    .filter((r) => r.comparaveis > 0)
    .sort((a, b) => b.perda - a.perda);
}

/** Fretes comparáveis ordenados por data, para o gráfico de diferença por CTE. */
export function diferencasPorCte(f: Filter, ds: Dataset = dataset): FreteComparado[] {
  return selectComparativo(f, ds)
    .filter((c) => c.perda !== null)
    .sort((a, b) => (a.data ?? '').localeCompare(b.data ?? '') || a.cte - b.cte);
}

// ---------- Diesel ----------

export function dieselMensal(f: Filter, ds: Dataset = dataset): DieselMes[] {
  if (f.placa === ALL_PLATES) return ds.dieselMes;
  return ds.meta.meses.map((mes) => {
    const p = ds.dieselPlaca.find((d) => d.mes === mes && d.placa === f.placa);
    return {
      mes,
      litros: p?.litros ?? 0,
      valor: p ? round2(p.litros * p.precoMedio) : 0,
      precoMedio: p?.precoMedio ?? 0,
      abastecimentos: 0,
    };
  });
}

export function kmRows(f: Filter, ds: Dataset = dataset): KmPlaca[] {
  return ds.km.filter((k) => matchMes(f, k.mes) && matchPlaca(f, k.placa));
}

// ---------- Custos ----------

export function siengeByGroup(f: Filter, ds: Dataset = dataset): Array<{ mes: string; grupos: Record<string, number> }> {
  return ds.meta.meses
    .filter((mes) => ds.sienge.some((s) => s.mes === mes))
    .map((mes) => {
      const grupos: Record<string, number> = {};
      for (const s of ds.sienge as SiengeLinha[]) {
        if (s.mes === mes && matchPlaca(f, s.placa)) grupos[s.grupo] = (grupos[s.grupo] ?? 0) + s.valor;
      }
      return { mes, grupos };
    });
}

export function manutencaoMensal(f: Filter, ds: Dataset = dataset): Array<{ mes: string; alp: number; g1: number | null }> {
  return ds.meta.meses.map((mes) => {
    const rows = selectPlacaMes({ mes, placa: f.placa }, ds);
    const g1Known = rows.every((r) => r.manutencaoG1 !== null);
    return {
      mes,
      alp: sum(rows.map((r) => r.manutencaoAlp)),
      g1: g1Known ? sum(rows.map((r) => r.manutencaoG1 ?? 0)) : null,
    };
  });
}

export interface ManutencaoItem {
  origem: 'ALP' | 'G1';
  conta: string;
  valor: number;
}

export function manutencaoItens(f: Filter, ds: Dataset = dataset): ManutencaoItem[] {
  const map = new Map<string, ManutencaoItem>();
  for (const l of ds.manutencao as ManutencaoLinha[]) {
    if (!matchMes(f, l.mes) || !matchPlaca(f, l.placa)) continue;
    const key = `${l.origem}|${l.conta}`;
    const cur = map.get(key);
    if (cur) cur.valor += l.valor;
    else map.set(key, { origem: l.origem, conta: l.conta, valor: l.valor });
  }
  return [...map.values()].sort((a, b) => a.origem.localeCompare(b.origem) || b.valor - a.valor);
}

// ---------- Árvore de contas do Sienge ----------

export interface ContaNode {
  codigo: string;
  nome: string;
  /** valor por mês (filtro de placa aplicado) */
  porMes: Record<string, number>;
  /** soma dos meses que passam no filtro de mês */
  noFiltro: number;
  /** contas-filhas (só nos grupos) */
  filhas?: ContaNode[];
}

function groupCodeOf(codigo: string): string {
  const parts = codigo.split('.');
  return parts.length >= 3 ? parts.slice(0, 3).join('.') : codigo;
}

/**
 * Despesas do Sienge em árvore: grupo (conta-pai) -> contas-filhas.
 * Só as filhas (tipo R) carregam valor; o subtotal do grupo é a soma das suas filhas,
 * então nada é contado duas vezes.
 */
export function siengeArvore(f: Filter, ds: Dataset = dataset): { grupos: ContaNode[]; total: ContaNode } {
  const meses = ds.meta.meses.filter((m) => ds.sienge.some((s) => s.mes === m));
  const leaves = new Map<string, ContaNode>();
  for (const s of ds.sienge) {
    if (!matchPlaca(f, s.placa)) continue;
    let leaf = leaves.get(s.codigo);
    if (!leaf) {
      leaf = { codigo: s.codigo, nome: s.conta, porMes: Object.fromEntries(meses.map((m) => [m, 0])), noFiltro: 0 };
      leaves.set(s.codigo, leaf);
    }
    leaf.porMes[s.mes] = (leaf.porMes[s.mes] ?? 0) + s.valor;
  }
  const finish = (n: ContaNode): ContaNode => {
    n.noFiltro = sum(meses.filter((m) => matchMes(f, m)).map((m) => n.porMes[m] ?? 0));
    return n;
  };
  const groups = new Map<string, ContaNode>();
  for (const leaf of [...leaves.values()].sort((a, b) => a.codigo.localeCompare(b.codigo))) {
    finish(leaf);
    const gc = groupCodeOf(leaf.codigo);
    let g = groups.get(gc);
    if (!g) {
      g = {
        codigo: gc,
        nome: ds.siengeGrupos[gc] ?? leaf.nome,
        porMes: Object.fromEntries(meses.map((m) => [m, 0])),
        noFiltro: 0,
        filhas: [],
      };
      groups.set(gc, g);
    }
    g.filhas!.push(leaf);
    for (const m of meses) g.porMes[m] = (g.porMes[m] ?? 0) + (leaf.porMes[m] ?? 0);
  }
  const grupos = [...groups.values()].sort((a, b) => a.codigo.localeCompare(b.codigo)).map(finish);
  const total: ContaNode = {
    codigo: '2',
    nome: 'Total das despesas do Sienge',
    porMes: Object.fromEntries(meses.map((m) => [m, sum(grupos.map((g) => g.porMes[m] ?? 0))])),
    noFiltro: 0,
  };
  finish(total);
  return { grupos, total };
}

/** Meses com custo do Sienge (relatório ou estimativa). */
export function mesesComSienge(ds: Dataset = dataset): string[] {
  return ds.meta.meses.filter((m) => ds.sienge.some((s) => s.mes === m));
}

/** Despesas do mês por categoria (para o gráfico da visão geral). */
export interface DespesaMes {
  mes: string;
  alp: number;
  combustivel: number;
  parcela: number;
  manutencaoAlp: number;
  sienge: number | null;
  extras: number;
}

export function despesasMensais(placa: string, ds: Dataset = dataset): DespesaMes[] {
  return ds.meta.meses.map((mes) => {
    const rows = selectPlacaMes({ mes, placa }, ds);
    const t = totalsOf(rows);
    const comSienge = rows.every((r) => r.sienge !== null);
    return {
      mes,
      alp: t.despesaAlp,
      combustivel: t.combustivel,
      parcela: t.parcela,
      manutencaoAlp: t.manutencaoAlp,
      sienge: comSienge ? sum(rows.map((r) => r.siengeTotal ?? 0)) : null,
      extras: sum(rows.map((r) => r.despesasExtrasRateio)),
    };
  });
}

/** Meses com parte estimada (jul e ago), na ordem cronológica. */
export function mesesEstimados(ds: Dataset = dataset): string[] {
  return Object.keys(ds.meta.estimativas ?? {}).sort();
}

/** Texto para rótulos de coluna/linha: marca meses estimados com asterisco. */
export function marcaEstimado(mes: string, ds: Dataset = dataset): string {
  return mesesEstimados(ds).includes(mes) ? '*' : '';
}

// ---------- Faturamento x despesas particionadas ----------

const ORDEM_GRUPOS_SIENGE = ['Mão de obra', 'Veículos, peças e pneus', 'Encargos INSS e FGTS', 'Materiais', 'Outros'];

export interface ParteDespesa {
  nome: string;
  /** 'alp' = descontado no acerto da ALP; 'g1' = pago pela G1 */
  lado: 'alp' | 'g1';
  valor: number;
}

export interface FaturamentoDespesasMes {
  mes: string;
  faturamento: number;
  /** quantidade de fretes do mês */
  fretes: number;
  partes: ParteDespesa[];
  totalDespesas: number;
  /** faturamento menos todas as despesas = Resultado G1 */
  saldo: number;
}

/** Nomes das partes de despesa na ordem do gráfico (ALP primeiro, depois G1). */
export function nomesPartesDespesa(ds: Dataset = dataset): string[] {
  const grupos = new Set<string>();
  for (const r of ds.placaMes) for (const g of Object.keys(r.sienge ?? {})) grupos.add(g);
  const ordenados = [
    ...ORDEM_GRUPOS_SIENGE.filter((g) => grupos.has(g)),
    ...[...grupos].filter((g) => !ORDEM_GRUPOS_SIENGE.includes(g)).sort(),
  ];
  return ['Contrato', 'Combustível', 'Parcela', 'Manutenção/IPVA/seguro', ...ordenados, 'Outras'];
}

export function faturamentoDespesasMensal(placa: string, ds: Dataset = dataset): FaturamentoDespesasMes[] {
  const nomes = nomesPartesDespesa(ds);
  return ds.meta.meses.map((mes) => {
    const rows = selectPlacaMes({ mes, placa }, ds);
    const t = totalsOf(rows);
    const valores: Record<string, number> = {
      Contrato: t.despesaAlp,
      Combustível: t.combustivel,
      Parcela: t.parcela,
      'Manutenção/IPVA/seguro': t.manutencaoAlp,
      Outras: sum(rows.map((r) => r.despesasExtrasRateio)),
    };
    for (const r of rows) for (const [g, v] of Object.entries(r.sienge ?? {})) valores[g] = (valores[g] ?? 0) + v;
    const partes = nomes.map((nome): ParteDespesa => ({
      nome,
      lado: ['Contrato', 'Combustível', 'Parcela', 'Manutenção/IPVA/seguro'].includes(nome) ? 'alp' : 'g1',
      valor: round2(valores[nome] ?? 0),
    }));
    const totalDespesas = sum(partes.map((p) => p.valor));
    return { mes, faturamento: t.faturamento, fretes: t.fretes, partes, totalDespesas, saldo: t.faturamento - totalDespesas };
  });
}

// ---------- Km rodado e gasto mensal ----------

export interface KmGastoMes {
  mes: string;
  /** gasto com combustível do mês (o mesmo que desconta do Livre G1) */
  gasto: number;
  /** null nos meses sem fonte de km */
  km: number | null;
  reaisPorKm: number | null;
}

export function kmGastoMensal(placa: string, ds: Dataset = dataset): KmGastoMes[] {
  return ds.meta.meses.map((mes) => {
    const gasto = sum(selectPlacaMes({ mes, placa }, ds).map((r) => r.combustivel));
    const kms = ds.km.filter((k) => k.mes === mes && (placa === ALL_PLATES || k.placa === placa));
    const km = kms.length > 0 ? sum(kms.map((k) => k.km)) : null;
    return { mes, gasto, km, reaisPorKm: km !== null && km > 0 ? gasto / km : null };
  });
}

// ---------- Despesas operacionais ----------

export type OrigemDespesa = 'ALP' | 'G1' | 'Extras';

export interface DespesaOperacional {
  origem: OrigemDespesa;
  conta: string;
  valor: number;
}

const ORDEM_ORIGEM: OrigemDespesa[] = ['ALP', 'G1', 'Extras'];

/**
 * Despesas operacionais por conta: manutenção, IPVA e seguro do acerto ALP, contas-filhas do Sienge
 * (G1) e despesas extras Adm. Com uma placa no filtro, as extras entram pelo rateio igual entre as placas.
 */
export function despesasOperacionais(f: Filter, ds: Dataset = dataset): DespesaOperacional[] {
  const map = new Map<string, DespesaOperacional>();
  const add = (origem: OrigemDespesa, conta: string, valor: number): void => {
    const key = `${origem}|${conta}`;
    const cur = map.get(key);
    if (cur) cur.valor += valor;
    else map.set(key, { origem, conta, valor });
  };
  for (const l of ds.manutencao as ManutencaoLinha[]) {
    if (l.origem === 'ALP' && matchMes(f, l.mes) && matchPlaca(f, l.placa)) add('ALP', l.conta, l.valor);
  }
  for (const s of ds.sienge as SiengeLinha[]) {
    if (matchMes(f, s.mes) && matchPlaca(f, s.placa)) add('G1', s.conta, s.valor);
  }
  const fator = f.placa === ALL_PLATES ? 1 : 1 / ds.meta.placas.length;
  for (const e of ds.extras) {
    if (matchMes(f, e.mes)) add('Extras', e.plano.replace(/\s+/g, ' '), e.valor * fator);
  }
  return [...map.values()]
    .filter((d) => Math.abs(d.valor) >= 0.005)
    .sort((a, b) => ORDEM_ORIGEM.indexOf(a.origem) - ORDEM_ORIGEM.indexOf(b.origem) || b.valor - a.valor);
}

// ---------- Retorno carregado ----------

export interface RetornoResumo {
  /** fretes do período da tabela de retorno (a partir do primeiro frete dela) */
  fretes: number;
  comRetorno: number;
  semRetorno: number;
  /** comRetorno / fretes (0..1) */
  pct: number;
  /** kg trazidos de volta */
  kgRetorno: number;
  inicio: string;
}

export function retornoResumo(f: Filter, ds: Dataset = dataset): RetornoResumo {
  const r = ds.retornoCarregado;
  const itens = r.itens.filter((i) => matchMes(f, i.mes) && matchPlaca(f, i.placa));
  const fretes = sum(r.geral.filter((g) => matchMes(f, g.mes) && matchPlaca(f, g.placa)).map((g) => g.fretes));
  return {
    fretes,
    comRetorno: itens.length,
    semRetorno: Math.max(0, fretes - itens.length),
    pct: fretes === 0 ? 0 : itens.length / fretes,
    kgRetorno: sum(itens.map((i) => i.kgRetorno)),
    inicio: r.inicio,
  };
}
