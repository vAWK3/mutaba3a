output "name_servers" {
  description = "Set these at the domain's registrar (server/DEPLOYMENT.md §5a step 1)."
  value       = local.enabled ? cloudflare_zone.this[0].name_servers : []
}

output "portal_origin" {
  description = "The portal's origin through the front door (the API stack's PORTAL_ORIGIN)."
  value       = local.enabled ? "https://${local.portal_host}" : null
}

output "front_door_token_secret" {
  description = "Secret Manager id the API stack reads FRONT_DOOR_TOKEN from."
  value       = local.enabled ? google_secret_manager_secret.front_door_token[0].secret_id : null
}
