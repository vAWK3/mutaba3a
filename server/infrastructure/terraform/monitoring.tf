# Monitoring (MUT-328): uptime checks on /health, /ready and the portal, an
# opt-in drill check, email + SMS channels, and alerts for the checks and Cloud SQL.
# Brief: .claude/designs/mut-328-uptime-alerts.md. Operator steps: server/DEPLOYMENT.md §6b.

locals {
  # A bare hostname. Empty uptime_host = the Cloud Run host, today's address.
  # MUT-326/MUT-112: put the custom-domain input in front of this fallback so the checks follow it.
  uptime_host = var.uptime_host != "" ? var.uptime_host : trimprefix(google_cloud_run_v2_service.api.uri, "https://")

  uptime_period_seconds = 300

  # One failed round holds the failing-region count for at most one period, until the
  # next round replaces it, so period + 60 s pages only on two failed rounds in a row.
  uptime_alert_after = "${local.uptime_period_seconds + 60}s"

  # The portal is served by this same Cloud Run service (MUT-45). Its shell carries
  # #root, so a JSON 404, a proxy error or a parked-domain page fails the check.
  uptime_targets = merge(
    {
      health = { display_name = "${local.service_name} /health", path = "/health", content = null }
      ready  = { display_name = "${local.service_name} /ready", path = "/ready", content = null }
      portal = { display_name = "${local.service_name} portal /", path = "/", content = "id=\"root\"" }
    },
    var.uptime_drill_path == "" ? {} : {
      drill = { display_name = "${local.service_name} drill ${var.uptime_drill_path}", path = var.uptime_drill_path, content = null }
    },
  )
  uptime_checks = var.enable_uptime_check ? local.uptime_targets : {}

  # Whether a channel is set is not a secret; the number itself stays sensitive.
  sms_enabled = nonsensitive(var.alert_sms_number != "")
  alert_channels = concat(
    google_monitoring_notification_channel.email[*].name,
    google_monitoring_notification_channel.sms[*].name,
    var.alert_notification_channels,
  )
  alerting_enabled = var.alert_email != "" || local.sms_enabled || length(var.alert_notification_channels) > 0

  # By name, not by reference: a targeted monitoring apply (DEPLOYMENT.md §6b) then never plans the instance itself.
  cloud_sql_database_id = "${var.project_id}:${local.instance_id}"
  cloud_sql_alerts = {
    disk = {
      display_name = "${local.instance_id} disk above 80%"
      metric       = "cloudsql.googleapis.com/database/disk/utilization"
      threshold    = 0.8
      doc          = "Cloud SQL `${local.instance_id}` has used more than 80% of its disk for 15 minutes. `disk_autoresize` grows it (and the bill) on its own; check what is growing before it does."
    }
    cpu = {
      display_name = "${local.instance_id} CPU above 90%"
      metric       = "cloudsql.googleapis.com/database/cpu/utilization"
      threshold    = 0.9
      doc          = "Cloud SQL `${local.instance_id}` has run above 90% CPU for 15 minutes. Look for a slow query in Query Insights before raising `db_tier`."
    }
  }
}

# ============================================================================
# Uptime checks
# ============================================================================

resource "google_monitoring_uptime_check_config" "endpoint" {
  for_each     = local.uptime_checks
  project      = var.project_id
  display_name = each.value.display_name
  timeout      = "10s"
  period       = "${local.uptime_period_seconds}s"

  # selected_regions unset = all six regions (at least 3, as the ticket asks).

  http_check {
    path         = each.value.path
    port         = 443
    use_ssl      = true
    validate_ssl = true
  }

  dynamic "content_matchers" {
    for_each = each.value.content == null ? [] : [each.value.content]
    content {
      content = content_matchers.value
      matcher = "CONTAINS_STRING"
    }
  }

  monitored_resource {
    type = "uptime_url"
    labels = {
      project_id = var.project_id
      host       = local.uptime_host
    }
  }

  depends_on = [google_project_service.apis]
}

# The single /health check and its optional policy existed before MUT-328.
moved {
  from = google_monitoring_uptime_check_config.health[0]
  to   = google_monitoring_uptime_check_config.endpoint["health"]
}

moved {
  from = google_monitoring_alert_policy.health[0]
  to   = google_monitoring_alert_policy.endpoint_down["health"]
}

# ============================================================================
# Notification channels (Basel, 2026-10-19: email + SMS). Set in the operator's tfvars.
# ============================================================================

resource "google_monitoring_notification_channel" "email" {
  count        = var.alert_email != "" ? 1 : 0
  project      = var.project_id
  display_name = "${local.service_name} alerts (email)"
  type         = "email"
  labels = {
    email_address = var.alert_email
  }

  depends_on = [google_project_service.apis]
}

# Cloud Monitoring leaves an SMS channel unverified until the code it texts is
# confirmed (DEPLOYMENT.md §6b); until then only email arrives.
resource "google_monitoring_notification_channel" "sms" {
  count        = local.sms_enabled ? 1 : 0
  project      = var.project_id
  display_name = "${local.service_name} alerts (SMS)"
  type         = "sms"
  labels = {
    number = var.alert_sms_number
  }

  depends_on = [google_project_service.apis]
}

# ============================================================================
# Alert policies
# ============================================================================

resource "google_monitoring_alert_policy" "endpoint_down" {
  for_each     = local.alerting_enabled ? local.uptime_checks : {}
  project      = var.project_id
  display_name = "${each.value.display_name} is down"
  combiner     = "OR"
  severity     = "CRITICAL"

  conditions {
    display_name = "${each.value.path} failing from 2+ regions, two rounds in a row"
    condition_threshold {
      filter          = "metric.type=\"monitoring.googleapis.com/uptime_check/check_passed\" AND resource.type=\"uptime_url\" AND metric.label.check_id=\"${google_monitoring_uptime_check_config.endpoint[each.key].uptime_check_id}\""
      comparison      = "COMPARISON_GT"
      threshold_value = 1
      duration        = local.uptime_alert_after

      aggregations {
        alignment_period     = "${local.uptime_period_seconds}s"
        per_series_aligner   = "ALIGN_NEXT_OLDER"
        cross_series_reducer = "REDUCE_COUNT_FALSE"
        group_by_fields      = ["resource.label.*"]
      }

      trigger {
        count = 1
      }
    }
  }

  alert_strategy {
    auto_close = "1800s"
  }

  documentation {
    mime_type = "text/markdown"
    content   = "`https://${local.uptime_host}${each.value.path}` failed from at least two regions twice in a row. A recovery notice follows when it passes again. What to check first: server/DEPLOYMENT.md §6b."
  }

  notification_channels = local.alert_channels
}

resource "google_monitoring_alert_policy" "cloud_sql" {
  for_each     = local.alerting_enabled ? local.cloud_sql_alerts : {}
  project      = var.project_id
  display_name = each.value.display_name
  combiner     = "OR"
  severity     = "WARNING"

  conditions {
    display_name = each.value.display_name
    condition_threshold {
      filter          = "metric.type=\"${each.value.metric}\" AND resource.type=\"cloudsql_database\" AND resource.label.database_id=\"${local.cloud_sql_database_id}\""
      comparison      = "COMPARISON_GT"
      threshold_value = each.value.threshold
      duration        = "900s"

      aggregations {
        alignment_period   = "300s"
        per_series_aligner = "ALIGN_MEAN"
      }

      trigger {
        count = 1
      }
    }
  }

  alert_strategy {
    auto_close = "86400s"
  }

  documentation {
    mime_type = "text/markdown"
    content   = each.value.doc
  }

  notification_channels = local.alert_channels
}
