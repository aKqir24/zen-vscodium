"use strict";
/**
 * Matugen Theme Extension
 *
 * Architecture:
 * 1. Hash-based caching - Only regenerate themes when colors actually change
 * 2. Multi-strategy file watching - Combines chokidar + polling fallback
 * 3. Atomic writes - Prevents partial theme files
 * 4. Smart initialization - Syncs on startup if out of date
 * 5. Graceful degradation - Works even if watching fails
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const fs = __importStar(require("fs"));
const fs_1 = require("fs");
const path = __importStar(require("path"));
const os = __importStar(require("os"));
const crypto = __importStar(require("crypto"));
const chokidar = __importStar(require("chokidar"));
const color_1 = __importDefault(require("color"));
const template_1 = __importDefault(require("./template"));
// ============================================================================
// Constants
// ============================================================================
const EXTENSION_VERSION = '1.0.0';
const CACHE_DIR = '.cache/matugen';
const COLORS_FILE = 'vscode-colors';
const COLORS_JSON_FILE = 'vscode-colors.json';
const CACHE_STATE_FILE = '.matugen-theme-cache.json';
const THEMES_DIR = path.join(__dirname, '..', 'themes');
const REQUIRED_COLORS_COUNT = 16;
// Timing constants
const DEBOUNCE_DELAY_MS = 500;
const POLLING_INTERVAL_MS = 5000;
const STARTUP_DELAY_MS = 500;
const WATCHER_STABILITY_MS = 300;
// Paths
const matugenCachePath = path.join(os.homedir(), CACHE_DIR);
const matugenColorsPath = path.join(matugenCachePath, COLORS_FILE);
const matugenColorsJsonPath = path.join(matugenCachePath, COLORS_JSON_FILE);
const cacheStatePath = path.join(THEMES_DIR, CACHE_STATE_FILE);
// ============================================================================
// State Management
// ============================================================================
class ThemeManager {
    constructor() {
        this.watcher = null;
        this.pollingInterval = null;
        this.debounceTimer = null;
        this.isGenerating = false;
        this.lastKnownHash = null;
        this.context = null;
        this.statusBarItem = null;
    }
    // ========================================================================
    // Lifecycle
    // ========================================================================
    async initialize(context) {
        this.context = context;
        this.createStatusBarItem();
        // Register commands
        context.subscriptions.push(vscode.commands.registerCommand('matugenTheme.update', () => this.forceUpdate()), vscode.commands.registerCommand('matugenTheme.clearCache', () => this.clearCache()));
        // Setup configuration listener
        context.subscriptions.push(vscode.workspace.onDidChangeConfiguration((event) => {
            if (event.affectsConfiguration('matugenTheme')) {
                this.handleConfigChange();
            }
        }));
        // Initial sync after short delay to not block activation
        setTimeout(() => this.performInitialSync(), STARTUP_DELAY_MS);
        // Start watching if auto-update is enabled
        if (this.isAutoUpdateEnabled()) {
            this.startWatching();
        }
    }
    dispose() {
        this.stopWatching();
        this.statusBarItem?.dispose();
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
            this.debounceTimer = null;
        }
    }
    // ========================================================================
    // Status Bar
    // ========================================================================
    createStatusBarItem() {
        this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
        this.statusBarItem.command = 'matugenTheme.update';
        this.statusBarItem.tooltip = 'Matugen Theme - Click to update';
        this.context?.subscriptions.push(this.statusBarItem);
    }
    updateStatusBar(state) {
        if (!this.statusBarItem) {
            return;
        }
        switch (state) {
            case 'syncing':
                this.statusBarItem.text = '$(sync~spin) Matugen';
                this.statusBarItem.backgroundColor = undefined;
                this.statusBarItem.show();
                break;
            case 'error':
                this.statusBarItem.text = '$(error) Matugen';
                this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
                this.statusBarItem.show();
                setTimeout(() => this.updateStatusBar('idle'), 3000);
                break;
            case 'success':
                this.statusBarItem.text = '$(check) Matugen';
                this.statusBarItem.backgroundColor = undefined;
                this.statusBarItem.show();
                setTimeout(() => this.updateStatusBar('idle'), 2000);
                break;
            case 'idle':
            default:
                this.statusBarItem.hide();
                break;
        }
    }
    // ========================================================================
    // Configuration
    // ========================================================================
    isAutoUpdateEnabled() {
        return vscode.workspace.getConfiguration('matugenTheme').get('autoUpdate', true);
    }
    handleConfigChange() {
        const autoUpdate = this.isAutoUpdateEnabled();
        if (autoUpdate && !this.watcher) {
            this.startWatching();
            vscode.window.showInformationMessage('Matugen Theme: Auto-update enabled');
        }
        else if (!autoUpdate && this.watcher) {
            this.stopWatching();
            vscode.window.showInformationMessage('Matugen Theme: Auto-update disabled');
        }
    }
    // ========================================================================
    // File Watching (Multi-Strategy)
    // ========================================================================
    startWatching() {
        this.startFileWatcher();
        this.startPollingFallback();
        console.log('Matugen Theme: Started watching for color changes');
    }
    stopWatching() {
        if (this.watcher) {
            this.watcher.close();
            this.watcher = null;
        }
        if (this.pollingInterval) {
            clearInterval(this.pollingInterval);
            this.pollingInterval = null;
        }
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
            this.debounceTimer = null;
        }
        console.log('Matugen Theme: Stopped watching');
    }
    startFileWatcher() {
        try {
            this.watcher = chokidar.watch([matugenColorsPath, matugenColorsJsonPath], {
                ignoreInitial: true,
                persistent: true,
                usePolling: false,
                awaitWriteFinish: {
                    stabilityThreshold: WATCHER_STABILITY_MS,
                    pollInterval: 100,
                },
                ignorePermissionErrors: true,
            });
            this.watcher.on('change', () => this.scheduleUpdate('watcher'));
            this.watcher.on('add', () => this.scheduleUpdate('watcher'));
            this.watcher.on('error', (error) => {
                console.error('Matugen Theme: Watcher error:', error);
                // Don't show error to user, polling fallback will handle it
            });
        }
        catch (error) {
            console.error('Matugen Theme: Failed to create watcher:', error);
            // Polling fallback will handle updates
        }
    }
    startPollingFallback() {
        // Polling as a fallback mechanism
        // Checks hash periodically in case watcher misses changes
        this.pollingInterval = setInterval(async () => {
            try {
                const currentHash = await this.computeColorsHash();
                if (currentHash && this.lastKnownHash && currentHash !== this.lastKnownHash) {
                    console.log('Matugen Theme: Polling detected change');
                    this.scheduleUpdate('polling');
                }
            }
            catch {
                // Ignore polling errors silently
            }
        }, POLLING_INTERVAL_MS);
    }
    scheduleUpdate(source) {
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
        }
        this.debounceTimer = setTimeout(async () => {
            this.debounceTimer = null;
            console.log(`Matugen Theme: Update triggered by ${source}`);
            await this.syncThemes(false);
        }, DEBOUNCE_DELAY_MS);
    }
    // ========================================================================
    // Caching
    // ========================================================================
    async computeColorsHash() {
        try {
            const colorsContent = await fs_1.promises.readFile(matugenColorsPath, 'utf-8');
            let jsonContent = '';
            try {
                jsonContent = await fs_1.promises.readFile(matugenColorsJsonPath, 'utf-8');
            }
            catch {
                // colors.json is optional
            }
            const combined = colorsContent + jsonContent;
            return crypto.createHash('md5').update(combined).digest('hex');
        }
        catch {
            return null;
        }
    }
    async loadCacheState() {
        try {
            const data = await fs_1.promises.readFile(cacheStatePath, 'utf-8');
            return JSON.parse(data);
        }
        catch {
            return null;
        }
    }
    async saveCacheState(hash) {
        const state = {
            colorsHash: hash,
            lastUpdated: Date.now(),
            version: EXTENSION_VERSION,
        };
        try {
            await fs_1.promises.writeFile(cacheStatePath, JSON.stringify(state, null, 2), 'utf-8');
        }
        catch (error) {
            console.warn('Matugen Theme: Failed to save cache state:', error);
        }
    }
    async isCacheValid() {
        const currentHash = await this.computeColorsHash();
        if (!currentHash) {
            return { valid: false, currentHash: null };
        }
        const cacheState = await this.loadCacheState();
        if (!cacheState) {
            return { valid: false, currentHash };
        }
        // Invalidate cache if extension version changed
        if (cacheState.version !== EXTENSION_VERSION) {
            console.log('Matugen Theme: Cache invalidated due to version change');
            return { valid: false, currentHash };
        }
        // Check if hash matches
        const valid = cacheState.colorsHash === currentHash;
        return { valid, currentHash };
    }
    async clearCache() {
        try {
            await fs_1.promises.unlink(cacheStatePath);
            this.lastKnownHash = null;
            vscode.window.showInformationMessage('Matugen Theme: Cache cleared');
        }
        catch {
            // Cache file might not exist
        }
    }
    // ========================================================================
    // Theme Generation
    // ========================================================================
    async performInitialSync() {
        // Check if matugen colors exist
        if (!fs.existsSync(matugenColorsPath)) {
            console.log('Matugen Theme: No colors file found, skipping initial sync');
            return;
        }
        // Check cache validity
        const { valid, currentHash } = await this.isCacheValid();
        if (valid) {
            console.log('Matugen Theme: Cache is valid, skipping regeneration');
            this.lastKnownHash = currentHash;
            return;
        }
        // Themes need to be regenerated
        console.log('Matugen Theme: Initial sync - regenerating themes');
        await this.syncThemes(false);
    }
    async forceUpdate() {
        await this.syncThemes(true);
    }
    async syncThemes(showFeedback) {
        // Prevent concurrent generation
        if (this.isGenerating) {
            console.log('Matugen Theme: Generation already in progress');
            return { success: false, cached: false };
        }
        this.isGenerating = true;
        this.updateStatusBar('syncing');
        try {
            // Check if we can skip regeneration (unless forced)
            if (!showFeedback) {
                const { valid, currentHash } = await this.isCacheValid();
                if (valid) {
                    console.log('Matugen Theme: Skipping - cache is valid');
                    this.lastKnownHash = currentHash;
                    this.updateStatusBar('idle');
                    return { success: true, cached: true };
                }
            }
            // Load and validate colors
            const colors = await this.loadColors();
            // Compute hash for caching
            const currentHash = await this.computeColorsHash();
            // Generate themes atomically
            await this.generateThemesAtomically(colors);
            // Update cache state
            if (currentHash) {
                await this.saveCacheState(currentHash);
                this.lastKnownHash = currentHash;
            }
            this.updateStatusBar('success');
            if (showFeedback) {
                vscode.window.showInformationMessage('Matugen Theme: Themes updated successfully!');
            }
            return { success: true, cached: false };
        }
        catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            this.updateStatusBar('error');
            if (showFeedback) {
                this.showError(err);
            }
            else {
                console.error('Matugen Theme:', err.message);
            }
            return { success: false, cached: false, error: err };
        }
        finally {
            this.isGenerating = false;
        }
    }
    async generateThemesAtomically(colors) {
        await this.ensureThemesDirectory();
        // Generate all theme content first
        const themes = [
            { fileName: 'matugen.json', content: JSON.stringify((0, template_1.default)(colors, false), null, 4) },
            {
                fileName: 'matugen-bordered.json',
                content: JSON.stringify((0, template_1.default)(colors, true), null, 4),
            },
        ];
        // Write to temp files first, then rename (atomic operation)
        const writeOperations = themes.map(async ({ fileName, content }) => {
            const finalPath = path.join(THEMES_DIR, fileName);
            const tempPath = `${finalPath}.tmp`;
            try {
                // Write to temp file
                await fs_1.promises.writeFile(tempPath, content, 'utf-8');
                // Atomic rename
                await fs_1.promises.rename(tempPath, finalPath);
            }
            catch (error) {
                // Clean up temp file if it exists
                try {
                    await fs_1.promises.unlink(tempPath);
                }
                catch {
                    // Ignore cleanup errors
                }
                throw error;
            }
        });
        await Promise.all(writeOperations);
    }
    async ensureThemesDirectory() {
        try {
            await fs_1.promises.access(THEMES_DIR);
        }
        catch {
            await fs_1.promises.mkdir(THEMES_DIR, { recursive: true });
        }
    }
    // ========================================================================
    // Color Loading
    // ========================================================================
    async loadColors() {
        const colors = await this.readBaseColors();
        return await this.enhanceWithJsonColors(colors);
    }
    async readBaseColors() {
        if (!fs.existsSync(matugenColorsPath)) {
            throw new Error('Matugen colors file not found.\n\n' +
                'Please run matugen to generate a color palette.\n' +
                `Expected: ${matugenColorsPath}\n\n` +
                'See: https://github.com/InioX/matugen');
        }
        const colorsData = await fs_1.promises.readFile(matugenColorsPath, 'utf-8');
        const colorStrings = colorsData
            .trim()
            .split(/\s+/)
            .filter((s) => s.length > 0);
        if (colorStrings.length < REQUIRED_COLORS_COUNT) {
            throw new Error(`Invalid colors file: Found ${colorStrings.length} colors, need ${REQUIRED_COLORS_COUNT}.\n` +
                'Please regenerate with matugen.');
        }
        const colors = [];
        for (let i = 0; i < REQUIRED_COLORS_COUNT; i++) {
            try {
                colors.push((0, color_1.default)(colorStrings[i]));
            }
            catch {
                throw new Error(`Invalid color at position ${i}: "${colorStrings[i]}"`);
            }
        }
        return colors;
    }
    async enhanceWithJsonColors(colors) {
        if (!fs.existsSync(matugenColorsJsonPath)) {
            return colors;
        }
        try {
            const jsonData = await fs_1.promises.readFile(matugenColorsJsonPath, 'utf-8');
            const parsed = this.parseColorJson(jsonData);
            if (parsed?.special?.background) {
                try {
                    colors[0] = (0, color_1.default)(parsed.special.background);
                }
                catch {
                    console.warn('Matugen Theme: Invalid background in colors.json');
                }
            }
            if (parsed?.special?.foreground) {
                try {
                    colors[7] = (0, color_1.default)(parsed.special.foreground);
                }
                catch {
                    console.warn('Matugen Theme: Invalid foreground in colors.json');
                }
            }
        }
        catch (error) {
            console.warn('Matugen Theme: Could not parse colors.json:', error);
        }
        return colors;
    }
    parseColorJson(jsonData) {
        try {
            return JSON.parse(jsonData);
        }
        catch {
            // Try to fix common issues (unescaped Windows paths)
            try {
                const fixed = jsonData
                    .split('\n')
                    .filter((line) => !line.includes('wallpaper') || !line.includes('\\'))
                    .join('\n');
                return JSON.parse(fixed);
            }
            catch {
                return null;
            }
        }
    }
    // ========================================================================
    // Error Handling
    // ========================================================================
    showError(error) {
        const message = error.message.includes('Matugen') || error.message.includes('Invalid')
            ? error.message
            : `Matugen Theme Error: ${error.message}`;
        vscode.window.showErrorMessage(message, 'Documentation', 'Retry').then((selection) => {
            if (selection === 'Documentation') {
                vscode.env.openExternal(vscode.Uri.parse('https://github.com/InioX/matugen'));
            }
            else if (selection === 'Retry') {
                this.forceUpdate();
            }
        });
    }
}
// ============================================================================
// Extension Entry Points
// ============================================================================
let themeManager = null;
async function activate(context) {
    themeManager = new ThemeManager();
    await themeManager.initialize(context);
    console.log('Matugen Theme: Extension activated');
}
function deactivate() {
    themeManager?.dispose();
    themeManager = null;
    console.log('Matugen Theme: Extension deactivated');
}
//# sourceMappingURL=extension.js.map