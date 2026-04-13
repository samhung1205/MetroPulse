#!/usr/bin/env python3
from pathlib import Path
import json

required = ['package.json', 'wrangler.jsonc', 'src/index.ts']
missing = [f for f in required if not Path(f).exists()]
if missing:
    print('Missing required files:', ', '.join(missing))
    raise SystemExit(1)

pkg = json.loads(Path('package.json').read_text(encoding='utf-8'))
scripts = pkg.get('scripts', {})
for key in ['build', 'deploy']:
    if key not in scripts:
        print(f'Missing npm script: {key}')
        raise SystemExit(1)

print('Deployment validation passed.')
