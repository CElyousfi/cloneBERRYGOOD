import os
import re

PROJ = "."
app_jsx_path = os.path.join(PROJ, "public", "app.jsx")

with open(app_jsx_path, 'r', encoding='utf-8') as f:
    ALL_LINES = f.readlines()

def get_lines(ranges):
    content = ""
    for start, end in ranges:
        content += "".join(ALL_LINES[start-1:end])
    return content

def process_content(content):
    func_pattern = re.compile(r'^[ \t]*function\s+([A-Za-z0-9_]+)\s*\(', re.MULTILINE)
    const_pattern = re.compile(r'^[ \t]*(?:const|let|var)\s+([A-Za-z0-9_]+)\s*(?:=|;)', re.MULTILINE)

    funcs = func_pattern.findall(content)
    consts = const_pattern.findall(content)
    
    exports = list(set(funcs + consts))
    
    # filter out empty names or reserved words if any
    export_stmt = "\nexport {\n" + ",\n".join(f"  {e}" for e in exports if e) + "\n};\n"
    return content + export_stmt

def save_file(rel_path, content, is_jsx=True):
    path = os.path.join(PROJ, rel_path)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    header = """// @ts-check
/**
 * Extracted feature module
 * Compiled by Vite (src/) as ES modules.
 * // TODO: import from @shared when Step 5 runs
 */
"""
    if is_jsx:
        header += "import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';\n\n"
    
    final_content = header + process_content(content)
    with open(path, 'w', encoding='utf-8') as f:
        f.write(final_content)

save_file("src/features/shared/config.js", get_lines([(412, 812)]), is_jsx=False)

qualite_ranges = [
    (14264, 14472), (14473, 15513), (15514, 16428), (16429, 17291), 
    (17292, 17738), (17739, 18081), (18082, 19904), (19905, 20062), 
    (20168, 20384), (20828, 21521), (21522, 22169), (22192, 24092), (24093, 24579)
]
save_file("src/features/qualite/index.jsx", get_lines(qualite_ranges), is_jsx=True)

rh_ranges = [(5740, 7304), (8677, 10069), (10070, 10746), (26654, 27452), (27453, 28835)]
save_file("src/features/rh/index.jsx", get_lines(rh_ranges), is_jsx=True)

finance_ranges = [(33977, 36224), (37214, 37618), (37619, 37724), (37725, 39388), (47958, 48499)]
save_file("src/features/finance/index.jsx", get_lines(finance_ranges), is_jsx=True)

print("Files created successfully.")
