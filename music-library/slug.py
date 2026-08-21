#!/usr/bin/env python3
"""ASCII slugs for URLs. Display stays in the artist's own script; anything that
goes into a URL, a cache key or a file name is English/ASCII.

For Hebrew and Arabic names with no Latin form on record we romanise, which is
lossy but deterministic and readable enough to recognise.
"""
import hashlib, re, unicodedata

HEB_MAP = {
    "א": "", "ב": "b", "ג": "g", "ד": "d", "ה": "h", "ו": "v", "ז": "z",
    "ח": "ch", "ט": "t", "י": "y", "כ": "k", "ך": "k", "ל": "l", "מ": "m",
    "ם": "m", "נ": "n", "ן": "n", "ס": "s", "ע": "", "פ": "p", "ף": "f",
    "צ": "tz", "ץ": "tz", "ק": "k", "ר": "r", "ש": "sh", "ת": "t",
    "׳": "", "״": "",
}
ARA_MAP = {
    "ا": "a", "ب": "b", "ت": "t", "ث": "th", "ج": "j", "ح": "h", "خ": "kh",
    "د": "d", "ذ": "dh", "ر": "r", "ز": "z", "س": "s", "ش": "sh", "ص": "s",
    "ض": "d", "ط": "t", "ظ": "z", "ع": "a", "غ": "gh", "ف": "f", "ق": "q",
    "ك": "k", "ل": "l", "م": "m", "ن": "n", "ه": "h", "و": "w", "ي": "y",
    "ى": "a", "ة": "a", "أ": "a", "إ": "i", "آ": "a", "ؤ": "u", "ئ": "i",
}


def romanize(s):
    out = []
    for ch in s or "":
        if ch in HEB_MAP:
            out.append(HEB_MAP[ch])
        elif ch in ARA_MAP:
            out.append(ARA_MAP[ch])
        else:
            out.append(ch)
    return "".join(out)


def slug(s, maxlen=40):
    s = romanize(s or "")
    s = unicodedata.normalize("NFKD", s.casefold())
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    s = re.sub(r"-{2,}", "-", s)
    if len(s) > maxlen:
        s = s[:maxlen].rstrip("-")
    return s


def short_hash(s, n=5):
    return hashlib.sha1((s or "").encode("utf-8")).hexdigest()[:n]


def unique_slugs(items, keyfn, base_fn):
    """-> list of slugs, one per item, guaranteed distinct and never empty."""
    out, seen = [], {}
    for it in items:
        b = base_fn(it) or ""
        if not b:
            b = "x" + short_hash(keyfn(it))
        s = b
        if s in seen:
            s = b + "-" + short_hash(keyfn(it), 4)
            while s in seen:                       # astronomically unlikely
                s += "x"
        seen[s] = True
        out.append(s)
    return out


if __name__ == "__main__":
    for t in ["מה שאפשר עם מה שנשאר", "דודא", "רביד פלוטניק", "Speakerboxxx/The Love Below",
              "AC/DC", "Röyksopp", "עטר מיינר", "صباح الورد", "Blonde"]:
        print(f"{t!r:34} -> {slug(t)!r}")
