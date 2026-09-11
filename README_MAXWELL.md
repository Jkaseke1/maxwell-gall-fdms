# Maxwell Glass FDMS

Maxwell Glass fiscal invoicing and credit-note application for ZIMRA FDMS.

The repository tracks the Maxwell application source, dashboard, sandbox tests,
production registration utility, and deployment documentation. It deliberately
does not track activation keys, private keys, certificates, receipt state, local
audit data, backups, `.env` files, or legacy Rapid Roots material.

## Environments

- Sandbox device: `38293`, serial `TEST-2000945150-B670`
- Production device: `46158`, serial `ZIMRAVD-1737`
- Taxpayer TIN: `2000945150`

Keep sandbox and production data directories and certificates separate. Use the
protected environment files described in `MAXWELL_PRODUCTION_DEPLOYMENT.md`.

## Checks

```powershell
npm ci
npm run test:sandbox
npm run production:verify
npm run production:status
```

The production commands require the local, ignored `.env.maxwell-production` and
the production certificate directory. Never commit those files.
