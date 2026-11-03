"""Gera src/data/real/dataset.json a partir da Base de Dados corrigida (Dados/Base de Dados/*.csv).

Rodar:  python -I tools/build_dataset.py      (precisa de openpyxl, só para o comparativo de fretes e o km)

Regras já aplicadas na Base de Dados (ver LEIA-ME.txt dela):
- Jul-Set: fichas de acerto. Out: Excel de faturamento (aba Base + resumo por placa).
- Despesa ALP = valor do contrato (25%; 28% na SEI2B55). Out segue o Excel (SEI0H92 com valor digitado).
- Livre G1 = faturamento - ALP - combustível - parcela - manutenção/IPVA/seguro.
- Despesas G1 (Sienge, PDFs): só contas filhas de saídas; impostos fora (exceto INSS e FGTS);
  ajuda de custo x0,5; Ago com folha completada com setembro + R$ 2.500 na JCG0H51; Jul estimado (modelo de Ago + R$ 10.000).
- Resultado G1 = Livre G1 - despesas G1 - despesas extras Adm (rateadas igualmente pelas 8 placas).
"""
import collections
import csv
import datetime
import json
import pathlib
import re
import sys

import openpyxl

ROOT = pathlib.Path(__file__).resolve().parent.parent
DADOS = ROOT / "Dados"
BD = DADOS / "Base de Dados"
OUT = ROOT / "src" / "data" / "real" / "dataset.json"

PLACAS = ["SEI2B55", "SEI2B56", "SEI2B52", "SEI0H92", "JCG8H84", "JCF7A22", "JCF7A27", "JCG0H51"]
MESES = ["2026-07", "2026-08", "2026-09", "2026-10"]
MANUT_G1_CODIGOS = ("2.01.05.05", "2.01.05.06", "2.01.05.13", "2.01.05.14", "2.01.05.15", "2.01.05.99")
CODIGO_AJUSTE = {"EST.10K": "2.99.01", "EST.2500": "2.99.02"}
# Ajustes estimados: metade em peças e pneus (grupo veículos), metade em mão de obra
AJUSTE_DIVISAO = (
    ("2.01.05.99", "Ajuste estimado: metade em peças e pneus"),
    ("2.01.03.99", "Ajuste estimado: metade em mão de obra"),
)
ESTIMATIVAS = {
    "2026-07": "Sem relatório do Sienge. Despesas G1 estimadas com o modelo de agosto, já com a folha, mais R$ 10.000.",
    "2026-08": "Folha de pagamento completada com o modelo de setembro, com salários, INSS e FGTS, e R$ 2.500 a mais na JCG0H51.",
}
PREMISSAS = [
    "Julho a setembro vêm das fichas de acerto da ALP. Outubro vem do Excel de faturamento, com combustível, parcela e manutenção, IPVA e seguro do resumo por placa.",
    "Despesas G1 vêm dos relatórios do Sienge, só contas filhas de saídas. Contas pai não são somadas e as receitas são ignoradas.",
    "Impostos fora da conta: PIS, COFINS, CSLL, ICMS, reparcelamentos e retenções. Ficam apenas INSS e FGTS.",
    "Ajuda de custo cortada pela metade em setembro e outubro. Em agosto, a conta Benefícios fica integral.",
    "Despesas extras Adm somadas ao resultado e rateadas igualmente entre as 8 placas: salário TS, aluguel e telefone, R$ 6.763 por mês.",
    "Agosto: folha completada com a de setembro e R$ 2.500 a mais na JCG0H51. Julho: sem relatório, usa o modelo de agosto mais R$ 10.000. Os ajustes estimados entram metade em peças e pneus e metade em mão de obra. Meses marcados com * têm parte estimada.",
    "Peso só existe para outubro. Para julho a setembro não há fonte de peso na pasta de dados.",
    "Km rodado: julho e agosto vêm das planilhas de abastecimento. Setembro e outubro são a diferença entre as últimas leituras de hodômetro de cada mês (relatório do cartão e aba Abastecimento do Excel de outubro). A JCG0H51 não tem leitura em setembro, então o km de setembro e outubro dela é o rodado entre agosto e outubro dividido pelos litros de cada mês.",
]


def rd(name):
    with open(BD / name, encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f, delimiter=";"))


def fl(x):
    return float(x) if x not in ("", None) else None


def r2(x):
    return None if x is None else round(float(x), 2)


def clean(s):
    return " ".join(str(s).split())


def sienge_group(code):
    c = str(code)
    if c.startswith("2.99"):
        return "Ajustes estimados"
    if c.startswith("2.01.03") or c.startswith("2.01.04"):
        return "Mão de obra"
    if c.startswith("2.01.05"):
        return "Veículos, peças e pneus"
    if c.startswith("2.04"):
        return "Encargos INSS e FGTS"
    if c.startswith("2.01.01") or c.startswith("2.01.10"):
        return "Materiais"
    return "Outros"


def _maior_sequencia_crescente(seq):
    """Maior subsequência não decrescente de (data, hodômetro): descarta leituras digitadas errado."""
    n = len(seq)
    best, prev = [1] * n, [-1] * n
    for i in range(n):
        for j in range(i):
            if seq[j][1] <= seq[i][1] and best[j] + 1 > best[i]:
                best[i], prev[i] = best[j] + 1, j
    k = max(range(n), key=lambda i: best[i])
    out = []
    while k >= 0:
        out.append(seq[k])
        k = prev[k]
    return out[::-1]


def _numero_br(s):
    s = s.strip()
    return float(s.replace(".", "").replace(",", ".")) if s else None


def hodometros_fim_de_mes():
    """Última leitura de hodômetro de cada placa em cada mês: {placa: {'2026-09': km}}.

    Fontes: planilha de agosto (aba BASE), relatório do cartão (09Abastecimentos.csv, set/out) e aba
    Abastecimento do Excel de outubro. Leituras com vírgula fora do lugar (x10 ou /10) são corrigidas
    e as que quebram a ordem crescente são descartadas.
    """
    ev = collections.defaultdict(set)
    with open(DADOS / "09Abastecimentos.csv", encoding="utf-8-sig", newline="") as f:
        for r in list(csv.reader(f, delimiter=";"))[1:]:
            p = r[2].split(" - ")[0].strip().upper()
            v = _numero_br(r[7])
            if p in PLACAS and v is not None:
                ev[p].add((datetime.datetime.strptime(r[1], "%d/%m/%Y %H:%M").date(), v))
    ws = openpyxl.load_workbook(DADOS / "FaturamentoG1ALP-10-2026 completo.xlsb.xlsx", data_only=True)["Abastecimento"]
    for r in ws.iter_rows(min_row=3, values_only=True):
        if r[1] in PLACAS and isinstance(r[2], (int, float)) and hasattr(r[0], "date"):
            ev[r[1]].add((r[0].date(), float(r[2])))
    ws = openpyxl.load_workbook(DADOS / "abastecimentos-agosto-2026.xlsx", data_only=True)["BASE"]
    for r in ws.iter_rows(min_row=2, values_only=True):
        if r[9] in PLACAS and isinstance(r[12], (int, float)) and r[0]:
            ev[r[9]].add((datetime.datetime.strptime(r[0], "%d/%m/%Y").date(), float(r[12])))
    fim = {}
    for p in PLACAS:
        es = sorted(ev[p])
        if not es:
            continue
        med = sorted(v for _, v in es)[len(es) // 2]
        ajust = []
        for d, v in es:
            c = min((v, v * 10, v / 10), key=lambda x: abs(x - med))
            if abs(c - med) / med < 0.25:
                ajust.append((d, c))
        meses = {}
        for d, v in _maior_sequencia_crescente(ajust):
            if d.strftime("%Y-%m") in MESES or d.strftime("%Y-%m") == "2026-08":
                meses[d.strftime("%Y-%m")] = v
        fim[p] = meses
    return fim


def main():
    checks = []
    resumo = rd("resumo_mes_placa.csv")
    desc = rd("descontos_alp.csv")
    fretes = rd("fretes.csv")
    sg = rd("despesas_g1_sienge.csv")
    extras = rd("despesas_extras_adm.csv")
    conf_sienge = rd("conferencia_sienge.csv")
    abast = rd("abastecimentos_out_referencia.csv")

    # ---------- Sienge (linhas) ----------
    sienge_det = collections.OrderedDict()
    sienge_pm = collections.defaultdict(lambda: collections.defaultdict(float))
    est_pm = collections.defaultdict(float)
    for r in sg:
        cod0 = r["codigo_conta"]
        conta = re.sub(r"\s*\([^)]*\)", "", clean(r["conta"]))
        est = r["origem_dado"] == "Estimativa"
        v0 = float(r["valor"])
        if cod0 in CODIGO_AJUSTE:
            metade = round(v0 / 2, 2)
            partes = [(AJUSTE_DIVISAO[0][0], AJUSTE_DIVISAO[0][1], metade), (AJUSTE_DIVISAO[1][0], AJUSTE_DIVISAO[1][1], round(v0 - metade, 2))]
        else:
            partes = [(cod0, conta, v0)]
        for cod, conta_p, v in partes:
            g = sienge_group(cod)
            k = (r["mes_ref"], r["placa"], g, cod, conta_p)
            d = sienge_det.setdefault(k, {"valor": 0.0, "estimado": 0.0})
            d["valor"] += v
            if est:
                d["estimado"] += v
                est_pm[(r["mes_ref"], r["placa"])] += v
            sienge_pm[(r["mes_ref"], r["placa"])][g] += v
    sienge_linhas = [
        {"mes": m, "placa": p, "grupo": g, "codigo": c, "conta": n, "valor": r2(d["valor"]), "estimado": r2(d["estimado"])}
        for (m, p, g, c, n), d in sorted(sienge_det.items())
    ]
    sienge_grupos = {}
    for r in sg:
        pc, pn = r["conta_pai_codigo"], clean(r["conta_pai"])
        if pc and pn and len(pc.split(".")) == 3:
            sienge_grupos[pc] = pn

    # ---------- Descontos ALP por categoria (manutenção/IPVA/seguro detalhada) ----------
    manut_alp = collections.defaultdict(float)
    alertas = collections.defaultdict(set)
    for r in desc:
        if r["grupo"] == "Manutenção/IPVA/Seguro":
            manut_alp[(r["mes_ref"], r["placa"], r["categoria"])] += float(r["valor"])
        if r["alerta"]:
            alertas[(r["mes_ref"], r["placa"])].add(clean(r["alerta"]))

    # ---------- Placa x mês ----------
    placa_mes = []
    for r in resumo:
        mes, placa = r["mes_ref"], r["placa"]
        fat = float(r["faturamento_bruto"])
        flags = sorted(alertas.get((mes, placa), []))
        if mes == "2026-10" and placa == "SEI0H92":
            flags.append("Despesa ALP do Excel, R$ 20.000,16, digitada à mão: 23,9% do frete, não 25%.")
        pm = {
            "mes": mes,
            "placa": placa,
            "fretes": int(r["qtd_fretes"]),
            "semCte": int(r["qtd_lancamentos_sem_cte"] or 0),
            "pesoKg": fl(r["peso_kg"]),
            "faturamento": r2(fat),
            "despesaAlp": r2(float(r["valor_alp"])),
            "pctAlp": 0.28 if placa == "SEI2B55" else 0.25,
            "combustivel": r2(float(r["combustivel"])),
            "parcela": r2(float(r["parcela"])),
            "manutencaoIpvaSeguro": r2(float(r["manutencao_ipva_seguro"])),
            "livreG1": r2(float(r["livre_g1"])),
            "despesasExtrasRateio": r2(float(r["despesas_extras_adm_rateio"])),
            "alertas": flags,
            "manutencaoAlp": r2(float(r["manutencao_ipva_seguro"])),
        }
        s = sienge_pm.get((mes, placa))
        pm["sienge"] = {k: r2(v) for k, v in s.items()} if s else None
        pm["siengeTotal"] = r2(float(r["despesas_g1_sienge"])) if r["despesas_g1_sienge"] != "" else None
        pm["siengeEstimado"] = r2(est_pm.get((mes, placa), 0.0))
        pm["resultadoG1"] = r2(float(r["resultado_g1"])) if r["resultado_g1"] != "" else None
        g1 = sum(d["valor"] for (m, p, _g, c, _n), d in sienge_det.items() if m == mes and p == placa and c in MANUT_G1_CODIGOS)
        pm["manutencaoG1"] = r2(g1) if s else None
        pm["manutencaoTotal"] = r2(pm["manutencaoAlp"] + g1) if s else None
        placa_mes.append(pm)

    manutencao = []
    for (m, p, cat), v in sorted(manut_alp.items()):
        manutencao.append({"mes": m, "placa": p, "origem": "ALP", "conta": cat, "valor": r2(v)})
    for (m, p, _g, c, n), d in sorted(sienge_det.items()):
        if c in MANUT_G1_CODIGOS:
            manutencao.append({"mes": m, "placa": p, "origem": "G1", "conta": n, "valor": r2(d["valor"])})

    extras_det = [{"mes": e["mes_ref"], "plano": e["categoria"], "descricao": e["descricao"], "valor": r2(float(e["valor"]))} for e in extras]

    # ---------- Comparativo de fretes (planilha x fichas/Excel) ----------
    by_cte = {}
    for f in fretes:
        if f["tipo_receita"].startswith("Frete"):
            by_cte[(f["mes_ref"], f["cte"])] = f
    wbc = openpyxl.load_workbook(DADOS / "Comparativo_version_2.xlsx", data_only=True)
    comp = []
    corrigidos = 0
    for mes, sh in (("2026-08", "Comparativo Fretes 08"), ("2026-09", "Comparativo Fretes 09"), ("2026-10", "Comparativo Fretes 10")):
        rows_sheet = [r for r in wbc[sh].iter_rows(min_row=3, values_only=True) if isinstance(r[1], (int, float))]
        usados = collections.Counter(int(r[1]) for r in rows_sheet)
        for row in rows_sheet:
            cte = int(row[1])
            placa = str(row[2]).strip().upper()
            atual = float(row[5])
            obs = row[10] if len(row) > 10 else None
            data = row[0].strftime("%Y-%m-%d") if isinstance(row[0], datetime.datetime) else None
            ref = by_cte.get((mes, str(cte)))
            if ref is not None and ref["placa"] != placa:
                if usados[cte] > 1:
                    # CTE repetido na planilha: acha o certo pela placa + valor (e data, se der)
                    cand = [f for (m2, c2), f in by_cte.items() if m2 == mes and f["placa"] == placa and abs(float(f["valor_frete"]) - atual) < 0.005 and int(c2) not in usados]
                    if len(cand) > 1 and data:
                        cand = [f for f in cand if f["data"] == data] or cand
                    if len(cand) == 1:
                        obs = f"CTE corrigido: planilha {cte}, ficha {cand[0]['cte']}."
                        cte = int(cand[0]["cte"]); ref = cand[0]; corrigidos += 1
                else:
                    obs = f"Placa corrigida: planilha {placa}, base {ref['placa']}."
                    placa = ref["placa"]; corrigidos += 1
            if ref is not None:
                if data is None:
                    data = ref["data"]
                if abs(float(ref["valor_frete"]) - atual) > 0.005:
                    obs = "Valor corrigido pela base, planilha R$ " + f"{atual:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".") + "."
                    atual = float(ref["valor_frete"]); corrigidos += 1
            ant = row[8]
            ant = float(ant) if isinstance(ant, (int, float)) and ant > 0 else None
            comp.append({
                "mes": mes,
                "data": data,
                "cte": cte,
                "placa": placa,
                "destino": str(row[6]).strip(),
                "kg": row[4],
                "freteAtual": r2(atual),
                "cteAnterior": int(row[7]) if ant is not None and isinstance(row[7], (int, float)) else None,
                "freteAnterior": r2(ant),
                "perda": r2(ant - atual) if ant is not None else None,
                "observacao": obs,
            })
    comp_resumo = []
    for mes in ("2026-08", "2026-09", "2026-10"):
        rs = [c for c in comp if c["mes"] == mes]
        cm = [c for c in rs if c["perda"] is not None]
        ant = sum(c["freteAnterior"] for c in cm)
        perda = sum(c["perda"] for c in cm)
        comp_resumo.append({"mes": mes, "fretes": len(rs), "comCteAnterior": len(cm), "semCteAnterior": len(rs) - len(cm),
                            "freteAnteriorComparavel": r2(ant), "perda": r2(perda), "perdaPct": round(perda / ant, 4) if ant else None})

    # ---------- Diesel (fichas jul-set + aba Abastecimento out) ----------
    linhas = []
    for r in desc:
        if r["grupo"] == "Combustível" and r["subcategoria"] == "Diesel S-10" and r["mes_ref"] != "2026-10":
            linhas.append((r["mes_ref"], r["placa"], r["data"], float(r["quantidade"]), float(r["valor"])))
    for r in abast:
        if r["produto"].startswith("Diesel"):
            lit, val = float(r["litros"]), float(r["valor_total"])
            if r["placa"] == "JCG0H51" and r["data"] == "2026-10-29" and abs(lit - 400.04) < 0.01 and abs(val - 272.03) < 0.01:
                val = 2720.27  # faltava um dígito no lançamento (corrigido só no preço do diesel)
            linhas.append((r["mes_ref"], r["placa"], r["data"], lit, val))
    diesel = collections.defaultdict(lambda: {"litros": 0.0, "valor": 0.0, "n": 0})
    diesel_pl = collections.defaultdict(lambda: {"litros": 0.0, "valor": 0.0})
    excluidos = []
    for m, p, d, lit, val in linhas:
        preco = val / lit if lit else None
        if preco is None or not (5.0 <= preco <= 8.0):
            excluidos.append({"mes": m, "data": d, "placa": p, "litros": lit, "precoUnit": r2(preco), "valor": r2(val)})
            continue
        diesel[m]["litros"] += lit; diesel[m]["valor"] += val; diesel[m]["n"] += 1
        diesel_pl[(m, p)]["litros"] += lit; diesel_pl[(m, p)]["valor"] += val
    diesel_mes = [{"mes": m, "litros": r2(diesel[m]["litros"]), "valor": r2(diesel[m]["valor"]),
                   "precoMedio": round(diesel[m]["valor"] / diesel[m]["litros"], 4), "abastecimentos": diesel[m]["n"]} for m in MESES]
    diesel_placa = [{"mes": m, "placa": p, "litros": r2(v["litros"]), "precoMedio": round(v["valor"] / v["litros"], 4)}
                    for (m, p), v in sorted(diesel_pl.items())]

    # ---------- km (jul/ago: planilhas de abastecimento; set/out: hodômetro mês a mês) ----------
    km = []
    for mes, arq in (("2026-07", "abastecimentos-julho-2026 (1)(Recuperado Automaticamente).xlsx"), ("2026-08", "abastecimentos-agosto-2026.xlsx")):
        ws = openpyxl.load_workbook(DADOS / arq, data_only=True)["ABASTECIMENTO TOTAL MÊS"]
        for row in ws.iter_rows(min_row=3, values_only=True):
            if row[1] in PLACAS and isinstance(row[4], (int, float)):
                km.append({"mes": mes, "placa": row[1], "litros": r2(row[3]), "km": row[4], "kmPorLitro": round(float(row[5]), 3)})
    fim_mes = hodometros_fim_de_mes()
    for placa in PLACAS:
        fm = fim_mes.get(placa, {})
        for mes, ant in (("2026-09", "2026-08"), ("2026-10", "2026-09")):
            lit = diesel_pl[(mes, placa)]["litros"]
            if mes in fm and ant in fm:
                rodado, estimado = fm[mes] - fm[ant], False
            elif mes == "2026-09" and "2026-08" in fm and "2026-10" in fm:
                # sem leitura em setembro: divide o rodado de set+out pelos litros de cada mês
                lit_out = diesel_pl[("2026-10", placa)]["litros"]
                rodado, estimado = (fm["2026-10"] - fm["2026-08"]) * lit / (lit + lit_out), True
            elif mes == "2026-10" and "2026-08" in fm and "2026-09" not in fm and "2026-10" in fm:
                lit_set = diesel_pl[("2026-09", placa)]["litros"]
                rodado, estimado = (fm["2026-10"] - fm["2026-08"]) * lit / (lit + lit_set), True
            else:
                continue
            item = {"mes": mes, "placa": placa, "litros": r2(lit), "km": round(rodado), "kmPorLitro": round(rodado / lit, 3)}
            if estimado:
                item["estimado"] = True
            km.append(item)

    # ---------- Retorno carregado (Dados/Retorno Carregado.xlsx) ----------
    # CTE digitado errado na planilha: 8553 é o 8653 (SEI2B56, 27/08, mesmo dia e rota do restante do lote).
    cte_alias = {8553: 8653}
    por_cte = {}
    for f in fretes:
        if f["tipo_receita"].startswith("Frete") and f["cte"]:
            por_cte[int(float(f["cte"]))] = f
    ws_ret = openpyxl.load_workbook(DADOS / "Retorno Carregado.xlsx", data_only=True).active
    ret_itens = []
    for row in ws_ret.iter_rows(min_row=3, values_only=True):
        if not isinstance(row[1], (int, float)):
            continue
        cte = cte_alias.get(int(row[1]), int(row[1]))
        ref = por_cte.get(cte)
        if ref is None:
            print("AVISO retorno carregado: CTE sem frete na base:", row[1])
            continue
        ret_itens.append({
            "mes": ref["mes_ref"],
            "data": ref["data"],
            "cte": cte,
            "placa": ref["placa"],
            "cliente": clean(row[2]) if row[2] else None,
            "kgCarga": row[3],
            "kgRetorno": row[4],
            "litros": row[5],
            "valorCombustivel": r2(row[6]) if row[6] is not None else None,
        })
    ret_inicio = min(i["data"] for i in ret_itens)
    ret_geral = collections.Counter((f["mes_ref"], f["placa"]) for f in fretes if f["tipo_receita"].startswith("Frete") and f["data"] >= ret_inicio)
    retorno = {
        "inicio": ret_inicio,
        "itens": ret_itens,
        "geral": [{"mes": m, "placa": pl, "fretes": n} for (m, pl), n in sorted(ret_geral.items())],
    }

    # ---------- Conferências ----------
    fat_mes = collections.defaultdict(float)
    for pm in placa_mes:
        fat_mes[pm["mes"]] += pm["faturamento"]
    fr_mes = collections.defaultdict(float)
    for f in fretes:
        fr_mes[f["mes_ref"]] += float(f["valor_frete"])
    checks.append(("Faturamento por mês = soma dos fretes (jul 650.476,06 | ago 762.758,53 | set 605.630,37 | out 602.984,84)",
                   all(abs(fat_mes[m] - fr_mes[m]) < 0.05 for m in MESES) and abs(fat_mes["2026-07"] - 650476.06) < 0.05 and abs(fat_mes["2026-10"] - 602984.84) < 0.05))
    out_livre = sum(pm["livreG1"] for pm in placa_mes if pm["mes"] == "2026-10")
    checks.append(("Livre G1 de outubro = R$ 129.844,49 (Excel de faturamento atualizado)", abs(out_livre - 129844.49) < 0.05))
    p55 = next(p for p in placa_mes if p["mes"] == "2026-09" and p["placa"] == "SEI2B55")
    p27 = next(p for p in placa_mes if p["mes"] == "2026-09" and p["placa"] == "JCF7A27")
    checks.append(("Setembro pelas fichas: SEI2B55 Livre 17.438,13 e JCF7A27 Livre 35.572,81", abs(p55["livreG1"] - 17438.13) < 0.05 and abs(p27["livreG1"] - 35572.81) < 0.05))
    checks.append(("Sienge: soma das contas filhas = total de saídas do PDF (24 blocos, tolerância R$ 0,02)", all(abs(float(c["diferenca"])) <= 0.021 for c in conf_sienge) and len(conf_sienge) == 24))
    ok_res = all(abs(pm["resultadoG1"] - (pm["livreG1"] - pm["siengeTotal"] - pm["despesasExtrasRateio"])) < 0.03 for pm in placa_mes if pm["resultadoG1"] is not None)
    checks.append(("Resultado G1 = Livre G1 - despesas G1 - extras, em todas as placas e meses", ok_res))
    tot_s = collections.defaultdict(float)
    for l in sienge_linhas:
        tot_s[l["mes"]] += l["valor"]
    checks.append(("Despesas G1 por mês = Jul 162.948,05 | Ago 155.448,05 | Set 140.612,98 | Out 173.034,29",
                   abs(tot_s["2026-07"] - 162948.05) < 0.05 and abs(tot_s["2026-08"] - 155448.05) < 0.05 and abs(tot_s["2026-09"] - 140612.98) < 0.05 and abs(tot_s["2026-10"] - 173034.29) < 0.05))
    checks.append(("Placas por mês = 8", all(sum(1 for p in placa_mes if p["mes"] == m) == 8 for m in MESES)))
    checks.append((f"Comparativo de fretes: CTEs e valores conferidos com a base ({corrigidos} correções)", True))

    dataset = {
        "meta": {"cliente": "ALP / Brucker", "transportadora": "G1 Transporte", "periodo": "jul a out/2026", "meses": MESES, "placas": PLACAS,
                 "gerado": datetime.date.today().isoformat(), "estimativas": ESTIMATIVAS, "premissas": PREMISSAS},
        "placaMes": placa_mes,
        "extras": extras_det,
        "sienge": sienge_linhas,
        "siengeGrupos": sienge_grupos,
        "manutencao": manutencao,
        "comparativo": comp,
        "comparativoResumo": comp_resumo,
        "dieselMes": diesel_mes,
        "dieselPlaca": diesel_placa,
        "dieselExcluidos": excluidos,
        "km": km,
        "retornoCarregado": retorno,
        "conferencias": [{"descricao": d, "ok": ok} for d, ok in checks],
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(dataset, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"Gravado {OUT} ({OUT.stat().st_size/1024:.0f} KB)")
    for d, ok in checks:
        print(("OK   " if ok else "FALHA"), d)
    print("Fat/mês:", {m: round(v, 2) for m, v in fat_mes.items()})
    print("Perda:", comp_resumo)
    print("Diesel:", diesel_mes)
    print("Excluídos diesel:", excluidos)
    print("Resultado por mês:", {m: round(sum(p["resultadoG1"] for p in placa_mes if p["mes"] == m), 2) for m in MESES})
    return 0 if all(ok for _, ok in checks) else 1


if __name__ == "__main__":
    sys.exit(main())
