output "service_url" {
  description = "Base URL of the API. Put this in Malafat's malafat-web-mutaba3a-api-url secret (MUTABA3A_API_URL)."
  value       = google_cloud_run_v2_service.api.uri
}

output "service_name" {
  value = google_cloud_run_v2_service.api.name
}

output "migrate_job_name" {
  description = "Cloud Run job to execute before each rollout: gcloud run jobs execute <name> --wait"
  value       = google_cloud_run_v2_job.migrate.name
}

output "cloud_sql_connection_name" {
  value = google_sql_database_instance.postgres.connection_name
}

output "artifact_registry" {
  description = "Image prefix: <registry>/mutaba3a-api:<tag> and <registry>/mutaba3a-api-migrate:<tag>"
  value       = local.registry
}

output "service_account_email" {
  value = google_service_account.api.email
}

output "admin_token_secret" {
  description = "Secret Manager id of the operator token. Read it with: gcloud secrets versions access latest --secret=<id>"
  value       = google_secret_manager_secret.admin_token.secret_id
}

output "database_url_secret" {
  value = google_secret_manager_secret.database_url.secret_id
}

output "key_environment" {
  description = "live or test — which API keys this deployment issues and accepts."
  value       = local.key_environment
}
