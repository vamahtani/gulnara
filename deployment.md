# Deployment prerequisites

This repository is a source handoff, not permission to modify the existing
website, SQL database, identity configuration or Azure OpenAI resource.
No production secrets, deployment receipts or private session history are
included. Use a separately approved environment owned by your team.

## Default architecture

`deployment.json` selects `container-apps` with DAB. The maintained infrastructure
in `infra/main.bicep` describes a web/proxy container, internal DAB service,
Azure SQL and managed-identity access. Local image builds use `Dockerfile.web`
and `Dockerfile.dab`. Full local SQL requires the authorized Azure SQL
private-preview distribution pinned in `baseline.json`; ordinary SQL Server is
not an equivalent target.

`infra/pilot-subscription.bicep` is a subscription-scope wrapper and
`infra/main.bicepparam` is an incomplete example for `main.bicep`, not a complete
parameter file for the wrapper. Existing names in templates are example defaults,
not authorized deployment targets. Supply isolated names, your own session tag,
approved OIDC values, SQL administrator identity, immutable image digests,
network policy, registry access and ownership tags before any deployment.

The pilot wrapper and example parameter file disable server/database/application
gates. The legacy `main.bicep` itself defaults the server/database gates to true;
do not deploy it directly relying on safe wrapper defaults. Review staged
authorization, actual service availability, quotas, security controls, SQL plan,
backups and current cost estimates before enabling them.
Do not disable Defender or open broad network access merely to make setup pass.

## Planning is not deployment

`npm run deployment:prepare` validates the selected profile and DAB configuration.
The planning/execution modules model approvals and receipts; they are not a
complete Azure CLI cloud deployment adapter. Alternative hosting profiles named
in code require files/adapters not included in this default source snapshot.
Changing the profile alone does not install those implementations.

For an authorized new target, the operator must independently review and execute
infrastructure provisioning, image publication, OIDC configuration, managed
identity grants, network access and SQL bootstrap. See
[deployment-migrations.md](deployment-migrations.md) for checksummed forward-only
migrations. Configure secrets via an approved secret store, never repository
files or browser configuration.

The optional public semantic-search API contains allowlists for the existing
hosted deployment. It cannot be moved to a different account by filling in
example environment values alone. Review any adaptation and its spending,
origin, readiness and database permissions separately.

## Acceptance and recovery

Before enabling live behavior, verify real sign-in, correct API audience/issuer,
per-user ownership, restricted runtime permissions, inventory concurrency,
idempotent retries, persisted reload and forbidden direct table access.
AI acceptance additionally requires real stored embeddings, a working native
vector index and preserved cumulative request/token accounting.

Use approved synthetic inputs on an isolated target. Operator acceptance and
migration commands perform real SQL operations; do not replay them on a shared
database without approval. Preserve applied migrations, credentials, data and
usage ledgers during upgrades or recovery. There is no bundled down-migration
or database restore procedure.
