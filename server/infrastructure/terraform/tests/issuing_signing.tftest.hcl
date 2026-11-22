# MUT-641 (ADR-265): the issued-document signing key. Off by default; issuing_signing_key creates an HSM key the API
# may only sign with; signing reaches the API only once the key's certificate chain is set. Providers are mocked:
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

run "key_without_certificate_signs_nothing" {
  command = apply

  variables {
    issuing_signing_key = true
  }

  assert {
    condition = (
      google_kms_crypto_key.issuing_documents[0].purpose == "ASYMMETRIC_SIGN"
      && google_kms_crypto_key.issuing_documents[0].version_template[0].protection_level == "HSM"
      && google_kms_crypto_key.issuing_documents[0].version_template[0].algorithm == "RSA_SIGN_PKCS1_3072_SHA256"
      && google_kms_key_ring.issuing[0].location == "europe-west1"
    )
    error_message = "An HSM-protected RSA 3072 signing key, in the API's region."
  }

  assert {
    condition = (
      google_kms_crypto_key_iam_member.api_signs_issued_documents[0].role == "roles/cloudkms.signer"
      && google_kms_crypto_key_iam_member.api_signs_issued_documents[0].member == "serviceAccount:mutaba3a-api@test-project.iam.gserviceaccount.com"
    )
    error_message = "The API's service account may sign with the key, nothing more."
  }

  assert {
    condition     = length([for e in google_cloud_run_v2_service.api.template[0].containers[0].env : e if startswith(e.name, "ISSUING_")]) == 0
    error_message = "Without the certificate the API gets no ISSUING_ variables: it doesn't sign, and its PDF routes answer 503."
  }

  assert {
    condition     = output.issuing_signing_key_version == "projects/test-project/locations/europe-west1/keyRings/mutaba3a-issuing/cryptoKeys/issued-documents/cryptoKeyVersions/1"
    error_message = "The output names version 1, for `npm run signing:interim-cert -- --key`."
  }
}

run "certificate_turns_signing_on" {
  command = apply

  variables {
    issuing_signing_key        = true
    issuing_signing_cert_chain = "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n"
  }

  assert {
    condition = (
      one([for e in google_cloud_run_v2_service.api.template[0].containers[0].env : e.value if e.name == "ISSUING_SIGNER"]) == "kms"
      && one([for e in google_cloud_run_v2_service.api.template[0].containers[0].env : e.value if e.name == "ISSUING_SIGNING_KMS_KEY"]) == "projects/test-project/locations/europe-west1/keyRings/mutaba3a-issuing/cryptoKeys/issued-documents/cryptoKeyVersions/1"
      && one([for e in google_cloud_run_v2_service.api.template[0].containers[0].env : e.value if e.name == "ISSUING_SIGNING_CERT_CHAIN"]) == "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n"
      && one([for e in google_cloud_run_v2_service.api.template[0].containers[0].env : e.value if e.name == "ISSUING_TSA_URL"]) == "http://timestamp.digicert.com"
    )
    error_message = "With the certificate, the API signs with the KMS key version, the chain and DigiCert's time-stamps."
  }
}

run "refuses_a_private_key_in_the_chain" {
  command = plan

  variables {
    issuing_signing_key        = true
    issuing_signing_cert_chain = "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n-----BEGIN PRIVATE KEY-----\nAA\n-----END PRIVATE KEY-----\n"
  }

  expect_failures = [var.issuing_signing_cert_chain]
}

run "refuses_a_chain_without_the_key" {
  command = plan

  variables {
    issuing_signing_cert_chain = "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n"
  }

  expect_failures = [var.issuing_signing_cert_chain]
}
