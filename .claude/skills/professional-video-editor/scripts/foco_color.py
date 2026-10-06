"""Núcleo da skill professional-video-editor (módulo de cor).

- apply_grade(): port fiel do shader do FOCO Editor (src/engine/color/color.ts, FRAG),
  para simular uma decisão de cor sobre quadros reais ANTES de aplicá-la no editor.
- measure(): métricas técnicas de um quadro (exposição, pretos, altas luzes, balanço
  de branco, saturação, verdes, pele).
- decide(): decisão adaptativa (analisa -> corrige só o que tem problema -> look com
  intensidade controlada). Sem confiança, não altera.
- validate(): compara ORIGINAL x EDITADO, dá notas 0-100 e um veredito
  (NATURAL / GOOD / OVER-GRADED / UNDER-GRADED / NO-CHANGE).

Dependências: numpy, Pillow.
"""
from __future__ import annotations

import json
import math
import os
from dataclasses import dataclass, field, asdict

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
PRESETS_PATH = os.path.join(HERE, "..", "presets", "presets.json")

PARAMS = ["exposure", "contrast", "highlights", "shadows", "saturation", "vibrance", "temperature", "tint", "vignette"]
# Limites do motor do FOCO Editor (ColorSettings)
LIMITS = {"exposure": (-2, 2), "contrast": (-1, 1), "highlights": (-1, 1), "shadows": (-1, 1), "saturation": (-1, 1),
          "vibrance": (-1, 1), "temperature": (-1, 1), "tint": (-1, 1), "vignette": (0, 1)}
LUMA_W = np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)


# ---------------------------------------------------------------------------
# Imagem

def load(path: str, max_w: int = 960) -> np.ndarray:
    """Carrega como float32 RGB 0..1, reduzido para análise rápida."""
    im = Image.open(path).convert("RGB")
    if im.width > max_w:
        im = im.resize((max_w, round(im.height * max_w / im.width)), Image.LANCZOS)
    return np.asarray(im, dtype=np.float32) / 255.0


def save(img: np.ndarray, path: str) -> None:
    Image.fromarray((np.clip(img, 0, 1) * 255 + 0.5).astype(np.uint8)).save(path)


def _smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def apply_grade(img: np.ndarray, s: dict) -> np.ndarray:
    """Mesma matemática do shader FRAG do FOCO Editor."""
    g = {k: float(s.get(k, 0) or 0) for k in PARAMS}
    c = img.astype(np.float32)
    lin = np.power(c, 2.2) * (2.0 ** g["exposure"])
    lin = lin * np.array([1 + g["temperature"] * 0.12, 1 - g["tint"] * 0.08, 1 - g["temperature"] * 0.12], dtype=np.float32)
    c = np.power(np.maximum(lin, 0.0), 1 / 2.2)
    l = c @ LUMA_W
    sh = 1.0 - _smoothstep(0.0, 0.5, l)
    hi = _smoothstep(0.5, 1.0, l)
    c = c + (g["shadows"] * 0.22 * sh + g["highlights"] * 0.22 * hi)[..., None]
    c = (c - 0.5) * (1 + g["contrast"]) + 0.5
    l = c @ LUMA_W
    sat = c.max(-1) - c.min(-1)
    k = 1 + g["saturation"] + g["vibrance"] * (1 - np.clip(sat, 0, 1))
    c = l[..., None] + (c - l[..., None]) * k[..., None]
    if g["vignette"]:
        h, w = l.shape
        yy, xx = np.mgrid[0:h, 0:w]
        d = np.sqrt(((xx + 0.5) / w - 0.5) ** 2 + ((yy + 0.5) / h - 0.5) ** 2)
        c = c * (1 - g["vignette"] * _smoothstep(0.35, 0.85, d * 1.25))[..., None]
    return np.clip(c, 0, 1)


# ---------------------------------------------------------------------------
# Métricas

def _hsv(img):
    mx = img.max(-1)
    mn = img.min(-1)
    d = mx - mn
    s = np.where(mx > 1e-6, d / np.maximum(mx, 1e-6), 0)
    r, g, b = img[..., 0], img[..., 1], img[..., 2]
    h = np.zeros_like(mx)
    m = d > 1e-6
    rr = m & (mx == r)
    gg = m & (mx == g) & ~rr
    bb = m & ~rr & ~gg
    h[rr] = (60 * ((g[rr] - b[rr]) / d[rr])) % 360
    h[gg] = 60 * ((b[gg] - r[gg]) / d[gg]) + 120
    h[bb] = 60 * ((r[bb] - g[bb]) / d[bb]) + 240
    return h, s, mx


def skin_mask(img: np.ndarray) -> np.ndarray:
    """Pele por regra YCbCr, restrita à região central-alta (talking head).

    Não depende do look: a máscara deve ser calculada no ORIGINAL e reaproveitada
    no editado, para comparar a mesma região."""
    r, g, b = img[..., 0] * 255, img[..., 1] * 255, img[..., 2] * 255
    y = 0.299 * r + 0.587 * g + 0.114 * b
    cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b
    cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b
    m = (cb > 77) & (cb < 127) & (cr > 133) & (cr < 173) & (y > 50) & (y < 245)
    h, w = m.shape
    roi = np.zeros_like(m)
    roi[int(h * 0.05):int(h * 0.75), int(w * 0.25):int(w * 0.75)] = True
    return m & roi


def measure(img: np.ndarray, skin: np.ndarray | None = None) -> dict:
    l = img @ LUMA_W
    h, s, v = _hsv(img)
    if skin is None:
        skin = skin_mask(img)
    p = np.percentile(l, [1, 5, 50, 95, 99])
    dark = l < 0.15
    # textura nas sombras: desvio local (gradiente) onde é escuro
    gy, gx = np.gradient(l)
    grad = np.hypot(gx, gy)
    # pixels neutros (pouca saturação, tons médios) para balanço de branco
    neutral = (s < 0.18) & (l > 0.15) & (l < 0.85)
    nm = img[neutral].mean(0) if neutral.sum() > 0.01 * l.size else img.reshape(-1, 3).mean(0)
    mean = float(nm.mean()) or 1e-3
    green = (h > 75) & (h < 165) & (s > 0.35) & (v > 0.12)
    out = {
        "luma_mean": float(l.mean()),
        "luma_p01": float(p[0]), "luma_p05": float(p[1]), "luma_median": float(p[2]),
        "luma_p95": float(p[3]), "luma_p99": float(p[4]),
        "spread": float(p[3] - p[1]),
        "crushed_pct": float((l < 0.02).mean() * 100),          # pretos esmagados
        "shadow_pct": float(dark.mean() * 100),
        "shadow_detail": float(grad[dark].mean() * 1000) if dark.any() else 0.0,
        "clipped_pct": float((img.max(-1) > 0.985).mean() * 100),  # altas luzes estouradas
        "wb_cast_rb": float((nm[2] - nm[0]) / mean),            # >0 frio (azul), <0 quente
        "wb_cast_g": float((nm[1] - (nm[0] + nm[2]) / 2) / mean),  # >0 verde, <0 magenta
        "wb_confidence": float(min(1.0, neutral.mean() / 0.05)),
        "sat_mean": float(s.mean()),
        "green_pct": float(green.mean() * 100),
        # pureza média do verde (saturação HSV): independe do brilho, então corrigir a
        # exposição não conta como "verde mais intenso"
        "green_strength": float(s[green].mean()) if green.any() else 0.0,
        "skin_pct": float(skin.mean() * 100),
    }
    if skin.sum() > 200:
        sk = img[skin]
        hs, ss, vs = h[skin], s[skin], v[skin]
        out.update({
            "skin_luma": float((sk @ LUMA_W).mean()),
            "skin_hue": float(np.median(hs)),
            "skin_sat": float(ss.mean()),
            "skin_rgb": [float(x) for x in sk.mean(0)],
        })
    return out


# ---------------------------------------------------------------------------
# Decisão

def load_presets() -> dict:
    with open(PRESETS_PATH, encoding="utf8") as f:
        return json.load(f)


def get_profile(name: str) -> dict:
    """Resolve alias e tolerâncias compartilhadas ("base")."""
    data = load_presets()
    pr = data["presets"].get(name)
    if pr is None:
        raise KeyError(f"perfil desconhecido: {name}. Opções: {', '.join(data['presets'])}")
    if "alias" in pr:
        return get_profile(pr["alias"])
    pr = dict(pr)
    pr["name"] = name
    if pr.get("tolerances") == "base":
        pr["tolerances"] = data["base_tolerances"]
    return pr


def _clamp(k, v):
    a, b = LIMITS[k]
    return float(min(b, max(a, v)))


def decide(metrics_list: list[dict], profile: str = "professional-natural") -> dict:
    """Decisão adaptativa e temporal: usa a MEDIANA das métricas de vários quadros
    (um único tratamento para o vídeo inteiro, sem tremer entre quadros)."""
    pr = get_profile(profile)
    profile = pr["name"] if "alias" not in load_presets()["presets"][profile] else load_presets()["presets"][profile]["alias"]
    m = {k: float(np.median([x[k] for x in metrics_list if k in x])) for k in metrics_list[0] if not isinstance(metrics_list[0][k], list)}
    has_skin = "skin_luma" in m and m.get("skin_pct", 0) > 0.3
    tol = pr["tolerances"]
    adj = {k: 0.0 for k in PARAMS}
    reasons: list[str] = []
    issues: list[str] = []
    lin = lambda v: max(v, 1e-4) ** 2.2

    # 1) Correção técnica — só onde há problema medido
    if has_skin:
        lo, hi = tol["skin_luma"]
        # Mira um ponto confortável dentro da faixa (não a borda) e corrige 90%.
        if m["skin_luma"] < lo:
            target = lo + (hi - lo) * 0.3
            adj["exposure"] = math.log2(lin(target) / lin(m["skin_luma"])) * 0.9
            issues.append("rosto subexposto"); reasons.append(f"pele com luminância {m['skin_luma']:.2f} < {lo}")
        elif m["skin_luma"] > hi:
            target = hi - (hi - lo) * 0.3
            adj["exposure"] = math.log2(lin(target) / lin(m["skin_luma"])) * 0.9
            issues.append("rosto superexposto"); reasons.append(f"pele com luminância {m['skin_luma']:.2f} > {hi}")
    else:
        lo, hi = tol["median_luma"]
        if m["luma_median"] < lo or m["luma_median"] > hi:
            target = lo if m["luma_median"] < lo else hi
            adj["exposure"] = math.log2(lin(target) / lin(m["luma_median"])) * 0.5  # sem pele: menos confiança
            issues.append("exposição geral fora da faixa")
    if m["clipped_pct"] > tol["clipped_pct"]:
        adj["highlights"] = -min(0.35, 0.05 + (m["clipped_pct"] - tol["clipped_pct"]) * 0.05)
        issues.append("altas luzes estouradas"); reasons.append(f"{m['clipped_pct']:.1f}% de pixels estourados")
    if m["crushed_pct"] > tol["crushed_pct"]:
        adj["shadows"] = min(0.3, 0.05 + (m["crushed_pct"] - tol["crushed_pct"]) * 0.03)
        issues.append("pretos esmagados"); reasons.append(f"{m['crushed_pct']:.1f}% de pixels abaixo de 2%")
    if m["spread"] < tol["spread"][0]:
        adj["contrast"] = min(0.15, (tol["spread"][0] - m["spread"]) * 0.5)
        issues.append("imagem lavada (pouco contraste)")
    elif m["spread"] > tol["spread"][1]:
        adj["contrast"] = -0.05
        issues.append("contraste excessivo")
    # Balanço de branco: só com confiança E se a pele indicar dominante (senão é luz intencional)
    skin_ok = has_skin and tol["skin_hue"][0] <= m["skin_hue"] <= tol["skin_hue"][1]
    if m["wb_confidence"] > 0.5 and not skin_ok:
        if abs(m["wb_cast_rb"]) > tol["wb_cast"]:
            adj["temperature"] = -m["wb_cast_rb"] / 0.22 * 0.5
            issues.append("dominante quente/fria na pele")
        if abs(m["wb_cast_g"]) > tol["wb_cast"]:
            adj["tint"] = m["wb_cast_g"] / 0.036 * 0.5
            issues.append("dominante verde/magenta na pele")
    elif m["wb_confidence"] > 0.5 and (abs(m["wb_cast_rb"]) > tol["wb_cast"] or abs(m["wb_cast_g"]) > tol["wb_cast"]):
        reasons.append("dominante no fundo, mas pele natural: tratada como luz intencional (preservada)")
    # Saturação: nunca aumenta verdes; pele saturada demais -> reduz de leve.
    # Verde neon dominante: o motor só tem saturação global, então reduz pouco
    # (a pele não pode perder mais que ~8% de saturação).
    green_dominant = m["green_pct"] > tol["green_pct"] and m["green_strength"] > tol["green_strength"]
    if green_dominant:
        floor = -0.08 if not has_skin else -min(0.08, max(0.0, (m["skin_sat"] - tol["skin_sat_min"]) / max(m["skin_sat"], 1e-3)))
        adj["saturation"] = floor
        issues.append("verde do fundo muito intenso (sem HSL no motor: redução global mínima)")
        reasons.append(f"{m['green_pct']:.0f}% do quadro é verde saturado")
    elif has_skin and m["skin_sat"] > tol["skin_sat_max"]:
        adj["saturation"] = -min(0.12, (m["skin_sat"] - tol["skin_sat_max"]) * 0.6)
        issues.append("pele saturada demais")
    elif m["sat_mean"] < tol["sat_min"] and m["green_strength"] < 0.5:
        adj["vibrance"] = min(0.15, (tol["sat_min"] - m["sat_mean"]) * 0.8)
        issues.append("cores apagadas")

    technical = {k: _clamp(k, v * pr["technical_strength"]) for k, v in adj.items()}

    # 2) Look do perfil (intensidade controlada, padrão 15–35%)
    look = pr.get("look", {})
    intensity = float(pr["intensity"])
    final = {k: _clamp(k, technical[k] + look.get(k, 0) * intensity) for k in PARAMS}

    # 3) Proteções do perfil limitam o resultado
    for k, (a, b) in pr["caps"].items():
        final[k] = float(min(b, max(a, final[k])))
    final = {k: round(v, 3) for k, v in final.items()}

    no_change = all(abs(v) < 0.02 for v in final.values())
    return {
        "profile": profile,
        "confidence": round(0.9 if has_skin else 0.6, 2),
        "intensity": intensity,
        "issues": issues,
        "reasons": reasons,
        "adjustments": final,
        "unsupported": {k: None for k in ["whites", "blacks", "sharpen", "noise_reduction", "hsl_green", "lut"]},
        "lut": None,
        "lut_intensity": 0,
        "protections": pr["protections"],
        "no_change": no_change,
        "note": "No significant color correction required." if no_change else "",
        "metrics_median": {k: round(v, 4) for k, v in m.items()},
    }


def scale(adjustments: dict, k: float) -> dict:
    return {p: round(v * k, 3) for p, v in adjustments.items()}


# ---------------------------------------------------------------------------
# Validação ORIGINAL x EDITADO

@dataclass
class Validation:
    scores: dict = field(default_factory=dict)
    deltas: dict = field(default_factory=dict)
    failures: list = field(default_factory=list)
    warnings: list = field(default_factory=list)
    verdict: str = ""
    change_pct: float = 0.0


def _hue_diff(a, b):
    d = abs(a - b) % 360
    return min(d, 360 - d)


def validate(orig: np.ndarray, edit: np.ndarray, decision: dict | None = None, thresholds: dict | None = None) -> Validation:
    t = thresholds or load_presets()["validation"]
    skin = skin_mask(orig)
    mo, me = measure(orig, skin), measure(edit, skin)
    v = Validation()
    d = {
        "luma_mean_rel": (me["luma_mean"] - mo["luma_mean"]) / max(mo["luma_mean"], 1e-3),
        "crushed_pp": me["crushed_pct"] - mo["crushed_pct"],
        "shadow_detail_rel": (me["shadow_detail"] - mo["shadow_detail"]) / max(mo["shadow_detail"], 1e-3) if mo["shadow_detail"] else 0.0,
        "clipped_pp": me["clipped_pct"] - mo["clipped_pct"],
        "spread": me["spread"] - mo["spread"],
        "sat_rel": (me["sat_mean"] - mo["sat_mean"]) / max(mo["sat_mean"], 1e-3),
        "green_strength_rel": (me["green_strength"] - mo["green_strength"]) / max(mo["green_strength"], 1e-3) if mo["green_strength"] else 0.0,
    }
    if "skin_luma" in mo and "skin_luma" in me:
        d["skin_luma_rel"] = (me["skin_luma"] - mo["skin_luma"]) / max(mo["skin_luma"], 1e-3)
        d["skin_hue_deg"] = _hue_diff(me["skin_hue"], mo["skin_hue"])
        d["skin_sat_rel"] = (me["skin_sat"] - mo["skin_sat"]) / max(mo["skin_sat"], 1e-3)
    v.change_pct = round(float(np.abs(edit - orig).mean() * 100 / 0.25), 1)  # 25% de diferença média = 100%

    # A edição corrigiu algo que estava errado? (escurecer pode ser justificado)
    issues = (decision or {}).get("issues", [])
    justified_darker = any("superexposto" in i or "exposição" in i for i in issues)
    # Mudança de luz na pele que a leva PARA DENTRO da faixa correta é correção, não dano.
    if "skin_luma" in mo and "skin_luma" in me and decision is not None:
        lo, hi = get_profile(decision["profile"])["tolerances"]["skin_luma"]
        dist = lambda x: max(0.0, lo - x, x - hi)
        if dist(me["skin_luma"]) < dist(mo["skin_luma"]) and dist(me["skin_luma"]) <= 0.03:
            d["skin_luma_rel"] = 0.0
            if me["luma_mean"] > mo["luma_mean"]:
                d["luma_mean_rel"] = max(d["luma_mean_rel"], 0.0)

    v.deltas = {k: round(x, 4) for k, x in d.items()}

    def score(x, bad):  # 100 = sem desvio; cai linearmente até 0 em 'bad'
        return max(0, round(100 - 100 * min(1.0, x / bad)))

    v.scores = {
        "exposure": score(max(0.0, -d["luma_mean_rel"]) if not justified_darker else 0.0, t["darker_fail"] * 2),
        "skin_tone": min(score(abs(d.get("skin_luma_rel", 0)), t["skin_luma_fail"] * 2), score(d.get("skin_hue_deg", 0), t["skin_hue_fail"] * 2), score(abs(d.get("skin_sat_rel", 0)), t["skin_sat_fail"] * 2)),
        "shadow_detail": min(score(max(0.0, d["crushed_pp"]), t["crushed_fail_pp"] * 2), score(max(0.0, -d["shadow_detail_rel"]), t["shadow_detail_fail"] * 2)),
        "highlight_detail": score(max(0.0, d["clipped_pp"]), t["clipped_fail_pp"] * 2),
        "saturation": score(max(0.0, d["green_strength_rel"]) + max(0.0, abs(d["sat_rel"]) - 0.1), t["green_fail"] * 2),
        "contrast": score(max(0.0, d["spread"]), t["spread_fail"] * 2),
    }
    v.scores["naturalness"] = round(min(v.scores.values()) * 0.6 + float(np.mean(list(v.scores.values()))) * 0.4)

    # Regras de FALHA (seção 47)
    if d["luma_mean_rel"] < -t["darker_fail"] and not justified_darker:
        v.failures.append(f"ficou {abs(d['luma_mean_rel']) * 100:.0f}% mais escuro sem justificativa")
    if d["crushed_pp"] > t["crushed_fail_pp"] or d["shadow_detail_rel"] < -t["shadow_detail_fail"]:
        v.failures.append(f"pretos perderam detalhe (+{d['crushed_pp']:.1f} pp esmagados, textura {d['shadow_detail_rel'] * 100:+.0f}%)")
    if d["clipped_pp"] > t["clipped_fail_pp"]:
        v.failures.append(f"altas luzes estouraram (+{d['clipped_pp']:.1f} pp)")
    if abs(d.get("skin_luma_rel", 0)) > t["skin_luma_fail"] or d.get("skin_hue_deg", 0) > t["skin_hue_fail"] or abs(d.get("skin_sat_rel", 0)) > t["skin_sat_fail"]:
        v.failures.append(f"pele mudou demais (luz {d.get('skin_luma_rel', 0) * 100:+.0f}%, matiz {d.get('skin_hue_deg', 0):.0f}°, saturação {d.get('skin_sat_rel', 0) * 100:+.0f}%)")
    if d["green_strength_rel"] > t["green_fail"]:
        v.failures.append(f"verde ficou mais intenso (+{d['green_strength_rel'] * 100:.0f}%)")
    if not issues and v.change_pct > t["good_original_max_change"]:
        v.failures.append(f"original já estava bom e a mudança foi grande ({v.change_pct:.0f}%)")
    if v.scores["naturalness"] < t["naturalness_fail"]:
        v.failures.append(f"naturalidade baixa ({v.scores['naturalness']}/100)")
    if d["spread"] > t["spread_fail"]:
        v.warnings.append(f"contraste subiu bastante (+{d['spread']:.2f} de amplitude)")

    # Veredito
    if v.change_pct < 1.0:
        v.verdict = "NO-CHANGE"
    elif v.failures:
        v.verdict = "OVER-GRADED"
    elif issues and decision is not None and _still_has_issues(mo, me, decision):
        v.verdict = "UNDER-GRADED"
    elif v.change_pct <= t["natural_max_change"]:
        v.verdict = "NATURAL"
    else:
        v.verdict = "GOOD"
    return v


def _still_has_issues(mo: dict, me: dict, decision: dict) -> bool:
    """UNDER-GRADED: havia um problema medido e menos da metade dele foi resolvida."""
    tol = get_profile(decision["profile"])["tolerances"]
    lo, hi = tol["skin_luma"]
    dist = lambda x: max(0.0, lo - x, x - hi)
    if "skin_luma" in mo and "skin_luma" in me and dist(mo["skin_luma"]) > 0:
        if dist(me["skin_luma"]) > 0.5 * dist(mo["skin_luma"]):
            return True
    for k in ("clipped_pct", "crushed_pct"):
        excess_o = mo[k] - tol[k]
        if excess_o > 0 and (me[k] - tol[k]) > 0.5 * excess_o:
            return True
    return False


def report(decision: dict, val: Validation | None = None) -> str:
    a = decision["adjustments"]
    pct = lambda x: f"{x * 100:+.0f}%"
    lines = ["AI COLOR REPORT", ""]
    lines += [f"Profile            {decision['profile']}", f"Confidence         {decision['confidence']:.2f}"]
    lines += [f"Exposure           {a['exposure']:+.2f} EV", f"Contrast           {pct(a['contrast'])}", f"Highlights         {pct(a['highlights'])}",
              f"Shadows            {pct(a['shadows'])}", f"Saturation         {pct(a['saturation'])}", f"Vibrance           {pct(a['vibrance'])}",
              f"Temperature        {a['temperature']:+.2f}", f"Tint               {a['tint']:+.2f}", f"Vignette           {a['vignette']:.2f}",
              f"LUT                {decision['lut'] or 'None'}"]
    if val is not None:
        lines.append(f"Overall Treatment  {val.change_pct:.0f}%  (mudança média medida)")
    pr = decision["protections"]
    lines.append("Protections        " + ", ".join(f"{k} {'ON' if on else 'OFF'}" for k, on in pr.items()))
    lines.append("Issues             " + ("; ".join(decision["issues"]) or "nenhum problema técnico"))
    if decision.get("reasons"):
        lines.append("Reasons            " + "; ".join(decision["reasons"]))
    if decision.get("note"):
        lines.append(decision["note"])
    if val is not None:
        lines += ["", "QUALITY SCORE"] + [f"{k.replace('_', ' ').title():<18} {s}/100" for k, s in val.scores.items()]
        lines.append(f"Verdict            {val.verdict}")
        lines += [f"  FALHA: {x}" for x in val.failures] + [f"  aviso: {x}" for x in val.warnings]
    return "\n".join(lines)


def side_by_side(orig: np.ndarray, edit: np.ndarray, path: str, labels=("ORIGINAL", "EDITADO")) -> None:
    from PIL import ImageDraw
    a = Image.fromarray((np.clip(orig, 0, 1) * 255).astype(np.uint8))
    b = Image.fromarray((np.clip(edit, 0, 1) * 255).astype(np.uint8))
    out = Image.new("RGB", (a.width + b.width + 8, a.height + 28), "white")
    out.paste(a, (0, 28))
    out.paste(b, (a.width + 8, 28))
    dr = ImageDraw.Draw(out)
    dr.text((6, 8), labels[0], fill="black")
    dr.text((a.width + 14, 8), labels[1], fill="black")
    out.save(path)


def to_json(obj) -> str:
    if isinstance(obj, Validation):
        obj = asdict(obj)
    return json.dumps(obj, ensure_ascii=False, indent=2)
