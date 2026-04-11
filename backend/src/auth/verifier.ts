import { GetCommand } from '@aws-sdk/lib-dynamodb';
import { docClient, DEVICES_TABLE } from '../db/client';
import type { Device } from '../types';

/**
 * Verifies that the mTLS client certificate thumbprint presented on an
 * incoming request matches the thumbprint stored in DynamoDB for the given
 * device.
 *
 * This prevents a valid certificate from being reused on behalf of a
 * different device or after a device record has been updated with a new cert.
 *
 * @param thumbprint - Hex-encoded SHA-256 of the DER-encoded client cert.
 * @param tenantId   - Tenant UUID (DynamoDB partition key).
 * @param deviceId   - Device UUID (DynamoDB sort key).
 * @returns `true` if the thumbprint matches and the device is active,
 *          `false` otherwise.
 */
export async function verifyClientCert(
  thumbprint: string,
  tenantId: string,
  deviceId: string,
): Promise<boolean> {
  if (!thumbprint || !tenantId || !deviceId) {
    return false;
  }

  try {
    const result = await docClient.send(
      new GetCommand({
        TableName: DEVICES_TABLE,
        Key: { tenantId, deviceId },
        ProjectionExpression: 'certThumbprint, #s',
        ExpressionAttributeNames: { '#s': 'status' },
      }),
    );

    if (!result.Item) {
      return false;
    }

    const device = result.Item as Pick<Device, 'certThumbprint' | 'status'>;

    if (device.status !== 'active') {
      return false;
    }

    // Normalise to lowercase hex before comparing to avoid case mismatches.
    return device.certThumbprint.toLowerCase() === thumbprint.toLowerCase();
  } catch (err) {
    console.error('verifyClientCert: DynamoDB error', {
      tenantId,
      deviceId,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}
