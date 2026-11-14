# Gulnara - Flowers, with feeling

**[Demo](https://aka.ms/gulnara-demo) | [Live website](https://aka.ms/gulnara)**

The demo video may require Microsoft 365 sign-in and permission. Repository
visibility does not change video-sharing access.

Gulnara is a floral studio website built using the **Azure SQL Database
container** for local development, with React, Vite, TypeScript, npm workspaces,
and Data API Builder (DAB). The default full-stack architecture connects the
React frontend through a same-origin Node proxy and DAB to Azure SQL.
The optional AI demonstration combines Azure OpenAI embeddings with native
Azure SQL vector search and DiskANN.

The site includes an editorial collection, rules-based bouquet inspiration,
and an authenticated booking contract.

Sharing this repository does not redeploy or connect to that site's resources.
Catalog compositions and prices are illustrative, not verified inventory.

## Quick start: frontend-only design preview

Use Node **22.22.2 or newer** and npm. **Package access is a prerequisite:**
the preserved dependency pins include versions not currently available from
public npm (for example React 19.3.1 and mssql 12.7.13), and the lockfile contains
organization-feed URLs. Obtain authorized access to a package registry that
provides these exact versions before running `npm ci`. The source was built
using the owner's configured registry; a plain public-npm install is not verified
and currently fails. Registry credentials/configuration are not included.
Configure any required authentication privately using your organization's
approved process, not by committing tokens or sharing the owner's credentials.

Clone this public repository into a new directory; no collaborator invitation
is required to read or clone it:

```powershell
git clone https://github.com/vamahtani/gulnara.git
Set-Location gulnara
npm ci
npm run build
npm run preview:design
```

Open <http://127.0.0.1:5180/>. Stop the preview with Ctrl+C.
Once dependency installation succeeds, this runs the maintained production frontend without Docker, Azure sign-in,
database access, or model calls. Missing identity/API configuration is reported
by the application; booking and semantic search are not connected. The preview
does not provide mock persistence or access to the owner's live database.
Collection browsing and offline bouquet inspiration remain available.

```powershell
# Build first: backend tests import compiled output.
npm test
```

## Optional full local stack

The default profile in `deployment.json` is `container-apps` / `dab`:
React frontend -> same-origin Node proxy -> DAB -> Azure SQL.
Full local operation additionally requires:

- Docker with Linux containers and authorized, cached SQL/DAB images matching
  the immutable references in `baseline.json` and `compose.sql.yml`.
- Access to the **Azure SQL Database private-preview** container distribution
  and acceptance of its terms. Ordinary SQL Server is not a drop-in replacement:
  this app checks EngineEdition 5 and uses native vector features.
- Approved external OIDC SPA/API registrations with a tenant-bound API-token
  issuer/audience, delegated scope, and the ownership `oid` claim.

For a fresh clone, copy `.env.example` to `.env` and replace the identity
placeholders. Never overwrite an existing application's credentials.
Set `ACCEPT_EULA=Y` only after reviewing and accepting the SQL terms.
If changing ports, also change the matching origins and registered redirect URI.

```powershell
Copy-Item .env.example .env
# Edit .env with your own approved identity configuration and SQL terms decision.
npm run local:init
npm run local:preflight
npm run build
npm run local:start
```

`local:init` generates isolated local credentials and a Compose project name;
it does not start containers. `local:preflight` checks tools, cached images and
configuration without pulling images. `local:start` starts the local stack and
applies numbered SQL migrations; run it only against your own fresh isolated
environment. It does not configure identity registrations or real inventory.
The web port defaults to 5180 and DAB to 5081, both on loopback.
Stop the design preview before starting the full stack on the same port.

Use `npm run local:status` for readiness and `npm run local:stop` to stop owned
services while retaining the database volume. Preserve `.env` for that volume.
SQL has no published host port unless you explicitly configure `SQL_PORT`.
Operator acceptance commands perform real database writes and require a
separately reviewed isolated target and synthetic data.

## Optional AI demonstration

AI search requires separately authorized Azure OpenAI access, compatible SQL,
seeded embeddings, a usable native DiskANN index, and spending approvals.
No real embeddings, usage ledgers, local caches, cloud credentials, or existing
database content are included. A fresh clone is **not** an inference-ready copy.
Do not assume an existing demo allowance or regenerate embeddings automatically.

`.env.demo.example` is an operator-only configuration outline, not permission to
use anyone else's resources. `scripts/vector-demo.mjs` contains guarded operator
commands that may retrieve credentials, incur model charges or alter SQL.
Review the command and target before running any `demo:ai` operation.
The public API retains explicit allowlists for the existing deployment, and the
operator CLI accepts specific database names; these are intentional source
guards, not portable configuration or credentials. A new hosted target needs a
separately reviewed adaptation. Do not bypass guards to point at shared resources.

## Repository layout

| Path | Purpose |
| --- | --- |
| `packages/frontend` | Maintained UI, local artwork, licensed stock images and UI tests |
| `packages/server` | Same-origin web/API proxy |
| `packages/public-api` | Deployment-bound public semantic-search service |
| `packages/shared` | Shared TypeScript contracts |
| `packages/data` | DAB configuration, synthetic study definitions, migrations and SQL fixtures |
| `scripts` | Local lifecycle, guarded operator utilities and deployment planning |
| `tests` | Regression tests and synthetic fixtures |
| `infra` | Bicep templates and SQL identity bootstrap |

See [app-brief.md](app-brief.md) for the product contract,
[deployment.md](deployment.md) for deployment prerequisites, and
[deployment-migrations.md](deployment-migrations.md) for forward-only migration
guidance. Infrastructure is not a ready-to-run cloud deployment.

## Clean handoff and assets

This repository started from a clean source snapshot. It excludes real `.env`
files, secrets,
database exports/backups, local data, caches, AI usage receipts, deployment
artifacts/history, personal/internal notes, dependencies, logs, ZIP archives and
generated build output. Frozen compiled design comparisons are also excluded:
the legacy "Compare the untouched original" link in the unchanged UI does not
have its archived page in this source handoff. The maintained root UI is included.

Pexels flower photographs are self-hosted in `packages/frontend/public/flowers`.
Photographer credits, original source links and the
[Pexels license](https://www.pexels.com/license/) are preserved in
`packages/frontend/src/FlowerPhotography.tsx` and displayed in the site's
photography-credit footer. These are representative stock images, not
photographs of available Gulnara inventory. Local editorial artwork and SVGs are
retained. Do not remove asset attribution or imply endorsement by photographers.
Public visibility does not grant a blanket open-source license;
confirm rights before redistributing the application or its assets.

Keep credentials outside Git. Only placeholder configuration examples belong
in the repository. Never commit credentials, including in private forks.
