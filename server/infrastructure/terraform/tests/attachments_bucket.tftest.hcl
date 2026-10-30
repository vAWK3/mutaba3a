# TD-190: a receipt's file outlives its deletion as long as the database backups do, checked offline.
# The Google and random providers are mocked, so this needs no credentials, project or network:
#   terraform init -backend=false && terraform test

mock_provider "google" {
  # A mocked string is random; IAM bindings validate the service account's name and email format.
  mock_resource "google_service_account" {
    defaults = {
      name  = "projects/test-project/serviceAccounts/mutaba3a-api@test-project.iam.gserviceaccount.com"
      email = "mutaba3a-api@test-project.iam.gserviceaccount.com"
    }
  }
  mock_resource "google_cloud_run_v2_service" {
    defaults = {
      uri = "https://mutaba3a-api-test.a.run.example"
    }
  }
}
mock_provider "random" {}

variables {
  project_id = "test-project"
  image_tag  = "test"
}

run "deleted_receipt_files_are_kept_as_long_as_the_oldest_backup" {
  command = plan

  assert {
    condition     = google_storage_bucket.attachments.soft_delete_policy[0].retention_duration_seconds == 1209600
    error_message = "The attachments bucket must keep deleted objects 14 days (1209600 s), not GCS's 7-day default."
  }

  assert {
    condition = (
      google_storage_bucket.attachments.soft_delete_policy[0].retention_duration_seconds
      == google_sql_database_instance.postgres.settings[0].backup_configuration[0].backup_retention_settings[0].retained_backups * 86400
    )
    error_message = "Soft-delete retention must equal the daily backups kept, or a restored receipt row can outlive its file."
  }
}

# The portal PUTs a receipt's bytes straight to a signed URL on the bucket, a different origin, so the
# browser asks the bucket first (CORS preflight). Without a rule naming the portal's origin, every
# web upload fails before it starts (2026-10-29).
run "the_portal_may_put_receipts_into_the_bucket" {
  command = plan

  variables {
    hosts_file = "../../../config/fixtures/hosts.placeholder.json"
  }

  assert {
    condition     = length(google_storage_bucket.attachments.cors) == 1
    error_message = "The attachments bucket needs one CORS rule, for the portal's receipt uploads."
  }

  assert {
    condition     = toset(google_storage_bucket.attachments.cors[0].origin) == toset(["https://app.placeholder.example", "https://portal.example.test"])
    error_message = "Uploads come from the portal on its custom domain and on the legacy host, which still serves it; no other origin."
  }

  assert {
    condition     = google_storage_bucket.attachments.cors[0].method == tolist(["PUT"])
    error_message = "The browser only PUTs to the bucket; downloads open as images and frames, which need no CORS."
  }

  assert {
    condition     = toset(google_storage_bucket.attachments.cors[0].response_header) == toset(["Content-Type", "x-goog-content-length-range"])
    error_message = "The upload sends Content-Type and x-goog-content-length-range (the signed URL's headers); the preflight must allow both."
  }
}

run "without_a_domain_the_legacy_portal_alone" {
  command = plan

  variables {
    hosts_file = "../../../config/fixtures/hosts.no-domain.json"
  }

  assert {
    condition     = google_storage_bucket.attachments.cors[0].origin == tolist(["https://portal.example.test"])
    error_message = "With no domain, the portal answers only on its legacy host."
  }
}

run "an_environment_the_hosts_file_doesnt_name_gets_no_rule" {
  command = plan

  variables {
    environment = "staging"
    hosts_file  = "../../../config/fixtures/hosts.no-domain.json"
  }

  assert {
    condition     = length(google_storage_bucket.attachments.cors) == 0
    error_message = "Without hosts there is no portal origin to allow (Cloud Run's own URL would be a dependency cycle)."
  }
}
