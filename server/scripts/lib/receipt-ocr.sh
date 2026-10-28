# shellcheck shell=bash
# MUT-441: the receipt-ocr image in a release and a rollback. Sourced by scripts/deploy.sh (after release-guard.sh,
# whose guard_var_args it uses), never run; the caller defines info, die and warn. Bash 3.2 compatible.
#
# The image is built only while this checkout's server_ocr_enabled is true: it is about 1.2 GB (models, OpenCV,
# Tesseract) and minutes of build and push, and nothing runs it while the flag is off. It is tagged with the API's
# short sha and labelled like the API's image (release-image.ts), so a rollback finds a commit's OCR image the same
# way (F6). Its CONFIG_LABEL is a hash of the OCR image's own build settings, not the portal's: the portal isn't in it.
# Tested by src/scripts/__tests__/receipt-ocr-release.test.ts and rollback.test.ts.

# The receipt-ocr image's build settings (server/ocr/Dockerfile args). Change both together.
OCR_BUILD_TARGET="runtime"
OCR_TESSDATA_VARIANT="fast"

# ocr_read_enabled <terraform args…>: sets OCR_ENABLED (true|false) from this checkout's server_ocr_enabled, as the
# apply will see it. Run inside the terraform dir, after `terraform init`. Fails closed.
# shellcheck disable=SC2034 # read by deploy.sh and rollback.sh
OCR_ENABLED=""
# shellcheck disable=SC2034
ocr_read_enabled() {
  guard_var_args "$@"
  local enabled
  enabled="$(printf 'var.server_ocr_enabled\n' | terraform console ${GUARD_VAR_ARGS[@]+"${GUARD_VAR_ARGS[@]}"})" \
    || die "could not evaluate server_ocr_enabled with terraform console (above); refusing to release on a guess"
  enabled="$(sed -n '1{s/"//g;p;}' <<<"${enabled}")"
  [[ "${enabled}" == "true" || "${enabled}" == "false" ]] \
    || die "terraform console gave '${enabled}' for server_ocr_enabled; refusing to release on a guess"
  OCR_ENABLED="${enabled}"
}

# ocr_build_config: the CONFIG_LABEL value for a receipt-ocr image (its build settings), so a reuse is refused when
# they changed since the tag was pushed.
ocr_build_config() {
  printf 'receipt-ocr\ntarget=%s\nTESSDATA_VARIANT=%s\n' "${OCR_BUILD_TARGET}" "${OCR_TESSDATA_VARIANT}" | shasum -a 256 | cut -d' ' -f1
}

# ocr_release_image <image ref:tag> <head sha> <tree dirty true|false> <server dir>: builds and pushes the receipt-ocr
# image for HEAD, or reuses the tag when it already holds this clean HEAD with the same settings. Never pushes over a
# tag (release-image.ts deploy-plan refuses one that holds anything else). Needs the docker daemon and gcloud.
ocr_release_image() {
  local image="$1" head="$2" dirty="$3" server_dir="$4" config plan
  config="$(ocr_build_config)"
  plan="$(REGISTRY_TOKEN="$(gcloud auth print-access-token)" npm --prefix "${server_dir}" run --silent release-image -- deploy-plan --image "${image}" --head "${head}" --dirty "$([[ "${dirty}" == "true" ]] && echo 1 || echo 0)" --config "${config}")" \
    || die "refusing to deploy ${image} (above)"
  if [[ "${plan}" == "reuse" ]]; then
    info "reusing ${image}: it already holds ${head:0:12}"
    return 0
  fi
  info "building ${image} with the local docker daemon"
  gcloud auth configure-docker "${image%%/*}" --quiet
  docker build --platform linux/amd64 --target "${OCR_BUILD_TARGET}" --build-arg "TESSDATA_VARIANT=${OCR_TESSDATA_VARIANT}" \
    --label "org.opencontainers.image.revision=${head}" --label "dirty=${dirty}" --label "portal-config=${config}" \
    -t "${image}" "${server_dir}/ocr"
  info "pushing ${image}"
  docker push "${image}"
}

# ocr_deployed_tag <service> <region> <project>: the image tag the live receipt-ocr service runs; empty when the
# service doesn't exist yet. Any other failure stops: a rollback must know what it keeps.
ocr_deployed_tag() {
  local service="$1" region="$2" project="$3" image err rc=0
  err="$(mktemp "${TMPDIR:-/tmp}/receipt-ocr-XXXX")"
  image="$(gcloud run services describe "${service}" --region="${region}" --project="${project}" \
    --format='value(spec.template.spec.containers[0].image)' 2>"${err}")" || rc=$?
  if (( rc != 0 )); then
    if grep -qiE 'cannot find service|could not be found|NOT_FOUND' "${err}"; then
      rm -f "${err}"; return 0
    fi
    cat "${err}" >&2; rm -f "${err}"
    die "could not read ${service}'s image (above); a rollback needs to know what it serves"
  fi
  rm -f "${err}"
  [[ "${image}" == *:* ]] || die "${service} runs '${image}', which names no tag; can't tell what it serves"
  printf '%s\n' "${image##*:}"
}

# ocr_rollback_tag <commit> <deployed OCR tag or empty> <repository>: F6. The commit's own receipt-ocr image when it
# has a usable one; else the one that serves now (the sidecar's /v1/read is versioned, so either side rolls alone).
# Dies when there is neither. Prints the tag. SERVER_DIR is deploy.sh's.
# shellcheck disable=SC2153
ocr_rollback_tag() {
  local commit="$1" deployed="$2" repository="$3" tag
  if tag="$(REGISTRY_TOKEN="$(gcloud auth print-access-token)" npm --prefix "${SERVER_DIR}" run --silent release-image -- rollback --repository "${repository}" --commit "${commit}")"; then
    info "receipt-ocr rolls back with the API, to ${tag}"
    printf '%s\n' "${tag}"
    return 0
  fi
  [[ -n "${deployed}" ]] \
    || die "server_ocr_enabled is true, but ${commit:0:12} has no usable receipt-ocr image (above) and no receipt-ocr service runs; deploy forward, or roll back with server_ocr_enabled = false"
  warn "${commit:0:12} has no usable receipt-ocr image (above); keeping the running ${deployed} (its /v1/read is versioned, so the API rolls alone)"
  printf '%s\n' "${deployed}"
}
