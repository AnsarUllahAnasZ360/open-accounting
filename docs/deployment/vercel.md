# Vercel Deployment

## Project

- Vercel team: `z360`
- Vercel project: `ottex-ai-accounting`
- Production URL: `https://ottex-ai-accounting.vercel.app`
- GitHub repository: `https://github.com/AnsarUllahAnasZ360/ottex-ai-accounting`

## Custom Domain

Requested domain: `accounting.zikrainfotech.com`

Vercel is waiting on DNS before it can issue the certificate and finish the alias. Add this record at the DNS provider for `zikrainfotech.com`:

```text
Type: A
Name: accounting
Value: 76.76.21.21
```

After propagation, rerun:

```bash
vercel alias set ottex-ai-accounting.vercel.app accounting.zikrainfotech.com --scope z360
```

## Environment Variables

Vercel has the frontend-safe variables configured for production, preview, and development. Production and preview point to the Convex production deployment:

- `NEXT_PUBLIC_CONVEX_URL`
- `CONVEX_DEPLOYMENT`
- `NEXT_PUBLIC_APP_URL`
- `NEXT_PUBLIC_APP_NAME`
- `NEXT_PUBLIC_PLUNK_PUBLIC_KEY`

Server-only email and auth secrets are stored in Convex, not Vercel.

## Convex Production

- Project: `z360/ottex-ai-accounting`
- Production deployment: `dazzling-deer-524`
- Production URL: `https://dazzling-deer-524.convex.cloud`

Configured production backend variables:

- `SITE_URL`
- `JWT_PRIVATE_KEY`
- `JWKS`
- `PLUNK_API_BASE_URL`
- `PLUNK_SECRET_KEY`
- `PLUNK_FROM_EMAIL`
- `PLUNK_FROM_NAME`

## Git Integration Caveat

The Vercel CLI created and deployed the project successfully, but `vercel git connect` could not attach the GitHub repository to the Vercel team project. This usually means the Vercel GitHub app needs access to the new repository or the team installation needs to be refreshed in the Vercel dashboard. CLI deployments work now; automatic Git deployments should be enabled after that permission is fixed.
