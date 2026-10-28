# MUT-441: the server reads receipts. Everything here exists only once server_ocr_enabled (default false), so
# merging creates nothing and the API gets SERVER_OCR=false. The first production apply comes after MUT-487 moves
# the stack to its own project (plan D6), so every name is built from project_id, region and the environment suffix.
#
#   upload completes ──► API enqueues a task ──► Cloud Tasks queue receipt-reads ──► POST <api>/jobs/v1/receipts/read
#                                                  (OIDC as receipt-read-invoker)        {receiptId}
#   Cloud Scheduler receipt-read-sweep, every 5 min ──► POST <api>/jobs/v1/receipts/read (no body: the sweep)
#                                                  (OIDC as receipt-sweep-invoker)
#   the job route ──► POST <receipt-ocr>/v1/read with an ID token for the API's service account
#
# The API checks the job's OIDC token itself (R8: audience = the API's origin, email = one of the two invoker
# service accounts); the shared X-Job-Token never opens this route. The receipt-ocr service holds no roles and has
# no way out (R9): Direct VPC egress sends ALL its traffic into a subnet with no NAT, no default route and a
# deny-all egress rule. It needs no Google API (the API hands it the bytes), so Private Google Access stays off too.

locals {
  ocr_enabled      = var.server_ocr_enabled
  ocr_service_name = "receipt-ocr${local.suffix}"
  ocr_image        = "${local.registry}/receipt-ocr:${coalesce(var.ocr_image_tag, var.image_tag)}"
  # F10: one read per instance (the sidecar's concurrency is 1), so the queue never sends more than the service holds.
  ocr_max_instances = 3
  ocr_concurrency   = 1
  # F10: the API's call to the sidecar times out at 35 s, under the task's 60 s dispatch deadline
  # (cloud-tasks.ts READ_DISPATCH_DEADLINE_SECONDS). The sidecar stops its own read at 30 s (R3).
  ocr_request_timeout = "45s"
  ocr_read_path       = "/jobs/v1/receipts/read"

  # The API's own URL, computed rather than read from google_cloud_run_v2_service.api.uri: the service's env needs
  # it, and a resource can't name its own attribute. Cloud Run serves every service on this deterministic URL too.
  api_origin = local.ocr_enabled ? "https://${local.service_name}-${data.google_project.this[0].number}.${var.region}.run.app" : null
  # Built, not read from the queue's id: config.ts insists on projects/<p>/locations/<l>/queues/<q>.
  read_queue_id = local.ocr_enabled ? "projects/${var.project_id}/locations/${var.region}/queues/${google_cloud_tasks_queue.receipt_reads[0].name}" : null

  # The API's env (main.tf). Off: SERVER_OCR=false and nothing else, so the job route answers {status: off}.
  # READ_OIDC_AUDIENCE stays unset: config.ts then uses API_ORIGIN, the audience the Scheduler job names below.
  ocr_api_env = local.ocr_enabled ? {
    SERVER_OCR       = "true"
    OCR_URL          = google_cloud_run_v2_service.receipt_ocr[0].uri
    READ_QUEUE       = local.read_queue_id
    API_ORIGIN       = local.api_origin
    READ_INVOKER_SA  = google_service_account.receipt_read_invoker[0].email
    SWEEP_INVOKER_SA = google_service_account.receipt_sweep_invoker[0].email
  } : { SERVER_OCR = "false" }
}

data "google_project" "this" {
  count      = local.ocr_enabled ? 1 : 0
  project_id = var.project_id
}

# ============================================================================
# Service accounts
# ============================================================================

# The sidecar's runtime identity. It holds no role anywhere: it reads nothing and writes nothing.
resource "google_service_account" "receipt_ocr" {
  count        = local.ocr_enabled ? 1 : 0
  project      = var.project_id
  account_id   = "receipt-ocr${local.suffix}"
  display_name = "MTB3A receipt OCR sidecar, no roles (${var.environment})"
}

# What read tasks carry an OIDC token for (R8). Only the API's job route accepts it.
resource "google_service_account" "receipt_read_invoker" {
  count        = local.ocr_enabled ? 1 : 0
  project      = var.project_id
  account_id   = "receipt-read-invoker${local.suffix}"
  display_name = "MTB3A receipt-read Cloud Tasks identity (${var.environment})"
}

# What the 5-minute sweep carries an OIDC token for (R8).
resource "google_service_account" "receipt_sweep_invoker" {
  count        = local.ocr_enabled ? 1 : 0
  project      = var.project_id
  account_id   = "receipt-sweep-invoker${local.suffix}"
  display_name = "MTB3A receipt-read sweep Scheduler identity (${var.environment})"
}

# The two job identities may invoke the API service and nothing else. The API is public today (main.tf "public"),
# so Cloud Run doesn't check this; it keeps the jobs working if that ever closes. The API checks the token itself.
resource "google_cloud_run_v2_service_iam_member" "read_jobs_invoke_api" {
  for_each = local.ocr_enabled ? {
    read  = google_service_account.receipt_read_invoker[0].email
    sweep = google_service_account.receipt_sweep_invoker[0].email
  } : {}
  project  = var.project_id
  name     = google_cloud_run_v2_service.api.name
  location = var.region
  role     = "roles/run.invoker"
  member   = "serviceAccount:${each.value}"
}

# The API creates the read tasks...
resource "google_cloud_tasks_queue_iam_member" "api_enqueues_reads" {
  count    = local.ocr_enabled ? 1 : 0
  project  = var.project_id
  location = var.region
  name     = google_cloud_tasks_queue.receipt_reads[0].name
  role     = "roles/cloudtasks.enqueuer"
  member   = "serviceAccount:${google_service_account.api.email}"
}

# ...with an OIDC token for the read invoker, which Cloud Tasks allows only to a caller that may act as it.
resource "google_service_account_iam_member" "api_acts_as_read_invoker" {
  count              = local.ocr_enabled ? 1 : 0
  service_account_id = google_service_account.receipt_read_invoker[0].name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.api.email}"
}

# Authoritative: the API's service account is the only principal that may call the sidecar (never allUsers).
resource "google_cloud_run_v2_service_iam_binding" "api_invokes_ocr" {
  count    = local.ocr_enabled ? 1 : 0
  project  = var.project_id
  name     = google_cloud_run_v2_service.receipt_ocr[0].name
  location = var.region
  role     = "roles/run.invoker"
  members  = ["serviceAccount:${google_service_account.api.email}"]
}

# ============================================================================
# Egress lock (R9): a network the sidecar can't leave
# ============================================================================

# No Cloud Router, no Cloud NAT, and no default internet route: an instance here has no path out.
resource "google_compute_network" "receipt_ocr" {
  count                           = local.ocr_enabled ? 1 : 0
  project                         = var.project_id
  name                            = "receipt-ocr${local.suffix}"
  auto_create_subnetworks         = false
  routing_mode                    = "REGIONAL"
  delete_default_routes_on_create = true

  depends_on = [google_project_service.apis]
}

# Direct VPC egress takes instance IPs from here (about 2 per instance; /26 is Cloud Run's documented minimum).
# Private Google Access is off: the sidecar calls no Google API, so even those endpoints stay out of reach.
resource "google_compute_subnetwork" "receipt_ocr" {
  count                    = local.ocr_enabled ? 1 : 0
  project                  = var.project_id
  name                     = "receipt-ocr${local.suffix}"
  region                   = var.region
  network                  = google_compute_network.receipt_ocr[0].id
  ip_cidr_range            = var.ocr_subnet_cidr
  private_ip_google_access = false
}

# Above the implied allow-egress rule (65535) and anything added later: priority 0 wins every tie-break.
resource "google_compute_firewall" "receipt_ocr_deny_egress" {
  count              = local.ocr_enabled ? 1 : 0
  project            = var.project_id
  name               = "receipt-ocr${local.suffix}-deny-all-egress"
  network            = google_compute_network.receipt_ocr[0].id
  description        = "MUT-441 (R9): the receipt-ocr sidecar sends nothing anywhere."
  direction          = "EGRESS"
  priority           = 0
  destination_ranges = ["0.0.0.0/0"]

  deny {
    protocol = "all"
  }
}

# ============================================================================
# The sidecar (server/ocr/Dockerfile, target runtime)
# ============================================================================

resource "google_cloud_run_v2_service" "receipt_ocr" {
  count    = local.ocr_enabled ? 1 : 0
  project  = var.project_id
  name     = local.ocr_service_name
  location = var.region
  # Ingress all, but IAM admits only the API (api_invokes_ocr): the API has no VPC egress to reach an internal one.
  ingress = "INGRESS_TRAFFIC_ALL"
  labels  = merge(local.labels, { app = "receipt-ocr" })

  template {
    service_account                  = google_service_account.receipt_ocr[0].email
    execution_environment            = "EXECUTION_ENVIRONMENT_GEN2"
    timeout                          = local.ocr_request_timeout
    max_instance_request_concurrency = local.ocr_concurrency

    # R4: asleep when idle; the first read after a quiet spell pays the model load (about 12–18 s with the boost).
    scaling {
      min_instance_count = var.ocr_min_instances
      max_instance_count = local.ocr_max_instances
    }

    vpc_access {
      egress = "ALL_TRAFFIC"
      network_interfaces {
        network    = google_compute_network.receipt_ocr[0].name
        subnetwork = google_compute_subnetwork.receipt_ocr[0].name
      }
    }

    containers {
      image = local.ocr_image

      ports {
        container_port = 8080
      }

      resources {
        limits = {
          cpu    = "4"
          memory = "4Gi"
        }
        cpu_idle          = true
        startup_cpu_boost = true
      }

      # 503 until the models are loaded. Probes reach the container directly, so Cloud Run's reserved /…z paths
      # (which its front end answers for outside callers) don't apply.
      startup_probe {
        http_get {
          path = "/healthz"
        }
        period_seconds    = 2
        timeout_seconds   = 2
        failure_threshold = 30
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

  # The lock exists before the first revision does.
  depends_on = [google_project_service.apis, google_compute_firewall.receipt_ocr_deny_egress]
}

# ============================================================================
# The read queue and the sweep
# ============================================================================

# F10: at most as many reads in flight as the sidecar holds (max instances × concurrency 1). The dispatch deadline
# (60 s) is per task, set by the API (cloud-tasks.ts). A read answers 503 only for "retry"; every terminal state is 2xx.
resource "google_cloud_tasks_queue" "receipt_reads" {
  count    = local.ocr_enabled ? 1 : 0
  project  = var.project_id
  name     = "receipt-reads${local.suffix}"
  location = var.region

  rate_limits {
    max_dispatches_per_second = 2
    max_concurrent_dispatches = local.ocr_max_instances * local.ocr_concurrency
  }

  retry_config {
    max_attempts  = 3
    min_backoff   = "10s"
    max_backoff   = "60s"
    max_doublings = 2
  }

  depends_on = [google_project_service.apis]
}

# R-D2 / R10 #7: no body = the sweep, which only re-enqueues claims that lapsed (and gives up on old ones); it
# never reads inline. An empty JSON body would be a 422, so this job sends none at all. The next run is 5 minutes
# away, so it doesn't retry.
resource "google_cloud_scheduler_job" "receipt_read_sweep" {
  count            = local.ocr_enabled ? 1 : 0
  project          = var.project_id
  name             = "receipt-read-sweep${local.suffix}"
  region           = var.region
  description      = "Re-enqueue receipt reads whose claim lapsed (MUT-441)."
  schedule         = "*/5 * * * *"
  time_zone        = "Asia/Jerusalem"
  attempt_deadline = "60s"

  retry_config {
    retry_count = 0
  }

  http_target {
    http_method = "POST"
    uri         = "${local.api_origin}${local.ocr_read_path}"

    oidc_token {
      service_account_email = google_service_account.receipt_sweep_invoker[0].email
      audience              = local.api_origin
    }
  }

  depends_on = [google_project_service.apis]
}
