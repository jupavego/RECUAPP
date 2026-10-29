"""Utilidades de texto y cifras comunes a todo el pipeline."""
import itertools
import re
import unicodedata
from difflib import SequenceMatcher

MONEY = re.compile(r"\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d{1,3}(?:,\d{3})+(?:\.\d+)?|(?<![\d.,])\d{4,}(?![\d.,])|(?<![\d.,])0(?![\d.,])")

VOCAB = set()
VOCAB_N = set()
OPCIONES = ("ti", "tí", "ñ", "í", "ó", "á", "é", "ú")


def norm(s):
    s = unicodedata.normalize("NFKD", s)
    s = "".join(c for c in s if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9 ]", "", s.lower()).strip()


def construir_vocab(textos):
    """Vocabulario del propio plan, para reparar palabras con ligaduras perdidas."""
    for w in re.findall(r"[A-Za-záéíóúñÁÉÍÓÚÑ]{4,}", " ".join(textos)):
        VOCAB.add(w.lower())
        VOCAB_N.add(norm(w))


def repara_ti(txt):
    """El PDF pierde la ligatura 'ti' en algunas fuentes ('Juscia'); se reinserta usando el vocabulario del plan."""
    def fix(m):
        w = m.group(0)
        if len(w) < 4 or w.lower() in VOCAB or not VOCAB:
            return w
        for k in range(1, len(w)):
            for ins in ("ti", "titi"):
                c = w[:k] + ins + w[k:]
                if c.lower() in VOCAB:
                    return c
        return w
    return re.sub(r"[A-Za-zÁÉÍÓÚáéíóúñÑ]+", fix, txt)


def _repara_glifo(m):
    """Glifos perdidos (U+FFFD) dentro de una palabra: 'ti', 'ñ' o una vocal con tilde, segun cual forme una
    palabra del plan. Si ninguna combinacion existe en el vocabulario, 'ti' como en las ligaduras perdidas."""
    w = m.group(0)
    n = w.count("�")
    if len(w) < 4 or n > 3:
        return w
    for combo in itertools.product(OPCIONES, repeat=n):
        c = w
        for rep in combo:
            c = c.replace("�", rep, 1)
        if norm(c) in VOCAB_N:
            return c
    return re.sub("(?<=[a-záéíóúñ])�(?=[a-záéíóúñ])", "ti", w, flags=re.I)


def limpia(s):
    s = re.sub(r"<br>", " ", s)
    s = re.sub(r"<!--.*?-->", " ", s)
    s = re.sub(r"</?(?:mark|u|i|b|sup|sub)>", "", s)
    s = re.sub(r"[*_~]", "", s)
    s = re.sub("[A-Za-záéíóúñ�]*�[A-Za-záéíóúñ�]*", _repara_glifo, s)
    s = s.replace("�", "")
    return repara_ti(re.sub(r"\s+", " ", s).strip())


def dinero(tok):
    """1.234.567 o 1,234,567 (con decimales opcionales) -> int."""
    if "," in tok and "." in tok:
        tok = tok.replace(".", "").split(",")[0] if tok.rfind(",") > tok.rfind(".") else tok.replace(",", "").split(".")[0]
    elif tok.count(".") >= 1 and re.fullmatch(r"\d{1,3}(\.\d{3})+", tok):
        tok = tok.replace(".", "")
    elif tok.count(",") >= 1 and re.fullmatch(r"\d{1,3}(,\d{3})+", tok):
        tok = tok.replace(",", "")
    else:
        tok = tok.replace(".", "").replace(",", "")
    return int(tok)


def filas_tabla(md):
    """Lista de tablas; cada tabla = lista de filas = lista de celdas."""
    tablas, actual = [], []
    for ln in md.splitlines():
        if ln.startswith("|"):
            if re.match(r"^\|[-| ]+\|$", ln):
                continue
            actual.append([c for c in ln.strip().strip("|").split("|")])
        elif actual:
            tablas.append(actual)
            actual = []
    if actual:
        tablas.append(actual)
    return tablas


def sin_glitch(txt):
    """Texto vertical del encabezado: 'N o m b r e' o '2 0 2 4' (3+ simbolos sueltos seguidos)."""
    return re.sub(r"(?:(?<!\S)\S(?!\S) ?){3,}", "", txt)


def sin_letras_sueltas(txt):
    """Quita encabezados verticales ('N o m b r e d e l s e c t o r X') pegados al valor."""
    return re.sub(r"^(?:[A-Za-z] )+", "", txt).strip()


def valores_celdas(celdas):
    """Una cifra por token; un '-' suelto cuenta como 0 (si no, se corren las columnas)."""
    out = []
    for x in celdas:
        x = sin_glitch(x)
        for m in re.finditer(MONEY.pattern + r"|(?<!\S)-(?!\S)", x):
            out.append(0 if m.group(0) == "-" else dinero(m.group(0)))
    return out


def clave_linea(txt):
    m = re.search(r"l.nea\D{0,3}(\d)", norm(txt))
    return m.group(1) if m else norm(txt)


def similitud(a, b):
    return SequenceMatcher(None, norm(a), norm(b)).ratio()


def mejor(nombre, canon):
    """(similitud, candidato) del nombre contra una lista de nombres canonicos."""
    n = norm(nombre)
    sc = [(SequenceMatcher(None, n, norm(c)).ratio(), c) for c in canon]
    return max(sc) if sc else (0, None)
