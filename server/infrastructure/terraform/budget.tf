# MUT-511 (ADR-233): a monthly budget on MTB3A's own project, with alerts at 50%, 90% and 100% of it.
#
# Only once billing_account_id is set (the new project's tfvars): the old, shared project's bill is Malafat's too.
# Budgets live on the billing account, so the operator applying this needs roles/billing.costsManager (or billing
# admin) there: barmajiyatltd@gmail.com, which owns Barmajiyat Ltd's account 01E433-999491-75ECBD (MUT-523).
# The Billing Budget API takes its quota from a project. MUT-523: the `google.billing` provider (versions.tf) names
# this project itself (user_project_override, billing_project), so nobody runs a machine-wide
# `gcloud auth application-default set-quota-project` any more. The amount and its currency both come from tfvars
# (25 GBP for mtb3a-production); Google refuses any currency but the billing account's own.
# Budget emails go to the billing account's admins; the MUT-328 channels get them too when alerting is set.

data "google_project" "budget" {
  count      = var.billing_account_id == null ? 0 : 1
  project_id = var.project_id
}

resource "google_billing_budget" "project" {
  count    = var.billing_account_id == null ? 0 : 1
  provider = google.billing

  billing_account = var.billing_account_id
  display_name    = "MTB3A ${var.project_id} monthly"

  budget_filter {
    projects        = ["projects/${data.google_project.budget[0].number}"]
    calendar_period = "MONTH"
  }

  amount {
    specified_amount {
      currency_code = var.budget_currency
      units         = tostring(var.budget_amount)
    }
  }

  dynamic "threshold_rules" {
    for_each = [0.5, 0.9, 1.0]
    content {
      threshold_percent = threshold_rules.value
      spend_basis       = "CURRENT_SPEND"
    }
  }

  all_updates_rule {
    monitoring_notification_channels = local.alert_channels
    disable_default_iam_recipients   = false
  }

  lifecycle {
    precondition {
      condition     = var.budget_amount != null && var.budget_currency != null
      error_message = "A budget needs budget_amount and budget_currency (the billing account's own currency) in the tfvars: MUT-523 sets 25 and \"GBP\" for mtb3a-production."
    }
  }

  depends_on = [google_project_service.apis]
}
