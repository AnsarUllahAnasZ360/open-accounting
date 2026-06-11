# Vercel Deployment

## Project

- Vercel scope: `ansar-ullah-anas-projects`
- Vercel project: `openbooks`
- Production deployment: `https://openbooks-8mjbirte5-ansar-ullah-anas-projects.vercel.app`
- Stable Vercel URL: `https://openbooks-flax.vercel.app`
- Production custom domain: `https://openbooks.ansarullahanas.com`

## Custom Domain

Requested domain: `openbooks.ansarullahanas.com`.

If the domain is already managed by Vercel, add it through the Vercel project
domain settings. If DNS is external, Vercel will provide the required `A` or
`CNAME` record.

The custom domain is attached to the project. Verify it with:

```bash
vercel domains inspect openbooks.ansarullahanas.com
vercel alias list --scope ansar-ullah-anas-projects
curl -I -L https://openbooks.ansarullahanas.com
```

## Environment Variables

Frontend-safe variables needed in Vercel:

- `NEXT_PUBLIC_CONVEX_URL`

Server-only secrets belong in Convex env because all Plaid, Stripe, Bedrock,
Plunk, and auth signing work runs in Convex functions.

Use Vercel CLI env helpers instead of hand-copying production secrets:

```bash
vercel pull --yes --environment=preview
vercel env run -- pnpm build
```

## Convex Production

- Project: `z360/openbooks`
- Production deployment: `perceptive-guanaco-487`
- Production URL: `https://perceptive-guanaco-487.convex.cloud`
- Production site URL: `https://perceptive-guanaco-487.convex.site`

Backend variables expected in Convex:

- `SITE_URL`
- `JWT_PRIVATE_KEY`
- `JWKS`
- Plaid, Stripe, and AI secrets once those integrations are active
- Optional Plunk request-access notification env: `PLUNK_API_BASE_URL`,
  `PLUNK_SECRET_KEY`, `PLUNK_FROM_EMAIL`, `PLUNK_FROM_NAME`

## Rollback

Previous ready production deployment:

- `https://openbooks-kyfmlvmpo-ansar-ullah-anas-projects.vercel.app`

Rollback command:

```bash
vercel rollback openbooks-kyfmlvmpo-ansar-ullah-anas-projects.vercel.app --scope ansar-ullah-anas-projects
```

## Git Integration Caveat

Manual production deploys are verified for M12. Git deployment wiring should be
confirmed from the Vercel dashboard before public release automation is treated
as complete.
