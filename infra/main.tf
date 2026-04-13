module "storage" {
  source       = "./modules/storage"
  project_name = var.project_name
  environment  = var.environment
}

module "auth" {
  source       = "./modules/auth"
  project_name = var.project_name
  environment  = var.environment
}

module "messaging" {
  source       = "./modules/messaging"
  project_name = var.project_name
  environment  = var.environment
}

module "api" {
  source          = "./modules/api"
  project_name    = var.project_name
  environment     = var.environment
  lambda_zip_path = var.lambda_zip_path
  allowed_origins = var.allowed_origins
  aws_region      = var.aws_region

  # Storage
  tenants_table_name             = module.storage.tenants_table_name
  tenants_table_arn              = module.storage.tenants_table_arn
  devices_table_name             = module.storage.devices_table_name
  devices_table_arn              = module.storage.devices_table_arn
  groups_table_name              = module.storage.groups_table_name
  groups_table_arn               = module.storage.groups_table_arn
  agent_versions_table_name      = module.storage.agent_versions_table_name
  agent_versions_table_arn       = module.storage.agent_versions_table_arn
  deployment_policies_table_name = module.storage.deployment_policies_table_name
  deployment_policies_table_arn  = module.storage.deployment_policies_table_arn
  nonces_table_name              = module.storage.nonces_table_name
  nonces_table_arn               = module.storage.nonces_table_arn
  artifacts_bucket_arn           = module.storage.artifacts_bucket_arn
  artifacts_bucket_name          = module.storage.artifacts_bucket_name
  kms_key_arn                    = module.storage.kms_key_arn

  # Auth
  cognito_user_pool_endpoint = module.auth.user_pool_endpoint
  cognito_user_pool_arn      = module.auth.user_pool_arn

  # Messaging
  health_queue_url = module.messaging.health_queue_url
  health_queue_arn = module.messaging.health_queue_arn
}

module "cdn" {
  source                          = "./modules/cdn"
  project_name                    = var.project_name
  environment                     = var.environment
  frontend_bucket_id              = module.storage.frontend_bucket_id
  frontend_bucket_arn             = module.storage.frontend_bucket_arn
  frontend_bucket_regional_domain = module.storage.frontend_bucket_domain
  api_endpoint                    = module.api.api_endpoint_host
}
