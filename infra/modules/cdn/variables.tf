variable "project_name" {
  description = "Project name"
  type        = string
}

variable "environment" {
  description = "Deployment environment"
  type        = string
}

variable "frontend_bucket_id" {
  description = "Frontend S3 bucket ID"
  type        = string
}

variable "frontend_bucket_arn" {
  description = "Frontend S3 bucket ARN"
  type        = string
}

variable "frontend_bucket_regional_domain" {
  description = "Frontend S3 bucket regional domain name"
  type        = string
}

variable "api_endpoint" {
  description = "API Gateway endpoint URL (without https://)"
  type        = string
}
