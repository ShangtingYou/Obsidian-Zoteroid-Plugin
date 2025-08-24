import { App, Modal, Notice, Plugin, PluginSettingTab, Setting, TFile, normalizePath  } from 'obsidian';

/* ---------------------------
   Settings interface & default
   --------------------------- */
interface LiteratureSettings {
  literatureRoot: string; // path relative to vault root, e.g. "Literature"
  literatureOverviewPagePath: string; // full path including file name
}
const DEFAULT_SETTINGS: LiteratureSettings = {
  literatureRoot: 'Literature',
  literatureOverviewPagePath: 'Literature Overview.md'
};

/* ---------------------------
   Helper utils
   --------------------------- */
function sanitizeForPath(name: string): string {
  // Replace forward slash and other illegal file name chars with underscore
  // illegal chars for most filesystems: <>:"/\\|?* and control chars
  return name.replace(/[<>:"\/\\|?*\x00-\x1F]/g, '_').trim();
}

function extractYearFromCrossref(message: any): string {
  // Crossref usually uses issued.date-parts: [[YYYY,MM,DD], ...]
  try {
    const parts = message.issued?.['date-parts']?.[0];
    if (parts && parts.length > 0) return String(parts[0]);
  } catch (e) {}
  // fallback: published-print or published-online
  try {
    const parts = message['published-print']?.['date-parts']?.[0] ||
                  message['published-online']?.['date-parts']?.[0];
    if (parts && parts.length > 0) return String(parts[0]);
  } catch (e) {}
  return 'UnknownYear';
}

function stripHtmlTags(html?: string): string {
  if (!html) return '';
  return html.replace(/<[^>]*>/g, '').trim();
}

/* ---------------------------
   Modal: simple input + button
   --------------------------- */
class DoiModal extends Modal {
  private onSearch: (doi: string) => Promise<void>;
  constructor(app: App, onSearch: (doi: string) => Promise<void>) {
    super(app);
    this.onSearch = onSearch;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.createEl('h3', { text: 'Import literature by DOI' });

    const input = contentEl.createEl('input', { type: 'text' }) as HTMLInputElement;
    input.placeholder = 'Paste DOI here (e.g. 10.1038/s41586-020-2649-2)';
    input.style.width = '100%';
    input.style.marginBottom = '8px';

    const btn = contentEl.createEl('button', { text: 'Search' }) as HTMLButtonElement;
    btn.onclick = async () => {
      const raw = input.value.trim();
      const doiMatch = raw.match(/(10\.\d{4,9}\/[-._;()\/:A-Z0-9]+)/i);
      if (!doiMatch) {
        new Notice('Invalid DOI or DOI URL');
        return;
      }
      const doi = doiMatch[1];                           // Pure DOI format
      // call handler
      await this.onSearch(doi);
      this.close();
    };

    input.addEventListener('keydown', async (e) => {
      if (e.key === 'Enter') {
        btn.click();
      }
    });

    // autofocus
    setTimeout(() => input.focus(), 50);
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}

class OverviewModal extends Modal {
  private onGenerate: () => Promise<void>;
  constructor(app: App, onGenerate: () => Promise<void>) {
    super(app);
    this.onGenerate = onGenerate;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.createEl('h3', { text: 'Generate (overwrite) literature overview?' });

    const btn = contentEl.createEl('button', { text: 'Generate' }) as HTMLButtonElement;
    btn.onclick = async () => {
      await this.onGenerate();
      this.close();
    };
    
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}

/* ---------------------------
   Plugin class
   --------------------------- */
export default class LiteraturePlugin extends Plugin {
  settings: LiteratureSettings;

  async onload() {
    await this.loadSettings();

    // add ribbon icon
    this.addRibbonIcon('microscope', 'Import literature by DOI', () => {
      new DoiModal(this.app, async (doi) => {
        await this.handleDOI(doi);
      }).open();
    });

    this.addRibbonIcon('brain', 'Generate literature overview page', () => {
    //  this.generateOverviewPage();
      new OverviewModal(this.app, async () => {
        await this.generateOverviewPage();
      }).open();
    });

    // test, will be deleted
    // this.addRibbonIcon('dice', 'Say hello', () => {
    //   new Notice('Hello from the ribbon by SY!');
    // });
    // end of test

    // add settings tab
    this.addSettingTab(new LiteratureSettingTab(this.app, this));
  }

  onunload() {
    // nothing special
  }

  async generateOverviewPage()
  {
    // Check/create overview page
    const overviewContent = [
      `---\n`,
      `type: ZoteroidOverview`,
      `---\n\n\n`,
      `### Filtered Paper`,
      `\`\`\`dataview`,
      `TABLE Journal, Title, Year, Keyword`,
      `FROM \"${this.settings.literatureRoot}\"`,
      `WHERE type = \"ZoteroidRecord\"`,
      ``,
      `// change here to filter by keyword, journal, year, etc.`,
      `WHERE (contains(Keyword, \"#keyword1\") or contains(Keyword, \"")) and contains(journal, "") and (year > 1949)`,
      ``,
      `// change here to sort by date added or publish year, in ASC or DESC order`,
      `// SORT Year DESC`,
      `SORT date DESC`,
      `\`\`\``,
      ``,
      `### All Keywords`,
      `\`\`\`dataview`,
      `LIST WITHOUT ID Keyword`,
      `FROM \"${this.settings.literatureRoot}\"`,
      `WHERE Keyword`,
      `FLATTEN Keyword`,
      'GROUP BY Keyword',
      `SORT Keyword ASC`,
      `\`\`\``,
      ``,
      `### All Journals`,
      `\`\`\`dataview`,
      `LIST WITHOUT ID Journal`,
      `FROM \"${this.settings.literatureRoot}\"`,
      `WHERE Journal`,
      `FLATTEN Journal`,
      'GROUP BY Journal',
      `SORT Journal ASC`,
      `\`\`\``,
      ``,
      `### All Labs`,
      `\`\`\`dataview`,
      `LIST WITHOUT ID Lab`,
      `FROM \"${this.settings.literatureRoot}\"`,
      `WHERE Lab`,
      `FLATTEN Lab`,
      'GROUP BY Lab',
      `SORT Lab ASC`,
      `\`\`\``,
      `\n\n\nTo correctly display this page, you need to install Dataview plug-in.`,
    ];

    if (this.settings.literatureOverviewPagePath) {
				const overviewPath = normalizePath(this.settings.literatureOverviewPagePath);
        const file = this.app.vault.getAbstractFileByPath(overviewPath);

        if(file instanceof TFile){
            await this.app.vault.modify(
						file,
						overviewContent.join('\n')
					).catch(() => {});
					new Notice("Overwritten literature overview page");
        }

				else {       
					await this.app.vault.create(
						overviewPath,
						overviewContent.join('\n')
					).catch(() => {});
					new Notice("Created literature overview page");
				}

      if(file instanceof TFile)
        this.app.workspace.getLeaf(false).openFile(file);
  
			}
  }
  async handleDOI(rawDoi: string) {
    
    const doi = rawDoi.trim();
    // Crossref API: GET https://api.crossref.org/works/{doi}
    const url = `https://api.crossref.org/works/${encodeURIComponent(doi)}`;

    let resp;
    try {
      resp = await fetch(url, { method: 'GET' });
    } catch (e) {
      console.error('Network error when checking DOI', e);
      new Notice('Network error when checking DOI');
      return;
    }

    if (!resp.ok) {
      // DOI doesn't resolve or other error
      new Notice('DOI does not exist');
      return;
    }

    let data: any;
    try {
      data = await resp.json();
    } catch (e) {
      console.error('Error parsing Crossref JSON', e);
      new Notice('Error reading DOI metadata');
      return;
    }

    const message = data.message;
    if (!message) {
      new Notice('DOI does not exist');
      return;
    }

    const pubType = message.type || '';
    const year = extractYearFromCrossref(message);
    const title = (Array.isArray(message.title) && message.title[0]) ? message.title[0] : (message.title || 'Untitled');
    let journal = '';
    if (Array.isArray(message['container-title']) && message['container-title'][0]) {
      journal = message['container-title'][0];
    }
    let filenameBase = '';
    if (pubType.includes('journal')) {
      filenameBase = `${journal} - ${year} - ${title}`;
    } else if (pubType.includes('book')) {
      filenameBase = `BOOK - ${year} - ${title}`;
    } else {
      // fallback: treat as article
      filenameBase = `${journal || 'UNKNOWN'} - ${year} - ${title}`;
    }
    const filenameBaseTrim = filenameBase.substring(0,100).trim();

    // Determine DOI folder name (replace slashes)
    // const doiFolderName = sanitizeForPath(doi.replace(/\//g, '_'));
    // const doiFolderNameRaw = `${journal || 'UNKNOWN'} - ${year} - ${title}`;
    // const doiFolderName = sanitizeForPath(doiFolderNameRaw.replace(/\//g, '_'));
    const doiFolderName = sanitizeForPath(filenameBaseTrim);
    // Root dir (user provided)
    const root = this.settings.literatureRoot || DEFAULT_SETTINGS.literatureRoot;
    // Compose folder path relative to vault root
    const folderPath = root.endsWith('/') ? `${root}${doiFolderName}` : `${root}/${doiFolderName}`;

    // Check/create folder
    const existingFolder = this.app.vault.getAbstractFileByPath(folderPath);
    if (!existingFolder) {
      try {
        await this.app.vault.createFolder(folderPath);
      } catch (e) {
        console.error('Error creating folder', e);
        new Notice('Failed to create folder. Check that literature root exists and is writable.');
        return;
      }
    }

    // Compose file name
    const fileNameSafe = sanitizeForPath(filenameBaseTrim) + '.md';
    const filePath = `${folderPath}/${fileNameSafe}`;

    // Check if file exists
    const existingFile = this.app.vault.getAbstractFileByPath(filePath);
    if (existingFile) {
      new Notice('Record already exists, if you want to re-create it, please delete the old one and try again.');
      // open it
      if (existingFile instanceof TFile) {
        this.app.workspace.getLeaf(false).openFile(existingFile);
      }
      return;
    }

    // Build file content (third-level headings)
    const dateAdded = new Date().toISOString().split('T')[0]; 
    const abstractRaw = message.abstract ? stripHtmlTags(message.abstract) : '';
    const doiUrl = `https://doi.org/${doi}`;          // URL format for content

    type CrossrefAuthor = {
      given?: string;
      family?: string;
      literal?: string;
    };
    const rawAuthors = data.message.author || [];
    const authorNames = rawAuthors.map((author: CrossrefAuthor) => {
      if (!author) return '';
      if (author.literal) return author.literal;
      const given = author.given ?? '';
      const family = author.family ?? '';
      return `${given}${given && family ? ' ' : ''}${family}`.trim();
    }).filter(Boolean).join('; ');

    const contentLines = [
      /*
      `### Title\n\n${title}\n`,
      `### DOI\n\n${doiUrl}\n`,
      `### Journal\n\n${journal || ''}\n`,
      `### Year\n\n${year}\n`,
      `### Abstract\n\n${abstractRaw}\n`,
      `### Keywords\n\n\n`,
      `### Research group\n\n\n`,
      `### Main idea\n\n\n`,
      `### Materials and methods\n\n\n`,
      `### Comment\n\n\n`
      */
      `---\n`,
      `type: ZoteroidRecord`,
      `date: ${dateAdded}`,
      `---\n\n\n`,
      `### Title\n(Title:: ${title})\n`,
      `### Journal\n(Journal:: ${journal || ''})\n`,
      `### Year\n(Year:: ${year})\n`,
      `### DOI\n(DOI:: ${doiUrl})\n`,
      `### Lab\n(Lab:: #nobody)\n`,
      `### Keyword\n(Keyword:: #keyword1)\n(Keyword:: #keyword2)\n`,
      `### Authors\n${authorNames}`,
      `### Abstract\n${abstractRaw}\n`,
      `### Main idea\n\n\n`,
      `### Materials and methods\n\n\n`,
      `### Comment\n\n\n`
    ];
    const fileContent = contentLines.join('\n');

    try {
      const created = await this.app.vault.create(filePath, fileContent);
      new Notice('Record successfully created');
      this.app.workspace.getLeaf(false).openFile(created);
    } catch (e) {
      console.error('Error creating file', e);
      new Notice('Failed to create file.');
    }
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}

/* ---------------------------
   Settings tab UI
   --------------------------- */
class LiteratureSettingTab extends PluginSettingTab {
  plugin: LiteraturePlugin;

  constructor(app: App, plugin: LiteraturePlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl('h2', { text: 'Literature Manager Settings' });

    new Setting(containerEl)
      .setName('Literature root directory')
      .setDesc('Path inside your vault where literature folders will be created (e.g. Literature or assets/literature). Folder will be created if not present.')
      .addText(text => text
        .setPlaceholder('Literature')
        .setValue(this.plugin.settings.literatureRoot)
        .onChange(async (value) => {
          this.plugin.settings.literatureRoot = value.trim();
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
			.setName('Literature overview page')
			.setDesc('Full path and file name for the overview page')
			.addText(text => text
				.setPlaceholder('Example: Literature/Overview.md')
				.setValue(this.plugin.settings.literatureOverviewPagePath)
				.onChange(async (value) => {
					this.plugin.settings.literatureOverviewPagePath = value.trim();
					await this.plugin.saveSettings();
				}));
  }
}
