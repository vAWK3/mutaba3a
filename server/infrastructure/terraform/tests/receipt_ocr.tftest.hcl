# MUT-441: the server reads receipts (receipt_ocr.tf). Off by default: nothing exists and the API gets SERVER_OCR=false.
# On: the sidecar holds no role, only the API may call it, its egress is locked (R9), the queue sends at most 3 reads
# at once (F10), and the sweep posts no body with an OIDC token (R8). Providers are mocked:
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
  mock_data "google_project" {
    defaults = {
      number = "123456789012"
    }
  }
}
mock_provider "random" {}

# Each service account and the sidecar get their own values, so the assertions can tell them apart.
override_resource {
  target = google_service_account.receipt_ocr
  values = {
    name  = "projects/test-project/serviceAccounts/receipt-ocr@test-project.iam.gserviceaccount.com"
    email = "receipt-ocr@test-project.iam.gserviceaccount.com"
  }
}
override_resource {
  target = google_service_account.receipt_read_invoker
  values = {
    name  = "projects/test-project/serviceAccounts/receipt-read-invoker@test-project.iam.gserviceaccount.com"
    email = "receipt-read-invoker@test-project.iam.gserviceaccount.com"
  }
}
override_resource {
  target = google_service_account.receipt_sweep_invoker
  values = {
    name  = "projects/test-project/serviceAccounts/receipt-sweep-invoker@test-project.iam.gserviceaccount.com"
    email = "receipt-sweep-invoker@test-project.iam.gserviceaccount.com"
  }
}
override_resource {
  target = google_cloud_run_v2_service.receipt_ocr
  values = {
    uri = "https://receipt-ocr-test.a.run.example"
  }
}

variables {
  project_id = "test-project"
  image_tag  = "abc1234"
  hosts_file = "../../../config/fixtures/hosts.no-domain.json"
}

run "off_by_default_creates_nothing" {
  command = plan

  assert {
    condition     = var.server_ocr_enabled == false
    error_message = "server_ocr_enabled must default to false, so merging MUT-441 creates nothing in production."
  }

  assert {
    condition = (
      length(google_cloud_run_v2_service.receipt_ocr) == 0
      && length(google_service_account.receipt_ocr) == 0
      && length(google_service_account.receipt_read_invoker) == 0
      && length(google_service_account.receipt_sweep_invoker) == 0
      && length(google_cloud_run_v2_service_iam_member.read_jobs_invoke_api) == 0
      && length(google_cloud_tasks_queue_iam_member.api_enqueues_reads) == 0
      && length(google_service_account_iam_member.api_acts_as_read_invoker) == 0
      && length(google_cloud_run_v2_service_iam_binding.api_invokes_ocr) == 0
      && length(google_compute_network.receipt_ocr) == 0
      && length(google_compute_subnetwork.receipt_ocr) == 0
      && length(google_compute_firewall.receipt_ocr_deny_egress) == 0
      && length(google_cloud_tasks_queue.receipt_reads) == 0
      && length(google_cloud_scheduler_job.receipt_read_sweep) == 0
      && length(data.google_project.this) == 0
    )
    error_message = "With server_ocr_enabled off, none of the OCR resources exist."
  }

  assert {
    condition     = !contains(keys(google_project_service.apis), "cloudtasks.googleapis.com") && !contains(keys(google_project_service.apis), "compute.googleapis.com")
    error_message = "Off, no new API is enabled in the project."
  }

  assert {
    condition     = [for e in google_cloud_run_v2_service.api.template[0].containers[0].env : e.value if e.name == "SERVER_OCR"] == ["false"]
    error_message = "Off, the API gets SERVER_OCR=false, exactly once."
  }

  assert {
    condition = length([for e in google_cloud_run_v2_service.api.template[0].containers[0].env : e.name if contains(
      ["OCR_URL", "READ_QUEUE", "API_ORIGIN", "READ_INVOKER_SA", "SWEEP_INVOKER_SA", "READ_OIDC_AUDIENCE"], e.name
    )]) == 0
    error_message = "Off, the API gets none of the OCR wiring."
  }
}

run "on_wires_the_api" {
  command = apply

  variables {
    server_ocr_enabled = true
  }

  assert {
    condition = (
      contains(keys(google_project_service.apis), "cloudtasks.googleapis.com")
      && contains(keys(google_project_service.apis), "compute.googleapis.com")
    )
    error_message = "On, the Cloud Tasks and Compute APIs are enabled (the queue, and the sidecar's VPC)."
  }

  assert {
    condition = { for e in google_cloud_run_v2_service.api.template[0].containers[0].env : e.name => e.value if contains(
      ["SERVER_OCR", "OCR_URL", "READ_QUEUE", "API_ORIGIN", "READ_INVOKER_SA", "SWEEP_INVOKER_SA"], e.name
      ) } == {
      SERVER_OCR       = "true"
      OCR_URL          = "https://receipt-ocr-test.a.run.example"
      READ_QUEUE       = "projects/test-project/locations/me-west1/queues/receipt-reads"
      API_ORIGIN       = "https://mutaba3a-api-123456789012.me-west1.run.app"
      READ_INVOKER_SA  = "receipt-read-invoker@test-project.iam.gserviceaccount.com"
      SWEEP_INVOKER_SA = "receipt-sweep-invoker@test-project.iam.gserviceaccount.com"
    }
    error_message = "On, the API gets SERVER_OCR=true and every name config.ts needs for Cloud Tasks reads and the OIDC check."
  }

  assert {
    condition     = length([for e in google_cloud_run_v2_service.api.template[0].containers[0].env : e if e.name == "SERVER_OCR"]) == 1
    error_message = "SERVER_OCR is set exactly once."
  }
}

run "on_the_sidecar_holds_nothing_and_only_the_api_calls_it" {
  command = apply

  variables {
    server_ocr_enabled = true
  }

  assert {
    condition     = google_cloud_run_v2_service.receipt_ocr[0].template[0].service_account == "receipt-ocr@test-project.iam.gserviceaccount.com"
    error_message = "The sidecar runs as its own service account."
  }

  # Every project, secret, bucket, key and service-account grant in this stack: none names the sidecar's account.
  assert {
    condition = !contains(flatten([
      [google_project_iam_member.api_sql_client.member],
      [google_secret_manager_secret_iam_member.api_reads_database_url.member],
      [google_secret_manager_secret_iam_member.api_reads_admin_token.member],
      [google_secret_manager_secret_iam_member.api_reads_session_pepper.member],
      [google_secret_manager_secret_iam_member.api_reads_stripe_secret_key.member],
      [google_secret_manager_secret_iam_member.api_reads_stripe_webhook_secret.member],
      [google_secret_manager_secret_iam_member.api_reads_job_token.member],
      [google_secret_manager_secret_iam_member.api_reads_oauth_derive_key.member],
      google_secret_manager_secret_iam_member.api_reads_turnstile[*].member,
      google_secret_manager_secret_iam_member.api_reads_resend_api_key[*].member,
      google_secret_manager_secret_iam_member.api_reads_resend_webhook_secret[*].member,
      google_secret_manager_secret_iam_member.api_reads_front_door_token[*].member,
      google_secret_manager_secret_iam_member.api_reads_sentry_dsn[*].member,
      [google_storage_bucket_iam_member.api_objects.member],
      [google_service_account_iam_member.api_signs_as_itself.member],
      google_service_account_iam_member.api_acts_as_read_invoker[*].member,
      google_cloud_tasks_queue_iam_member.api_enqueues_reads[*].member,
      [for m in google_cloud_run_v2_service_iam_member.read_jobs_invoke_api : m.member],
      [google_cloud_run_v2_service_iam_member.public.member],
      google_cloud_run_v2_service_iam_binding.api_invokes_ocr[0].members,
    ]), "serviceAccount:receipt-ocr@test-project.iam.gserviceaccount.com")
    error_message = "The sidecar's service account holds no role anywhere."
  }

  assert {
    condition = (
      google_cloud_run_v2_service_iam_binding.api_invokes_ocr[0].role == "roles/run.invoker"
      && google_cloud_run_v2_service_iam_binding.api_invokes_ocr[0].members == toset(["serviceAccount:mutaba3a-api@test-project.iam.gserviceaccount.com"])
      && google_cloud_run_v2_service_iam_binding.api_invokes_ocr[0].name == google_cloud_run_v2_service.receipt_ocr[0].name
    )
    error_message = "run.invoker on the sidecar is authoritative and names the API's service account only (never allUsers)."
  }

  assert {
    condition = (
      google_cloud_tasks_queue_iam_member.api_enqueues_reads[0].role == "roles/cloudtasks.enqueuer"
      && google_cloud_tasks_queue_iam_member.api_enqueues_reads[0].member == "serviceAccount:mutaba3a-api@test-project.iam.gserviceaccount.com"
      && google_service_account_iam_member.api_acts_as_read_invoker[0].role == "roles/iam.serviceAccountUser"
      && google_service_account_iam_member.api_acts_as_read_invoker[0].service_account_id == google_service_account.receipt_read_invoker[0].name
      && google_service_account_iam_member.api_acts_as_read_invoker[0].member == "serviceAccount:mutaba3a-api@test-project.iam.gserviceaccount.com"
    )
    error_message = "The API may enqueue on the read queue, and act as the read invoker (to mint the tasks' OIDC tokens), nothing wider."
  }

  assert {
    condition = (
      toset([for m in google_cloud_run_v2_service_iam_member.read_jobs_invoke_api : m.member]) == toset([
        "serviceAccount:receipt-read-invoker@test-project.iam.gserviceaccount.com",
        "serviceAccount:receipt-sweep-invoker@test-project.iam.gserviceaccount.com",
      ])
      && alltrue([for m in google_cloud_run_v2_service_iam_member.read_jobs_invoke_api : m.role == "roles/run.invoker" && m.name == google_cloud_run_v2_service.api.name])
    )
    error_message = "The two job identities may invoke the API service, and only it."
  }
}

run "on_egress_is_locked" {
  command = apply

  variables {
    server_ocr_enabled = true
  }

  assert {
    condition = (
      google_cloud_run_v2_service.receipt_ocr[0].template[0].vpc_access[0].egress == "ALL_TRAFFIC"
      && google_cloud_run_v2_service.receipt_ocr[0].template[0].vpc_access[0].network_interfaces[0].subnetwork == google_compute_subnetwork.receipt_ocr[0].name
      && google_cloud_run_v2_service.receipt_ocr[0].template[0].vpc_access[0].network_interfaces[0].network == google_compute_network.receipt_ocr[0].name
      && google_cloud_run_v2_service.receipt_ocr[0].template[0].vpc_access[0].connector == null
    )
    error_message = "R9: Direct VPC egress sends ALL the sidecar's traffic into its own subnet (no connector)."
  }

  assert {
    condition = (
      google_compute_network.receipt_ocr[0].auto_create_subnetworks == false
      && google_compute_network.receipt_ocr[0].delete_default_routes_on_create == true
      && google_compute_subnetwork.receipt_ocr[0].private_ip_google_access == false
      && google_compute_subnetwork.receipt_ocr[0].network == google_compute_network.receipt_ocr[0].id
    )
    error_message = "R9: the network has no default internet route and no other subnets, and the subnet no Private Google Access. (No Cloud Router or NAT exists: receipt-ocr-egress.test.ts checks every .tf file.)"
  }

  assert {
    condition = (
      google_compute_firewall.receipt_ocr_deny_egress[0].network == google_compute_network.receipt_ocr[0].id
      && google_compute_firewall.receipt_ocr_deny_egress[0].direction == "EGRESS"
      && google_compute_firewall.receipt_ocr_deny_egress[0].priority == 0
      && google_compute_firewall.receipt_ocr_deny_egress[0].destination_ranges == toset(["0.0.0.0/0"])
      && length(google_compute_firewall.receipt_ocr_deny_egress[0].deny) == 1
      && one(google_compute_firewall.receipt_ocr_deny_egress[0].deny).protocol == "all"
      && length(google_compute_firewall.receipt_ocr_deny_egress[0].allow) == 0
      && google_compute_firewall.receipt_ocr_deny_egress[0].disabled != true
    )
    error_message = "R9: a deny-all egress rule at the top priority covers the sidecar's network."
  }
}

run "on_the_sidecar_sleeps_boosts_and_reads_one_at_a_time" {
  command = apply

  variables {
    server_ocr_enabled = true
  }

  assert {
    condition = (
      google_cloud_run_v2_service.receipt_ocr[0].template[0].scaling[0].min_instance_count == 0
      && google_cloud_run_v2_service.receipt_ocr[0].template[0].scaling[0].max_instance_count == 3
      && google_cloud_run_v2_service.receipt_ocr[0].template[0].max_instance_request_concurrency == 1
    )
    error_message = "R4/F10: min 0 (asleep when idle), max 3, one read per instance."
  }

  assert {
    condition = (
      google_cloud_run_v2_service.receipt_ocr[0].template[0].containers[0].resources[0].startup_cpu_boost == true
      && google_cloud_run_v2_service.receipt_ocr[0].template[0].containers[0].resources[0].limits == tomap({ cpu = "4", memory = "4Gi" })
    )
    error_message = "R4: 4 vCPU / 4 GiB with startup CPU boost, so a cold model load is quicker."
  }

  assert {
    condition     = tonumber(trimsuffix(google_cloud_run_v2_service.receipt_ocr[0].template[0].timeout, "s")) >= 40
    error_message = "The sidecar's request timeout stays above the API's 35 s call timeout."
  }

  assert {
    condition = (
      google_cloud_run_v2_service.receipt_ocr[0].ingress == "INGRESS_TRAFFIC_ALL"
      && google_cloud_run_v2_service.receipt_ocr[0].template[0].containers[0].image == "me-west1-docker.pkg.dev/test-project/mutaba3a/receipt-ocr:abc1234"
      && google_cloud_run_v2_service.receipt_ocr[0].template[0].containers[0].startup_probe[0].http_get[0].path == "/healthz"
    )
    error_message = "The sidecar runs the same commit's receipt-ocr image, and starts serving once /healthz says the models are loaded."
  }
}

run "on_a_rollback_can_pin_another_ocr_image" {
  command = plan

  variables {
    server_ocr_enabled = true
    ocr_image_tag      = "0ld0ld0"
  }

  assert {
    condition     = google_cloud_run_v2_service.receipt_ocr[0].template[0].containers[0].image == "me-west1-docker.pkg.dev/test-project/mutaba3a/receipt-ocr:0ld0ld0"
    error_message = "F6: ocr_image_tag pins the sidecar's image apart from the API's (a rollback to a commit without one keeps the running image)."
  }
}

run "on_the_queue_matches_the_sidecar" {
  command = apply

  variables {
    server_ocr_enabled = true
  }

  assert {
    condition = (
      google_cloud_tasks_queue.receipt_reads[0].location == "me-west1"
      && google_cloud_tasks_queue.receipt_reads[0].rate_limits[0].max_concurrent_dispatches == 3
      && google_cloud_tasks_queue.receipt_reads[0].rate_limits[0].max_dispatches_per_second == 2
      && google_cloud_tasks_queue.receipt_reads[0].retry_config[0].max_attempts == 3
    )
    error_message = "F10: at most 3 reads in flight (max instances × concurrency 1), 2 a second, 3 attempts."
  }
}

run "on_the_sweep_posts_no_body_with_oidc" {
  command = apply

  variables {
    server_ocr_enabled = true
  }

  assert {
    condition = (
      google_cloud_scheduler_job.receipt_read_sweep[0].schedule == "*/5 * * * *"
      && google_cloud_scheduler_job.receipt_read_sweep[0].http_target[0].http_method == "POST"
      && google_cloud_scheduler_job.receipt_read_sweep[0].http_target[0].uri == "https://mutaba3a-api-123456789012.me-west1.run.app/jobs/v1/receipts/read"
    )
    error_message = "The sweep POSTs to the API's read job every 5 minutes."
  }

  assert {
    condition = (
      google_cloud_scheduler_job.receipt_read_sweep[0].http_target[0].body == null
      && length(coalesce(google_cloud_scheduler_job.receipt_read_sweep[0].http_target[0].headers, {})) == 0
    )
    error_message = "R-D2: the sweep sends no body (an empty JSON body is a 422) and no X-Job-Token (R8)."
  }

  assert {
    condition = (
      google_cloud_scheduler_job.receipt_read_sweep[0].http_target[0].oidc_token[0].service_account_email == "receipt-sweep-invoker@test-project.iam.gserviceaccount.com"
      && google_cloud_scheduler_job.receipt_read_sweep[0].http_target[0].oidc_token[0].audience == "https://mutaba3a-api-123456789012.me-west1.run.app"
      && length(google_cloud_scheduler_job.receipt_read_sweep[0].http_target[0].oauth_token) == 0
    )
    error_message = "R8: the sweep carries an OIDC token for the sweep service account, audience = the API's origin (its API_ORIGIN)."
  }
}
