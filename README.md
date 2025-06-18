# Context Fetcher for Obsidian

**Author:** Thomas Collardeau
**Version:** 1.1.0
**Minimum Obsidian Version:** 0.15.0

## Description

This plugin transforms Obsidian into a powerful tool for **Graph RAG (Retrieval-Augmented Generation)**.

Instead of relying on purely semantic search, Context Fetcher leverages the explicit, human-curated knowledge graph you've built through links and tags. It traverses your note network to construct highly relevant, precise, and explainable context, formatted for use with Large Language Models (LLMs). This allows you to "chat with your notes" using the rich, interconnected structure you've already created.

## Features

-   **Graph Traversal Export:** Creates a context file by following outgoing links from a source note up to a configurable depth.
-   **Advanced Tag Filtering:**
    -   **Inclusion:** Require notes to contain specific tags.
    -   **Exclusion:** Explicitly exclude notes with specific tags, with exclusion taking priority.
    -   **Searchable UI:** A searchable dropdown makes finding and selecting tags quick and easy.
-   **Privacy-Aware:** Filters notes based on a `privacy` key in their frontmatter, ensuring you only share what you intend to.
-   **Short-Term Memory Buffer:** Optionally include the content from your N most recent daily notes, providing immediate, timely context for the LLM.
-   **Customizable & Easy to Use:** A full settings panel, ribbon icon, and command palette integration make it simple to configure and run.

## How to Use

1.  **Configure Settings (Optional):**
    -   Go to Obsidian Settings -> Community Plugins -> Context Fetcher.
    -   Adjust the settings as needed (see Settings Explained below).
2.  **Open a Source Note:** Navigate to the Markdown note you want to start the context fetching from.
3.  **Run the Command:**
    -   Open the Command Palette (Cmd/Ctrl + P).
    -   Search for and select "Context Fetcher: Create Context File".
    -   **Alternatively:** Go to the plugin settings and click the "Create Context File Now" button at the bottom of the settings page.
4.  **Check the Output:**
    -   A new Markdown file will be created in your specified `Export Folder Name`.
    -   The file name will be timestamped and include the source note's name.
    -   This file will contain the filtered content from the source note and its linked notes.

## Settings Overview

<img width="512" alt="Screenshot 2025-06-18 at 13 33 19" src="https://github.com/user-attachments/assets/d968263d-8a37-4de8-835f-323bda51e818" />

## Settings Explained

-   **Export Folder Name:**

    -   The name of the folder within your vault where the context files will be saved.
    -   If left empty, files will be saved in the root of your vault.
    -   _Example: `ContextExports`_

-   **Include Privacy Levels:**
    -   A comma-separated list of values for the `privacy` key in note frontmatter. Only notes with a matching privacy value will have their content included.
    -   Case-insensitive.
    -   Add the special value `none` to include notes that _do not_ have a `privacy` key in their frontmatter.
    -   _Example: `public, internal, none`_

-   **Required Tags (Optional):**
    -   A comma-separated list of tags (without the leading `#`).
    -   If tags are listed here, a note must have at least one of these tags to be included.
    -   _Example: `project-x, important-client`_

-   **Excluded Tags (Optional):**
    -   A comma-separated list of tags to exclude.
    -   If a note has a tag from this list, it will be excluded, **even if** it also has a tag from the **Required Tags** list. Exclusion takes priority over inclusion.
    -   _Example: `archive, low-priority`_

-   **Link Depth:**
    -   Determines how many levels of outgoing links to follow from the active note.
    -   `1` means only include the active note and notes directly linked from it.
    -   _Must be 1 or greater._

-   **Recent Daily Notes:**
    -   A toggle to enable or disable the inclusion of recent daily notes.
    -   When enabled, the plugin automatically finds the specified number of most recent notes tagged `#daily` (or your daily note template tag).
    -   It then appends the content of these notes to the end of the context file, providing a "short-term memory" buffer for your LLM.
    -   _Note: The tag filters (Required/Excluded) are ignored for this specific daily note inclusion to ensure your most recent activity is always captured if the feature is on._

## License

[MIT License](LICENSE)
