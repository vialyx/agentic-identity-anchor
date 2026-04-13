# Anchor — Security Design

## 1. Zero Trust Model

Anchor operates on the principle that no device, user, or network path is implicitly trusted, even inside the AWS VPC. Every request must be authenticated, authorized, and validated independently.

### Tenets

1. **Verify explicitly:** Every API call requires cryptographic proof of identity (mTLS certificate or signed JWT). No IP-based trust.
2. **Least-privilege access:** IAM roles, KMS grants, and S3 bucket policies grant only the minimum permissions needed for each Lambda function.
3. **Assume breach:** All traffic is encrypted end-to-end. Tenant data is isolated by KMS key. Audit logs are immutable.
4. **Short-lived credentials:** Device client certificates expire in 90 days. Presigned S3 URLs expire in 1 hour. Admin JWTs expire in 1 hour.

---

## 2. mTLS Certificate Lifecycle

### 2.1 Certificate Hierarchy

```
Root CA (RSA-4096, offline, stored in HSM/Vault)
   │   Validity: 10 years
   │   CRL: published to S3, checked by API Gateway
   │
   └── Intermediate CA (RSA-2048, AWS Private CA, online)
         │   Validity: 3 years
         │   OCSP: available at pki.anchor.internal/ocsp
         │
         ├── Server certificate (EC P-256)
         │   CN=api.anchor.internal
         │   SAN=api.anchor.internal
         │   Validity: 1 year (auto-renewed by ACM)
         │
         └── Device client certificates (EC P-256)
               CN=<deviceId> (UUID)
               O=<tenantId>  (UUID)
               OU=anchor-device
               SAN URI=anchor:device:<tenantId>:<deviceId>
               Validity: 90 days
               Key usage: digitalSignature, clientAuth
```

### 2.2 Bootstrap (First Registration)

```
1. Provisioning system (out-of-band) generates device private key on-device.
   Key never leaves the device.

2. Device generates a CSR (PKCS#10) containing deviceId (CN) and tenantId (O).

3. Bootstrap token (one-time, 24h expiry) is provisioned alongside the binary.
   Token is used only once to authenticate the initial CSR submission.

4. CSR is submitted to a bootstrap endpoint (separate from main API, short-lived).
   Endpoint validates the bootstrap token, signs the CSR via AWS Private CA API.

5. Signed certificate is returned to device and stored in platform keystore
   (TPM/Secure Enclave on supported hardware; encrypted file on others).

6. Bootstrap token is invalidated immediately after use.

7. Device calls POST /v1/devices/register using the newly issued certificate.
   certThumbprint (SHA-256 of DER-encoded cert) is stored in DynamoDB.
```

### 2.3 Certificate Rotation

```
Rotation schedule: every 90 days (or at 75% of validity = ~67 days).

1. Anchor agent detects remaining validity < 25% (or < 30 days absolute).

2. Agent generates a new key pair on-device.

3. Agent submits a renewal CSR to the certificate renewal endpoint,
   authenticated with the CURRENT (still valid) certificate.

4. Server validates:
   a. Current cert is valid and matches DynamoDB record.
   b. CSR CN matches current deviceId.
   c. CSR O matches current tenantId.

5. New certificate issued by Private CA. Stored on device.

6. Agent calls POST /v1/devices/register with new certThumbprint.
   DynamoDB record updated atomically with new thumbprint.

7. Old certificate is revoked in Private CA (CRL updated within 5 minutes).
```

### 2.4 Revocation

- **OCSP:** Real-time status checks. API Gateway can be configured with OCSP stapling validation.
- **CRL:** Published to S3 bucket, replicated to CloudFront for low-latency global access. Checked at certificate validation time.
- **Manual revocation:** Admin panel triggers Private CA revocation + updates device status to `suspended` in DynamoDB.

---

## 3. Binary Signing Pipeline

### 3.1 Build Pipeline (GitHub Actions / CodeBuild)

```
Source commit
   │
   ▼
Build (Go cross-compile for linux/amd64, linux/arm64, darwin/amd64,
       darwin/arm64, windows/amd64)
   │
   ▼
SBOM generation (syft, SPDX 2.3 format)
   │
   ▼
Signing:
   ├── KMS asymmetric signing (RSA-PSS-SHA256)
   │   aws kms sign --key-id <anchor-signing-key>
   │              --message-type RAW
   │              --signing-algorithm RSASSA_PSS_SHA_256
   │              --message file://<binary>
   │   → Produces .sig file
   │
   └── cosign keyless signing (Sigstore, OIDC identity = CI pipeline)
       cosign sign-blob --bundle=<binary>.bundle <binary>
       → Produces .bundle file (cert + signature + transparency log entry)
   │
   ▼
Upload to S3:
   s3://anchor-artifacts/agents/<agentId>/<version>/<platform>/<arch>/
   ├── anchor              (binary)
   ├── anchor.sha256       (hex digest)
   ├── anchor.sig          (KMS signature)
   └── anchor.bundle       (cosign bundle)
   │
   ▼
Record metadata in AgentVersions DynamoDB table
(sha256, s3Key, signatureS3Key, stable=false)
   │
   ▼
Manual promotion step (admin marks version stable=true)
```

### 3.2 Client-Side Verification (on device, before binary execution)

```
1. Download binary and .sig file using presigned S3 URLs.
2. Verify SHA-256 of downloaded binary matches policy-provided sha256.
3. Verify KMS signature:
   aws kms verify --key-id <embedded-signing-key-id>
                  --message-type RAW
                  --signing-algorithm RSASSA_PSS_SHA_256
                  --message file://<binary>
                  --signature file://<binary>.sig
4. Verify cosign bundle (optional, adds Sigstore transparency):
   cosign verify-blob --bundle=<binary>.bundle <binary>
5. Only execute if all checks pass. Write verified binary to
   immutable path; swap atomically.
```

---

## 4. Key Rotation Strategy

| Key | Type | Rotation | Mechanism |
|-----|------|----------|-----------|
| Tenant KMS CMK | AWS KMS symmetric | Annual | AWS automatic key rotation (creates new key material, all old material retained for decryption) |
| Binary signing KMS key | AWS KMS asymmetric (RSA-3072) | Annual | New key created; new key ID embedded in next agent release; old key retained 90 days for verification of older clients |
| Device client certs | EC P-256 | 90 days | Automated by Anchor agent (see §2.3) |
| API server cert | EC P-256 | 1 year | ACM automatic renewal |
| Admin JWT signing key | Cognito (RSA-2048) | Managed by Cognito | Rotates automatically; JWKS endpoint updated |
| CA Intermediate cert | RSA-2048 | 3 years | Manual process; 6-month migration period with dual signing |

---

## 5. Replay Attack Prevention

### 5.1 Nonces

Every heartbeat request must include a `nonce` (UUID v4 generated by the device). The server:

1. Looks up the device record in DynamoDB.
2. Checks if the nonce is present in `nonceHistory` (a DynamoDB String Set).
3. If found → reject with `REPLAY_DETECTED` (HTTP 400).
4. If not found → add nonce to `nonceHistory`, proceed.
5. Prune `nonceHistory` to the last 200 entries (heartbeats have a 5-minute timestamp window, so at 1 req/min this covers 200 minutes of history — well beyond the window).

### 5.2 Timestamp Validation

Every heartbeat request includes an ISO 8601 `timestamp` field. The server rejects requests where `|serverTime - requestTime| > 300 seconds` (5 minutes). This bounds the replay window.

### 5.3 Sequence

```
Device                          Lambda:heartbeat
  │                                    │
  │── nonce = UUID()                   │
  │── timestamp = now().ISO8601        │
  │── POST /heartbeat {nonce, ts, ...} │
  │──────────────────────────────────► │
  │                                    │── Check: abs(serverNow - ts) ≤ 300s
  │                                    │── Check: nonce ∉ nonceHistory
  │                                    │── UpdateItem: add nonce to history
  │◄─────────────────────────────────── │── Return 200
```

---

## 6. Tamper Detection for Client Binary

### 6.1 On-Disk Integrity

The Anchor agent stores its own SHA-256 hash in a separate integrity manifest file signed by the KMS signing key. On startup, the agent:

1. Re-hashes its own executable (`/proc/self/exe` on Linux).
2. Compares against the manifest SHA-256.
3. Verifies the KMS signature on the manifest.
4. Aborts if any check fails, emits a structured error log (no panic/crash loop).

### 6.2 In-Memory Integrity

On supported platforms:
- **Linux:** Binary is loaded into a private mapping; kernel `execve` verification chain is preserved.
- **macOS:** Gatekeeper + Hardened Runtime enforces code signature at launch.
- **Windows:** Authenticode signature verified by OS loader.

### 6.3 Filesystem Protection

The Anchor binary installation directory is owned by root (or SYSTEM on Windows) and not writable by the anchor service account. The service runs with a dedicated unprivileged user account.

---

## 7. IAM Least-Privilege Policies

### 7.1 Lambda Execution Roles

Each Lambda function has its own IAM execution role with only the permissions it needs:

**register-function-role**
```json
{
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem"],
      "Resource": [
        "arn:aws:dynamodb:*:*:table/anchor-tenants",
        "arn:aws:dynamodb:*:*:table/anchor-devices",
        "arn:aws:dynamodb:*:*:table/anchor-groups"
      ]
    },
    {
      "Effect": "Allow",
      "Action": ["kms:GenerateDataKey", "kms:Decrypt"],
      "Resource": "arn:aws:kms:*:*:key/*",
      "Condition": { "StringEquals": { "kms:ViaService": "dynamodb.*.amazonaws.com" } }
    },
    { "Effect": "Allow", "Action": ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"], "Resource": "arn:aws:logs:*:*:*" }
  ]
}
```

**policy-function-role** adds:
- `s3:GetObject` on `arn:aws:s3:::anchor-artifacts/*`
- `s3:GeneratePresignedUrl` (client-side via SDK, no IAM action — requires `s3:GetObject` on the bucket)

**health-processor-role** adds:
- `sqs:ReceiveMessage`, `sqs:DeleteMessage` on the health queue ARN
- `cloudwatch:PutMetricData`

### 7.2 S3 Bucket Policy (Artifact Bucket)

The artifact bucket denies all public access. Lambda roles access via VPC endpoint. Pre-signed URLs are the only external access mechanism and are scoped to specific S3 object keys.

---

## 8. Secrets Management

| Secret | Storage | Access |
|--------|---------|--------|
| Database encryption keys | AWS KMS CMK (never leaves KMS) | IAM role + ViaService condition |
| Binary signing private key | AWS KMS asymmetric key (never exported) | `kms:Sign` restricted to CI/CD role |
| Admin Cognito client secret | AWS Secrets Manager | Lambda reads at cold start; cached in memory |
| Private CA CSR password | AWS Secrets Manager | Bootstrap service only |
| CloudWatch Logs encryption key | AWS KMS CMK | CloudWatch service role |

**No secrets are stored in environment variables, source code, or DynamoDB plaintext fields.**

Lambda functions retrieve secrets from Secrets Manager once per cold start and cache them in the module scope. Secrets Manager automatically rotates credentials where applicable (e.g., database passwords) and Lambda cache TTL is set to 5 minutes via a background refresh.
