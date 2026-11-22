# MUT-710 (ADR-274 D10): the issuing gate ships dark. TWO_FACTOR_ISSUING_GATE_ENABLED reaches Cloud Run only once
# two_factor_issuing_gate_enabled, so merging locks nobody out of issuing. Providers are mocked:
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
    condition     = var.two_factor_issuing_gate_enabled == false
    error_message = "two_factor_issuing_gate_enabled must default to false: nobody can turn two-step sign-in on before its screens ship."
  }
  assert {
    condition     = length([for e in google_cloud_run_v2_service.api.template[0].containers[0].env : e if e.name == "TWO_FACTOR_ISSUING_GATE_ENABLED"]) == 0
    error_message = "With two_factor_issuing_gate_enabled off the service gets no TWO_FACTOR_ISSUING_GATE_ENABLED."
  }
}

run "on_sets_the_gate_true" {
  command = apply

  variables {
    two_factor_issuing_gate_enabled = true
  }

  assert {
    condition     = [for e in google_cloud_run_v2_service.api.template[0].containers[0].env : e.value if e.name == "TWO_FACTOR_ISSUING_GATE_ENABLED"] == ["true"]
    error_message = "With two_factor_issuing_gate_enabled on the service gets TWO_FACTOR_ISSUING_GATE_ENABLED=true."
  }
}
