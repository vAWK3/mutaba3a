terraform {
  required_version = ">= 1.5.0"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  # Remote state. Configure with -backend-config (see backend.hcl.example and
  # scripts/deploy.sh). State holds the generated database password and the
  # operator admin token, so the bucket must be private to operators.
  backend "gcs" {}
}

provider "google" {
  project = var.project_id
  region  = var.region
}

# MUT-523: the Billing Budget API (budget.tf) needs a quota project. This provider names this stack's own project for
# it, so the operator's Application Default Credentials need no machine-wide quota project
# (`gcloud auth application-default set-quota-project` would change it for every session on the machine).
provider "google" {
  alias                 = "billing"
  project               = var.project_id
  region                = var.region
  user_project_override = true
  billing_project       = var.project_id
}
