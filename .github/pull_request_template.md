## PR checklist

- [ ] Tests added/updated and `npm test` passes (root + admin-panel)
- [ ] `npm run lint`, `npm run typecheck`, `npm run format:check` pass
- [ ] `npm run build` passes
- [ ] Prisma migration included if the schema changed; `npm run check:schema` passes
- [ ] No secrets, tokens or customer data in code/logs/fixtures
- [ ] UI changes checked at 375 / 768 / 1280 px
- [ ] Docs updated where behaviour changed
