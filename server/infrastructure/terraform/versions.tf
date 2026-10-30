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
