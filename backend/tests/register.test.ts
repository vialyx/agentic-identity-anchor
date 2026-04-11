import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type { APIGatewayProxyEvent } from 'aws-lambda';

// Mock the DynamoDB DocumentClient before importing the handler
const ddbMock = mockClient(DynamoDBDocumentClient);

// We need to mock the db/client module so the handler uses our mocked docClient
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

import { handler } from '../src/handlers/register';

// ─── Test helpers ─────────────────────────────────────────────────────────────

function buildEvent(body: unknown): APIGatewayProxyEvent {
  return {
    body: JSON.stringify(body),
    headers: {},
    multiValueHeaders: {},
    httpMethod: 'POST',
    isBase64Encoded: false,
    path: '/v1/devices/register',
    pathParameters: null,
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    stageVariables: null,
    resource: '/v1/devices/register',
    requestContext: {
      requestId: 'test-request-id',
      accountId: '123456789012',
      apiId: 'test-api',
      authorizer: {},
      httpMethod: 'POST',
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
      path: '/v1/devices/register',
      protocol: 'HTTP/1.1',
      requestTime: '',
      requestTimeEpoch: 0,
      resourceId: '',
      resourcePath: '/v1/devices/register',
      stage: 'test',
    },
  } as APIGatewayProxyEvent;
}

const VALID_BODY = {
  tenantId: '550e8400-e29b-41d4-a716-446655440000',
  deviceId: '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
  hostname: 'test-device-1',
  os: 'linux',
  arch: 'amd64',
  certThumbprint: 'a'.repeat(64),
};

// ─── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  ddbMock.reset();
});

describe('register handler', () => {
  describe('successful registration', () => {
    it('returns 201 with deviceId and groupId for a new device', async () => {
      const defaultGroupId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

      // Tenant GetItem → active tenant
      ddbMock.on(GetCommand, { TableName: 'anchor-tenants' }).resolves({
        Item: { status: 'active', defaultGroupId },
      });

      // Device GetItem → not found (new device)
      ddbMock.on(GetCommand, { TableName: 'anchor-devices' }).resolves({ Item: undefined });

      // Group GetItem → default group exists
      ddbMock.on(GetCommand, { TableName: 'anchor-groups' }).resolves({
        Item: { groupId: defaultGroupId, tenantId: VALID_BODY.tenantId, name: 'default' },
      });

      // PutItem → success
      ddbMock.on(PutCommand).resolves({});

      // UpdateCommand → tenant deviceCount increment
      ddbMock.on(UpdateCommand).resolves({});

      const result = await handler(buildEvent(VALID_BODY));

      expect(result.statusCode).toBe(201);
      const body = JSON.parse(result.body) as { deviceId: string; groupId: string; status: string };
      expect(body.deviceId).toBe(VALID_BODY.deviceId);
      expect(body.groupId).toBe(defaultGroupId);
      expect(body.status).toBe('active');
      expect(body).toHaveProperty('createdAt');
    });
  });

  describe('duplicate registration (re-registration)', () => {
    it('returns 200 when device re-registers with the same cert thumbprint', async () => {
      const groupId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

      ddbMock.on(GetCommand, { TableName: 'anchor-tenants' }).resolves({
        Item: { status: 'active', defaultGroupId: groupId },
      });

      // Device exists with matching thumbprint
      ddbMock.on(GetCommand, { TableName: 'anchor-devices' }).resolves({
        Item: {
          certThumbprint: VALID_BODY.certThumbprint.toLowerCase(),
          groupId,
          status: 'active',
        },
      });

      ddbMock.on(UpdateCommand).resolves({});

      const result = await handler(buildEvent(VALID_BODY));

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body) as { deviceId: string; status: string };
      expect(body.deviceId).toBe(VALID_BODY.deviceId);
      expect(body.status).toBe('active');
      expect(body).toHaveProperty('updatedAt');
    });

    it('returns 403 CERT_MISMATCH when re-registering with a different thumbprint', async () => {
      const groupId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

      ddbMock.on(GetCommand, { TableName: 'anchor-tenants' }).resolves({
        Item: { status: 'active', defaultGroupId: groupId },
      });

      // Device exists with a DIFFERENT thumbprint
      ddbMock.on(GetCommand, { TableName: 'anchor-devices' }).resolves({
        Item: {
          certThumbprint: 'b'.repeat(64),
          groupId,
          status: 'active',
        },
      });

      const result = await handler(buildEvent(VALID_BODY));

      expect(result.statusCode).toBe(403);
      const body = JSON.parse(result.body) as { error: { code: string } };
      expect(body.error.code).toBe('CERT_MISMATCH');
    });
  });

  describe('invalid tenant', () => {
    it('returns 403 TENANT_NOT_FOUND when tenant does not exist', async () => {
      ddbMock.on(GetCommand, { TableName: 'anchor-tenants' }).resolves({ Item: undefined });

      const result = await handler(buildEvent(VALID_BODY));

      expect(result.statusCode).toBe(403);
      const body = JSON.parse(result.body) as { error: { code: string } };
      expect(body.error.code).toBe('TENANT_NOT_FOUND');
    });

    it('returns 403 TENANT_NOT_FOUND when tenant is suspended', async () => {
      ddbMock.on(GetCommand, { TableName: 'anchor-tenants' }).resolves({
        Item: { status: 'suspended', defaultGroupId: 'some-group-id' },
      });

      const result = await handler(buildEvent(VALID_BODY));

      expect(result.statusCode).toBe(403);
      const body = JSON.parse(result.body) as { error: { code: string } };
      expect(body.error.code).toBe('TENANT_NOT_FOUND');
    });
  });

  describe('missing / invalid fields', () => {
    it('returns 400 VALIDATION_ERROR when tenantId is missing', async () => {
      const { tenantId: _tid, ...bodyWithoutTenantId } = VALID_BODY;
      const result = await handler(buildEvent(bodyWithoutTenantId));
      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body) as { error: { code: string } };
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('returns 400 VALIDATION_ERROR when certThumbprint is not 64 hex chars', async () => {
      const result = await handler(buildEvent({ ...VALID_BODY, certThumbprint: 'tooshort' }));
      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body) as { error: { code: string } };
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('returns 400 VALIDATION_ERROR when os is not a valid enum value', async () => {
      const result = await handler(buildEvent({ ...VALID_BODY, os: 'freebsd' }));
      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body) as { error: { code: string } };
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('returns 400 VALIDATION_ERROR when body is not valid JSON', async () => {
      const event = buildEvent(null);
      event.body = '{not valid json}';
      const result = await handler(event);
      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body) as { error: { code: string } };
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('returns 400 VALIDATION_ERROR when deviceId is not a UUID', async () => {
      const result = await handler(buildEvent({ ...VALID_BODY, deviceId: 'not-a-uuid' }));
      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body) as { error: { code: string } };
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });
  });
});
