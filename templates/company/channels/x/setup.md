---
id: x
kind: x
identity_owner: "(fill: the human who owns this account — agents operate, never own)"
credential_ref: null
acceptance:
  - text
capabilities:
  - push
cadence:
  max_per_day: 3
driver_ref: x
readiness: null
---

# X (Twitter) channel

The bundled `drivers.x` mapping in the human-owned `.cronfounder/config.json`
starts `node dist/x-mcp.js` over stdio and maps `push` to `create_post`. A
model can draft this setup file, but it can never change that executable
mapping. See docs/commands.md#drivers.

## setup

1. Create a Project and developer app at developer.x.com. New apps use
   pay-per-use pricing; add credits and set a spending cap.
2. Set the app permissions to **Read and write before generating tokens**.
3. Generate the API key + secret, access token + secret, and app-only bearer
   token. If permissions changed, regenerate the access token and secret.
4. Put these names in `.cronfounder/env` (never in this file):

   ```sh
   export X_API_KEY=...
   export X_API_KEY_SECRET=...
   export X_ACCESS_TOKEN=...
   export X_ACCESS_TOKEN_SECRET=...
   export X_BEARER_TOKEN=...
   ```

5. Run `cronfounder doctor` from the company directory.

Conformance: the channel driver implements `push`. Post metrics are reads of
reality, so they use the `x_post_metrics` sensor below instead of `pull`:

```yaml
sensor:
  type: x_post_metrics
  content: C-YYYYMMDD-your-post
  field: impression_count
  credential_ref: X_BEARER_TOKEN
```

Warning: X currently charges **$0.20 per post containing a URL**, versus
$0.015 for plain text. Owned metric reads are $0.001 and repeated reads of
the same post within 24 hours are deduplicated for billing.
