# MUT-381 (ADR-164): our own Cloud KMS key (CMEK) for the Cloud SQL instance mutaba3a-pg2 and the
# attachments bucket. Nothing here exists until cmek_stage leaves "off" (variables.tf), so merging this
# changes nothing until the operator opts in (DEPLOYMENT.md §6d).
#
# What it protects: the disks and backups Google holds, and the right to make all of it unreadable by
# revoking the key. What it doesn't: anyone with roles in this project. Malafat's runtime service account
# holds project-wide KMS, storage and SQL roles here (TD-195), so CMEK adds no isolation from it.
#
# Cloud SQL never re-encrypts on rotation: an old key version still protects data written under it, so
# never disable or destroy a version (pilot runbook §5). A destroy can be cancelled for 30 days.

locals {
  # 90 days.
  kms_rotation_period = "7776000s"
}

resource "google_kms_key_ring" "mutaba3a" {
  count = local.cmek_enabled ? 1 : 0

  project  = var.project_id
  name     = "mutaba3a${local.suffix}"
  location = var.region

  depends_on = [google_project_service.apis]
}

resource "google_kms_crypto_key" "data" {
  count = local.cmek_enabled ? 1 : 0

  name            = "mutaba3a-data"
  key_ring        = google_kms_key_ring.mutaba3a[0].id
  purpose         = "ENCRYPT_DECRYPT"
  rotation_period = local.kms_rotation_period
  labels          = local.labels

  # Destroying the key makes the database, its backups and every receipt unreadable.
  lifecycle {
    prevent_destroy = true
  }
}

# The Cloud SQL service agent encrypts the instance's disk with the key. gcloud and Terraform users have to
# create it explicitly (the console does it on its own); the beta resource is the documented way.
resource "google_project_service_identity" "cloud_sql" {
  count    = local.cmek_enabled ? 1 : 0
  provider = google-beta

  project = var.project_id
  service = "sqladmin.googleapis.com"
}

data "google_storage_project_service_account" "gcs" {
  count = local.cmek_enabled ? 1 : 0

  project = var.project_id
}

# Granted on the key, never on the project: only these two agents may use it.
resource "google_kms_crypto_key_iam_member" "cloud_sql_uses_key" {
  count = local.cmek_enabled ? 1 : 0

  crypto_key_id = google_kms_crypto_key.data[0].id
  role          = "roles/cloudkms.cryptoKeyEncrypterDecrypter"
  member        = "serviceAccount:${google_project_service_identity.cloud_sql[0].email}"
}

resource "google_kms_crypto_key_iam_member" "gcs_uses_key" {
  count = local.cmek_enabled ? 1 : 0

  crypto_key_id = google_kms_crypto_key.data[0].id
  role          = "roles/cloudkms.cryptoKeyEncrypterDecrypter"
  member        = "serviceAccount:${data.google_storage_project_service_account.gcs[0].email_address}"
}
