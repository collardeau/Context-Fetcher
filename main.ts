import {
	App,
	Editor,
	MarkdownView,
	Modal,
	Notice,
	Plugin,
	PluginSettingTab,
	Setting,
	TFile,
	moment,
} from "obsidian";

// Settings interfaces remain the same
interface MyPluginSettings {
	exportFolderName: string;
	includePrivacyLevels: string[];
}

const DEFAULT_SETTINGS: MyPluginSettings = {
	exportFolderName: "ContextExports",
	includePrivacyLevels: ["public"],
};

export default class MyPlugin extends Plugin {
	settings: MyPluginSettings;

	async onload() {
		console.log("Loading Context Fetcher plugin");
		await this.loadSettings();

		this.addCommand({
			id: "create-context-file",
			name: "Create Context File from Current Note + Links",
			callback: async () => {
				await this.createContextFile();
			},
		});

		this.addSettingTab(new ContextSettingTab(this.app, this));
	}

	onunload() {
		console.log("Unloading Context Fetcher plugin");
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

	// Helper to truncate content after first '---' (Unchanged)
	private truncateContentAfterFirstSeparator(fullContent: string): string {
		let contentStartIndex = 0;
		const frontmatterSeparator = "---\n";
		if (fullContent.startsWith(frontmatterSeparator)) {
			const endFrontmatterIndex = fullContent.indexOf(
				frontmatterSeparator,
				frontmatterSeparator.length
			);
			if (endFrontmatterIndex !== -1) {
				contentStartIndex =
					endFrontmatterIndex + frontmatterSeparator.length;
			} else {
				console.warn("Malformed frontmatter detected...");
			}
		}
		const separatorRegex = /^\s*---\s*$/m;
		const contentBody = fullContent.substring(contentStartIndex);
		const match = separatorRegex.exec(contentBody);
		return match
			? contentBody.substring(0, match.index).trim()
			: contentBody.trim();
	}

	// Helper to remove wiki-links (Unchanged)
	private removeWikiLinks(text: string): string {
		return text.replace(/\[\[(?:[^|\]]+\|)?([^\]]+)\]\]/g, "$1");
	}

	async createContextFile() {
		const activeFile = this.app.workspace.getActiveFile();

		if (!activeFile || activeFile.extension !== "md") {
			new Notice("Please open a Markdown note first.");
			return;
		}

		new Notice(`Creating context file for ${activeFile.basename}...`);

		let combinedContent = `# Context Export\n\n## Source Note: ${activeFile.basename}\n\n`;
		let sourceContentFull = "";

		// 1. Process source note
		try {
			sourceContentFull = await this.app.vault.read(activeFile);
			const truncatedSourceContent =
				this.truncateContentAfterFirstSeparator(sourceContentFull);
			const cleanedSourceContent = this.removeWikiLinks(
				truncatedSourceContent
			);
			combinedContent += `### Content:\n${cleanedSourceContent}\n\n---\n`;
		} catch (err) {
			console.error(`Error reading source file ${activeFile.path}:`, err);
			new Notice(`Error reading source file: ${activeFile.basename}`);
			return;
		}

		combinedContent += `## Linked Notes (Level 1):\n`;

		// 2. Get outgoing links
		const resolvedLinks =
			this.app.metadataCache.resolvedLinks[activeFile.path];

		if (!resolvedLinks || Object.keys(resolvedLinks).length === 0) {
			combinedContent += "\n*No outgoing links found or resolved.*\n";
		} else {
			const linkedFilePaths = Object.keys(resolvedLinks);
			let includedLinksCount = 0;

			// 3. Iterate through links and apply *only* the privacy filter
			for (const linkedPath of linkedFilePaths) {
				const linkedFile =
					this.app.vault.getAbstractFileByPath(linkedPath);

				// Basic check: Is it a valid Markdown file?
				if (
					!(linkedFile instanceof TFile) ||
					linkedFile.extension !== "md"
				) {
					console.log(`Skipping non-markdown link: ${linkedPath}`);
					continue;
				}

				// --- SIMPLIFIED FILTERING: ONLY CHECK PRIVACY ---
				try {
					const fileCache =
						this.app.metadataCache.getFileCache(linkedFile);
					const frontmatter = fileCache?.frontmatter;
					const privacy = frontmatter?.privacy?.toLowerCase(); // Read privacy, make lowercase

					// Check if the note's privacy level is in the allowed list from settings
					if (
						!privacy ||
						!this.settings.includePrivacyLevels
							.map((p) => p.toLowerCase())
							.includes(privacy)
					) {
						console.log(
							`Skipping link due to privacy: ${
								linkedFile.basename
							} (privacy: ${privacy || "none"})`
						);
						continue; // Skip if privacy doesn't match allowed levels
					}
					// If it passes the privacy check, proceed.
					console.log(
						`Including link: ${linkedFile.basename} (passed privacy check)`
					);
				} catch (err) {
					console.error(
						`Error accessing metadata for ${linkedFile.path}:`,
						err
					);
					continue; // Skip if metadata access fails
				}
				// --- END OF SIMPLIFIED FILTERING ---

				// If it passed filters, get content, truncate, and clean
				try {
					const linkedContentFull = await this.app.vault.read(
						linkedFile
					);
					const truncatedLinkedContent =
						this.truncateContentAfterFirstSeparator(
							linkedContentFull
						);
					const cleanedLinkedContent = this.removeWikiLinks(
						truncatedLinkedContent
					);
					combinedContent += `\n### From: ${linkedFile.basename}\n\n${cleanedLinkedContent}\n\n---\n`;
					includedLinksCount++;
				} catch (err) {
					console.error(
						`Error reading linked file ${linkedFile.path}:`,
						err
					);
					combinedContent += `\n### From: ${linkedFile.basename}\n\n*Error reading file content.*\n\n---\n`;
				}
			} // End of for loop

			if (includedLinksCount === 0 && linkedFilePaths.length > 0) {
				combinedContent += "\n*No links included after filtering.*\n";
			}
		}

		// 4. Create the new file (Logic unchanged)
		const timestamp = moment().format("YYYYMMDD-HHmmss");
		const newFileName = `Context-${activeFile.basename}-${timestamp}.md`;
		const exportFolderPath = this.settings.exportFolderName;

		try {
			if (!(await this.app.vault.adapter.exists(exportFolderPath))) {
				await this.app.vault.createFolder(exportFolderPath);
			}
			const createdFile = await this.app.vault.create(
				`${exportFolderPath}/${newFileName}`,
				combinedContent
			);
			new Notice(`Context file created: ${createdFile.basename}`);
		} catch (err) {
			console.error("Error creating context file:", err);
			new Notice("Error creating context file. Check console.");
		}
	}
}

// Settings Tab Class remains the same
class ContextSettingTab extends PluginSettingTab {
	plugin: MyPlugin;

	constructor(app: App, plugin: MyPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		// ... settings display logic remains the same ...
		const { containerEl } = this;
		containerEl.empty();
		containerEl.createEl("h2", { text: "Context Fetcher Settings" });

		new Setting(containerEl)
			.setName("Export Folder Name") // ... etc ...
			.setDesc("The folder where context files will be saved.")
			.addText((text) =>
				text
					.setPlaceholder("e.g., ContextExports")
					.setValue(this.plugin.settings.exportFolderName)
					.onChange(async (value) => {
						this.plugin.settings.exportFolderName = value.trim();
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Include Privacy Levels") // ... etc ...
			.setDesc(
				"Comma-separated list of privacy frontmatter values to include (e.g., public, personal). Case-insensitive."
			)
			.addText((text) =>
				text
					.setPlaceholder("public, personal")
					.setValue(
						this.plugin.settings.includePrivacyLevels.join(", ")
					)
					.onChange(async (value) => {
						this.plugin.settings.includePrivacyLevels = value
							.split(",")
							.map((p) => p.trim())
							.filter((p) => p.length > 0);
						await this.plugin.saveSettings();
					})
			);
	}
}
