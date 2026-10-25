#!/usr/bin/env bash
# Turn the raw Runway sounds into the game's files in public/audio:
# one-shots trimmed of leading silence and peaked at -1 dB, beds brought to the
# same loudness (-26 LUFS) so the mix in src/audio/sound.ts sets how they sit. Mono for one-shots,
# since the game pans them itself.
# Usage: art/audio/prepare.sh <folder of raw mp3s>
set -euo pipefail
src=$1
out=$(dirname "$0")/../../public/audio
mkdir -p "$out"
peak() { ffmpeg -hide_banner -i "$1" -af volumedetect -f null - 2>&1 | sed -n 's/.*max_volume: \(-\?[0-9.]*\) dB/\1/p'; }
for f in "$src"/*.mp3; do
  n=$(basename "$f" .mp3)
  case $n in *-unused) continue ;; esac
  case $n in
    amb-*|tension-drone)
      ffmpeg -hide_banner -loglevel error -y -i "$f" -af loudnorm=I=-26:TP=-3:LRA=11 -ar 44100 -b:a 96k "$out/$n.mp3"
      continue ;;
  esac
  filt="silenceremove=start_periods=1:start_threshold=-50dB,"
  target=-1
  gain=$(awk -v p="$(peak "$f")" -v t=$target 'BEGIN{print t-p}')
  ffmpeg -hide_banner -loglevel error -y -i "$f" -af "${filt}volume=${gain}dB" -ac 1 -b:a 96k "$out/$n.mp3"
done
