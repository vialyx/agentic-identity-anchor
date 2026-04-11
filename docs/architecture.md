# Anchor Root-of-Trust Runtime — Architecture

## 1. High-Level System Overview

Anchor is a three-tier system: **Client** (managed devices running the Anchor agent), **Control Plane** (AWS-hosted serverless backend), and **Admin Panel** (operator web UI). Every communication crossing a tier boundary is mutually authenticated (mTLS) and encrypted.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  TIER 1 — CLIENT DEVICES (Edge)                                             │
│                                                                             │
│  ┌──────────────────────────────┐   ┌──────────────────────────────┐        │
│  │  Managed Device A            │   │  Managed Device B            │        │
│  │  ┌────────────────────────┐  │   │  ┌────────────────────────┐  │        │
│  │  │  Anchor Agent (binary) │  │   │  │  Anchor Agent (binary) │  │        │
│  │  │  - Self-update logic   │  │   │  │  - Self-update logic   │  │        │
│  │  │  - Policy enforcement  │  │   │  │  - Policy enforcement  │  │        │
│  │  │  - Health reporting    │  │   │  │  - Health reporting    │  │        │
│  │  │  - mTLS client cert    │  │   │  │  - mTLS client cert    │  │        │
│  │  └────────────────────────┘  │   └──────────────────────────────┘        │
│  │  OS: Linux/macOS/Windows     │                                           │
│  └──────────────────────────────┘                                           │
└─────────────────────────────────────────────────────────────────────────────┘
         │ HTTPS + mTLS (port 443)        │ HTTPS + mTLS (port 443)
         ▼                                ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  TIER 2 — CONTROL PLANE (AWS)                                               │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │  Amazon API Gateway (REST, mTLS mutual auth)                        │    │
│  │  Custom domain: api.anchor.internal   ACM cert + client CA bundle   │    │
│  └─────────────────────────┬───────────────────────────────────────────┘    │
│                            │ Lambda Invoke                                  │
│  ┌─────────────────────────▼──────────────────────────────────────────┐     │
│  │  AWS Lambda Functions (Node.js 20.x, ARM64)                        │     │
│  │                                                                    │     │
│  │  ┌──────────────┐ ┌─────────────┐ ┌─────────────┐ ┌────────────┐  │     │
│  │  │  register    │ │  heartbeat  │ │   policy    │ │  tenants   │  │     │
│  │  └──────────────┘ └─────────────┘ └─────────────┘ └────────────┘  │     │
│  │  ┌──────────────┐ ┌─────────────┐ ┌─────────────┐ ┌────────────┐  │     │
│  │  │   groups     │ │   agents    │ │ deployments │ │  health-   │  │     │
│  │  │              │ │             │ │             │ │  processor │  │     │
│  │  └──────────────┘ └─────────────┘ └─────────────┘ └────────────┘  │     │
│  └────────────────────────────────────────────────────────────────────┘     │
│       │ DynamoDB         │ S3              │ SQS          │ KMS             │
│  ┌────▼──────┐  ┌────────▼──────┐  ┌──────▼──────┐  ┌───▼──────────┐      │
│  │ DynamoDB  │  │  S3 Artifact  │  │  SQS Health │  │  AWS KMS     │      │
│  │ Tables:   │  │  Bucket       │  │  Queue      │  │  CMK per     │      │
│  │ Tenants   │  │  (binaries,   │  │  (heartbeat │  │  tenant      │      │
│  │ Devices   │  │   signatures) │  │   events)   │  │              │      │
│  │ Groups    │  └───────────────┘  └─────────────┘  └──────────────┘      │
│  │ AgentVers │                                                              │
│  │ Deploymt  │                                                              │
│  └───────────┘                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
         │ HTTPS (internal AWS PrivateLink)
         ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  TIER 3 — ADMIN PANEL                                                       │
│                                                                             │
│  ┌────────────────────────────┐   ┌────────────────────────────┐            │
│  │  React SPA                 │   │  Amazon Cognito            │            │
│  │  (CloudFront + S3)         │◄──│  (Admin user auth, MFA)    │            │
│  │  - Fleet dashboard         │   │  OIDC → API Gateway JWT    │            │
│  │  - Deployment management   │   │  authorizer                │            │
│  │  - Group configuration     │   └────────────────────────────┘            │
│  │  - Audit log viewer        │                                             │
│  └────────────────────────────┘                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. AWS Services and Their Roles

| Service | Role |
|---------|------|
| **Amazon API Gateway** | REST API front door. Enforces mTLS for device routes, JWT (Cognito) for admin routes. Handles throttling and WAF integration. |
| **AWS Lambda** | Stateless compute for all API handlers and event processors. Node.js 20.x on ARM64 Graviton for cost efficiency. |
| **Amazon DynamoDB** | Primary persistence layer. Single-table design per logical entity with GSIs for access patterns. Point-in-time recovery enabled. Server-side encryption with tenant KMS keys. |
| **Amazon S3** | Artifact storage for compiled Anchor binaries and cosign signatures. Versioned, lifecycle-managed. Pre-signed URLs scoped to device identity. Server-side encryption with KMS. |
| **Amazon SQS** | Async health event queue. Decouples heartbeat ingestion from processing. Dead-letter queue for failed events. |
| **AWS KMS** | One Customer Managed Key (CMK) per tenant for envelope encryption of sensitive DynamoDB fields and S3 objects. Used for binary signing verification. |
| **AWS ACM / Private CA** | Issues the server-side TLS certificate for API Gateway. Optionally runs the device client CA (Private CA) for mTLS bootstrap. |
| **Amazon Cognito** | Admin user pool with MFA enforcement. Issues JWTs validated by API Gateway authorizer. |
| **Amazon CloudWatch** | Metrics, alarms, and structured log aggregation from Lambda functions. Custom metrics for fleet health. |
| **AWS CloudTrail** | Audit log for all API and KMS operations. Immutable S3 log archive. |
| **Amazon CloudFront** | CDN for Admin Panel SPA. Origin Access Control to S3. |
| **AWS WAF** | Attached to API Gateway and CloudFront. Rate limiting, geo-blocking, managed rules. |
| **AWS Secrets Manager** | Stores any third-party API keys or signing credentials outside KMS scope. |

---

## 3. Network Topology

```
Internet
   │
   │  (TLS 1.3, SNI)
   ▼
┌──────────────────────────────┐
│   AWS WAF                    │
│   - Rate limit: 1000 req/min │
│   - Managed rule groups      │
└──────────────┬───────────────┘
               │
               ▼
┌──────────────────────────────┐
│   Amazon API Gateway         │
│   VPC Endpoint (PrivateLink) │
│   - /v1/devices/*  → mTLS   │
│   - /v1/admin/*   → JWT     │
└──────────────┬───────────────┘
               │
   ┌───────────┼───────────┐
   │  VPC (10.0.0.0/16)    │
   │                       │
   │  Private Subnets      │
   │  (Lambda ENIs,        │
   │   VPC Endpoints)      │
   │                       │
   │  ┌────────────────┐   │
   │  │  Lambda        │   │
   │  │  (no internet  │   │
   │  │   egress)      │   │
   │  └────────┬───────┘   │
   │           │           │
   │  VPC Endpoints:       │
   │  - DynamoDB           │
   │  - S3                 │
   │  - KMS                │
   │  - SQS                │
   │  - Secrets Manager    │
   └───────────────────────┘
```

All Lambda-to-AWS-service traffic traverses VPC Interface Endpoints (PrivateLink), never leaving the AWS backbone. Lambda functions have no internet gateway route.

---

## 4. mTLS and Security Boundaries

### Certificate Hierarchy

```
Root CA (offline, HSM-protected)
   └── Intermediate CA (AWS Private CA, online)
         ├── Server Cert  → api.anchor.internal (API Gateway)
         └── Device Client Certs (issued per device at bootstrap)
               - CN=<deviceId>
               - O=<tenantId>
               - SANs: deviceId URI
               - Validity: 90 days
               - Rotation: automated at 75% lifetime
```

### Security Boundary Enforcement

```
┌─────────────────────────────────────────────────────────┐
│  BOUNDARY 1: Network Edge                               │
│  WAF → drops malformed, rate-limited, geo-blocked reqs  │
└─────────────────────────────────────────────────────────┘
                        │
┌─────────────────────────────────────────────────────────┐
│  BOUNDARY 2: Transport (mTLS)                           │
│  API Gateway verifies client cert against trusted CA    │
│  bundle. Rejects any request without valid cert.        │
└─────────────────────────────────────────────────────────┘
                        │
┌─────────────────────────────────────────────────────────┐
│  BOUNDARY 3: Application (Thumbprint Binding)           │
│  Lambda verifier checks cert thumbprint matches device  │
│  record in DynamoDB. Prevents cert reuse across devices.│
└─────────────────────────────────────────────────────────┘
                        │
┌─────────────────────────────────────────────────────────┐
│  BOUNDARY 4: Data (Tenant Isolation)                    │
│  Every DynamoDB key is prefixed with tenantId.          │
│  KMS grants scoped to tenant CMK.                       │
└─────────────────────────────────────────────────────────┘
```

---

## 5. Data Flow Diagrams

### 5.1 Device Registration Flow

```
Device                  API Gateway          Lambda:register      DynamoDB
  │                          │                     │                  │
  │──POST /v1/devices/──────►│                     │                  │
  │  register                │                     │                  │
  │  (mTLS + body)           │                     │                  │
  │                          │──invoke────────────►│                  │
  │                          │  {tenantId,         │                  │
  │                          │   deviceId,         │──GetItem────────►│
  │                          │   certThumbprint,   │  Tenants table   │
  │                          │   ...}              │◄─────────────────│
  │                          │                     │  (validate)      │
  │                          │                     │──PutItem────────►│
  │                          │                     │  Devices table   │
  │                          │                     │◄─────────────────│
  │◄─────────────────────────│◄────────────────────│                  │
  │  201 {deviceId,groupId}  │                     │                  │
```

### 5.2 Policy Fetch Flow

```
Device          API Gateway     Lambda:policy    DynamoDB         S3 + KMS
  │                  │                │               │               │
  │──GET /v1/────────►│               │               │               │
  │  devices/{id}/   │               │               │               │
  │  policy          │               │               │               │
  │                  │──invoke───────►│               │               │
  │                  │               │──GetItem──────►│               │
  │                  │               │  Devices table │               │
  │                  │               │◄───────────────│               │
  │                  │               │──GetItem──────►│               │
  │                  │               │  Groups table  │               │
  │                  │               │◄───────────────│               │
  │                  │               │──Query────────►│               │
  │                  │               │  Deployments   │               │
  │                  │               │◄───────────────│               │
  │                  │               │──Presign URL──────────────────►│
  │                  │               │◄──────────────────────────────│
  │◄─────────────────│◄──────────────│                               │
  │  200 {policy,    │               │                               │
  │  presignedUrls}  │               │                               │
```

### 5.3 Heartbeat / Health Flow

```
Device          API Gateway    Lambda:heartbeat     SQS        Lambda:health-proc   DynamoDB   CloudWatch
  │                  │                │               │                │               │            │
  │──POST /v1/───────►│               │               │                │               │            │
  │  heartbeat        │               │               │                │               │            │
  │                  │──invoke───────►│               │                │               │            │
  │                  │               │──UpdateItem───────────────────────────────────►│            │
  │                  │               │  (lastSeen)   │                │               │            │
  │                  │               │──SendMessage─►│                │               │            │
  │◄─────────────────│◄──────────────│               │                │               │            │
  │  200 {ts}        │               │               │──invoke───────►│               │            │
  │                  │               │               │                │──UpdateItem──►│            │
  │                  │               │               │                │──PutMetric────────────────►│
```
