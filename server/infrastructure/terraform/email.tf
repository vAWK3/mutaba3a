# MUT-359 (ADR-159 §5): transactional mail through Resend.
#
# mailer = "noop" (default): Cloud Run gets MAILER=noop and nothing is sent; the two secrets exist empty so the
# operator can add their values before turning mail on. mailer = "resend": the secrets are mounted, the sender is
# no-reply@<domain> from config/hosts.json (domain.tf), and the cap and reply-to come from this stack's variables.
# `log` and `memory` are not offered: this stack always runs NODE_ENV=production, where the server refuses them (D14).
#
# The DNS records Resend gives (DKIM, the return path, DMARC) live in the frontdoor stack, beside the zone (D1).
# Go-live order: server/DEPLOYMENT.md §6f and docs/operations/before-release.md.
#
# MUT-366: mail on also mounts TURNSTILE_SECRET (recovery mails links), and `self_signup_enabled` opens
# POST /v1/signups; it needs mailer = "resend".

locals {
  mailer_resend                = var.mailer == "resend"
  secret_resend_api_key        = "mutaba3a-api-resend-api-key${local.suffix}"
  secret_resend_webhook_secret = "mutaba3a-api-resend-webhook-secret${local.suffix}"
  # MUT-366: Cloudflare Turnstile's secret, which signup and recovery verify with once a link can be mailed.
  secret_turnstile  = "mutaba3a-api-turnstile-secret${local.suffix}"
  mail_from_address = local.domain == null ? null : "no-reply@${local.domain}"

  # Plain env for Cloud Run. MAILER is always set, so the server's default never decides it.
  mail_env = merge(
    { MAILER = var.mailer },
    local.mailer_resend ? {
      MAIL_FROM_ADDRESS = local.mail_from_address
      MAIL_REPLY_TO     = var.mail_reply_to
      MAIL_DAILY_CAP    = tostring(var.mail_daily_cap)
    } : {},
    var.operator_alert_email == null ? {} : { OPERATOR_ALERT_EMAIL = var.operator_alert_email },
    # MUT-366: always set, so the server's default never decides whether strangers can sign up.
    { SELF_SIGNUP_ENABLED = tostring(var.self_signup_enabled) },
  )
  # MUT-366: with mail on, recovery mails links, so the server needs the Turnstile secret (it refuses to start
  # without one); signup needs mail on (main.tf precondition), so this covers it too.
  mail_secret_env = local.mailer_resend ? {
    RESEND_API_KEY        = google_secret_manager_secret.resend_api_key.secret_id
    RESEND_WEBHOOK_SECRET = google_secret_manager_secret.resend_webhook_secret.secret_id
    TURNSTILE_SECRET      = google_secret_manager_secret.turnstile.secret_id
  } : {}
}

# Created without a version whatever `mailer` says, like Stripe's: the operator adds the sending key (restricted to
# the domain) and the webhook's signing secret, then turns mail on. An empty secret mounted would stop the revision.
resource "google_secret_manager_secret" "resend_api_key" {
  project   = var.project_id
  secret_id = local.secret_resend_api_key
  labels    = local.labels

  replication {
    user_managed {
      replicas {
        location = var.region
      }
    }
  }

  depends_on = [google_project_service.apis]
}

resource "google_secret_manager_secret" "resend_webhook_secret" {
  project   = var.project_id
  secret_id = local.secret_resend_webhook_secret
  labels    = local.labels

  replication {
    user_managed {
      replicas {
        location = var.region
      }
    }
  }

  depends_on = [google_project_service.apis]
}

# MUT-366: created empty like the Resend secrets; the operator adds the widget's secret key before mail goes on.
resource "google_secret_manager_secret" "turnstile" {
  project   = var.project_id
  secret_id = local.secret_turnstile
  labels    = local.labels

  replication {
    user_managed {
      replicas {
        location = var.region
      }
    }
  }

  depends_on = [google_project_service.apis]
}

resource "google_secret_manager_secret_iam_member" "api_reads_turnstile" {
  project   = var.project_id
  secret_id = google_secret_manager_secret.turnstile.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.api.email}"
}

resource "google_secret_manager_secret_iam_member" "api_reads_resend_api_key" {
  project   = var.project_id
  secret_id = google_secret_manager_secret.resend_api_key.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.api.email}"
}

resource "google_secret_manager_secret_iam_member" "api_reads_resend_webhook_secret" {
  project   = var.project_id
  secret_id = google_secret_manager_secret.resend_webhook_secret.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.api.email}"
}

# D9: the server logs these (server/src/email/mailer.ts, pino's `msg`); a mail can't report that mail stopped.
# Created with mail on, on the MUT-328 channels, one notice per policy per hour. Like the Stripe alerts, the filters
# are unproven against live entries until each first fires: note it in DEPLOYMENT.md §7 when it does.
locals {
  email_api_logs = "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"${local.service_name}\""
  email_alerts = {
    cap = {
      display_name = "Mail cap reached"
      severity     = "ERROR"
      filter       = "${local.email_api_logs} AND jsonPayload.msg=\"mail cap reached; nothing sent\" AND jsonPayload.scope=\"global\""
      doc          = "The API refused mail at its daily cap. The log's `cap` says which limit: `daily` less `reserve` stops everything but recovery mail (signup links and password notices stop; reset and finish-setup links still go out), and `daily` itself stops recovery mail too. An attack, or real growth: read the API logs (search `mail cap`), then raise `mail_daily_cap` (below the Resend plan's limit) or wait. DEPLOYMENT.md §6f."
    }
    provider = {
      display_name = "Mail provider failing"
      severity     = "WARNING"
      filter       = "${local.email_api_logs} AND jsonPayload.msg=(\"mail provider failed\" OR \"mail provider rate-limited\")"
      doc          = "Resend refused or didn't answer a send. `rate-limited` is the shared Barmajiyat account's limit (Malafat sends from it too); `failed` carries Resend's status and error name. Check status.resend.com and the account's usage, then DEPLOYMENT.md §6f."
    }
  }
}

resource "google_monitoring_alert_policy" "email" {
  for_each     = local.mailer_resend && local.alerting_enabled ? local.email_alerts : {}
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
