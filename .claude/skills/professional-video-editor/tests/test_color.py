"""Testes de regressão do módulo de cor (seção 47 do pedido).

Rodar:  python tests/test_color.py
Quadros: talking head real com fundo verde intenso (original já bem exposto).
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "scripts"))
import foco_color as fc  # noqa: E402

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8")
    except Exception:
        pass

FRAMES = [os.path.join(HERE, "frames", f"talking-head-green-{t}.png") for t in ("3", "300", "830")]

# O tratamento "cinematográfico" que gerou o caso real de OVER-GRADED (início do ensaio).
OVER_GRADED_SETTINGS = {"exposure": -0.12, "contrast": 0.30, "highlights": -0.25, "shadows": -0.20, "saturation": -0.70,
                        "vibrance": -0.20, "temperature": -0.12, "tint": 0.18, "vignette": 0.55}

failures = []


def check(cond, msg):
    print(("  ✓ " if cond else "  ✗ ") + msg)
    if not cond:
        failures.append(msg)


def auto(frames, profile):
    metrics = [fc.measure(f) for f in frames]
    d = fc.decide(metrics, profile)
    base = dict(d["adjustments"])
    for k in fc.load_presets()["intensity_steps"]:
        adj = fc.scale(base, k)
        vals = [fc.validate(f, fc.apply_grade(f, adj), d) for f in frames]
        if all(v.verdict != "OVER-GRADED" for v in vals):
            d["adjustments"], d["applied_factor"] = adj, k
            return d, vals
    raise AssertionError("nenhuma intensidade passou")


frames = [fc.load(p) for p in FRAMES]

print("1. Original já bom → Professional Natural muda pouco e não escurece")
d, vals = auto(frames, "professional-natural")
check(abs(d["adjustments"]["exposure"]) < 0.05, f"exposição preservada ({d['adjustments']['exposure']:+.2f})")
check(d["adjustments"]["shadows"] >= 0, "sombras nunca escurecidas")
check(d["adjustments"]["saturation"] <= 0, "verde não intensificado")
check(all(v.verdict in ("NATURAL", "NO-CHANGE") for v in vals), f"vereditos {[v.verdict for v in vals]}")
check(max(v.change_pct for v in vals) <= 8, f"mudança ≤ 8% ({max(v.change_pct for v in vals)}%)")

print("2. Tratamento escuro/contrastado real → OVER-GRADED")
vals = [fc.validate(f, fc.apply_grade(f, OVER_GRADED_SETTINGS)) for f in frames]
check(all(v.verdict == "OVER-GRADED" for v in vals), f"vereditos {[v.verdict for v in vals]}")
check(any("escuro" in x for v in vals for x in v.failures), "detecta 'mais escuro sem justificativa'")
check(any("pretos" in x for v in vals for x in v.failures), "detecta pretos sem detalhe")
check(any("pele" in x for v in vals for x in v.failures), "detecta pele alterada")

print("3. Rosto subexposto (−1 EV) → corrige exposição → GOOD")
under = [fc.apply_grade(f, {"exposure": -1.0}) for f in frames]
d, vals = auto(under, "professional-natural")
check(d["adjustments"]["exposure"] > 0.3, f"sobe exposição ({d['adjustments']['exposure']:+.2f} EV)")
check(all(v.verdict in ("GOOD", "NATURAL") for v in vals), f"vereditos {[v.verdict for v in vals]}")

print("4. Correção fraca demais do subexposto → UNDER-GRADED")
weak = fc.scale(d["adjustments"], 0.15)
vals = [fc.validate(u, fc.apply_grade(u, weak), d) for u in under]
check(all(v.verdict == "UNDER-GRADED" for v in vals), f"vereditos {[v.verdict for v in vals]}")

print("5. Cinematic: estiliza sem destruir (reduz sozinho se precisar)")
d, vals = auto(frames, "talking-head-cinematic")
check(all(v.verdict != "OVER-GRADED" for v in vals), f"vereditos {[v.verdict for v in vals]} (fator {d['applied_factor']})")
check(d["adjustments"]["shadows"] >= 0, "sombras não escurecidas")

print("6. Port do shader: parâmetros neutros = identidade")
diff = max(float(abs(fc.apply_grade(f, {}) - f).max()) for f in frames)
check(diff < 2e-3, f"diferença máxima {diff:.5f}")

print(f"\n{'FALHOU: ' + str(len(failures)) if failures else 'Tudo certo.'}")
sys.exit(1 if failures else 0)
