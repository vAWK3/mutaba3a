# MUT-710 (ADR-275 D12): the authentication log the SHAAM security appendix (§19) asks for, kept 12 months and encrypted
# at rest. The API writes one structured `auth_event` line per sign-in, two-step, password and Tax Authority event
# (server/src/observability/auth-log.ts); this sink copies those lines from the API's own stdout into a bucket kept
# 365 days. Cloud Logging encrypts buckets at rest with Google-managed AES-256 keys, as Cloud SQL does.
#
# Locking the bucket makes the retention unchangeable and the bucket undeletable (it would also stay behind on a project
# move), so it is an operator step after the first month's check: auth_log_bucket_locked = true.

locals {
  auth_log_bucket = "auth-events${local.suffix}"
  # Pinned to the API service's stdout so no other writer in the project can add lines to the record.
  auth_log_filter = join(" AND ", [
    "logName=\"projects/${var.project_id}/logs/run.googleapis.com%2Fstdout\"",
    "resource.type=\"cloud_run_revision\"",
    "resource.labels.service_name=\"${local.service_name}\"",
    "jsonPayload.event=\"auth_event\"",
  ])
}

resource "google_logging_project_bucket_config" "auth_events" {
  project        = var.project_id
  location       = var.region
  bucket_id      = local.auth_log_bucket
  retention_days = 365
  locked         = var.auth_log_bucket_locked
  description    = "MTB3A authentication events (sign-in, two-step, password, Tax Authority tokens), kept 12 months (SHAAM security appendix §19, MUT-710)."

  lifecycle {
    prevent_destroy = true
  }

  depends_on = [google_project_service.apis]
}

# A sink into a log bucket of the same project needs no IAM grant for its writer identity.
resource "google_logging_project_sink" "auth_events" {
  project                = var.project_id
  name                   = "mutaba3a-auth-events${local.suffix}"
  destination            = "logging.googleapis.com/projects/${var.project_id}/locations/${var.region}/buckets/${google_logging_project_bucket_config.auth_events.bucket_id}"
  filter                 = local.auth_log_filter
  unique_writer_identity = true
}
