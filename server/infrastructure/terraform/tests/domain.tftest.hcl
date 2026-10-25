# MUT-326 (ADR-155): the custom domain reaches Cloud Run only through config/hosts.json, checked offline.
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
# MUT-381: versions.tf configures google-beta too; unmocked, it would load real credentials.
mock_provider "google-beta" {}
mock_provider "random" {}

variables {
  project_id = "test-project"
  image_tag  = "test"
}

run "no_domain_changes_nothing" {
  command = plan

  variables {
    hosts_file = "../../../config/fixtures/hosts.no-domain.json"
  }

  assert {
    condition     = length([for e in google_cloud_run_v2_service.api.template[0].containers[0].env : e if contains(["PORTAL_ORIGIN", "FRONT_DOOR_TOKEN", "PORTAL_LEGACY_REDIRECT", "WEBAUTHN_RP_ID"], e.name)]) == 0
    error_message = "With no domain, Cloud Run gets no front-door env: today's plan must not change."
  }

  assert {
    condition     = length(google_secret_manager_secret_iam_member.api_reads_front_door_token) == 0 && length(data.google_secret_manager_secret.front_door_token) == 0
    error_message = "With no domain, the front-door secret is neither read nor granted."
  }

  assert {
    condition     = output.public_portal_origin == "https://portal.example.test"
    error_message = "With no domain, users reach the portal on the legacy host."
  }
}

run "the_checked_in_config_changes_nothing_today" {
  command = plan

  assert {
    condition     = length(google_secret_manager_secret_iam_member.api_reads_front_door_token) == (jsondecode(file("../../../config/hosts.json")).production.domain == null ? 0 : 1)
    error_message = "The real config/hosts.json drives the front door."
  }
}

run "a_live_domain_gives_cloud_run_the_front_door" {
  command = plan

  variables {
    hosts_file = "../../../config/fixtures/hosts.placeholder.json"
  }

  assert {
    condition     = one([for e in google_cloud_run_v2_service.api.template[0].containers[0].env : e.value if e.name == "PORTAL_ORIGIN"]) == "https://app.placeholder.example"
    error_message = "PORTAL_ORIGIN is the portal subdomain under the apex."
  }

  assert {
    condition     = one([for e in google_cloud_run_v2_service.api.template[0].containers[0].env : e.value_source[0].secret_key_ref[0].secret if e.name == "FRONT_DOOR_TOKEN"]) == "mutaba3a-api-front-door-token"
    error_message = "FRONT_DOOR_TOKEN comes from the frontdoor stack's secret, never a plain value."
  }

  assert {
    condition     = length([for e in google_cloud_run_v2_service.api.template[0].containers[0].env : e if e.name == "PORTAL_LEGACY_REDIRECT"]) == 0
    error_message = "Stage live keeps the legacy hosts answering: no redirect."
  }

  assert {
    condition     = length(google_secret_manager_secret_iam_member.api_reads_front_door_token) == 1
    error_message = "The API's service account may read the token."
  }

  assert {
    condition     = one([for e in google_cloud_run_v2_service.api.template[0].containers[0].env : e.value if e.name == "WEBAUTHN_RP_ID"]) == "placeholder.example"
    error_message = "MUT-115: from stage live the passkey relying party is the apex, so the portal subdomain and the iOS app share passkeys."
  }

  assert {
    condition     = output.public_portal_origin == "https://app.placeholder.example"
    error_message = "From stage live on, users reach the portal on the new host."
  }
}

run "staging_has_no_domain_unless_the_file_names_one" {
  command = apply # the service URL is known only after a (mocked) apply

  variables {
    hosts_file  = "../../../config/fixtures/hosts.no-domain.json"
    environment = "staging"
  }

  assert {
    condition     = length(google_secret_manager_secret_iam_member.api_reads_front_door_token) == 0
    error_message = "An environment the hosts config doesn't name gets no front door."
  }

  assert {
    condition     = output.public_portal_origin == "https://mutaba3a-api-test.a.run.example"
    error_message = "An unnamed environment's portal is the service's own URL."
  }
}
