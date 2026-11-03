import { describe, expect, it } from 'vitest';
import {
  ALL_MONTHS,
  ALL_PLATES,
  dataset,
  dieselMensal,
  manutencaoMensal,
  normalizeDestino,
  perdaPorDestino,
  perdaPorMes,
  perdaTotal,
  plateRanking,
  resultTotals,
  siengeArvore,
  selectPlacaMes,
  despesasOperacionais,
  faturamentoDespesasMensal,
  kmGastoMensal,
  retornoResumo,
  totalsOf,
  waterfallSteps,
} from './model';

const all = { mes: ALL_MONTHS, placa: ALL_PLATES };
const near = (a: number, b: number, tol = 0.05): boolean => Math.abs(a - b) <= tol;

describe('receita (valores de referência do guia)', () => {
  it('faturamento por mês', () => {
    const f = (mes: string): number => totalsOf(selectPlacaMes({ mes, placa: ALL_PLATES })).faturamento;
    expect(near(f('2026-07'), 650476.06)).toBe(true);
    expect(near(f('2026-08'), 762758.53)).toBe(true);
    expect(near(f('2026-09'), 605630.37)).toBe(true);
    expect(near(f('2026-10'), 602984.84)).toBe(true);
  });

  it('8 placas em cada mês', () => {
    for (const mes of dataset.meta.meses) expect(selectPlacaMes({ mes, placa: ALL_PLATES })).toHaveLength(8);
  });
});

describe('Livre G1 e Resultado G1', () => {
  it('Livre G1 = faturamento - ALP - combustível - parcela - manutenção ALP', () => {
    for (const r of dataset.placaMes) {
      const esperado = r.faturamento - r.despesaAlp - r.combustivel - r.parcela - r.manutencaoIpvaSeguro;
      expect(near(r.livreG1, esperado, 0.02)).toBe(true);
    }
  });

  it('Outubro: Livre G1 = R$ 129.844,49 e combustível R$ 199.186,73 (aba resumo do Excel atualizado)', () => {
    const t = totalsOf(selectPlacaMes({ mes: '2026-10', placa: ALL_PLATES }));
    expect(near(t.livreG1, 129844.49)).toBe(true);
    expect(near(t.combustivel, 199186.73)).toBe(true);
  });

  it('Setembro: SEI2B55 pela ficha e JCF7A27 sem os R$10.000 digitados', () => {
    const a = dataset.placaMes.find((r) => r.mes === '2026-09' && r.placa === 'SEI2B55')!;
    expect(near(a.despesaAlp, 25688.1)).toBe(true);
    expect(near(a.livreG1, 17438.13)).toBe(true);
    const b = dataset.placaMes.find((r) => r.mes === '2026-09' && r.placa === 'JCF7A27')!;
    expect(near(b.livreG1, 35572.81)).toBe(true);
  });

  it('Resultado G1 existe nos quatro meses; jul e ago têm parte estimada', () => {
    const rt = resultTotals(selectPlacaMes(all))!;
    expect(rt.meses).toEqual(['2026-07', '2026-08', '2026-09', '2026-10']);
    expect(rt.mesesEstimados).toEqual(['2026-07', '2026-08']);
    expect(rt.estimado).toBeGreaterThan(0);
    const set = resultTotals(selectPlacaMes({ mes: '2026-09', placa: ALL_PLATES }))!;
    expect(set.estimado).toBe(0);
  });

  it('Resultado G1 por mês', () => {
    const r = (mes: string): number => resultTotals(selectPlacaMes({ mes, placa: ALL_PLATES }))!.resultadoG1;
    expect(near(r('2026-07'), 33771.44, 0.1)).toBe(true);
    expect(near(r('2026-08'), 100194.36, 0.1)).toBe(true);
    expect(near(r('2026-09'), 5922.53, 0.1)).toBe(true);
    expect(near(r('2026-10'), -49952.84, 0.1)).toBe(true);
  });

  it('Resultado G1 = Livre G1 - Sienge - extras (Set)', () => {
    const rt = resultTotals(selectPlacaMes({ mes: '2026-09', placa: ALL_PLATES }))!;
    expect(near(rt.sienge, 140612.98)).toBe(true);
    expect(near(rt.extras, 6763)).toBe(true);
    expect(near(rt.resultadoG1, rt.livreG1 - rt.sienge - rt.extras, 0.01)).toBe(true);
  });

  it('cascata fecha: frete - descontos = Livre G1 = ... = Resultado G1', () => {
    const { steps, withResult } = waterfallSteps(selectPlacaMes(all));
    expect(withResult).toBe(true);
    const livre = steps.find((s) => s.label === 'Livre G1')!;
    const antes = steps.slice(0, 5).reduce((a, s) => a + s.value, 0);
    expect(near(antes, livre.value, 0.01)).toBe(true);
    const fim = steps[steps.length - 1]!;
    const soma = livre.value + steps[6]!.value + steps[7]!.value;
    expect(near(soma, fim.value, 0.01)).toBe(true);
  });
});

describe('queda de frete', () => {
  it('perda por mês', () => {
    const [ago, set, out] = perdaPorMes(all);
    expect(near(ago!.perda, 5235.43)).toBe(true);
    expect(near(set!.perda, 47431.74)).toBe(true);
    expect(near(out!.perda, 34514.5)).toBe(true);
    expect(near(perdaTotal(all).perda, 87181.67)).toBe(true);
  });

  it('fretes sem CTE anterior ficam fora da perda (19 em Out, 13 em Set, 1 em Ago)', () => {
    const [ago, set, out] = perdaPorMes(all);
    expect([ago!.naoComparaveis, set!.naoComparaveis, out!.naoComparaveis]).toEqual([1, 13, 19]);
  });

  it('destinos com caixa diferente são unificados', () => {
    expect(normalizeDestino('LONDRINA')).toBe('Londrina');
    expect(normalizeDestino('São Lourenço')).toBe('São Lourenço');
    const destinos = perdaPorDestino(all).map((d) => d.key);
    expect(new Set(destinos).size).toBe(destinos.length);
    expect(destinos).not.toContain('LONDRINA');
  });

  it('CTE 8704 não aparece mais duplicado em Set', () => {
    const set = dataset.comparativo.filter((c) => c.mes === '2026-09' && c.cte === 8704);
    expect(set).toHaveLength(1);
  });
});

describe('diesel', () => {
  it('preço médio sobe de jul a out', () => {
    const p = dieselMensal(all).map((d) => d.precoMedio);
    expect(p[0]!).toBeCloseTo(6.2277, 3);
    expect(p[3]!).toBeGreaterThan(p[2]!);
    expect(p[2]!).toBeGreaterThan(p[1]!);
    expect(p[1]!).toBeGreaterThan(p[0]!);
  });
});

describe('manutenção ALP + G1', () => {
  it('soma por mês e Julho sem parte G1', () => {
    const m = manutencaoMensal(all);
    expect(m).toHaveLength(4);
    for (const x of m) {
      expect(x.g1).not.toBeNull();
      expect(x.alp).toBeGreaterThan(0);
    }
  });
});

describe('peso (só outubro)', () => {
  it('peso é null fora de outubro e soma em outubro', () => {
    expect(totalsOf(selectPlacaMes({ mes: '2026-09', placa: ALL_PLATES })).pesoKg).toBeNull();
    expect(totalsOf(selectPlacaMes(all)).pesoKg).toBeNull();
    expect(totalsOf(selectPlacaMes({ mes: '2026-10', placa: ALL_PLATES })).pesoKg).toBeGreaterThan(0);
  });
});

describe('ranking por caminhão', () => {
  it('ordenado por Livre G1 decrescente', () => {
    const r = plateRanking(all);
    expect(r).toHaveLength(8);
    for (let i = 1; i < r.length; i++) expect(r[i - 1]!.livreG1).toBeGreaterThanOrEqual(r[i]!.livreG1);
  });
});

describe('árvore do Sienge (só as filhas somam)', () => {
  it('subtotal do grupo = soma das filhas e total = conta-pai 2 do PDF', () => {
    const { grupos, total } = siengeArvore(all);
    for (const g of grupos) {
      for (const mes of Object.keys(g.porMes)) {
        const filhas = (g.filhas ?? []).reduce((a, c) => a + (c.porMes[mes] ?? 0), 0);
        expect(near(g.porMes[mes]!, filhas, 0.001)).toBe(true);
      }
    }
    expect(near(total.porMes['2026-07']!, 162948.05)).toBe(true);
    expect(near(total.porMes['2026-08']!, 155448.05)).toBe(true);
    expect(near(total.porMes['2026-09']!, 140612.98)).toBe(true);
    expect(near(total.porMes['2026-10']!, 173034.29)).toBe(true);
  });

  it('total da árvore = Sienge usado no Resultado G1', () => {
    const { total } = siengeArvore(all);
    const rt = resultTotals(selectPlacaMes(all))!;
    expect(near(total.noFiltro, rt.sienge, 0.01)).toBe(true);
  });

  it('filtro de placa reduz o total', () => {
    const one = siengeArvore({ mes: ALL_MONTHS, placa: 'SEI2B55' }).total.noFiltro;
    expect(one).toBeGreaterThan(0);
    expect(one).toBeLessThan(siengeArvore(all).total.noFiltro);
  });
});

describe('ajustes estimados divididos', () => {
  it('metade em peças e pneus, metade em mão de obra; grupo próprio não existe mais', () => {
    const aj = dataset.sienge.filter((s) => s.codigo === '2.01.05.99' || s.codigo === '2.01.03.99');
    const pecas = aj.filter((s) => s.codigo === '2.01.05.99').reduce((a, s) => a + s.valor, 0);
    const mao = aj.filter((s) => s.codigo === '2.01.03.99').reduce((a, s) => a + s.valor, 0);
    expect(near(pecas, 5000 + 1250)).toBe(true); // jul 10.000/2 + ago 2.500/2
    expect(near(mao, pecas)).toBe(true);
    expect(dataset.sienge.some((s) => s.grupo === 'Ajustes estimados')).toBe(false);
    expect(dataset.sienge.some((s) => s.codigo.startsWith('2.99'))).toBe(false);
  });

  it('ajuste de peças e pneus entra na manutenção G1', () => {
    const jcg = dataset.placaMes.find((r) => r.mes === '2026-08' && r.placa === 'JCG0H51')!;
    const ref = dataset.placaMes.find((r) => r.mes === '2026-08' && r.placa === 'SEI2B55')!;
    expect(jcg.manutencaoG1! - ref.manutencaoG1!).toBeGreaterThan(1000);
  });
});

describe('faturamento e despesas particionadas', () => {
  it('soma das partes = faturamento - Resultado G1, em cada mês', () => {
    for (const m of faturamentoDespesasMensal(ALL_PLATES)) {
      const rt = resultTotals(selectPlacaMes({ mes: m.mes, placa: ALL_PLATES }))!;
      expect(near(m.saldo, rt.resultadoG1, 0.1)).toBe(true);
      expect(near(m.partes.reduce((a, p) => a + p.valor, 0), m.totalDespesas, 0.001)).toBe(true);
    }
  });
});

describe('km rodado e gasto mensal', () => {
  it('gasto e km nos quatro meses', () => {
    const k = kmGastoMensal(ALL_PLATES);
    expect(k.map((x) => x.km !== null)).toEqual([true, true, true, true]);
    for (const x of k) expect(x.gasto).toBeGreaterThan(0);
    expect(k[0]!.reaisPorKm).toBeGreaterThan(0);
  });
});

describe('despesas operacionais', () => {
  it('total = manutenção ALP + Sienge + extras (todas as placas e meses)', () => {
    const itens = despesasOperacionais(all);
    const total = itens.reduce((a, d) => a + d.valor, 0);
    const rt = resultTotals(selectPlacaMes(all))!;
    const manut = totalsOf(selectPlacaMes(all)).manutencaoAlp;
    expect(near(total, manut + rt.sienge + rt.extras, 0.5)).toBe(true);
    expect(itens.some((d) => d.origem === 'Extras' && /Sal/.test(d.conta))).toBe(true);
  });

  it('com uma placa, extras entram pelo rateio', () => {
    const itens = despesasOperacionais({ mes: '2026-09', placa: 'SEI2B55' });
    const extras = itens.filter((d) => d.origem === 'Extras').reduce((a, d) => a + d.valor, 0);
    expect(near(extras, 6763 / 8, 0.01)).toBe(true);
  });
});

describe('retorno carregado', () => {
  it('26 fretes com retorno, todos ligados a uma placa, sobre os fretes do período', () => {
    const r = retornoResumo(all);
    expect(r.comRetorno).toBe(26);
    expect(r.fretes).toBeGreaterThan(r.comRetorno);
    expect(near(r.pct, r.comRetorno / r.fretes, 1e-9)).toBe(true);
    expect(r.kgRetorno).toBe(224437);
    const porPlaca = dataset.meta.placas.reduce((a, p) => a + retornoResumo({ mes: ALL_MONTHS, placa: p }).comRetorno, 0);
    expect(porPlaca).toBe(26);
  });

  it('filtra por mês: os meses somam o total', () => {
    const porMes = dataset.meta.meses.map((mes) => retornoResumo({ mes, placa: ALL_PLATES }));
    expect(porMes.reduce((a, r) => a + r.comRetorno, 0)).toBe(26);
    expect(porMes.reduce((a, r) => a + r.fretes, 0)).toBe(retornoResumo(all).fretes);
    expect(porMes[0]!.comRetorno).toBe(0);
  });
});
