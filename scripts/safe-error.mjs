export function safeError(error) {
  const raw = error instanceof Error ? error.message : String(error);
  return raw
    .replace(/(?:[a-z][a-z0-9+.-]*):\/\/[^\s]+/gi, '[url-redacted]')
    .replace(/(?:^|[\s'\"])(?:[A-Za-z]:[\\/]|\/)(?:[^\s'\",;)]*)/g, '$1[path-redacted]')
    .replace(/(?:PRIVATE_KEY|SESSION_SECRET|DATABASE_URL|API_KEY|TOKEN)=?[^\s,;]*/gi, '[secret-redacted]')
    .replace(/0x[a-fA-F0-9]{40,}/g, '[hex-redacted]')
    .replace(/[a-fA-F0-9]{80,}/g, '[hex-redacted]')
    .slice(0, 320);
}
