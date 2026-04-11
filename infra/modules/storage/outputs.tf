output "kms_key_arn" {
  value = aws_kms_key.dynamodb.arn
}

output "tenants_table_name" {
  value = aws_dynamodb_table.tenants.name
}

output "tenants_table_arn" {
  value = aws_dynamodb_table.tenants.arn
}

output "devices_table_name" {
  value = aws_dynamodb_table.devices.name
}

output "devices_table_arn" {
  value = aws_dynamodb_table.devices.arn
}

output "groups_table_name" {
  value = aws_dynamodb_table.groups.name
}

output "groups_table_arn" {
  value = aws_dynamodb_table.groups.arn
}

output "agent_versions_table_name" {
  value = aws_dynamodb_table.agent_versions.name
}

output "agent_versions_table_arn" {
  value = aws_dynamodb_table.agent_versions.arn
}

output "deployment_policies_table_name" {
  value = aws_dynamodb_table.deployment_policies.name
}

output "deployment_policies_table_arn" {
  value = aws_dynamodb_table.deployment_policies.arn
}

output "nonces_table_name" {
  value = aws_dynamodb_table.nonces.name
}

output "nonces_table_arn" {
  value = aws_dynamodb_table.nonces.arn
}

output "artifacts_bucket_name" {
  value = aws_s3_bucket.artifacts.bucket
}

output "artifacts_bucket_arn" {
  value = aws_s3_bucket.artifacts.arn
}

output "frontend_bucket_id" {
  value = aws_s3_bucket.frontend.id
}

output "frontend_bucket_arn" {
  value = aws_s3_bucket.frontend.arn
}

output "frontend_bucket_name" {
  value = aws_s3_bucket.frontend.bucket
}

output "frontend_bucket_domain" {
  value = aws_s3_bucket.frontend.bucket_regional_domain_name
}
