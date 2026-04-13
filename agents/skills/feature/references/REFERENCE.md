# continue-feature reference

## Current MetroPulse architecture snapshot
- Entry point: `src/index.ts`
- API routes live under `src/routes/`
- Core logic utilities live under `src/lib/`
- DB query layer lives in `src/db/queries.ts`
- Deploy/build scripts are defined in `package.json`
- Cloudflare config is in `wrangler.jsonc`

## Common task examples
- Improve homepage interaction in `src/index.ts`
- Add or adjust recommendation output from `src/routes/recommend.ts`
- Extend station details in `src/routes/station-detail.ts`
- Improve normalization or helper logic in `src/lib/`

## Working principle
MetroPulse is already demo-capable. Continue features by extending what exists, not by introducing a new framework.
