variable "project_name" { type = string }
variable "environment" { type = string }
variable "aws_region" { type = string }
variable "lambda_zip_path" { type = string }
variable "allowed_origins" { type = list(string) }

variable "tenants_table_name" { type = string }
variable "tenants_table_arn" { type = string }
variable "devices_table_name" { type = string }
variable "devices_table_arn" { type = string }
variable "groups_table_name" { type = string }
variable "groups_table_arn" { type = string }
variable "agent_versions_table_name" { type = string }
variable "agent_versions_table_arn" { type = string }
variable "deployment_policies_table_name" { type = string }
variable "deployment_policies_table_arn" { type = string }
variable "nonces_table_name" { type = string }
variable "nonces_table_arn" { type = string }
variable "artifacts_bucket_arn" { type = string }
variable "artifacts_bucket_name" { type = string }
variable "kms_key_arn" { type = string }

variable "cognito_user_pool_endpoint" { type = string }
variable "cognito_user_pool_arn" { type = string }

variable "health_queue_url" { type = string }
variable "health_queue_arn" { type = string }
