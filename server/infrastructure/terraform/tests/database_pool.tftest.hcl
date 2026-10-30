# MUT-270 (D6): the API's database connection budget, checked offline.
# The Google and random providers are mocked, so this needs no credentials, project or network:
#   terraform init -backend=false && terraform test

mock_provider "google" {
  # A mocked string is random; IAM bindings validate the service account's name and email format.
  mock_resource "google_service_account" {
    defaults = {
      name  = "projects/test-project/serviceAccounts/mutaba3a-api@test-project.iam.gserviceaccount.com"
      email = "mutaba3a-api@test-project.iam.gserviceaccount.com"
    }
  }
}
mock_provider "random" {}

variables {
  project_id = "test-project"
  image_tag  = "test"
}

run "pool_size_reaches_the_database_url_and_max_connections_is_explicit" {
  command = apply

  assert {
    condition     = endswith(google_secret_manager_secret_version.database_url.secret_data, "&connection_limit=10")
    error_message = "DATABASE_URL must carry connection_limit=db_pool_size: Prisma's default pool follows the CPU count it sees."
  }

  assert {
    condition     = one([for flag in google_sql_database_instance.postgres.settings[0].database_flags : flag.value if flag.name == "max_connections"]) == "50"
    error_message = "Cloud SQL max_connections must be set explicitly from db_max_connections."
  }

  # MUT-382 (B4): the privacy policy says backups stay in Tel Aviv; Cloud SQL picks a multi-region without this.
  # Moved here from tests/cmek.tftest.hcl when MUT-487 removed CMEK.
  assert {
    condition     = google_sql_database_instance.postgres.settings[0].backup_configuration[0].location == var.region && var.region == "me-west1"
    error_message = "The instance keeps its backups in the service's region (me-west1), as the privacy policy promises."
  }
}

run "the_largest_pool_that_fits_is_accepted" {
  command = plan

  variables {
    db_pool_size = 20 # 2 revisions x 20 x 1 instance + 10 reserved = 50
  }

  assert {
    condition     = endswith(google_secret_manager_secret_version.database_url.secret_data, "&connection_limit=20")
    error_message = "A pool that exactly fills db_max_connections must be accepted."
  }
}

run "a_pool_that_does_not_fit_under_max_connections_is_refused" {
  command = plan

  variables {
    db_pool_size = 21 # 2 x 21 + 10 = 52 > 50
  }

  expect_failures = [google_secret_manager_secret_version.database_url]
}
