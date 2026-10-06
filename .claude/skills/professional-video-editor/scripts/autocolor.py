"""CLI da skill professional-video-editor (módulo de cor).

ANALISAR -> DECIDIR -> EDITAR (simulado com o motor real) -> VALIDAR -> COMPARAR -> CORRIGIR

Comandos:
  auto      Laço completo sobre quadros do vídeo; grava decision.json, report.txt,
            validation.json e comparativos ORIGINAL|EDITADO.
            python autocolor.py auto --frames f1.png f2.png ... --profile professional-natural --out DIR
  validate  Compara um original e um editado já existentes (ex.: export x original).
            python autocolor.py validate --original o.png --edited e.png [--decision d.json] [--out DIR]
  simulate  Aplica parâmetros (JSON do ColorSettings) a um quadro com a matemática do editor.
            python autocolor.py simulate --frame f.png --settings '{"exposure":0.1}' --out x.png
  reduce    Reduz a intensidade de uma decisão (Reduce AI Intensity / Reset = --factor 0).
            python autocolor.py reduce --decision d.json --factor 0.5 --out d2.json
"""
from __future__ import annotations

import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import foco_color as fc  # noqa: E402

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8")
    except Exception:
        pass


def _write(path: str, text: str) -> None:
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    with open(path, "w", encoding="utf8") as f:
        f.write(text)


def cmd_auto(a) -> int:
    frames = [fc.load(p) for p in a.frames]
    skins = [fc.skin_mask(f) for f in frames]
    metrics = [fc.measure(f, s) for f, s in zip(frames, skins)]
    decision = fc.decide(metrics, a.profile)
    base = dict(decision["adjustments"])
    steps = fc.load_presets()["intensity_steps"]

    chosen = None
    tried = []
    for k in steps:
        adj = fc.scale(base, k)
        vals = [fc.validate(f, fc.apply_grade(f, adj), decision) for f in frames]
        bad = [v for v in vals if v.verdict == "OVER-GRADED"]
        tried.append({"factor": k, "verdicts": [v.verdict for v in vals], "failures": sorted({x for v in vals for x in v.failures})})
        if not bad:
            chosen = (k, adj, vals)
            break
    if chosen is None:  # nem 0% passou (não deveria): fica sem alteração
        chosen = (0.0, fc.scale(base, 0), [fc.validate(f, f, decision) for f in frames])

    k, adj, vals = chosen
    decision["adjustments"] = adj
    decision["applied_factor"] = k
    decision["intensity_effective"] = round(decision["intensity"] * k, 3)
    decision["attempts"] = tried
    decision["no_change"] = all(abs(x) < 0.02 for x in adj.values())
    if decision["no_change"]:
        decision["note"] = "No significant color correction required."
    worst = min(vals, key=lambda v: v.scores["naturalness"])

    os.makedirs(a.out, exist_ok=True)
    for path, f, v in zip(a.frames, frames, vals):
        name = os.path.splitext(os.path.basename(path))[0]
        fc.side_by_side(f, fc.apply_grade(f, adj), os.path.join(a.out, f"compare-{name}.png"),
                        ("ORIGINAL", f"EDITADO · {decision['profile']} · {v.verdict}"))
    _write(os.path.join(a.out, "decision.json"), fc.to_json(decision))
    _write(os.path.join(a.out, "validation.json"), json.dumps([fc.asdict(v) for v in vals], ensure_ascii=False, indent=2))
    rep = fc.report(decision, worst)
    if k < 1.0:
        rep += f"\n\nIntensidade reduzida automaticamente para {k * 100:.0f}% da decisão original:"
        rep += "".join(f"\n  {t['factor'] * 100:>3.0f}%: {', '.join(t['verdicts'])}" + (f" — {'; '.join(t['failures'])}" if t["failures"] else "") for t in tried)
    _write(os.path.join(a.out, "report.txt"), rep)
    print(rep)
    print(f"\nArquivos em {a.out}")
    return 0


def cmd_validate(a) -> int:
    o, e = fc.load(a.original), fc.load(a.edited)
    if o.shape != e.shape:
        from PIL import Image
        import numpy as np
        e = np.asarray(Image.fromarray((e * 255).astype("uint8")).resize((o.shape[1], o.shape[0])), dtype="float32") / 255
    decision = json.load(open(a.decision, encoding="utf8")) if a.decision else None
    v = fc.validate(o, e, decision)
    lines = ["BEFORE / AFTER VALIDATION", ""] + [f"{k.replace('_', ' ').title():<18} {s}/100" for k, s in v.scores.items()]
    lines += [f"Mudança medida     {v.change_pct:.0f}%", f"Verdict            {v.verdict}"]
    lines += [f"  FALHA: {x}" for x in v.failures] + [f"  aviso: {x}" for x in v.warnings]
    lines += ["", "Deltas: " + json.dumps(v.deltas, ensure_ascii=False)]
    text = "\n".join(lines)
    print(text)
    if a.out:
        os.makedirs(a.out, exist_ok=True)
        _write(os.path.join(a.out, "validation.txt"), text)
        fc.side_by_side(o, e, os.path.join(a.out, "compare.png"), ("ORIGINAL", f"EDITADO · {v.verdict}"))
    return 1 if v.verdict == "OVER-GRADED" else 0


def cmd_simulate(a) -> int:
    s = json.loads(a.settings) if a.settings.strip().startswith("{") else json.load(open(a.settings, encoding="utf8"))
    s = s.get("adjustments", s)
    fc.save(fc.apply_grade(fc.load(a.frame, max_w=10_000), s), a.out)
    print(a.out)
    return 0


def cmd_reduce(a) -> int:
    d = json.load(open(a.decision, encoding="utf8"))
    d["adjustments"] = fc.scale(d["adjustments"], a.factor)
    d["applied_factor"] = round(d.get("applied_factor", 1.0) * a.factor, 3)
    d["no_change"] = all(abs(x) < 0.02 for x in d["adjustments"].values())
    _write(a.out, fc.to_json(d))
    print(fc.report(d))
    return 0


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("auto"); s.add_argument("--frames", nargs="+", required=True); s.add_argument("--profile", default="professional-natural"); s.add_argument("--out", required=True)
    s = sub.add_parser("validate"); s.add_argument("--original", required=True); s.add_argument("--edited", required=True); s.add_argument("--decision"); s.add_argument("--out")
    s = sub.add_parser("simulate"); s.add_argument("--frame", required=True); s.add_argument("--settings", required=True); s.add_argument("--out", required=True)
    s = sub.add_parser("reduce"); s.add_argument("--decision", required=True); s.add_argument("--factor", type=float, required=True); s.add_argument("--out", required=True)
    a = p.parse_args()
    return {"auto": cmd_auto, "validate": cmd_validate, "simulate": cmd_simulate, "reduce": cmd_reduce}[a.cmd](a)


if __name__ == "__main__":
    sys.exit(main())
