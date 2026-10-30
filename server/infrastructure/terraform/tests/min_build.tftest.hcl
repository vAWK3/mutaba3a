# MUT-457: the phone's minimum build (MUT-293) set from production.tfvars. Nothing set = no env var, so merging
# changes nothing in production; the kill switch goes out only as "true". Providers are mocked:
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

run "unset_adds_no_env" {
  command = apply

  assert {
    condition = length([for e in google_cloud_run_v2_service.api.template[0].containers[0].env : e if contains([
      "IOS_MIN_BUILD", "ANDROID_MIN_BUILD", "IOS_RECOMMENDED_BUILD", "ANDROID_RECOMMENDED_BUILD", "MIN_BUILD_CHECK_DISABLED",
    ], e.name)]) == 0
    error_message = "With nothing set the service gets none of the minimum-build variables, so the gate stays as it was."
  }
}

run "floors_reach_the_env" {
  command = apply

  variables {
    android_min_build         = 12
    ios_min_build             = 8
    ios_recommended_build     = 8
    android_recommended_build = 13
  }

  assert {
    condition = {
      for e in google_cloud_run_v2_service.api.template[0].containers[0].env : e.name => e.value
      if contains(["IOS_MIN_BUILD", "ANDROID_MIN_BUILD", "IOS_RECOMMENDED_BUILD", "ANDROID_RECOMMENDED_BUILD", "MIN_BUILD_CHECK_DISABLED"], e.name)
      } == {
      IOS_MIN_BUILD             = "8"
      ANDROID_MIN_BUILD         = "12"
      IOS_RECOMMENDED_BUILD     = "8"
      ANDROID_RECOMMENDED_BUILD = "13"
    }
    error_message = "Exactly the floors that are set reach Cloud Run, as whole-number strings config.ts reads; a recommended build equal to its floor is allowed."
  }
}

run "disabled_true_emits_true" {
  command = apply

  variables {
    min_build_check_disabled = true
  }

  assert {
    condition     = one([for e in google_cloud_run_v2_service.api.template[0].containers[0].env : e.value if e.name == "MIN_BUILD_CHECK_DISABLED"]) == "true"
    error_message = "min_build_check_disabled = true must set MIN_BUILD_CHECK_DISABLED=true on Cloud Run."
  }
}

run "disabled_false_emits_nothing" {
  command = apply

  variables {
    min_build_check_disabled = false
    android_min_build        = 12
  }

  assert {
    condition     = length([for e in google_cloud_run_v2_service.api.template[0].containers[0].env : e if e.name == "MIN_BUILD_CHECK_DISABLED"]) == 0
    error_message = "min_build_check_disabled = false sends nothing: absent is off, and the gate stays on."
  }
}

run "recommended_below_min_fails" {
  command = plan

  variables {
    ios_min_build         = 5
    ios_recommended_build = 3
  }

  expect_failures = [google_cloud_run_v2_service.api]
}

run "recommended_without_min_fails" {
  command = plan

  variables {
    android_recommended_build = 13
  }

  expect_failures = [google_cloud_run_v2_service.api]
}

run "zero_floor_rejected" {
  command = plan

  variables {
    android_min_build = 0
  }

  expect_failures = [var.android_min_build]
}
