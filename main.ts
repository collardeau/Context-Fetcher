import {
	App,
	// Editor, // No longer needed in this snippet
	// MarkdownView, // No longer needed in this snippet
	// Modal, // No longer needed in this snippet
	Notice,
	Plugin,
	PluginSettingTab,
	Setting,
	TFile,
	moment,
	parseFrontMatterEntry,
} from "obsidian";

// Settings interfaces remain the same
interface MyPluginSettings {
	exportFolderName: string;
	includePrivacyLevels: string[];
	linkDepth: number;
}

// Default settings remain the same
const DEFAULT_SETTINGS: MyPluginSettings = {
	exportFolderName: "ContextExports",
	includePrivacyLevels: ["public"],
	linkDepth: 1,
};

export default class MyPlugin extends Plugin {
	settings: MyPluginSettings;

	async onload() {
		console.log("Loading Context Fetcher plugin");
		await this.loadSettings();

		this.addCommand({
			id: "create-context-file",
			name: "Create Context File from Current Note + Links (Configurable Depth)",
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
		// Ensure linkDepth is a positive integer >= 1 on load
		this.settings.linkDepth = Math.max(
			1,
			Math.floor(this.settings.linkDepth) || 1
		);
		// Ensure privacy levels are lowercase and trimmed on load
		this.settings.includePrivacyLevels = (
			this.settings.includePrivacyLevels || []
		)
			.map((p) => (typeof p === "string" ? p.trim().toLowerCase() : ""))
			.filter((p) => p.length > 0);
	}

	async saveSettings() {
		// Ensure linkDepth is saved as a positive integer >= 1
		this.settings.linkDepth = Math.max(
			1,
			Math.floor(this.settings.linkDepth) || 1
		);
		// Ensure privacy levels are lowercase and trimmed on save
		this.settings.includePrivacyLevels = (
			this.settings.includePrivacyLevels || []
		)
			.map((p) => (typeof p === "string" ? p.trim().toLowerCase() : ""))
			.filter((p) => p.length > 0);
		await this.saveData(this.settings);
	}

	// Helper to truncate content after first '---' (Unchanged)
	private truncateContentAfterFirstSeparator(fullContent: string): string {
		let contentStartIndex = 0;
		const frontmatterSeparator = "---\n";
		// Correctly handle files starting with frontmatter
		if (fullContent.startsWith(frontmatterSeparator)) {
			const endFrontmatterIndex = fullContent.indexOf(
				frontmatterSeparator,
				frontmatterSeparator.length // Start searching *after* the first separator
			);
			if (endFrontmatterIndex !== -1) {
				// Content starts after the *second* separator
				contentStartIndex =
					endFrontmatterIndex + frontmatterSeparator.length;
			} else {
				// Malformed frontmatter (only one separator found at the start)
				// Treat the whole file as content, assuming the separator was intended as content
				contentStartIndex = 0; // Reset to start
				console.warn(
					"Possible malformed frontmatter (only one '---' found at start). Processing entire file content."
				);
			}
		} else {
			// No frontmatter detected at the start
			contentStartIndex = 0;
		}

		const separatorRegex = /^\s*---\s*$/m; // Regex for '---' on its own line, potentially with whitespace
		const contentBody = fullContent.substring(contentStartIndex);
		const match = separatorRegex.exec(contentBody); // Find the first standalone '---' in the body

		// Return content before the separator, or the whole body if no separator found
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

		const maxDepth = this.settings.linkDepth;
		new Notice(
			`Creating context file for ${activeFile.basename} (Depth: ${maxDepth})...`
		);

		let combinedContent = `# Context Export (Depth ${maxDepth})\n\n## Source Note: ${activeFile.basename}\n\n`;

		// 1. Process source note
		try {
			const sourceContentFull = await this.app.vault.read(activeFile);
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

		combinedContent += `## Linked Notes (Up to Depth ${maxDepth}):\n`;

		const visitedPaths = new Set<string>();
		visitedPaths.add(activeFile.path);

		const queue: { path: string; depth: number }[] = [];
		let includedLinksCount = 0;
		let processedLinkCandidates = 0; // Counter for debugging/info

		// Get initial links (Depth 1)
		const initialLinks =
			this.app.metadataCache.resolvedLinks[activeFile.path] ?? {};
		for (const linkedPath in initialLinks) {
			if (!visitedPaths.has(linkedPath)) {
				queue.push({ path: linkedPath, depth: 1 });
			}
		}

		// Process the queue using Breadth-First Search (BFS)
		while (queue.length > 0) {
			const { path: currentPath, depth } = queue.shift()!;
			processedLinkCandidates++;

			if (visitedPaths.has(currentPath)) {
				// console.debug(`Skipping already visited: ${currentPath}`);
				continue;
			}
			// We check depth *after* checking visitedPaths, because a node might be reachable
			// at different depths. We process it the first time we encounter it (BFS ensures this is the shallowest depth).
			if (depth > maxDepth) {
				// console.debug(`Skipping due to depth limit (${depth} > ${maxDepth}): ${currentPath}`);
				continue;
			}

			visitedPaths.add(currentPath); // Mark as visited *now*

			const linkedFile =
				this.app.vault.getAbstractFileByPath(currentPath);

			if (
				!(linkedFile instanceof TFile) ||
				linkedFile.extension !== "md"
			) {
				console.log(
					`Skipping non-markdown link: ${currentPath} at depth ${depth}`
				);
				continue;
			}

			// --- Filtering: Check Privacy ---
			let passesFilter = false;
			let privacyValue: string | undefined = undefined; // Store the found privacy value for logging
			try {
				const fileCache =
					this.app.metadataCache.getFileCache(linkedFile);
				const frontmatter = fileCache?.frontmatter;
				const privacyRaw = parseFrontMatterEntry(
					frontmatter,
					"privacy"
				); // Use safe Obsidian API
				privacyValue =
					typeof privacyRaw === "string"
						? privacyRaw.trim().toLowerCase()
						: undefined;

				const allowedPrivacyLevels = this.settings.includePrivacyLevels; // Already lowercased in settings logic

				if (
					privacyValue &&
					allowedPrivacyLevels.includes(privacyValue)
				) {
					// Case 1: Note has privacy and it's in the allowed list
					passesFilter = true;
					console.log(
						`Including link: ${linkedFile.basename} (Depth ${depth}, Privacy: ${privacyValue})`
					);
				} else if (
					!privacyValue &&
					allowedPrivacyLevels.includes("none")
				) {
					// Case 2: Note has no privacy key, and "none" is explicitly allowed
					passesFilter = true;
					console.log(
						`Including link: ${linkedFile.basename} (Depth ${depth}, Privacy: none/missing, allowed by 'none' setting)`
					);
				} else {
					// Case 3: Note has privacy but it's not allowed, OR note has no privacy and 'none' is not allowed.
					passesFilter = false;
					console.log(
						`Skipping link: ${
							linkedFile.basename
						} (Depth ${depth}, Privacy: ${
							privacyValue ?? "none/missing"
						}, Allowed: [${allowedPrivacyLevels.join(", ")}])`
					);
				}
			} catch (err) {
				console.error(
					`Error accessing metadata for ${linkedFile.path}:`,
					err
				);
				passesFilter = false; // Don't include if metadata fails
				console.log(
					`Skipping link due to metadata error: ${linkedFile.basename} (Depth ${depth})`
				);
			}
			// --- End of Filtering ---

			if (!passesFilter) {
				continue; // Skip if filters failed
			}

			// --- Process Content and Add to Output ---
			try {
				const linkedContentFull = await this.app.vault.read(linkedFile);
				const truncatedLinkedContent =
					this.truncateContentAfterFirstSeparator(linkedContentFull);
				const cleanedLinkedContent = this.removeWikiLinks(
					truncatedLinkedContent
				);

				combinedContent += `\n### From: ${linkedFile.basename} (Depth ${depth})\n\n${cleanedLinkedContent}\n\n---\n`;
				includedLinksCount++;

				// --- Enqueue deeper links if not at max depth ---
				// Note: We enqueue even if the *next* level is > maxDepth. The check at the start
				// of the loop will handle skipping them correctly. This is slightly simpler.
				// We only enqueue if depth < maxDepth to prevent unnecessary processing.
				if (depth < maxDepth) {
					const nextLevelLinks =
						this.app.metadataCache.resolvedLinks[linkedFile.path] ??
						{};
					for (const nextPath in nextLevelLinks) {
						// Add to queue only if not already visited *or* currently in the queue
						// The visitedPaths check at the top of the loop handles cycles/duplicates.
						if (!visitedPaths.has(nextPath)) {
							// console.debug(`Enqueuing: ${nextPath} at depth ${depth + 1} from ${linkedFile.basename}`);
							queue.push({ path: nextPath, depth: depth + 1 });
						}
					}
				}
				// --- End Enqueue ---
			} catch (err) {
				console.error(
					`Error reading linked file ${linkedFile.path}:`,
					err
				);
				combinedContent += `\n### From: ${linkedFile.basename} (Depth ${depth})\n\n*Error reading file content.*\n\n---\n`;
			}
		} // End of while loop

		console.log(
			`Processed ${processedLinkCandidates} link candidates, included ${includedLinksCount} notes.`
		);

		if (includedLinksCount === 0) {
			if (Object.keys(initialLinks).length > 0) {
				combinedContent +=
					"\n*No linked notes included after filtering or reaching max depth.*\n";
			} else {
				combinedContent +=
					"\n*No outgoing links found in the source note.*\n";
			}
		}

		// 4. Create the new file
		const timestamp = moment().format("YYYYMMDD-HHmmss");
		const newFileName = `Context-${activeFile.basename}-${timestamp}.md`;
		const exportFolderPath = this.settings.exportFolderName.replace(
			/^\/+|\/+$/g,
			""
		); // Trim slashes just in case

		// Check if folder path is empty after trimming, use root if so
		const parentFolder = exportFolderPath ? exportFolderPath + "/" : "";
		const filePath = `${parentFolder}${newFileName}`;

		try {
			// Ensure export folder exists if specified
			if (exportFolderPath) {
				const folderExists = await this.app.vault.adapter.exists(
					exportFolderPath
				);
				if (!folderExists) {
					console.log(`Creating export folder: ${exportFolderPath}`);
					await this.app.vault.createFolder(exportFolderPath);
				} else {
					const stats = await this.app.vault.adapter.stat(
						exportFolderPath
					);
					if (!stats || stats.type !== "folder") {
						new Notice(
							`Error: Export path "${exportFolderPath}" exists but is not a folder.`,
							10000
						);
						console.error(
							`Export path "${exportFolderPath}" exists but is not a folder.`
						);
						return; // Stop execution
					}
				}
			}

			console.log(`Attempting to create context file: ${filePath}`);
			const createdFile = await this.app.vault.create(
				filePath,
				combinedContent
			);
			new Notice(`Context file created: ${createdFile.basename}`);
			// Optional: Open the created file
			// await this.app.workspace.openLinkText(createdFile.path, '', false);
		} catch (err) {
			// Provide more specific error feedback if possible
			if (err.message && err.message.includes("File already exists")) {
				new Notice(
					`Error: File "${newFileName}" already exists in "${
						exportFolderPath || "vault root"
					}".`,
					10000
				);
			} else {
				new Notice(
					"Error creating context file. Check console for details.",
					10000
				);
			}
			console.error("Error creating context file:", err);
		}
	}
}

class ContextSettingTab extends PluginSettingTab {
	plugin: MyPlugin;

	constructor(app: App, plugin: MyPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.createEl("h2", { text: "Context Fetcher Settings" });

		new Setting(containerEl)
			.setName("Export Folder Name")
			.setDesc(
				"The folder where context files will be saved (relative to vault root). Leave empty to save in the vault root."
			) // CHANGED: Clarified empty behavior
			.addText((text) =>
				text
					.setPlaceholder("e.g., ContextExports (optional)")
					.setValue(this.plugin.settings.exportFolderName)
					.onChange(async (value) => {
						this.plugin.settings.exportFolderName = value.trim(); // Allow empty string
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Include Privacy Levels")
			// CHANGED: Updated description to be clearer about 'none'
			.setDesc(
				"Comma-separated list of frontmatter `privacy` values to include (case-insensitive). Notes matching these values will be included. Add the special value 'none' to also include notes *without* any `privacy` key."
			)
			.addText((text) =>
				text
					.setPlaceholder("public, none") // CHANGED: Better placeholder example
					.setValue(
						this.plugin.settings.includePrivacyLevels.join(", ")
					)
					.onChange(async (value) => {
						this.plugin.settings.includePrivacyLevels = value
							.split(",")
							.map((p) => p.trim().toLowerCase()) // Ensure lowercase and trim
							.filter((p) => p.length > 0); // Remove empty entries
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Link Depth")
			.setDesc(
				"How many levels of links to follow (1 = direct links only, 2 = links and links-of-links, etc.). Must be 1 or greater."
			) // CHANGED: Clarified description
			.addText((text) =>
				text
					.setPlaceholder("1")
					.setValue(this.plugin.settings.linkDepth.toString())
					.onChange(async (value) => {
						const potentialDepth = value.trim();
						if (potentialDepth === "") {
							// Allow empty input temporarily, but don't save invalid state
							// The saved value will be clamped later in saveSettings if needed
							// We just update the internal *intended* value for now if it parses
							const maybeNum = parseInt(potentialDepth, 10);
							if (!isNaN(maybeNum)) {
								this.plugin.settings.linkDepth = maybeNum;
							}
							// Don't force setValue back here
						} else {
							const depth = parseInt(potentialDepth, 10);
							// Update setting immediately if valid number, clamping happens on save
							if (!isNaN(depth)) {
								this.plugin.settings.linkDepth = depth; // Store potentially invalid value temporarily
							} else {
								// If input is not a number (e.g., "abc"), maybe revert? Or just let save handle it.
								// Let's rely on saveSettings for clamping >= 1.
								// We could show an error here if desired.
							}
						}
						// No text.setValue here - allows user to type '0' or clear the field
						await this.plugin.saveSettings(); // Save will clamp to >= 1
						// OPTIONAL: If you *want* to force the display to update to the clamped value
						// *after* saving, uncomment the line below. But this might still feel jumpy.
						// text.setValue(this.plugin.settings.linkDepth.toString());
					})
			);
	}
}
