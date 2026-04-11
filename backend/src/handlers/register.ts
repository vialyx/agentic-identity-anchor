import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { docClient, TENANTS_TABLE, DEVICES_TABLE, GROUPS_TABLE } from '../db/client';
import type {
  Device,
  Group,
  Tenant,
  RegistrationResponse,
  ApiErrorResponse,
} from '../types';

// ─── Input validation schema ──────────────────────────────────────────────────

const RegistrationSchema = z.object({
  tenantId: z.string().uuid(),
  deviceId: z.string().uuid(),
  hostname: z.string().min(1).max(253),
  os: z.enum(['linux', 'macos', 'windows']),
  arch: z.enum(['amd64', 'arm64']),
  certThumbprint: z.string().regex(/^[0-9a-fA-F]{64}$/, 'Must be 64-char hex SHA-256'),
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function errorResponse(statusCode: number, code: string, message: string, requestId?: string): APIGatewayProxyResult {
  const body: ApiErrorResponse = { error: { code, message, requestId } };
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

function jsonResponse(statusCode: number, body: unknown): APIGatewayProxyResult {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

/**
 * Fetches the default group for a tenant. Returns `null` when the tenant has
 * no default group configured.
 */
async function getDefaultGroup(tenantId: string, defaultGroupId: string): Promise<Group | null> {
  const result = await docClient.send(
    new GetCommand({
      TableName: GROUPS_TABLE,
      Key: { tenantId, groupId: defaultGroupId },
    }),
  );
  return (result.Item as Group | undefined) ?? null;
}

// ─── Handler ─────────────────────────────────────────────────────────────────

/**
 * Lambda handler for POST /v1/devices/register.
 *
 * Registers a new device or updates an existing device record (idempotent).
 * Validates that the owning tenant exists and is active before writing.
 */
export const handler = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> => {
  const requestId = event.requestContext.requestId;

  // ── Parse body ────────────────────────────────────────────────────────────
  let rawBody: unknown;
  try {
    rawBody = JSON.parse(event.body ?? '{}');
  } catch {
    return errorResponse(400, 'VALIDATION_ERROR', 'Request body is not valid JSON', requestId);
  }

  const parsed = RegistrationSchema.safeParse(rawBody);
  if (!parsed.success) {
    const message = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    return errorResponse(400, 'VALIDATION_ERROR', message, requestId);
  }

  const { tenantId, deviceId, hostname, os, arch, certThumbprint } = parsed.data;

  try {
    // ── Validate tenant ───────────────────────────────────────────────────
    const tenantResult = await docClient.send(
      new GetCommand({
        TableName: TENANTS_TABLE,
        Key: { tenantId },
        ProjectionExpression: '#s, defaultGroupId',
        ExpressionAttributeNames: { '#s': 'status' },
      }),
    );

    if (!tenantResult.Item) {
      return errorResponse(403, 'TENANT_NOT_FOUND', 'Tenant not found', requestId);
    }

    const tenant = tenantResult.Item as Pick<Tenant, 'status' | 'defaultGroupId'>;
    if (tenant.status !== 'active') {
      return errorResponse(403, 'TENANT_NOT_FOUND', 'Tenant is suspended', requestId);
    }

    // ── Check for existing device ─────────────────────────────────────────
    const existingResult = await docClient.send(
      new GetCommand({
        TableName: DEVICES_TABLE,
        Key: { tenantId, deviceId },
        ProjectionExpression: 'certThumbprint, groupId, #s',
        ExpressionAttributeNames: { '#s': 'status' },
      }),
    );

    const now = new Date().toISOString();
    const defaultGroupId = tenant.defaultGroupId ?? uuidv4();

    if (existingResult.Item) {
      const existing = existingResult.Item as Pick<Device, 'certThumbprint' | 'groupId' | 'status'>;

      // Re-registration: validate cert thumbprint matches
      if (existing.certThumbprint.toLowerCase() !== certThumbprint.toLowerCase()) {
        return errorResponse(403, 'CERT_MISMATCH', 'Certificate thumbprint does not match stored value', requestId);
      }

      // Update last seen and hostname (cert may have rotated — same thumbprint)
      await docClient.send(
        new UpdateCommand({
          TableName: DEVICES_TABLE,
          Key: { tenantId, deviceId },
          UpdateExpression: 'SET hostname = :h, os = :o, arch = :a, updatedAt = :u, lastSeen = :u, #s = :active',
          ExpressionAttributeNames: { '#s': 'status' },
          ExpressionAttributeValues: {
            ':h': hostname,
            ':o': os,
            ':a': arch,
            ':u': now,
            ':active': 'active',
          },
        }),
      );

      const response: RegistrationResponse = {
        deviceId,
        groupId: existing.groupId,
        status: 'active',
        updatedAt: now,
      };
      return jsonResponse(200, response);
    }

    // ── New registration ──────────────────────────────────────────────────
    const defaultGroup = await getDefaultGroup(tenantId, defaultGroupId);
    const assignedGroupId = defaultGroup?.groupId ?? defaultGroupId;

    const newDevice: Device = {
      tenantId,
      deviceId,
      hostname,
      os,
      arch,
      status: 'active',
      createdAt: now,
      updatedAt: now,
      lastSeen: now,
      certThumbprint: certThumbprint.toLowerCase(),
      groupId: assignedGroupId,
      agentVersions: {},
    };

    await docClient.send(
      new PutCommand({
        TableName: DEVICES_TABLE,
        Item: newDevice,
        // Ensure another registration didn't race us
        ConditionExpression: 'attribute_not_exists(deviceId)',
      }),
    );

    // Increment tenant device count
    await docClient.send(
      new UpdateCommand({
        TableName: TENANTS_TABLE,
        Key: { tenantId },
        UpdateExpression: 'ADD deviceCount :one',
        ExpressionAttributeValues: { ':one': 1 },
      }),
    );

    const response: RegistrationResponse = {
      deviceId,
      groupId: assignedGroupId,
      status: 'active',
      createdAt: now,
    };
    return jsonResponse(201, response);
  } catch (err) {
    // Handle DynamoDB ConditionalCheckFailedException (race on new registration)
    if (err instanceof Error && err.name === 'ConditionalCheckFailedException') {
      return errorResponse(409, 'CONFLICT', 'Device was registered concurrently; retry', requestId);
    }

    console.error('register handler error', {
      requestId,
      tenantId,
      deviceId,
      error: err instanceof Error ? err.message : String(err),
    });
    return errorResponse(500, 'INTERNAL_ERROR', 'An unexpected error occurred', requestId);
  }
};
