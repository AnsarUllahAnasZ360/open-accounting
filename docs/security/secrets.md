# Secrets Handling

This repository must never contain real secrets or private financial data.

## Secret Storage

- Local development: `.env.local` or Vercel env pull output.
- Vercel: project environment variables.
- Convex: Convex deployment environment variables for backend-only secrets.

## Current Secret Classes

- Plunk public and secret keys
- Convex deployment/auth secrets
- Plaid client ID, secrets, access tokens, and item tokens
- Stripe secret keys, restricted keys, webhook secrets, and OAuth tokens
- AI provider keys

## Rotation Note

Any secret pasted into chat, screenshots, logs, or public artifacts should be rotated after bootstrap. Treat chat as a coordination surface, not a permanent secret vault.

