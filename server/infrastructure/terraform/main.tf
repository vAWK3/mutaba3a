# Mutaba3a hosted API — one environment (staging or production) in one region.
#
# Shape mirrors Malafat's infrastructure/terraform/modules/regional-stack:
# Cloud SQL + Cloud Run + Secret Manager + a dedicated service account, with
# the migration step as a Cloud Run job that runs before each service rollout
# (ADR-025 §9). Terraform owns every resource including the running image tag;
# scripts/deploy.sh builds the images and then applies this with -var image_tag.

locals {
  suffix          = var.environment == "production" ? "" : "-${var.environment}"
  key_environment = var.environment == "production" ? "live" : "test"

  service_name = "mutaba3a-api${local.suffix}"
  job_name     = "mutaba3a-api-migrate${local.suffix}"
  instance_id  = "mutaba3a-pg${local.suffix}"
  db_name      = "mutaba3a"
  db_user      = "mutaba3a_api"

  registry      = "${var.region}-docker.pkg.dev/${var.project_id}/${var.artifact_repository}"
  api_image     = "${local.registry}/mutaba3a-api:${var.image_tag}"
  migrate_image = "${local.registry}/mutaba3a-api-migrate:${var.image_tag}"

  secret_database_url = "mutaba3a-api-database-url${local.suffix}"
  secret_admin_token  = "mutaba3a-api-admin-token${local.suffix}"

  labels = {
    app         = "mutaba3a-api"
    environment = var.environment
    managed-by  = "terraform"
  }
}

# ============================================================================
# APIs
# ============================================================================

resource "google_project_service" "apis" {
  for_each = toset([
    "run.googleapis.com",
    "sqladmin.googleapis.com",
    "secretmanager.googleapis.com",
    "artifactregistry.googleapis.com",
    "cloudbuild.googleapis.com",
    "monitoring.googleapis.com",
  ])
  project            = var.project_id
  service            = each.key
  disable_on_destroy = false
}

# ============================================================================
# Artifact Registry (shared by staging and production in the same project)
# ============================================================================

resource "google_artifact_registry_repository" "images" {
  project       = var.project_id
  location      = var.region
  repository_id = var.artifact_repository
  format        = "DOCKER"
  description   = "Mutaba3a API service and migration images"
  labels        = local.labels

  depends_on = [google_project_service.apis]
}

# ============================================================================
# Cloud SQL PostgreSQL 16
# ============================================================================

resource "random_password" "db" {
  length  = 32
  special = false
}

resource "google_sql_database_instance" "postgres" {
  project          = var.project_id
  name             = local.instance_id
  database_version = "POSTGRES_16"
  region           = var.region

  settings {
    tier              = var.db_tier
    availability_type = var.db_availability
    disk_autoresize   = true
    disk_size         = 10
    user_labels       = local.labels

    backup_configuration {
      enabled                        = var.db_backup_enabled
      point_in_time_recovery_enabled = var.db_backup_enabled
      start_time                     = "03:00"
      transaction_log_retention_days = 7

      backup_retention_settings {
        retained_backups = 14
      }
    }

    # No authorized networks: Cloud Run reaches the instance only through the
    # Cloud SQL connector (unix socket), which authenticates with IAM.
    ip_configuration {
      ipv4_enabled = true
      ssl_mode     = "ENCRYPTED_ONLY"
    }

    maintenance_window {
      day          = 7
      hour         = 3
      update_track = "stable"
    }
  }

  deletion_protection = var.deletion_protection

  depends_on = [google_project_service.apis]
}

resource "google_sql_database" "mutaba3a" {
  project  = var.project_id
  name     = local.db_name
  instance = google_sql_database_instance.postgres.name
}

resource "google_sql_user" "api" {
  project  = var.project_id
  name     = local.db_user
  instance = google_sql_database_instance.postgres.name
  password = random_password.db.result
}

# ============================================================================
# Secret Manager (regional replication keeps the data in-region)
# ============================================================================

resource "google_secret_manager_secret" "database_url" {
  project   = var.project_id
  secret_id = local.secret_database_url
  labels    = local.labels

  replication {
    user_managed {
      replicas {
        location = var.region
      }
    }
  }

  depends_on = [google_project_service.apis]
}

resource "google_secret_manager_secret_version" "database_url" {
  secret      = google_secret_manager_secret.database_url.id
  secret_data = "postgresql://${local.db_user}:${random_password.db.result}@localhost/${local.db_name}?host=/cloudsql/${google_sql_database_instance.postgres.connection_name}"
}

resource "random_password" "admin_token" {
  length  = 48
  special = false
}

resource "google_secret_manager_secret" "admin_token" {
  project   = var.project_id
  secret_id = local.secret_admin_token
  labels    = local.labels

  replication {
    user_managed {
      replicas {
        location = var.region
      }
    }
  }

  depends_on = [google_project_service.apis]
}

resource "google_secret_manager_secret_version" "admin_token" {
  secret      = google_secret_manager_secret.admin_token.id
  secret_data = random_password.admin_token.result
}

# ============================================================================
# Service account and least-privilege IAM
# ============================================================================

resource "google_service_account" "api" {
  project      = var.project_id
  account_id   = "mutaba3a-api${local.suffix}"
  display_name = "Mutaba3a API (${var.environment})"
}

resource "google_project_iam_member" "api_sql_client" {
  project = var.project_id
  role    = "roles/cloudsql.client"
  member  = "serviceAccount:${google_service_account.api.email}"
}

resource "google_secret_manager_secret_iam_member" "api_reads_database_url" {
  project   = var.project_id
  secret_id = google_secret_manager_secret.database_url.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.api.email}"
}

resource "google_secret_manager_secret_iam_member" "api_reads_admin_token" {
  project   = var.project_id
  secret_id = google_secret_manager_secret.admin_token.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.api.email}"
}

# ============================================================================
# Cloud Run job: prisma migrate deploy (run before every service rollout)
# ============================================================================

resource "google_cloud_run_v2_job" "migrate" {
  project  = var.project_id
  name     = local.job_name
  location = var.region
  labels   = local.labels

  template {
    task_count = 1
    template {
      service_account = google_service_account.api.email
      max_retries     = 0
      timeout         = "600s"

      containers {
        image = local.migrate_image

        env {
          name = "DATABASE_URL"
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.database_url.secret_id
              version = "latest"
            }
          }
        }

        volume_mounts {
          name       = "cloudsql"
          mount_path = "/cloudsql"
        }
      }

      volumes {
        name = "cloudsql"
        cloud_sql_instance {
          instances = [google_sql_database_instance.postgres.connection_name]
        }
      }
    }
  }

  lifecycle {
    ignore_changes = [client, client_version]
  }

  depends_on = [
    google_secret_manager_secret_version.database_url,
    google_secret_manager_secret_iam_member.api_reads_database_url,
  ]
}

# ============================================================================
# Cloud Run service
# ============================================================================

resource "google_cloud_run_v2_service" "api" {
  project  = var.project_id
  name     = local.service_name
  location = var.region
  ingress  = "INGRESS_TRAFFIC_ALL"
  labels   = local.labels

  template {
    service_account = google_service_account.api.email

    scaling {
      min_instance_count = var.min_instances
      max_instance_count = var.max_instances
    }

    containers {
      image = local.api_image

      ports {
        container_port = 8787
      }

      resources {
        limits = {
          cpu    = "1000m"
          memory = "512Mi"
        }
        cpu_idle = true
      }

      env {
        name  = "NODE_ENV"
        value = "production"
      }
      env {
        name  = "PORT"
        value = "8787"
      }
      env {
        name  = "LOG_LEVEL"
        value = var.log_level
      }
      env {
        name  = "API_KEY_ENVIRONMENT"
        value = local.key_environment
      }
      env {
        name  = "RATE_LIMIT_PER_MINUTE"
        value = tostring(var.rate_limit_per_minute)
      }
      env {
        name  = "SERVICE_VERSION"
        value = var.image_tag
      }
      env {
        name = "DATABASE_URL"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.database_url.secret_id
            version = "latest"
          }
        }
      }
      env {
        name = "MUTABA3A_ADMIN_TOKEN"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.admin_token.secret_id
            version = "latest"
          }
        }
      }

      startup_probe {
        http_get {
          path = "/health"
        }
        initial_delay_seconds = 2
        period_seconds        = 3
        failure_threshold     = 10
      }

      liveness_probe {
        http_get {
          path = "/health"
        }
        period_seconds = 30
      }

      volume_mounts {
        name       = "cloudsql"
        mount_path = "/cloudsql"
      }
    }

    volumes {
      name = "cloudsql"
      cloud_sql_instance {
        instances = [google_sql_database_instance.postgres.connection_name]
      }
    }
  }

  traffic {
    type    = "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST"
    percent = 100
  }

  lifecycle {
    ignore_changes = [client, client_version]
  }

  depends_on = [
    google_secret_manager_secret_version.database_url,
    google_secret_manager_secret_version.admin_token,
    google_secret_manager_secret_iam_member.api_reads_database_url,
    google_secret_manager_secret_iam_member.api_reads_admin_token,
  ]
}

# Unauthenticated at the edge: every request is authenticated by the service
# itself (organization API key or operator admin token), never by Cloud Run IAM.
resource "google_cloud_run_v2_service_iam_member" "public" {
  project  = var.project_id
  name     = google_cloud_run_v2_service.api.name
  location = var.region
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# ============================================================================
# Monitoring: uptime check on /health, optional alert
# ============================================================================

resource "google_monitoring_uptime_check_config" "health" {
  count        = var.enable_uptime_check ? 1 : 0
  project      = var.project_id
  display_name = "${local.service_name} /health"
  timeout      = "10s"
  period       = "300s"

  http_check {
    path         = "/health"
    port         = 443
    use_ssl      = true
    validate_ssl = true
  }

  monitored_resource {
    type = "uptime_url"
    labels = {
      project_id = var.project_id
      host       = trimprefix(google_cloud_run_v2_service.api.uri, "https://")
    }
  }

  depends_on = [google_project_service.apis]
}

resource "google_monitoring_alert_policy" "health" {
  count        = var.enable_uptime_check && length(var.alert_notification_channels) > 0 ? 1 : 0
  project      = var.project_id
  display_name = "${local.service_name} is down"
  combiner     = "OR"

  conditions {
    display_name = "/health failing from all regions"
    condition_threshold {
      filter          = "metric.type=\"monitoring.googleapis.com/uptime_check/check_passed\" AND resource.type=\"uptime_url\" AND metric.label.check_id=\"${google_monitoring_uptime_check_config.health[0].uptime_check_id}\""
      comparison      = "COMPARISON_GT"
      threshold_value = 1
      duration        = "600s"

      aggregations {
        alignment_period     = "1200s"
        per_series_aligner   = "ALIGN_NEXT_OLDER"
        cross_series_reducer = "REDUCE_COUNT_FALSE"
        group_by_fields      = ["resource.label.*"]
      }

      trigger {
        count = 1
      }
    }
  }

  notification_channels = var.alert_notification_channels
}
