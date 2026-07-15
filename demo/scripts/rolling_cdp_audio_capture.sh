#!/usr/bin/env bash
set -u

if [ "$#" -lt 6 ]; then
  echo "usage: rolling_cdp_audio_capture.sh <endpoint> <stream_code> <room_id> <timestamp> <segment_count> <segment_seconds>" >&2
  exit 2
fi

endpoint="$1"
stream_code="$2"
room_id="$3"
timestamp="$4"
segment_count="$5"
segment_seconds="$6"
fail_fast="${7:-false}"
min_bytes="${8:-1000}"

case "$segment_count" in
  ''|*[!0-9]*)
    echo "segment_count must be a positive integer" >&2
    exit 2
    ;;
esac

case "$segment_seconds" in
  ''|*[!0-9]*)
    echo "segment_seconds must be a positive integer" >&2
    exit 2
    ;;
esac

if [ "$segment_count" -lt 1 ] || [ "$segment_seconds" -lt 1 ]; then
  echo "segment_count and segment_seconds must be positive" >&2
  exit 2
fi

if [ "$fail_fast" != "true" ] && [ "$fail_fast" != "false" ]; then
  echo "fail_fast must be true or false" >&2
  exit 2
fi

case "$min_bytes" in
  ''|*[!0-9]*)
    echo "min_bytes must be a non-negative integer" >&2
    exit 2
    ;;
esac

out_dir="demo/samples/audio/raw"
log_dir="demo/reports/rolling-capture-logs"
mkdir -p "$out_dir" "$log_dir"

duration_ms=$((segment_seconds * 1000))
overall_status=0
ok_count=0
fail_count=0
summary_file="${log_dir}/${stream_code}_${room_id}_${timestamp}_summary.jsonl"
: >"$summary_file"

write_event() {
  local payload="$1"
  echo "$payload"
  echo "$payload" >>"$summary_file"
}

has_audio_stream() {
  local file="$1"
  ffprobe -v error -select_streams a -show_entries stream=codec_name -of csv=p=0 "$file" >/dev/null 2>&1
}

write_probe_after_failure() {
  local probe_file="$1"
  node demo/scripts/cdp_live_page_probe.js "$endpoint" >"$probe_file" 2>"${probe_file}.err" || true
}

for ((i = 1; i <= segment_count; i += 1)); do
  segment_id=$(printf "%02d" "$i")
  out_file="${out_dir}/${stream_code}_${room_id}_${timestamp}_seg${segment_id}_${segment_seconds}s_page_capture.webm"
  log_file="${log_dir}/${stream_code}_${room_id}_${timestamp}_seg${segment_id}.json"
  probe_file="${log_dir}/${stream_code}_${room_id}_${timestamp}_seg${segment_id}_post_failure_probe.json"

  started_at=$(date -Iseconds)
  if node demo/scripts/cdp_audio_capture.js "$endpoint" "$out_file" "$duration_ms" >"$log_file" 2>&1; then
    ended_at=$(date -Iseconds)
    bytes=$(wc -c <"$out_file" | tr -d ' ')
    if [ "$bytes" -lt "$min_bytes" ]; then
      overall_status=1
      fail_count=$((fail_count + 1))
      write_probe_after_failure "$probe_file"
      write_event "{\"ok\":false,\"reason\":\"audio-file-too-small\",\"stream_code\":\"${stream_code}\",\"room_id\":\"${room_id}\",\"segment\":${i},\"started_at\":\"${started_at}\",\"ended_at\":\"${ended_at}\",\"audio_file\":\"${out_file}\",\"bytes\":${bytes},\"min_bytes\":${min_bytes},\"log_file\":\"${log_file}\",\"post_failure_probe_file\":\"${probe_file}\"}"
      if [ "$fail_fast" = "true" ]; then
        break
      fi
    elif ! has_audio_stream "$out_file"; then
      overall_status=1
      fail_count=$((fail_count + 1))
      write_probe_after_failure "$probe_file"
      write_event "{\"ok\":false,\"reason\":\"no-audio-stream\",\"stream_code\":\"${stream_code}\",\"room_id\":\"${room_id}\",\"segment\":${i},\"started_at\":\"${started_at}\",\"ended_at\":\"${ended_at}\",\"audio_file\":\"${out_file}\",\"bytes\":${bytes},\"min_bytes\":${min_bytes},\"log_file\":\"${log_file}\",\"post_failure_probe_file\":\"${probe_file}\"}"
      if [ "$fail_fast" = "true" ]; then
        break
      fi
    else
      ok_count=$((ok_count + 1))
      write_event "{\"ok\":true,\"stream_code\":\"${stream_code}\",\"room_id\":\"${room_id}\",\"segment\":${i},\"started_at\":\"${started_at}\",\"ended_at\":\"${ended_at}\",\"audio_file\":\"${out_file}\",\"bytes\":${bytes},\"min_bytes\":${min_bytes},\"log_file\":\"${log_file}\"}"
    fi
  else
    ended_at=$(date -Iseconds)
    overall_status=1
    fail_count=$((fail_count + 1))
    write_probe_after_failure "$probe_file"
    write_event "{\"ok\":false,\"reason\":\"capture-command-failed\",\"stream_code\":\"${stream_code}\",\"room_id\":\"${room_id}\",\"segment\":${i},\"started_at\":\"${started_at}\",\"ended_at\":\"${ended_at}\",\"audio_file\":\"${out_file}\",\"log_file\":\"${log_file}\",\"post_failure_probe_file\":\"${probe_file}\"}"
    if [ "$fail_fast" = "true" ]; then
      break
    fi
  fi
done

write_event "{\"ok\":$([ "$overall_status" -eq 0 ] && echo true || echo false),\"type\":\"summary\",\"stream_code\":\"${stream_code}\",\"room_id\":\"${room_id}\",\"requested_segments\":${segment_count},\"ok_segments\":${ok_count},\"failed_segments\":${fail_count},\"segment_seconds\":${segment_seconds},\"summary_file\":\"${summary_file}\"}"

exit "$overall_status"
