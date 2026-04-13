locals {
  env_vars = {
    TENANTS_TABLE                       = var.tenants_table_name
    DEVICES_TABLE                       = var.devices_table_name
    GROUPS_TABLE                        = var.groups_table_name
    AGENT_VERSIONS_TABLE                = var.agent_versions_table_name
    DEPLOYMENT_POLICIES_TABLE           = var.deployment_policies_table_name
    NONCES_TABLE                        = var.nonces_table_name
    ARTIFACTS_BUCKET                    = var.artifacts_bucket_name
    HEALTH_QUEUE_URL                    = var.health_queue_url
    AWS_NODEJS_CONNECTION_REUSE_ENABLED = "1"
  }

  lambda_functions = {
    register = {
      handler = "dist/handlers/register.handler"
      memory  = 128
      timeout = 30
    }
    heartbeat = {
      handler = "dist/handlers/heartbeat.handler"
      memory  = 128
      timeout = 30
    }
    policy = {
      handler = "dist/handlers/policy.handler"
      memory  = 128
      timeout = 30
    }
    tenants = {
      handler = "dist/handlers/tenants.handler"
      memory  = 128
      timeout = 30
    }
    groups = {
      handler = "dist/handlers/groups.handler"
      memory  = 128
      timeout = 30
    }
    agents = {
      handler = "dist/handlers/agents.handler"
      memory  = 128
      timeout = 30
    }
    deployments = {
      handler = "dist/handlers/deployments.handler"
      memory  = 128
      timeout = 30
    }
  }
}

# ── IAM Role ─────────────────────────────────────────────────────────────────

data "aws_iam_policy_document" "lambda_assume_role" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "lambda" {
  name               = "${var.project_name}-lambda-${var.environment}"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume_role.json
}

data "aws_iam_policy_document" "lambda_permissions" {
  statement {
    sid = "DynamoDB"
    actions = [
      "dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem",
      "dynamodb:DeleteItem", "dynamodb:Query", "dynamodb:Scan",
      "dynamodb:BatchGetItem", "dynamodb:BatchWriteItem",
    ]
    resources = [
      var.tenants_table_arn,
      var.devices_table_arn,
      "${var.devices_table_arn}/index/*",
      var.groups_table_arn,
      var.agent_versions_table_arn,
      "${var.agent_versions_table_arn}/index/*",
      var.deployment_policies_table_arn,
      var.nonces_table_arn,
    ]
  }

  statement {
    sid     = "S3Artifacts"
    actions = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject", "s3:ListBucket"]
    resources = [
      var.artifacts_bucket_arn,
      "${var.artifacts_bucket_arn}/*",
    ]
  }

  statement {
    sid       = "SQS"
    actions   = ["sqs:SendMessage", "sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes"]
    resources = [var.health_queue_arn]
  }

  statement {
    sid       = "KMS"
    actions   = ["kms:Decrypt", "kms:GenerateDataKey"]
    resources = [var.kms_key_arn]
  }

  statement {
    sid = "CloudWatchLogs"
    actions = [
      "logs:CreateLogGroup",
      "logs:CreateLogStream",
      "logs:PutLogEvents",
    ]
    resources = ["arn:aws:logs:*:*:*"]
  }
}

resource "aws_iam_role_policy" "lambda" {
  name   = "${var.project_name}-lambda-policy-${var.environment}"
  role   = aws_iam_role.lambda.id
  policy = data.aws_iam_policy_document.lambda_permissions.json
}

# ── Lambda Functions ──────────────────────────────────────────────────────────

resource "aws_cloudwatch_log_group" "lambda" {
  for_each          = local.lambda_functions
  name              = "/aws/lambda/${var.project_name}-${each.key}-${var.environment}"
  retention_in_days = 14
}

resource "aws_lambda_function" "api" {
  for_each = local.lambda_functions

  function_name = "${var.project_name}-${each.key}-${var.environment}"
  filename      = var.lambda_zip_path
  handler       = each.value.handler
  runtime       = "nodejs20.x"
  role          = aws_iam_role.lambda.arn
  memory_size   = each.value.memory
  timeout       = each.value.timeout

  environment {
    variables = local.env_vars
  }

  depends_on = [aws_cloudwatch_log_group.lambda]
}

resource "aws_cloudwatch_log_group" "health_processor" {
  name              = "/aws/lambda/${var.project_name}-health-processor-${var.environment}"
  retention_in_days = 14
}

resource "aws_lambda_function" "health_processor" {
  function_name = "${var.project_name}-health-processor-${var.environment}"
  filename      = var.lambda_zip_path
  handler       = "dist/handlers/health-processor.handler"
  runtime       = "nodejs20.x"
  role          = aws_iam_role.lambda.arn
  memory_size   = 256
  timeout       = 60

  environment {
    variables = local.env_vars
  }

  depends_on = [aws_cloudwatch_log_group.health_processor]
}

resource "aws_lambda_event_source_mapping" "health_sqs" {
  event_source_arn = var.health_queue_arn
  function_name    = aws_lambda_function.health_processor.arn
  batch_size       = 10
  enabled          = true
}

# ── Custom Authorizer Lambda ──────────────────────────────────────────────────

resource "aws_cloudwatch_log_group" "mtls_authorizer" {
  name              = "/aws/lambda/${var.project_name}-mtls-authorizer-${var.environment}"
  retention_in_days = 14
}

resource "aws_lambda_function" "mtls_authorizer" {
  function_name = "${var.project_name}-mtls-authorizer-${var.environment}"
  filename      = var.lambda_zip_path
  handler       = "dist/handlers/mtls-authorizer.handler"
  runtime       = "nodejs20.x"
  role          = aws_iam_role.lambda.arn
  memory_size   = 128
  timeout       = 10

  environment {
    variables = local.env_vars
  }

  depends_on = [aws_cloudwatch_log_group.mtls_authorizer]
}

# ── API Gateway v2 ────────────────────────────────────────────────────────────

resource "aws_apigatewayv2_api" "main" {
  name          = "${var.project_name}-api-${var.environment}"
  protocol_type = "HTTP"

  cors_configuration {
    allow_origins = var.allowed_origins
    allow_methods = ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"]
    allow_headers = ["Content-Type", "Authorization", "X-Tenant-Id"]
    max_age       = 300
  }
}

resource "aws_cloudwatch_log_group" "api_gw" {
  name              = "/aws/apigateway/${var.project_name}-${var.environment}"
  retention_in_days = 14
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.main.id
  name        = "$default"
  auto_deploy = true

  access_log_settings {
    destination_arn = aws_cloudwatch_log_group.api_gw.arn
    format = jsonencode({
      requestId               = "$context.requestId"
      ip                      = "$context.identity.sourceIp"
      requestTime             = "$context.requestTime"
      httpMethod              = "$context.httpMethod"
      routeKey                = "$context.routeKey"
      status                  = "$context.status"
      protocol                = "$context.protocol"
      responseLength          = "$context.responseLength"
      integrationErrorMessage = "$context.integrationErrorMessage"
    })
  }
}

# JWT Authorizer (Cognito)
resource "aws_apigatewayv2_authorizer" "cognito" {
  api_id           = aws_apigatewayv2_api.main.id
  authorizer_type  = "JWT"
  identity_sources = ["$request.header.Authorization"]
  name             = "cognito-jwt"

  jwt_configuration {
    audience = []
    issuer   = "https://${var.cognito_user_pool_endpoint}"
  }
}

# Lambda authorizer for mTLS device routes
resource "aws_apigatewayv2_authorizer" "mtls" {
  api_id                            = aws_apigatewayv2_api.main.id
  authorizer_type                   = "REQUEST"
  authorizer_uri                    = aws_lambda_function.mtls_authorizer.invoke_arn
  identity_sources                  = ["$request.header.X-Client-Cert"]
  name                              = "mtls-authorizer"
  authorizer_payload_format_version = "2.0"
  enable_simple_responses           = true
}

resource "aws_lambda_permission" "mtls_authorizer_apigw" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.mtls_authorizer.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.main.execution_arn}/*/*"
}

# Lambda integrations for each function
resource "aws_apigatewayv2_integration" "api" {
  for_each = local.lambda_functions

  api_id                 = aws_apigatewayv2_api.main.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.api[each.key].invoke_arn
  payload_format_version = "2.0"
}

resource "aws_lambda_permission" "api" {
  for_each = local.lambda_functions

  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.api[each.key].function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.main.execution_arn}/*/*"
}

# Routes — device routes use mTLS authorizer, others use Cognito JWT
locals {
  # Routes: key = "METHOD /path", value = integration key
  cognito_routes = {
    "GET /v1/tenants"                              = "tenants"
    "POST /v1/tenants"                             = "tenants"
    "GET /v1/tenants/{tenantId}"                   = "tenants"
    "GET /v1/groups"                               = "groups"
    "POST /v1/groups"                              = "groups"
    "GET /v1/groups/{groupId}"                     = "groups"
    "GET /v1/agents"                               = "agents"
    "POST /v1/agents"                              = "agents"
    "GET /v1/agents/{agentId}"                     = "agents"
    "GET /v1/deployments"                          = "deployments"
    "POST /v1/deployments"                         = "deployments"
    "GET /v1/deployments/{deploymentId}"           = "deployments"
    "POST /v1/deployments/{deploymentId}/rollback" = "deployments"
    "GET /v1/policy"                               = "policy"
    "PUT /v1/policy"                               = "policy"
  }

  mtls_routes = {
    "POST /v1/devices/register"  = "register"
    "POST /v1/devices/heartbeat" = "heartbeat"
  }
}

resource "aws_apigatewayv2_route" "cognito" {
  for_each = local.cognito_routes

  api_id             = aws_apigatewayv2_api.main.id
  route_key          = each.key
  target             = "integrations/${aws_apigatewayv2_integration.api[each.value].id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

resource "aws_apigatewayv2_route" "mtls" {
  for_each = local.mtls_routes

  api_id             = aws_apigatewayv2_api.main.id
  route_key          = each.key
  target             = "integrations/${aws_apigatewayv2_integration.api[each.value].id}"
  authorization_type = "CUSTOM"
  authorizer_id      = aws_apigatewayv2_authorizer.mtls.id
}
