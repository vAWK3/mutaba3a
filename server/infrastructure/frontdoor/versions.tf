terraform {
  # mock_provider in tests/ needs 1.7.
  required_version = ">= 1.7.0"

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.0"
    }
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
    netlify = {
      source  = "netlify/netlify"
      version = "~> 0.4"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  # Its own state (gs://<bucket>/mutaba3a-frontdoor/<environment>), apart from the API stack:
  # it is applied by the operator once per domain change, never by deploy.sh. It holds the
  # front-door token, so the bucket stays private to operators (as for the API stack).
  backend "gcs" {}
}

provider "google" {
  project = var.project_id
  region  = var.region
}

# Credentials from the operator's shell, never a file: CLOUDFLARE_API_TOKEN (Zone:Edit,
# DNS:Edit, Zone Settings:Edit, Workers Scripts:Edit, Workers Routes:Edit on the account)
# and NETLIFY_API_TOKEN. See server/DEPLOYMENT.md §5a.
provider "cloudflare" {}
provider "netlify" {}
