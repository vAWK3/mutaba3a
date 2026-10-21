# MUT-381 (ADR-163): our own KMS key (CMEK) for Cloud SQL and the attachments bucket, checked offline.
# cmek_stage walks off → prepared → active in that order: state carries across runs, and the key has
# prevent_destroy, so a later run never goes back to a stage without it.
# The Google, Google beta and random providers are mocked, so this needs no credentials, project or network:
#   terraform init -backend=false && terraform test

mock_provider "google" {
  # A mocked string is random; IAM bindings validate the service account's name and email format.
  mock_resource "google_service_account" {
    defaults = {
      name  = "projects/test-project/serviceAccounts/mutaba3a-api@test-project.iam.gserviceaccount.com"
      email = "mutaba3a-api@test-project.iam.gserviceaccount.com"
    }
  }
  mock_resource "google_kms_crypto_key" {
    defaults = {
      id = "projects/test-project/locations/me-west1/keyRings/mutaba3a/cryptoKeys/mutaba3a-data"
    }
  }
  mock_data "google_storage_project_service_account" {
    defaults = {
      email_address = "service-123@gs-project-accounts.iam.gserviceaccount.com"
    }
  }
}
mock_provider "google-beta" {
  mock_resource "google_project_service_identity" {
    defaults = {
      email = "service-123@gcp-sa-cloud-sql.iam.gserviceaccount.com"
    }
  }
}
mock_provider "random" {}

variables {
  project_id = "test-project"
  image_tag  = "test"
}

run "off_by_default_creates_no_key_no_second_instance_and_no_bucket_key" {
  command = apply

  assert {
    condition     = var.cmek_stage == "off"
    error_message = "cmek_stage must default to off, so merging changes nothing in production until the operator opts in."
  }

  assert {
    condition = (
      length(google_kms_key_ring.mutaba3a) == 0
      && length(google_kms_crypto_key.data) == 0
      && length(google_sql_database_instance.postgres_cmek) == 0
      && length(google_kms_crypto_key_iam_member.cloud_sql_uses_key) == 0
      && length(google_kms_crypto_key_iam_member.gcs_uses_key) == 0
    )
    error_message = "Stage off must create no key ring, key, grants or second instance."
  }

  assert {
    condition     = length(google_storage_bucket.attachments.encryption) == 0
    error_message = "Stage off must leave the attachments bucket on Google-managed encryption."
  }

  assert {
    condition     = !contains(keys(google_project_service.apis), "cloudkms.googleapis.com")
    error_message = "Stage off must not enable the KMS API."
  }

  assert {
    condition = (
      strcontains(google_secret_manager_secret_version.database_url.secret_data, google_sql_database_instance.postgres.connection_name)
      && one(google_cloud_run_v2_service.api.template[0].volumes[0].cloud_sql_instance[0].instances) == google_sql_database_instance.postgres.connection_name
      && output.cloud_sql_instance_name == "mutaba3a-pg"
    )
    error_message = "Stage off keeps the API, its secret and the outputs on mutaba3a-pg."
  }

  assert {
    condition     = google_cloud_run_v2_service.api.ingress == "INGRESS_TRAFFIC_ALL"
    error_message = "api_ingress must default to INGRESS_TRAFFIC_ALL."
  }
}

run "prepared_creates_the_key_and_mutaba3a_pg2_but_keeps_serving_from_mutaba3a_pg" {
  command = apply

  variables {
    cmek_stage = "prepared"
  }

  assert {
    condition     = google_kms_key_ring.mutaba3a[0].location == "me-west1" && google_kms_crypto_key.data[0].rotation_period == "7776000s" && google_kms_crypto_key.data[0].purpose == "ENCRYPT_DECRYPT"
    error_message = "The key lives in the service's region and rotates every 90 days."
  }

  assert {
    condition     = length(google_monitoring_alert_policy.kms_key_change) == 0
    error_message = "Without an alert channel there is no key alert (and no channel means no alerting at all)."
  }

  assert {
    condition     = contains(keys(google_project_service.apis), "cloudkms.googleapis.com")
    error_message = "From stage prepared on, the KMS API is enabled."
  }

  assert {
    condition = (
      google_sql_database_instance.postgres_cmek[0].name == "mutaba3a-pg2"
      && google_sql_database_instance.postgres_cmek[0].encryption_key_name == google_kms_crypto_key.data[0].id
    )
    error_message = "mutaba3a-pg2 is encrypted with our key."
  }

  assert {
    condition     = google_storage_bucket.attachments.encryption[0].default_kms_key_name == google_kms_crypto_key.data[0].id
    error_message = "New receipt objects are encrypted with our key from stage prepared on."
  }

  assert {
    condition = (
      google_kms_crypto_key_iam_member.cloud_sql_uses_key[0].member == "serviceAccount:service-123@gcp-sa-cloud-sql.iam.gserviceaccount.com"
      && google_kms_crypto_key_iam_member.gcs_uses_key[0].member == "serviceAccount:service-123@gs-project-accounts.iam.gserviceaccount.com"
      && google_kms_crypto_key_iam_member.cloud_sql_uses_key[0].role == "roles/cloudkms.cryptoKeyEncrypterDecrypter"
      && google_kms_crypto_key_iam_member.gcs_uses_key[0].crypto_key_id == google_kms_crypto_key.data[0].id
    )
    error_message = "Only the Cloud SQL and Cloud Storage service agents may use the key, granted on the key itself."
  }

  assert {
    condition = (
      google_sql_database.mutaba3a_cmek[0].instance == "mutaba3a-pg2"
      && google_sql_user.api_cmek[0].name == google_sql_user.api.name
      && google_sql_user.api_cmek[0].password == google_sql_user.api.password
    )
    error_message = "mutaba3a-pg2 gets the same database and API user, with the same password, so a restored backup's user still matches."
  }

  assert {
    condition = (
      strcontains(google_secret_manager_secret_version.database_url.secret_data, google_sql_database_instance.postgres.connection_name)
      && one(google_cloud_run_v2_service.api.template[0].volumes[0].cloud_sql_instance[0].instances) == google_sql_database_instance.postgres.connection_name
      && output.cloud_sql_instance_name == "mutaba3a-pg"
      && output.cloud_sql_connection_name == google_sql_database_instance.postgres.connection_name
    )
    error_message = "Stage prepared still serves from mutaba3a-pg: secret, Cloud Run volume and outputs."
  }
}

run "a_change_to_a_key_version_pages" {
  command = apply

  variables {
    cmek_stage  = "prepared"
    alert_email = "ops@example.com"
  }

  assert {
    condition = (
      google_monitoring_alert_policy.kms_key_change[0].severity == "CRITICAL"
      && strcontains(google_monitoring_alert_policy.kms_key_change[0].conditions[0].condition_matched_log[0].filter, "DestroyCryptoKeyVersion")
      && strcontains(google_monitoring_alert_policy.kms_key_change[0].conditions[0].condition_matched_log[0].filter, "UpdateCryptoKeyVersion")
      && strcontains(google_monitoring_alert_policy.kms_key_change[0].conditions[0].condition_matched_log[0].filter, "/keyRings/mutaba3a/cryptoKeys/mutaba3a-data")
      && length(google_monitoring_alert_policy.kms_key_change[0].notification_channels) == 1
    )
    error_message = "Disabling, destroying or re-pointing a version of mutaba3a-data pages the alert channels (ADR-163)."
  }

  assert {
    condition     = length(google_monitoring_alert_policy.cloud_sql) == 2 && alltrue([for p in google_monitoring_alert_policy.cloud_sql : strcontains(p.conditions[0].condition_threshold[0].filter, "resource.label.database_id=\"test-project:mutaba3a-pg\"")])
    error_message = "Until stage active, the Cloud SQL alerts watch mutaba3a-pg."
  }
}

run "mutaba3a_pg2_matches_mutaba3a_pg_settings" {
  command = apply

  variables {
    cmek_stage = "prepared"
  }

  assert {
    condition = (
      google_sql_database_instance.postgres_cmek[0].database_version == google_sql_database_instance.postgres.database_version
      && google_sql_database_instance.postgres_cmek[0].region == google_sql_database_instance.postgres.region
      && google_sql_database_instance.postgres_cmek[0].deletion_protection == google_sql_database_instance.postgres.deletion_protection
      && google_sql_database_instance.postgres_cmek[0].settings[0].tier == google_sql_database_instance.postgres.settings[0].tier
      && google_sql_database_instance.postgres_cmek[0].settings[0].availability_type == google_sql_database_instance.postgres.settings[0].availability_type
      && google_sql_database_instance.postgres_cmek[0].settings[0].disk_autoresize == google_sql_database_instance.postgres.settings[0].disk_autoresize
    )
    error_message = "mutaba3a-pg2 runs the same Postgres, tier, availability and deletion protection as mutaba3a-pg."
  }

  assert {
    condition = (
      google_sql_database_instance.postgres_cmek[0].settings[0].backup_configuration[0].enabled
      && google_sql_database_instance.postgres_cmek[0].settings[0].backup_configuration[0].point_in_time_recovery_enabled
      && google_sql_database_instance.postgres_cmek[0].settings[0].backup_configuration[0].transaction_log_retention_days == 7
      && google_sql_database_instance.postgres_cmek[0].settings[0].backup_configuration[0].backup_retention_settings[0].retained_backups == 14
    )
    error_message = "mutaba3a-pg2 keeps the backups the privacy policy promises: 14 daily, 7 days of point-in-time recovery."
  }

  assert {
    condition = (
      google_sql_database_instance.postgres_cmek[0].settings[0].ip_configuration[0].ssl_mode == "ENCRYPTED_ONLY"
      && google_sql_database_instance.postgres_cmek[0].settings[0].ip_configuration[0].ipv4_enabled == google_sql_database_instance.postgres.settings[0].ip_configuration[0].ipv4_enabled
      && one([for flag in google_sql_database_instance.postgres_cmek[0].settings[0].database_flags : flag.value if flag.name == "max_connections"]) == one([for flag in google_sql_database_instance.postgres.settings[0].database_flags : flag.value if flag.name == "max_connections"])
      && google_sql_database_instance.postgres_cmek[0].settings[0].maintenance_window[0].day == google_sql_database_instance.postgres.settings[0].maintenance_window[0].day
      && google_sql_database_instance.postgres_cmek[0].settings[0].maintenance_window[0].hour == google_sql_database_instance.postgres.settings[0].maintenance_window[0].hour
    )
    error_message = "mutaba3a-pg2 keeps encrypted-only connections, the explicit max_connections and the maintenance window."
  }

  # Every other field written out twice in main.tf, compared with mutaba3a-pg rather than a literal.
  assert {
    condition = (
      google_sql_database_instance.postgres_cmek[0].settings[0].backup_configuration[0].start_time == google_sql_database_instance.postgres.settings[0].backup_configuration[0].start_time
      && google_sql_database_instance.postgres_cmek[0].settings[0].backup_configuration[0].enabled == google_sql_database_instance.postgres.settings[0].backup_configuration[0].enabled
      && google_sql_database_instance.postgres_cmek[0].settings[0].backup_configuration[0].point_in_time_recovery_enabled == google_sql_database_instance.postgres.settings[0].backup_configuration[0].point_in_time_recovery_enabled
      && google_sql_database_instance.postgres_cmek[0].settings[0].backup_configuration[0].transaction_log_retention_days == google_sql_database_instance.postgres.settings[0].backup_configuration[0].transaction_log_retention_days
      && google_sql_database_instance.postgres_cmek[0].settings[0].backup_configuration[0].backup_retention_settings[0].retained_backups == google_sql_database_instance.postgres.settings[0].backup_configuration[0].backup_retention_settings[0].retained_backups
      && google_sql_database_instance.postgres_cmek[0].settings[0].maintenance_window[0].update_track == google_sql_database_instance.postgres.settings[0].maintenance_window[0].update_track
      && google_sql_database_instance.postgres_cmek[0].settings[0].disk_size == google_sql_database_instance.postgres.settings[0].disk_size
      && google_sql_database_instance.postgres_cmek[0].settings[0].user_labels == google_sql_database_instance.postgres.settings[0].user_labels
    )
    error_message = "Every setting duplicated on mutaba3a-pg2 matches mutaba3a-pg."
  }
}

run "the_cutover_apply_keeps_ingress_internal" {
  command = apply

  variables {
    cmek_stage  = "active"
    api_ingress = "INGRESS_TRAFFIC_INTERNAL_ONLY"
  }

  assert {
    condition     = google_cloud_run_v2_service.api.ingress == "INGRESS_TRAFFIC_INTERNAL_ONLY"
    error_message = "The switch apply (DEPLOYMENT.md §6d) keeps outside traffic away until verify passes."
  }
}

run "active_moves_the_secret_the_volume_the_outputs_and_the_alerts_to_mutaba3a_pg2" {
  command = apply

  variables {
    cmek_stage  = "active"
    alert_email = "ops@example.com"
  }

  assert {
    condition = (
      strcontains(google_secret_manager_secret_version.database_url.secret_data, "host=/cloudsql/${google_sql_database_instance.postgres_cmek[0].connection_name}&")
      && one(google_cloud_run_v2_service.api.template[0].volumes[0].cloud_sql_instance[0].instances) == google_sql_database_instance.postgres_cmek[0].connection_name
    )
    error_message = "At stage active the DATABASE_URL secret and the Cloud Run volume name mutaba3a-pg2."
  }

  assert {
    condition = (
      output.cloud_sql_instance_name == "mutaba3a-pg2"
      && output.cloud_sql_connection_name == google_sql_database_instance.postgres_cmek[0].connection_name
    )
    error_message = "deploy.sh, db.sh and the restore drill read the active instance from these outputs."
  }

  assert {
    condition     = length(google_monitoring_alert_policy.cloud_sql) == 2 && alltrue([for p in google_monitoring_alert_policy.cloud_sql : strcontains(p.conditions[0].condition_threshold[0].filter, "resource.label.database_id=\"test-project:mutaba3a-pg2\"")])
    error_message = "The Cloud SQL alerts follow the active instance."
  }

  assert {
    condition     = google_cloud_run_v2_service.api.ingress == "INGRESS_TRAFFIC_ALL"
    error_message = "The second apply, without api_ingress, reopens the service."
  }

  assert {
    condition     = google_sql_database_instance.postgres.deletion_protection
    error_message = "mutaba3a-pg stays, deletion-protected, until MUT-383."
  }
}

run "an_unknown_cmek_stage_is_refused" {
  command = plan

  # Every run after "prepared" stays forward: going back would plan the key's destroy.
  variables {
    cmek_stage = "on"
  }

  expect_failures = [var.cmek_stage]
}

run "an_unknown_api_ingress_is_refused" {
  command = plan

  variables {
    cmek_stage  = "active"
    api_ingress = "all"
  }

  expect_failures = [var.api_ingress]
}
