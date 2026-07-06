# Changesets

This folder holds [changesets](https://github.com/changesets/changesets): small
Markdown files that describe user-facing changes and the version bump they imply.

To add one for your change:

```bash
pnpm changeset
```

Pick the bump (patch / minor / major) and write a one-line summary. Commit the
generated file with your PR. On merge to `main`, the Release workflow rolls
pending changesets into a "Version Packages" PR; merging that PR bumps the
version, updates the changelog, and cuts a git tag + GitHub release.

Skip changesets for `chore:`, `docs:`, or `ci:` changes with no user impact.
