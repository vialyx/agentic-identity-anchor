import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client } from '@aws-sdk/client-s3';
import type { APIGatewayProxyEvent } from 'aws-lambda';

// Mock DynamoDB and S3 before importing handler
const ddbMock = mockClient(DynamoDBDocumentClient);
const s3Mock = mockClient(S3Client);

jest.mock('../src/db/client', () => {
  const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
  const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
  return {
    docClient: DynamoDBDocumentClient.from(new DynamoDBClient({})),
    TENANTS_TABLE: 'anchor-tenants',
    DEVICES_TABLE: 'anchor-devices',
    GROUPS_TABLE: 'anchor-groups',
    AGENT_VERSIONS_TABLE: 'anchor-agent-versions',
    DEPLOYMENT_POLICIES_TABLE: 'anchor-deployment-policies',
  };
});

// Mock getSignedUrl to avoid actual AWS credential calls
jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: jest.fn().mockResolvedValue('https://s3.example.com/presigned-url'),
}));

import { handler } from '../src/handlers/policy';

// ─── Test helpers ─────────────────────────────────────────────────────────────

const TENANT_ID = '550e8400-e29b-41d4-a716-446655440000';
const DEVICE_ID = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
const GROUP_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const POLICY_ID = 'cccccccc-dddd-eeee-ffff-000000000000';

function buildEvent(deviceId: string, queryParams: Record<string, string> = {}): APIGatewayProxyEvent {
  return {
    body: null,
    headers: {},
    multiValueHeaders: {},
    httpMethod: 'GET',
    isBase64Encoded: false,
    path: `/v1/devices/${deviceId}/policy`,
    pathParameters: { deviceId },
    queryStringParameters: queryParams,
    multiValueQueryStringParameters: null,
    stageVariables: null,
    resource: '/v1/devices/{deviceId}/policy',
    requestContext: {
      requestId: 'test-request-id',
      accountId: '123456789012',
      apiId: 'test-api',
      authorizer: {},
      httpMethod: 'GET',
      identity: {
        accessKey: null,
        accountId: null,
        apiKey: null,
        apiKeyId: null,
        caller: null,
        clientCert: null,
        cognitoAuthenticationProvider: null,
        cognitoAuthenticationType: null,
        cognitoIdentityId: null,
        cognitoIdentityPoolId: null,
        principalOrgId: null,
        sourceIp: '127.0.0.1',
        user: null,
        userAgent: 'test',
        userArn: null,
      },
      path: `/v1/devices/${deviceId}/policy`,
      protocol: 'HTTP/1.1',
      requestTime: '',
      requestTimeEpoch: 0,
      resourceId: '',
      resourcePath: '/v1/devices/{deviceId}/policy',
      stage: 'test',
    },
  } as APIGatewayProxyEvent;
}

const ACTIVE_DEVICE = {
  tenantId: TENANT_ID,
  deviceId: DEVICE_ID,
  hostname: 'test-host',
  os: 'linux',
  arch: 'amd64',
  status: 'active',
  groupId: GROUP_ID,
  certThumbprint: 'a'.repeat(64),
  agentVersions: { anchor: '1.0.0' },
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
  lastSeen: '2024-01-01T00:00:00Z',
};

const ACTIVE_GROUP = {
  tenantId: TENANT_ID,
  groupId: GROUP_ID,
  name: 'default',
  isDefault: true,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
  policy: { maxConcurrent: 10 },
  deviceCount: 1,
};

const ACTIVE_POLICY = {
  tenantId: TENANT_ID,
  policyId: POLICY_ID,
  groupId: GROUP_ID,
  agentId: 'anchor',
  targetVersion: '1.2.0',
  strategy: 'immediate',
  status: 'active',
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
  createdBy: 'admin',
};

const AGENT_VERSION = {
  agentId: 'anchor',
  version: '1.2.0#linux#amd64',
  platform: 'linux',
  arch: 'amd64',
  s3Key: 'agents/anchor/1.2.0/linux/amd64/anchor',
  sha256: 'b'.repeat(64),
  signatureS3Key: 'agents/anchor/1.2.0/linux/amd64/anchor.bundle',
  stable: true,
  publishedAt: '2024-01-01T00:00:00Z',
  publishedBy: 'ci',
};

// ─── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  ddbMock.reset();
  s3Mock.reset();
  jest.clearAllMocks();
});

describe('policy handler', () => {
  describe('device with active policy', () => {
    it('returns 200 with agents array and presigned URLs', async () => {
      ddbMock.on(GetCommand, { TableName: 'anchor-devices' }).resolves({ Item: ACTIVE_DEVICE });
      ddbMock.on(GetCommand, { TableName: 'anchor-groups' }).resolves({ Item: ACTIVE_GROUP });
      ddbMock.on(QueryCommand, { TableName: 'anchor-deployment-policies' }).resolves({
        Items: [ACTIVE_POLICY],
      });
      ddbMock.on(GetCommand, { TableName: 'anchor-agent-versions' }).resolves({ Item: AGENT_VERSION });

      const result = await handler(buildEvent(DEVICE_ID, { tenantId: TENANT_ID }));

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body) as {
        deviceId: string;
        groupId: string;
        policyId: string;
        agents: Array<{ agentId: string; targetVersion: string; downloadUrl: string; sha256: string }>;
        strategy: string;
      };

      expect(body.deviceId).toBe(DEVICE_ID);
      expect(body.groupId).toBe(GROUP_ID);
      expect(body.policyId).toBe(POLICY_ID);
      expect(body.strategy).toBe('immediate');
      expect(body.agents).toHaveLength(1);
      expect(body.agents[0]?.agentId).toBe('anchor');
      expect(body.agents[0]?.targetVersion).toBe('1.2.0');
      expect(body.agents[0]?.sha256).toBe('b'.repeat(64));
      expect(body.agents[0]?.downloadUrl).toBe('https://s3.example.com/presigned-url');
    });
  });

  describe('device without active policy (default / no policy)', () => {
    it('returns 200 with empty agents array when no policy targets the group', async () => {
      ddbMock.on(GetCommand, { TableName: 'anchor-devices' }).resolves({ Item: ACTIVE_DEVICE });
      ddbMock.on(GetCommand, { TableName: 'anchor-groups' }).resolves({ Item: ACTIVE_GROUP });
      // No active policy
      ddbMock.on(QueryCommand).resolves({ Items: [] });

      const result = await handler(buildEvent(DEVICE_ID, { tenantId: TENANT_ID }));

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body) as {
        policyId: null;
        agents: unknown[];
      };
      expect(body.policyId).toBeNull();
      expect(body.agents).toHaveLength(0);
    });

    it('returns 200 with empty agents array when group has no matching agent version', async () => {
      ddbMock.on(GetCommand, { TableName: 'anchor-devices' }).resolves({ Item: ACTIVE_DEVICE });
      ddbMock.on(GetCommand, { TableName: 'anchor-groups' }).resolves({ Item: ACTIVE_GROUP });
      ddbMock.on(QueryCommand).resolves({ Items: [ACTIVE_POLICY] });
      // Agent version not found for this platform/arch
      ddbMock.on(GetCommand, { TableName: 'anchor-agent-versions' }).resolves({ Item: undefined });

      const result = await handler(buildEvent(DEVICE_ID, { tenantId: TENANT_ID }));

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body) as { agents: unknown[] };
      expect(body.agents).toHaveLength(0);
    });
  });

  describe('missing device', () => {
    it('returns 403 DEVICE_NOT_FOUND when device does not exist', async () => {
      ddbMock.on(GetCommand, { TableName: 'anchor-devices' }).resolves({ Item: undefined });

      const result = await handler(buildEvent(DEVICE_ID, { tenantId: TENANT_ID }));

      expect(result.statusCode).toBe(403);
      const body = JSON.parse(result.body) as { error: { code: string } };
      expect(body.error.code).toBe('DEVICE_NOT_FOUND');
    });

    it('returns 403 DEVICE_SUSPENDED when device is suspended', async () => {
      ddbMock.on(GetCommand, { TableName: 'anchor-devices' }).resolves({
        Item: { ...ACTIVE_DEVICE, status: 'suspended' },
      });

      const result = await handler(buildEvent(DEVICE_ID, { tenantId: TENANT_ID }));

      expect(result.statusCode).toBe(403);
      const body = JSON.parse(result.body) as { error: { code: string } };
      expect(body.error.code).toBe('DEVICE_SUSPENDED');
    });
  });

  describe('missing parameters', () => {
    it('returns 400 when tenantId query param is missing', async () => {
      const result = await handler(buildEvent(DEVICE_ID));
      expect(result.statusCode).toBe(400);
    });

    it('returns 400 when deviceId path param is missing', async () => {
      const event = buildEvent('');
      event.pathParameters = null;
      const result = await handler(event);
      expect(result.statusCode).toBe(400);
    });
  });
});
