# My Context Fetcher - Obsidian Plugin

**Author:** Thomas Collardeau ([tonton.dev](https://tonton.dev))
**Version:** 1.0.0
**Minimum Obsidian Version:** 0.15.0

## Description

This plugin for Obsidian fetches context from your notes by traversing outgoing links from the currently active note. It filters the notes based on `privacy` frontmatter values and optional tags, then compiles the content of the matching notes into a single export file. This is useful for creating a consolidated view of related information based on specific criteria.

## Features

-   **Context Export Command:** Creates a new Markdown file containing the content of the active note and its linked notes (up to a configurable depth).
-   **Flexible Filtering:**
    -   **Privacy:** Include notes based on the value of a `privacy` key in their frontmatter (e.g., `privacy: public`). You can specify multiple allowed values and include notes _without_ a privacy key by adding `none` to the list.
    -   **Tags:** Optionally require included notes to have at least one specific tag. This works in conjunction with the privacy filter.
-   **Link Depth Control:** Configure how many levels of links the plugin should follow from the source note.
-   **Customizable Export Folder:** Choose where the generated context files are saved.
-   **Settings Tab:** Easily configure all options through the Obsidian settings panel.
-   **Ribbon Icon:** Quick access to the plugin's settings.

## How to Use

1.  **Configure Settings (Optional):**
    -   Go to Obsidian Settings -> Community Plugins -> My Context Fetcher.
    -   Adjust the `Export Folder Name`, `Include Privacy Levels`, `Required Tags`, and `Link Depth` as needed (see Settings Explained below).
2.  **Open a Source Note:** Navigate to the Markdown note you want to start the context fetching from.
3.  **Run the Command:**
    -   Open the Command Palette (Cmd/Ctrl + P).
    -   Search for and select "My Context Fetcher: Create Context File (Links filtered by Privacy & Optional Tags)".
    -   **Alternatively:** Go to the plugin settings (Settings -> Community Plugins -> My Context Fetcher) and click the "Create Context File Now" button at the bottom of the settings page. This uses the currently saved settings.
4.  **Check the Output:**
    -   A new Markdown file will be created in your specified `Export Folder Name` (or the vault root if the folder name is empty).
    -   The file name will be timestamped and include the source note's name and optionally the tags used for filtering (e.g., `Context-MySourceNote-Tags-project-a-important-20250406-135600.md`).
    -   This file will contain the filtered content from the source note and its linked notes.

## Settings Explained

-   **Export Folder Name:**
    -   The name of the folder within your vault where the context files will be saved.
    -   If left empty, files will be saved in the root of your vault.
    -   Example: `ContextExports`
-   **Include Privacy Levels:**
    -   A comma-separated list of values for the `privacy` key in note frontmatter. Only notes with a matching privacy value will have their _content_ included.
    -   Case-insensitive.
    -   Add the special value `none` to include notes that _do not_ have a `privacy` key in their frontmatter.
    -   Example: `public, internal, none`
-   **Required Tags (Optional):**
    -   A comma-separated list of tags (without the leading `#`).
    -   If tags are listed here, _all_ included notes (source and linked) must have at least _one_ of these tags _in addition to_ matching the privacy level filter.
    -   Leave empty to only filter based on the `privacy` level.
    -   Example: `project-x, important-client`
-   **Link Depth:**
    -   Determines how many levels of outgoing links to follow from the active note.
    -   `1` means only include the active note and notes directly linked from it.
    -   `2` means include the active note, its direct links, and the notes linked from _those_ notes, and so on.
    -   Notes at _all_ levels must pass the privacy and tag filters for their content to be included in the export file.
    -   Must be 1 or greater.

## Installation

1.  Ensure Community Plugins are enabled in Obsidian settings (Settings -> Community Plugins -> Turn on Community plugins).
2.  Browse Community Plugins and search for "My Context Fetcher".
3.  Click "Install".
4.  Click "Enable".

Alternatively, use the BRAT plugin to install using the repository URL (if available) or manually install by downloading the latest release files (`main.js`, `manifest.json`, `styles.css`) and placing them in your vault's plugin folder (`YourVault/.obsidian/plugins/my-context-fetcher/`).

## License

[MIT License](LICENSE)
