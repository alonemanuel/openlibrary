#!/usr/bin/env python3
"""Pair liked songs against an album's official tracklist.

Titles in the export are YouTube-shaped ('Gorillaz #06- Superfast Jellyfish
(feat. …)') while Deezer's are clean ('Superfast Jellyfish (feat. …)'), so
matching runs in tiers: exact → feature-stripped → fuzzy, each assigning at
most one liked song per official track.
"""
import difflib, re, unicodedata

MARKS = re.compile(r"[̀-֑ͯ-ׇ]")
BRACKET = re.compile(r"[\(\[][^)\]]*[\)\]]")
FEAT = re.compile(r"\b(?:feat|ft|featuring|with|prod|by)\b.*", re.I)
NONWORD = re.compile(r"[^0-9a-z֐-׿؀-ۿ]+")


def _fold(s):
    s = unicodedata.normalize("NFKD", (s or "").casefold())
    return MARKS.sub("", s)


def full_key(t):
    """Everything but punctuation and accents."""
    return NONWORD.sub(" ", _fold(t)).strip()


def core_key(t):
    """Feature credits, brackets and leading junk removed — the bare song name."""
    s = _fold(t)
    s = BRACKET.sub(" ", s)
    s = FEAT.sub(" ", s)
    s = NONWORD.sub(" ", s).strip()
    return s


def match_album(liked, official, cutoff=0.84):
    """liked: [(songIdx, title)] · official: [[title, secs]]
    -> (assigned {officialPos: songIdx}, leftover [songIdx])
    """
    assigned, used = {}, set()
    o_full = [full_key(t[0]) for t in official]
    o_core = [core_key(t[0]) for t in official]

    def take(i, si):
        assigned[i] = si
        used.add(si)

    # Tier 1 — identical once punctuation is gone.
    for si, title in liked:
        if si in used:
            continue
        k = full_key(title)
        for i, ok in enumerate(o_full):
            if i not in assigned and ok and ok == k:
                take(i, si); break

    # Tier 2 — same song, different feature-credit formatting.
    for si, title in liked:
        if si in used:
            continue
        k = core_key(title)
        if not k:
            continue
        for i, ok in enumerate(o_core):
            if i not in assigned and ok and ok == k:
                take(i, si); break

    # Tier 3 — fuzzy, best candidate above the cutoff. Handles the YouTube
    # prefixes ('Gorillaz #06- …') that survive the earlier tiers.
    for si, title in liked:
        if si in used:
            continue
        k = core_key(title) or full_key(title)
        if not k:
            continue
        best, bi = cutoff, None
        for i, ok in enumerate(o_core):
            if i in assigned or not ok:
                continue
            r = difflib.SequenceMatcher(None, k, ok).ratio()
            # A clean containment (prefix junk) counts as a strong match.
            if k in ok or ok in k:
                r = max(r, 0.9)
            if r > best:
                best, bi = r, i
        if bi is not None:
            take(bi, si)

    leftover = [si for si, _ in liked if si not in used]
    return assigned, leftover


if __name__ == "__main__":
    official = [["Orchestral Intro (feat. Sinfonia ViVA)", 69],
                ["Superfast Jellyfish (feat. Gruff Rhys and De La Soul)", 174],
                ["Empire Ants (feat. Little Dragon)", 271],
                ["Rhinestone Eyes", 200],
                ["On Melancholy Hill", 233]]
    liked = [(1, "Gorillaz #06- Superfast Jellyfish (feat. Gruff Rhys and De La Soul)"),
             (2, "Empire Ants ft. Little Dragon"),
             (3, "Rhinestone Eyes"),
             (4, "Some Bonus Track Not On The Album")]
    a, lo = match_album(liked, official)
    for i, t in enumerate(official):
        print(f"  {'LIKED ' if i in a else 'grey  '} {t[0][:50]}")
    print("  leftover (liked, not on tracklist):", lo)
