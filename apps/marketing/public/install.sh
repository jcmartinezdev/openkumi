#!/bin/sh
# Installs the OpenKumi server on this computer, for a Mac or a Linux machine that runs your bots
# without the desktop app in front of it:
#
#   curl -fsSL https://openkumi.ai/install.sh | sh
#
# It downloads the newest release for this kind of computer, checks it against the checksums
# published with it, and unpacks it into ~/.openkumi/runtime. Nothing else is needed: the server
# comes with the Node it runs on. Then it puts the "openkumi" command in ~/.local/bin and keeps
# the server running in the background. Run again, it installs the newest version over the old.
# Your bots and their data (~/.openkumi) are never touched.
#
#   sh install.sh --no-service       install only; start it yourself with "openkumi start"
#   sh install.sh --version 0.2.0    that version, not the newest
#
# On a computer with a screen, the desktop app is the easier way: it carries its own server.
set -eu

RELEASES=${OPENKUMI_RELEASES_URL:-https://github.com/jcmartinezdev/openkumi/releases}
RUNTIME=${OPENKUMI_RUNTIME:-$HOME/.openkumi/runtime}
BIN=${OPENKUMI_BIN:-$HOME/.local/bin}
version=
service=yes

while [ $# -gt 0 ]; do
  case "$1" in
    --no-service) service=no ;;
    --version) shift; version=${1:-} ;;
    *) echo "install.sh: \"$1\" is not an option. See the top of the script." >&2; exit 2 ;;
  esac
  shift
done

say() { printf '  %s\n' "$*"; }
stop() { printf '\n  %s\n\n' "$*" >&2; exit 1; }

# ---- which archive this computer takes
case "$(uname -s)" in
  Darwin) os=darwin ;;
  Linux) os=linux ;;
  *) stop "OpenKumi's server installs this way on macOS and Linux. On Windows, use the desktop app: https://openkumi.ai" ;;
esac
case "$(uname -m)" in
  arm64 | aarch64) arch=arm64 ;;
  x86_64 | amd64) arch=x64 ;;
  *) stop "There is no OpenKumi for this kind of processor ($(uname -m))." ;;
esac
# A terminal running under Rosetta says it is an Intel Mac.
if [ "$os" = darwin ] && [ "$(sysctl -n sysctl.proc_translated 2>/dev/null || echo 0)" = 1 ]; then arch=arm64; fi
# The Node that comes with it needs the usual C library.
if [ "$os" = linux ] && (ldd --version 2>&1 || true) | grep -qi musl; then
  stop "This Linux uses musl (Alpine), which the server's Node does not run on. Use a glibc system such as Debian or Ubuntu."
fi
target=$os-$arch

if command -v curl >/dev/null 2>&1; then fetch() { curl -fsSL "$1" -o "$2"; }
elif command -v wget >/dev/null 2>&1; then fetch() { wget -q "$1" -O "$2"; }
else stop "This needs curl or wget to download OpenKumi."
fi
if command -v sha256sum >/dev/null 2>&1; then checksum() { sha256sum "$1" | cut -d ' ' -f 1; }
elif command -v shasum >/dev/null 2>&1; then checksum() { shasum -a 256 "$1" | cut -d ' ' -f 1; }
else stop "This needs sha256sum or shasum to check the download."
fi
command -v tar >/dev/null 2>&1 || stop "This needs tar to unpack OpenKumi."

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

echo
# ---- which version
if [ -z "$version" ]; then
  fetch "$RELEASES/latest/download/openkumi-server.json" "$work/release.json" || stop "The newest version of OpenKumi could not be looked up. Is this computer online?"
  version=$(sed -n 's/.*"version": *"\([0-9][0-9.]*\)".*/\1/p' "$work/release.json" | head -n 1)
  [ -n "$version" ] || stop "The newest version of OpenKumi could not be read."
fi
version=${version#v}

# ---- download, check, unpack
archive=openkumi-server-$target.tar.gz
say "Downloading OpenKumi $version for ${target}…"
fetch "$RELEASES/download/v$version/$archive" "$work/$archive" || stop "OpenKumi $version was not published for this kind of computer ($target)."
fetch "$RELEASES/download/v$version/SHA256SUMS" "$work/SHA256SUMS" || stop "The checksums of OpenKumi $version could not be downloaded."
expected=$(grep " $archive\$" "$work/SHA256SUMS" | cut -d ' ' -f 1 | head -n 1)
[ -n "$expected" ] && [ "$(checksum "$work/$archive")" = "$expected" ] || stop "The download is not the file that was published. Nothing was installed."

mkdir -p "$RUNTIME/versions"
unpacked=$RUNTIME/versions/.$version.unpacking
rm -rf "$unpacked"
mkdir "$unpacked"
tar -xzf "$work/$archive" -C "$unpacked"
# Tried once before anything points at it.
if [ "$("$unpacked/node" "$unpacked/server/src/cli.ts" version 2>/dev/null)" != "$version" ]; then
  rm -rf "$unpacked"
  stop "OpenKumi $version was downloaded but does not run on this computer. Nothing was installed."
fi
rm -rf "$RUNTIME/versions/$version"
mv "$unpacked" "$RUNTIME/versions/$version"
ln -sfn "versions/$version" "$RUNTIME/current"

# ---- the command
mkdir -p "$BIN"
cat > "$BIN/openkumi" <<EOF
#!/bin/sh
# The OpenKumi command (openkumi.ai/install.sh). It runs whichever version is installed now.
exec "$RUNTIME/current/bin/openkumi" "\$@"
EOF
chmod +x "$BIN/openkumi"
say "OpenKumi $version is installed. Its command is $BIN/openkumi"

# ---- keep it running
started=no
if [ "$service" = yes ]; then
  if "$BIN/openkumi" service install; then started=yes; fi
fi

case ":$PATH:" in
  *":$BIN:"*) openkumi=openkumi ;;
  *)
    openkumi=$BIN/openkumi
    say "$BIN is not where your terminal looks for programs. To type just \"openkumi\", add this line to your shell's profile:"
    say "  export PATH=\"$BIN:\$PATH\""
    echo
    ;;
esac

say "Next:"
[ "$started" = yes ] || say "  $openkumi start               run the server (or \"service install\" to keep it running)"
say "  $openkumi status              what the bots can run on, and what is missing"
say "  $openkumi lan on              let your other computers and your phone reach it"
say "  $openkumi pair                a code to enter in the OpenKumi app there"
echo
