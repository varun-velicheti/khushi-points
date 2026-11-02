export const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
export const errCode = (msg: string, fallback: string) => (msg.match(/[A-Z][A-Z_]{3,}/) ?? [fallback])[0];
export const env = (k: string) => Deno.env.get(k) ?? "";
