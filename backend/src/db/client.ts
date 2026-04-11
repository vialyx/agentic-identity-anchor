import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

/**
 * Singleton DynamoDB DocumentClient shared across all Lambda invocations
 * within the same execution environment.
 */
const rawClient = new DynamoDBClient({
  region: process.env['AWS_REGION'] ?? 'us-east-1',
});

export const docClient = DynamoDBDocumentClient.from(rawClient, {
  marshallOptions: {
    removeUndefinedValues: true,
    convertEmptyValues: false,
  },
});

// ─── Table name constants ─────────────────────────────────────────────────────

/** DynamoDB table for tenant accounts. */
export const TENANTS_TABLE = process.env['TENANTS_TABLE'] ?? 'anchor-tenants';

/** DynamoDB table for registered devices. */
export const DEVICES_TABLE = process.env['DEVICES_TABLE'] ?? 'anchor-devices';

/** DynamoDB table for device groups. */
export const GROUPS_TABLE = process.env['GROUPS_TABLE'] ?? 'anchor-groups';

/** DynamoDB table for published agent binary versions. */
export const AGENT_VERSIONS_TABLE =
  process.env['AGENT_VERSIONS_TABLE'] ?? 'anchor-agent-versions';

/** DynamoDB table for deployment policies. */
export const DEPLOYMENT_POLICIES_TABLE =
  process.env['DEPLOYMENT_POLICIES_TABLE'] ?? 'anchor-deployment-policies';
