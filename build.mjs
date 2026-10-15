import { mkdir, copyFile, writeFile } from "node:fs/promises";

const site = new URL("https://saauf.github.io/switchyard/");
await mkdir("dist", { recursive: true });
for (const file of [
	"index.html",
	"style.css",
	"app.mjs",
	"core.mjs",
	"auth.mjs",
]) {
	await copyFile(`src/${file}`, `dist/${file}`);
}
await writeFile("dist/.nojekyll", "");
await writeFile(
	"dist/client-metadata.json",
	`${JSON.stringify(
		{
			client_id: new URL("client-metadata.json", site).href,
			client_name: "Switchyard",
			client_uri: site.href,
			redirect_uris: [site.href, "http://127.0.0.1:4173/"],
			grant_types: ["authorization_code"],
			response_types: ["code"],
			token_endpoint_auth_method: "none",
		},
		null,
		2,
	)}\n`,
);
console.log("Built static app in dist/");
