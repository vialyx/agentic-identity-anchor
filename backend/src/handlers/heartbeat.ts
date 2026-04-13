import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import { z } from 'zod';
import { docClient, DEVICES_TABLE } from '../db/client';
import type { Device, HeartbeatResponse, HeartbeatEvent, ApiErrorResponse } from '../types';

const sqsClient = new SQSClient({ region: process.env['AWS_REGION'] ?? 'us-east-1' });

const HEALTH_QUEUE_URL = process.env['HEALTH_QUEUE_URL'] ?? '';
/** Maximum allowed clock skew between device and server (seconds). */
const MAX_TIMESTAMP_SKEW_SECONDS = 300;
/** Maximum nonces retained per device for replay detection. */
const MAX_NONCE_HISTORY = 200;
/** Device record TTL in days — matches default tenant retentionDays setting. */
const DEVICE_TTL_DAYS = 90;

// ─── Input validation schema ──────────────────────────────────────────────────

const HeartbeatSchema = z.object({
  tenantId: z.string().uuid(),
  agentVersions: z.record(z.string()).default({}),
  systemInfo: z
    .object({
      uptimeSeconds: z.number().nonnegative(),
      memoryMB: z.number().nonnegative(),
      cpuPercent: z.number().min(0).max(100),
    })
    .optional(),
  nonce: z.string().uuid(),
  timestamp: z.string().datetime({ offset: true }),
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

// ─── Handler ─────────────────────────────────────────────────────────────────

/**
 * Lambda handler for POST /v1/devices/{deviceId}/heartbeat.
 *
 * Validates replay-prevention nonce and timestamp, updates the device record's
 * lastSeen / agentVersions, and enqueues an async health event for metric
 * processing.
 */
export const handler = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> => {
  const requestId = event.requestContext.requestId;
  const deviceId = event.pathParameters?.['deviceId'];

  if (!deviceId) {
    return errorResponse(400, 'VALIDATION_ERROR', 'deviceId path parameter is required', requestId);
  }

  let rawBody: unknown;
  try {
    rawBody = JSON.parse(event.body ?? '{}');
  } catch {
    return errorResponse(400, 'VALIDATION_ERROR', 'Request body is not valid JSON', requestId);
  }

  const parsed = HeartbeatSchema.safeParse(rawBody);
  if (!parsed.success) {
    const message = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    return errorResponse(400, 'VALIDATION_ERROR', message, requestId);
  }

  const { tenantId, agentVersions, systemInfo, nonce, timestamp } = parsed.data;

  // ── Timestamp skew check ──────────────────────────────────────────────────
  const requestTime = new Date(timestamp).getTime();
  const serverTime = Date.now();
  const skewSeconds = Math.abs(serverTime - requestTime) / 1000;

  if (skewSeconds > MAX_TIMESTAMP_SKEW_SECONDS) {
    return errorResponse(
      400,
      'TIMESTAMP_SKEW',
      `Request timestamp is skewed by ${Math.round(skewSeconds)}s (max ${MAX_TIMESTAMP_SKEW_SECONDS}s)`,
      requestId,
    );
  }

  try {
    // ── Fetch device ──────────────────────────────────────────────────────
    const deviceResult = await docClient.send(
      new GetCommand({
        TableName: DEVICES_TABLE,
        Key: { tenantId, deviceId },
        ProjectionExpression: '#s, nonceHistory',
        ExpressionAttributeNames: { '#s': 'status' },
      }),
    );

    if (!deviceResult.Item) {
      return errorResponse(403, 'DEVICE_NOT_FOUND', 'Device not found', requestId);
    }

    const device = deviceResult.Item as Pick<Device, 'status'> & { nonceHistory?: string[] };

    if (device.status === 'suspended') {
      return errorResponse(403, 'DEVICE_SUSPENDED', 'Device is suspended', requestId);
    }

    if (device.status === 'decommissioned') {
      return errorResponse(403, 'DEVICE_NOT_FOUND', 'Device is decommissioned', requestId);
    }

    // ── Replay detection ──────────────────────────────────────────────────
    const nonceHistory: string[] = device.nonceHistory ?? [];
    if (nonceHistory.includes(nonce)) {
      return errorResponse(400, 'REPLAY_DETECTED', 'Nonce has already been used', requestId);
    }

    const now = new Date().toISOString();
    const nowEpoch = Math.floor(Date.now() / 1000);

    // Keep the most recent MAX_NONCE_HISTORY nonces
    const updatedNonces = [...nonceHistory, nonce].slice(-MAX_NONCE_HISTORY);

    // ── Update device in DynamoDB ─────────────────────────────────────────
    const updateExpression = [
      'SET lastSeen = :now',
      'agentVersions = :av',
      'updatedAt = :now',
      '#ttl = :ttl',
      'nonceHistory = :nonces',
      systemInfo ? 'systemInfo = :si' : null,
    ]
      .filter(Boolean)
      .join(', ');

    const expressionValues: Record<string, unknown> = {
      ':now': now,
      ':av': agentVersions,
      ':ttl': nowEpoch + DEVICE_TTL_DAYS * 24 * 60 * 60,
      ':nonces': updatedNonces,
    };
    if (systemInfo) {
      expressionValues[':si'] = systemInfo;
    }

    await docClient.send(
      new UpdateCommand({
        TableName: DEVICES_TABLE,
        Key: { tenantId, deviceId },
        UpdateExpression: updateExpression,
        ExpressionAttributeNames: { '#ttl': 'ttl' },
        ExpressionAttributeValues: expressionValues,
      }),
    );

    // ── Enqueue async health event ────────────────────────────────────────
    if (HEALTH_QUEUE_URL) {
      const healthEvent: HeartbeatEvent = {
        tenantId,
        deviceId,
        agentVersions,
        systemInfo,
        timestamp,
        receivedAt: now,
      };

      await sqsClient.send(
        new SendMessageCommand({
          QueueUrl: HEALTH_QUEUE_URL,
          MessageBody: JSON.stringify(healthEvent),
          MessageGroupId: `${tenantId}#${deviceId}`,
          MessageDeduplicationId: nonce,
        }),
      );
    }

    const response: HeartbeatResponse = {
      serverTimestamp: now,
      status: 'ok',
    };
    return jsonResponse(200, response);
  } catch (err) {
    console.error('heartbeat handler error', {
      requestId,
      tenantId,
      deviceId,
      error: err instanceof Error ? err.message : String(err),
    });
    return errorResponse(500, 'INTERNAL_ERROR', 'An unexpected error occurred', requestId);
  }
};
