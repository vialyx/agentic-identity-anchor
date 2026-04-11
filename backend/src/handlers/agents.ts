import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { QueryCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { z } from 'zod';
import { docClient, AGENT_VERSIONS_TABLE } from '../db/client';
import type { AgentVersion, ApiErrorResponse } from '../types';

const s3Client = new S3Client({ region: process.env['AWS_REGION'] ?? 'us-east-1' });
const ARTIFACTS_BUCKET = process.env['ARTIFACTS_BUCKET'] ?? 'anchor-artifacts';
/** Upload URL validity in seconds. */
const UPLOAD_URL_TTL = 3600;

// ─── Validation schemas ───────────────────────────────────────────────────────

const ListAgentsQuerySchema = z.object({
  agentId: z.string().optional(),
  platform: z.enum(['linux', 'macos', 'windows']).optional(),
  arch: z.enum(['amd64', 'arm64']).optional(),
  stable: z.enum(['true', 'false']).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  nextToken: z.string().optional(),
});

const PublishVersionSchema = z.object({
  agentId: z.string().min(1).max(64),
  version: z.string().regex(/^\d+\.\d+\.\d+$/, 'Must be semver x.y.z'),
  platform: z.enum(['linux', 'macos', 'windows']),
  arch: z.enum(['amd64', 'arm64']),
  sha256: z.string().regex(/^[0-9a-fA-F]{64}$/, 'Must be 64-char hex SHA-256'),
  releaseNotes: z.string().max(4096).optional(),
  stable: z.boolean().optional().default(false),
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
 * Returns the canonical S3 key for an agent binary.
 */
function agentS3Key(agentId: string, version: string, platform: string, arch: string): string {
  return `agents/${agentId}/${version}/${platform}/${arch}/${agentId}`;
}

/**
 * Returns the canonical S3 key for an agent cosign signature bundle.
 */
function signatureS3Key(agentId: string, version: string, platform: string, arch: string): string {
  return `agents/${agentId}/${version}/${platform}/${arch}/${agentId}.bundle`;
}

// ─── List handler ─────────────────────────────────────────────────────────────

/**
 * Lambda handler for GET /v1/agents.
 *
 * Lists available agent versions filterable by agentId, platform, and
 * stability flag. Uses DynamoDB Query on the StableIndex GSI when agentId
 * is provided; falls back to a scan when no agentId is specified.
 */
export const listHandler = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> => {
  const requestId = event.requestContext.requestId;

  const queryParsed = ListAgentsQuerySchema.safeParse(event.queryStringParameters ?? {});
  if (!queryParsed.success) {
    return errorResponse(400, 'VALIDATION_ERROR', 'Invalid query parameters', requestId);
  }

  const { agentId, platform, arch, stable, limit, nextToken } = queryParsed.data;

  try {
    let filterParts: string[] = [];
    const exprNames: Record<string, string> = {};
    const exprValues: Record<string, unknown> = {};

    if (platform) {
      filterParts.push('platform = :platform');
      exprValues[':platform'] = platform;
    }
    if (arch) {
      filterParts.push('arch = :arch');
      exprValues[':arch'] = arch;
    }
    if (stable !== undefined) {
      filterParts.push('stable = :stable');
      exprValues[':stable'] = stable === 'true';
    }

    const filterExpression = filterParts.length > 0 ? filterParts.join(' AND ') : undefined;

    let result;
    if (agentId) {
      result = await docClient.send(
        new QueryCommand({
          TableName: AGENT_VERSIONS_TABLE,
          KeyConditionExpression: 'agentId = :aid',
          FilterExpression: filterExpression,
          ExpressionAttributeNames: Object.keys(exprNames).length > 0 ? exprNames : undefined,
          ExpressionAttributeValues: { ':aid': agentId, ...exprValues },
          Limit: limit,
          ScanIndexForward: false,
          ExclusiveStartKey: nextToken
            ? (JSON.parse(Buffer.from(nextToken, 'base64').toString()) as Record<string, unknown>)
            : undefined,
        }),
      );
    } else {
      const { ScanCommand } = await import('@aws-sdk/lib-dynamodb');
      result = await docClient.send(
        new ScanCommand({
          TableName: AGENT_VERSIONS_TABLE,
          FilterExpression: filterExpression,
          ExpressionAttributeNames: Object.keys(exprNames).length > 0 ? exprNames : undefined,
          ExpressionAttributeValues: Object.keys(exprValues).length > 0 ? exprValues : undefined,
          Limit: limit,
          ExclusiveStartKey: nextToken
            ? (JSON.parse(Buffer.from(nextToken, 'base64').toString()) as Record<string, unknown>)
            : undefined,
        }),
      );
    }

    const versions = (result.Items ?? []) as AgentVersion[];
    const nextTokenOut = result.LastEvaluatedKey
      ? Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64')
      : null;

    return jsonResponse(200, { versions, nextToken: nextTokenOut });
  } catch (err) {
    console.error('listAgents error', { requestId, error: err instanceof Error ? err.message : String(err) });
    return errorResponse(500, 'INTERNAL_ERROR', 'An unexpected error occurred', requestId);
  }
};

// ─── Publish handler ──────────────────────────────────────────────────────────

/**
 * Lambda handler for POST /v1/agents/versions (admin).
 *
 * Records agent version metadata in DynamoDB and returns a presigned S3
 * upload URL so the CI pipeline can push the binary directly.
 */
export const publishHandler = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> => {
  const requestId = event.requestContext.requestId;
  const publishedBy = (event.requestContext.authorizer?.['sub'] as string | undefined) ?? 'unknown';

  let rawBody: unknown;
  try {
    rawBody = JSON.parse(event.body ?? '{}');
  } catch {
    return errorResponse(400, 'VALIDATION_ERROR', 'Request body is not valid JSON', requestId);
  }

  const parsed = PublishVersionSchema.safeParse(rawBody);
  if (!parsed.success) {
    const message = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    return errorResponse(400, 'VALIDATION_ERROR', message, requestId);
  }

  const { agentId, version, platform, arch, sha256, releaseNotes, stable } = parsed.data;

  try {
    const s3Key = agentS3Key(agentId, version, platform, arch);
    const sigKey = signatureS3Key(agentId, version, platform, arch);
    const now = new Date().toISOString();

    // DynamoDB sort key uses composite to support multiple platform/arch per version
    const versionSk = `${version}#${platform}#${arch}`;

    const agentVersion: AgentVersion = {
      agentId,
      version: versionSk,
      platform,
      arch,
      s3Key,
      sha256: sha256.toLowerCase(),
      signatureS3Key: sigKey,
      releaseNotes,
      stable,
      publishedAt: now,
      publishedBy,
    };

    await docClient.send(
      new PutCommand({
        TableName: AGENT_VERSIONS_TABLE,
        Item: agentVersion,
      }),
    );

    // Generate presigned upload URL for the binary
    const uploadCommand = new PutObjectCommand({
      Bucket: ARTIFACTS_BUCKET,
      Key: s3Key,
      ChecksumSHA256: Buffer.from(sha256, 'hex').toString('base64'),
    });
    const uploadUrl = await getSignedUrl(s3Client, uploadCommand, { expiresIn: UPLOAD_URL_TTL });

    // Generate presigned upload URL for the signature bundle
    const sigUploadCommand = new PutObjectCommand({
      Bucket: ARTIFACTS_BUCKET,
      Key: sigKey,
    });
    const sigUploadUrl = await getSignedUrl(s3Client, sigUploadCommand, { expiresIn: UPLOAD_URL_TTL });

    return jsonResponse(201, {
      agentId,
      version: versionSk,
      platform,
      arch,
      uploadUrl,
      sigUploadUrl,
      s3Key,
      signatureS3Key: sigKey,
      publishedAt: now,
    });
  } catch (err) {
    console.error('publishAgent error', { requestId, agentId, version, error: err instanceof Error ? err.message : String(err) });
    return errorResponse(500, 'INTERNAL_ERROR', 'An unexpected error occurred', requestId);
  }
};
