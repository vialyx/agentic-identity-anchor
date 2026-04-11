import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { docClient, TENANTS_TABLE, GROUPS_TABLE } from '../db/client';
import type { Tenant, Group, ApiErrorResponse } from '../types';

// ─── Validation schemas ───────────────────────────────────────────────────────

const CreateGroupSchema = z.object({
  tenantId: z.string().uuid(),
  name: z.string().min(3).max(64),
  description: z.string().max(512).optional(),
  policy: z
    .object({
      updateWindow: z.string().optional(),
      maxConcurrent: z.number().int().positive().optional(),
    })
    .optional(),
});

const ListGroupsQuerySchema = z.object({
  tenantId: z.string().uuid(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  nextToken: z.string().optional(),
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

// ─── List handler ─────────────────────────────────────────────────────────────

/**
 * Lambda handler for GET /v1/groups.
 *
 * Returns a paginated list of device groups for the specified tenant.
 */
export const listHandler = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> => {
  const requestId = event.requestContext.requestId;

  const queryParsed = ListGroupsQuerySchema.safeParse(event.queryStringParameters ?? {});
  if (!queryParsed.success) {
    const message = queryParsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    return errorResponse(400, 'VALIDATION_ERROR', message, requestId);
  }

  const { tenantId, limit, nextToken } = queryParsed.data;

  try {
    const result = await docClient.send(
      new QueryCommand({
        TableName: GROUPS_TABLE,
        KeyConditionExpression: 'tenantId = :tid',
        ExpressionAttributeValues: { ':tid': tenantId },
        Limit: limit,
        ExclusiveStartKey: nextToken
          ? (JSON.parse(Buffer.from(nextToken, 'base64').toString()) as Record<string, unknown>)
          : undefined,
      }),
    );

    const groups = (result.Items ?? []) as Group[];
    const nextTokenOut = result.LastEvaluatedKey
      ? Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64')
      : null;

    return jsonResponse(200, { groups, nextToken: nextTokenOut });
  } catch (err) {
    console.error('listGroups error', { requestId, tenantId, error: err instanceof Error ? err.message : String(err) });
    return errorResponse(500, 'INTERNAL_ERROR', 'An unexpected error occurred', requestId);
  }
};

// ─── Create handler ───────────────────────────────────────────────────────────

/**
 * Lambda handler for POST /v1/groups.
 *
 * Creates a new device group within a tenant after verifying the tenant
 * exists. Group names must be unique within a tenant.
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

  const parsed = CreateGroupSchema.safeParse(rawBody);
  if (!parsed.success) {
    const message = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    return errorResponse(400, 'VALIDATION_ERROR', message, requestId);
  }

  const { tenantId, name, description, policy } = parsed.data;

  try {
    // ── Validate tenant ───────────────────────────────────────────────────
    const tenantResult = await docClient.send(
      new GetCommand({
        TableName: TENANTS_TABLE,
        Key: { tenantId },
        ProjectionExpression: '#s',
        ExpressionAttributeNames: { '#s': 'status' },
      }),
    );

    if (!tenantResult.Item) {
      return errorResponse(403, 'TENANT_NOT_FOUND', 'Tenant not found', requestId);
    }

    const tenant = tenantResult.Item as Pick<Tenant, 'status'>;
    if (tenant.status !== 'active') {
      return errorResponse(403, 'TENANT_NOT_FOUND', 'Tenant is suspended', requestId);
    }

    // ── Check name uniqueness within tenant (via NameIndex GSI) ───────────
    const nameCheck = await docClient.send(
      new QueryCommand({
        TableName: GROUPS_TABLE,
        IndexName: 'NameIndex',
        KeyConditionExpression: 'tenantId = :tid AND #n = :name',
        ExpressionAttributeNames: { '#n': 'name' },
        ExpressionAttributeValues: { ':tid': tenantId, ':name': name },
        Limit: 1,
      }),
    );

    if (nameCheck.Items && nameCheck.Items.length > 0) {
      return errorResponse(409, 'GROUP_EXISTS', `A group named "${name}" already exists in this tenant`, requestId);
    }

    const groupId = uuidv4();
    const now = new Date().toISOString();

    const group: Group = {
      tenantId,
      groupId,
      name,
      description,
      isDefault: false,
      createdAt: now,
      updatedAt: now,
      policy: {
        updateWindow: policy?.updateWindow,
        maxConcurrent: policy?.maxConcurrent ?? 10,
      },
      deviceCount: 0,
    };

    await docClient.send(
      new PutCommand({
        TableName: GROUPS_TABLE,
        Item: group,
        ConditionExpression: 'attribute_not_exists(groupId)',
      }),
    );

    return jsonResponse(201, { groupId, tenantId, name, createdAt: now });
  } catch (err) {
    if (err instanceof Error && err.name === 'ConditionalCheckFailedException') {
      return errorResponse(409, 'GROUP_EXISTS', 'Group already exists', requestId);
    }
    console.error('createGroup error', { requestId, tenantId, error: err instanceof Error ? err.message : String(err) });
    return errorResponse(500, 'INTERNAL_ERROR', 'An unexpected error occurred', requestId);
  }
};
