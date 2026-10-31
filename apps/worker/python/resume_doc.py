"""Edits the candidate's own resume file in place, keeping its design (Friday Jobs tailoring).

    resume_doc.py extract <file> <pdf|docx>
        Prints {"units": [...]}: the resume's text in reading order, one unit per paragraph or bullet,
        each with the character range a rewrite must fit in. Units marked fixed (names, headings, titles,
        dates, links) are context only.

    resume_doc.py links <file> <pdf|docx>
        Prints {"links": [...]}: the web addresses the resume links to (often behind words like
        "LinkedIn" or "GitHub", so they're missing from its text).

    resume_doc.py coverletter <letter.json> <out.pdf>
        letter: {"name", "contact": [..], "date", "body": "paragraphs separated by blank lines"}. Writes a
        plain one-page A4 letter.

    resume_doc.py render <file> <pdf|docx> <plan.json> <out>
        plan: {"edits": {unit id: new text}, "bold": [terms]}. Writes the edited file to <out>: each
        edited unit's text replaced in the same place, font, size and colour, with the bold terms in bold.
        Prints {"applied": [ids], "skipped": [{"id", "reason"}]}.

Extraction is deterministic, so render re-derives the same units from the same file. Called by
apps/worker/src/queues/tailor.ts. PDF uses PyMuPDF (AGPL, or Artifex's commercial licence).
"""

import json
import re
import subprocess
import sys
from copy import deepcopy

BULLETS = set("•●▪◦‣∙·–-*■□➢➤►▶✓✔")
SENTENCE_END = re.compile(r"[.!?:;]\s*$")
# Spaces, and zero-width characters Google Docs leaves around text.
INVISIBLE = " \t\u00a0\u200b\u200c\u200d\ufeff"


def clean(text):
    return re.sub(r"[\u200b\u200c\u200d\ufeff]", "", text).strip()
# Shorter units are dates, titles and the like.
MIN_EDITABLE = 30


def bold_segments(text, terms):
    """Splits text into [(chunk, bold)] with every whole-word occurrence of a term in bold."""
    terms = sorted({t.strip() for t in terms if t and t.strip()}, key=len, reverse=True)
    if not terms:
        return [(text, False)]
    # A term also bolds the rest of a dotted name it starts ("React" in "React.js").
    pattern = re.compile(
        r"(?<![\w.])(?:" + "|".join(re.escape(t) for t in terms) + r")(?:\.\w+)*(?![\w])", re.IGNORECASE
    )
    out, pos = [], 0
    for m in pattern.finditer(text):
        if m.start() > pos:
            out.append((text[pos : m.start()], False))
        out.append((m.group(0), True))
        pos = m.end()
    if pos < len(text):
        out.append((text[pos:], False))
    return out


def has_term(text, terms):
    return any(bold for _, bold in bold_segments(text, terms))


def limits(text, capacity):
    """A rewrite keeps roughly the original length, so the page keeps its shape."""
    n = len(text)
    return max(int(n * 0.8), n - 40), max(n, min(capacity, int(n * 1.12) + 6))


# ---- PDF -----------------------------------------------------------------------------------------


def pdf_units(doc):
    import pymupdf

    units = []
    for pno, page in enumerate(doc):
        link_rects = [pymupdf.Rect(l["from"]) for l in page.get_links()]
        lines = []
        # rawdict: per-character positions, to find where a line's words start after its bullet.
        for b in page.get_text("rawdict", flags=pymupdf.TEXTFLAGS_TEXT)["blocks"]:
            for l in b.get("lines", []):
                spans = []
                for sp in l["spans"]:
                    text = "".join(c["c"] for c in sp["chars"])
                    if text:
                        spans.append({**sp, "text": text})
                if spans and l["dir"] == (1.0, 0.0):
                    lines.append({"block": b["number"], "bbox": pymupdf.Rect(l["bbox"]), "spans": spans})

        # Lines that start where this unit starts show how wide that column's text runs. Using the
        # widest of them never runs past the template's own margin.
        def column_right(x0):
            return max(l["bbox"].x1 for l in lines if abs(l["bbox"].x0 - x0) < 2)

        current = None
        for line in lines:
            # Drop invisible spacer spans, then the bullet and spaces in front of the words, which
            # some generators (Google Docs) put in the same span as the words.
            spans = [s for s in line["spans"] if s["size"] >= 4] or line["spans"]
            bullet = False
            while spans:
                head = spans[0]
                k = 0
                while k < len(head["chars"]) and (head["chars"][k]["c"] in BULLETS or head["chars"][k]["c"] in INVISIBLE):
                    bullet = bullet or head["chars"][k]["c"] in BULLETS
                    k += 1
                if k == len(head["chars"]):
                    spans = spans[1:]
                    continue
                if k:
                    chars = head["chars"][k:]
                    spans = [{**head, "chars": chars, "text": "".join(c["c"] for c in chars),
                              "origin": chars[0]["origin"], "bbox": (chars[0]["bbox"][0], *head["bbox"][1:])}] + spans[1:]
                break
            if not spans or not "".join(s["text"] for s in spans).strip(INVISIBLE):
                continue
            body = spans[0]
            line["cx"] = body["origin"][0]
            slot = {
                "x": body["origin"][0],
                "y": body["origin"][1],
                "x1": line["bbox"].x1,
                "y0": line["bbox"].y0,
                "y1": line["bbox"].y1,
                "spans": spans,
                "text": clean("".join(s["text"] for s in spans)),
            }
            all_bold = all(s["flags"] & 16 for s in spans)
            lead = "".join(x["text"] for x in spans[: next((k for k, x in enumerate(spans) if not x["flags"] & 16), len(spans))])
            labelled = not all_bold and lead.strip(INVISIBLE).endswith(":")
            continues = (
                current is not None
                and not bullet
                and not labelled
                and all_bold == current["bold"]
                # Some generators (LaTeX) put each printed line in its own block: join those when
                # the sentence carries on in the same font.
                and (
                    current["block"] == line["block"]
                    or (
                        spans[0]["font"] == current["slots"][-1]["spans"][-1]["font"]
                        and not SENTENCE_END.search(current["slots"][-1]["text"])
                    )
                )
                and abs(spans[0]["size"] - current["size"]) < 0.3
                and (abs(line["bbox"].x0 - current["x0"]) < 3 or abs(line["bbox"].x0 - current["cx"]) < 3)
                and 0 < slot["y"] - current["slots"][-1]["y"] < spans[0]["size"] * 1.8
            )
            if continues:
                current["slots"].append(slot)
            else:
                current = {
                    "page": pno,
                    "block": line["block"],
                    "x0": line["bbox"].x0,
                    "cx": slot["x"],
                    "size": spans[0]["size"],
                    "bold": all_bold,
                    "slots": [slot],
                    "links": link_rects,
                }
                units.append(current)

        for u in units:
            if u["page"] == pno and "right" not in u:
                u["right"] = max(column_right(u["x0"]), max(s["x1"] for s in u["slots"]))
                ends = [s["x1"] for s in u["slots"][:-1]]
                u["justify"] = max(ends) if len(ends) >= 1 and max(ends) - min(ends) < 1.5 and u["right"] - max(ends) < 3 else 0

    out = []
    for i, u in enumerate(units):
        spans = [s for slot in u["slots"] for s in slot["spans"]]
        label = ""
        first = u["slots"][0]
        lead = []
        for s in first["spans"]:
            if not (s["flags"] & 16):
                break
            lead.append(s)
        # A bold "Label:" opening the line, followed by regular text (skills lines).
        if lead and len(lead) < len(first["spans"]) and "".join(x["text"] for x in lead).strip(INVISIBLE).endswith(":"):
            label = "".join(x["text"] for x in lead)
        else:
            lead = []
        content_spans = spans[len(lead) :] if label else spans
        text = " ".join(slot["text"] for slot in u["slots"])
        if label:
            text = clean(text[len(clean(label)) :])
        fonts = {re.sub(r"^[A-Z]{6}\+", "", s["font"]).split("-")[0] for s in content_spans}
        all_bold = content_spans and all(s["flags"] & 16 for s in content_spans)
        italic = any(s["flags"] & 2 for s in content_spans)
        colours = {s["color"] for s in content_spans}
        linked = any(
            r.intersects(pymupdf.Rect(slot["x"], slot["y0"], slot["x1"], slot["y1"])) for r in u["links"] for slot in u["slots"]
        )
        fixed = (
            len(text) < MIN_EDITABLE
            or not content_spans
            or all_bold
            or italic
            or linked
            or len(fonts) > 1
            or len(colours) > 1
            or bool(re.search(r"https?://|www\.|@\S+\.", text))
        )
        # Characters that fit: what the lines hold now, plus the room left on the last one.
        avg = sum(s["size"] for s in content_spans) / max(len(content_spans), 1) * 0.5
        spare = max(0, (u["right"] - u["slots"][-1]["x1"]) / avg) if avg else 0
        capacity = int(len(text) + spare)
        lo, hi = limits(text, capacity)
        emphasis = [s["text"].strip(" ,.;:") for s in content_spans if s["flags"] & 16 and s["text"].strip(" ,.;:")]
        out.append(
            {
                "id": f"u{i + 1}",
                "text": text,
                "emphasis": emphasis,
                "label": clean(label),
                "fixed": fixed,
                "min": lo,
                "max": hi,
                "_unit": u,
                "_content": content_spans,
            }
        )
    return out


class FontSet:
    """Fonts for one face of one span: the file's own (subset) font first, then the same family from
    the system (fontconfig), then a built-in PDF font. Each word uses the first that has all its glyphs."""

    def __init__(self, doc, page, span, bold):
        import pymupdf

        self.page = page
        self.fonts = []  # (alias, Font, synthetic_bold)
        base = re.sub(r"^[A-Z]{6}\+", "", span["font"])
        family = base.split("-")[0].split(",")[0]
        want_bold = bold
        names = []
        for xref, ext, typ, fname, alias, enc in page.get_fonts():
            n = re.sub(r"^[A-Z]{6}\+", "", fname)
            if n.split("-")[0].split(",")[0] != family:
                continue
            is_bold = "bold" in n.lower() or "black" in n.lower() or "semibold" in n.lower()
            is_italic = "italic" in n.lower() or "oblique" in n.lower()
            if is_italic or is_bold != want_bold:
                continue
            names.append(xref)
        for xref in names:
            try:
                buf = doc.extract_font(xref)[3]
                if buf:
                    self.add(pymupdf.Font(fontbuffer=buf), buf, False)
            except Exception:
                pass
        system = fc_match(family, want_bold)
        if system:
            self.add(pymupdf.Font(fontfile=system), None, False, path=system)
        if want_bold:
            # The regular face drawn with a thin outline, when no bold face has the glyphs.
            regular = FontSet(doc, page, span, False)
            for alias, font, _ in regular.fonts[:-1]:
                self.fonts.append((alias, font, True))
        serif = bool(span["flags"] & 4) or bool(re.search(r"serif|times|garamond|georgia|cambria|roman|book", base, re.I)) and "sans" not in base.lower()
        builtin = ("tibo" if want_bold else "tiro") if serif else ("hebo" if want_bold else "helv")
        self.fonts.append((builtin, pymupdf.Font(builtin), False))

    def add(self, font, buf, synthetic, path=None):
        # Registered with the page only when written (after redaction, which drops unused fonts).
        _sources[id(font)] = (buf, path)
        self.fonts.append((f"f{id(font) % 10**9}", font, synthetic))

    def pick(self, word):
        for alias, font, synthetic in self.fonts:
            if all(font.has_glyph(ord(c)) or c == " " for c in word):
                return alias, font, synthetic
        return self.fonts[-1]


_fc_cache = {}
# Font object id -> (buffer, file path), to register it with a page when text is written.
_sources = {}
_registered = set()


def register(page, alias, font):
    if (page.number, alias) in _registered or alias in ("helv", "hebo", "tiro", "tibo", "cour", "cobo"):
        return
    buf, path = _sources[id(font)]
    if buf is not None:
        page.insert_font(fontname=alias, fontbuffer=buf)
    else:
        page.insert_font(fontname=alias, fontfile=path)
    _registered.add((page.number, alias))
# Common resume fonts that aren't free, mapped to metric-compatible ones.
FC_ALIASES = {"garamond": "EB Garamond", "calibri": "Carlito", "cambria": "Caladea", "arial": "Liberation Sans", "helvetica": "Liberation Sans",
              "timesnewroman": "Liberation Serif", "times": "Liberation Serif", "couriernew": "Liberation Mono",
              "georgia": "Gelasio", "arialmt": "Liberation Sans", "timesnewromanpsmt": "Liberation Serif"}


def fc_match(family, bold):
    key = (family, bold)
    if key in _fc_cache:
        return _fc_cache[key]
    path = None
    plain = re.sub(r"(MT|PS|PSMT)$", "", family)
    for name in (plain, FC_ALIASES.get(family.lower().replace(" ", ""), ""), FC_ALIASES.get(plain.lower(), "")):
        if not name:
            continue
        try:
            res = subprocess.run(
                ["fc-match", "-f", "%{family}|%{file}", f"{name}:style={'Bold' if bold else 'Regular'}"],
                capture_output=True, text=True, timeout=5,
            ).stdout
        except Exception:
            break
        found, _, file = res.partition("|")
        norm = lambda s: re.sub(r"[^a-z]", "", s.lower())
        if file and any(norm(f) == norm(name) for f in found.split(",")):
            path = file
            break
    _fc_cache[key] = path
    return path


def layout_pdf(unit, content, text, bold_terms, fonts_for, scale):
    """Places the words on the unit's lines. Returns [(x, y, chunk, alias, size, synthetic)] or None."""
    style = content[0]
    size = style["size"] * scale
    words = []
    for chunk, bold in bold_segments(text, bold_terms):
        for w in re.findall(r"\S+|\s+", chunk):
            if not w.isspace():
                words.append((w, bold))
            elif words:
                words.append((" ", None))
    # Collapse spaces, keep word-level bold.
    tokens = []
    for w, b in words:
        if b is None:
            if tokens and tokens[-1][0] != " ":
                tokens.append((" ", None))
        else:
            tokens.append((w, b))
    while tokens and tokens[-1][0] == " ":
        tokens.pop()

    slots = unit["slots"]
    placed, si = [], 0
    x = content[0]["origin"][0]
    spaced = False
    for tok, b in tokens:
        if tok == " ":
            alias, font, synth = fonts_for(False).pick(" ")
            x += font.text_length(" ", size)
            spaced = True
            continue
        alias, font, synth = fonts_for(b).pick(tok)
        w = font.text_length(tok, size)
        limit = unit["right"] + 0.5
        if x + w > limit and (placed and placed[-1][1] == slots[si]["y"]):
            si += 1
            if si >= len(slots):
                return None
            x = slots[si]["x"]
        if x + w > limit:
            return None
        # The first word on a line, or one after a space, can move when the line is justified.
        stretch = spaced or not placed or placed[-1][8] != si
        placed.append([x, slots[si]["y"], tok, alias, font, size, synth, w, si, stretch])
        x += w
        spaced = False
    # Justified templates (Google Docs, Word): every line but a paragraph's last ends flush right.
    if unit["justify"]:
        last = placed[-1][8] if placed else 0
        for si in range(last):
            line = [p for p in placed if p[8] == si]
            gaps = sum(p[9] for p in line[1:])
            extra = unit["justify"] - (line[-1][0] + line[-1][7]) if line else 0
            if gaps and 0 < extra < size * 4:
                shift = 0
                for p in line[1:]:
                    shift += extra / gaps if p[9] else 0
                    p[0] += shift
    return placed


def render_pdf(path, plan, out):
    import pymupdf

    doc = pymupdf.open(path)
    units = pdf_units(doc)
    edits, terms = plan.get("edits", {}), plan.get("bold", [])
    applied, skipped, jobs = [], [], []
    for u in units:
        new = edits.get(u["id"])
        if new is None and not (not u["fixed"] and has_term(u["text"], terms)):
            continue
        if u["fixed"]:
            skipped.append({"id": u["id"], "reason": "fixed"})
            continue
        text = re.sub(r"\s+", " ", (new if new is not None else u["text"])).strip()
        if not text:
            skipped.append({"id": u["id"], "reason": "empty"})
            continue
        page = doc[u["_unit"]["page"]]
        span = u["_content"][0]
        cache = {}

        def fonts_for(b, page=page, span=span, cache=cache):
            if b not in cache:
                cache[b] = FontSet(doc, page, span, bool(b))
            return cache[b]

        # The candidate's own bold words stay bold where they still appear.
        unit_terms = terms + u["emphasis"]
        placed = None
        for scale in (1.0, 0.97, 0.94, 0.91, 0.88):
            placed = layout_pdf(u["_unit"], u["_content"], text, unit_terms, fonts_for, scale)
            if placed:
                break
        if not placed:
            skipped.append({"id": u["id"], "reason": "does not fit"})
            continue
        jobs.append((u, page, placed))
        applied.append(u["id"])

    # Remove the old text of every rewritten line (only text: lines, shapes and images stay).
    for u, page, _ in jobs:
        for slot in u["_unit"]["slots"]:
            size = slot["spans"][0]["size"]
            mid = slot["y"] - size * 0.33
            x0 = slot["x"] - 0.5
            if u["label"] and slot is u["_unit"]["slots"][0]:
                x0 = u["_content"][0]["bbox"][0] - 0.3
            page.add_redact_annot(pymupdf.Rect(x0, mid - size * 0.18, slot["x1"] + 0.5, mid + size * 0.18), fill=False)
    for page in doc:
        page.apply_redactions(images=pymupdf.PDF_REDACT_IMAGE_NONE, graphics=pymupdf.PDF_REDACT_LINE_ART_NONE)

    for u, page, placed in jobs:
        c = u["_content"][0]["color"]
        color = ((c >> 16) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255)
        for x, y, tok, alias, font, size, synth, *_ in placed:
            register(page, alias, font)
            page.insert_text(
                (x, y), tok, fontname=alias, fontsize=size, color=color,
                # Faux bold: the regular face with a thin outline in the text colour.
                render_mode=2 if synth else 0, border_width=0.022 if synth else 0.05,
            )

    doc.subset_fonts()
    doc.save(out, garbage=3, deflate=True)
    return {"applied": applied, "skipped": skipped}


# ---- DOCX ----------------------------------------------------------------------------------------

W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"


def docx_paragraphs(document):
    body = document.element.body
    return [p for p in body.iter(W + "p")]


def run_props(r):
    rpr = r.find(W + "rPr")
    if rpr is None:
        return {}
    def on(tag):
        el = rpr.find(W + tag)
        return el is not None and el.get(W + "val") not in ("0", "false")
    return {"b": on("b"), "i": on("i")}


def docx_units(document):
    units, current = [], None
    for p in docx_paragraphs(document):
        runs = [r for r in p.iter(W + "r")]
        text = "".join(t.text or "" for t in p.iter(W + "t"))
        if not text.strip():
            current = None
            continue
        ppr = p.find(W + "pPr")
        style = ""
        is_list = False
        if ppr is not None:
            ps = ppr.find(W + "pStyle")
            style = ps.get(W + "val") if ps is not None else ""
            is_list = ppr.find(W + "numPr") is not None or "list" in style.lower()
        heading = "heading" in style.lower() or style.lower() in ("title", "subtitle")
        complex_ = (
            p.find(".//" + W + "hyperlink") is not None
            or p.find(".//" + W + "fldSimple") is not None
            or p.find(".//" + W + "fldChar") is not None
            or p.find(".//" + W + "r/" + W + "tab") is not None
            or p.find(".//" + W + "r/" + W + "br") is not None
            or p.find(".//" + W + "drawing") is not None
            or any(r.getparent().tag != W + "p" for r in runs)
        )
        slot = {"p": p, "runs": runs, "text": text.strip(), "len": len(text.strip())}
        # A converted resume often has one paragraph per printed line: join a line that carries on the
        # previous one's sentence.
        continues = (
            current is not None
            and not is_list
            and not heading
            and not SENTENCE_END.search(current["slots"][-1]["text"])
            and (text.strip()[:1].islower() or text.strip()[:1] in ",;(" or current["list"])
            and not current["fixed_reason"]
        )
        if continues:
            current["slots"].append(slot)
            if complex_:
                current["fixed_reason"] = "complex"
            continue
        current = {"slots": [slot], "list": is_list, "heading": heading, "fixed_reason": "complex" if complex_ else None}
        units.append(current)

    out = []
    for i, u in enumerate(units):
        runs = [r for s in u["slots"] for r in s["runs"] if "".join(t.text or "" for t in r.iter(W + "t"))]
        props = [run_props(r) for r in runs]
        label = ""
        lead = 0
        first_runs = [r for r in u["slots"][0]["runs"] if "".join(t.text or "" for t in r.iter(W + "t"))]
        acc = ""
        for r in first_runs:
            if not run_props(r)["b"]:
                break
            acc += "".join(t.text or "" for t in r.iter(W + "t"))
            lead += 1
            if acc.strip().endswith(":"):
                label = acc
                break
        else:
            lead = 0
        if not label:
            lead = 0
        content = props[lead:]
        text = " ".join(s["text"] for s in u["slots"])
        if label:
            text = text[len(label.strip()) :].strip()
        fixed = bool(
            u["fixed_reason"]
            or u["heading"]
            or len(text) < MIN_EDITABLE
            or not content
            or all(p["b"] for p in content)
            or any(p["i"] for p in content)
            or re.search(r"https?://|www\.|@\S+\.", text)
        )
        lo, hi = limits(text, int(len(text) * 1.12) + 6)
        emphasis = [
            "".join(t.text or "" for t in r.iter(W + "t")).strip(" ,.;:")
            for r, p in zip(runs[lead:], content)
            if p["b"] and "".join(t.text or "" for t in r.iter(W + "t")).strip(" ,.;:")
        ]
        out.append({"id": f"u{i + 1}", "text": text, "emphasis": emphasis, "label": label.strip(), "fixed": fixed, "min": lo, "max": hi,
                    "_unit": u, "_lead": lead})
    return out


def split_for_slots(text, lengths):
    """Splits text at word boundaries into len(lengths) parts sized like the original paragraphs."""
    if len(lengths) == 1:
        return [text]
    words, parts, total = text.split(" "), [], sum(lengths)
    target, acc, cur = [], 0, []
    for n in lengths[:-1]:
        acc += n
        target.append(acc / total * len(text))
    pos = 0
    for w in words:
        if len(parts) < len(target) and cur and pos + len(w) / 2 > target[len(parts)]:
            parts.append(" ".join(cur))
            cur = []
        cur.append(w)
        pos += len(w) + 1
    parts.append(" ".join(cur))
    while len(parts) < len(lengths):
        parts.append("")
    return parts


def render_docx(path, plan, out):
    import docx
    from docx.oxml.ns import qn

    document = docx.Document(path)
    units = docx_units(document)
    edits, terms = plan.get("edits", {}), plan.get("bold", [])
    applied, skipped = [], []
    for u in units:
        new = edits.get(u["id"])
        if new is None and not (not u["fixed"] and has_term(u["text"], terms)):
            continue
        if u["fixed"]:
            skipped.append({"id": u["id"], "reason": "fixed"})
            continue
        text = re.sub(r"\s+", " ", (new if new is not None else u["text"])).strip()
        if not text:
            skipped.append({"id": u["id"], "reason": "empty"})
            continue
        slots = u["_unit"]["slots"]
        parts = split_for_slots(text, [s["len"] for s in slots])
        for si, (slot, part) in enumerate(zip(slots, parts)):
            runs = [r for r in slot["runs"] if "".join(t.text or "" for t in r.iter(W + "t"))]
            keep = u["_lead"] if si == 0 else 0
            # The first content run's formatting, minus bold, is the template for the new runs.
            template = runs[keep] if keep < len(runs) else (runs[-1] if runs else None)
            rpr = deepcopy(template.find(qn("w:rPr"))) if template is not None and template.find(qn("w:rPr")) is not None else None
            if rpr is not None:
                for tag in ("w:b", "w:bCs"):
                    for el in rpr.findall(qn(tag)):
                        rpr.remove(el)
            anchor = runs[keep - 1] if keep else None
            for r in runs[keep:]:
                r.getparent().remove(r)
            p = slot["p"]
            prefix = " " if keep else ""
            new_runs = []
            for chunk, bold in bold_segments(prefix + part, terms + u["emphasis"]):
                if not chunk:
                    continue
                r = p.makeelement(qn("w:r"), {})
                if rpr is not None or bold:
                    props = deepcopy(rpr) if rpr is not None else p.makeelement(qn("w:rPr"), {})
                    if bold:
                        props.insert(0, p.makeelement(qn("w:bCs"), {}))
                        props.insert(0, p.makeelement(qn("w:b"), {}))
                    r.append(props)
                t = p.makeelement(qn("w:t"), {})
                t.text = chunk
                t.set("{http://www.w3.org/XML/1998/namespace}space", "preserve")
                r.append(t)
                new_runs.append(r)
            if anchor is not None:
                idx = list(p).index(anchor)
                for k, r in enumerate(new_runs):
                    p.insert(idx + 1 + k, r)
            else:
                for r in new_runs:
                    p.append(r)
        applied.append(u["id"])
    document.save(out)
    return {"applied": applied, "skipped": skipped}


# ---- CLI -----------------------------------------------------------------------------------------


def public(units):
    return [{k: v for k, v in u.items() if not k.startswith("_")} for u in units]


def render_cover_letter(letter, out):
    """A plain, ATS-friendly letter: name and contact line, date, then the body."""
    import html
    import pymupdf

    esc = lambda t: html.escape(t or "")
    paras = [p.strip() for p in re.split(r"\n\s*\n", letter.get("body", "")) if p.strip()]
    body = "".join(f"<p>{esc(p).replace(chr(10), '<br>')}</p>" for p in paras)
    contact = " &middot; ".join(esc(c) for c in letter.get("contact", []) if c)
    doc_html = (
        f"<h1>{esc(letter.get('name', ''))}</h1>"
        + (f"<div class='contact'>{contact}</div>" if contact else "")
        + f"<div class='date'>{esc(letter.get('date', ''))}</div>"
        + body
    )
    css = """
      * { font-family: sans-serif; }
      h1 { font-size: 17pt; margin: 0 0 2pt 0; }
      .contact { font-size: 9.5pt; color: #444; margin-bottom: 18pt; }
      .date { font-size: 10pt; margin-bottom: 14pt; }
      p { font-size: 10.5pt; line-height: 1.45; margin: 0 0 9pt 0; text-align: left; }
    """
    story = pymupdf.Story(html=doc_html, user_css=css)
    writer = pymupdf.DocumentWriter(out)
    page = pymupdf.paper_rect("a4")
    where = page + (56, 56, -56, -56)
    more = True
    while more:
        dev = writer.begin_page(page)
        more, _ = story.place(where)
        story.draw(dev)
        writer.end_page()
    writer.close()
    return {"ok": True}


def main():
    cmd, path = sys.argv[1], sys.argv[2]
    if cmd == "coverletter":
        with open(path) as f:
            print(json.dumps(render_cover_letter(json.load(f), sys.argv[3])))
        return
    fmt = sys.argv[3]
    if cmd == "extract":
        if fmt == "pdf":
            import pymupdf

            units = pdf_units(pymupdf.open(path))
        else:
            import docx

            units = docx_units(docx.Document(path))
        print(json.dumps({"units": public(units)}))
    elif cmd == "links":
        if fmt == "pdf":
            import pymupdf

            uris = [link.get("uri") for page in pymupdf.open(path) for link in page.get_links()]
        else:
            import docx

            uris = [r.target_ref for r in docx.Document(path).part.rels.values() if r.is_external]
        print(json.dumps({"links": list(dict.fromkeys(u for u in uris if u and u.startswith("http")))}))
    elif cmd == "render":
        with open(sys.argv[4]) as f:
            plan = json.load(f)
        result = render_pdf(path, plan, sys.argv[5]) if fmt == "pdf" else render_docx(path, plan, sys.argv[5])
        print(json.dumps(result))
    else:
        sys.exit(f"unknown command {cmd}")


if __name__ == "__main__":
    main()
