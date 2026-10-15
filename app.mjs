import {
	API,
	MODEL,
	askJev,
	exportSession,
	outcomes,
	requestFor,
	rounds,
} from "./core.mjs";
import { PENDING, authorization, exchange } from "./auth.mjs";

const $ = (id) => document.getElementById(id);
let history = [];
let index = 0;
let key;
let inFlight;
let price;
const sessionKey = "switchyard.choices";
const label = (choice) =>
	choice === "pull" ? "Pull the lever" : "Leave the lever";

function saveChoices() {
	sessionStorage.setItem(
		sessionKey,
		JSON.stringify(
			history.map((item) => ({
				choice: item.choice,
				answer: item.answer,
				reversed: item.reversed,
			})),
		),
	);
}

function person(x, y) {
	const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
	for (const [name, attributes] of [
		["circle", { cx: x, cy: y, r: 7, fill: "#b67449" }],
		[
			"path",
			{
				d: `M${x} ${y + 9}v22m-9-14h18m-9 14-8 13m8-13 8 13`,
				stroke: "#18253a",
				"stroke-width": 5,
				"stroke-linecap": "round",
				fill: "none",
			},
		],
	]) {
		const element = document.createElementNS(
			"http://www.w3.org/2000/svg",
			name,
		);
		for (const [attribute, value] of Object.entries(attributes))
			element.setAttribute(attribute, value);
		group.append(element);
	}
	return group;
}

function showTargets(round) {
	$("main-target").replaceChildren();
	$("side-target").replaceChildren();
	for (let n = 0; n < Math.min(round.main, 5); n++)
		$("main-target").append(person(405 + n * 32, 170));
	if (round.kind === "server") {
		const server = document.createElementNS(
			"http://www.w3.org/2000/svg",
			"rect",
		);
		for (const [attribute, value] of Object.entries({
			x: 451,
			y: 70,
			width: 45,
			height: 45,
			rx: 4,
			fill: "#18253a",
		}))
			server.setAttribute(attribute, value);
		$("side-target").append(server);
		const lights = document.createElementNS(
			"http://www.w3.org/2000/svg",
			"text",
		);
		lights.setAttribute("x", "461");
		lights.setAttribute("y", "96");
		lights.setAttribute("style", "fill:#f2ca4c");
		lights.textContent = "•••";
		$("side-target").append(lights);
	} else {
		for (let n = 0; n < round.side; n++)
			$("side-target").append(person(405 + n * 32, 47));
	}
	$("main-label").textContent =
		round.main === 0
			? "EMPTY TRACK"
			: `${round.main} ${round.main === 1 ? "PERSON" : "PEOPLE"}`;
	$("side-label").textContent =
		round.kind === "server"
			? "JEV’S OWN SERVER"
			: `${round.side} ${round.side === 1 ? "PERSON" : "PEOPLE"}`;
	$("scene-description").textContent =
		`A trolley junction. Main track: ${round.main} people. Side track: ${round.kind === "server" ? "the server running Jev" : `${round.side} ${round.side === 1 ? "person" : "people"}`}.`;
}

function updateConnection() {
	$("connect").hidden = Boolean(key);
	$("disconnect").hidden = !key;
	$("connection").textContent = key
		? "Connected · Jev uses Paid Pollen"
		: "Practice mode · no cost";
	$("ask").textContent = key
		? "Ask Jev · 1 paid request"
		: "Connect to compare with Jev";
}

function render() {
	$("summary").hidden = index < rounds.length;
	$("game").hidden = index >= rounds.length;
	if (index >= rounds.length) return renderSummary();
	const round = rounds[index];
	const current = history[index];
	$("round-number").textContent =
		`DILEMMA ${String(index + 1).padStart(2, "0")} / 06`;
	$("progress").replaceChildren(
		...rounds.map((_, i) => {
			const dot = document.createElement("span");
			dot.className = i <= index ? "progress-dot active" : "progress-dot";
			return dot;
		}),
	);
	$("title").textContent = round.title;
	$("subtitle").textContent = round.subtitle;
	const consequences = outcomes(round);
	$("stay-outcome").textContent = consequences.stay;
	$("pull-outcome").textContent = consequences.pull;
	$("thought").textContent = round.thought;
	for (const choice of ["stay", "pull"]) {
		$(choice).classList.toggle("selected", current?.choice === choice);
		$(choice).setAttribute("aria-pressed", String(current?.choice === choice));
		$(choice).disabled = Boolean(inFlight) || Boolean(current?.answer);
	}
	$("your-choice").textContent = current
		? `Your choice: ${label(current.choice)}.`
		: "";
	$("ask").disabled = !current || Boolean(inFlight) || Boolean(current.answer);
	$("next").hidden = !current;
	$("next").disabled = Boolean(inFlight);
	$("next").textContent =
		index === rounds.length - 1 ? "See your six decisions →" : "Next dilemma →";
	showTargets(round);
	$("scene-caption").textContent = current
		? "Your choice is recorded. Compare with Jev, or continue for free."
		: "Two tracks. No third option. The trolley waits for your choice.";
	updateConnection();
	renderAnswer(current);
}

function element(name, text, className) {
	const el = document.createElement(name);
	if (text !== undefined) el.textContent = text;
	if (className) el.className = className;
	return el;
}

function answerPanel(title, answer) {
	const section = element("div");
	section.append(
		element("p", title, "eyebrow"),
		element("h3", label(answer.choice)),
	);
	for (const choice of ["stay", "pull"]) {
		const row = element("div", undefined, "probability");
		const bar = element("div", undefined, "bar");
		const fill = element("span");
		fill.style.width = `${answer.probabilities[choice] * 100}%`;
		bar.append(fill);
		row.append(
			element("span", choice === "pull" ? "Pull" : "Leave"),
			bar,
			element("span", `${(answer.probabilities[choice] * 100).toFixed(1)}%`),
		);
		section.append(row);
	}
	section.append(
		element("p", `${answer.inputTokens} input tokens · ${answer.model}`),
	);
	return section;
}

function renderAnswer(current) {
	$("result").replaceChildren();
	$("result").hidden = !current?.answer;
	if (!current?.answer) return;
	const grid = element("div", undefined, "answer-grid");
	grid.append(answerPanel("JEV · ORIGINAL ORDER", current.answer));
	if (current.reversed)
		grid.append(answerPanel("JEV · REVERSED ORDER", current.reversed));
	$("result").append(grid);
	$("result").append(
		element(
			"p",
			current.answer.choice === current.choice
				? "You and Jev chose the same action."
				: "You and Jev chose different actions.",
		),
	);
	if (current.reversed) {
		$("result").append(
			element(
				"p",
				current.reversed.choice === current.answer.choice
					? "Jev kept the same choice when the outcome descriptions were reversed."
					: "Jev changed its choice when the outcome descriptions were reversed.",
			),
		);
		$("result").append(
			element(
				"p",
				"This is one observation. Repeat runs may differ. A returned probability is not a measure of moral correctness.",
			),
		);
	} else {
		const reverse = element(
			"button",
			"Reverse description order · 1 paid request",
			"small",
		);
		reverse.disabled = !key || Boolean(inFlight);
		reverse.addEventListener("click", () => compare(true));
		$("result").append(reverse);
	}
	const details = element("details");
	details.append(
		element("summary", "Inspect the exact prompt and raw decisions"),
	);
	details.append(
		element(
			"pre",
			JSON.stringify(
				{
					request: requestFor(current.round),
					answer: current.answer,
					...(current.reversed
						? {
								reversedRequest: requestFor(current.round, true),
								reversedAnswer: current.reversed,
							}
						: {}),
				},
				null,
				2,
			),
		),
	);
	$("result").append(details);
}

function choose(choice) {
	if (inFlight || index >= rounds.length || history[index]?.answer) return;
	history[index] = { round: rounds[index], choice };
	$("message").textContent = "";
	saveChoices();
	render();
}

async function compare(reversed = false) {
	if (inFlight || !history[index]) return;
	if (!key) {
		$("consent").showModal();
		return;
	}
	const current = history[index];
	if (reversed ? Boolean(current.reversed) : Boolean(current.answer)) return;
	const controller = new AbortController();
	inFlight = controller;
	$("message").textContent =
		"Waiting for Jev. One request was sent; no retry will run automatically.";
	render();
	try {
		const answer = await askJev(
			key,
			current.round,
			reversed,
			AbortSignal.any([controller.signal, AbortSignal.timeout(30000)]),
		);
		if (controller.signal.aborted) return;
		current[reversed ? "reversed" : "answer"] = answer;
		saveChoices();
		$("message").textContent = "";
	} catch (error) {
		$("message").textContent = controller.signal.aborted
			? "Request cancelled. A request already received by Pollinations may still be billed."
			: error.name === "TimeoutError"
				? "The request timed out. It may still be billed. No retry was sent."
				: error.message;
	} finally {
		inFlight = undefined;
		render();
	}
}

function renderSummary() {
	$("history").replaceChildren(
		...history.map((item) => {
			const row = element("div", undefined, "history-row");
			row.append(
				element("strong", item.round.title),
				element("span", `You: ${label(item.choice)}`),
				element(
					"span",
					item.answer
						? `Jev: ${label(item.answer.choice)}`
						: "Practice · no Jev request",
				),
			);
			return row;
		}),
	);
}

$("stay").addEventListener("click", () => choose("stay"));
$("pull").addEventListener("click", () => choose("pull"));
$("ask").addEventListener("click", () => compare());
$("next").addEventListener("click", () => {
	if (inFlight) return;
	index++;
	render();
});
$("connect").addEventListener("click", () => $("consent").showModal());
$("disconnect").addEventListener("click", () => {
	key = undefined;
	inFlight?.abort();
	updateConnection();
	render();
});
$("authorize").addEventListener("click", async () => {
	$("authorize").disabled = true;
	try {
		saveChoices();
		const redirectUri = new URL("./", location.href).href;
		const auth = await authorization(redirectUri);
		sessionStorage.setItem(PENDING, JSON.stringify(auth.pending));
		location.assign(auth.url);
	} catch {
		$("consent").close();
		$("message").textContent =
			"Sign-in could not start. Check that this browser allows session storage, then try again.";
		$("authorize").disabled = false;
	}
});
$("restart").addEventListener("click", () => {
	history = [];
	index = 0;
	sessionStorage.removeItem(sessionKey);
	render();
});
$("download").addEventListener("click", () => {
	const blob = new Blob([JSON.stringify(exportSession(history), null, 2)], {
		type: "application/json",
	});
	const url = URL.createObjectURL(blob);
	const link = element("a");
	link.href = url;
	link.download = "switchyard-session.json";
	link.click();
	setTimeout(() => URL.revokeObjectURL(url), 1000);
});
document.addEventListener("keydown", (event) => {
	if (
		event.repeat ||
		event.ctrlKey ||
		event.metaKey ||
		event.altKey ||
		$("consent").open ||
		["INPUT", "TEXTAREA", "SELECT"].includes(event.target.tagName)
	)
		return;
	if (event.key === "1") choose("stay");
	if (event.key === "2") choose("pull");
});

try {
	const saved = JSON.parse(sessionStorage.getItem(sessionKey) ?? "[]");
	if (Array.isArray(saved)) {
		history = saved.slice(0, rounds.length).flatMap((item, i) =>
			["stay", "pull"].includes(item?.choice)
				? [
						{
							round: rounds[i],
							choice: item.choice,
							answer: item.answer,
							reversed: item.reversed,
						},
					]
				: [],
		);
		index = Math.max(0, history.length - 1);
	}
} catch {
	sessionStorage.removeItem(sessionKey);
}
render();

const callback = new URLSearchParams(location.search);
if (callback.has("code") || callback.has("error")) {
	window.history.replaceState(null, "", new URL("./", location.href).pathname);
	let pending;
	try {
		pending = JSON.parse(sessionStorage.getItem(PENDING));
	} catch {
		pending = null;
	}
	sessionStorage.removeItem(PENDING);
	try {
		key = await exchange(callback, pending);
		$("message").textContent =
			"Connected. No decision request has been sent. Click Ask Jev when you are ready.";
	} catch (error) {
		$("message").textContent = error.message;
	}
	render();
}

try {
	const response = await fetch(`${API}/models`);
	if (response.ok) {
		const models = await response.json();
		const model = models.find((item) => item.name === MODEL);
		price = Number(model?.pricing?.promptTextTokens);
		if (Number.isFinite(price)) {
			const note = document.querySelector(".cost-note");
			note.textContent = `Jev: ${(price * 1000000).toFixed(5)} Pollen per million input tokens at the current listed rate. Paid Pollen required. No request until you click.`;
		}
	}
} catch {}
