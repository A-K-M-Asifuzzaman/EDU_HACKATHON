"""Minimal, dependency-free PDF 1.4 writer for the dispatch briefs: text, rules and filled rectangles on A4 pages, the two standard
Helvetica fonts (WinAnsiEncoding, no embedding), uncompressed content streams and no creation date, so the same input always gives the
same bytes. Characters outside Latin-1 are transliterated or replaced; Bangla text belongs in the HTML brief (the standard PDF fonts
have no Bengali glyphs)."""
from __future__ import annotations

import hashlib
import textwrap

A4 = (595.0, 842.0)
_W = {  # Adobe AFM widths (per 1000 em) for ASCII 32..126: Helvetica, Helvetica-Bold
    False: [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278] + [556] * 10 + [278, 278, 584, 584, 584, 556, 1015,
            667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611,
            278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278,
            556, 500, 722, 500, 500, 500, 334, 260, 334, 584],
    True: [278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278] + [556] * 10 + [333, 333, 584, 584, 584, 611, 975,
           722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611,
           333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333,
           611, 556, 778, 556, 556, 500, 389, 280, 389, 584],
}
_SUB = {"→": "->", "←": "<-", "–": "-", "—": "-", "−": "-", "‘": "'", "’": "'", "“": '"', "”": '"',
        "…": "...", "≈": "~", "≤": "<=", "≥": ">=", " ": " ", "•": "-"}


def latin(s: str) -> str:
    s = "".join(_SUB.get(c, c) for c in str(s))
    return "".join(c if ord(c) < 256 else "?" for c in s)


def width(s: str, size: float, bold: bool = False) -> float:
    w = _W[bold]
    return sum(w[ord(c) - 32] if 32 <= ord(c) <= 126 else 556 for c in latin(s)) * size / 1000.0


def wrap(s: str, size: float, max_w: float, bold: bool = False) -> list[str]:
    out = []
    for para in latin(s).split("\n"):
        line = ""
        for word in para.split(" "):
            trial = (line + " " + word).strip()
            if width(trial, size, bold) <= max_w or not line:
                line = trial
            else:
                out.append(line)
                line = word
        out.append(line)
    return out


def _esc(s: str) -> str:
    return latin(s).replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


class Page:
    def __init__(self):
        self.ops: list[str] = []

    def text(self, x, y, s, size=10, bold=False, rgb=(0.10, 0.08, 0.22)):
        self.ops.append(f"BT {rgb[0]:.3f} {rgb[1]:.3f} {rgb[2]:.3f} rg /F{2 if bold else 1} {size:g} Tf {x:.2f} {y:.2f} Td ({_esc(s)}) Tj ET")

    def rect(self, x, y, w, h, rgb):
        self.ops.append(f"{rgb[0]:.3f} {rgb[1]:.3f} {rgb[2]:.3f} rg {x:.2f} {y:.2f} {w:.2f} {h:.2f} re f")

    def line(self, x1, y1, x2, y2, w=0.6, gray=0.80):
        self.ops.append(f"{gray:.3f} G {w:g} w {x1:.2f} {y1:.2f} m {x2:.2f} {y2:.2f} l S")


class Document:
    def __init__(self, title: str):
        self.title, self.pages = title, []

    def page(self) -> Page:
        p = Page()
        self.pages.append(p)
        return p

    def render(self) -> bytes:
        objs: list[bytes] = []
        n_pages = len(self.pages)
        kids = " ".join(f"{6 + 2 * i} 0 R" for i in range(n_pages))
        objs.append(b"<< /Type /Catalog /Pages 2 0 R >>")
        objs.append(f"<< /Type /Pages /Kids [{kids}] /Count {n_pages} >>".encode())
        objs.append(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>")
        objs.append(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>")
        objs.append(f"<< /Title ({_esc(self.title)}) /Producer (DengueShield dispatch) >>".encode("latin-1"))
        for i, p in enumerate(self.pages):
            stream = "\n".join(p.ops).encode("latin-1")
            objs.append(f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {A4[0]:g} {A4[1]:g}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> "
                        f"/Contents {7 + 2 * i} 0 R >>".encode())
            objs.append(b"<< /Length " + str(len(stream)).encode() + b" >>\nstream\n" + stream + b"\nendstream")
        out = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
        offsets = []
        for i, body in enumerate(objs, 1):
            offsets.append(len(out))
            out += f"{i} 0 obj\n".encode() + body + b"\nendobj\n"
        xref = len(out)
        doc_id = hashlib.sha256(bytes(out)).hexdigest()[:32]
        out += f"xref\n0 {len(objs) + 1}\n0000000000 65535 f \n".encode()
        out += b"".join(f"{o:010d} 00000 n \n".encode() for o in offsets)
        out += f"trailer\n<< /Size {len(objs) + 1} /Root 1 0 R /Info 5 0 R /ID [<{doc_id}> <{doc_id}>] >>\nstartxref\n{xref}\n%%EOF\n".encode()
        return bytes(out)


class Flow:
    """Top-to-bottom layout on A4 pages with automatic page breaks."""
    M = 44.0

    def __init__(self, doc: Document, footer: str):
        self.doc, self.footer, self.p, self.y = doc, footer, None, 0.0
        self.new_page()

    def new_page(self):
        self.p = self.doc.page()
        self.y = A4[1] - self.M
        self.p.line(self.M, 30, A4[0] - self.M, 30, 0.5)
        self.p.text(self.M, 18, self.footer, 7, rgb=(0.37, 0.34, 0.50))

    def need(self, h: float):
        if self.y - h < 44:
            self.new_page()

    def band(self, title: str, sub: str):
        self.p.rect(0, A4[1] - 74, A4[0], 74, (0.29, 0.17, 0.82))
        self.p.text(self.M, A4[1] - 38, title, 17, True, (1, 1, 1))
        self.p.text(self.M, A4[1] - 58, sub, 9.5, False, (0.93, 0.91, 1))
        self.y = A4[1] - 96

    def heading(self, s: str):
        self.need(30)
        self.y -= 8
        self.p.text(self.M, self.y, s, 11.5, True)
        self.y -= 6
        self.p.line(self.M, self.y, A4[0] - self.M, self.y, 0.7, 0.75)
        self.y -= 13

    def para(self, s: str, size=9.0, bold=False, rgb=(0.10, 0.08, 0.22), indent=0.0):
        for ln in wrap(s, size, A4[0] - 2 * self.M - indent, bold):
            self.need(size + 4)
            self.p.text(self.M + indent, self.y, ln, size, bold, rgb)
            self.y -= size + 3.5

    def kv(self, rows: list[tuple[str, str]], size=9.0, key_w=170.0):
        for k, v in rows:
            lines = wrap(v, size, A4[0] - 2 * self.M - key_w)
            self.need((size + 3.5) * len(lines))
            self.p.text(self.M, self.y, k, size, True, (0.37, 0.34, 0.50))
            for ln in lines:
                self.p.text(self.M + key_w, self.y, ln, size)
                self.y -= size + 3.5

    def table(self, head: list[str], rows: list[list[str]], widths: list[float], size=8.5, right: set[int] | None = None, mark=None):
        right = right or set()
        x0 = [self.M + sum(widths[:i]) for i in range(len(widths))]

        def row(cells, bold=False, rgb=(0.10, 0.08, 0.22)):
            self.need(size + 6)
            for i, c in enumerate(cells):
                c = latin(c)
                while width(c, size, bold) > widths[i] - 4 and len(c) > 1:
                    c = c[:-2] + "."
                x = x0[i] + widths[i] - 4 - width(c, size, bold) if i in right else x0[i]
                self.p.text(x, self.y, c, size, bold, rgb)
            self.y -= size + 3
            self.p.line(self.M, self.y + 1, self.M + sum(widths), self.y + 1, 0.3, 0.88)
            self.y -= 3

        row(head, True, (0.37, 0.34, 0.50))
        for r in rows:
            row(r, False, (0.56, 0.11, 0.15) if mark and mark(r) else (0.10, 0.08, 0.22))


def lines(s: str, n: int) -> list[str]:
    return textwrap.wrap(latin(s), n)
