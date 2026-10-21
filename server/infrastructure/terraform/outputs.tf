output "service_url" {
  description = "Base URL of the API. Put this in Malafat's malafat-web-mutaba3a-api-url secret (MUTABA3A_API_URL)."
  value       = google_cloud_run_v2_service.api.uri
}

output "service_name" {
  value = google_cloud_run_v2_service.api.name
}

output "proxy_port" {
  description = "Local port scripts/deploy.sh gives the Cloud SQL Auth Proxy for migrations."
  value       = local.proxy_port
}

output "local_database_url" {
  description = "DATABASE_URL for `prisma migrate deploy` from the operator's machine while the Cloud SQL Auth Proxy listens on proxy_port. Sensitive."
  value       = "postgresql://${local.db_user}:${random_password.db.result}@127.0.0.1:${local.proxy_port}/${local.db_name}"
  sensitive   = true
}

output "cloud_sql_connection_name" {
  description = "The instance the API serves from: mutaba3a-pg, or mutaba3a-pg2 once cmek_stage is active (MUT-381). deploy.sh and db.sh proxy to it."
  value       = local.active_sql_instance
}

output "cloud_sql_instance_name" {
  description = "Name of the instance the API serves from (MUT-381). The restore drill reads it when --instance is absent."
  value       = local.active_instance_id
}

output "artifact_registry" {
  description = "Image prefix: <registry>/mutaba3a-api:<tag>"
  value       = local.registry
}

output "service_account_email" {
  value = google_service_account.api.email
}

output "admin_token_secret" {
  description = "Secret Manager id of the operator token. Read it with: gcloud secrets versions access latest --secret=<id>"
  value       = google_secret_manager_secret.admin_token.secret_id
}

output "session_pepper_secret" {
  description = "Secret Manager id of the session HMAC key (MUT-38). Never needed by an operator; rotate with -replace=random_password.session_pepper."
  value       = google_secret_manager_secret.session_pepper.secret_id
}

output "database_url_secret" {
  value = google_secret_manager_secret.database_url.secret_id
}

output "key_environment" {
  description = "live or test — which API keys this deployment issues and accepts."
  value       = local.key_environment
}

output "attachments_bucket" {
  description = "Private bucket for Money attachments (M6); the API reaches it as its service account."
  value       = google_storage_bucket.attachments.name
}

output "public_portal_origin" {
  description = "MUT-326: where users reach the portal: the custom domain's portal host from stage live on, else the legacy one (config/hosts.json). deploy.sh smoke-tests it too when it differs from service_url."
  value       = local.public_portal_origin
}

output "uptime_host" {
  description = "Host the uptime checks probe (MUT-328): uptime_host, else the Cloud Run host."
  value       = local.uptime_host
}

output "uptime_check_ids" {
  description = "Uptime check ids by target (health, ready, portal, and drill while uptime_drill_path is set)."
  value       = { for key, check in google_monitoring_uptime_check_config.endpoint : key => check.uptime_check_id }
}

output "alert_sms_channel" {
  description = "Resource name of the SMS notification channel, for the one-time verification in DEPLOYMENT.md §6b. null without alert_sms_number."
  value       = one(google_monitoring_notification_channel.sms[*].name)
}
