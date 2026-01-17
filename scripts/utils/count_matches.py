#!/usr/bin/env python3
import json
from collections import Counter
from pathlib import Path

input_path = Path(__file__).resolve().parents[2] / 'temp' / 't.json'
output_path = Path(__file__).resolve().parents[2] / 'temp' / 'match_counts.json'

if not input_path.exists():
    print(f'Input file not found: {input_path}')
    raise SystemExit(2)

with input_path.open('r', encoding='utf-8') as f:
    data = json.load(f)

counter = Counter()
for sample in data.get('samples', []):
    for m in sample.get('matches', []):
        key = str(m.get('match'))
        counter[key] += 1

sorted_items = sorted(counter.items(), key=lambda x: (-x[1], x[0]))

# Print
print('count  match')
for k, v in sorted_items:
    print(f'{v:5d}  {k}')

# Write JSON
with output_path.open('w', encoding='utf-8') as f:
    json.dump([{'match': k, 'count': v} for k, v in sorted_items], f, ensure_ascii=False, indent=2)

print(f'\nWrote {len(sorted_items)} items to {output_path}')

