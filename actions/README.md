# Actions

Store Custom GPT Action definitions here.

Recommended conventions:

- keep one OpenAPI file per external service or integration surface
- prefer `.yaml` unless JSON is required
- document auth requirements without committing secrets
- keep scopes narrow and endpoints minimal
- separate placeholder specs from production-ready specs when useful

Example files:

- `strava.openapi.yaml`
- `proxy.openapi.yaml`
