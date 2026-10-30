# MUT-389: the receipts library ships dark. RECEIPTS_LIBRARY reaches Cloud Run only once receipts_library_enabled,
# so merging turns nothing on in production. Providers are mocked:
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
  image_tag  = "test"
  hosts_file = "../../../config/fixtures/hosts.no-domain.json"
}

run "off_by_default_no_env" {
  command = apply

  assert {
    condition     = var.receipts_library_enabled == false
    error_message = "receipts_library_enabled must default to false, so merging MUT-389 turns nothing on in production."
  }

  assert {
    condition     = length([for e in google_cloud_run_v2_service.api.template[0].containers[0].env : e if e.name == "RECEIPTS_LIBRARY"]) == 0
    error_message = "With receipts_library_enabled off the service gets no RECEIPTS_LIBRARY variable."
  }
}

run "on_sets_receipts_library_true" {
  command = apply

  variables {
    receipts_library_enabled = true
  }

  assert {
    condition     = [for e in google_cloud_run_v2_service.api.template[0].containers[0].env : e.value if e.name == "RECEIPTS_LIBRARY"] == ["true"]
    error_message = "With receipts_library_enabled on the service gets RECEIPTS_LIBRARY=true, exactly once."
  }
}
