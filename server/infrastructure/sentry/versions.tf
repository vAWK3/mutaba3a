terraform {
  # 1.7 is the first release whose `terraform test` supports mock_provider (tests/).
  required_version = ">= 1.7.0"

  required_providers {
    sentry = {
      source  = "jianyuan/sentry"
      version = "~> 0.15.8"
    }
  }

  # Remote state in the same bucket as the GCP module, under its own prefix
  # (mutaba3a-sentry/production). Configure with -backend-config; see
  # backend.hcl.example and server/DEPLOYMENT.md §1.5. The state holds the DSNs.
  backend "gcs" {}
}

# The provider reads SENTRY_AUTH_TOKEN, which the runbook sets for each command from the
# operator's SENTRY_ADMIN_TOKEN (never exported, never a tfvar). See server/DEPLOYMENT.md §1.5.
provider "sentry" {
  base_url = var.base_url
}
