# MUT-641 (ADR-265): the issued-document signing key is off by default, and a certificate chain without the key fails
# the plan. Providers are mocked:
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
  mock_resource "google_kms_key_ring" {
    defaults = {
      id = "projects/test-project/locations/europe-west1/keyRings/mutaba3a-issuing"
    }
  }
  mock_resource "google_kms_crypto_key" {
    defaults = {
      id = "projects/test-project/locations/europe-west1/keyRings/mutaba3a-issuing/cryptoKeys/issued-documents"
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

run "off_by_default" {
  command = plan

  assert {
    condition     = length(google_kms_crypto_key.issuing_documents) == 0 && !contains(keys(google_project_service.apis), "cloudkms.googleapis.com")
    error_message = "No KMS key (and no KMS API) until issuing_signing_key."
  }
}


run "refuses_a_chain_without_the_key" {
  command = plan

  variables {
    issuing_signing_cert_chain = "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n"
  }

  expect_failures = [google_cloud_run_v2_service.api]
}
