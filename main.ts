import {
	App,
	Modal,
	Notice,
	Plugin,
	PluginSettingTab,
	Setting,
	requestUrl,
} from "obsidian";
import * as yaml from 'js-yaml';

const DEFAULT_SETTINGS: PaperNoteFillerPluginSettings = {
	folderLocation: "Personal",
	downloadPdfs: true,
	pdfFolderLocation: "Personal/_pdfs",
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
	["inputLabel1", "Enter an arXiv URL."],
	["inputLabel2", "Here are some examples: "],
	["arXivRestAPI", "https://export.arxiv.org/api/query?id_list="],
	["arXivUrlExample", "https://arxiv.org/abs/0000.00000"],
	["inputPlaceholder", "https://my-url.com"],
	["settingHeader", "Settings to create paper notes."],
	["settingDownloadPdfs", "Download PDFs"],
	["settingDownloadPdfsDesc", "Whether to download PDFs"],
	["settingFolderName", "Folder"],
	["settingFolderDesc", "Folder to create paper notes in."],
	["settingFolderRoot", "(root of the vault)"],
	["settingPdfFolderName", "PDF Folder"],
	["settingPdfFolderDesc", "Folder to download PDFs to."],
	["noticeRetrievingArxiv", "Retrieving paper information from arXiv API."],
	["nonArxiv", "URL does not pertain to a paper from the arXiv."],
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
	downloadPdfs: boolean;
	pdfFolderLocation: string;
}

export default class PaperNoteFillerPlugin extends Plugin {
	settings: PaperNoteFillerPluginSettings;

	async onload() {
		console.log("Loading Add Paper plugin.");

		await this.loadSettings();

		this.addCommand({
			id: STRING_MAP.get("commandId")!,
			name: STRING_MAP.get("commandName")!,
			callback: async () => {
				console.log("Adding paper...");

				const url = await this.getClipboardContentAsUrl();

				const modal = new urlModal(this.app, this.settings);
				if (url != null) {
					modal.processUrl(url);
				} else {
					modal.open();
				}
			},
		});

		this.addSettingTab(new SettingTab(this.app, this));
	}

	onunload() { }

	async getClipboardContentAsUrl(): Promise<string | null> {
    try {
        const clipboardContent = await navigator.clipboard.readText();
        new URL(clipboardContent);
        return clipboardContent;
    } catch (error) {
        return null;
    }
	}

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
		const path = url.split("/").slice(-1)[0];

		if (path.endsWith(".pdf")) {
			return path.slice(0, -4);
		} else {
			return path;
		}
	}

	buildNoteName(title: string): string {
		// No backslashes, forward slashes, or colons in filenames
    return title
        .replace(/[\/\\]/g, "_")
				// Replace "Foo: bar" with "Foo – bar" (em-dash)
        .replace(/: /g, " – ")
        .replace(/:/g, "-");
	}

	async tryFetchPdf(basename: string, pdfUrl: string): Promise<string | null> {
		let pdfPath = this.settings.pdfFolderLocation + "/" + basename + ".pdf";

		if (this.app.vault.getAbstractFileByPath(pdfPath)) {
			new Notice("Reusing existing PDF: " + pdfPath);
			return pdfPath;
		} else {
			console.log("Downloading PDF from " + pdfUrl);

			const pdfResponse = await requestUrl(pdfUrl);
			const pdfBlob = await pdfResponse.arrayBuffer;

			await this.app.vault.createBinary(pdfPath, pdfBlob);
			return pdfPath;
		}
	}

	// TODO(bts): take a params object
	buildNoteBody(
			maybeAlias: string | null,
			authors: string[],
			url: string,
			maybeDiscoveredVia: string | null,
			maybeVenue: string | null,
			maybeDate: string | null,
			maybeAbstract: string | null,
			maybePdfPath: string | null,
	): string {
			const todayDatestamp = new Date().toISOString().split('T')[0];

			const frontmatter: any = {
					created_at: todayDatestamp,
					url,
					authors: authors.map((author: string) => `[[${author}]]`),
					tags: ['paper'],
					artifacts: maybePdfPath ? [`[[${maybePdfPath}|pdf]]`] : [],
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

	extractFromArxiv(rawUrl: string) {
		let id = this.getIdentifierFromUrl(rawUrl);
		const url = STRING_MAP.get("arXivRestAPI")! + id;

		console.log("fetching from API: " + url);

		fetch(url)
			.then((response) => {
				if (!response.ok) {
						throw new Error(`HTTP error: status ${response.status}`);
				}
				return response.text();
			})
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

				const linkObjs = Array.from(xmlDoc.getElementsByTagName("link"));
				let pdfLinks = linkObjs.filter((linkObj) => linkObj.getAttribute("title") === "pdf");
				let maybePdfUrl = null;
				if (pdfLinks.length > 0) {
					const rawUrl = pdfLinks[0].getAttribute("href");
					if (rawUrl !== null) {
						// Arxiv URLs are HTTP, but we need to force https on iOS
						maybePdfUrl = rawUrl.replace(/^http:/, 'https:');
					}
				}

				let maybeVenue = null;
				let maybeDate: string | null = xmlDoc.getElementsByTagName("published")[0].textContent;
				if (maybeDate) maybeDate = maybeDate.split("T")[0]; // datestamp

				const basename = this.buildNoteName(title);
				const maybeAlias: string | null = basename !== title ? title : null;

				let pathToFile = this.settings.folderLocation + "/" + basename + ".md";

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
					let maybePdfPath = null;
					if (this.settings.downloadPdfs) {
						if (maybePdfUrl !== null) {
							maybePdfPath = await this.tryFetchPdf(basename, maybePdfUrl);
						} else {
							console.log("Skipping PDF download; no PDF URL found.");
						}
					}

					await this.app.vault.create(
							pathToFile,
							this.buildNoteBody(maybeAlias, authorNames, url, null /* discoveredVia */, maybeVenue, maybeDate, maybeAbstract, maybePdfPath)
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
				new Notice(STRING_MAP.get("error")!);

				console.error("Error message:", error.message);
				console.error("Error stack:", error.stack);
				console.error(error);
			})
			.finally(() => {
				this.close();
			});
	}

	processUrl(url: string) {
		if (url.includes("arxiv.org")) {
			new Notice(STRING_MAP.get("noticeRetrievingArxiv")!);
			this.extractFromArxiv(url);
		} else {
			new Notice(STRING_MAP.get("nonArxiv")!);
		}
	}

	onOpen() {
		const { contentEl } = this;

		this.addTextElementToModal("h2", STRING_MAP.get("inputLabel1")!);
		this.addTextElementToModal("p", STRING_MAP.get("inputLabel2")!);
		this.addTextElementToModal("p", STRING_MAP.get("arXivUrlExample")!);

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

				this.processUrl(url);
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
				let parts = file.path.split("/");
				parts.pop(); //ignore the filename

				//now return all path combinations
				let res: string[] = [];
				for (let i = 0; i < parts.length; i++) {
					res.push(parts.slice(0, i + 1).join("/"));
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

		new Setting(containerEl)
			.setName(STRING_MAP.get("settingDownloadPdfs")!)
			.setDesc(STRING_MAP.get("settingDownloadPdfsDesc")!)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.downloadPdfs)
					.onChange(async (value) => {
						this.plugin.settings.downloadPdfs = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName(STRING_MAP.get("settingPdfFolderName")!)
			.setDesc(STRING_MAP.get("settingPdfFolderDesc")!)
			/* create dropdown menu with all folders currently in the vault */
			.addDropdown((dropdown) =>
				dropdown
					.addOptions(folderOptions)
					.setValue(this.plugin.settings.pdfFolderLocation)
					.onChange(async (value) => {
						this.plugin.settings.pdfFolderLocation = value;
						await this.plugin.saveSettings();
					})
			);

	}
}
