# MUT-487 (ADR-230, D6/D7, AM4, R5/D9): the legacy run.app forwarder.
#
# A run.app hostname belongs to its project, so after the move the old service in malafat-production stays up as a
# thin forwarder to the new one, for the phone builds that still call it (Dart doesn't follow redirects on POST).
# It is the same image started with `node dist/forwarder.js` (server/src/forwarder.ts): no database, no secrets but
# the forwarder token, its own service account with no project role. MUT-521 retires it.
#
# The forwarder token tells the new service "this request was relayed; trust x-mutaba3a-client-ip for the caller's
# address". It is trusted for that alone: it never counts as the front door (auth/sessions.ts), so carry-over and
# front-door checks are unchanged. The new project generates it; the old project's stack (legacy_stack = true)
# creates the secret empty and project-move.sh secrets copies the value in through a pipe.

locals {
  secret_forwarder_token = "mutaba3a-api-forwarder-token${local.suffix}"
  forwarder_health_path  = "/forwarder/health"
}

resource "random_password" "forwarder_token" {
  count   = var.legacy_stack ? 0 : 1
  length  = 64
  special = false
}

resource "google_secret_manager_secret" "forwarder_token" {
  project   = var.project_id
  secret_id = local.secret_forwarder_token
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

resource "google_secret_manager_secret_version" "forwarder_token" {
  count       = var.legacy_stack ? 0 : 1
  secret      = google_secret_manager_secret.forwarder_token.id
  secret_data = random_password.forwarder_token[0].result
}

# The new service reads it (env FORWARDER_TOKEN, main.tf).
resource "google_secret_manager_secret_iam_member" "api_reads_forwarder_token" {
  count     = var.legacy_stack ? 0 : 1
  project   = var.project_id
  secret_id = google_secret_manager_secret.forwarder_token.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.api.email}"
}

# The old project's forwarder runs as this account. Its only grant is reading its own token.
resource "google_service_account" "forwarder" {
  count        = var.legacy_stack ? 1 : 0
  project      = var.project_id
  account_id   = "mutaba3a-forwarder${local.suffix}"
  display_name = "MTB3A legacy run.app forwarder (MUT-487)"
}

resource "google_secret_manager_secret_iam_member" "forwarder_reads_token" {
  count     = var.legacy_stack ? 1 : 0
  project   = var.project_id
  secret_id = google_secret_manager_secret.forwarder_token.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.forwarder[0].email}"
}
