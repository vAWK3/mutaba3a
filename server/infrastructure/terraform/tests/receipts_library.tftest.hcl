# MUT-389/659: the receipts library is on for everyone (MUT-659). RECEIPTS_LIBRARY is always set, so turning it
# off says "false" to an API that defaults to on. Providers are mocked:
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

run "on_by_default" {
  command = apply

  assert {
    condition     = var.receipts_library_enabled == true
    error_message = "receipts_library_enabled defaults to true since MUT-659 (receipts on for everyone)."
  }

  assert {
    condition     = [for e in google_cloud_run_v2_service.api.template[0].containers[0].env : e.value if e.name == "RECEIPTS_LIBRARY"] == ["true"]
    error_message = "By default the service gets RECEIPTS_LIBRARY=true, exactly once."
  }
}

run "off_says_false" {
  command = apply

  variables {
    receipts_library_enabled = false
  }

  assert {
    condition     = [for e in google_cloud_run_v2_service.api.template[0].containers[0].env : e.value if e.name == "RECEIPTS_LIBRARY"] == ["false"]
    error_message = "With receipts_library_enabled off the service gets RECEIPTS_LIBRARY=false, since the API defaults to on."
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
