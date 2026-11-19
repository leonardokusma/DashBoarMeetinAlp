"""Importa as fichas de acerto da ALP (PDF) de um mês para a Base de Dados (Dados/Base de Dados/*.csv).

Rodar:  python tools/importar_fichas.py 2026-10        (lê Dados/Fichas 10/*.pdf; precisa de pymupdf)
Depois: python tools/build_dataset.py  e  npm test

Substitui as linhas do mês em fretes.csv, descontos_alp.csv, resumo_mes_placa.csv, resumo_mensal.csv e
conferencia.csv. Mantém o que não vem das fichas: despesas G1 (Sienge), extras Adm e, nos fretes, peso,
motorista e carreta da base anterior (casados pelo CT-e).

Regras:
- Leitura por posição das palavras no PDF; cada seção é conferida com o subtotal da ficha e o líquido a
  receber com o resumo financeiro. Se algo não bater, o script para sem gravar.
- Despesa ALP = contrato da ficha, mas sempre a 25% (28% na SEI2B55): se a ficha cobrar outro %, o valor
  é recalculado e a conferência fica como RECALCULADO.
- Livre G1 = faturamento - ALP - débitos + créditos. Resultado G1 = Livre G1 - despesas G1 - extras rateadas.
"""
import collections
import csv
import pathlib
import re
import sys

import pymupdf

ROOT = pathlib.Path(__file__).resolve().parent.parent
DADOS = ROOT / "Dados"
BD = DADOS / "Base de Dados"
PCT_CONTRATO = {"SEI2B55": 0.28}
PCT_PADRAO = 0.25
MESES_PT = {1: "jan", 2: "fev", 3: "mar", 4: "abr", 5: "mai", 6: "jun", 7: "jul", 8: "ago", 9: "set", 10: "out", 11: "nov", 12: "dez"}
# Exceções de CT-e: CT-e da ficha -> CT-e com que a base anterior tinha o frete (para herdar peso/motorista/carreta)
CTE_BASE_ANTERIOR = {"2026-10": {"8962": "9862"}}

DATE = re.compile(r"^\d{2}/\d{2}/\d{4}$")
MONEY = re.compile(r"^-?[\d.]+,\d{2}$")


# ---------------------------------------------------------------- leitura do PDF
def _num(s):
    return float(s.replace(".", "").replace(",", "."))


def _iso(d):
    dd, mm, yy = d.split("/")
    return f"{yy}-{mm}-{dd}"


def _linhas(page):
    """Agrupa as palavras em linhas: partes de uma mesma linha da tabela saem até ~2pt desalinhadas."""
    ws = sorted(((y0 + y1) / 2, x0, w) for x0, y0, x1, y1, w, *_ in page.get_text("words"))
    rows, cur, y_ini = [], [], None
    for y, x, w in ws:
        if cur and y - y_ini > 5:
            rows.append(sorted(cur))
            cur = []
        if not cur:
            y_ini = y
        cur.append((x, w))
    if cur:
        rows.append(sorted(cur))
    return rows


def _txt(cells, lo, hi):
    return " ".join(w for x, w in cells if lo <= x < hi).strip()


def _valores(cells, lo, hi=10_000):
    return [_num(w) for x, w in cells if MONEY.match(w) and lo <= x < hi]


def ler_ficha(path):
    f = {"arquivo": path.name, "fretes": [], "s2": [], "s3": [], "s4": [], "s5": [], "subtotais": {}, "resumo": {}}
    sec = ""
    for page in pymupdf.open(path):
        for cells in _linhas(page):
            palavras = [w for _, w in cells]
            line = " ".join(palavras)
            if "Placa:" in palavras:
                f["placa"] = palavras[palavras.index("Placa:") + 1]
            m = re.match(r"(\d)\s*-\s*(Receitas Operacionais|Outras Receitas|Despesas Operacionais|RESUMO FINANCEIRO)", line) or re.match(r"(5)-\s*Outras Despesas", line)
            if m:
                sec = m.group(1)
                continue
            if "Subtotais" in line and sec in ("1", "2", "3", "4", "5"):
                v = _valores(cells, 600)
                if v:
                    f["subtotais"][sec] = v[-1]
                continue
            if sec == "6":
                v = _valores(cells, 0)
                rot = " ".join(w for x, w in cells if not MONEY.match(w) and x < 740)
                if v and rot:
                    f["resumo"][rot] = v[-1]
                continue
            datas = [w for x, w in cells if DATE.match(w) and x < 70]
            if not datas or sec not in ("1", "2", "3", "4", "5"):
                if sec in ("1", "2", "3", "4", "5") and _valores(cells, 690):
                    raise ValueError(f"{path.name}: linha com valor sem data na seção {sec}: {line}")
                continue
            data = _iso(datas[0])
            if sec == "1":
                origem = _txt(cells, 530, 645).split(" - ")
                destino = _txt(cells, 645, 760).split(" - ")
                f["fretes"].append({
                    "data": data, "cte": _txt(cells, 200, 265).replace(".", ""), "nf": _txt(cells, 265, 310),
                    "cliente": _txt(cells, 365, 530),
                    "origem_uf": origem[1] if len(origem) > 2 else "", "origem_cidade": origem[-1],
                    "destino_uf": destino[1] if len(destino) > 2 else "", "destino_cidade": destino[-1],
                    "valor": _valores(cells, 760)[-1]})
            elif sec == "2":
                f["s2"].append({"data": data, "tipo_doc": _txt(cells, 100, 200), "num_doc": _txt(cells, 200, 360),
                                "descricao": _txt(cells, 360, 620), "observacao": _txt(cells, 620, 740), "valor": _valores(cells, 740)[-1]})
            elif sec in ("3", "4"):
                corte = 300 if sec == "3" else 320
                desc, forn = _txt(cells, 355, 690), ""
                if "Fornecedor:" in desc:
                    desc, forn = desc.split("Fornecedor:", 1)
                    desc = desc.strip().rstrip("-").strip()
                q = _valores(cells, 690, 745)
                f["s" + sec].append({"data": data, "tipo_doc": _txt(cells, 100, corte), "num_doc": _txt(cells, corte, 355),
                                     "descricao": desc, "fornecedor": forn.strip(), "quantidade": q[0] if q else None,
                                     "valor": _valores(cells, 745)[-1]})
            elif sec == "5":
                f["s5"].append({"data": data, "tipo_doc": _txt(cells, 100, 190), "num_doc": _txt(cells, 190, 250).replace(".", ""),
                                "descricao": _txt(cells, 250, 495), "observacao": _txt(cells, 495, 750), "valor": _valores(cells, 750)[-1]})
    # conferência interna da ficha
    soma = {"1": f["fretes"], "2": f["s2"], "3": f["s3"], "4": f["s4"], "5": f["s5"]}
    for k, itens in soma.items():
        s = sum(i["valor"] for i in itens)
        if abs(s - f["subtotais"].get(k, 0.0)) > 0.005:
            raise ValueError(f"{path.name}: seção {k} soma {s:.2f}, subtotal da ficha {f['subtotais'].get(k)}")
    r = f["resumo"]
    deb = sum(f["subtotais"].get(k, 0.0) for k in "345")
    cred = f["subtotais"].get("2", 0.0)
    if abs(r["(-) Débito"] - deb) > 0.005 or abs(r["Total Frete"] - r["Contrato"] - deb + cred - r["Líquido a Receber"]) > 0.005:
        raise ValueError(f"{path.name}: resumo financeiro não fecha {r}")
    return f


# ---------------------------------------------------------------- classificação (mesmas categorias de jul-set)
def classificar(sec, descricao, observacao, tipo_doc):
    d, o = descricao.upper(), observacao.upper()
    mi = "Manutenção/IPVA/Seguro"
    if sec == "3":
        if "ARLA" in d:
            return "Combustível", "Combustível", "Arla 32"
        if "DIESEL" in d:
            return "Combustível", "Combustível", "Diesel S-10"
        return "Combustível", "Combustível", descricao.title()
    if sec == "5" and d == "SEGURO" and tipo_doc == "Conhecimento":
        return mi, "Seguro", "Seguro por CT-e"
    t = o if sec == "5" else d
    if "PRESTA" in t:
        return "Parcela", "Parcela", "Parcela do veículo"
    if "SEGURO EM" in t:
        return mi, "Seguro", "Seguro da frota (parcelado)"
    if "IPVA" in t:
        return mi, "IPVA/Licenciamento", "IPVA + licenciamento"
    if "CAMERA" in t or "CÂMERA" in t:
        return mi, "Rastreamento/Câmeras", "Câmeras"
    if "RASTREA" in t:
        return mi, "Rastreamento/Câmeras", "Rastreamento"
    if "MULTA" in t:
        return mi, "Multas", "Multa"
    if "LAVAGEM" in t:
        return mi, "Manutenção", "Lavagem"
    if t:
        return mi, "Manutenção", "Manutenção/serviços"
    return mi, "Outros", "Outros"


# ---------------------------------------------------------------- CSV
def ler_csv(nome):
    with open(BD / nome, encoding="utf-8-sig", newline="") as fh:
        rd = csv.DictReader(fh, delimiter=";")
        return rd.fieldnames, list(rd)


def gravar_csv(nome, campos, linhas):
    with open(BD / nome, "w", encoding="utf-8-sig", newline="") as fh:
        wr = csv.DictWriter(fh, fieldnames=campos, delimiter=";", lineterminator="\r\n")
        wr.writeheader()
        for r in linhas:
            wr.writerow({k: ("" if r.get(k) is None else r.get(k)) for k in campos})


def substituir_mes(linhas, mes, novas, campo_id=None):
    """Tira as linhas do mês e põe as novas no lugar das antigas (ou no fim), renumerando o id."""
    pos = next((i for i, r in enumerate(linhas) if r["mes_ref"] == mes), None)
    resto = [r for r in linhas if r["mes_ref"] != mes]
    if pos is None:
        pos = len(resto)
    out = resto[:pos] + novas + resto[pos:]
    if campo_id:
        for i, r in enumerate(out, 1):
            r[campo_id] = i
    return out


def f2(x):
    return round(x + 0.0, 2)


def br(x):
    return f"{x:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")


def main(mes):
    ano, mm = mes.split("-")
    pasta = DADOS / f"Fichas {mm}"
    fonte = f"Fichas {MESES_PT[int(mm)]}/{ano}"
    fichas = sorted((ler_ficha(p) for p in pasta.glob("*.pdf")), key=lambda f: f["placa"])
    if len(fichas) != 8:
        raise SystemExit(f"Esperava 8 fichas em {pasta}, achei {len(fichas)}")

    cf, fretes = ler_csv("fretes.csv")
    cd, descontos = ler_csv("descontos_alp.csv")
    cr, resumo = ler_csv("resumo_mes_placa.csv")
    cm, mensal = ler_csv("resumo_mensal.csv")
    cc, conf = ler_csv("conferencia.csv")

    antigos = {(r["placa"], r["cte"]): r for r in fretes if r["mes_ref"] == mes}
    antigos_cte = {r["cte"]: r for r in antigos.values() if r["cte"]}
    destinos = sorted({r["destino_cidade"] for r in fretes if r["destino_cidade"]} | {r["origem_cidade"] for r in fretes if r["origem_cidade"]}, key=len)
    alias = CTE_BASE_ANTERIOR.get(mes, {})

    def cidade(c):  # a ficha corta nomes longos ("SAO LOURENCO DO OES")
        return next((d for d in destinos if d.startswith(c)), c)

    novos_fretes, novos_desc, novos_resumo, novas_conf = [], [], [], []
    resumo_ant = {r["placa"]: r for r in resumo if r["mes_ref"] == mes}
    relatorio = []
    usados = set()
    for f in fichas:
        placa = f["placa"]
        for x in f["fretes"]:
            ant = antigos_cte.get(x["cte"]) or antigos_cte.get(alias.get(x["cte"], "-"))
            obs = []
            if ant is not None:
                usados.add(ant["cte"])
                if ant["cte"] != x["cte"]:
                    obs.append(f"Base anterior: CT-e {ant['cte']}")
                if abs(float(ant["valor_frete"]) - x["valor"]) > 0.005:
                    obs.append(f"Base anterior: R$ {br(float(ant['valor_frete']))}")
                if ant["placa"] != placa:
                    obs.append(f"Base anterior: placa {ant['placa']}")
            novos_fretes.append({
                "mes_ref": mes, "fonte": fonte, "placa": placa, "tipo_receita": "Frete (CT-e)", "cte": x["cte"], "nf_cliente": x["nf"],
                "data": x["data"], "cliente": x["cliente"], "origem_cidade": cidade(x["origem_cidade"]), "origem_uf": x["origem_uf"],
                "destino_cidade": cidade(x["destino_cidade"]), "destino_uf": x["destino_uf"],
                "peso_kg": ant["peso_kg"] if ant else "", "motorista": ant["motorista"] if ant else "", "carreta": ant["carreta"] if ant else "",
                "valor_frete": x["valor"], "obs": ", ".join(obs), "arquivo_origem": f["arquivo"]})
            relatorio.append(("frete", placa, x["cte"], x["valor"], ", ".join(obs) if ant else "não estava na base anterior"))

        itens = []
        for x in f["s2"]:
            g, c, s = classificar("5", x["descricao"], x["observacao"], x["tipo_doc"])
            itens.append(dict(x, natureza="Crédito", grupo=g, categoria=c, subcategoria=("Crédito de parcela" if g == "Parcela" else s),
                              secao="2", valor=-x["valor"], fornecedor="", quantidade=None,
                              alerta="Crédito na seção 2 da ficha; valor negativo para abater o débito"))
        for sec in ("3", "4", "5"):
            for x in f["s" + sec]:
                g, c, s = classificar(sec, x["descricao"], x.get("observacao", ""), x["tipo_doc"])
                itens.append(dict(x, natureza="Débito", grupo=g, categoria=c, subcategoria=s, secao=sec,
                                  fornecedor=x.get("fornecedor", ""), quantidade=x.get("quantidade") if sec == "3" else None, alerta=""))
        itens.sort(key=lambda i: (i["data"], int(i["secao"])))
        for i in itens:
            novos_desc.append({
                "mes_ref": mes, "fonte": fonte, "placa": placa, "data": i["data"], "natureza": i["natureza"], "grupo": i["grupo"],
                "categoria": i["categoria"], "subcategoria": i["subcategoria"], "descricao": i["descricao"], "observacao": i.get("observacao", ""),
                "fornecedor": i["fornecedor"], "tipo_doc": i["tipo_doc"], "num_doc": i["num_doc"], "quantidade": i["quantidade"],
                "hodometro": "", "secao_ficha": i["secao"], "valor": i["valor"], "alerta": i["alerta"], "arquivo_origem": f["arquivo"]})

        r = f["resumo"]
        fat = r["Total Frete"]
        pct = PCT_CONTRATO.get(placa, PCT_PADRAO)
        alp = r["Contrato"]
        alp_ok = abs(alp - fat * pct) <= 0.05
        if not alp_ok:
            alp = f2(fat * pct)
        grupos = collections.defaultdict(float)
        for i in itens:
            grupos[i["grupo"]] += i["valor"]
        comb, parc, man = f2(grupos["Combustível"]), f2(grupos["Parcela"]), f2(grupos["Manutenção/IPVA/Seguro"])
        desc_tot = f2(comb + parc + man)
        livre = f2(fat - alp - desc_tot)
        ra = resumo_ant[placa]
        sienge = float(ra["despesas_g1_sienge"]) if ra["despesas_g1_sienge"] != "" else None
        rateio = float(ra["despesas_extras_adm_rateio"])
        novos_resumo.append({
            "mes_ref": mes, "placa": placa, "qtd_fretes": len(f["fretes"]), "qtd_lancamentos_sem_cte": 0,
            "peso_kg": f2(sum(float(n["peso_kg"]) for n in novos_fretes if n["placa"] == placa and n["peso_kg"] != "")) or "",
            "faturamento_bruto": f2(fat), "pct_alp": pct, "valor_alp": alp, "combustivel": comb, "parcela": parc,
            "manutencao_ipva_seguro": man, "total_descontos": desc_tot, "livre_g1": livre, "despesas_g1_sienge": ra["despesas_g1_sienge"],
            "despesas_extras_adm_rateio": ra["despesas_extras_adm_rateio"],
            "resultado_g1": f2(livre - sienge - rateio) if sienge is not None else "",
            "sienge_status": ra["sienge_status"], "descontos_completos": "Sim", "fonte": "Fichas"})
        pct_ficha = r["Contrato"] / fat if fat else 0
        for item, vf, vb, st, ob in (
            ("Total frete", fat, fat, "OK", ""),
            ("Contrato (% Alp)", r["Contrato"], alp, "OK" if alp_ok else "RECALCULADO",
             "" if alp_ok else f"Ficha cobra {pct_ficha:.0%} do frete; base usa {pct:.0%} do contrato"),
            ("Débito líquido de créditos", r["(-) Débito"] - r["(+) Crédito"], desc_tot, "OK", ""),
            ("Líquido a receber", r["Líquido a Receber"], livre, "OK" if alp_ok else "RECALCULADO", "" if alp_ok else "Reflete o contrato recalculado"),
            ("Faturamento base anterior (Excel)", float(ra["faturamento_bruto"]), fat, "OK" if abs(float(ra["faturamento_bruto"]) - fat) < 0.005 else "DIVERGE",
             "" if abs(float(ra["faturamento_bruto"]) - fat) < 0.005 else "Ficha manda; ver obs em fretes.csv"),
        ):
            novas_conf.append({"mes_ref": mes, "placa": placa, "item": item, "valor_ficha_ou_excel": f2(vf), "valor_base": f2(vb),
                               "diferenca": f2(vb - vf), "status": st, "observacao": ob})
        nota_alp = "" if alp_ok else f" (ficha {br(r['Contrato'])})"
        relatorio.append(("placa", placa, f"fat {br(fat)} | ALP {br(alp)}{nota_alp} | comb {br(comb)} | parc {br(parc)} | manut {br(man)} | livre {br(livre)}"))

    for (placa, cte), ant in antigos.items():
        if cte not in usados:
            relatorio.append(("fora", placa, cte or "(sem CT-e)", float(ant["valor_frete"]), "estava na base anterior e não está nas fichas"))

    # resumo mensal
    rm = next(r for r in mensal if r["mes_ref"] == mes)
    soma = lambda k: f2(sum(float(r[k]) for r in novos_resumo))
    rm.update({"faturamento_bruto": soma("faturamento_bruto"), "valor_alp": soma("valor_alp"), "combustivel": soma("combustivel"),
               "parcela": soma("parcela"), "manutencao_ipva_seguro": soma("manutencao_ipva_seguro"), "total_descontos_alp": soma("total_descontos"),
               "livre_g1": soma("livre_g1")})
    if rm["despesas_g1_sienge"] != "":
        rm["resultado_g1"] = f2(rm["livre_g1"] - float(rm["despesas_g1_sienge"]) - float(rm["despesas_extras_adm"]))

    gravar_csv("fretes.csv", cf, substituir_mes(fretes, mes, novos_fretes, "id_frete"))
    gravar_csv("descontos_alp.csv", cd, substituir_mes(descontos, mes, novos_desc, "id_desconto"))
    gravar_csv("resumo_mes_placa.csv", cr, substituir_mes(resumo, mes, novos_resumo))
    gravar_csv("resumo_mensal.csv", cm, mensal)
    gravar_csv("conferencia.csv", cc, substituir_mes(conf, mes, novas_conf))

    for linha in relatorio:
        if linha[0] == "placa" or linha[0] == "fora" or linha[-1]:
            print(" | ".join(str(c) for c in linha))
    print("Mês", mes, {k: rm[k] for k in ("faturamento_bruto", "valor_alp", "combustivel", "parcela", "manutencao_ipva_seguro", "livre_g1", "resultado_g1")})
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else "2026-10"))
