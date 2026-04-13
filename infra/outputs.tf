output "api_endpoint" {
  description = "HTTP API Gateway endpoint URL"
  value       = module.api.api_endpoint
}

output "cloudfront_domain" {
  description = "CloudFront distribution domain name"
  value       = module.cdn.distribution_domain
}

output "cognito_user_pool_id" {
  description = "Cognito User Pool ID"
  value       = module.auth.user_pool_id
}

output "cognito_client_id" {
  description = "Cognito User Pool Client ID"
  value       = module.auth.user_pool_client_id
}

output "artifacts_bucket" {
  description = "S3 bucket name for Lambda/agent artifacts"
  value       = module.storage.artifacts_bucket_name
}

output "frontend_bucket" {
  description = "S3 bucket name for frontend static files"
  value       = module.storage.frontend_bucket_name
}
