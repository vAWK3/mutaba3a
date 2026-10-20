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
