import {
	App,
	Modal,
	Notice,
	Plugin,
	PluginSettingTab,
	Setting,
} from "obsidian";
import * as yaml from 'js-yaml';

const path = require("path");

const DEFAULT_SETTINGS: PaperNoteFillerPluginSettings = {
	folderLocation: "",
};

//create a string map for all the strings we need
const STRING_MAP: Map<string, string> = new Map([
	[
		"error", "Something went wrong. Check the Obsidian console if the error persists."
	],
	["unsupportedUrl", "This URL is not supported. You tried to enter: "],
	[
		"fileAlreadyExists",
		"Unable to create note. File already exists. Opening existing file.",
	],
	["commandId", "url-to-paper-note"],
	["commandName", "Create paper note from URL."],
	["inputLabel1", "Enter a valid URL."],
	["inputLabel2", "Here are some examples: "],
	["arXivRestAPI", "https://export.arxiv.org/api/query?id_list="],
	["aclAnthologyUrlExample", "https://aclanthology.org/2022.acl-long.1/"],
	["arXivUrlExample", "https://arxiv.org/abs/0000.00000"],
	["semanticScholarUrlExample", "https://www.semanticscholar.org/paper/some-text/0000.00000"],
	["inputPlaceholder", "https://my-url.com"],
	["arxivUrlSuffix", "arXiv:"],
	["aclAnthologyUrlSuffix", "ACL:"],
	["semanticScholarFields", "fields=authors,title,abstract,url,venue,year,publicationDate,externalIds"],
	["semanticScholarAPI", "https://api.semanticscholar.org/graph/v1/paper/"],
	["settingHeader", "Settings to create paper notes."],
	["settingFolderName", "Folder"],
	["settingFolderDesc", "Folder to create paper notes in."],
	["settingFolderRoot", "(root of the vault)"],
	["noticeRetrievingArxiv", "Retrieving paper information from arXiv API."],
	["noticeRetrievingSS", "Retrieving paper information from Semantic Scholar API."],
]);

function compressWhitespace(str: string): string {
	return str.replace(/\s+/g, " ").trim();
}

function trimString(str: string | null): string {
	if (str == null) return "";

	return compressWhitespace(str);
}

interface PaperNoteFillerPluginSettings {
	folderLocation: string;
}

export default class PaperNoteFillerPlugin extends Plugin {
	settings: PaperNoteFillerPluginSettings;

	async onload() {
		console.log("Loading Paper Note Filler plugin.");

		await this.loadSettings();

		this.addCommand({
			id: STRING_MAP.get("commandId")!,
			name: STRING_MAP.get("commandName")!,
			callback: () => {
				new urlModal(this.app, this.settings).open();
			},
		});

		this.addSettingTab(new SettingTab(this.app, this));
	}

	onunload() { }

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			await this.loadData()
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

class urlModal extends Modal {
	settings: PaperNoteFillerPluginSettings;

	constructor(app: App, settings: PaperNoteFillerPluginSettings) {
		super(app);
		this.settings = settings;
	}

	addTextElementToModal(type: keyof HTMLElementTagNameMap, value: string): void {
		const { contentEl } = this;
		contentEl.createEl(type, { text: value });
	}

	addInputElementToModal(type: keyof HTMLElementTagNameMap): any {
		const { contentEl } = this;
		let input = contentEl.createEl(type);
		return input;
	}

	addPropertyToElement(element: HTMLElement, property: string, value: string): void {
		element.setAttribute(property, value);
	}

	getIdentifierFromUrl(url: string): string {
		//if url ends in / remove it
		if (url.endsWith("/"))
			url = url.slice(0, -1);
		return url.split("/").slice(-1)[0];
	}

	buildNoteName(title: string): string {
		// No backslashes, forward slashes, or colons in filenames
    return title
        .replace(/[\/\\]/g, "_")
				// Replace "Foo: bar" with "Foo – bar" (em-dash)
        .replace(/: /g, " – ")
        .replace(/:/g, "-");
	}

	//both arxiv and aclanthology papers can be queried via the Semantic Scholar API
	extractFromSemanticScholar(url: string) {

		let id = this.getIdentifierFromUrl(url);
		console.log("paper id: " + id);

		let suffix = "INVALID";
		if (url.toLowerCase().includes("arxiv"))
			suffix = STRING_MAP.get("arxivUrlSuffix")!;
		else if (url.toLowerCase().includes("aclanthology"))
			suffix = STRING_MAP.get("aclAnthologyUrlSuffix")!;
		else if (url.toLowerCase().includes("semanticscholar"))
			suffix = "";
		else;

		if (suffix === "INVALID") {
			console.log("Invalid url: " + url);
			new Notice("Error: For now, only semanticscholar, arxiv and anthology URLs are supported.");
			return;
		}

		fetch(STRING_MAP.get("semanticScholarAPI")! + suffix + id + "?" + STRING_MAP.get("semanticScholarFields")!)
			.then((response) => response.text())
			.then(async (data) => {

				let json = JSON.parse(data);

				if (json.error != null) {
					new Notice("Error: " + json.error);
					return;
				}

				const title = compressWhitespace(json.title ?? 'undefined');
				let maybeAbstract: string | null = json.abstract ?? null;

				const authors = json.authors.map((author: any) => author.name);

				let maybeVenue: string | null = null;
				if (json.venue != null && json.venue != "") {
					maybeVenue = json.venue + " " + json.year;
				}

				let maybeDate: string | null = json.publicationDate ?? null;

				let basename = this.buildNoteName(title);
				const maybeAlias: string | null = basename !== title ? title : null;

				let semanticScholarURL = json.url;
				if (json["externalIds"] && json["externalIds"]["ArXiv"]) {
					semanticScholarURL += "\n" + "https://arxiv.org/abs/" + json.externalIds["ArXiv"];
				}
				if (json["externalIds"] && json["externalIds"]["ACL]"]) {
					semanticScholarURL += "\n" + "https://aclanthology.org/" + json.externalIds["ACL"];
				}

				let pathToFile = this.settings.folderLocation +
					path.sep +
					basename +
					".md";

				//notification if the file already exists
				if (await this.app.vault.adapter.exists(pathToFile)) {
					new Notice(
						STRING_MAP.get("fileAlreadyExists") + ""
					);
					this.app.workspace.openLinkText(
						pathToFile,
						pathToFile
					);
				} else {
					await this.app.vault.create(
							pathToFile,
							this.buildNoteBody(maybeAlias, authors, semanticScholarURL, null /* discoveredVia */, maybeVenue, maybeDate, maybeAbstract)
						)
						.then(() => {
							this.app.workspace.openLinkText(
								pathToFile,
								pathToFile
							);
						});
				}
			})
			.catch((error) => {
				//convert the Notice to a notice with a red background
				new Notice(STRING_MAP.get("error")!);

				console.log(error);
			})
			.finally(() => {
				this.close();
			});
	}

	// TODO(bts): take a params object
	buildNoteBody(
			maybeAlias: string | null,
			authors: string[],
			url: string,
			maybeDiscoveredVia: string | null,
			maybeVenue: string | null,
			maybeDate: string | null,
			maybeAbstract: string | null
	): string {
			const todayDatestamp = new Date().toISOString().split('T')[0];

			const frontmatter: any = {
					created_at: todayDatestamp,
					url,
					authors: authors.map((author: string) => `[[${author}]]`),
					tags: ['paper']
			};

			// Optional fields
			if (maybeAlias) frontmatter.alias = maybeAlias;
			if (maybeDiscoveredVia) frontmatter.discovered_via = maybeDiscoveredVia;
			if (maybeVenue) frontmatter.publication_venue = trimString(maybeVenue);
			if (maybeDate) frontmatter.date = maybeDate;

			const frontmatterYaml = yaml.dump(frontmatter, { lineWidth: -1 }).trim();

			return `---
${frontmatterYaml}
---
# Abstract
${maybeAbstract ? maybeAbstract.trim() : ''}

- - -

# Notes
`;
	}

	//if semantic scholar misses, we try arxiv
	extractFromArxiv(url: string) {

		let id = this.getIdentifierFromUrl(url);

		fetch(STRING_MAP.get("arXivRestAPI")! + id)
			.then((response) => response.text())
			.then(async (data) => {
				//parse the XML
				let parser = new DOMParser();
				let xmlDoc = parser.parseFromString(data, "text/xml");

				const title = compressWhitespace(xmlDoc.getElementsByTagName("title")[1].textContent ?? 'undefined');
				let maybeAbstract = xmlDoc.getElementsByTagName("summary")[0].textContent;
				const authorObjs = Array.from(xmlDoc.getElementsByTagName("author"));
				const authorNames: string[] = authorObjs
					.map((authorObj) => authorObj.getElementsByTagName("name")[0].textContent)
					.filter((maybeStr) => maybeStr !== null).map((authorName) => authorName!.trim());
				let maybeVenue = null;
				let maybeDate: string | null = xmlDoc.getElementsByTagName("published")[0].textContent;
				if (maybeDate) maybeDate = maybeDate.split("T")[0]; // datestamp

				const basename = this.buildNoteName(title);
				const maybeAlias: string | null = basename !== title ? title : null;

				let pathToFile = this.settings.folderLocation +
					path.sep +
					basename +
					".md";

				//notification if the file already exists
				if (await this.app.vault.adapter.exists(pathToFile)) {
					new Notice(
						STRING_MAP.get("fileAlreadyExists") + ""
					);
					this.app.workspace.openLinkText(
						pathToFile,
						pathToFile
					);
				} else {
					await this.app.vault.create(
							pathToFile,
							this.buildNoteBody(maybeAlias, authorNames, url, null /* discoveredVia */, maybeVenue, maybeDate, maybeAbstract)
						)
						.then(() => {
							this.app.workspace.openLinkText(
								pathToFile,
								pathToFile
							);
						});
				}
			})
			.catch((error) => {
				//convert the Notice to a notice with a red background
				new Notice(STRING_MAP.get("error")!);

				console.log(error);
			})
			.finally(() => {
				this.close();
			});
	}

	onOpen() {
		const { contentEl } = this;

		this.addTextElementToModal("h2", STRING_MAP.get("inputLabel1")!);
		this.addTextElementToModal("p", STRING_MAP.get("inputLabel2")!);
		this.addTextElementToModal("p", STRING_MAP.get("aclAnthologyUrlExample")!);
		this.addTextElementToModal("p", STRING_MAP.get("arXivUrlExample")!);
		this.addTextElementToModal("p", STRING_MAP.get("semanticScholarUrlExample")!);

		let input = this.addInputElementToModal("input");
		this.addPropertyToElement(input, "type", "search");
		this.addPropertyToElement(input, "placeholder", STRING_MAP.get("inputPlaceholder")!);
		this.addPropertyToElement(input, "minLength", STRING_MAP.get("inputPlaceholder")!);
		this.addPropertyToElement(input, "style", "width: 75%;");

		let extracting = false;

		contentEl.addEventListener("keydown", (event) => {
			if (event.key !== "Enter") return;

			//get the URL from the input field
			let url = input.value.trim().toLowerCase();

			if (!extracting) {
				extracting = true;
				console.log("HTTP request: " + url);

				if (url.includes("arxiv.org")) {
					new Notice(STRING_MAP.get("noticeRetrievingArxiv")!);
					this.extractFromArxiv(url);
				}
				else {
					new Notice(STRING_MAP.get("noticeRetrievingSS")!);
					this.extractFromSemanticScholar(url);
				}
			}
		});
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

class SettingTab extends PluginSettingTab {
	plugin: PaperNoteFillerPlugin;

	constructor(app: App, plugin: PaperNoteFillerPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		containerEl.createEl("h2", {
			text: STRING_MAP.get("settings"),
		});

		let folders = this.app.vault
			.getFiles()
			.map((file) => {
				let parts = file.path.split(path.sep);
				parts.pop(); //ignore the filename

				//now return all path combinations
				let res: string[] = [];
				for (let i = 0; i < parts.length; i++) {
					res.push(parts.slice(0, i + 1).join(path.sep));
				}
				return res;
			}
			)
			.flat()
			.filter((folder, index, self) => self.indexOf(folder) === index);

		let folderOptions: Record<string, string> = {};
		folders.forEach((record) => {
			folderOptions[record] = record;
		});

		//also add the root folder
		folderOptions[""] = STRING_MAP.get("settingFolderRoot")!;

		new Setting(containerEl)
			.setName(STRING_MAP.get("settingFolderName")!)
			.setDesc(STRING_MAP.get("settingFolderDesc")!)
			/* create dropdown menu with all folders currently in the vault */
			.addDropdown((dropdown) =>
				dropdown
					.addOptions(folderOptions)
					.setValue(this.plugin.settings.folderLocation)
					.onChange(async (value) => {
						this.plugin.settings.folderLocation = value;
						await this.plugin.saveSettings();
					})
			);
	}
}
