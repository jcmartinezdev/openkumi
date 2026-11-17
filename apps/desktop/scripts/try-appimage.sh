#!/bin/sh
# Opens the Linux app from its AppImage and uses it (try.mjs), on a computer with no screen.
#   sh apps/desktop/scripts/try-appimage.sh <the AppImage> <folder for what is kept> [options for try.mjs]
#
# Two things are found out. The first only reports: whether the AppImage opens when it is simply
# run, as someone who downloaded it would. That needs things of the computer an AppImage does not
# bring (FUSE to open itself, and the right for Chromium to use its sandbox), and what this
# computer says is what the install instructions have to tell people. The second decides: the
# app taken out of the AppImage has to open and work.
set -eu
appimage=$(realpath "$1")
out=$2
shift 2
mkdir -p "$out"
here=$(dirname "$0")
command -v xvfb-run >/dev/null || sudo apt-get install -y xvfb >/dev/null
chmod +x "$appimage"

note() {
  echo "$1"
  if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then echo "$1" >> "$GITHUB_STEP_SUMMARY"; fi
}

# 1. Simply run. An app that opens is still there when its time is up; one that cannot open ends at once.
system=$(. /etc/os-release && echo "$PRETTY_NAME")
# simply <what is tried, in words> [VARIABLE=value]: whether the AppImage stays open, run that way.
simply() {
  how=$1
  shift
  plain=$(mktemp -d)
  set +e
  env OPENKUMI_DESKTOP_DATA="$plain/app" OPENKUMI_HOME="$plain/home" OPENKUMI_PORT=4979 "$@" xvfb-run -a timeout 25 "$appimage" > "$out/simply-run.log" 2>&1
  code=$?
  set -e
  rm -rf "$plain"
  if [ "$code" = 124 ]; then
    note ":white_check_mark: $(basename "$appimage") opens when it is $how on $system."
    return 0
  fi
  note ":warning: $(basename "$appimage") does not open when it is $how on $system (it ended with $code). What it said:"
  note '```'
  note "$(tail -n 15 "$out/simply-run.log")"
  note '```'
  return 1
}
# Unpacking itself first is what an AppImage is told to do where it cannot open itself in place.
simply 'simply run' || simply 'told to unpack itself first (APPIMAGE_EXTRACT_AND_RUN=1)' APPIMAGE_EXTRACT_AND_RUN=1 || true

# 2. Taken out of the AppImage, which needs nothing of the computer, and without Chromium's
# sandbox, which the computers the release is made on do not allow an unpacked app.
work=$(mktemp -d)
(cd "$work" && "$appimage" --appimage-extract >/dev/null)
xvfb-run -a node "$here/try.mjs" "$work/squashfs-root/openkumi" --out "$out" --no-sandbox "$@"
