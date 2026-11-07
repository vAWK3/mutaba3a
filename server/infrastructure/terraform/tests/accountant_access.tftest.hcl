# MUT-558 (MUT-577/579): accountant access, share links and period downloads ship on in production as global kill
# switches (an owner shares only once the operator grants accountant_access); the Accountant plan stays dormant.
# The API reads each switch as off when unset, so terraform must set the three it wants on. Providers are mocked:
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

run "defaults_turn_the_three_switches_on_and_leave_the_plan_dormant" {
  command = apply

  assert {
    condition     = [for e in google_cloud_run_v2_service.api.template[0].containers[0].env : e.value if e.name == "ACCOUNTANT_ACCESS"] == ["true"]
    error_message = "By default the service gets ACCOUNTANT_ACCESS=true, exactly once (MUT-577/579)."
  }
  assert {
    condition     = [for e in google_cloud_run_v2_service.api.template[0].containers[0].env : e.value if e.name == "SHARE_LINKS"] == ["true"]
    error_message = "By default the service gets SHARE_LINKS=true, exactly once."
  }
  assert {
    condition     = [for e in google_cloud_run_v2_service.api.template[0].containers[0].env : e.value if e.name == "PERIOD_DOWNLOADS"] == ["true"]
    error_message = "By default the service gets PERIOD_DOWNLOADS=true, exactly once."
  }
  assert {
    condition     = length([for e in google_cloud_run_v2_service.api.template[0].containers[0].env : e if e.name == "ACCOUNTANT_PLAN"]) == 0
    error_message = "By default the service gets no ACCOUNTANT_PLAN: the plan is dormant and accountants are free."
  }
}

run "kill_switches_send_nothing" {
  command = apply

  variables {
    accountant_access_enabled = false
    share_links_enabled       = false
    period_downloads_enabled  = false
  }

  assert {
    condition     = length([for e in google_cloud_run_v2_service.api.template[0].containers[0].env : e if contains(["ACCOUNTANT_ACCESS", "SHARE_LINKS", "PERIOD_DOWNLOADS", "ACCOUNTANT_PLAN"], e.name)]) == 0
    error_message = "With every switch off the service gets none of the four variables (the API reads absent as off)."
  }
}

run "plan_on_with_stripe_sets_accountant_plan" {
  command = apply

  variables {
    stripe_enabled          = true
    accountant_plan_enabled = true
  }

  assert {
    condition     = [for e in google_cloud_run_v2_service.api.template[0].containers[0].env : e.value if e.name == "ACCOUNTANT_PLAN"] == ["true"]
    error_message = "With accountant_plan_enabled the service gets ACCOUNTANT_PLAN=true, exactly once."
  }
}

run "plan_without_stripe_is_refused" {
  command = plan

  variables {
    accountant_plan_enabled = true
  }

  expect_failures = [google_cloud_run_v2_service.api]
}
