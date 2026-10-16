"""Actualiza precios.json con los precios semanales de ganado gordo de Fedegán.

Lo corre GitHub Actions antes de publicar la app. Si la página de Fedegán cambia
o no responde, no toca nada y la app sigue con los precios que ya tiene.
"""
import json, re, sys, urllib.request
from io import StringIO

URL = "https://estadisticas.fedegan.org.co/Indicadores/13"
ARCHIVO = "precios.json"
MESES = {"ene": 1, "feb": 2, "mar": 3, "abr": 4, "may": 5, "jun": 6, "jul": 7, "ago": 8, "sep": 9, "oct": 10, "nov": 11, "dic": 12}


def fecha(txt):
    m = re.search(r"([a-záé]{3})\w*\.?\s+(\d{1,2}),?\s+'?(\d{2,4})", str(txt).lower())
    if not m or m.group(1)[:3] not in MESES:
        return None
    anio = int(m.group(3)); anio = anio + 2000 if anio < 100 else anio
    return f"{anio}-{MESES[m.group(1)[:3]]:02d}-{int(m.group(2)):02d}"


def numero(v):
    try:
        s = str(v).strip().replace("$", "").replace(" ", "")
        if re.fullmatch(r"\d{1,3}(\.\d{3})+", s):
            s = s.replace(".", "")
        n = float(s)
        return int(round(n * 1000)) if n < 100 else int(round(n))
    except Exception:
        return None


def main():
    import pandas as pd
    req = urllib.request.Request(URL, headers={"User-Agent": "Mozilla/5.0 (HatoClaro precios)"})
    html = urllib.request.urlopen(req, timeout=60).read().decode("utf-8", "replace")
    tablas = pd.read_html(StringIO(html), thousands=".", decimal=",")
    print(f"Tablas encontradas: {len(tablas)}")
    datos = json.load(open(ARCHIVO, encoding="utf-8"))
    regiones = datos["gordo"]["regiones"]
    nuevos = {}
    for t in tablas:
        cols = [" ".join(map(str, c)) if isinstance(c, tuple) else str(c) for c in t.columns]
        texto = " ".join(cols).lower()
        if "bogot" in texto and "antioquia" in texto:
            for _, fila in t.iterrows():
                f = fecha(fila.iloc[0])
                if not f:
                    continue
                reg = nuevos.setdefault(f, {"fecha": f})
                for col, val in zip(cols[1:], fila.iloc[1:]):
                    nombre = next((r for r in regiones if r.lower()[:5] in col.lower()), None)
                    n = numero(val)
                    if nombre and n:
                        reg[nombre] = n
        elif "bolsa" in texto and "subasta" in texto:
            for _, fila in t.iterrows():
                f = fecha(fila.iloc[0])
                n = numero(fila.iloc[2]) if len(fila) > 2 else None
                if f and n:
                    nuevos.setdefault(f, {"fecha": f})["Subastas (promedio)"] = n
    validos = {f: r for f, r in nuevos.items() if r.get("Nacional") and 4000 < r["Nacional"] < 30000}
    if not validos:
        print("No se reconocieron precios válidos; precios.json queda igual.")
        return 0
    serie = {r["fecha"]: r for r in datos["gordo"]["serie"]}
    for f, r in validos.items():
        serie[f] = {**serie.get(f, {}), **r}
    datos["gordo"]["serie"] = [serie[f] for f in sorted(serie)][-60:]
    datos["actualizado"] = max(validos)
    json.dump(datos, open(ARCHIVO, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"Actualizado: {len(validos)} semanas, la última {max(validos)} con Nacional {validos[max(validos)]['Nacional']}")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:
        print(f"No se pudieron actualizar los precios: {e}")
        sys.exit(0)
