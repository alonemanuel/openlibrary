#!/usr/bin/env python3
"""Title tidying + bilingual name splitting. Imported by build.py.

Deliberately conservative: only strips things that are demonstrably YouTube
packaging, never anything that could be part of a real title. Feature credits,
(Live), (Remix) and bracketed subtitles are all left alone.
"""
import re, unicodedata

HEB = re.compile(r"[֐-׿]")
LAT = re.compile(r"[A-Za-z]")
ARA = re.compile(r"[؀-ۿ]")

# --- title cleanup -----------------------------------------------------------

_RULES = [
    # "#2 - Song - 1/10"  → the series marker and the x/10 index around it
    (re.compile(r"^\s*#\d+\s*[-–—]\s*"), ""),
    (re.compile(r"\s*[-–—]\s*\d{1,2}/10\s*$"), ""),
    # bracketed YouTube packaging
    (re.compile(r"\s*[\(\[]\s*(?:official\s*)?(?:music\s*)?(?:video|audio|visuali[sz]er|lyric[s]?(?:\s*video)?|full\s*hd|hd|hq|4k)\s*[\)\]]", re.I), ""),
    (re.compile(r"\s*[\(\[]\s*official\s*[\)\]]", re.I), ""),
    # trailing "| Official Music Video", "// Official Music Video", or bare
    (re.compile(r"\s*(?://|[|\-–—])\s*official\s+(?:music\s+)?(?:video|audio)\s*$", re.I), ""),
    (re.compile(r"\s+official\s+(?:music\s+)?(?:video|audio)\s*$", re.I), ""),
    # leading track numbers: "03. Title", "04 - Title" (not "2 Weeks", "1 Sec")
    (re.compile(r"^\s*\d{1,2}\s*[.\-–]\s+"), ""),
    # leftover separators / whitespace
    (re.compile(r"\s*(?://|[|\-–—])\s*$"), ""),
    (re.compile(r"^\s*[|\-–—]\s*"), ""),
    (re.compile(r"\s{2,}"), " "),
]


def clean_title(t):
    """Return (cleaned, changed). Never returns an empty string."""
    orig = t = (t or "").strip()
    for rx, rep in _RULES:
        t = rx.sub(rep, t)
    t = t.strip(" \t-–—|")
    t = re.sub(r"\s{2,}", " ", t).strip()
    if not t:
        return orig, False
    return t, t != orig


# --- bilingual names ---------------------------------------------------------

# Only these separators mean "same name, two scripts". Commas and ampersands
# mean a collaborator list ("Balkan Beat Box, אקווריום") and must never split.
_SEPS = [" - ", " – ", " — ", " | ", " / ", " \\\\ ", " \\ ", "-", "–", "|", "\\\\", "\\"]


def _tidy(s):
    """Trim separator debris left on either side of a split."""
    return s.strip().strip("\\/|-–—").strip()


def _script(s):
    h, l, a = bool(HEB.search(s)), bool(LAT.search(s)), bool(ARA.search(s))
    if h and not l and not a:
        return "he"
    if a and not l and not h:
        return "ar"
    if l and not h and not a:
        return "en"
    return "mixed"


_CREDITY = re.compile(r"[()\[\]]|\b(?:prod|feat|ft|remix|cover|official)\b", re.I)


def _plausible_latin(s):
    """A romanisation, not a credit like '(prod. by duda)' or 'feat. X'."""
    return bool(s) and not _CREDITY.search(s)


def split_bilingual(name):
    """-> (display, latin_or_None).

    For a Hebrew/Arabic artist written as 'Duda - דודא' or 'מבוא הדודאים - Mevo
    Hadudaim', display the native-script side and keep the Latin one for search
    and for the record. Returns (name, None) when it isn't such a pair.
    """
    n = " ".join((name or "").strip().split())
    if not n or not (HEB.search(n) or ARA.search(n)) or not LAT.search(n):
        return n, None
    if "," in n or "&" in n:            # collaborator list — leave alone
        return n, None

    for sep in _SEPS:
        if sep not in n:
            continue
        parts = [p.strip() for p in n.split(sep)]
        if len(parts) != 2 or not all(parts):
            continue
        a, b = _tidy(parts[0]), _tidy(parts[1])
        if not a or not b:
            continue
        sa, sb = _script(a), _script(b)
        if sa in ("he", "ar") and sb == "en":
            return a, (b if _plausible_latin(b) else None)
        if sa == "en" and sb in ("he", "ar"):
            return b, (a if _plausible_latin(a) else None)
        break

    # No separator: a clean "Latin-run + native-run" split, e.g.
    # 'Marina Maximilian מארינה מקסימיליאן'.
    toks = n.split(" ")
    for i in range(1, len(toks)):
        a, b = " ".join(toks[:i]), " ".join(toks[i:])
        sa, sb = _script(a), _script(b)
        if sa == "en" and sb in ("he", "ar"):
            return b, (a if _plausible_latin(a) else None)
        if sa in ("he", "ar") and sb == "en":
            return a, (b if _plausible_latin(b) else None)
    return n, None


if __name__ == "__main__":
    for t in ["#2 - אני רוצה למות (שה לה לה) - 1/10",
              "03. iFeel // Official Music Video",
              "Mindchatter - Trippy (Official Audio)",
              "'Witness (1 Hope)' Official Video",
              "2 Weeks", "1 Sec", "2-1",
              "Melt Session #1 (feat. Robert Glasper)",
              "Empire Ants ft. Little Dragon",
              "Keep On (Live) | Mahogany Session"]:
        c, ch = clean_title(t)
        print(f"{'CHANGED' if ch else '  keep '}  {t!r}\n           -> {c!r}")
    print()
    for a in ["Duda - דודא", "מבוא הדודאים - Mevo Hadudaim", "Daklon-דקלון",
              "Idan Amedi | עידן עמדי", "Marina Maximilian מארינה מקסימיליאן",
              "Balkan Beat Box, אקווריום", "Cohen & אברי ג'י", "Radiohead",
              "רביד פלוטניק", "Atar Mayner, שיר דוד גדסי, & Maayan Linik",
              "AyoubTaresh ايوب طارش", "(prod. by duda) מבוא הדודאים"]:
        d, l = split_bilingual(a)
        print(f"{a!r:48} -> display={d!r:28} latin={l!r}")
