# fix-bug reference

## Common MetroPulse bug categories
1. homepage JS interaction bugs
2. recommendation API validation or response bugs
3. D1 query/data-shape mismatches
4. station detail page rendering issues
5. deployment/config issues

## Debugging principle
Start from the narrowest path:
- entry route
- helper logic
- DB query
- response shaping
- UI rendering

Keep the fix small and explicit.
