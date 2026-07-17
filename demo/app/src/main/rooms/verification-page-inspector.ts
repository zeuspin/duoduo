import type { VerificationBlockedState } from "./embedded-verification-controller";

export interface VerificationFrame {
  executeJavaScript(source: string): Promise<unknown>;
}

const readVisibleText = "document.body?.innerText?.slice(0,20000) ?? ''";

export async function inspectVerificationPage(frame: VerificationFrame): Promise<VerificationBlockedState> {
  const text = String(await frame.executeJavaScript(readVisibleText));
  if (/请完成下列验证后继续|安全验证|验证码/.test(text)) return "verification_required";
  if (/扫码登录|登录后/.test(text)) return "login_required";
  return "clear";
}
