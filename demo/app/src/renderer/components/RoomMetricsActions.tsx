import type { ReactNode } from "react";

export function RoomMetricsActions({ followerText, viewerText, children }: { followerText: string; viewerText?: string; children: ReactNode }) {
  return <div className="room-metrics-actions">
    <div className="room-metrics">
      <span>主播粉丝 <b>{followerText}</b></span>
      {viewerText !== undefined && <span>直播间人数 <b>{viewerText}</b></span>}
    </div>
    {children}
  </div>;
}
