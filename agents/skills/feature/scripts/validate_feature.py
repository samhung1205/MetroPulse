#!/usr/bin/env python3
from pathlib import Path

REQUIRED = [
    'src/index.ts',
    'src/routes/recommend.ts',
    'src/db/queries.ts',
    'package.json',
    'wrangler.jsonc',
]

missing = [p for p in REQUIRED if not Path(p).exists()]
if missing:
    print('Missing expected project files:')
    for m in missing:
        print('-', m)
    raise SystemExit(1)

print('Basic MetroPulse feature validation passed.')
