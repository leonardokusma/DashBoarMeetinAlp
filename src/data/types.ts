/**
 * Tipos do dataset real (src/data/real/dataset.json, gerado por tools/build_dataset.py).
 * Valores monetários em R$ (number). Meses no formato 'YYYY-MM'.
 */

export interface PlacaMes {
  mes: string;
  placa: string;
  fretes: number;
  /** Fretes lançados sem CT-e (só outubro). */
  semCte?: number;
  /** Peso transportado; só existe para outubro. */
  pesoKg: number | null;
  faturamento: number;
  despesaAlp: number;
  pctAlp: number;
  combustivel: number;
  parcela: number;
  manutencaoIpvaSeguro: number;
  livreG1: number;
  despesasExtrasRateio: number;
  /** Grupos de custo do Sienge (só tipo R). Jul e parte de Ago são estimados. */
  sienge: Record<string, number> | null;
  siengeTotal?: number;
  /** Parte do custo Sienge que é estimativa (jul/ago); 0 ou ausente nos meses reais. */
  siengeEstimado?: number;
  resultadoG1: number | null;
  /** Manutenção do acerto ALP (selo ALP). */
  manutencaoAlp: number;
  /** Manutenção lançada no Sienge (selo G1). */
  manutencaoG1: number | null;
  manutencaoTotal: number | null;
  alertas: string[];
}

export interface ExtraDespesa {
  mes: string;
  plano: string;
  descricao: string;
  valor: number;
}

export interface SiengeLinha {
  mes: string;
  placa: string;
  grupo: string;
  codigo: string;
  conta: string;
  valor: number;
  /** Parte do valor que é estimativa. */
  estimado?: number;
}

export type OrigemManutencao = 'ALP' | 'G1';

export interface ManutencaoLinha {
  mes: string;
  placa: string;
  origem: OrigemManutencao;
  conta: string;
  valor: number;
}

export interface FreteComparado {
  mes: string;
  data: string | null;
  cte: number;
  placa: string;
  destino: string;
  kg: number | null;
  freteAtual: number;
  cteAnterior: number | null;
  freteAnterior: number | null;
  perda: number | null;
  observacao: string | null;
}

export interface DieselMes {
  mes: string;
  litros: number;
  valor: number;
  precoMedio: number;
  abastecimentos: number;
}

export interface DieselPlaca {
  mes: string;
  placa: string;
  litros: number;
  precoMedio: number;
}

export interface DieselExcluido {
  mes: string;
  data: string;
  placa: string;
  litros: number;
  precoUnit: number | null;
  valor: number | null;
}

export interface KmPlaca {
  mes: string;
  placa: string;
  litros: number;
  km: number;
  kmPorLitro: number;
  /** km estimado (placa sem leitura de hodômetro no mês) */
  estimado?: boolean;
}

export interface RetornoCarregadoItem {
  mes: string;
  data: string;
  cte: number;
  placa: string;
  cliente: string | null;
  /** kg da carga de ida */
  kgCarga: number;
  /** kg da carga de retorno */
  kgRetorno: number;
  litros: number | null;
  valorCombustivel: number | null;
}

export interface RetornoCarregado {
  /** data do primeiro frete da tabela de retorno; o "geral" conta os fretes a partir dela */
  inicio: string;
  itens: RetornoCarregadoItem[];
  geral: Array<{ mes: string; placa: string; fretes: number }>;
}

export interface Conferencia {
  descricao: string;
  ok: boolean;
}

export interface Dataset {
  meta: {
    cliente: string;
    transportadora: string;
    periodo: string;
    meses: string[];
    placas: string[];
    gerado: string;
    /** Meses com parte estimada e o motivo (chave 'YYYY-MM'). */
    estimativas?: Record<string, string>;
    /** Regras e premissas usadas na base. */
    premissas?: string[];
  };
  placaMes: PlacaMes[];
  extras: ExtraDespesa[];
  sienge: SiengeLinha[];
  /** Nomes das contas-pai do Sienge (só rótulo; nunca somadas). */
  siengeGrupos: Record<string, string>;
  manutencao: ManutencaoLinha[];
  comparativo: FreteComparado[];
  dieselMes: DieselMes[];
  dieselPlaca: DieselPlaca[];
  dieselExcluidos: DieselExcluido[];
  km: KmPlaca[];
  retornoCarregado: RetornoCarregado;
  conferencias: Conferencia[];
}

export interface Filter {
  /** 'todos' ou 'YYYY-MM' */
  mes: string;
  /** 'todas' ou placa */
  placa: string;
}
