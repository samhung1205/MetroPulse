# deploy-app reference

## Current scripts snapshot
Key scripts currently include:
- `npm run build`
- `npm run preview`
- `npm run deploy`
- `npm run deploy:prod`
- local D1 migration / seed / reset scripts

These are already defined in `package.json`, so deployment work should align with them instead of replacing them. fileciteturn3file0

## Wrangler notes
`wrangler.jsonc` defines:
- Pages output directory
- compatibility date
- D1 database binding

When changing deploy flow, make sure build output and DB binding assumptions stay correct.
