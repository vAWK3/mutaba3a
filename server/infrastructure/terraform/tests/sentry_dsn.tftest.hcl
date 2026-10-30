# MUT-148 (ADR-091): the API's Sentry DSN, read from the Sentry stack's state and mounted as SENTRY_DSN.
# Off by default, so merging turns nothing on in production. Providers and the remote state are mocked:
#   terraform init -backend=false && terraform test

mock_provider "google" {
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

override_data {
  target = data.terraform_remote_state.sentry[0]
  values = {
    outputs = {
      dsn = { api = "https://publickey@o4501.ingest.de.sentry.io/4502" }
    }
  }
}

variables {
  project_id = "test-project"
  region     = "europe-west1"
  image_tag  = "test"
  hosts_file = "../../../config/fixtures/hosts.no-domain.json"
}

run "off_by_default_no_secret_no_env" {
  command = apply

  assert {
    condition     = var.sentry_enabled == false
    error_message = "sentry_enabled must default to false, so merging MUT-148 turns nothing on in production."
  }

  assert {
    condition     = length(google_secret_manager_secret.sentry_dsn) == 0 && length(data.terraform_remote_state.sentry) == 0
    error_message = "With sentry_enabled off there is no DSN secret and no read of the Sentry state."
  }

  assert {
    condition     = length([for e in google_cloud_run_v2_service.api.template[0].containers[0].env : e if startswith(e.name, "SENTRY_")]) == 0
    error_message = "With sentry_enabled off the service gets no SENTRY_ variable."
  }
}

run "on_mounts_the_dsn_from_the_sentry_state" {
  command = apply

  variables {
    sentry_enabled = true
  }

  assert {
    condition     = google_secret_manager_secret.sentry_dsn[0].secret_id == "mutaba3a-api-sentry-dsn"
    error_message = "The DSN secret must be named mutaba3a-api-sentry-dsn (deploy.sh and sentry:smoke read it by that name)."
  }

  assert {
    condition     = google_secret_manager_secret_version.sentry_dsn[0].secret_data == "https://publickey@o4501.ingest.de.sentry.io/4502"
    error_message = "The secret must hold the Sentry stack's api DSN."
  }

  assert {
    condition     = data.terraform_remote_state.sentry[0].config.bucket == "test-project-terraform-state" && data.terraform_remote_state.sentry[0].config.prefix == "mutaba3a-sentry/production"
    error_message = "The Sentry state is read from <project>-terraform-state under mutaba3a-sentry/<environment>."
  }

  assert {
    condition = one([
      for e in google_cloud_run_v2_service.api.template[0].containers[0].env :
      e.value_source[0].secret_key_ref[0].secret if e.name == "SENTRY_DSN"
    ]) == "mutaba3a-api-sentry-dsn"
    error_message = "SENTRY_DSN must come from the DSN secret."
  }

  assert {
    condition     = one([for e in google_cloud_run_v2_service.api.template[0].containers[0].env : e.value if e.name == "SENTRY_ENVIRONMENT"]) == "production"
    error_message = "Events are filed under the Terraform environment."
  }

  assert {
    condition     = google_secret_manager_secret_iam_member.api_reads_sentry_dsn[0].role == "roles/secretmanager.secretAccessor"
    error_message = "The API service account must be able to read the DSN secret."
  }
}

run "refuses_a_dsn_outside_the_eu_region" {
  command = plan

  variables {
    sentry_enabled = true
  }

  override_data {
    target = data.terraform_remote_state.sentry[0]
    values = {
      outputs = {
        dsn = { api = "https://publickey@o4501.ingest.us.sentry.io/4502" }
      }
    }
  }

  expect_failures = [google_secret_manager_secret_version.sentry_dsn]
}
