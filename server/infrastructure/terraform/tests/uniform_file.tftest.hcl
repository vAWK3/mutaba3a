# MUT-569 (ADR-270): the uniform file's software fields reach Cloud Run only when set; unset, the API writes its
# placeholders. Providers are mocked:
#   terraform init -backend=false && terraform test -filter=tests/uniform_file.tftest.hcl

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

run "unset_sends_nothing" {
  command = plan

  assert {
    condition     = length([for e in google_cloud_run_v2_service.api.template[0].containers[0].env : e if contains(["UNIFORM_FILE_REGISTRATION_NUMBER", "SOFTWARE_HOUSE_VAT_ID", "SOFTWARE_HOUSE_NAME"], e.name)]) == 0
    error_message = "Unset, the service gets none of the uniform-file variables (the API's placeholders apply)."
  }
}

run "narabnd_reaches_the_service" {
  command = plan

  variables {
    software_house_vat_id            = "517108775"
    software_house_name              = "נאראבנד סטודיו בע\"מ"
    uniform_file_registration_number = "12345678"
  }

  assert {
    condition     = [for e in google_cloud_run_v2_service.api.template[0].containers[0].env : e.value if e.name == "SOFTWARE_HOUSE_VAT_ID"] == ["517108775"]
    error_message = "SOFTWARE_HOUSE_VAT_ID reaches the service once."
  }
  assert {
    condition     = [for e in google_cloud_run_v2_service.api.template[0].containers[0].env : e.value if e.name == "SOFTWARE_HOUSE_NAME"] == ["נאראבנד סטודיו בע\"מ"]
    error_message = "SOFTWARE_HOUSE_NAME reaches the service once."
  }
  assert {
    condition     = [for e in google_cloud_run_v2_service.api.template[0].containers[0].env : e.value if e.name == "UNIFORM_FILE_REGISTRATION_NUMBER"] == ["12345678"]
    error_message = "UNIFORM_FILE_REGISTRATION_NUMBER reaches the service once."
  }
}

run "a_wrong_company_number_is_refused" {
  command = plan

  variables {
    software_house_vat_id = "51710877"
  }

  expect_failures = [var.software_house_vat_id]
}
