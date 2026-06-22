#!/bin/bash
# Build TimupApp (release), assemble Timup.app and code-sign it.
set -euo pipefail

HERE="$(cd "$(dirname "$0")/.." && pwd)"   # the app/ package root
cd "$HERE"

APP_NAME="Timup"
BUNDLE_ID="com.timup.app"
VERSION="1.0"
BUILD="1"
DIST="$HERE/dist"
APP="$DIST/$APP_NAME.app"

echo "==> swift build -c release"
swift build -c release --product TimupApp
BIN_DIR="$(swift build -c release --product TimupApp --show-bin-path)"
BIN="$BIN_DIR/TimupApp"
[ -x "$BIN" ] || { echo "executable introuvable: $BIN"; exit 1; }

echo "==> assembling $APP"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$BIN" "$APP/Contents/MacOS/$APP_NAME"

cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key>            <string>$APP_NAME</string>
  <key>CFBundleDisplayName</key>     <string>$APP_NAME</string>
  <key>CFBundleIdentifier</key>      <string>$BUNDLE_ID</string>
  <key>CFBundleExecutable</key>      <string>$APP_NAME</string>
  <key>CFBundleVersion</key>         <string>$BUILD</string>
  <key>CFBundleShortVersionString</key><string>$VERSION</string>
  <key>CFBundlePackageType</key>     <string>APPL</string>
  <key>LSMinimumSystemVersion</key>  <string>13.0</string>
  <key>LSUIElement</key>             <true/>
  <key>NSPrincipalClass</key>        <string>NSApplication</string>
  <key>NSHighResolutionCapable</key> <true/>
</dict>
</plist>
PLIST

echo "==> code-signing"
SIGN_ID="$(security find-identity -v -p codesigning | awk -F'"' '/Apple Development/{print $2; exit}')"
if [ -n "${SIGN_ID:-}" ]; then
  echo "    identity: $SIGN_ID"
  codesign --force --timestamp=none --sign "$SIGN_ID" "$APP"
else
  echo "    no Apple Development identity — signing ad-hoc"
  codesign --force --sign - "$APP"
fi
codesign --verify --verbose=2 "$APP"

echo "==> done: $APP"
