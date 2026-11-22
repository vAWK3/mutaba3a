# ============================================================================
# MUT-641 (ADR-265): the issued-document signing key
# ============================================================================
#
# Two switches, applied in this order (docs/operations/before-release.md, MUT-641):
#   1. issuing_signing_key = true: a key ring and an HSM-protected asymmetric signing key in Cloud KMS, and the API's
#      service account may sign with it (roles/cloudkms.signer on this key only: it can't read, export or manage it).
#      Nothing signs yet.
#   2. issuing_signing_cert_chain = <PEM>: the certificate for that key (the interim self-issued one from
#      `npm run signing:interim-cert`, later the certifying authority's) turns signing on: ISSUING_SIGNER=kms and the
#      key version, chain and time-stamp authority reach the API. Until then the PDF routes answer 503.
# The private key never leaves KMS; the chain is public.

locals {
  issuing_signing_on          = var.issuing_signing_key && var.issuing_signing_cert_chain != null
  issuing_signing_key_version = var.issuing_signing_key ? "${google_kms_crypto_key.issuing_documents[0].id}/cryptoKeyVersions/${var.issuing_signing_key_version}" : null
  issuing_signing_env = local.issuing_signing_on ? {
    ISSUING_SIGNER             = "kms"
    ISSUING_SIGNING_KMS_KEY    = local.issuing_signing_key_version
    ISSUING_SIGNING_CERT_CHAIN = var.issuing_signing_cert_chain
    ISSUING_TSA_URL            = var.issuing_tsa_url
  } : {}
}

resource "google_kms_key_ring" "issuing" {
  count    = var.issuing_signing_key ? 1 : 0
  project  = var.project_id
  name     = "mutaba3a-issuing${local.suffix}"
  location = var.region

  # KMS never deletes a key ring; Terraform would only forget it, and turning the key back on would then fail (409).
  # To switch signing off, remove issuing_signing_cert_chain instead (before-release.md, MUT-641).
  lifecycle {
    prevent_destroy = true
  }

  depends_on = [google_project_service.apis]
}

resource "google_kms_crypto_key" "issuing_documents" {
  count    = var.issuing_signing_key ? 1 : 0
  name     = "issued-documents"
  key_ring = google_kms_key_ring.issuing[0].id
  purpose  = "ASYMMETRIC_SIGN"
  labels   = local.labels

  version_template {
    algorithm        = var.issuing_signing_algorithm
    protection_level = "HSM"
  }

  # A destroyed key version can't sign again and the certificate a certifying authority issued for it becomes useless.
  # Terraform refuses to destroy it; KMS would also wait 30 days, restorable with gcloud kms keys versions restore.
  destroy_scheduled_duration = "2592000s"

  lifecycle {
    prevent_destroy = true
  }
}

resource "google_kms_crypto_key_iam_member" "api_signs_issued_documents" {
  count         = var.issuing_signing_key ? 1 : 0
  crypto_key_id = google_kms_crypto_key.issuing_documents[0].id
  role          = "roles/cloudkms.signer"
  member        = "serviceAccount:${google_service_account.api.email}"
}
