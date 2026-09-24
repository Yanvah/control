export type LoginDestination =
  | "/overview"
  | "/settings"
  | "/products"
  | "/products/new"
  | "/users"
  | `/products/${string}`
  | `/users/${string}`;
const productId =
  "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
/** Allow only known dashboard routes; never trust the login query as a redirect URL. */
export function safeLoginDestination(value: unknown): LoginDestination {
  if (
    value === "/settings" ||
    value === "/products" ||
    value === "/products/new" ||
    value === "/users"
  )
    return value;
  if (typeof value !== "string" || /[\\\r\n#]/.test(value)) return "/overview";
  if (
    new RegExp(`^/products/${productId}(?:/actions|/users/new)?$`, "i").test(
      value,
    )
  )
    return value as `/products/${string}`;
  const match = new RegExp(`^/users/(${productId})\\?(.*)$`, "i").exec(value);
  if (match) {
    const params = new URLSearchParams(match[2]);
    const userId = params.get("userId");
    if (
      [...params.keys()].length === 1 &&
      userId &&
      userId.length <= 256 &&
      /\S/.test(userId)
    ) {
      return `/users/${match[1]}?userId=${encodeURIComponent(userId)}`;
    }
  }
  return "/overview";
}
