# MUT-328: uptime checks, notification channels and alert policies, checked offline.
# The Google and random providers are mocked, so this needs no credentials, project or network:
#   terraform init -backend=false && terraform test

mock_provider "google" {
  # A mocked string is random; IAM bindings validate the service account's name and email format.
  mock_resource "google_service_account" {
    defaults = {
      name  = "projects/test-project/serviceAccounts/mutaba3a-api@test-project.iam.gserviceaccount.com"
      email = "mutaba3a-api@test-project.iam.gserviceaccount.com"
    }
  }
  mock_resource "google_cloud_run_v2_service" {
    defaults = {
      uri = "https://service-abc123-zf.a.run.example"
    }
  }
}
mock_provider "random" {}

variables {
  project_id = "test-project"
  region     = "europe-west1"
  image_tag  = "test"
  # MUT-326: the default host is the config's portal host; this fixture's is portal.example.test.
  hosts_file = "../../../config/fixtures/hosts.no-domain.json"
}

run "defaults_check_health_ready_and_the_portal_on_the_cloud_run_host_without_alerting" {
  command = apply

  assert {
    condition     = toset(keys(google_monitoring_uptime_check_config.endpoint)) == toset(["health", "ready", "portal"])
    error_message = "The default checks are /health, /ready and the portal page (no drill)."
  }

  assert {
    condition     = { for k, c in google_monitoring_uptime_check_config.endpoint : k => c.http_check[0].path } == { health = "/health", ready = "/ready", portal = "/" }
    error_message = "Each check probes its own path."
  }

  assert {
    condition     = alltrue([for c in google_monitoring_uptime_check_config.endpoint : c.monitored_resource[0].labels.host == "portal.example.test"])
    error_message = "With no uptime_host, every check probes the portal host config/hosts.json names (today the Cloud Run host)."
  }

  assert {
    condition     = alltrue([for c in google_monitoring_uptime_check_config.endpoint : c.period == "300s" && c.http_check[0].use_ssl && c.http_check[0].validate_ssl && c.http_check[0].port == 443])
    error_message = "Every check runs every 5 minutes over validated HTTPS."
  }

  assert {
    condition     = alltrue([for c in google_monitoring_uptime_check_config.endpoint : try(length(c.selected_regions), 0) == 0])
    error_message = "selected_regions stays unset (all six regions): at least 3, and the existing /health check is not modified."
  }

  assert {
    condition     = google_monitoring_uptime_check_config.endpoint["health"].display_name == "mutaba3a-api /health"
    error_message = "The /health check keeps its display name, so the moved check is not modified."
  }

  assert {
    condition     = length(google_monitoring_notification_channel.email) == 0 && length(google_monitoring_notification_channel.sms) == 0
    error_message = "No channel is created without alert_email / alert_sms_number."
  }

  assert {
    condition     = length(google_monitoring_alert_policy.endpoint_down) == 0 && length(google_monitoring_alert_policy.cloud_sql) == 0
    error_message = "No alert policy without a notification channel."
  }

  assert {
    condition     = output.uptime_host == "portal.example.test"
    error_message = "output.uptime_host reports the probed host."
  }
}

run "the_portal_check_matches_the_spa_shell_and_health_has_no_matcher" {
  command = plan

  assert {
    condition     = length(google_monitoring_uptime_check_config.endpoint["portal"].content_matchers) == 1 && one(google_monitoring_uptime_check_config.endpoint["portal"].content_matchers).content == "id=\"root\"" && one(google_monitoring_uptime_check_config.endpoint["portal"].content_matchers).matcher == "CONTAINS_STRING"
    error_message = "The portal check must prove the SPA shell is served (id=\"root\"), not a 404 or a parked-domain page."
  }

  assert {
    condition     = length(google_monitoring_uptime_check_config.endpoint["health"].content_matchers) == 0
    error_message = "/health stays exactly as before (no matcher)."
  }
}

run "the_host_follows_uptime_host" {
  command = apply

  variables {
    uptime_host = "app.example.com"
  }

  assert {
    condition     = alltrue([for c in google_monitoring_uptime_check_config.endpoint : c.monitored_resource[0].labels.host == "app.example.com"])
    error_message = "Every check must probe uptime_host when it is set (the custom domain, MUT-112)."
  }

  assert {
    condition     = output.uptime_host == "app.example.com"
    error_message = "output.uptime_host reports uptime_host."
  }
}

run "a_host_with_a_scheme_is_refused" {
  command = plan

  variables {
    uptime_host = "https://app.example.com"
  }

  expect_failures = [var.uptime_host]
}

run "a_host_with_a_path_is_refused" {
  command = plan

  variables {
    uptime_host = "app.example.com/portal"
  }

  expect_failures = [var.uptime_host]
}

run "a_host_with_a_port_is_refused" {
  command = plan

  variables {
    uptime_host = "app.example.com:8443"
  }

  expect_failures = [var.uptime_host]
}

run "email_and_sms_create_two_channels_and_five_policies" {
  command = apply

  variables {
    alert_email                 = "ops@example.com"
    alert_sms_number            = "+972500000000"
    alert_notification_channels = ["projects/test-project/notificationChannels/111"]
  }

  assert {
    condition     = google_monitoring_notification_channel.email[0].type == "email" && google_monitoring_notification_channel.email[0].labels.email_address == "ops@example.com"
    error_message = "alert_email creates an email channel."
  }

  assert {
    condition     = google_monitoring_notification_channel.sms[0].type == "sms"
    error_message = "alert_sms_number creates an SMS channel."
  }

  assert {
    condition     = toset(keys(google_monitoring_alert_policy.endpoint_down)) == toset(["health", "ready", "portal"]) && toset(keys(google_monitoring_alert_policy.cloud_sql)) == toset(["disk", "cpu", "memory"])
    error_message = "One policy per uptime check, plus the three Cloud SQL policies (MUT-511 added memory)."
  }

  assert {
    condition = alltrue([
      for p in concat(values(google_monitoring_alert_policy.endpoint_down), values(google_monitoring_alert_policy.cloud_sql)) :
      toset(p.notification_channels) == toset([
        google_monitoring_notification_channel.email[0].name,
        google_monitoring_notification_channel.sms[0].name,
        "projects/test-project/notificationChannels/111",
      ])
    ])
    error_message = "Every policy notifies the email and SMS channels plus any existing channel ids."
  }
}

run "an_uptime_policy_pages_on_two_failed_rounds_from_two_regions" {
  command = apply

  variables {
    alert_email = "ops@example.com"
  }

  assert {
    condition = alltrue([
      for p in google_monitoring_alert_policy.endpoint_down :
      p.conditions[0].condition_threshold[0].comparison == "COMPARISON_GT" &&
      p.conditions[0].condition_threshold[0].threshold_value == 1 &&
      p.conditions[0].condition_threshold[0].duration == "360s"
    ])
    error_message = "More than one failing region, held past one 300 s round (360 s), so one failed round never pages and two in a row do."
  }

  assert {
    condition = alltrue([
      for p in google_monitoring_alert_policy.endpoint_down :
      p.conditions[0].condition_threshold[0].aggregations[0].alignment_period == "300s" &&
      p.conditions[0].condition_threshold[0].aggregations[0].per_series_aligner == "ALIGN_NEXT_OLDER" &&
      p.conditions[0].condition_threshold[0].aggregations[0].cross_series_reducer == "REDUCE_COUNT_FALSE"
    ])
    error_message = "Align on the check period and count failing regions."
  }

  assert {
    condition     = strcontains(google_monitoring_alert_policy.endpoint_down["ready"].conditions[0].condition_threshold[0].filter, "metric.label.check_id=\"${google_monitoring_uptime_check_config.endpoint["ready"].uptime_check_id}\"")
    error_message = "Each policy watches its own check."
  }

  assert {
    condition     = alltrue([for p in google_monitoring_alert_policy.endpoint_down : p.alert_strategy[0].auto_close == "1800s" && p.severity == "CRITICAL"])
    error_message = "Uptime incidents are CRITICAL and close on their own within 30 minutes once the check stops reporting (the drill's removal)."
  }
}

run "cloud_sql_alerts_on_disk_above_80_cpu_above_80_and_memory_above_90_for_15_minutes" {
  command = apply

  variables {
    alert_email = "ops@example.com"
  }

  assert {
    condition     = google_monitoring_alert_policy.cloud_sql["disk"].conditions[0].condition_threshold[0].threshold_value == 0.8 && strcontains(google_monitoring_alert_policy.cloud_sql["disk"].conditions[0].condition_threshold[0].filter, "cloudsql.googleapis.com/database/disk/utilization")
    error_message = "Disk alert: utilization above 80%."
  }

  assert {
    condition     = google_monitoring_alert_policy.cloud_sql["cpu"].conditions[0].condition_threshold[0].threshold_value == 0.8 && strcontains(google_monitoring_alert_policy.cloud_sql["cpu"].conditions[0].condition_threshold[0].filter, "cloudsql.googleapis.com/database/cpu/utilization")
    error_message = "CPU alert: utilization above 80% (MUT-511, MUT-512's trigger)."
  }

  assert {
    condition     = google_monitoring_alert_policy.cloud_sql["memory"].conditions[0].condition_threshold[0].threshold_value == 0.9 && strcontains(google_monitoring_alert_policy.cloud_sql["memory"].conditions[0].condition_threshold[0].filter, "cloudsql.googleapis.com/database/memory/utilization")
    error_message = "Memory alert: utilization above 90% (MUT-511, MUT-512's trigger)."
  }

  assert {
    condition     = alltrue([for p in google_monitoring_alert_policy.cloud_sql : p.conditions[0].condition_threshold[0].duration == "900s" && strcontains(p.conditions[0].condition_threshold[0].filter, "resource.label.database_id=\"test-project:mutaba3a-pg\"") && p.severity == "WARNING"])
    error_message = "Every Cloud SQL alert holds for 15 minutes on this instance, at WARNING."
  }
}

run "an_sms_number_not_in_e164_is_refused" {
  command = plan

  variables {
    alert_sms_number = "0500000000"
  }

  expect_failures = [var.alert_sms_number]
}

run "existing_channel_ids_alone_still_alert" {
  command = apply

  variables {
    alert_notification_channels = ["projects/test-project/notificationChannels/111"]
  }

  assert {
    condition     = length(google_monitoring_alert_policy.endpoint_down) == 3 && alltrue([for p in google_monitoring_alert_policy.endpoint_down : toset(p.notification_channels) == toset(["projects/test-project/notificationChannels/111"])])
    error_message = "alert_notification_channels alone keeps alerting, as before MUT-328."
  }
}

run "the_drill_adds_a_failing_check_and_its_policy" {
  command = apply

  variables {
    alert_email       = "ops@example.com"
    uptime_drill_path = "/v1/uptime-drill"
  }

  assert {
    condition     = google_monitoring_uptime_check_config.endpoint["drill"].http_check[0].path == "/v1/uptime-drill" && contains(keys(google_monitoring_alert_policy.endpoint_down), "drill")
    error_message = "uptime_drill_path adds a drill check and a policy on the same channels."
  }
}

run "a_drill_path_without_a_leading_slash_is_refused" {
  command = plan

  variables {
    uptime_drill_path = "v1/uptime-drill"
  }

  expect_failures = [var.uptime_drill_path]
}

run "disabling_uptime_checks_keeps_the_cloud_sql_alerts" {
  command = apply

  variables {
    enable_uptime_check = false
    alert_email         = "ops@example.com"
  }

  assert {
    condition     = length(google_monitoring_uptime_check_config.endpoint) == 0 && length(google_monitoring_alert_policy.endpoint_down) == 0
    error_message = "enable_uptime_check = false removes every check and its policy."
  }

  assert {
    condition     = length(google_monitoring_alert_policy.cloud_sql) == 3
    error_message = "The Cloud SQL alerts don't depend on the uptime checks."
  }
}

# MUT-326: once config/hosts.json's domain is live, the checks follow it with no tfvars change.
run "the_host_follows_the_custom_domain_once_live" {
  command = plan

  variables {
    hosts_file = "../../../config/fixtures/hosts.placeholder.json"
  }

  assert {
    condition     = alltrue([for c in google_monitoring_uptime_check_config.endpoint : c.monitored_resource[0].labels.host == "app.placeholder.example"])
    error_message = "From stage live, every check probes the custom domain's portal host."
  }
}
