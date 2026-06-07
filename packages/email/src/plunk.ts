import { z } from "zod";

const sendPlunkEmailInput = z.object({
  to: z.union([z.string().email(), z.array(z.string().email()).min(1)]),
  subject: z.string().min(1),
  body: z.string().min(1),
  from: z.string().optional(),
  fromName: z.string().optional(),
});

export type SendPlunkEmailInput = z.infer<typeof sendPlunkEmailInput>;

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function plunkBaseUrl() {
  return (process.env.PLUNK_API_BASE_URL ?? "https://api.plunk.zikrainfotech.com").replace(
    /\/$/,
    "",
  );
}

export async function sendPlunkEmail(input: SendPlunkEmailInput) {
  const parsed = sendPlunkEmailInput.parse(input);
  const response = await fetch(`${plunkBaseUrl()}/v1/send`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${requiredEnv("PLUNK_SECRET_KEY")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      ...parsed,
      from: parsed.from ?? process.env.PLUNK_FROM_EMAIL,
      fromName: parsed.fromName ?? process.env.PLUNK_FROM_NAME,
    }),
  });

  if (!response.ok) {
    throw new Error(`Plunk email send failed with HTTP ${response.status}`);
  }

  const payload = (await response.json()) as { success?: boolean; error?: { message?: string } };
  if (payload.success === false) {
    throw new Error(payload.error?.message ?? "Plunk email send failed");
  }

  return payload;
}

