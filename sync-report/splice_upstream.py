#!/usr/bin/env python3
"""Splice upstream monolith changes (BASE..MAIN of public/app.jsx) into the
verbatim-extracted src/modules files.

Method: each migrated file contains a contiguous verbatim segment of the BASE
monolith (header imports + body + trailing exports). We locate that segment in
BASE, project it through a whole-file difflib mapping BASE->MAIN, and replace
the body with the upstream-updated text. Files whose segment is unchanged are
left untouched.

Usage: python3 sync-report/splice_upstream.py [--apply]
Without --apply, prints the plan only.
"""
import difflib
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE_PATH = "/tmp/BASE_app.jsx"
MAIN_PATH = "/tmp/MAIN_app.jsx"

base = open(BASE_PATH, encoding="utf-8", errors="replace").read().split("\n")
main = open(MAIN_PATH, encoding="utf-8", errors="replace").read().split("\n")

# Index BASE lines for fast contiguous search (line -> positions)
from collections import defaultdict
pos = defaultdict(list)
for i, l in enumerate(base):
    pos[l].append(i)

sm = difflib.SequenceMatcher(None, base, main, autojunk=False)
opcodes = sm.get_opcodes()


def find_segment(body):
    """Find body (list of lines) as contiguous run in BASE. The first line may
    have been dedented during extraction; try raw first, then re-indented."""
    first = body[0]
    candidates = list(pos.get(first, []))
    if not candidates:
        # try re-indenting first line with 8 spaces (monolith style)
        candidates = list(pos.get("        " + first.lstrip(), []))
        if candidates:
            body = ["        " + first.lstrip()] + body[1:]
    for c in candidates:
        seg = base[c:c + len(body)]
        # allow the first line indent variant
        ok = all(a == b or a.lstrip() == b.lstrip() and i == 0
                 for i, (a, b) in enumerate(zip(seg, body)))
        if ok and len(seg) == len(body):
            return c, c + len(body)
    return None


def project(a1, a2):
    """Map BASE range [a1,a2) to MAIN lines using diff opcodes."""
    out = []
    changed = False
    for tag, i1, i2, j1, j2 in opcodes:
        if i2 <= a1 or i1 >= a2:
            # insertions exactly at the range interior boundary
            if tag == "insert" and a1 < i1 < a2:
                out.extend(main[j1:j2])
                changed = True
            continue
        lo, hi = max(i1, a1), min(i2, a2)
        if tag == "equal":
            off = j1 + (lo - i1)
            out.extend(main[off:off + (hi - lo)])
        elif tag == "replace":
            # take full MAIN side once (when we first enter the block)
            if lo == i1 or a1 >= i1:
                out.extend(main[j1:j2])
            changed = True
        elif tag == "delete":
            changed = True
        elif tag == "insert":
            out.extend(main[j1:j2])
            changed = True
    return out, changed


def process(path):
    src = open(path, encoding="utf-8").read().split("\n")
    # body = between header (imports/comments) and trailing 'export {'
    start = None
    in_block = False
    for i, l in enumerate(src):
        s = l.strip()
        if in_block:
            if "*/" in s:
                in_block = False
            continue
        if s.startswith("/*") and "*/" not in s:
            in_block = True
            continue
        if not s or s.startswith(("/*", "//", "import ")):
            continue
        start = i
        break
    if start is None:
        return "empty"
    end = len(src)
    for i in range(len(src) - 1, start, -1):
        if src[i].startswith("export {") or src[i].startswith("export default"):
            end = i
    body = src[start:end]
    # strip trailing blank lines of body
    while body and not body[-1].strip():
        body.pop()
    if not body:
        return "no-body"
    loc = find_segment(body)
    if not loc:
        return "not-verbatim"
    a1, a2 = loc
    new_body, changed = project(a1, a2)
    if not changed and new_body == base[a1:a2]:
        return "unchanged"
    # preserve the dedent of the first line if the src had it dedented
    if body[0] != base[a1] and body[0].lstrip() == base[a1].lstrip():
        if new_body and new_body[0] == base[a1]:
            new_body[0] = body[0]
    new_src = src[:start] + new_body + [""] + src[end:]
    if "--apply" in sys.argv:
        open(path, "w", encoding="utf-8").write("\n".join(new_src))
    delta = len(new_body) - (a2 - a1)
    return f"SPLICED ({a2-a1} -> {len(new_body)} lines, {delta:+d})"


results = {}
for dirpath, _, files in os.walk(os.path.join(ROOT, "src")):
    for f in files:
        if not f.endswith((".jsx", ".js")):
            continue
        p = os.path.join(dirpath, f)
        try:
            r = process(p)
        except Exception as e:
            r = f"ERROR {e}"
        rel = os.path.relpath(p, ROOT)
        results[rel] = r

order = {"SPLICED": 0, "not-verbatim": 1}
for rel, r in sorted(results.items(), key=lambda kv: (0 if kv[1].startswith("SPLICED") else 1, kv[0])):
    if r.startswith("SPLICED") or "--verbose" in sys.argv:
        print(f"{r:40s} {rel}")
print("\nSummary:")
from collections import Counter
c = Counter(v.split(" ")[0] for v in results.values())
for k, v in c.most_common():
    print(f"  {k}: {v}")
