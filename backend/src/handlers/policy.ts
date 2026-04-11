import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  docClient,
  DEVICES_TABLE,
  GROUPS_TABLE,
  DEPLOYMENT_POLICIES_TABLE,
  AGENT_VERSIONS_TABLE,
} from '../db/client';
import type {
  Device,
  Group,
  DeploymentPolicy,
  AgentVersion,
  PolicyResponse,
  PolicyAgentEntry,
  ApiErrorResponse,
} from '../types';

const s3Client = new S3Client({ region: process.env['AWS_REGION'] ?? 'us-east-1' });
const ARTIFACTS_BUCKET = process.env['ARTIFACTS_BUCKET'] ?? 'anchor-artifacts';
/** Presigned URL validity in seconds. */
const PRESIGNED_URL_TTL = 3600;

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
 * Generates a presigned S3 GetObject URL for an artifact key.
 */
async function presign(s3Key: string): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: ARTIFACTS_BUCKET,
    Key: s3Key,
  });
  return getSignedUrl(s3Client, command, { expiresIn: PRESIGNED_URL_TTL });
}

/**
 * Looks up an AgentVersion record using the composite sort key
 * "<version>#<platform>#<arch>".
 */
async function getAgentVersion(
  agentId: string,
  version: string,
  platform: string,
  arch: string,
): Promise<AgentVersion | null> {
  const sk = `${version}#${platform}#${arch}`;
  const result = await docClient.send(
    new GetCommand({
      TableName: AGENT_VERSIONS_TABLE,
      Key: { agentId, version: sk },
    }),
  );
  return (result.Item as AgentVersion | undefined) ?? null;
}

// ─── Handler ─────────────────────────────────────────────────────────────────

/**
 * Lambda handler for GET /v1/devices/{deviceId}/policy.
 *
 * Resolves the effective deployment policy for a device by walking:
 *   Device → Group → DeploymentPolicy → AgentVersion → presigned S3 URLs
 *
 * Returns an empty agents array when no active policy targets the device's
 * group.
 */
export const handler = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> => {
  const requestId = event.requestContext.requestId;
  const deviceId = event.pathParameters?.['deviceId'];
  const tenantId = event.queryStringParameters?.['tenantId'];

  if (!deviceId || !tenantId) {
    return errorResponse(400, 'VALIDATION_ERROR', 'deviceId path parameter and tenantId query parameter are required', requestId);
  }

  try {
    // ── Fetch device ──────────────────────────────────────────────────────
    const deviceResult = await docClient.send(
      new GetCommand({
        TableName: DEVICES_TABLE,
        Key: { tenantId, deviceId },
      }),
    );

    if (!deviceResult.Item) {
      return errorResponse(403, 'DEVICE_NOT_FOUND', 'Device not found', requestId);
    }

    const device = deviceResult.Item as Device;

    if (device.status === 'suspended') {
      return errorResponse(403, 'DEVICE_SUSPENDED', 'Device is suspended', requestId);
    }

    if (device.status === 'decommissioned') {
      return errorResponse(403, 'DEVICE_NOT_FOUND', 'Device is decommissioned', requestId);
    }

    // ── Fetch group ───────────────────────────────────────────────────────
    const groupResult = await docClient.send(
      new GetCommand({
        TableName: GROUPS_TABLE,
        Key: { tenantId, groupId: device.groupId },
      }),
    );

    const group = groupResult.Item as Group | undefined;

    // ── Find active deployment policy for the group ───────────────────────
    let activePolicy: DeploymentPolicy | null = null;

    if (group) {
      const policyResult = await docClient.send(
        new QueryCommand({
          TableName: DEPLOYMENT_POLICIES_TABLE,
          IndexName: 'GroupIndex',
          KeyConditionExpression: 'groupId = :gid',
          FilterExpression: '#s = :active',
          ExpressionAttributeNames: { '#s': 'status' },
          ExpressionAttributeValues: {
            ':gid': device.groupId,
            ':active': 'active',
          },
          Limit: 1,
        }),
      );

      if (policyResult.Items && policyResult.Items.length > 0) {
        activePolicy = policyResult.Items[0] as DeploymentPolicy;
      }
    }

    const evaluatedAt = new Date().toISOString();

    if (!activePolicy) {
      const response: PolicyResponse = {
        deviceId,
        groupId: device.groupId,
        policyId: null,
        agents: [],
        evaluatedAt,
      };
      return jsonResponse(200, response);
    }

    // ── Resolve agent version and generate presigned URLs ─────────────────
    const agentVersion = await getAgentVersion(
      activePolicy.agentId,
      activePolicy.targetVersion,
      device.os,
      device.arch,
    );

    const agents: PolicyAgentEntry[] = [];

    if (agentVersion) {
      const [downloadUrl, signatureUrl] = await Promise.all([
        presign(agentVersion.s3Key),
        presign(agentVersion.signatureS3Key),
      ]);

      agents.push({
        agentId: activePolicy.agentId,
        targetVersion: activePolicy.targetVersion,
        platform: device.os,
        arch: device.arch,
        downloadUrl,
        sha256: agentVersion.sha256,
        signatureUrl,
        sizeBytes: agentVersion.sizeBytes,
      });
    }

    const response: PolicyResponse = {
      deviceId,
      groupId: device.groupId,
      policyId: activePolicy.policyId,
      agents,
      strategy: activePolicy.strategy,
      canaryPercent: activePolicy.canaryPercent,
      scheduledAt: activePolicy.scheduledAt,
      evaluatedAt,
    };

    return jsonResponse(200, response);
  } catch (err) {
    console.error('policy handler error', {
      requestId,
      tenantId,
      deviceId,
      error: err instanceof Error ? err.message : String(err),
    });
    return errorResponse(500, 'INTERNAL_ERROR', 'An unexpected error occurred', requestId);
  }
};
