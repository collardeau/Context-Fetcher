import {
	App,
	Notice,
	Plugin,
	PluginSettingTab,
	Setting,
	TFile,
	moment,
	parseFrontMatterEntry,
	CachedMetadata,
	getAllTags,
} from "obsidian";

// Settings Interface and Defaults
interface MyPluginSettings {
	exportFolderName: string;
	includePrivacyLevels: string[];
	linkDepth: number;
	targetTags: string[];
}
const DEFAULT_SETTINGS: MyPluginSettings = {
	exportFolderName: "ContextExports",
	includePrivacyLevels: ["public"],
	linkDepth: 1,
	targetTags: [],
};

export default class MyPlugin extends Plugin {
	settings: MyPluginSettings;

	async onload() {
		console.log("Loading Context Fetcher plugin");
		await this.loadSettings(); // Load settings first

		// Add Commands
		this.addCommand({
			id: "create-context-file",
			name: "Create Context File (Links filtered by Privacy & Optional Tags)",
			callback: async () => {
				await this.createContextFile();
			},
		});
		this.addCommand({
			id: "open-context-fetcher-settings",
			name: "Open Context Fetcher Settings",
			callback: () => {
				(this.app as any).setting.open();
				(this.app as any).setting.openTabById(this.manifest.id);
			},
		});

		// Add Settings Tab
		this.addSettingTab(new ContextSettingTab(this.app, this));

		// Add Ribbon Icon
		this.addRibbonIcon(
			"filter",
			"Open Context Fetcher Settings",
			(evt: MouseEvent) => {
				(this.app as any).setting.open();
				(this.app as any).setting.openTabById(this.manifest.id);
			}
		);

		console.log("Context Fetcher plugin loaded and ready.");
	}

	onunload() {
		console.log("Unloading Context Fetcher plugin");
	}

	// --- Settings Management ---
	// Restore clamping/normalization here for robustness
	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			await this.loadData()
		);
		// Clamp/normalize loaded data
		this.settings.linkDepth = Math.max(
			1,
			Math.floor(this.settings.linkDepth) || 1
		); // Ensure >= 1
		this.settings.includePrivacyLevels = (
			this.settings.includePrivacyLevels || []
		)
			.map((p) => (typeof p === "string" ? p.trim().toLowerCase() : ""))
			.filter((p) => p.length > 0);
		this.settings.targetTags = (this.settings.targetTags || [])
			.map((t) =>
				typeof t === "string"
					? t.trim().toLowerCase().replace(/^#/, "")
					: ""
			)
			.filter((t) => t.length > 0);
		console.log(
			"[Settings] Loaded and normalized:",
			JSON.stringify(this.settings)
		);
	}

	async saveSettings() {
		// Ensure settings are clamped/normalized *before* saving
		this.settings.linkDepth = Math.max(
			1,
			Math.floor(this.settings.linkDepth) || 1
		); // Ensure >= 1
		this.settings.includePrivacyLevels = (
			this.settings.includePrivacyLevels || []
		)
			.map((p) => (typeof p === "string" ? p.trim().toLowerCase() : ""))
			.filter((p) => p.length > 0);
		this.settings.targetTags = (this.settings.targetTags || [])
			.map((t) =>
				typeof t === "string"
					? t.trim().toLowerCase().replace(/^#/, "")
					: ""
			)
			.filter((t) => t.length > 0);

		console.log(
			"[Settings] Saving clamped/normalized settings:",
			JSON.stringify(this.settings)
		);
		await this.saveData(this.settings);
	}

	// --- Content Helpers ---
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
				contentStartIndex = 0; /* Malformed */
			}
		} else {
			contentStartIndex = 0;
		}
		const separatorRegex = /^\s*---\s*$/m;
		const contentBody = fullContent.substring(contentStartIndex);
		const match = separatorRegex.exec(contentBody);
		return match
			? contentBody.substring(0, match.index).trim()
			: contentBody.trim();
	}
	private removeWikiLinks(text: string): string {
		return text.replace(/\[\[(?:[^|\]]+\|)?([^\]]+)\]\]/g, "$1");
	}

	// --- Combined Filter Helper ---
	private passesFilters(file: TFile, cache: CachedMetadata | null): boolean {
		if (!cache) return false;
		const targetTags = this.settings.targetTags;
		const mustCheckTags = targetTags.length > 0;
		const frontmatter = cache.frontmatter;
		const privacyRaw = parseFrontMatterEntry(frontmatter, "privacy");
		const privacyValue =
			typeof privacyRaw === "string"
				? privacyRaw.trim().toLowerCase()
				: undefined;
		const allowedPrivacyLevels = this.settings.includePrivacyLevels;
		let passesPrivacy = false;
		if (privacyValue && allowedPrivacyLevels.includes(privacyValue)) {
			passesPrivacy = true;
		} else if (!privacyValue && allowedPrivacyLevels.includes("none")) {
			passesPrivacy = true;
		}
		if (!passesPrivacy) {
			return false;
		}
		if (mustCheckTags) {
			const fileTagsRaw = getAllTags(cache) ?? [];
			const fileTags = fileTagsRaw.map((tag) =>
				tag.substring(1).toLowerCase()
			);
			const hasMatchingTag = fileTags.some((fileTag) =>
				targetTags.includes(fileTag)
			);
			if (!hasMatchingTag) {
				return false;
			}
		}
		return true;
	}

	// --- Helper: Process Single Note ---
	private async processAndAddNoteContent(
		file: TFile,
		depth: number,
		isSourceNote: boolean,
		combinedContentRef: { content: string }, // Pass by reference object
		contentIncludedPaths: Set<string>
	): Promise<boolean> {
		// Returns true if content was included based on filters, false otherwise
		// Avoid adding content twice if reached via different paths (BFS ensures shortest path first)
		// We only check inclusion based on filters here.
		if (contentIncludedPaths.has(file.path)) {
			return true; // Already included, counts as "passed filters" for summary purposes
		}

		const cache = this.app.metadataCache.getFileCache(file);
		const passesFilters = this.passesFilters(file, cache);
		let included = false;

		const titlePrefix = isSourceNote ? "Source Note" : "Linked Note";
		const depthString = isSourceNote ? "" : ` (Depth ${depth})`;
		let noteOutput = "";

		if (passesFilters) {
			try {
				const fullContent = await this.app.vault.read(file);
				const truncatedContent =
					this.truncateContentAfterFirstSeparator(fullContent);
				const cleanedContent = this.removeWikiLinks(truncatedContent);
				noteOutput = `\n## ${titlePrefix}: ${file.basename}${depthString}\n\n### Content:\n${cleanedContent}\n\n---\n`;
				contentIncludedPaths.add(file.path); // Mark content as added
				included = true;
				console.log(
					`[Depth ${depth}] Included Content: ${file.basename}`
				);
			} catch (err) {
				console.error(`Error reading file ${file.path}:`, err);
				noteOutput = `\n## ${titlePrefix}: ${file.basename}${depthString}\n\n*Error reading file content.*\n\n---\n`;
				// Don't mark as included if read error
			}
		} else {
			noteOutput = `\n## ${titlePrefix}: ${file.basename}${depthString}\n\n*Note content skipped (Filters).*\n\n---\n`;
			console.log(
				`[Depth ${depth}] Skipped Content: ${file.basename} (Filters)`
			);
		}

		combinedContentRef.content += noteOutput;
		return passesFilters; // Return if it passed filters, regardless of read errors
	}

	// --- CORE LOGIC: Unified Function ---
	// WITH EXTRA LOGGING AND CHECKS
	async createContextFile() {
		const activeFile = this.app.workspace.getActiveFile();
		if (!activeFile || activeFile.extension !== "md") {
			new Notice("Please open a Markdown note first.");
			return;
		}

		// *** VERIFY maxDepth VALUE ***
		const maxDepth = this.settings.linkDepth;
		console.log(
			`[Start] Running createContextFile. Settings -> maxDepth = ${maxDepth}`
		);
		if (typeof maxDepth !== "number" || isNaN(maxDepth) || maxDepth < 1) {
			console.error(
				`[Start] Invalid maxDepth detected: ${maxDepth}. Aborting.`
			);
			new Notice(
				`Error: Invalid Link Depth setting (${maxDepth}). Please set it to 1 or greater.`
			);
			return;
		}

		const targetTags = this.settings.targetTags;
		const checkTags = targetTags.length > 0;

		// --- Initial Setup ---
		let noticeMsg = `Creating context from ${activeFile.basename} + Links (Max Depth: ${maxDepth})`;
		if (checkTags)
			noticeMsg += ` (Filtering Notes by Tags: #${targetTags.join(
				", #"
			)})`;
		new Notice(noticeMsg + "...", 5000);

		let combinedContentObj = { content: "" }; // Use object for pass-by-reference
		combinedContentObj.content = `# Context Export\n\n`;
		combinedContentObj.content += `* Source Note: ${activeFile.basename}\n`;
		combinedContentObj.content += `* Link Depth Setting: ${maxDepth}\n`;
		combinedContentObj.content += `* Privacy Levels Included: ${
			this.settings.includePrivacyLevels.join(", ") || "none"
		}\n`;
		combinedContentObj.content += `* Required Tags for Inclusion: ${
			checkTags ? targetTags.map((t) => `#${t}`).join(", ") : "None"
		}\n`;
		combinedContentObj.content += `\n---\n`;

		const contentIncludedPaths = new Set<string>(); // Tracks paths whose *content* has been added
		const traversalVisitedPaths = new Set<string>(); // Tracks paths visited during BFS traversal
		let includedNotesCount = 0; // Counts notes whose *content* was included
		let iteration = 0;

		// --- Part 1: Process Active Note ---
		const activeNotePassedFilters = await this.processAndAddNoteContent(
			activeFile,
			0, // Depth 0
			true, // Is source note
			combinedContentObj,
			contentIncludedPaths
		);
		if (contentIncludedPaths.has(activeFile.path)) {
			// Check if content was actually added (passed filters AND read successfully)
			includedNotesCount++;
		}
		traversalVisitedPaths.add(activeFile.path); // Mark source note as visited for traversal

		// --- Part 2: Process Linked Notes (BFS) ---
		combinedContentObj.content += `\n## Linked Notes (Up to Depth ${maxDepth}):\n`; // Add section header regardless of links
		const queue: { path: string; depth: number }[] = [];
		let processedLinkCandidates = 0; // Counts how many links were dequeued

		// Initialize queue with depth 1 links from the source note
		const initialLinks =
			this.app.metadataCache.resolvedLinks[activeFile.path] ?? {};
		for (const linkedPath in initialLinks) {
			if (!traversalVisitedPaths.has(linkedPath)) {
				console.log(
					`[BFS Init] Enqueuing Initial: ${linkedPath} (Depth 1)`
				);
				queue.push({ path: linkedPath, depth: 1 });
				traversalVisitedPaths.add(linkedPath); // Mark as visited immediately upon enqueueing
			}
		}

		console.log(
			`[BFS Start Loop] Max Depth: ${maxDepth}. Initial queue size: ${queue.length}. Visited size: ${traversalVisitedPaths.size}`
		);

		// BFS Loop
		while (queue.length > 0) {
			iteration++;
			if (iteration % 50 === 0 || queue.length > 200)
				console.log(
					`[BFS Loop #${iteration}] Queue size: ${queue.length}, Visited size: ${traversalVisitedPaths.size}`
				);
			if (iteration > 10000) {
				// Safety break
				console.error(`[BFS Loop #${iteration}] SAFETY BREAK`);
				new Notice("Error: Traversal loop ran too long.", 10000);
				break;
			}

			const { path: currentPath, depth } = queue.shift()!;
			processedLinkCandidates++;

			// We only *process* nodes up to maxDepth. We only *enqueue* nodes if their parent depth < maxDepth.
			const linkedFile =
				this.app.vault.getAbstractFileByPath(currentPath);
			if (
				!(linkedFile instanceof TFile) ||
				linkedFile.extension !== "md"
			) {
				continue; // Skip non-markdown files
			}

			// Process the note's content (check filters, read, add to output)
			// This happens regardless of whether we enqueue its children
			const linkedNotePassedFilters = await this.processAndAddNoteContent(
				linkedFile,
				depth,
				false, // Not source note
				combinedContentObj,
				contentIncludedPaths
			);
			if (
				linkedNotePassedFilters &&
				contentIncludedPaths.has(currentPath)
			) {
				// Increment count only if filters passed AND content was added
				// Check contentIncludedPaths again in case of read error after passing filters
				if (
					![...contentIncludedPaths]
						.slice(0, -1)
						.includes(currentPath)
				) {
					// Avoid double counting if source note was also depth 1+ link
					includedNotesCount++;
				}
			}

			// Enqueue Children for Further Traversal ONLY if current depth < maxDepth
			if (depth < maxDepth) {
				const nextDepth = depth + 1;
				const nextLevelLinks =
					this.app.metadataCache.resolvedLinks[currentPath] ?? {};
				for (const nextPath in nextLevelLinks) {
					if (!traversalVisitedPaths.has(nextPath)) {
						console.log(
							`[BFS Enqueue Iteration ${iteration}] Enqueuing: ${nextPath} (Depth ${nextDepth}) from ${currentPath} (Depth ${depth})`
						);
						queue.push({ path: nextPath, depth: nextDepth });
						traversalVisitedPaths.add(nextPath); // Mark as visited immediately
					}
				}
			} else {
				// Log only once when a node at maxDepth is processed and its children are not enqueued
				console.log(
					`[BFS Enqueue Check Iteration ${iteration}] Max depth (${maxDepth}) reached for node ${currentPath}. Not enqueueing its children.`
				);
			}
		} // End BFS while loop

		// --- Final Output Generation ---
		console.log(
			`[BFS End] Traversal complete. Iterations: ${iteration}. Processed ${processedLinkCandidates} link candidates (${traversalVisitedPaths.size} unique nodes visited for traversal), included content from ${includedNotesCount} total notes.`
		);

		// Add summary messages
		if (includedNotesCount === 0) {
			combinedContentObj.content +=
				"\n*No notes (including source) had content matching all the required filters.*\n\n---\n";
		} else if (
			includedNotesCount ===
				(activeNotePassedFilters &&
				contentIncludedPaths.has(activeFile.path)
					? 1
					: 0) &&
			Object.keys(initialLinks).length > 0
		) {
			// Condition: Only the source note's content was included (if it passed filters) AND there were outgoing links initially
			combinedContentObj.content +=
				"\n*No linked notes had content matching all the required filters within the depth limit.*\n\n---\n";
		}

		const timestamp = moment().format("YYYYMMDD-HHmmss");
		const tagPart = checkTags
			? `Tags-${targetTags.slice(0, 2).join("-")}`
			: "NoTags";
		const fileName = `Context-${activeFile.basename}-${tagPart}-${timestamp}.md`;
		await this.createOutputFile(fileName, combinedContentObj.content); // Corrected variable name
	}

	// --- HELPER: Create Output File ---
	async createOutputFile(fileName: string, content: string) {
		const exportFolderPathRaw = this.settings.exportFolderName;
		const exportFolderPath = exportFolderPathRaw.replace(/^\/+|\/+$/g, "");
		const parentFolder = exportFolderPath ? exportFolderPath + "/" : "";
		const filePath = `${parentFolder}${fileName}`;
		try {
			if (exportFolderPath) {
				const folderExists = await this.app.vault.adapter.exists(
					exportFolderPath
				);
				if (!folderExists) {
					await this.app.vault.createFolder(exportFolderPath);
					console.log(
						`[Output] Created export folder: ${exportFolderPath}`
					);
				} else {
					const stats = await this.app.vault.adapter.stat(
						exportFolderPath
					);
					if (!stats || stats.type !== "folder") {
						new Notice(
							`Error: Export path "${exportFolderPath}" is not a folder.`,
							10000
						);
						return;
					}
				}
			}
			console.log(
				`[Output] Attempting to create context file: ${filePath}`
			);
			const createdFile = await this.app.vault.create(filePath, content);
			new Notice(`Context file created: ${createdFile.basename}`);
		} catch (err) {
			if ((err as Error).message?.includes("File already exists")) {
				new Notice(
					`Error: File "${fileName}" already exists in "${
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
			console.error("[Output] Error creating context file:", err);
		}
	}
} // End of MyPlugin class

// --- SETTINGS TAB --- (CORRECTED Link Depth onChange)
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

		// Export Folder Name (Unchanged)
		new Setting(containerEl)
			.setName("Export Folder Name")
			.setDesc(
				"Folder to save context files (optional, saves in vault root if empty)."
			)
			.addText((text) =>
				text
					.setPlaceholder("e.g., ContextExports (optional)")
					.setValue(this.plugin.settings.exportFolderName)
					.onChange(async (value) => {
						this.plugin.settings.exportFolderName = value.trim();
						await this.plugin.saveSettings();
					})
			);

		// Include Privacy Levels (Unchanged)
		new Setting(containerEl)
			.setName("Include Privacy Levels")
			.setDesc(
				"Comma-separated `privacy` values (frontmatter) to include (e.g., public). Add 'none' to include notes without a privacy key."
			)
			.addText((text) =>
				text
					.setPlaceholder("public, none")
					.setValue(
						this.plugin.settings.includePrivacyLevels.join(", ")
					)
					.onChange(async (value) => {
						this.plugin.settings.includePrivacyLevels = value
							.split(",")
							.map((p) => p.trim().toLowerCase())
							.filter((p) => p.length > 0);
						await this.plugin.saveSettings();
					})
			);

		// Required Tags (Unchanged)
		new Setting(containerEl)
			.setName("Required Tags (Optional)")
			.setDesc(
				"If tags are listed here (comma-separated, e.g., project-a, important), *ALL* included notes (source and linked) MUST have at least one of these tags *in addition to* matching the privacy level. Leave empty to ignore tags and only filter by privacy."
			)
			.addText((text) =>
				text
					.setPlaceholder("project-a, important (optional)")
					.setValue(this.plugin.settings.targetTags.join(", "))
					.onChange(async (value) => {
						this.plugin.settings.targetTags = value
							.split(",")
							.map((t) =>
								t.trim().toLowerCase().replace(/^#/, "")
							)
							.filter((t) => t.length > 0);
						await this.plugin.saveSettings();
					})
			);

		// Link Depth Setting
		new Setting(containerEl)
			.setName("Link Depth")
			.setDesc(
				"How many levels of links to follow from the active note (1 = direct links only). Notes at all levels must pass filters for their *content* to be included."
			)
			.addText((text) =>
				text
					.setPlaceholder("1")
					.setValue(this.plugin.settings.linkDepth.toString())
					.onChange(async (value) => {
						// Allow empty input while typing
						if (value.trim() === "") {
							return;
						}

						const depth = parseInt(value.trim(), 10);

						// Only save if we have a valid integer ≥ 1
						if (
							!isNaN(depth) &&
							depth >= 1 &&
							Number.isInteger(depth)
						) {
							this.plugin.settings.linkDepth = depth;
							await this.plugin.saveSettings();
						} else {
							// If invalid but not empty, revert to current valid setting
							text.setValue(
								this.plugin.settings.linkDepth.toString()
							);
						}
					})
			);
	}
} // End of ContextSettingTab class
