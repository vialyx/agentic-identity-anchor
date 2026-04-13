variable "aws_region" {
  description = "AWS region to deploy into"
  type        = string
  default     = "us-east-1"
}

variable "environment" {
  description = "Deployment environment (e.g. prod, staging, dev)"
  type        = string
  default     = "prod"
}

variable "project_name" {
  description = "Project name used as a prefix for resources"
  type        = string
  default     = "anchor"
}

variable "lambda_zip_path" {
  description = "Path to the backend Lambda deployment ZIP file"
  type        = string
}

variable "frontend_dist_path" {
  description = "Path to the compiled frontend build directory"
  type        = string
}

variable "allowed_origins" {
  description = "List of allowed CORS origins for the API"
  type        = list(string)
  default     = ["*"]
}
