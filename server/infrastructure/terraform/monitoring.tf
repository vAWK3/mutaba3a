# Monitoring (MUT-328): uptime checks on /health, /ready and the portal, an
# opt-in drill check, email + SMS channels, and alerts for the checks and Cloud SQL.
# Brief: .claude/designs/mut-328-uptime-alerts.md. Operator steps: server/DEPLOYMENT.md §6b.

locals {
  # A bare hostname. Empty uptime_host = where users reach the portal (MUT-326, domain.tf): the
  # config/hosts.json portal host, which is the Cloud Run host until the custom domain's stage is
  # "live", then app.<domain>. An environment the config doesn't name falls back to the service's URL.
  uptime_host = var.uptime_host != "" ? var.uptime_host : local.public_portal_host

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
  # MUT-381: the instance the API serves from (main.tf), which cmek_stage = active moves to mutaba3a-pg2.
  cloud_sql_database_id = "${var.project_id}:${local.active_instance_id}"
  cloud_sql_alerts = {
    disk = {
      display_name = "${local.active_instance_id} disk above 80%"
      metric       = "cloudsql.googleapis.com/database/disk/utilization"
      threshold    = 0.8
      doc          = "Cloud SQL `${local.active_instance_id}` has used more than 80% of its disk for 15 minutes. `disk_autoresize` grows it (and the bill) on its own; check what is growing before it does."
    }
    cpu = {
      display_name = "${local.active_instance_id} CPU above 90%"
      metric       = "cloudsql.googleapis.com/database/cpu/utilization"
      threshold    = 0.9
      doc          = "Cloud SQL `${local.active_instance_id}` has run above 90% CPU for 15 minutes. Look for a slow query in Query Insights before raising `db_tier`."
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

# MUT-381 (ADR-164): disabling or scheduling the destruction of a version of our key, or taking a service
# agent's grant off the key or its ring, takes the database, its backups and every receipt down (Cloud SQL
# never re-encrypts onto a newer version). Admin Activity logs record every such change (always on, free), so
# a log-match alert pages on it within minutes. The filter is unproven against a live audit entry until one
# happens: test it once in a scratch project (pilot runbook §5.4).
resource "google_monitoring_alert_policy" "kms_key_change" {
  count        = local.cmek_enabled && local.alerting_enabled ? 1 : 0
  project      = var.project_id
  display_name = "mutaba3a-data key version changed"
  combiner     = "OR"
  severity     = "CRITICAL"

  conditions {
    display_name = "mutaba3a-data or its key ring changed"
    condition_matched_log {
      filter = join(" AND ", [
        "protoPayload.serviceName=\"cloudkms.googleapis.com\"",
        "protoPayload.methodName=(\"DestroyCryptoKeyVersion\" OR \"UpdateCryptoKeyVersion\" OR \"UpdateCryptoKeyPrimaryVersion\" OR \"SetIamPolicy\")",
        # The key and its versions, or the ring itself (a grant on the ring reaches the key too).
        "protoPayload.resourceName=~\"/keyRings/mutaba3a${local.suffix}(/cryptoKeys/mutaba3a-data(/|$)|$)\"",
      ])
    }
  }

  alert_strategy {
    notification_rate_limit {
      period = "300s"
    }
    auto_close = "1800s"
  }

  documentation {
    mime_type = "text/markdown"
    content   = "Someone disabled, scheduled for destruction or re-pointed a version of the KMS key `mutaba3a-data`, or changed who may use the key or its ring. If a version that protects data is disabled or destroyed, or the Cloud SQL or Cloud Storage service agent loses its grant, the database and the receipts go down. Re-enable the version, cancel the destroy (possible for 30 days) or restore the grant (terraform apply): pilot runbook §5.4, ADR-164."
  }

  notification_channels = local.alert_channels
}

# MUT-360: the Stripe sync and the nightly reconcile log what needs the operator (server/src/billing/stripe/sync.ts,
# pino's `msg`), and Cloud Scheduler logs every attempt that got a non-2xx answer or no answer (502
# RECONCILE_FAILED when Stripe couldn't be listed, 409 RECONCILE_RUNNING, a 401 from a rotated token, a timeout)
# at ERROR. Created with the job (stripe_enabled), on the MUT-328 channels. One email per policy per hour at most:
# a bad night of per-subscription errors is one notice, not hundreds. Like kms_key_change, the filters are
# unproven against live entries until each first fires: note it in DEPLOYMENT.md §7 when it does.
locals {
  stripe_api_logs = "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"${local.service_name}\""
  stripe_alerts = {
    sync = {
      display_name = "Stripe sync needs the operator"
      severity     = "WARNING"
      filter       = "${local.stripe_api_logs} AND jsonPayload.msg=(\"stripe sync needs the operator\" OR \"stripe event failed; Stripe will redeliver\" OR \"stripe refused a re-fetch\")"
      doc          = "A Stripe webhook event couldn't be mirrored. `stripe sync needs the operator` names the codes (pilot runbook §1.7 step 5); `stripe refused a re-fetch` is a lasting Stripe error (the key can't read the object?): the event got a 200 and won't come back, the nightly reconcile retries it. `stripe event failed; Stripe will redeliver` is transient: act only if the same event id keeps failing. Logs: Cloud Run → mutaba3a-api → Logs, search `stripe`."
    }
    reconcile = {
      display_name = "Stripe reconcile needs the operator"
      severity     = "WARNING"
      filter       = "${local.stripe_api_logs} AND jsonPayload.msg=(\"stripe reconcile needs the operator\" OR \"stripe reconcile could not list\")"
      doc          = "The nightly Stripe reconcile left subscriptions it couldn't mirror (`needs the operator`, one line per subscription with its code), or couldn't list Stripe at all (`could not list`: a bad or under-scoped key). Run `npm run billing:reconcile -- --url \"$URL\"` and read its errors: pilot runbook §1.7 step 5, DEPLOYMENT.md §6e."
    }
    scheduler = {
      display_name = "Stripe reconcile job failed"
      severity     = "ERROR"
      filter       = "resource.type=\"cloud_scheduler_job\" AND resource.labels.job_id=\"${local.stripe_reconcile_job}\" AND severity>=ERROR"
      doc          = "Cloud Scheduler's `${local.stripe_reconcile_job}` got no 2xx: 502 RECONCILE_FAILED (Stripe couldn't be listed), 409 RECONCILE_RUNNING (a run was already going), 401 (job token rotated, the revision not rolled), 503 (Stripe not configured) or a timeout. Missed webhooks stop healing until it runs. Read the attempt in Scheduler's logs, fix, then `gcloud scheduler jobs run ${local.stripe_reconcile_job} --location=${var.region}`: DEPLOYMENT.md §6e."
    }
  }
}

resource "google_monitoring_alert_policy" "stripe" {
  for_each     = var.stripe_enabled && local.alerting_enabled ? local.stripe_alerts : {}
  project      = var.project_id
  display_name = each.value.display_name
  combiner     = "OR"
  severity     = each.value.severity

  conditions {
    display_name = each.value.display_name
    condition_matched_log {
      filter = each.value.filter
    }
  }

  alert_strategy {
    notification_rate_limit {
      period = "3600s"
    }
    auto_close = "1800s"
  }

  documentation {
    mime_type = "text/markdown"
    content   = each.value.doc
  }

  notification_channels = local.alert_channels
}
