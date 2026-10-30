# MUT-511 (ADR-231): a monthly budget on MTB3A's own project, with alerts at 50%, 90% and 100% of it.
#
# Only once billing_account_id is set (the new project's tfvars): the old, shared project's bill is Malafat's too.
# Budgets live on the billing account, so the operator applying this needs roles/billing.costsManager (or billing
# admin) there, and the Billing Budget API takes its quota from a project: with user credentials run
# `gcloud auth application-default set-quota-project <project_id>` once (DEPLOYMENT.md §6d, C1). The amount is in
# the billing account's own currency (budget_currency); Google refuses any other.
# Budget emails go to the billing account's admins; the MUT-328 channels get them too when alerting is set.

data "google_project" "budget" {
  count      = var.billing_account_id == null ? 0 : 1
  project_id = var.project_id
}

resource "google_billing_budget" "project" {
  count = var.billing_account_id == null ? 0 : 1

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

  depends_on = [google_project_service.apis]
}
