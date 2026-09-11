# Maxwell Glass production deployment

This guide is for **MAXWELL GLASS only** (TIN `2000945150`, test device `38293`).
Do not use the older Rapid Roots deployment guides in this repository; they contain
Rapid Roots device and certificate identifiers.

## What is ready

- Invoice and credit-note flows with USD and ZWG support.
- Buyer tax details and address carried into signed submissions and validation records.
- Idempotent retry state: a timeout preserves the exact signed receipt for retry.
- Counter and fiscal-day alignment checks before every submission.
- Automatic close before the configured ZIMRA day limit, followed by reopen only after
  ZIMRA confirms the prior day is closed.
- Local audit archive and verified backup export.
- Rate-limited SMTP/webhook alerts for ZIMRA, API, and maintenance failures.

## Information required from the company server administrator

1. Windows Server hostname or private IP and an administrator account.
2. The application install directory (recommended: `C:\MaxwellFDMS`).
3. Maxwell Glass production device `46158`, serial `ZIMRAVD-1737`, activation key,
   and production certificate/key issued by ZIMRA. The sandbox device `38293` and
   its keys must not be used in production.
4. Confirmation of the production FDMS endpoint and firewall egress to it.
5. SMTP relay details, or a Gmail app password for `kasekejoseph19@gmail.com`.
6. Whether the server should expose the dashboard only on the LAN, and the approved
   HTTPS/reverse-proxy hostname.

## Install

On the server, install Node.js 20 or later, copy this workspace to
`C:\MaxwellFDMS\app`, and run:

```powershell
cd C:\MaxwellFDMS\app
npm ci --omit=dev
Copy-Item .env.maxwell-production.example .env.maxwell-production
```

Edit `.env.maxwell-production` with the production device/certificate and SMTP
values. Keep the file readable only by the service account and administrators.
Create `C:\MaxwellFDMS\data`, `C:\MaxwellFDMS\backups`, and
`C:\MaxwellFDMS\logs` before starting the service.

## Operational checks before go-live

Run the Maxwell-specific status check against the production endpoint and verify:

- `GetConfig` identity matches Maxwell Glass TIN and production device serial.
- ZIMRA reports the fiscal day status and last global receipt number.
- The local receipt state is empty or has been explicitly reconciled to ZIMRA.
- A signed test invoice and a credit note are accepted in the approved production
  cutover procedure.
- A backup can be created and restored to a separate directory with matching hashes.
- An intentional test error produces one email to `kasekejoseph19@gmail.com`.

Do not open a fiscal day or submit a production receipt until the production
certificate and device have been verified. A deployment cannot be completed from
this workstation without the server connection and production credentials.

## Service and monitoring

Run the API under a dedicated Windows service account with automatic restart. Keep
the dashboard behind the approved LAN HTTPS endpoint; do not expose the device API
directly to the internet. Back up the data and audit directories daily, retain the
signed state and logs, and alert on service stopped, ZIMRA request failures, counter
mismatch, pending receipt, validation error, fiscal-day close failure, or backup
failure.

The service's automatic rollover is deliberately conservative: it closes ahead of
the ZIMRA maximum, waits for `FiscalDayClosed`, verifies the day response, then opens
the next day. If a pending receipt or counter mismatch exists, it stops and alerts
instead of guessing or advancing counters.
