# MUT-740 (ADR-287 D4): the live invoicing countries ship as Israel only. INVOICING_JURISDICTIONS reaches Cloud Run only
# when invoicing_jurisdictions differs from IL, so merging changes nothing until the operator widens it. Providers are mocked:
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

run "default_is_israel_and_sets_no_env" {
  command = apply

  assert {
    condition     = var.invoicing_jurisdictions == "IL"
    error_message = "invoicing_jurisdictions must default to IL."
  }
  assert {
    condition     = length([for e in google_cloud_run_v2_service.api.template[0].containers[0].env : e if e.name == "INVOICING_JURISDICTIONS"]) == 0
    error_message = "With the default the service gets no INVOICING_JURISDICTIONS (the server's own default is IL)."
  }
}

run "widened_list_is_set_upper_cased_without_spaces" {
  command = apply

  variables {
    invoicing_jurisdictions = "il, sa"
  }

  assert {
    condition     = [for e in google_cloud_run_v2_service.api.template[0].containers[0].env : e.value if e.name == "INVOICING_JURISDICTIONS"] == ["IL,SA"]
    error_message = "A wider list reaches the service as INVOICING_JURISDICTIONS=IL,SA."
  }
}

run "junk_is_refused_at_plan" {
  command = plan

  variables {
    invoicing_jurisdictions = "ISR"
  }

  expect_failures = [var.invoicing_jurisdictions]
}
