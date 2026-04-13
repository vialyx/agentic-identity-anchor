# Agentic Identity Anchor

Anchor is a root-of-trust runtime for managing agent fleets across Linux, macOS, and Windows.

It provides:
- A cross-platform device daemon (`anchor-client`) for secure registration, heartbeats, policy fetch, and self-update.
- A serverless AWS control plane (`backend`) for tenant, device, group, and deployment orchestration.
- A React admin panel (`frontend`) for fleet operations.
- A Rust CLI (`anchor-ctl`) for operator workflows.
- Terraform infrastructure (`infra`) for provisioning cloud resources.

## Repository Layout

- [anchor-client](anchor-client) — Rust daemon/runtime agent
- [backend](backend) — TypeScript Lambda handlers + control-plane API logic
- [frontend](frontend) — React + Vite admin dashboard
- [cli](cli) — Rust operator CLI
- [infra](infra) — Terraform modules for API, auth, CDN, messaging, storage
- [docs](docs) — architecture, API spec, data model, flows, security design

## Architecture (High Level)

Anchor is split into three tiers:
1. **Client devices** running the Anchor daemon.
2. **Control plane** on AWS (API Gateway, Lambda, DynamoDB, S3, SQS, KMS, Cognito, CloudWatch).
3. **Admin panel** for operators.

Device routes use mTLS, and admin routes use Cognito JWT auth.

See [docs/architecture.md](docs/architecture.md) for full diagrams.

## Key Capabilities

- mTLS device authentication with certificate thumbprint binding.
- Device registration, policy evaluation, and periodic heartbeat reporting.
- Deployment strategies (`immediate`, `canary`, `scheduled`) with rollback.
- Signed artifact distribution with hash/signature verification before execution.
- Multi-tenant isolation with per-tenant keying and partitioned data model.

## API

Base URL (design target): `https://api.anchor.internal/v1`

Core endpoints include:
- `POST /v1/devices/register`
- `POST /v1/devices/{deviceId}/heartbeat`
- `GET /v1/devices/{deviceId}/policy`
- `GET /v1/agents/{agentId}/download`
- Admin resources: tenants, groups, agents, deployments

Full spec: [docs/api.md](docs/api.md)

## Data Model

Primary DynamoDB tables:
- `anchor-tenants`
- `anchor-devices`
- `anchor-groups`
- `anchor-agent-versions`
- `anchor-deployment-policies`

Details: [docs/data-model.md](docs/data-model.md)

## Prerequisites

- Rust (stable toolchain) and Cargo
- Node.js 20+ and npm
- Terraform 1.6+
- AWS account and credentials for infra/deployment workflows

## Local Development

### 1) Anchor client (Rust)

From [anchor-client](anchor-client):
- Build: `cargo build`
- Test: `cargo test`
- Run: `cargo run -- --help`

### 2) Backend (TypeScript)

From [backend](backend):
- Install: `npm install`
- Build: `npm run build`
- Test: `npm test`
- Lint: `npm run lint`

### 3) Frontend (React)

From [frontend](frontend):
- Install: `npm install`
- Dev server: `npm run dev`
- Build: `npm run build`
- Test: `npm test`

### 4) CLI (Rust)

From [cli](cli):
- Build: `cargo build`
- Run help: `cargo run -- --help`

### 5) Infrastructure (Terraform)

From [infra](infra):
- Initialize: `terraform init`
- Plan: `terraform plan`
- Apply: `terraform apply`

Use [infra/backend.tf.example](infra/backend.tf.example) as a starting point for remote state configuration.

## Documentation Index

- [docs/architecture.md](docs/architecture.md)
- [docs/api.md](docs/api.md)
- [docs/data-model.md](docs/data-model.md)
- [docs/flows.md](docs/flows.md)
- [docs/security.md](docs/security.md)

## Testing

- Rust tests:
	- [anchor-client/tests](anchor-client/tests)
- Backend tests:
	- [backend/tests](backend/tests)
- Frontend tests:
	- via `npm test` in [frontend](frontend)

## License

Apache-2.0 — see [LICENSE](LICENSE)
