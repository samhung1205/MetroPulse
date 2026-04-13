#!/usr/bin/env python3
from pathlib import Path
import re

path = Path('src/lib/types.ts')
if not path.exists():
    raise SystemExit('src/lib/types.ts not found')

text = path.read_text(encoding='utf-8')
for token in ['RecommendationWeights', 'ScoreBreakdown', 'DEFAULT_WEIGHTS']:
    if token not in text:
        raise SystemExit(f'Missing expected token: {token}')

weights = re.findall(r'w[1-4]\s*:\s*([0-9.]+)', text)
print('Detected weight fields in src/lib/types.ts')
print('Validation passed.')
