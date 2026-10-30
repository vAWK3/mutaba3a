# MUT-436: agent inbox writes ship dark. MCP_INBOX_WRITES reaches Cloud Run only once mcp_inbox_writes_enabled,
# so merging turns nothing on in production. Providers are mocked:
#   terraform init -backend=false && terraform test

mock_provider "google" {
  mock_resource "google_service_account" {
    defaults = {
      name  = "projects/test-project/serviceAccounts/mutaba3a-api@test-project.iam.gserviceaccount.com"
      email = "mutaba3a-api@test-project.iam.gserviceaccount.com"
    }
  }
  mock_resource "google_cloud_run_v2_service" {
    defaults = {
      uri = "https://mutaba3a-api-test.a.run.example"
    }
  }
}
mock_provider "random" {}

variables {
  project_id = "test-project"
  image_tag  = "test"
  hosts_file = "../../../config/fixtures/hosts.no-domain.json"
}

run "off_by_default_no_env" {
  command = apply

  assert {
    condition     = var.mcp_inbox_writes_enabled == false
    error_message = "mcp_inbox_writes_enabled must default to false: the shipped phone fails on an 'mcp' inbox entry."
  }
  assert {
    condition     = length([for e in google_cloud_run_v2_service.api.template[0].containers[0].env : e if e.name == "MCP_INBOX_WRITES"]) == 0
    error_message = "With mcp_inbox_writes_enabled off the service gets no MCP_INBOX_WRITES."
  }
}

run "on_sets_mcp_inbox_writes_true" {
  command = apply

  variables {
    mcp_inbox_writes_enabled = true
  }

  assert {
    condition     = [for e in google_cloud_run_v2_service.api.template[0].containers[0].env : e.value if e.name == "MCP_INBOX_WRITES"] == ["true"]
    error_message = "With mcp_inbox_writes_enabled on the service gets MCP_INBOX_WRITES=true."
  }
}
