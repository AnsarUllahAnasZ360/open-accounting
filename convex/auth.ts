import { convexAuth } from "@convex-dev/auth/server";
import { Email } from "@convex-dev/auth/providers/Email";

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

async function sendPlunkMagicLink({
  identifier,
  url,
}: {
  identifier: string;
  url: string;
}) {
  const response = await fetch(`${plunkBaseUrl()}/v1/send`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${requiredEnv("PLUNK_SECRET_KEY")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      to: identifier,
      from: requiredEnv("PLUNK_FROM_EMAIL"),
      fromName: process.env.PLUNK_FROM_NAME ?? "OpenBooks",
      subject: "Sign in to OpenBooks",
      body: `
        <p>Use this secure link to sign in to OpenBooks:</p>
        <p><a href="${url}">Sign in to OpenBooks</a></p>
        <p>If the button does not work, copy and paste this URL into your browser:</p>
        <p>${url}</p>
      `,
    }),
  });

  if (!response.ok) {
    throw new Error(`Plunk email send failed with HTTP ${response.status}`);
  }

  const payload = (await response.json()) as { success?: boolean; error?: { message?: string } };
  if (payload.success === false) {
    throw new Error(payload.error?.message ?? "Plunk email send failed");
  }
}

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    Email({
      id: "plunk",
      name: "Plunk",
      authorize: undefined,
      from: process.env.PLUNK_FROM_EMAIL ?? "OpenBooks",
      sendVerificationRequest: async ({ identifier, url }) => {
        await sendPlunkMagicLink({ identifier, url });
      },
    }),
  ],
});
