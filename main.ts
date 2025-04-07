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
	includeRecentDailyNotes: boolean; // New setting
	numberOfRecentDays: number; // New setting
}
const DEFAULT_SETTINGS: MyPluginSettings = {
	exportFolderName: "ContextExports",
	includePrivacyLevels: ["public"],
	linkDepth: 1,
	targetTags: [],
	includeRecentDailyNotes: false, // Default value
	numberOfRecentDays: 3, // Default value
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
		// Normalize new settings
		this.settings.includeRecentDailyNotes =
			!!this.settings.includeRecentDailyNotes; // Ensure boolean
		this.settings.numberOfRecentDays = Math.max(
			1,
			Math.floor(this.settings.numberOfRecentDays) || 1
		); // Ensure >= 1 integer
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
		// Normalize new settings before saving
		this.settings.includeRecentDailyNotes =
			!!this.settings.includeRecentDailyNotes; // Ensure boolean
		this.settings.numberOfRecentDays = Math.max(
			1,
			Math.floor(this.settings.numberOfRecentDays) || 1
		); // Ensure >= 1 integer

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

		// Check Privacy Level
		let passesPrivacy = false;
		if (privacyValue && allowedPrivacyLevels.includes(privacyValue)) {
			passesPrivacy = true;
		} else if (!privacyValue && allowedPrivacyLevels.includes("none")) {
			// Include notes with NO privacy key if 'none' is specified
			passesPrivacy = true;
		} else if (
			privacyRaw === null &&
			allowedPrivacyLevels.includes("none")
		) {
			// Also handle explicitly null privacy if 'none' is specified (YAML null)
			passesPrivacy = true;
		}

		if (!passesPrivacy) {
			return false; // Failed privacy filter
		}

		// Check Tags (only if required and privacy passed)
		if (mustCheckTags) {
			const fileTagsRaw = getAllTags(cache) ?? [];
			const fileTags = fileTagsRaw.map((tag) =>
				tag.substring(1).toLowerCase()
			); // Remove '#' and lowercase
			const hasMatchingTag = fileTags.some((fileTag) =>
				targetTags.includes(fileTag)
			);
			if (!hasMatchingTag) {
				return false; // Failed tag filter
			}
		}

		// If we reach here, all filters passed
		return true;
	}

	// --- Helper: Check ONLY Privacy Filter ---
	private passesPrivacyFilter(
		file: TFile,
		cache: CachedMetadata | null
	): boolean {
		if (!cache) return false;
		const frontmatter = cache.frontmatter;
		const privacyRaw = parseFrontMatterEntry(frontmatter, "privacy");
		const privacyValue =
			typeof privacyRaw === "string"
				? privacyRaw.trim().toLowerCase()
				: undefined;
		const allowedPrivacyLevels = this.settings.includePrivacyLevels;

		// Check Privacy Level
		if (privacyValue && allowedPrivacyLevels.includes(privacyValue)) {
			return true;
		} else if (!privacyValue && allowedPrivacyLevels.includes("none")) {
			// Include notes with NO privacy key if 'none' is specified
			return true;
		} else if (
			privacyRaw === null &&
			allowedPrivacyLevels.includes("none")
		) {
			// Also handle explicitly null privacy if 'none' is specified (YAML null)
			return true;
		}

		return false; // Failed privacy filter
	}

	// --- Helper: Process Single Note (Used for BFS traversal) ---
	private async processAndAddNoteContent(
		file: TFile,
		depth: number,
		isSourceNote: boolean,
		combinedContentRef: { content: string }, // Pass by reference object
		contentIncludedPaths: Set<string>
	): Promise<boolean> {
		// Returns true if content was included based on filters, false otherwise
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
			// Filters don't pass
			console.log(
				`[Depth ${depth}] Skipped Content: ${file.basename} (Filters)`
			);
			if (isSourceNote) {
				// Special case: Add skipped message ONLY for the source note
				noteOutput = `\n## ${titlePrefix}: ${file.basename}${depthString}\n\n*Note content skipped (Filters).*\n\n---\n`;
			}
			// For linked notes that fail filters, noteOutput remains empty
		}

		// Only add output if it was generated
		if (noteOutput) {
			combinedContentRef.content += noteOutput;
		}
		return passesFilters; // Return if it passed filters, regardless of errors or empty output
	}

	// --- CORE LOGIC: Unified Function ---
	async createContextFile() {
		const activeFile = this.app.workspace.getActiveFile();
		if (!activeFile || activeFile.extension !== "md") {
			new Notice("Please open a Markdown note first.");
			return;
		}

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
		// Add new settings to header
		combinedContentObj.content += `* Include Recent Daily Notes: ${
			this.settings.includeRecentDailyNotes ? "Yes" : "No"
		}\n`;
		if (this.settings.includeRecentDailyNotes) {
			combinedContentObj.content += `* Number of Recent Days: ${this.settings.numberOfRecentDays}\n`;
		}
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
			includedNotesCount++;
		}
		traversalVisitedPaths.add(activeFile.path); // Mark source note as visited for traversal

		// --- Part 2: Process Linked Notes (BFS) ---
		combinedContentObj.content += `\n## Linked Notes (Up to Depth ${maxDepth}):\n`;
		const queue: { path: string; depth: number }[] = [];
		let processedLinkCandidates = 0;

		// Initialize queue with depth 1 links from the source note
		const initialLinks =
			this.app.metadataCache.resolvedLinks[activeFile.path] ?? {};
		for (const linkedPath in initialLinks) {
			if (!traversalVisitedPaths.has(linkedPath)) {
				console.log(
					`[BFS Init] Enqueuing Initial: ${linkedPath} (Depth 1)`
				);
				queue.push({ path: linkedPath, depth: 1 });
				traversalVisitedPaths.add(linkedPath);
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

			const linkedFile =
				this.app.vault.getAbstractFileByPath(currentPath);
			if (
				!(linkedFile instanceof TFile) ||
				linkedFile.extension !== "md"
			) {
				continue; // Skip non-markdown files
			}

			// Process the note's content (check filters, read, add to output)
			// Avoid double-counting if a node is reachable via multiple paths and has already passed filters
			const alreadyIncluded = contentIncludedPaths.has(currentPath);
			const linkedNotePassedFilters = await this.processAndAddNoteContent(
				linkedFile,
				depth,
				false, // Not source note
				combinedContentObj,
				contentIncludedPaths
			);
			if (
				linkedNotePassedFilters &&
				!alreadyIncluded &&
				contentIncludedPaths.has(currentPath)
			) {
				// Increment count only if filters passed AND content was newly added
				// (Check contentIncludedPaths again in case of read error after passing filters)
				includedNotesCount++;
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
				// Log only once when a node at maxDepth is processed
				if (
					Object.keys(
						this.app.metadataCache.resolvedLinks[currentPath] ?? {}
					).length > 0
				) {
					console.log(
						`[BFS Enqueue Check Iteration ${iteration}] Max depth (${maxDepth}) reached for node ${currentPath}. Not enqueueing its children.`
					);
				}
			}
		} // End BFS while loop

		console.log(
			`[BFS End] Traversal complete. Iterations: ${iteration}. Processed ${processedLinkCandidates} link candidates (${traversalVisitedPaths.size} unique nodes visited for traversal), included content from ${includedNotesCount} notes via BFS.`
		);

		// --- Part 3: Process Recent Daily Notes (If Enabled) ---
		if (this.settings.includeRecentDailyNotes) {
			console.log("[Daily Notes] Processing recent daily notes...");
			combinedContentObj.content += `\n## Recent Daily Notes (Up to ${this.settings.numberOfRecentDays} days):\n`;
			let dailyNotesAddedCount = 0;
			try {
				const allMarkdownFiles = this.app.vault.getMarkdownFiles();
				const dailyNoteRegex = /^\d{4}-\d{2}-\d{2}\.md$/; // YYYY-MM-DD.md

				const potentialDailyNotes = allMarkdownFiles
					.filter((file) => {
						// Check filename format
						if (!dailyNoteRegex.test(file.name)) {
							return false;
						}
						// Check for #daily tag
						const cache = this.app.metadataCache.getFileCache(file);
						if (!cache) return false;
						const tags = getAllTags(cache) ?? [];
						return tags.some((tag) =>
							tag.toLowerCase().startsWith("#daily")
						);
					})
					.sort((a, b) => {
						// Sort by filename (date) descending
						return b.basename.localeCompare(a.basename);
					});

				const recentDaysToInclude = this.settings.numberOfRecentDays;
				const dailyNotesToProcess = potentialDailyNotes.slice(
					0,
					recentDaysToInclude
				);

				console.log(
					`[Daily Notes] Found ${potentialDailyNotes.length} potential daily notes. Processing the latest ${dailyNotesToProcess.length}.`
				);

				for (const dailyFile of dailyNotesToProcess) {
					if (contentIncludedPaths.has(dailyFile.path)) {
						console.log(
							`[Daily Notes] Skipping ${dailyFile.basename} (already included via BFS).`
						);
						continue; // Already included via BFS, skip processing
					}

					const cache =
						this.app.metadataCache.getFileCache(dailyFile);
					if (this.passesPrivacyFilter(dailyFile, cache)) {
						try {
							const fullContent = await this.app.vault.read(
								dailyFile
							);
							const truncatedContent =
								this.truncateContentAfterFirstSeparator(
									fullContent
								);
							const cleanedContent =
								this.removeWikiLinks(truncatedContent);
							const noteOutput = `\n## Daily Note: ${dailyFile.basename}\n\n### Content:\n${cleanedContent}\n\n---\n`;
							combinedContentObj.content += noteOutput;
							contentIncludedPaths.add(dailyFile.path); // Mark as included
							dailyNotesAddedCount++;
							includedNotesCount++; // Increment total count
							console.log(
								`[Daily Notes] Included Content: ${dailyFile.basename}`
							);
						} catch (err) {
							console.error(
								`[Daily Notes] Error reading file ${dailyFile.path}:`,
								err
							);
							combinedContentObj.content += `\n## Daily Note: ${dailyFile.basename}\n\n*Error reading file content.*\n\n---\n`;
						}
					} else {
						console.log(
							`[Daily Notes] Skipped Content: ${dailyFile.basename} (Privacy Filter)`
						);
						// Optionally add a skipped message, but might be too verbose
						// combinedContentObj.content += `\n## Daily Note: ${dailyFile.basename}\n\n*Note content skipped (Privacy Filter).*\n\n---\n`;
					}
				} // End loop through daily notes

				if (dailyNotesAddedCount === 0) {
					combinedContentObj.content +=
						"\n*No recent daily notes matching the privacy filter were found or added.*\n\n---\n";
				}
			} catch (error) {
				console.error(
					"[Daily Notes] Error processing daily notes:",
					error
				);
				combinedContentObj.content +=
					"\n*An error occurred while processing recent daily notes.*\n\n---\n";
			}
		} // End if includeRecentDailyNotes

		// --- Final Output Generation ---
		console.log(
			`[End] Processing complete. Included content from ${includedNotesCount} total notes.`
		);

		// Add summary messages
		if (includedNotesCount === 0) {
			combinedContentObj.content +=
				"\n*No notes (including source) had content matching all the required filters.*\n\n---\n";
		} else if (
			includedNotesCount ===
				(contentIncludedPaths.has(activeFile.path) ? 1 : 0) && // Check if source note content was actually added
			Object.keys(initialLinks).length > 0
		) {
			// Condition: Only the source note's content was included AND there were outgoing links initially
			combinedContentObj.content +=
				"\n*No linked notes had content matching all the required filters within the depth limit.*\n\n---\n";
		}

		const timestamp = moment().format("YYYYMMDD-HHmmss");
		const tagPart = checkTags
			? `Tags-${targetTags.slice(0, 2).join("-")}`
			: "NoTags";
		const fileName = `Context-${activeFile.basename}-${tagPart}-${timestamp}.md`;
		await this.createOutputFile(fileName, combinedContentObj.content);
	}

	// --- HELPER: Create Output File ---
	async createOutputFile(fileName: string, content: string) {
		const exportFolderPathRaw = this.settings.exportFolderName;
		const exportFolderPath = exportFolderPathRaw.replace(/^\/+|\/+$/g, ""); // Trim slashes
		const parentFolder = exportFolderPath ? exportFolderPath + "/" : "";
		const filePath = `${parentFolder}${fileName}`;
		try {
			// Ensure the export folder exists if specified
			if (exportFolderPath) {
				const folderExists = await this.app.vault.adapter.exists(
					exportFolderPath,
					false // Check case-insensitively on relevant systems
				);
				if (!folderExists) {
					try {
						await this.app.vault.createFolder(exportFolderPath);
						console.log(
							`[Output] Created export folder: ${exportFolderPath}`
						);
					} catch (folderErr) {
						console.error(
							`[Output] Error creating folder "${exportFolderPath}":`,
							folderErr
						);
						new Notice(
							`Error: Could not create export folder "${exportFolderPath}". Saving to vault root.`
						);
						// Fallback to root if folder creation fails
						const rootFilePath = fileName;
						const rootCreatedFile = await this.app.vault.create(
							rootFilePath,
							content
						);
						new Notice(
							`Context file created in vault root: ${rootCreatedFile.basename}`
						);
						return; // Exit after fallback save
					}
				} else {
					// Check if the existing path is actually a folder
					const stats = await this.app.vault.adapter.stat(
						exportFolderPath
					);
					if (!stats || stats.type !== "folder") {
						new Notice(
							`Error: Export path "${exportFolderPath}" exists but is not a folder. Saving to vault root.`,
							10000
						);
						// Fallback to root if path exists but isn't a folder
						const rootFilePath = fileName;
						const rootCreatedFile = await this.app.vault.create(
							rootFilePath,
							content
						);
						new Notice(
							`Context file created in vault root: ${rootCreatedFile.basename}`
						);
						return; // Exit after fallback save
					}
				}
			}

			// Attempt to create the file in the target location (root or subfolder)
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

	// --- Helper: Get Preview Notes List ---
	async getPreviewNotes(
		activeFile: TFile
	): Promise<
		{ path: string; basename: string; depth: number; passes: boolean }[]
	> {
		const previewList: {
			path: string;
			basename: string;
			depth: number;
			passes: boolean;
		}[] = [];
		const traversalVisitedPaths = new Set<string>();
		const queue: { path: string; depth: number }[] = [];
		const maxDepth = this.settings.linkDepth; // Use current settings

		console.log(
			`[Preview] Starting preview generation for ${activeFile.basename}, Depth: ${maxDepth}`
		);

		// --- Process Active Note (Depth 0) ---
		traversalVisitedPaths.add(activeFile.path);
		const activeCache = this.app.metadataCache.getFileCache(activeFile);
		const activeNotePasses = this.passesFilters(activeFile, activeCache);
		previewList.push({
			path: activeFile.path,
			basename: activeFile.basename,
			depth: 0,
			passes: activeNotePasses,
		});
		console.log(
			`[Preview] Source: ${activeFile.basename}, Passes: ${activeNotePasses}`
		);

		// --- Initialize Queue (Depth 1) ---
		const initialLinks =
			this.app.metadataCache.resolvedLinks[activeFile.path] ?? {};
		for (const linkedPath in initialLinks) {
			if (!traversalVisitedPaths.has(linkedPath)) {
				queue.push({ path: linkedPath, depth: 1 });
				traversalVisitedPaths.add(linkedPath); // Mark visited when enqueued
			}
		}

		// --- BFS Loop for Preview ---
		let iterations = 0;
		while (queue.length > 0) {
			iterations++;
			if (iterations > 5000) {
				// Safety break for preview
				console.warn("[Preview] Safety break triggered during BFS.");
				break;
			}

			const { path: currentPath, depth } = queue.shift()!;
			const linkedFile =
				this.app.vault.getAbstractFileByPath(currentPath);

			if (
				!(linkedFile instanceof TFile) ||
				linkedFile.extension !== "md"
			) {
				continue; // Skip non-markdown files
			}

			// Check if the note passes filters
			const cache = this.app.metadataCache.getFileCache(linkedFile);
			const passes = this.passesFilters(linkedFile, cache);
			previewList.push({
				path: currentPath,
				basename: linkedFile.basename,
				depth: depth,
				passes: passes,
			});
			console.log(
				`[Preview] Depth ${depth}: ${linkedFile.basename}, Passes: ${passes}`
			);

			// Enqueue Children if within depth limit
			if (depth < maxDepth) {
				const nextDepth = depth + 1;
				const nextLevelLinks =
					this.app.metadataCache.resolvedLinks[currentPath] ?? {};
				for (const nextPath in nextLevelLinks) {
					if (!traversalVisitedPaths.has(nextPath)) {
						queue.push({ path: nextPath, depth: nextDepth });
						traversalVisitedPaths.add(nextPath); // Mark visited when enqueued
					}
				}
			}
		} // End BFS while loop

		console.log(
			`[Preview] Finished. Found ${
				previewList.length
			} potential notes. Included based on filters: ${
				previewList.filter((n) => n.passes).length
			}`
		);
		// Sort by depth, then alphabetically for consistent display
		previewList.sort((a, b) => {
			if (a.depth !== b.depth) return a.depth - b.depth;
			return a.basename.localeCompare(b.basename);
		});
		return previewList;
	}
} // End of MyPlugin class

// --- SETTINGS TAB --- (Includes Preview Functionality)
class ContextSettingTab extends PluginSettingTab {
	plugin: MyPlugin;
	previewContainerEl: HTMLDivElement | null = null; // Element reference for preview results

	constructor(app: App, plugin: MyPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.createEl("h2", { text: "Context Fetcher Settings" });

		// --- Basic Settings ---

		// Export Folder Name
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
						this.updatePreviewStatus(); // Update preview status on change
					})
			);

		// Include Privacy Levels
		new Setting(containerEl)
			.setName("Include Privacy Levels")
			.setDesc(
				"Comma-separated `privacy` values (frontmatter) to include (e.g., public). Add 'none' to include notes without a privacy key or with `privacy: null`."
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
						this.updatePreviewStatus(); // Update preview status on change
					})
			);

		// Required Tags
		new Setting(containerEl)
			.setName("Required Tags (Optional)")
			.setDesc(
				"If tags are listed here (comma-separated, e.g., project-a, important), *ALL* included notes (source and linked) MUST have at least one of these tags *in addition to* matching the privacy level. Leave empty to ignore tags."
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
						this.updatePreviewStatus(); // Update preview status on change
					})
			);

		// Link Depth Setting
		new Setting(containerEl)
			.setName("Link Depth")
			.setDesc(
				"How many levels of links to follow (1 = direct links only). Notes at all levels must pass filters for *content* inclusion."
			)
			.addText((text) =>
				text
					.setPlaceholder("1")
					.setValue(this.plugin.settings.linkDepth.toString())
					.onChange(async (value) => {
						let changed = false;
						// Allow empty input while typing but don't save it
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
							if (this.plugin.settings.linkDepth !== depth) {
								this.plugin.settings.linkDepth = depth;
								await this.plugin.saveSettings();
								changed = true;
							}
						} else {
							// If invalid but not empty, revert to current valid setting in the input field
							// Check if the displayed value actually needs changing
							if (
								text.getValue() !==
								this.plugin.settings.linkDepth.toString()
							) {
								text.setValue(
									this.plugin.settings.linkDepth.toString()
								);
								console.warn(
									`Invalid depth input "${value}", reverting to ${this.plugin.settings.linkDepth}`
								);
							}
						}
						if (changed) {
							this.updatePreviewStatus(); // Update preview status only if value actually changed
						}
					})
			);

		// --- Daily Notes Settings ---
		containerEl.createEl("h3", { text: "Recent Daily Notes" });

		new Setting(containerEl)
			.setName("Include Recent Daily Notes")
			.setDesc(
				"If enabled, automatically include content from the most recent daily notes (tagged #daily) that pass the privacy filter (tags are ignored for this specific inclusion)."
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.includeRecentDailyNotes)
					.onChange(async (value) => {
						this.plugin.settings.includeRecentDailyNotes = value;
						await this.plugin.saveSettings();
						// Redraw settings to show/hide the number input
						this.display();
						this.updatePreviewStatus(); // Also update preview status
					})
			);

		// Number of Recent Days (conditionally displayed)
		const recentDaysSetting = new Setting(containerEl)
			.setName("Number of recent days to include")
			.setDesc(
				"How many of the most recent daily notes (YYYY-MM-DD.md with #daily tag) to check and potentially include."
			)
			.addText((text) =>
				text
					.setPlaceholder("3")
					.setValue(
						this.plugin.settings.numberOfRecentDays.toString()
					)
					.onChange(async (value) => {
						let changed = false;
						if (value.trim() === "") {
							return; // Ignore empty input while typing
						}
						const days = parseInt(value.trim(), 10);
						if (
							!isNaN(days) &&
							days >= 1 &&
							Number.isInteger(days)
						) {
							if (
								this.plugin.settings.numberOfRecentDays !== days
							) {
								this.plugin.settings.numberOfRecentDays = days;
								await this.plugin.saveSettings();
								changed = true;
							}
						} else {
							if (
								text.getValue() !==
								this.plugin.settings.numberOfRecentDays.toString()
							) {
								text.setValue(
									this.plugin.settings.numberOfRecentDays.toString()
								);
								console.warn(
									`Invalid days input "${value}", reverting to ${this.plugin.settings.numberOfRecentDays}`
								);
							}
						}
						if (changed) {
							this.updatePreviewStatus(); // Update preview if value changed
						}
					})
			);

		// Hide the number input if the toggle is off
		if (!this.plugin.settings.includeRecentDailyNotes) {
			recentDaysSetting.settingEl.style.display = "none";
		}

		// --- Preview Section ---
		containerEl.createEl("h3", { text: "Preview Included Notes" });
		containerEl.createEl("p", {
			text: "See which notes would be included based on the current settings and the *currently active note*. The preview only checks filters, it does not read content.",
		});

		new Setting(containerEl)
			.setName("Generate Preview")
			.setDesc(
				"Click to generate or update the list of notes below that match the current filters."
			)
			.addButton((button) =>
				button
					.setButtonText("Show/Update Preview")
					.setCta()
					.onClick(async () => {
						await this.renderPreview();
					})
			);

		// Create the container for the preview results
		this.previewContainerEl = containerEl.createDiv(
			"context-preview-results"
		);
		this.previewContainerEl.createEl("p", {
			text: 'Click "Show/Update Preview" to see results.',
		});

		// --- Action Button ---
		new Setting(containerEl)
			.setName("Run Context Creation")
			.setDesc(
				"Manually trigger the 'Create Context File' command using the current settings and the active note."
			)
			.addButton((button) =>
				button
					.setButtonText("Create Context File Now")
					// .setCta() // Keep preview button as primary CTA
					.onClick(async () => {
						const activeFile = this.app.workspace.getActiveFile();
						if (!activeFile || activeFile.extension !== "md") {
							new Notice(
								"Please open a Markdown note first before creating context.",
								5000
							);
							return;
						}
						new Notice(
							`Triggering context file creation for "${activeFile.basename}"...`
						);
						try {
							// Use the fully qualified command ID
							// Construct the ID based on your manifest.json `id` field
							const commandId = `${this.plugin.manifest.id}:create-context-file`;
							await (this.app as any).commands.executeCommandById(
								commandId
							);
							// Note: The command itself handles success/error notices for the file creation part.
						} catch (error) {
							console.error(
								"Error executing command from settings:",
								error
							);
							new Notice(
								"Failed to trigger context creation command. See console.",
								10000
							);
						}
					})
			);
	}

	// --- Preview Helper Methods ---

	// Indicate that the preview might be outdated due to setting changes
	updatePreviewStatus() {
		if (
			this.previewContainerEl &&
			this.previewContainerEl.firstChild?.textContent !==
				'Click "Show/Update Preview" to see results.' &&
			!this.previewContainerEl.querySelector(".preview-loading")
		) {
			// If preview exists and isn't showing the initial message or loading
			let statusEl =
				this.previewContainerEl.querySelector(".preview-status");
			if (statusEl) {
				statusEl.setText(
					'Settings changed. Click "Show/Update Preview" to refresh.'
				);
				statusEl.addClass("preview-stale");
			} else {
				// Prepend a status message if none exists
				const newStatus = this.previewContainerEl.createEl("p", {
					text: 'Settings changed. Click "Show/Update Preview" to refresh.',
					cls: "preview-status preview-stale",
				});
				this.previewContainerEl.prepend(newStatus);
			}
		}
	}

	// Generate and render the preview list
	async renderPreview() {
		if (!this.previewContainerEl) {
			console.error("Preview container element not found.");
			return;
		}

		const activeFile = this.app.workspace.getActiveFile();
		if (!activeFile || activeFile.extension !== "md") {
			this.previewContainerEl.empty();
			this.previewContainerEl.createEl("p", {
				text: "Please open a Markdown note to generate a preview.",
				cls: "preview-error",
			});
			return;
		}

		this.previewContainerEl.empty();
		this.previewContainerEl.createEl("p", {
			text: `Generating preview for "${activeFile.basename}"...`,
			cls: "preview-loading preview-status",
		});

		try {
			const previewNotes = await this.plugin.getPreviewNotes(activeFile);

			this.previewContainerEl.empty(); // Clear loading message

			if (previewNotes.length === 0) {
				// This case should technically not happen if the source note is always processed,
				// but handle it defensively.
				this.previewContainerEl.createEl("p", {
					text: "No notes found during traversal (this might indicate an issue).",
					cls: "preview-status",
				});
				return;
			}

			const includedNotes = previewNotes.filter((note) => note.passes);
			const excludedNotes = previewNotes.filter((note) => !note.passes);

			this.previewContainerEl.createEl("p", {
				text: `Preview Results for "${activeFile.basename}" (Max Depth: ${this.plugin.settings.linkDepth}):`,
				cls: "preview-status",
			});

			if (includedNotes.length > 0) {
				this.previewContainerEl.createEl("h4", {
					text: `Notes whose content WOULD be included (${includedNotes.length})`,
				});
				const includedList = this.previewContainerEl.createEl("ul", {
					cls: "preview-included-list",
				});
				includedNotes.forEach((note) => {
					const item = includedList.createEl("li");
					// Make the note name clickable to open the note
					item.createEl("a", {
						text: note.basename,
						href: "#", // Prevent navigation
						cls: "internal-link", // Style like an Obsidian link
					}).onclick = (e) => {
						e.preventDefault();
						this.app.workspace.openLinkText(
							note.path,
							activeFile.path,
							false
						); // Open the note
					};
					item.createSpan({
						text: ` (Depth ${note.depth})`,
						cls: "preview-note-depth",
					});
					item.setAttr("title", `Path: ${note.path}`); // Tooltip for full path
				});
			} else {
				this.previewContainerEl.createEl("p", {
					text: "No notes (including the source) would be included based on current filters.",
					cls: "preview-empty",
				});
			}

			// Only show excluded list if there are actually excluded notes found within the traversal depth
			if (excludedNotes.length > 0) {
				this.previewContainerEl.createEl("h4", {
					text: `Notes visited but EXCLUDED by filters (${excludedNotes.length})`,
				});
				const excludedList = this.previewContainerEl.createEl("ul", {
					cls: "preview-excluded-list",
				});
				excludedNotes.forEach((note) => {
					const item = excludedList.createEl("li");
					item.createEl("a", {
						text: note.basename,
						href: "#",
						cls: "internal-link",
					}).onclick = (e) => {
						e.preventDefault();
						this.app.workspace.openLinkText(
							note.path,
							activeFile.path,
							false
						);
					};
					item.createSpan({
						text: ` (Depth ${note.depth})`,
						cls: "preview-note-depth",
					});
					item.setAttr("title", `Path: ${note.path}`);
				});
			}
		} catch (error) {
			console.error("Error generating preview:", error);
			this.previewContainerEl.empty();
			this.previewContainerEl.createEl("p", {
				text: "Error generating preview. Check developer console.",
				cls: "preview-error",
			});
		}
	}

	// Clear preview when tab is hidden/closed
	hide() {
		if (this.previewContainerEl) {
			this.previewContainerEl.empty();
			// Optionally reset to initial message, or just leave it empty
			// this.previewContainerEl.createEl('p', { text: 'Click "Show/Update Preview" to see results.' });
		}
		this.previewContainerEl = null; // Dereference the element
		super.hide(); // Call parent hide method
	}
} // End of ContextSettingTab class
