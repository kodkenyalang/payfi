export const bigIntReplacer = (_key: string, value: unknown) =>
  typeof value === "bigint" ? value.toString() : value;
