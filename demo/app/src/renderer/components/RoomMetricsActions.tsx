export function RoomMetricsActions({ followerText, viewerLabel, viewerText }: { followerText: string; viewerLabel: string; viewerText: string }) {
  return <div className="room-metrics">
    <span>主播粉丝 <b>{followerText}</b></span>
    <span>{viewerLabel} <b>{viewerText}</b></span>
  </div>;
}
