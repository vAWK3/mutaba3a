# MUT-731 (ADR-284): Starter ships off. STARTER_PLAN and SOLO_TRIAL_OFFER_SINCE reach Cloud Run only once their
# variables are set, so merging changes nobody's plan until the operator turns it on. Providers are mocked:
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
    condition     = length([for e in google_cloud_run_v2_service.api.template[0].containers[0].env : e if e.name == "STARTER_PLAN" || e.name == "SOLO_TRIAL_OFFER_SINCE"]) == 0
    error_message = "With starter_plan off and no solo_trial_offer_since the service gets neither variable."
  }
}

run "on_sets_both" {
  command = apply

  variables {
    starter_plan           = true
    solo_trial_offer_since = "2027-01-15T00:00:00Z"
  }

  assert {
    condition     = [for e in google_cloud_run_v2_service.api.template[0].containers[0].env : e.value if e.name == "STARTER_PLAN"] == ["true"]
    error_message = "With starter_plan on the service gets STARTER_PLAN=true."
  }
  assert {
    condition     = [for e in google_cloud_run_v2_service.api.template[0].containers[0].env : e.value if e.name == "SOLO_TRIAL_OFFER_SINCE"] == ["2027-01-15T00:00:00Z"]
    error_message = "The trial's start instant reaches the service as given."
  }
}

# MUT-737 (ADR-289): open sign-up ships off and reaches Cloud Run only with its variable (and only beside Starter).
run "open_signup_off_by_default" {
  command = apply

  assert {
    condition     = length([for e in google_cloud_run_v2_service.api.template[0].containers[0].env : e if e.name == "OPEN_SIGNUP"]) == 0
    error_message = "With open_signup off the service gets no OPEN_SIGNUP."
  }
}

run "open_signup_on_with_starter" {
  command = apply

  variables {
    starter_plan = true
    open_signup  = true
  }

  assert {
    condition     = [for e in google_cloud_run_v2_service.api.template[0].containers[0].env : e.value if e.name == "OPEN_SIGNUP"] == ["true"]
    error_message = "With open_signup on the service gets OPEN_SIGNUP=true."
  }
}

run "open_signup_without_starter_refused" {
  command = plan

  variables {
    open_signup = true
  }

  expect_failures = [var.open_signup]
}

# MUT-734 (ADR-291): the paid plans' business counts ship off.
run "paid_business_caps_off_by_default" {
  command = apply

  assert {
    condition     = length([for e in google_cloud_run_v2_service.api.template[0].containers[0].env : e if e.name == "PAID_BUSINESS_CAPS"]) == 0
    error_message = "With paid_business_caps off the service gets no PAID_BUSINESS_CAPS."
  }
}

run "paid_business_caps_on" {
  command = apply

  variables {
    paid_business_caps = true
  }

  assert {
    condition     = [for e in google_cloud_run_v2_service.api.template[0].containers[0].env : e.value if e.name == "PAID_BUSINESS_CAPS"] == ["true"]
    error_message = "With paid_business_caps on the service gets PAID_BUSINESS_CAPS=true."
  }
}

# MUT-733 (ADR-293): the paid hard caps ship off.
run "paid_hard_caps_off_by_default" {
  command = apply

  assert {
    condition     = length([for e in google_cloud_run_v2_service.api.template[0].containers[0].env : e if e.name == "PAID_HARD_CAPS"]) == 0
    error_message = "With paid_hard_caps off the service gets no PAID_HARD_CAPS."
  }
}

run "paid_hard_caps_on" {
  command = apply

  variables {
    paid_hard_caps = true
  }

  assert {
    condition     = [for e in google_cloud_run_v2_service.api.template[0].containers[0].env : e.value if e.name == "PAID_HARD_CAPS"] == ["true"]
    error_message = "With paid_hard_caps on the service gets PAID_HARD_CAPS=true."
  }
}

# MUT-764..767 (ADR-292), MUT-595 and MUT-593 (ADR-254): the accountant channel and the two Malafat switches ship off
# and reach Cloud Run only with their variables, each as "true" alone (Switch rollout, docs/operations/before-release.md).
run "accountant_and_malafat_switches_off_by_default" {
  command = apply

  assert {
    condition     = length([for e in google_cloud_run_v2_service.api.template[0].containers[0].env : e if contains(["ACCOUNTANT_PROVISIONING", "MALAFAT_SIGN_IN", "MALAFAT_DELEGATION"], e.name)]) == 0
    error_message = "With the three switches off the service gets none of ACCOUNTANT_PROVISIONING, MALAFAT_SIGN_IN, MALAFAT_DELEGATION."
  }
}

run "accountant_provisioning_on" {
  command = apply

  variables {
    accountant_provisioning = true
  }

  assert {
    condition     = [for e in google_cloud_run_v2_service.api.template[0].containers[0].env : e.value if e.name == "ACCOUNTANT_PROVISIONING"] == ["true"]
    error_message = "With accountant_provisioning on the service gets ACCOUNTANT_PROVISIONING=true, exactly once."
  }
  assert {
    condition     = length([for e in google_cloud_run_v2_service.api.template[0].containers[0].env : e if contains(["MALAFAT_SIGN_IN", "MALAFAT_DELEGATION"], e.name)]) == 0
    error_message = "accountant_provisioning turns on nothing else."
  }
}

run "malafat_sign_in_on" {
  command = apply

  variables {
    malafat_sign_in = true
  }

  assert {
    condition     = [for e in google_cloud_run_v2_service.api.template[0].containers[0].env : e.value if e.name == "MALAFAT_SIGN_IN"] == ["true"]
    error_message = "With malafat_sign_in on the service gets MALAFAT_SIGN_IN=true, exactly once."
  }
  assert {
    condition     = length([for e in google_cloud_run_v2_service.api.template[0].containers[0].env : e if e.name == "MALAFAT_DELEGATION"]) == 0
    error_message = "Sign in with Malafat does not turn on delegation."
  }
}

run "malafat_delegation_on" {
  command = apply

  variables {
    malafat_delegation = true
  }

  assert {
    condition     = [for e in google_cloud_run_v2_service.api.template[0].containers[0].env : e.value if e.name == "MALAFAT_DELEGATION"] == ["true"]
    error_message = "With malafat_delegation on the service gets MALAFAT_DELEGATION=true, exactly once."
  }
  assert {
    condition     = length([for e in google_cloud_run_v2_service.api.template[0].containers[0].env : e if e.name == "MALAFAT_SIGN_IN"]) == 0
    error_message = "Delegation does not turn on Sign in with Malafat."
  }
}

