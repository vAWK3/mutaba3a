# Mutaba3a hosted API — production in one region (a staging environment can be added later).
#
# Shape mirrors Malafat's infrastructure/terraform/modules/regional-stack:
# Cloud SQL + Cloud Run + Secret Manager + a dedicated service account.
# Terraform owns every resource including the running image tag. Everything
# that can run on the operator's machine does (ADR-026): scripts/deploy.sh
# builds the image with the local Docker daemon, pushes it, runs
# `prisma migrate deploy` through the Cloud SQL Auth Proxy, then applies this
# with -var image_tag. Nothing builds or migrates inside GCP.

locals {
  suffix          = var.environment == "production" ? "" : "-${var.environment}"
  key_environment = var.environment == "production" ? "live" : "test"

  service_name = "mutaba3a-api${local.suffix}"
  instance_id  = "mutaba3a-pg${local.suffix}"
  db_name      = "mutaba3a"

  db_user = "mutaba3a_api"

  registry  = "${var.region}-docker.pkg.dev/${var.project_id}/${var.artifact_repository}"
  api_image = "${local.registry}/mutaba3a-api:${var.image_tag}"

  # Operator-side migrations: Cloud SQL Auth Proxy listens here (scripts/deploy.sh).
  proxy_port = 5440

  # MUT-270: connections outside the API's pool — `prisma migrate deploy` and the operator's proxy session, plus
  # the few Cloud SQL keeps for its own superuser and maintenance.
  db_reserved_connections = 10

  # TD-190: daily backups kept, and deleted receipt files kept as long, so a database restored to
  # the oldest backup can still find every receipt's file. The privacy policy promises this number
  # (scripts/__tests__/legal-terms.test.ts reads it from here).
  db_retained_backups             = 14
  attachments_soft_delete_seconds = local.db_retained_backups * 24 * 60 * 60

  secret_database_url   = "mutaba3a-api-database-url${local.suffix}"
  secret_admin_token    = "mutaba3a-api-admin-token${local.suffix}"
  secret_session_pepper = "mutaba3a-api-session-pepper${local.suffix}"

  # MUT-360: the Stripe secrets get their values from Basel (`gcloud secrets versions add`, DEPLOYMENT.md §6e),
  # never from Terraform. The job token is generated here.
  secret_stripe_secret_key     = "mutaba3a-api-stripe-secret-key${local.suffix}"
  secret_stripe_webhook_secret = "mutaba3a-api-stripe-webhook-secret${local.suffix}"
  secret_job_token             = "mutaba3a-api-job-token${local.suffix}"
  # MUT-434: generated here, like the job token.
  secret_oauth_derive_key = "mutaba3a-api-oauth-derive-key${local.suffix}"
  oauth_cleanup_job       = "mutaba3a-oauth-cleanup${local.suffix}"
  # By name, so monitoring.tf's alert on its failed attempts never plans the job itself.
  stripe_reconcile_job = "mutaba3a-stripe-reconcile${local.suffix}"
  account_purge_job    = "mutaba3a-account-purge${local.suffix}"
  # MUT-419: the daily trial reminders need mail, Stripe (their Subscribe links) and the lapse gate (what they announce).
  trial_mail_enabled = var.mailer == "resend" && var.stripe_enabled && var.billing_gate_enabled

  # MUT-111: empty (default) = no env vars below, feature off — matches
  # config.ts treating all four as absent. Set together in production.tfvars.
  app_association_env = var.apple_team_id == "" ? {} : {
    APPLE_TEAM_ID               = var.apple_team_id
    APPLE_BUNDLE_ID             = var.apple_bundle_id
    ANDROID_PACKAGE_NAME        = var.android_package_name
    ANDROID_SHA256_FINGERPRINTS = var.android_sha256_fingerprints
  }

  # MUT-293 / MUT-457: the phone's minimum and recommended builds, only those set. Nothing set = no env
  # var, so the gate stays off as before. The kill switch goes out only as "true": absent is off.
  min_build_env = merge(
    { for name, build in {
      IOS_MIN_BUILD             = var.ios_min_build
      ANDROID_MIN_BUILD         = var.android_min_build
      IOS_RECOMMENDED_BUILD     = var.ios_recommended_build
      ANDROID_RECOMMENDED_BUILD = var.android_recommended_build
    } : name => tostring(build) if build != null },
    var.min_build_check_disabled ? { MIN_BUILD_CHECK_DISABLED = "true" } : {},
  )

  # MUT-487 (R2): the new project keeps its jobs paused until the cutover; behind the forwarder the old ones would
  # reach the new service a second time, so they stay paused whatever scheduler_paused says.
  scheduler_paused = var.scheduler_paused || var.legacy_forwarder

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
  for_each = toset(concat([
    "run.googleapis.com",
    "sqladmin.googleapis.com",
    "secretmanager.googleapis.com",
    "artifactregistry.googleapis.com",
    "monitoring.googleapis.com",
    "storage.googleapis.com",
    "iamcredentials.googleapis.com",
    "cloudscheduler.googleapis.com",
    ],
    # MUT-441: the read queue, and the sidecar's locked network (receipt_ocr.tf).
    local.ocr_enabled ? ["cloudtasks.googleapis.com", "compute.googleapis.com"] : [],
    # MUT-511: the budget (budget.tf) takes its quota from this project.
    var.billing_account_id == null ? [] : ["billingbudgets.googleapis.com"],
  ))
  project            = var.project_id
  service            = each.key
  disable_on_destroy = false
}

# ============================================================================
# Artifact Registry (images are built and pushed from the operator's machine)
# ============================================================================

# MUT-347: tags are never pushed over (deploy.sh), because a rollback (make rollback-server) deploys a commit's
# existing image. MUT-511: the cleanup policy deletes only untagged images older than 7 days and always keeps the
# 3 newest of each image, so every release tag survives. It starts as a dry run (registry_cleanup_dry_run):
# Basel reads what it would delete (DEPLOYMENT.md §6d) before turning it on.
resource "google_artifact_registry_repository" "images" {
  project       = var.project_id
  location      = var.region
  repository_id = var.artifact_repository
  format        = "DOCKER"
  description   = "Mutaba3a API service image"
  labels        = local.labels

  cleanup_policy_dry_run = var.registry_cleanup_dry_run

  cleanup_policies {
    id     = "keep-3-newest"
    action = "KEEP"
    most_recent_versions {
      keep_count = 3
    }
  }

  cleanup_policies {
    id     = "delete-untagged-after-7-days"
    action = "DELETE"
    condition {
      tag_state  = "UNTAGGED"
      older_than = "604800s"
    }
  }

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
      # MUT-382 (B4): keep backups in Tel Aviv, as the privacy policy says; without it Cloud SQL picks a multi-region.
      location = var.region

      backup_retention_settings {
        retained_backups = local.db_retained_backups
      }
    }

    # No authorized networks: Cloud Run reaches the instance through the Cloud
    # SQL connector (unix socket) and the operator through the Cloud SQL Auth
    # Proxy; both authenticate with IAM, so the public IP is never open.
    ip_configuration {
      ipv4_enabled = true
      ssl_mode     = "ENCRYPTED_ONLY"
    }

    maintenance_window {
      day          = 7
      hour         = 3
      update_track = "stable"
    }

    # MUT-270: chosen, not inherited, so it stays above every client's pool (see the precondition on the
    # DATABASE_URL secret). Changing it restarts the instance.
    database_flags {
      name  = "max_connections"
      value = tostring(var.db_max_connections)
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
  secret = google_secret_manager_secret.database_url.id
  # MUT-270: connection_limit sizes Prisma's pool per instance. Its default is derived from the CPU count it sees,
  # which in a container can be the host's; GET /v1/entries runs 4 queries per profile in parallel.
  secret_data = "postgresql://${local.db_user}:${random_password.db.result}@localhost/${local.db_name}?host=/cloudsql/${google_sql_database_instance.postgres.connection_name}&connection_limit=${var.db_pool_size}"

  lifecycle {
    # No create_before_destroy: Terraform would propagate it to the instance and the secret, whose fixed names would
    # then clash on any future replacement. A changed URL replaces this version destroy-first; INFRA.md covers the gap.
    precondition {
      # × 2: during a deploy the old and the new revision both hold a pool.
      condition     = 2 * var.db_pool_size * var.max_instances + local.db_reserved_connections <= var.db_max_connections
      error_message = "2 × db_pool_size × max_instances (old and new revisions overlap during a deploy) plus ${local.db_reserved_connections} reserved connections (migrations, the operator's proxy, Cloud SQL's own) must fit within db_max_connections."
    }
  }
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

# HMAC key for hosted-portal session digests (MUT-38, ADR-037). Generated here,
# never a tfvars value. Rotating it (`-replace=random_password.session_pepper`,
# then redeploy) signs every portal user out at once.
resource "random_password" "session_pepper" {
  length  = 64
  special = false
}

resource "google_secret_manager_secret" "session_pepper" {
  project   = var.project_id
  secret_id = local.secret_session_pepper
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

resource "google_secret_manager_secret_version" "session_pepper" {
  secret      = google_secret_manager_secret.session_pepper.id
  secret_data = random_password.session_pepper.result
}

# MUT-360: Stripe's restricted key and webhook signing secret. Created without a version, whatever
# stripe_enabled says, so Basel can add the values before the flag mounts them (DEPLOYMENT.md §6e).
resource "google_secret_manager_secret" "stripe_secret_key" {
  project   = var.project_id
  secret_id = local.secret_stripe_secret_key
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

resource "google_secret_manager_secret" "stripe_webhook_secret" {
  project   = var.project_id
  secret_id = local.secret_stripe_webhook_secret
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

# MUT-360 (D2): the Cloud Scheduler job's credential for /jobs/*. It opens nothing else, and the admin
# token doesn't open /jobs/*. Generated here, never a tfvars value. Rotate with
# -replace=random_password.job_token, then redeploy: the job's header changes at once, the service on its next revision.
resource "random_password" "job_token" {
  length  = 64
  special = false
}

resource "google_secret_manager_secret" "job_token" {
  project   = var.project_id
  secret_id = local.secret_job_token
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

resource "google_secret_manager_secret_version" "job_token" {
  secret      = google_secret_manager_secret.job_token.id
  secret_data = random_password.job_token.result
}

# MUT-434 (D19): the key an MCP agent's renewed tokens are derived under, so a retried refresh gets the same pair.
# Generated here, never a tfvars value. Rotating it (-replace=random_password.oauth_derive_key) only breaks retries
# inside the 30-second window; rotating the session pepper is what signs agents out.
resource "random_password" "oauth_derive_key" {
  length  = 64
  special = false
}

resource "google_secret_manager_secret" "oauth_derive_key" {
  project   = var.project_id
  secret_id = local.secret_oauth_derive_key
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

resource "google_secret_manager_secret_version" "oauth_derive_key" {
  secret      = google_secret_manager_secret.oauth_derive_key.id
  secret_data = random_password.oauth_derive_key.result
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

resource "google_secret_manager_secret_iam_member" "api_reads_session_pepper" {
  project   = var.project_id
  secret_id = google_secret_manager_secret.session_pepper.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.api.email}"
}

resource "google_secret_manager_secret_iam_member" "api_reads_stripe_secret_key" {
  project   = var.project_id
  secret_id = google_secret_manager_secret.stripe_secret_key.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.api.email}"
}

resource "google_secret_manager_secret_iam_member" "api_reads_stripe_webhook_secret" {
  project   = var.project_id
  secret_id = google_secret_manager_secret.stripe_webhook_secret.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.api.email}"
}

resource "google_secret_manager_secret_iam_member" "api_reads_job_token" {
  project   = var.project_id
  secret_id = google_secret_manager_secret.job_token.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.api.email}"
}

resource "google_secret_manager_secret_iam_member" "api_reads_oauth_derive_key" {
  project   = var.project_id
  secret_id = google_secret_manager_secret.oauth_derive_key.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.api.email}"
}

# ============================================================================
# Cloud Run service
# ============================================================================

resource "google_cloud_run_v2_service" "api" {
  project  = var.project_id
  name     = local.service_name
  location = var.region
  ingress  = var.api_ingress
  # MUT-487 (AM7): mtb3a-live is the live signal project-move.sh reads; Terraform owns it, so a release can't strip it.
  labels = merge(local.labels, { "mtb3a-live" = tostring(var.live_label) })

  template {
    # MUT-487 (D6, AM4): the legacy forwarder runs as its own account, which may read only the forwarder token.
    service_account = var.legacy_forwarder ? one(google_service_account.forwarder[*].email) : google_service_account.api.email

    scaling {
      min_instance_count = var.min_instances
      max_instance_count = var.max_instances
    }

    # The API, unless this is the old project's forwarder (forwarder.tf).
    dynamic "containers" {
      for_each = var.legacy_forwarder ? [] : [local.api_image]
      content {
        image = containers.value

        # Cloud Run injects PORT=<container_port> itself and rejects a PORT env
        # entry ("reserved env names were provided: PORT"), so it is not set
        # below; config.PORT reads the injected value (default 8787 locally).
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
          name  = "ATTACHMENTS_BUCKET"
          value = google_storage_bucket.attachments.name
        }
        env {
          name  = "ATTACHMENTS_URL_TTL_SECONDS"
          value = tostring(var.attachments_url_ttl_seconds)
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
        env {
          name = "SESSION_TOKEN_PEPPER"
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.session_pepper.secret_id
              version = "latest"
            }
          }
        }
        # MUT-360: always set, so /jobs/* answers the Scheduler job once stripe_enabled creates it.
        env {
          name = "MUTABA3A_JOB_TOKEN"
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.job_token.secret_id
              version = "latest"
            }
          }
        }

        # MUT-434: OAuth for MCP agents stays off (503) until oauth_enabled; the key always holds a version.
        dynamic "env" {
          for_each = var.oauth_enabled ? toset(["OAUTH_DERIVE_KEY"]) : toset([])
          content {
            name = env.value
            value_source {
              secret_key_ref {
                secret  = google_secret_manager_secret.oauth_derive_key.secret_id
                version = "latest"
              }
            }
          }
        }

        # MUT-360: Stripe stays off (routes answer 503) until stripe_enabled. The secrets must hold a version
        # by then, or the new revision fails to start.
        dynamic "env" {
          for_each = var.stripe_enabled ? {
            STRIPE_SECRET_KEY     = google_secret_manager_secret.stripe_secret_key.secret_id
            STRIPE_WEBHOOK_SECRET = google_secret_manager_secret.stripe_webhook_secret.secret_id
          } : {}
          content {
            name = env.key
            value_source {
              secret_key_ref {
                secret  = env.value
                version = "latest"
              }
            }
          }
        }

        # MUT-359: mail (email.tf). MAILER always; the sender, reply-to, cap and Resend secrets only with mailer = "resend".
        dynamic "env" {
          for_each = local.mail_env
          content {
            name  = env.key
            value = env.value
          }
        }
        dynamic "env" {
          for_each = local.mail_secret_env
          content {
            name = env.key
            value_source {
              secret_key_ref {
                secret  = env.value
                version = "latest"
              }
            }
          }
        }

        # MUT-148 (ADR-091): error reports, once sentry_enabled (sentry.tf).
        dynamic "env" {
          for_each = var.sentry_enabled ? [google_secret_manager_secret.sentry_dsn[0].secret_id] : []
          content {
            name = "SENTRY_DSN"
            value_source {
              secret_key_ref {
                secret  = env.value
                version = "latest"
              }
            }
          }
        }
        dynamic "env" {
          for_each = var.sentry_enabled ? { SENTRY_ENVIRONMENT = var.environment } : {}
          content {
            name  = env.key
            value = env.value
          }
        }

        # MUT-361: the lapse gate is on unless billing_gate_enabled = false (the kill switch).
        dynamic "env" {
          for_each = var.billing_gate_enabled ? {} : { BILLING_GATE = "false" }
          content {
            name  = env.key
            value = env.value
          }
        }

        # MUT-389: the receipts library, once receipts_library_enabled (on with MUT-260 or MUT-258).
        dynamic "env" {
          for_each = var.receipts_library_enabled ? { RECEIPTS_LIBRARY = "true" } : {}
          content {
            name  = env.key
            value = env.value
          }
        }

        # MUT-441: the server reads receipts (receipt_ocr.tf); SERVER_OCR=false and nothing else until server_ocr_enabled.
        dynamic "env" {
          for_each = local.ocr_api_env
          content {
            name  = env.key
            value = env.value
          }
        }

        # MUT-436 (review D3/D5): agents may add to the inbox only once the phone decodes 'mcp' (its minimum build raised).
        dynamic "env" {
          for_each = var.mcp_inbox_writes_enabled ? { MCP_INBOX_WRITES = "true" } : {}
          content {
            name  = env.key
            value = env.value
          }
        }

        # MUT-457: the phone floor (MUT-293), set in production.tfvars (DEPLOYMENT.md "Raise the minimum app build").
        dynamic "env" {
          for_each = local.min_build_env
          content {
            name  = env.key
            value = env.value
          }
        }

        dynamic "env" {
          for_each = local.app_association_env
          content {
            name  = env.key
            value = env.value
          }
        }

        # MUT-326: the custom domain's front door (domain.tf); empty while config/hosts.json names no domain.
        dynamic "env" {
          for_each = local.front_door_env
          content {
            name  = env.key
            value = env.value
          }
        }
        # MUT-487 (R5, D9): the forwarder's token, trusted only for the caller's IP. The new project generates it.
        dynamic "env" {
          for_each = var.legacy_stack ? [] : [google_secret_manager_secret.forwarder_token.secret_id]
          content {
            name = "FORWARDER_TOKEN"
            value_source {
              secret_key_ref {
                secret  = env.value
                version = "latest"
              }
            }
          }
        }
        dynamic "env" {
          for_each = local.front_door_enabled ? [local.front_door_token_secret] : []
          content {
            name = "FRONT_DOOR_TOKEN"
            value_source {
              secret_key_ref {
                secret  = env.value
                version = "latest"
              }
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
    }

    # MUT-487 (D6, AM4, R5): the same image's forwarder entrypoint. No database, no secrets but its own token.
    dynamic "containers" {
      for_each = var.legacy_forwarder ? [local.api_image] : []
      content {
        image   = containers.value
        command = ["node"]
        args    = ["dist/forwarder.js"]

        ports {
          container_port = 8787
        }

        resources {
          limits = {
            cpu    = "1000m"
            memory = "256Mi"
          }
          cpu_idle = true
        }

        env {
          name  = "FORWARD_TO"
          value = coalesce(var.forward_to, "unset")
        }
        env {
          name = "FORWARDER_TOKEN"
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.forwarder_token.secret_id
              version = "latest"
            }
          }
        }

        startup_probe {
          http_get {
            path = local.forwarder_health_path
          }
          initial_delay_seconds = 1
          period_seconds        = 3
          failure_threshold     = 10
        }
      }
    }

    dynamic "volumes" {
      for_each = var.legacy_forwarder ? [] : [google_sql_database_instance.postgres.connection_name]
      content {
        name = "cloudsql"
        cloud_sql_instance {
          instances = [volumes.value]
        }
      }
    }
  }

  traffic {
    type    = "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST"
    percent = 100
  }

  lifecycle {
    ignore_changes = [client, client_version]

    precondition {
      # MUT-111: config.ts enforces this again at server boot; catching it
      # here surfaces the mistake at `terraform plan`, before a deploy. All
      # four "is empty" booleans must agree — either all set or all empty.
      condition = length(distinct([
        var.apple_team_id == "",
        var.apple_bundle_id == "",
        var.android_package_name == "",
        var.android_sha256_fingerprints == "",
      ])) == 1
      error_message = "apple_team_id, apple_bundle_id, android_package_name and android_sha256_fingerprints must all be set, or all left empty (MUT-111)."
    }

    precondition {
      # MUT-359: config.ts refuses these again at boot; here they fail the plan, before a release.
      condition     = var.mailer != "resend" || (local.domain != null && var.mail_reply_to != null && var.mail_daily_cap != null)
      error_message = "mailer = \"resend\" needs a domain in config/hosts.json (the sender is no-reply@<domain>), mail_reply_to and mail_daily_cap (MUT-359, DEPLOYMENT.md §6f)."
    }

    precondition {
      # MUT-366: the server refuses this again at boot; signup mails a link, so it needs mail on.
      condition     = !var.self_signup_enabled || var.mailer == "resend"
      error_message = "self_signup_enabled needs mailer = \"resend\": signup mails a link (MUT-366, DEPLOYMENT.md §6f)."
    }

    precondition {
      # MUT-457: the server only nudges a platform that has a floor (minimum-build.ts), and config.ts refuses a
      # recommended build below it. null checks short-circuit with try(), since required_version allows < 1.12.
      condition = alltrue([for p in [
        { min = var.ios_min_build, recommended = var.ios_recommended_build },
        { min = var.android_min_build, recommended = var.android_recommended_build },
      ] : p.recommended == null || try(p.min != null && p.recommended >= p.min, false)])
      error_message = "ios_recommended_build / android_recommended_build each need that platform's min build, and must be at least it: without a floor the server ignores them (MUT-457, DEPLOYMENT.md \"Raise the minimum app build\")."
    }

    precondition {
      # MUT-487 (D6): the forwarder exists only on the old project's stack, and needs the new service's https URL.
      condition     = !var.legacy_forwarder || (var.legacy_stack && can(regex("^https://[^/]+$", coalesce(var.forward_to, "-"))))
      error_message = "legacy_forwarder needs legacy_stack = true (legacy.tfvars) and forward_to = the new service's https://… origin, no path (MUT-487, DEPLOYMENT.md §6d)."
    }
  }

  depends_on = [
    google_secret_manager_secret_version.database_url,
    google_secret_manager_secret_version.admin_token,
    google_secret_manager_secret_version.session_pepper,
    google_secret_manager_secret_version.job_token,
    google_secret_manager_secret_version.oauth_derive_key,
    google_secret_manager_secret_iam_member.api_reads_oauth_derive_key,
    google_secret_manager_secret_iam_member.api_reads_database_url,
    google_secret_manager_secret_iam_member.api_reads_admin_token,
    google_secret_manager_secret_iam_member.api_reads_session_pepper,
    google_secret_manager_secret_iam_member.api_reads_front_door_token,
    google_secret_manager_secret_iam_member.api_reads_job_token,
    google_secret_manager_secret_iam_member.api_reads_stripe_secret_key,
    google_secret_manager_secret_iam_member.api_reads_stripe_webhook_secret,
    google_secret_manager_secret_version.sentry_dsn,
    google_secret_manager_secret_iam_member.api_reads_sentry_dsn,
    google_secret_manager_secret_iam_member.api_reads_resend_api_key,
    google_secret_manager_secret_iam_member.api_reads_resend_webhook_secret,
    google_secret_manager_secret_iam_member.api_reads_turnstile,
    google_secret_manager_secret_version.forwarder_token,
    google_secret_manager_secret_iam_member.api_reads_forwarder_token,
    google_secret_manager_secret_iam_member.forwarder_reads_token,
  ]
}

# Unauthenticated at the edge: every request is authenticated by the service
# itself (organization API key or operator admin token), never by Cloud Run IAM.
# MUT-487 (R3, D4): api_public = false while the new project is rehearsed: then only a caller with run.invoker
# (Basel, through `gcloud run services proxy`) reaches it. The cutover's open step sets it true.
resource "google_cloud_run_v2_service_iam_member" "public" {
  count = var.api_public ? 1 : 0

  project  = var.project_id
  name     = google_cloud_run_v2_service.api.name
  location = var.region
  role     = "roles/run.invoker"
  member   = "allUsers"
}

moved {
  from = google_cloud_run_v2_service_iam_member.public
  to   = google_cloud_run_v2_service_iam_member.public[0]
}

# Uptime checks and alerts: monitoring.tf (MUT-328).

# ============================================================================
# Nightly Stripe reconcile (MUT-360)
# ============================================================================

# The job token opens /jobs/* only: this route (MUT-360 D2) and, since MUT-419, the trial reminders below. Reconcile answers 200 with its error list, so the
# retries only follow a run that never completed: 502 RECONCILE_FAILED (Stripe couldn't be listed), 409
# RECONCILE_RUNNING (overlap), a timeout or a cold start that failed. 280 s stays under Cloud Run's 300 s
# request timeout; the server stops its own run at about 200 s and reports TIME_BUDGET. Failed attempts
# page: monitoring.tf (stripe alerts).
resource "google_cloud_scheduler_job" "stripe_reconcile" {
  count = var.stripe_enabled ? 1 : 0

  project          = var.project_id
  name             = local.stripe_reconcile_job
  region           = var.region
  description      = "Nightly Stripe reconcile: mirrors every subscription (MUT-360)."
  schedule         = "30 3 * * *"
  time_zone        = "Asia/Jerusalem"
  attempt_deadline = "280s"
  # MUT-487 (R2, D3): paused in the new project until the cutover, and on the old one once it forwards.
  paused = local.scheduler_paused

  retry_config {
    retry_count = 3
  }

  http_target {
    http_method = "POST"
    uri         = "${google_cloud_run_v2_service.api.uri}/jobs/v1/billing/stripe-reconcile"
    headers = {
      "X-Job-Token"  = random_password.job_token.result
      "Content-Type" = "application/json"
    }
  }

  depends_on = [google_project_service.apis]
}

# MUT-419 (ADR-184, D7/D8): the daily trial reminders (ending within 3 days, read-only, locking within 3 days). At
# 10:00 Jerusalem time, a waking hour. Only with mail on, Stripe on (every mail links to Subscribe) and the lapse gate
# on (the mails announce what it does). The run stops itself at about 200 s and answers 200 with `incomplete`; the
# next day continues. A second run the same day sends nothing new, so the retries are safe. The job token now also
# triggers customer mail: a leaked token can only re-run that idempotent mail (D15).
resource "google_cloud_scheduler_job" "trial_mail" {
  count = local.trial_mail_enabled ? 1 : 0

  project          = var.project_id
  name             = "mutaba3a-trial-mail${local.suffix}"
  region           = var.region
  description      = "Daily trial reminders (MUT-419)."
  schedule         = "0 10 * * *"
  time_zone        = "Asia/Jerusalem"
  attempt_deadline = "280s"
  # MUT-487 (R2, D3): paused in the new project until the cutover, and on the old one once it forwards.
  paused = local.scheduler_paused

  retry_config {
    retry_count = 3
  }

  http_target {
    http_method = "POST"
    uri         = "${google_cloud_run_v2_service.api.uri}/jobs/v1/billing/trial-mail"
    headers = {
      "X-Job-Token"  = random_password.job_token.result
      "Content-Type" = "application/json"
    }
  }

  depends_on = [google_project_service.apis]
}

# MUT-333 (ADR-188, D11): the hourly hard delete of closed accounts whose 30 days of grace have run out. Always on:
# closing is a promise (the privacy policy's 30 days), so no switch turns it off. At minute 15, so a deletion lands
# within the hour of its deadline and the mailed day stays true. The run stops itself at about 200 s or 25 accounts
# and answers 200 with `incomplete`; the next hour continues. A retry re-runs it safely: a purged person is gone and
# a claimed one is resumed. A person Stripe fails for is retried next hour and alerts (monitoring.tf account_purge).
resource "google_cloud_scheduler_job" "account_purge" {
  project          = var.project_id
  name             = local.account_purge_job
  region           = var.region
  description      = "Hourly hard delete of closed accounts (MUT-333)."
  schedule         = "15 * * * *"
  time_zone        = "Asia/Jerusalem"
  attempt_deadline = "280s"
  # MUT-487 (R2, D3): paused in the new project until the cutover, and on the old one once it forwards.
  paused = local.scheduler_paused

  retry_config {
    retry_count = 2
  }

  http_target {
    http_method = "POST"
    uri         = "${google_cloud_run_v2_service.api.uri}/jobs/v1/accounts/purge"
    headers = {
      "X-Job-Token"  = random_password.job_token.result
      "Content-Type" = "application/json"
    }
  }

  depends_on = [google_project_service.apis]
}

# MUT-434: the nightly OAuth housekeeping — expired consent requests and codes, tokens of grants that ended a week ago,
# and registered clients that never got a grant after 30 days. Only with oauth_enabled. A retry re-runs it safely.
resource "google_cloud_scheduler_job" "oauth_cleanup" {
  count            = var.oauth_enabled ? 1 : 0
  project          = var.project_id
  name             = local.oauth_cleanup_job
  region           = var.region
  description      = "Nightly OAuth housekeeping for MCP agents (MUT-434)."
  schedule         = "40 3 * * *"
  time_zone        = "Asia/Jerusalem"
  attempt_deadline = "120s"
  # MUT-487 (R2, D3): see stripe_reconcile.
  paused = local.scheduler_paused

  retry_config {
    retry_count = 2
  }

  http_target {
    http_method = "POST"
    uri         = "${google_cloud_run_v2_service.api.uri}/jobs/v1/oauth/cleanup"
    headers = {
      "X-Job-Token"  = random_password.job_token.result
      "Content-Type" = "application/json"
    }
  }

  depends_on = [google_project_service.apis]
}

# ============================================================================
# Attachments bucket (M6): private, uniform access, reached only through
# short-lived V4 signed URLs the API mints with its own service account.
# ============================================================================

resource "google_storage_bucket" "attachments" {
  project                     = var.project_id
  name                        = "${var.project_id}-mutaba3a-attachments${local.suffix}"
  location                    = var.region
  storage_class               = "STANDARD"
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = false
  labels                      = local.labels

  versioning {
    enabled = false
  }

  # TD-190: deleting a receipt deletes its object, and the database backups don't hold files.
  # Deleted objects stay restorable as long as the oldest backup (14 days), so a restored receipt
  # row can still find its file (pilot runbook §4.4). Soft-deleted bytes bill at STANDARD rates.
  soft_delete_policy {
    retention_duration_seconds = local.attachments_soft_delete_seconds
  }

  # The portal PUTs a receipt's bytes from the browser to a signed URL here (receiptUpload.ts), a different
  # origin, so the bucket must answer the CORS preflight for the portal's origins and the signed headers.
  # Downloads open as images and frames, which need no CORS.
  dynamic "cors" {
    for_each = length(local.portal_origins) > 0 ? [local.portal_origins] : []
    content {
      origin          = cors.value
      method          = ["PUT"]
      response_header = ["Content-Type", "x-goog-content-length-range"]
      max_age_seconds = 3600
    }
  }

  lifecycle_rule {
    action {
      type = "AbortIncompleteMultipartUpload"
    }
    condition {
      age = 1
    }
  }
}

# Read/write/delete objects in the bucket, nothing else in the project.
resource "google_storage_bucket_iam_member" "api_objects" {
  bucket = google_storage_bucket.attachments.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.api.email}"
}

# V4 signed URLs without a key file: the service account signs through IAM signBlob on itself.
resource "google_service_account_iam_member" "api_signs_as_itself" {
  service_account_id = google_service_account.api.name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = "serviceAccount:${google_service_account.api.email}"
}
