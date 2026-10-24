import json
import sys

import pymupdf

doc = pymupdf.open(sys.argv[1])
pages = []
for index, page in enumerate(doc):
    height = page.rect.height
    items = []
    for block in page.get_text('dict')['blocks']:
        if block.get('type') != 0:
            continue
        for line in block.get('lines', []):
            for span in line.get('spans', []):
                text = span.get('text') or ''
                if not text.strip():
                    continue
                x0, y0, x1, y1 = span['bbox']
                items.append({
                    'str': text,
                    'x': x0,
                    'y': height - y1,
                    'width': x1 - x0
                })
    pages.append({'pageNumber': index + 1, 'items': items})
json.dump(pages, sys.stdout)
