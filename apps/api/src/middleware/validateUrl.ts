const ALLOWED_DOMAINS = [
  "github.com", "notion.so", "figma.com",
  "docs.google.com", "linear.app"
] as const;

export function isDeliverableUrlAllowed(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "https:") return false;
    return ALLOWED_DOMAINS.some(d =>
      url.hostname === d || url.hostname.endsWith(`.${d}`)
    );
  } catch {
    return false;
  }
}

export function validateDeliverableUrl(
  req: any, res: any, next: any
): void {
  const url = req.body?.deliverableUrl as string | undefined;
  if (!url || !isDeliverableUrlAllowed(url)) {
    res.status(400).json({
      error: "INVALID_DELIVERABLE_URL",
      message: `URL must be from: ${ALLOWED_DOMAINS.join(", ")}`,
      allowed: ALLOWED_DOMAINS
    });
    return;
  }
  next();
}
