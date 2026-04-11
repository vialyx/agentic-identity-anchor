import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { docClient, DEPLOYMENT_POLICIES_TABLE, AGENT_VERSIONS_TABLE, GROUPS_TABLE } from '../db/client';
import type { DeploymentPolicy, ApiErrorResponse, RollbackResponse } from '../types';

// ─── Validation schemas ───────────────────────────────────────────────────────

const CreateDeploymentSchema = z.object({
  tenantId: z.string().uuid(),
  groupId: z.string().uuid(),
  agentId: z.string().min(1).max(64),
  targetVersion: z.string().regex(/^\d+\.\d+\.\d+(-[\w.]+)?(\+[\w.]+)?$/, 'Must be valid semver (e.g. 1.2.3 or 1.2.3-beta.1)'),
  strategy: z.enum(['immediate', 'canary', 'scheduled']),
  canaryPercent: z.number().int().min(1).max(100).optional(),
  scheduledAt: z.string().datetime({ offset: true }).optional(),
}).refine(
  (d) => d.strategy !== 'canary' || d.canaryPercent !== undefined,
  { message: 'canaryPercent is required when strategy is canary', path: ['canaryPercent'] },
).refine(
  (d) => d.strategy !== 'scheduled' || d.scheduledAt !== undefined,
  { message: 'scheduledAt is required when strategy is scheduled', path: ['scheduledAt'] },
);

const ListDeploymentsQuerySchema = z.object({
  tenantId: z.string().uuid(),
  status: z.enum(['active', 'completed', 'rolling_back', 'rolled_back', 'failed']).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  nextToken: z.string().optional(),
});

const RollbackSchema = z.object({
  tenantId: z.string().uuid(),
  reason: z.string().max(512).optional(),
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
 * Lambda handler for GET /v1/deployments (admin).
 *
 * Returns paginated deployment policies for a tenant, optionally filtered by
 * status.
 */
export const listHandler = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> => {
  const requestId = event.requestContext.requestId;

  const queryParsed = ListDeploymentsQuerySchema.safeParse(event.queryStringParameters ?? {});
  if (!queryParsed.success) {
    const message = queryParsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    return errorResponse(400, 'VALIDATION_ERROR', message, requestId);
  }

  const { tenantId, status, limit, nextToken } = queryParsed.data;

  try {
    const result = await docClient.send(
      new QueryCommand({
        TableName: DEPLOYMENT_POLICIES_TABLE,
        KeyConditionExpression: 'tenantId = :tid',
        FilterExpression: status ? '#s = :status' : undefined,
        ExpressionAttributeNames: status ? { '#s': 'status' } : undefined,
        ExpressionAttributeValues: {
          ':tid': tenantId,
          ...(status ? { ':status': status } : {}),
        },
        Limit: limit,
        ScanIndexForward: false,
        ExclusiveStartKey: nextToken
          ? (JSON.parse(Buffer.from(nextToken, 'base64').toString()) as Record<string, unknown>)
          : undefined,
      }),
    );

    const deployments = (result.Items ?? []) as DeploymentPolicy[];
    const nextTokenOut = result.LastEvaluatedKey
      ? Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64')
      : null;

    return jsonResponse(200, { deployments, nextToken: nextTokenOut });
  } catch (err) {
    console.error('listDeployments error', { requestId, tenantId, error: err instanceof Error ? err.message : String(err) });
    return errorResponse(500, 'INTERNAL_ERROR', 'An unexpected error occurred', requestId);
  }
};

// ─── Create handler ───────────────────────────────────────────────────────────

/**
 * Lambda handler for POST /v1/deployments (admin).
 *
 * Creates a deployment policy after validating the group exists and the
 * target agent version has been published. Rejects if an active policy for
 * the same group+agent already exists.
 */
export const createHandler = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> => {
  const requestId = event.requestContext.requestId;
  const createdBy = (event.requestContext.authorizer?.['sub'] as string | undefined) ?? 'unknown';

  let rawBody: unknown;
  try {
    rawBody = JSON.parse(event.body ?? '{}');
  } catch {
    return errorResponse(400, 'VALIDATION_ERROR', 'Request body is not valid JSON', requestId);
  }

  const parsed = CreateDeploymentSchema.safeParse(rawBody);
  if (!parsed.success) {
    const message = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    return errorResponse(400, 'VALIDATION_ERROR', message, requestId);
  }

  const { tenantId, groupId, agentId, targetVersion, strategy, canaryPercent, scheduledAt } = parsed.data;

  try {
    // ── Validate group exists ─────────────────────────────────────────────
    const groupResult = await docClient.send(
      new GetCommand({
        TableName: GROUPS_TABLE,
        Key: { tenantId, groupId },
        ProjectionExpression: 'groupId',
      }),
    );

    if (!groupResult.Item) {
      return errorResponse(404, 'GROUP_NOT_FOUND', 'Group not found', requestId);
    }

    // ── Validate agent version exists (any platform/arch) ─────────────────
    const versionCheck = await docClient.send(
      new QueryCommand({
        TableName: AGENT_VERSIONS_TABLE,
        KeyConditionExpression: 'agentId = :aid AND begins_with(#v, :prefix)',
        ExpressionAttributeNames: { '#v': 'version' },
        ExpressionAttributeValues: { ':aid': agentId, ':prefix': `${targetVersion}#` },
        Limit: 1,
      }),
    );

    if (!versionCheck.Items || versionCheck.Items.length === 0) {
      return errorResponse(404, 'VERSION_NOT_FOUND', `Agent version ${agentId}@${targetVersion} not found`, requestId);
    }

    // ── Check for existing active policy (conflict) ───────────────────────
    const conflictCheck = await docClient.send(
      new QueryCommand({
        TableName: DEPLOYMENT_POLICIES_TABLE,
        IndexName: 'GroupIndex',
        KeyConditionExpression: 'groupId = :gid',
        FilterExpression: '#s = :active AND agentId = :aid',
        ExpressionAttributeNames: { '#s': 'status' },
        ExpressionAttributeValues: { ':gid': groupId, ':active': 'active', ':aid': agentId },
        Limit: 1,
      }),
    );

    if (conflictCheck.Items && conflictCheck.Items.length > 0) {
      return errorResponse(409, 'POLICY_CONFLICT', 'An active deployment policy already exists for this group and agent', requestId);
    }

    // ── Fetch previous completed policy for rollback support ──────────────
    const prevPolicyResult = await docClient.send(
      new QueryCommand({
        TableName: DEPLOYMENT_POLICIES_TABLE,
        IndexName: 'GroupIndex',
        KeyConditionExpression: 'groupId = :gid',
        FilterExpression: '#s = :completed AND agentId = :aid',
        ExpressionAttributeNames: { '#s': 'status' },
        ExpressionAttributeValues: { ':gid': groupId, ':completed': 'completed', ':aid': agentId },
        Limit: 1,
        ScanIndexForward: false,
      }),
    );

    const previousVersion = prevPolicyResult.Items?.[0]
      ? (prevPolicyResult.Items[0] as DeploymentPolicy).targetVersion
      : undefined;

    const policyId = uuidv4();
    const now = new Date().toISOString();

    const policy: DeploymentPolicy = {
      tenantId,
      policyId,
      groupId,
      agentId,
      targetVersion,
      previousVersion,
      strategy,
      canaryPercent,
      scheduledAt,
      status: 'active',
      createdAt: now,
      updatedAt: now,
      createdBy,
    };

    await docClient.send(
      new PutCommand({
        TableName: DEPLOYMENT_POLICIES_TABLE,
        Item: policy,
        ConditionExpression: 'attribute_not_exists(policyId)',
      }),
    );

    return jsonResponse(201, policy);
  } catch (err) {
    if (err instanceof Error && err.name === 'ConditionalCheckFailedException') {
      return errorResponse(409, 'POLICY_CONFLICT', 'Policy already exists', requestId);
    }
    console.error('createDeployment error', { requestId, tenantId, error: err instanceof Error ? err.message : String(err) });
    return errorResponse(500, 'INTERNAL_ERROR', 'An unexpected error occurred', requestId);
  }
};

// ─── Rollback handler ─────────────────────────────────────────────────────────

/**
 * Lambda handler for POST /v1/deployments/{id}/rollback (admin).
 *
 * Transitions the current policy to `rolling_back` status and creates a new
 * deployment policy targeting the previous stable version.
 */
export const rollbackHandler = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> => {
  const requestId = event.requestContext.requestId;
  const policyId = event.pathParameters?.['id'];
  const createdBy = (event.requestContext.authorizer?.['sub'] as string | undefined) ?? 'unknown';

  if (!policyId) {
    return errorResponse(400, 'VALIDATION_ERROR', 'Policy ID path parameter is required', requestId);
  }

  let rawBody: unknown;
  try {
    rawBody = JSON.parse(event.body ?? '{}');
  } catch {
    return errorResponse(400, 'VALIDATION_ERROR', 'Request body is not valid JSON', requestId);
  }

  const parsed = RollbackSchema.safeParse(rawBody);
  if (!parsed.success) {
    return errorResponse(400, 'VALIDATION_ERROR', 'tenantId is required', requestId);
  }

  const { tenantId, reason } = parsed.data;

  try {
    // ── Fetch the policy to roll back ─────────────────────────────────────
    const policyResult = await docClient.send(
      new GetCommand({
        TableName: DEPLOYMENT_POLICIES_TABLE,
        Key: { tenantId, policyId },
      }),
    );

    if (!policyResult.Item) {
      return errorResponse(404, 'POLICY_NOT_FOUND', 'Deployment policy not found', requestId);
    }

    const currentPolicy = policyResult.Item as DeploymentPolicy;

    if (currentPolicy.status === 'rolling_back') {
      return errorResponse(409, 'ALREADY_ROLLING_BACK', 'A rollback is already in progress for this policy', requestId);
    }

    if (!currentPolicy.previousVersion) {
      return errorResponse(400, 'NO_PREVIOUS_VERSION', 'No previous version available for rollback', requestId);
    }

    const now = new Date().toISOString();
    const rollbackPolicyId = uuidv4();

    // ── Create rollback policy (targeting previous version) ───────────────
    const rollbackPolicy: DeploymentPolicy = {
      tenantId,
      policyId: rollbackPolicyId,
      groupId: currentPolicy.groupId,
      agentId: currentPolicy.agentId,
      targetVersion: currentPolicy.previousVersion,
      previousVersion: currentPolicy.targetVersion,
      strategy: 'immediate',
      status: 'active',
      createdAt: now,
      updatedAt: now,
      createdBy,
      rollbackReason: reason,
    };

    await docClient.send(
      new PutCommand({
        TableName: DEPLOYMENT_POLICIES_TABLE,
        Item: rollbackPolicy,
      }),
    );

    // ── Mark original policy as rolling_back ──────────────────────────────
    await docClient.send(
      new UpdateCommand({
        TableName: DEPLOYMENT_POLICIES_TABLE,
        Key: { tenantId, policyId },
        UpdateExpression: 'SET #s = :rolling, updatedAt = :now, rollbackPolicyId = :rid, rollbackReason = :reason',
        ExpressionAttributeNames: { '#s': 'status' },
        ExpressionAttributeValues: {
          ':rolling': 'rolling_back',
          ':now': now,
          ':rid': rollbackPolicyId,
          ':reason': reason ?? '',
        },
      }),
    );

    const response: RollbackResponse = {
      rollbackPolicyId,
      previousVersion: currentPolicy.previousVersion,
      targetVersion: currentPolicy.targetVersion,
      status: 'rolling_back',
      initiatedAt: now,
    };

    return jsonResponse(200, response);
  } catch (err) {
    console.error('rollback error', { requestId, tenantId, policyId, error: err instanceof Error ? err.message : String(err) });
    return errorResponse(500, 'INTERNAL_ERROR', 'An unexpected error occurred', requestId);
  }
};
