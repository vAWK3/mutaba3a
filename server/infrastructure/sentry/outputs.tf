output "dsn" {
  description = "Public DSN per surface. Where each goes: docs/observability/README.md (api via terraform_remote_state in MUT-148; portal hosted build env; landing Netlify production context; capture-app the fastlane release lanes' own --dart-define, never the shared .env)."
  value       = { for surface, key in sentry_key.this : surface => key.dsn["public"] }
  sensitive   = true
}

output "project_slugs" {
  description = "Project slug per surface, for SENTRY_PROJECT in source-map and debug-symbol uploads."
  value       = { for surface, project in sentry_project.this : surface => project.slug }
}
