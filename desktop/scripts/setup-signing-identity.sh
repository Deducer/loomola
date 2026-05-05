#!/usr/bin/env bash
# Idempotent: creates a self-signed code-signing identity in the
# user's login keychain so subsequent `codesign --sign` calls produce
# a STABLE signature across rebuilds. Without this, every rebuild
# gets a fresh ad-hoc CDHash and macOS TCC treats the binary as a
# brand-new app — resetting Camera / Mic / Screen Recording /
# Accessibility grants and forcing the user to re-authenticate
# multiple times per launch.
#
# Run this once. After that, build-dev-app.sh and install-local-app.sh
# detect the identity and sign with it automatically.

set -euo pipefail

CERT_CN="Loomola Local Signing"
KEYCHAIN="$HOME/Library/Keychains/login.keychain-db"

if security find-identity -v -p codesigning "$KEYCHAIN" 2>/dev/null \
    | grep -q "$CERT_CN"; then
  echo "✓ Signing identity '$CERT_CN' already exists. Nothing to do."
  exit 0
fi

echo "Creating self-signed code-signing identity '$CERT_CN'..."
echo "  (one-time setup; valid for 10 years)"
echo

WORK_DIR="$(mktemp -d)"
KEY_PATH="$WORK_DIR/key.pem"
CERT_PATH="$WORK_DIR/cert.pem"
P12_PATH="$WORK_DIR/identity.p12"

trap 'rm -rf "$WORK_DIR"' EXIT

# OpenSSL config with the codeSigning extended key usage. Without
# this, codesign will refuse to use the identity.
CONFIG_PATH="$WORK_DIR/cert.conf"
cat > "$CONFIG_PATH" <<'EOF'
[ req ]
distinguished_name = req_distinguished_name
prompt             = no
x509_extensions    = v3_ca

[ req_distinguished_name ]
CN = Loomola Local Signing
O  = Loomola
C  = US

[ v3_ca ]
basicConstraints       = critical,CA:false
keyUsage               = critical,digitalSignature
extendedKeyUsage       = critical,codeSigning
subjectKeyIdentifier   = hash
EOF

openssl req -x509 -nodes -newkey rsa:2048 -days 3650 \
  -keyout "$KEY_PATH" \
  -out "$CERT_PATH" \
  -config "$CONFIG_PATH" \
  >/dev/null 2>&1

# Bundle key + cert into a PKCS12 file for keychain import. Empty
# password is fine — the identity is local-only and the keychain
# itself is the trust boundary.
openssl pkcs12 -export \
  -inkey "$KEY_PATH" \
  -in "$CERT_PATH" \
  -out "$P12_PATH" \
  -name "$CERT_CN" \
  -password pass: \
  >/dev/null 2>&1

# Import. The -T /usr/bin/codesign flag pre-authorizes codesign so
# you don't have to click "Always Allow" on every build.
security import "$P12_PATH" \
  -k "$KEYCHAIN" \
  -P "" \
  -T /usr/bin/codesign \
  >/dev/null

# Mark the imported key partition list to allow codesign without a
# password prompt. This requires the login keychain to be unlocked,
# which it will be in an interactive shell. May prompt once for the
# user's login password — that's the LAST prompt after this setup.
echo
echo "macOS may now ask for your login password (one time)."
echo "Click 'Always Allow' if a keychain dialog appears."
echo
security set-key-partition-list \
  -S "apple-tool:,apple:,codesign:" \
  -s \
  -k "" \
  "$KEYCHAIN" \
  >/dev/null 2>&1 || {
    cat <<'WARN'

Note: set-key-partition-list returned non-zero (this is normal if
the keychain is locked or your login password is empty). Codesign
will prompt the FIRST time it uses this identity; click
"Always Allow" and it'll persist for future builds.

WARN
  }

echo "✓ Identity '$CERT_CN' created and trusted for codesigning."
echo "  Subsequent builds will sign with this identity automatically."
echo "  TCC permissions (Camera, Mic, Screen Recording, Accessibility)"
echo "  will now persist across rebuilds."
