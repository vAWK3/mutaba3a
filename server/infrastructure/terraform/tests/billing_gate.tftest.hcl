# MUT-361: the lapse gate is on by default (no BILLING_GATE variable); billing_gate_enabled = false is the operator's
# kill switch and sets BILLING_GATE=false. Providers are mocked:
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
mock_provider "google-beta" {}
mock_provider "random" {}

variables {
  project_id = "test-project"
  image_tag  = "test"
  hosts_file = "../../../config/fixtures/hosts.no-domain.json"
}

run "on_by_default_no_env" {
  command = apply

  assert {
    condition     = var.billing_gate_enabled == true
    error_message = "billing_gate_enabled must default to true: the API enforces the gate unless the operator turns it off."
  }

  assert {
    condition     = length([for e in google_cloud_run_v2_service.api.template[0].containers[0].env : e if e.name == "BILLING_GATE"]) == 0
    error_message = "With the gate on the service gets no BILLING_GATE variable (the API's own default is on)."
  }
}

run "kill_switch_sets_false" {
  command = apply

  variables {
    billing_gate_enabled = false
  }

  assert {
    condition     = one([for e in google_cloud_run_v2_service.api.template[0].containers[0].env : e.value if e.name == "BILLING_GATE"]) == "false"
    error_message = "billing_gate_enabled = false must set BILLING_GATE=false on Cloud Run."
  }
}
