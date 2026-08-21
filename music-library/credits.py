#!/usr/bin/env python3
"""Split a credit line into the acts it names.

'Vibe Ish, Roisha' is two artists; 'Tyler, The Creator' is one. The separator
alone can't tell them apart, so the deciding evidence is whether Deezer knows
the whole string as a single artist — that already protects 'Peter Bjorn and
John', 'Florence + The Machine' and 'Simon & Garfunkel', which every
separator-based rule destroys.
"""
import re

# ' x ' only splits with spaces around it: 'Chloe x Halle' is caught by the
# single-act check, but 'Machinedrum x' style credits are common enough that a
# bare 'x' inside a word must never match.
# Hebrew credits say 'מארח את' (hosts) and 'עם' (with) where English says feat.
SEP = re.compile(
    r"\s*(?:,|&|\+|/"
    r"|\bfeat\.?\b|\bft\.?\b|\bfeaturing\b|\bwith\b|\band\b|\bx\b|\bvs\.?\b"
    r"|מארחים\s+את|מארחות\s+את|מארחת\s+את|מארח\s+את"
    r"|(?<=\s)עם(?=\s))\s*",
    re.I)

# Fragments that are never an artist on their own.
NOISE = {"the", "and", "&", "feat", "ft", "with", "x", "vs", "", "-", "official",
         "hd", "prod", "by", "more"}


# YouTube Music appends a romanisation of the whole credit:
#   'דודא & טדי נגוסה - Duda'  ->  the '- Duda' belongs to no single member.
TRAILING_LATIN = re.compile(r"^(?P<body>.+?)\s+[-–]\s+(?P<lat>[A-Za-z][A-Za-z0-9 .,&\'\-]*)$")
HEB_ARA = re.compile(r"[\u0590-\u05ff\u0600-\u06ff]")


def strip_trailing_latin(name):
    m = TRAILING_LATIN.match(name or "")
    if not m:
        return name
    body = m.group("body")
    # Only when the body is the real credit (non-Latin) and names several acts.
    if HEB_ARA.search(body) and len(SEP.split(body)) > 1:
        return body.strip()
    return name


def parts(name):
    out, seen = [], set()
    for p in SEP.split(name or ""):
        p = p.strip(" \t-–—|/\\")
        if not p or p.casefold() in NOISE:
            continue
        k = p.casefold()
        if k not in seen:
            seen.add(k)
            out.append(p)
    return out


def split_credit(name, is_single_act):
    """-> [act, ...]. One entry when the credit names a single act."""
    if not is_single_act(name):
        name = strip_trailing_latin(name)
    ps = parts(name)
    if len(ps) < 2:
        return [name.strip()] if name and name.strip() else []
    if is_single_act(name):
        return [name.strip()]
    # A trailing 'The Creator'-ish fragment means we mangled a real name.
    if any(p.casefold().startswith("the ") and len(p.split()) <= 2 for p in ps[1:]):
        if is_single_act(name):
            return [name.strip()]
    # Inside a multi-act credit a trailing romanisation can't be attributed to
    # one member — 'דודא - David Lev-Ari & דוד לב ארי' romanises the *second*
    # act onto the first. Drop it; solo credits keep theirs, where it's reliable.
    return [strip_part_latin(p) for p in ps]


PART_LATIN = re.compile(r"^(?P<body>.+?)\s+[-–]\s+(?P<lat>[A-Za-z][A-Za-z0-9 .,&\'\-]*)$")


def strip_part_latin(p):
    m = PART_LATIN.match(p or "")
    if m and HEB_ARA.search(m.group("body")):
        return m.group("body").strip()
    return p
