import { createHmac, randomBytes } from "node:crypto";

export type OAuthParameter = readonly [string, string];

/** The X API host — overridable so tests can point the driver at a local fixture. */
export function xApiBase(): string {
  return (process.env.CRONFOUNDER_X_API ?? "https://api.x.com").replace(/\/$/, "");
}

function rfc3986(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

export function oauthSignature(
  method: string,
  requestUrl: string,
  oauthParameters: ReadonlyArray<OAuthParameter>,
  consumerSecret: string,
  tokenSecret: string,
  requestParameters: ReadonlyArray<OAuthParameter> = [],
): string {
  const url = new URL(requestUrl);
  const queryParameters = [...url.searchParams.entries()] as OAuthParameter[];
  const normalized = [...queryParameters, ...requestParameters, ...oauthParameters]
    .map(([key, value]) => [rfc3986(key), rfc3986(value)] as const)
    .sort(([aKey, aValue], [bKey, bValue]) =>
      aKey < bKey ? -1 : aKey > bKey ? 1 : aValue < bValue ? -1 : aValue > bValue ? 1 : 0,
    )
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
  const baseUrl = `${url.protocol}//${url.host}${url.pathname}`;
  const baseString = [method.toUpperCase(), rfc3986(baseUrl), rfc3986(normalized)].join("&");
  const key = `${rfc3986(consumerSecret)}&${rfc3986(tokenSecret)}`;
  return createHmac("sha1", key).update(baseString).digest("base64");
}

export function oauthAuthorization(
  method: string,
  url: string,
  credentials: { apiKey: string; apiKeySecret: string; accessToken: string; accessTokenSecret: string },
  overrides: { nonce?: string; timestamp?: string } = {},
): string {
  const parameters: OAuthParameter[] = [
    ["oauth_consumer_key", credentials.apiKey],
    ["oauth_nonce", overrides.nonce ?? randomBytes(16).toString("hex")],
    ["oauth_signature_method", "HMAC-SHA1"],
    ["oauth_timestamp", overrides.timestamp ?? String(Math.floor(Date.now() / 1000))],
    ["oauth_token", credentials.accessToken],
    ["oauth_version", "1.0"],
  ];
  const signature = oauthSignature(method, url, parameters, credentials.apiKeySecret, credentials.accessTokenSecret);
  return `OAuth ${[...parameters, ["oauth_signature", signature] as const]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${rfc3986(key)}="${rfc3986(value)}"`)
    .join(", ")}`;
}
