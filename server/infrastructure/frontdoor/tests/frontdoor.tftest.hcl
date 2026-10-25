# MUT-326 (ADR-155): the front door, checked offline. Every provider is mocked, so this needs
# no Cloudflare, Netlify or GCP credentials:  terraform init -backend=false && terraform test
# Plans only: the zone and the token secret refuse to be destroyed, which a test apply would do.

mock_provider "cloudflare" {}
mock_provider "google" {}
mock_provider "netlify" {}
mock_provider "random" {}

variables {
  project_id            = "test-project"
  cloudflare_account_id = "test-account"
  netlify_site_id       = "test-site"
}

run "no_domain_builds_nothing" {
  command = plan

  variables {
    hosts_file = "../../../config/fixtures/hosts.no-domain.json"
  }

  assert {
    condition = (
      length(cloudflare_zone.this) + length(cloudflare_dns_record.apex) + length(cloudflare_dns_record.www) +
      length(cloudflare_dns_record.portal) + length(cloudflare_workers_script.front_door) + length(cloudflare_workers_route.portal) +
      length(cloudflare_zone_setting.this) + length(netlify_site_domain_settings.landing) +
      length(google_secret_manager_secret.front_door_token) + length(random_password.front_door_token)
    ) == 0
    error_message = "With no domain in config/hosts.json the front door has no resources."
  }
}

run "the_checked_in_config_builds_only_when_it_names_a_domain" {
  command = plan

  assert {
    condition     = length(cloudflare_zone.this) == (jsondecode(file("../../../config/hosts.json")).production.domain == null ? 0 : 1)
    error_message = "The real config/hosts.json drives the front door."
  }
}

run "a_domain_builds_the_front_door" {
  command = plan

  variables {
    hosts_file = "../../../config/fixtures/hosts.placeholder.json"
  }

  assert {
    condition     = cloudflare_zone.this[0].name == "placeholder.example" && cloudflare_zone.this[0].account.id == "test-account"
    error_message = "The zone is the apex, in the chosen account."
  }

  assert {
    condition = (
      cloudflare_dns_record.apex[0].content == "apex-loadbalancer.netlify.com" && !cloudflare_dns_record.apex[0].proxied &&
      cloudflare_dns_record.www[0].name == "www.placeholder.example" && cloudflare_dns_record.www[0].content == "landing.example.test" && !cloudflare_dns_record.www[0].proxied
    )
    error_message = "The apex and www point at Netlify, DNS only, so Netlify can issue the landing's certificate."
  }

  assert {
    condition     = cloudflare_dns_record.portal[0].name == "app.placeholder.example" && cloudflare_dns_record.portal[0].proxied
    error_message = "The portal host is proxied, so the Worker route can take it."
  }

  assert {
    condition     = cloudflare_workers_route.portal[0].pattern == "app.placeholder.example/*" && cloudflare_workers_route.portal[0].script == "mutaba3a-front-door"
    error_message = "Every portal path goes through the front-door Worker."
  }

  assert {
    condition     = one([for b in cloudflare_workers_script.front_door[0].bindings : b.text if b.name == "UPSTREAM_ORIGIN" && b.type == "plain_text"]) == "https://portal.example.test"
    error_message = "The Worker forwards to the legacy Cloud Run origin."
  }

  assert {
    condition     = one([for b in cloudflare_workers_script.front_door[0].bindings : b.type if b.name == "FRONT_DOOR_TOKEN"]) == "secret_text"
    error_message = "The token is a secret binding, never plain text."
  }

  assert {
    condition     = strcontains(cloudflare_workers_script.front_door[0].content, "x-mutaba3a-front-door")
    error_message = "The deployed script is worker/front-door.js."
  }

  assert {
    condition     = google_secret_manager_secret.front_door_token[0].secret_id == "mutaba3a-api-front-door-token"
    error_message = "The secret has the name the API stack reads (terraform/domain.tf)."
  }

  assert {
    condition = (
      cloudflare_zone_setting.this["ssl"].value == "strict" && cloudflare_zone_setting.this["always_use_https"].value == "on" &&
      cloudflare_zone_setting.this["browser_check"].value == "off" && cloudflare_zone_setting.this["email_obfuscation"].value == "off"
    )
    error_message = "Strict TLS, HTTPS only, and no edge challenge or body rewrite in front of JSON clients and the AASA fetcher."
  }

  assert {
    condition     = netlify_site_domain_settings.landing[0].custom_domain == "placeholder.example" && contains(netlify_site_domain_settings.landing[0].domain_aliases, "www.placeholder.example")
    error_message = "Netlify serves the landing on the apex, with www as an alias."
  }

  assert {
    condition     = output.portal_origin == "https://app.placeholder.example"
    error_message = "The portal origin matches config/hosts.ts and the API stack's PORTAL_ORIGIN."
  }
}

run "staging_gets_its_own_names" {
  command = plan

  variables {
    hosts_file  = "../../../config/fixtures/hosts.placeholder.json"
    environment = "staging"
  }

  assert {
    condition = (
      cloudflare_zone.this[0].name == "staging-placeholder.example" &&
      cloudflare_workers_script.front_door[0].script_name == "mutaba3a-front-door-staging" &&
      google_secret_manager_secret.front_door_token[0].secret_id == "mutaba3a-api-front-door-token-staging"
    )
    error_message = "A staging front door never collides with production's."
  }
}

run "a_domain_without_its_accounts_is_flagged" {
  command = plan

  variables {
    hosts_file            = "../../../config/fixtures/hosts.placeholder.json"
    cloudflare_account_id = ""
  }

  expect_failures = [check.domain_is_configured]
}

# MUT-359 (D1): Resend's records live beside the zone, and only once the operator has Resend's DKIM value.
run "a_domain_without_a_dkim_value_has_no_email_records" {
  command = plan

  variables {
    hosts_file = "../../../config/fixtures/hosts.placeholder.json"
  }

  assert {
    condition     = length(cloudflare_dns_record.email) == 0
    error_message = "No email records until resend_dkim_value is set."
  }
}

run "the_dkim_value_publishes_resends_records_dns_only" {
  command = plan

  variables {
    hosts_file        = "../../../config/fixtures/hosts.placeholder.json"
    resend_dkim_value = "p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQC"
  }

  assert {
    condition = (
      cloudflare_dns_record.email["dkim"].name == "resend._domainkey.placeholder.example" && cloudflare_dns_record.email["dkim"].type == "TXT"
      && cloudflare_dns_record.email["dkim"].content == "p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQC"
      && cloudflare_dns_record.email["return_path_mx"].name == "send.placeholder.example" && cloudflare_dns_record.email["return_path_mx"].type == "MX"
      && cloudflare_dns_record.email["return_path_mx"].content == "feedback-smtp.eu-west-1.amazonses.com" && cloudflare_dns_record.email["return_path_mx"].priority == 10
      && cloudflare_dns_record.email["return_path_spf"].content == "v=spf1 include:amazonses.com ~all"
      && cloudflare_dns_record.email["dmarc"].name == "_dmarc.placeholder.example" && cloudflare_dns_record.email["dmarc"].content == "v=DMARC1; p=none"
    )
    error_message = "DKIM, the return-path MX and SPF on send., and DMARC p=none, under the apex from config/hosts.json."
  }

  assert {
    condition     = alltrue([for r in cloudflare_dns_record.email : !r.proxied])
    error_message = "Mail records are DNS only."
  }
}

# Basel 2026-10-25: Resend sends from notify.<apex>. DKIM and the return path move under the mail subdomain;
# DMARC stays on the apex, where it also governs the subdomain.
run "a_mail_subdomain_moves_dkim_and_the_return_path_under_it" {
  command = plan

  variables {
    hosts_file        = "../../../config/fixtures/hosts.mail-subdomain.json"
    resend_dkim_value = "p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQC"
  }

  assert {
    condition = (
      cloudflare_dns_record.email["dkim"].name == "resend._domainkey.notify.placeholder.example"
      && cloudflare_dns_record.email["return_path_mx"].name == "send.notify.placeholder.example"
      && cloudflare_dns_record.email["return_path_spf"].name == "send.notify.placeholder.example"
      && cloudflare_dns_record.email["dmarc"].name == "_dmarc.placeholder.example"
    )
    error_message = "With mailSubdomain, DKIM and send.* sit under <mailSubdomain>.<apex>; DMARC stays on the apex."
  }
}

run "a_report_address_adds_rua_and_the_region_moves_the_mx" {
  command = plan

  variables {
    hosts_file            = "../../../config/fixtures/hosts.placeholder.json"
    resend_dkim_value     = "p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQC"
    dmarc_report_address  = "dmarc@placeholder.example"
    resend_sending_region = "us-east-1"
  }

  assert {
    condition = (
      cloudflare_dns_record.email["dmarc"].content == "v=DMARC1; p=none; rua=mailto:dmarc@placeholder.example"
      && cloudflare_dns_record.email["return_path_mx"].content == "feedback-smtp.us-east-1.amazonses.com"
    )
    error_message = "rua is added only with an address; the MX follows the sending region."
  }
}

run "a_malformed_dkim_value_is_refused" {
  command = plan

  variables {
    hosts_file        = "../../../config/fixtures/hosts.placeholder.json"
    resend_dkim_value = "v=DKIM1; k=rsa; p=abc"
  }

  expect_failures = [var.resend_dkim_value]
}
