import type { SQSEvent, SQSRecord, Context } from 'aws-lambda';
import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
import {
  CloudWatchClient,
  PutMetricDataCommand,
  type MetricDatum,
} from '@aws-sdk/client-cloudwatch';
import { docClient, DEVICES_TABLE } from '../db/client';
import type { HeartbeatEvent } from '../types';

const cloudwatch = new CloudWatchClient({ region: process.env['AWS_REGION'] ?? 'us-east-1' });
const CLOUDWATCH_NAMESPACE = process.env['CLOUDWATCH_NAMESPACE'] ?? 'Anchor/Fleet';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Processes a single heartbeat event record: updates detailed device health
 * metrics in DynamoDB and emits CloudWatch custom metrics.
 */
async function processRecord(record: SQSRecord): Promise<void> {
  let event: HeartbeatEvent;

  try {
    event = JSON.parse(record.body) as HeartbeatEvent;
  } catch {
    console.error('health-processor: failed to parse SQS record body', {
      messageId: record.messageId,
    });
    // Do not throw — malformed records should not block the batch.
    return;
  }

  const { tenantId, deviceId, agentVersions, systemInfo, receivedAt } = event;

  if (!tenantId || !deviceId) {
    console.error('health-processor: missing tenantId or deviceId', { messageId: record.messageId });
    return;
  }

  // ── Update device health record ───────────────────────────────────────
  try {
    const updateParts: string[] = ['agentVersions = :av', 'updatedAt = :ts'];
    const exprValues: Record<string, unknown> = {
      ':av': agentVersions,
      ':ts': receivedAt,
    };

    if (systemInfo) {
      updateParts.push('systemInfo = :si');
      exprValues[':si'] = systemInfo;
    }

    await docClient.send(
      new UpdateCommand({
        TableName: DEVICES_TABLE,
        Key: { tenantId, deviceId },
        UpdateExpression: `SET ${updateParts.join(', ')}`,
        ExpressionAttributeValues: exprValues,
        ConditionExpression: 'attribute_exists(deviceId)',
      }),
    );
  } catch (err) {
    if (err instanceof Error && err.name === 'ConditionalCheckFailedException') {
      // Device was decommissioned between heartbeat receipt and processing
      return;
    }
    throw err;
  }

  // ── Emit CloudWatch metrics ───────────────────────────────────────────
  const metricData: MetricDatum[] = [
    {
      MetricName: 'HeartbeatReceived',
      Dimensions: [
        { Name: 'TenantId', Value: tenantId },
        { Name: 'DeviceId', Value: deviceId },
      ],
      Value: 1,
      Unit: 'Count',
      Timestamp: new Date(receivedAt),
    },
  ];

  if (systemInfo) {
    metricData.push(
      {
        MetricName: 'DeviceCpuPercent',
        Dimensions: [
          { Name: 'TenantId', Value: tenantId },
          { Name: 'DeviceId', Value: deviceId },
        ],
        Value: systemInfo.cpuPercent,
        Unit: 'Percent',
        Timestamp: new Date(receivedAt),
      },
      {
        MetricName: 'DeviceMemoryMB',
        Dimensions: [
          { Name: 'TenantId', Value: tenantId },
          { Name: 'DeviceId', Value: deviceId },
        ],
        Value: systemInfo.memoryMB,
        Unit: 'Megabytes',
        Timestamp: new Date(receivedAt),
      },
      {
        MetricName: 'DeviceUptimeSeconds',
        Dimensions: [
          { Name: 'TenantId', Value: tenantId },
          { Name: 'DeviceId', Value: deviceId },
        ],
        Value: systemInfo.uptimeSeconds,
        Unit: 'Seconds',
        Timestamp: new Date(receivedAt),
      },
    );
  }

  await cloudwatch.send(
    new PutMetricDataCommand({
      Namespace: CLOUDWATCH_NAMESPACE,
      MetricData: metricData,
    }),
  );
}

// ─── Handler ─────────────────────────────────────────────────────────────────

/**
 * Lambda handler for SQS health event processing.
 *
 * Processes heartbeat events from the health SQS queue, updating device
 * health metrics in DynamoDB and emitting CloudWatch custom metrics for
 * fleet health dashboards.
 *
 * Uses partial batch failure reporting: successfully processed records are
 * deleted from the queue; failed records remain for retry.
 */
export const handler = async (
  event: SQSEvent,
  _context: Context,
): Promise<{ batchItemFailures: Array<{ itemIdentifier: string }> }> => {
  const failures: Array<{ itemIdentifier: string }> = [];

  await Promise.allSettled(
    event.Records.map(async (record) => {
      try {
        await processRecord(record);
      } catch (err) {
        console.error('health-processor: record processing failed', {
          messageId: record.messageId,
          error: err instanceof Error ? err.message : String(err),
        });
        failures.push({ itemIdentifier: record.messageId });
      }
    }),
  );

  return { batchItemFailures: failures };
};
