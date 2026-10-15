import { MODEL } from "./core.mjs";

export const CLIENT_ID =
	"https://saauf.github.io/switchyard/client-metadata.json";
export const PENDING = "switchyard.oauth";
const base64url = (bytes) =>
	btoa(String.fromCharCode(...bytes))
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");

export async function authorization(redirectUri) {
	const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
	const state = base64url(crypto.getRandomValues(new Uint8Array(32)));
	const challenge = base64url(
		new Uint8Array(
			await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)),
		),
	);
	const pending = { verifier, state, redirectUri, createdAt: Date.now() };
	const params = new URLSearchParams({
		response_type: "code",
		client_id: CLIENT_ID,
		redirect_uri: redirectUri,
		state,
		code_challenge: challenge,
		code_challenge_method: "S256",
		scope: "",
		models: MODEL,
		budget: "0.1",
		expiry: "1",
	});
	return { pending, url: `https://enter.pollinations.ai/authorize?${params}` };
}

export async function exchange(params, pending) {
	if (
		!pending ||
		params.get("state") !== pending.state ||
		Date.now() - pending.createdAt > 600000 ||
		pending.createdAt > Date.now()
	) {
		throw new Error(
			"This sign-in could not be verified. Start a fresh sign-in from this page.",
		);
	}
	if (params.has("error"))
		throw new Error("Sign-in was cancelled. You can keep playing for free.");
	const code = params.get("code");
	if (!code)
		throw new Error("No authorization code was returned. Start sign-in again.");
	const response = await fetch(
		"https://enter.pollinations.ai/api/oauth/token",
		{
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({
				grant_type: "authorization_code",
				code,
				client_id: CLIENT_ID,
				redirect_uri: pending.redirectUri,
				code_verifier: pending.verifier,
			}),
		},
	);
	if (!response.ok)
		throw new Error(
			"Sign-in exchange failed. Start a fresh sign-in; this code will not be retried.",
		);
	const result = await response.json();
	if (
		typeof result.access_token !== "string" ||
		!result.access_token.startsWith("sk_")
	)
		throw new Error("Sign-in returned no usable key.");
	return result.access_token;
}
