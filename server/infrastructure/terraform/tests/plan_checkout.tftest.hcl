# MUT-702 Part B (ADR-286): the plans ship off. PLAN_CHECKOUT reaches Cloud Run only once its variable is set, so
# merging sells nothing new until the operator turns it on. Providers are mocked:
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
    condition     = length([for e in google_cloud_run_v2_service.api.template[0].containers[0].env : e if e.name == "PLAN_CHECKOUT"]) == 0
    error_message = "With plan_checkout off the service gets no PLAN_CHECKOUT."
  }
}

run "on_sets_it" {
  command = apply

  variables {
    plan_checkout = true
  }

  assert {
    condition     = [for e in google_cloud_run_v2_service.api.template[0].containers[0].env : e.value if e.name == "PLAN_CHECKOUT"] == ["true"]
    error_message = "With plan_checkout on the service gets PLAN_CHECKOUT=true."
  }
}
