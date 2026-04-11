import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { ScanCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { KMSClient, CreateKeyCommand, EnableKeyRotationCommand } from '@aws-sdk/client-kms';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { docClient, TENANTS_TABLE, GROUPS_TABLE } from '../db/client';
import type { Tenant, Group, ApiErrorResponse } from '../types';

const kmsClient = new KMSClient({ region: process.env['AWS_REGION'] ?? 'us-east-1' });

// ─── Validation schemas ───────────────────────────────────────────────────────

const CreateTenantSchema = z.object({
  name: z.string().min(3).max(128),
  settings: z
    .object({
      maxDevices: z.number().int().positive().optional(),
      retentionDays: z.number().int().positive().optional(),
    })
    .optional(),
});

const ListTenantsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  nextToken: z.string().optional(),
  status: z.enum(['active', 'suspended']).optional(),
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
 * Provisions a KMS Customer Managed Key for a tenant with automatic annual
 * key rotation enabled.
 */
async function provisionTenantKmsKey(tenantId: string, tenantName: string): Promise<string> {
  const createResult = await kmsClient.send(
    new CreateKeyCommand({
      Description: `Anchor tenant key: ${tenantName} (${tenantId})`,
      KeyUsage: 'ENCRYPT_DECRYPT',
      KeySpec: 'SYMMETRIC_DEFAULT',
      Tags: [
        { TagKey: 'anchor:tenantId', TagValue: tenantId },
        { TagKey: 'anchor:resource', TagValue: 'tenant-cmk' },
      ],
    }),
  );

  const keyId = createResult.KeyMetadata?.KeyId;
  if (!keyId) {
    throw new Error('KMS key creation did not return a KeyId');
  }

  await kmsClient.send(new EnableKeyRotationCommand({ KeyId: keyId }));

  return createResult.KeyMetadata?.Arn ?? keyId;
}

// ─── List handler ─────────────────────────────────────────────────────────────

/**
 * Lambda handler for GET /v1/tenants (admin).
 *
 * Returns a paginated list of all tenants, optionally filtered by status.
 */
export const listHandler = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> => {
  const requestId = event.requestContext.requestId;

  const queryParsed = ListTenantsQuerySchema.safeParse(event.queryStringParameters ?? {});
  if (!queryParsed.success) {
    return errorResponse(400, 'VALIDATION_ERROR', 'Invalid query parameters', requestId);
  }

  const { limit, nextToken, status } = queryParsed.data;

  try {
    const result = await docClient.send(
      new ScanCommand({
        TableName: TENANTS_TABLE,
        Limit: limit,
        ExclusiveStartKey: nextToken
          ? (JSON.parse(Buffer.from(nextToken, 'base64').toString()) as Record<string, unknown>)
          : undefined,
        FilterExpression: status ? '#s = :status' : undefined,
        ExpressionAttributeNames: status ? { '#s': 'status' } : undefined,
        ExpressionAttributeValues: status ? { ':status': status } : undefined,
      }),
    );

    const tenants = (result.Items ?? []) as Tenant[];
    const nextTokenOut = result.LastEvaluatedKey
      ? Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64')
      : null;

    return jsonResponse(200, { tenants, nextToken: nextTokenOut });
  } catch (err) {
    console.error('listTenants error', { requestId, error: err instanceof Error ? err.message : String(err) });
    return errorResponse(500, 'INTERNAL_ERROR', 'An unexpected error occurred', requestId);
  }
};

// ─── Create handler ───────────────────────────────────────────────────────────

/**
 * Lambda handler for POST /v1/tenants (admin).
 *
 * Creates a new tenant, provisions a dedicated KMS key, and creates the
 * default device group.
 */
export const createHandler = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> => {
  const requestId = event.requestContext.requestId;

  let rawBody: unknown;
  try {
    rawBody = JSON.parse(event.body ?? '{}');
  } catch {
    return errorResponse(400, 'VALIDATION_ERROR', 'Request body is not valid JSON', requestId);
  }

  const parsed = CreateTenantSchema.safeParse(rawBody);
  if (!parsed.success) {
    const message = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    return errorResponse(400, 'VALIDATION_ERROR', message, requestId);
  }

  const { name, settings } = parsed.data;

  try {
    // ── Check name uniqueness via GSI ─────────────────────────────────────
    const nameCheck = await docClient.send(
      new QueryCommand({
        TableName: TENANTS_TABLE,
        IndexName: 'NameIndex',
        KeyConditionExpression: '#n = :name',
        ExpressionAttributeNames: { '#n': 'name' },
        ExpressionAttributeValues: { ':name': name },
        Limit: 1,
      }),
    );

    if (nameCheck.Items && nameCheck.Items.length > 0) {
      return errorResponse(409, 'TENANT_EXISTS', `A tenant named "${name}" already exists`, requestId);
    }

    const tenantId = uuidv4();
    const defaultGroupId = uuidv4();
    const now = new Date().toISOString();

    // ── Provision KMS key ─────────────────────────────────────────────────
    const kmsKeyId = await provisionTenantKmsKey(tenantId, name);

    // ── Create default group ──────────────────────────────────────────────
    const defaultGroup: Group = {
      tenantId,
      groupId: defaultGroupId,
      name: 'default',
      description: 'Default group for newly registered devices',
      isDefault: true,
      createdAt: now,
      updatedAt: now,
      policy: { maxConcurrent: 10 },
      deviceCount: 0,
    };

    await docClient.send(new PutCommand({ TableName: GROUPS_TABLE, Item: defaultGroup }));

    // ── Create tenant ─────────────────────────────────────────────────────
    const tenant: Tenant = {
      tenantId,
      name,
      status: 'active',
      createdAt: now,
      updatedAt: now,
      kmsKeyId,
      defaultGroupId,
      settings: {
        maxDevices: settings?.maxDevices ?? 1000,
        retentionDays: settings?.retentionDays ?? 90,
      },
      deviceCount: 0,
    };

    await docClient.send(
      new PutCommand({
        TableName: TENANTS_TABLE,
        Item: tenant,
        ConditionExpression: 'attribute_not_exists(tenantId)',
      }),
    );

    return jsonResponse(201, {
      tenantId,
      name,
      status: 'active',
      kmsKeyId,
      defaultGroupId,
      createdAt: now,
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'ConditionalCheckFailedException') {
      return errorResponse(409, 'TENANT_EXISTS', 'Tenant already exists', requestId);
    }
    console.error('createTenant error', { requestId, error: err instanceof Error ? err.message : String(err) });
    return errorResponse(500, 'INTERNAL_ERROR', 'An unexpected error occurred', requestId);
  }
};
