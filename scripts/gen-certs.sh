#!/usr/bin/env bash
#
# H.A.R.P.™ — Generate a private CA plus client (concierge) and server
# (container) certificates for mutual TLS in development.
#
# Usage:  bash scripts/gen-certs.sh
# Output: ./certs/{ca,concierge,container-*}.{key,crt}
#
# These are DEV certs. For production, issue certs from your real internal CA
# (or a secrets manager / service mesh) and never commit private keys.

set -euo pipefail

CERT_DIR="${CERT_DIR:-./certs}"
DAYS="${DAYS:-825}"
mkdir -p "$CERT_DIR"
cd "$CERT_DIR"

echo "==> Generating private CA"
openssl genrsa -out ca.key 4096
openssl req -x509 -new -nodes -key ca.key -sha256 -days "$DAYS" \
  -subj "/CN=H.A.R.P. Dev CA/O=HARP-LOCAL-DEV-ONLY/OU=DEV-CERT-DO-NOT-USE-IN-PRODUCTION" -out ca.crt

# Helper: issue a cert signed by the CA for a given CN, with SANs.
issue() {
  local name="$1"; shift
  local cn="$1"; shift
  local san="$1"; shift

  echo "==> Issuing cert: $name (CN=$cn)"
  openssl genrsa -out "${name}.key" 2048
  openssl req -new -key "${name}.key" -subj "/CN=${cn}" -out "${name}.csr"

  cat > "${name}.ext" <<EOF
subjectAltName = ${san}
extendedKeyUsage = serverAuth, clientAuth
EOF

  openssl x509 -req -in "${name}.csr" -CA ca.crt -CAkey ca.key -CAcreateserial \
    -out "${name}.crt" -days "$DAYS" -sha256 -extfile "${name}.ext"
  rm -f "${name}.csr" "${name}.ext"
}

# Concierge (client). SAN can be localhost for local runs.
issue "concierge" "harp-concierge" "DNS:harp-concierge,DNS:localhost,IP:127.0.0.1"

# Containers (servers). Service names must match docker-compose service DNS.
issue "container-primary" "harp-container-primary" "DNS:harp-container-primary,DNS:localhost,IP:127.0.0.1"
issue "container-backup"  "harp-container-backup"  "DNS:harp-container-backup,DNS:localhost,IP:127.0.0.1"

echo "==> Done. Certs in ${CERT_DIR}/"
echo "    CA:        ca.crt"
echo "    Concierge: concierge.crt / concierge.key"
echo "    Primary:   container-primary.crt / container-primary.key"
echo "    Backup:    container-backup.crt / container-backup.key"
