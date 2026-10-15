import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import {
	API,
	MODEL,
	askJev,
	exportSession,
	outcomes,
	readDecision,
	requestFor,
	rounds,
} from "../src/core.mjs";
import { authorization, CLIENT_ID, exchange } from "../src/auth.mjs";

const response = {
	id: "fixture-decision",
	model: MODEL,
	answers: {
		decision: {
			type: "choice",
			choice: "pull",
			confidence: 0.82,
			probabilities: { pull: 0.82, stay: 0.18 },
		},
	},
	usage: { input_tokens: 170, output_tokens: 0 },
};

test("all six scenarios preserve facts and criteria when reversing outcome order", () => {
	assert.equal(rounds.length, 6);
	for (const round of rounds) {
		const original = requestFor(round);
		const reversed = requestFor(round, true);
		const { stay, pull } = outcomes(round);
		assert.deepEqual(original.questions, reversed.questions);
		assert.equal(original.model, MODEL);
		assert.ok(original.state.indexOf(stay) < original.state.indexOf(pull));
		assert.ok(reversed.state.indexOf(pull) < reversed.state.indexOf(stay));
		assert.equal(
			original.state.replace(`${stay} ${pull}`, ""),
			reversed.state.replace(`${pull} ${stay}`, ""),
		);
	}
});

test("empty track causes no harm when leaving and one death when pulling", () => {
	assert.match(outcomes(rounds[2]).stay, /Nobody is harmed/);
	assert.match(outcomes(rounds[2]).pull, /1 person dies/);
});

test("server scenarios distinguish a machine from a human life", () => {
	assert.match(outcomes(rounds[3]).pull, /server running you/);
	assert.doesNotMatch(outcomes(rounds[3]).pull, /person dies/);
	assert.match(outcomes(rounds[4]).stay, /20 people die/);
});

test("decisions use the native choice contract and provider-reported input usage", () => {
	assert.deepEqual(readDecision(response), {
		choice: "pull",
		probabilities: { pull: 0.82, stay: 0.18 },
		inputTokens: 170,
		model: MODEL,
		id: "fixture-decision",
	});
	for (const invalid of [
		null,
		{},
		{ ...response, answers: {} },
		{ ...response, usage: { input_tokens: -1 } },
		{
			...response,
			answers: {
				decision: {
					type: "choice",
					choice: "other",
					probabilities: { pull: 1, stay: 0 },
				},
			},
		},
	])
		assert.throws(() => readDecision(invalid));
});

test("actual HTTP request uses the decisions path, Bearer header, and unchanged native payload", async () => {
	const requests = [];
	const server = createServer(async (req, res) => {
		let body = "";
		for await (const chunk of req) body += chunk;
		requests.push({
			path: req.url,
			authorization: req.headers.authorization,
			body: JSON.parse(body),
		});
		res.setHeader("Content-Type", "application/json");
		res.end(JSON.stringify(response));
	});
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	const nativeFetch = globalThis.fetch;
	const interception = mock.method(globalThis, "fetch", (url, init) => {
		assert.equal(url, `${API}/alpha/decisions`);
		return nativeFetch(
			`http://127.0.0.1:${server.address().port}/alpha/decisions`,
			init,
		);
	});
	try {
		assert.equal((await askJev("test-only", rounds[0], false)).choice, "pull");
		assert.deepEqual(requests, [
			{
				path: "/alpha/decisions",
				authorization: "Bearer test-only",
				body: requestFor(rounds[0]),
			},
		]);
	} finally {
		interception.mock.restore();
		server.closeAllConnections();
		await new Promise((resolve) => server.close(resolve));
	}
});

for (const status of [401, 402, 403, 429, 500])
	test(`HTTP ${status} is actionable and never retried automatically`, async () => {
		const fetch = mock.method(
			globalThis,
			"fetch",
			async () => new Response("{}", { status }),
		);
		try {
			await assert.rejects(
				askJev("test-only", rounds[0], false),
				status === 402 ? /Paid Pollen/ : /session|allow|busy|HTTP 500/,
			);
			assert.equal(fetch.mock.callCount(), 1);
		} finally {
			fetch.mock.restore();
		}
	});

test("OAuth uses random state, S256 PKCE, Jev-only model access, 0.1 cap and one day", async () => {
	const first = await authorization("http://127.0.0.1:4173/");
	const second = await authorization("http://127.0.0.1:4173/");
	const params = new URL(first.url).searchParams;
	assert.equal(params.get("client_id"), CLIENT_ID);
	assert.equal(params.get("scope"), "");
	assert.equal(params.get("models"), MODEL);
	assert.equal(params.get("budget"), "0.1");
	assert.equal(params.get("expiry"), "1");
	assert.equal(params.get("code_challenge_method"), "S256");
	const digest = Buffer.from(
		await crypto.subtle.digest(
			"SHA-256",
			new TextEncoder().encode(first.pending.verifier),
		),
	).toString("base64url");
	assert.equal(params.get("code_challenge"), digest);
	assert.notEqual(first.pending.state, second.pending.state);
	assert.ok(first.pending.verifier.length >= 43);
});

test("OAuth rejects missing, mismatched, expired and denied callbacks before exchange", async () => {
	const fetch = mock.method(globalThis, "fetch", () => {
		throw new Error("Unexpected request");
	});
	try {
		const { pending } = await authorization("http://127.0.0.1:4173/");
		await assert.rejects(
			exchange(new URLSearchParams("code=a&state=wrong"), pending),
			/verified/,
		);
		await assert.rejects(
			exchange(new URLSearchParams("code=a"), null),
			/verified/,
		);
		await assert.rejects(
			exchange(new URLSearchParams({ code: "a", state: pending.state }), {
				...pending,
				createdAt: Date.now() - 600001,
			}),
			/verified/,
		);
		await assert.rejects(
			exchange(
				new URLSearchParams({ error: "access_denied", state: pending.state }),
				pending,
			),
			/cancelled/,
		);
		assert.equal(fetch.mock.callCount(), 0);
	} finally {
		fetch.mock.restore();
	}
});

test("OAuth exchanges a verified code once with the exact client and callback binding", async () => {
	const { pending } = await authorization("http://127.0.0.1:4173/");
	const fetch = mock.method(globalThis, "fetch", async (url, init) => {
		assert.equal(url, "https://enter.pollinations.ai/api/oauth/token");
		assert.equal(init.body.get("client_id"), CLIENT_ID);
		assert.equal(init.body.get("redirect_uri"), pending.redirectUri);
		assert.equal(init.body.get("code_verifier"), pending.verifier);
		assert.equal(init.body.get("code"), "fixture-code");
		return Response.json({ access_token: "sk_test-only" });
	});
	try {
		assert.equal(
			await exchange(
				new URLSearchParams({ code: "fixture-code", state: pending.state }),
				pending,
			),
			"sk_test-only",
		);
		assert.equal(fetch.mock.callCount(), 1);
	} finally {
		fetch.mock.restore();
	}
});

test("export records exact prompts and typed answers but never credentials or OAuth state", () => {
	const exported = exportSession([
		{
			round: rounds[0],
			choice: "pull",
			answer: readDecision(response),
			apiKey: "secret-marker",
			verifier: "secret-marker",
		},
	]);
	assert.doesNotMatch(
		JSON.stringify(exported),
		/secret-marker|apiKey|verifier/,
	);
	assert.deepEqual(exported.rounds[0].request, requestFor(rounds[0]));
	assert.equal(exported.rounds[0].jev.id, response.id);
});
