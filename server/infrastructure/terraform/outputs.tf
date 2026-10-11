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
  value = google_sql_database_instance.postgres.connection_name
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
