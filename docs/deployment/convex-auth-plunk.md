# Convex Auth and Request-Access Email

OpenBooks v1 uses Convex Auth with the password provider only. Magic-link auth
is intentionally not enabled in this slice, so Plunk is used only for optional
request-access notifications.

## Required Convex Production Environment Variables

- `OWNER_EMAIL`: the only public first-account email allowed by the invite gate.
- `OWNER_PASSWORD`: local/operator credential source for scripted smoke tests.
- `JWT_PRIVATE_KEY`: generated Convex Auth token signing private key.
- `JWKS`: generated public key set paired with `JWT_PRIVATE_KEY`.
- `SITE_URL`: public app URL, usually `https://openbooks.ansarullahanas.com`.

## Optional Request-Access Email Variables

- `PLUNK_API_BASE_URL`: defaults to `https://api.plunk.zikrainfotech.com`.
- `PLUNK_SECRET_KEY`: server-only Plunk secret key.
- `PLUNK_FROM_EMAIL`: verified sender email address.
- `PLUNK_FROM_NAME`: optional sender display name.

If Plunk variables are absent, request-access leads are still saved in Convex
and the app remains usable.

## Vercel Environment Variables

Vercel should only receive frontend-safe values for this slice:

- `NEXT_PUBLIC_CONVEX_URL`

Server secrets belong in Convex production env because all external API calls
run in Convex actions.

## Rollback

Current M12 production deployment:

- `https://openbooks-8mjbirte5-ansar-ullah-anas-projects.vercel.app`
- Stable alias: `https://openbooks-flax.vercel.app`
- Custom domain: `https://openbooks.ansarullahanas.com`

Previous ready production deployment for rollback:

- `https://openbooks-kyfmlvmpo-ansar-ullah-anas-projects.vercel.app`

Rollback command:

```bash
vercel rollback openbooks-kyfmlvmpo-ansar-ullah-anas-projects.vercel.app --scope ansar-ullah-anas-projects
```
