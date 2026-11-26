# MUT-731 (ADR-284): Starter ships off. STARTER_PLAN and SOLO_TRIAL_OFFER_SINCE reach Cloud Run only once their
# variables are set, so merging changes nobody's plan until the operator turns it on. Providers are mocked:
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

variables {
  project_id = "test-project"
  region     = "europe-west1"
  image_tag  = "test"
  hosts_file = "../../../config/fixtures/hosts.no-domain.json"
}

run "off_by_default_no_env" {
  command = apply

  assert {
    condition     = length([for e in google_cloud_run_v2_service.api.template[0].containers[0].env : e if e.name == "STARTER_PLAN" || e.name == "SOLO_TRIAL_OFFER_SINCE"]) == 0
    error_message = "With starter_plan off and no solo_trial_offer_since the service gets neither variable."
  }
}

run "on_sets_both" {
  command = apply

  variables {
    starter_plan           = true
    solo_trial_offer_since = "2027-01-15T00:00:00Z"
  }

  assert {
    condition     = [for e in google_cloud_run_v2_service.api.template[0].containers[0].env : e.value if e.name == "STARTER_PLAN"] == ["true"]
    error_message = "With starter_plan on the service gets STARTER_PLAN=true."
  }
  assert {
    condition     = [for e in google_cloud_run_v2_service.api.template[0].containers[0].env : e.value if e.name == "SOLO_TRIAL_OFFER_SINCE"] == ["2027-01-15T00:00:00Z"]
    error_message = "The trial's start instant reaches the service as given."
  }
}
