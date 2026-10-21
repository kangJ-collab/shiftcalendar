"""Rebuild the offline 2026 table from the official PDF (requires pdfplumber).

Usage: python scripts/build_income_tax_table.py /path/to/official-table.pdf
Source: https://www.law.go.kr/LSW/flDownload.do?bylClsCd=110201&flSeq=161861245&gubun=
"""
import argparse
import hashlib
import json
import re
from pathlib import Path

import pdfplumber


def build(pdf_path):
    rows = []
    at_ten_million = None
    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages[1:]:
            for line in page.extract_text().splitlines():
                tokens = line.split()
                if len(tokens) == 13 and all(re.fullmatch(r'[\d,]+|-', token) for token in tokens):
                    row = [0 if token == '-' else int(token.replace(',', '')) for token in tokens]
                    if 770 <= row[0] < row[1] <= 10000:
                        rows.append(row)
                elif tokens and tokens[0].startswith('10,000') and len(tokens) == 12:
                    at_ten_million = [int(token.replace(',', '')) for token in tokens[1:]]

    assert len(rows) == 646, 'Unexpected bracket count; review the source PDF.'
    assert rows[0][:2] == [770, 775] and rows[-1][:2] == [9980, 10000]
    assert all(a[1] == b[0] for a, b in zip(rows, rows[1:])), 'Missing or overlapping bracket.'
    assert all(len(row) == 13 for row in rows)
    assert at_ten_million == [1507400, 1431570, 1200840, 1170840, 1140840, 1110840,
                              1080840, 1050840, 1020840, 990840, 960840]
    metadata = {
        'version': '2026-02-27',
        'source': 'https://www.law.go.kr/LSW/flDownload.do?bylClsCd=110201&flSeq=161861245&gubun=',
        'sourceSha256': hashlib.sha256(pdf_path.read_bytes()).hexdigest(),
        'atTenMillion': at_ten_million,
    }
    compact = lambda value: json.dumps(value, ensure_ascii=False, separators=(',', ':'))
    prefix = compact(metadata)[:-1]
    row_source = ',\n'.join('    ' + compact(row) for row in rows)
    output = (
        '// 소득세법 시행령 별표 2 (2026. 2. 27. 개정). 급여구간 단위: 천원, 세액: 원.\n'
        '// Rebuild with scripts/build_income_tax_table.py and the official source PDF.\n'
        '// Rows are [lower, upper, tax for 1..11 family members].\n'
        '(function(root){\n  const table=' + prefix + ',"rows":[\n' + row_source + '\n  ]};\n'
        "  if(typeof module==='object'&&module.exports){module.exports=table;}\n"
        '  else{root.ShiftIncomeTaxTable=table;}\n})(globalThis);\n'
    )
    target = Path(__file__).resolve().parents[1] / 'data/income-tax-2026.js'
    target.write_text(output, encoding='utf-8')
    print(f'Generated {len(rows)} contiguous brackets: {target.name}')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('pdf', type=Path)
    build(parser.parse_args().pdf)
