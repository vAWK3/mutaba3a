terraform {
  required_version = ">= 1.5.0"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
    # MUT-381: only for google_project_service_identity, the documented way to create the Cloud SQL
    # service agent that encrypts with our key (kms.tf).
    google-beta = {
      source  = "hashicorp/google-beta"
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

provider "google-beta" {
  project = var.project_id
  region  = var.region
}
