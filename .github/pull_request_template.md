## Summary

<!-- What changes and why. Link the issue or plan (.plans/…) if there is one. -->

## Test evidence

<!-- Commands you ran and their result, or screenshots for UI changes. -->

## Checklist

- [ ] `npm run lint`, `npm run typecheck` and `npm run test` pass
- [ ] `npm run test:integration` / `npm run test:e2e:smoke` run if this touches the database or user flows
- [ ] Docs updated per the "Saat mengubah X, perbarui Y" table in [AGENTS.md](../AGENTS.md), or not needed
- [ ] **Migration?** New Prisma migration added, data model in `docs/DATABASE.md` updated, deploy order noted in `docs/DEPLOYMENT.md` if it is not additive
- [ ] **Env var?** Added to `.env.example` with a comment (`npm run docs:env-check` passes) and set in Vercel/staging
- [ ] **Decision?** An ADR is added in `docs/adr/` if this introduces or reverses an architectural decision
- [ ] **Permissions or security?** `docs/WORKSPACE_RBAC.md` / `SECURITY.md` updated
