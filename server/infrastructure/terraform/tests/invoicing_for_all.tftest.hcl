# MUT-736 (ADR-282): invoicing for everyone ships off. INVOICING_FOR_ALL reaches Cloud Run only once
# invoicing_for_all, so merging changes nobody's issuing until the operator turns it on. Providers are mocked:
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
    condition     = var.invoicing_for_all == false
    error_message = "invoicing_for_all must default to false: the operator turns it on at release."
  }
  assert {
    condition     = length([for e in google_cloud_run_v2_service.api.template[0].containers[0].env : e if e.name == "INVOICING_FOR_ALL"]) == 0
    error_message = "With invoicing_for_all off the service gets no INVOICING_FOR_ALL."
  }
}

run "on_sets_invoicing_for_all_true" {
  command = apply

  variables {
    invoicing_for_all = true
  }

  assert {
    condition     = [for e in google_cloud_run_v2_service.api.template[0].containers[0].env : e.value if e.name == "INVOICING_FOR_ALL"] == ["true"]
    error_message = "With invoicing_for_all on the service gets INVOICING_FOR_ALL=true."
  }
}
