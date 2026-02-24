export function getEnv(name: string, required = true): string {
  const value = Deno.env.get(name);
  if (!value && required) {
    throw new Error(`Missing env: ${name}`);
  }
  return value ?? "";
}
