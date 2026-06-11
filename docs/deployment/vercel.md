# Vercel Deployment

## Project

- Vercel account observed locally: `ansar-8590`
- Local project link: not present yet (`.vercel/project.json` is missing)
- Intended Vercel project: `openbooks` (confirm before deploy)
- Intended production domain: `https://openbooks.ansarullahanas.com`
- GitHub repository: confirm before public release

## Custom Domain

Requested domain: `openbooks.ansarullahanas.com`.

If the domain is already managed by Vercel, add it through the Vercel project
domain settings. If DNS is external, Vercel will provide the required `A` or
`CNAME` record.

After the project is linked, use:

```bash
vercel domains inspect openbooks.ansarullahanas.com
vercel alias set <deployment-url> openbooks.ansarullahanas.com
```

## Environment Variables

Frontend-safe variables needed in Vercel:

- `NEXT_PUBLIC_CONVEX_URL`
- `NEXT_PUBLIC_APP_URL`
- `NEXT_PUBLIC_APP_NAME`
- `NEXT_PUBLIC_PLUNK_PUBLIC_KEY` only if Plunk client-side capture is used

Server-only secrets belong in Convex env or Vercel env depending on runtime. Do
not duplicate secrets in both places unless both runtimes need them.

Use Vercel CLI env helpers instead of hand-copying production secrets:

```bash
vercel pull --yes --environment=preview
vercel env run -- pnpm build
```

## Convex Production

- Project: confirm/create during initiation
- Production deployment: confirm/create during initiation
- Production URL: confirm/create during initiation

Backend variables expected in Convex:

- `SITE_URL`
- `JWT_PRIVATE_KEY`
- `JWKS`
- `PLUNK_API_BASE_URL`
- `PLUNK_SECRET_KEY`
- `PLUNK_FROM_EMAIL`
- `PLUNK_FROM_NAME`
- Plaid, Stripe, and AI secrets once those integrations are active

## Git Integration Caveat

The local repo is not currently linked to a Vercel project. After the project and
repository are final, link the project locally and enable Git deployments from
the Vercel dashboard.
