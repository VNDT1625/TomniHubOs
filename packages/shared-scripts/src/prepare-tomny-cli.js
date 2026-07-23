/**
 * Build and stage the Tomny CLI runtime for desktop packaging.
 *
 * Tomny starts from the Apache-2.0 aionrs codebase at a pinned upstream commit.
 * The source is compiled locally after applying the Tomny product namespace;
 * the desktop runtime never launches or calls AionCore.
 */

const { execFileSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  artifactManifestMatches,
  assertPinnedCommit,
  sealSourceCache,
  sha256File,
  validateReusableSource,
} = require('./source-build-identity');

const UPSTREAM_REPOSITORY = 'https://github.com/iOfficeAI/aionrs.git';
const SOURCE_PATCH_VERSION =
  'tool-result-v2+context-inspection-v2+surface-catalog-v1+session-history-v1+action-gate-v6';
const SOURCE_PATCHES = [
  {
    version: 'tool-result-v2',
    path: path.join(__dirname, 'tomny-tool-result.patch'),
  },
  {
    version: 'context-inspection-v2',
    path: path.join(__dirname, 'tomny-context-inspection.patch'),
  },
].map((patch) => ({
  ...patch,
  sha256: crypto.createHash('sha256').update(fs.readFileSync(patch.path)).digest('hex'),
}));
const SOURCE_PATCH_SHA256 = crypto
  .createHash('sha256')
  .update(SOURCE_PATCHES.map((patch) => `${patch.version}:${patch.sha256}`).join('\n'))
  .digest('hex');
const SOURCE_PATCH_CACHE_KEY = crypto
  .createHash('sha256')
  .update(`${SOURCE_PATCH_VERSION}:${SOURCE_PATCH_SHA256}`)
  .digest('hex');
const RECIPE_IDENTITY = `tomny-cli-${SOURCE_PATCH_VERSION}-${SOURCE_PATCH_SHA256}`;

const targetTriple = (platform, arch) => {
  const targets = {
    'darwin-x64': 'x86_64-apple-darwin',
    'darwin-arm64': 'aarch64-apple-darwin',
    'linux-x64': 'x86_64-unknown-linux-gnu',
    'linux-arm64': 'aarch64-unknown-linux-gnu',
    'win32-x64': 'x86_64-pc-windows-msvc',
    'win32-arm64': 'aarch64-pc-windows-msvc',
  };
  return targets[`${platform}-${arch}`] || null;
};

const binaryName = (platform) => (platform === 'win32' ? 'tomny.exe' : 'tomny');

const walkTextFiles = (directory, files = []) => {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'target') continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      walkTextFiles(fullPath, files);
    } else if (/\.(?:rs|toml|md)$/u.test(entry.name)) {
      files.push(fullPath);
    }
  }
  return files;
};

const patchTomnyBranding = (sourceDir) => {
  for (const filePath of walkTextFiles(sourceDir)) {
    const before = fs.readFileSync(filePath, 'utf8');
    let after = before.replaceAll('AionRS', 'Tomny').replaceAll('Aionrs', 'Tomny').replaceAll('aionrs', 'tomny');

    if (after !== before) fs.writeFileSync(filePath, after);
  }
};

const replaceRequired = (filePath, replacements) => {
  const before = fs.readFileSync(filePath, 'utf8');
  const eol = before.includes('\r\n') ? '\r\n' : '\n';
  let after = before.replaceAll('\r\n', '\n');
  for (const [from, to] of replacements) {
    if (!after.includes(from)) throw new Error(`Tomny surface catalog patch anchor was not found in ${filePath}`);
    after = after.replace(from, to);
  }
  fs.writeFileSync(filePath, eol === '\n' ? after : after.replaceAll('\n', eol));
};

/** Add host-selected surface filtering and Super aliases after the protocol patch is applied. */
const patchTomnySurfaceCatalog = (sourceDir) => {
  replaceRequired(path.join(sourceDir, 'crates', 'aion-agent', 'src', 'bootstrap.rs'), [
    [
      'use aion_tools::tool_search::{ActionSchemaState, StartActionTool, ToolSearchTool};',
      'use aion_tools::tool_search::{ActionSchemaState, SessionActionsTool, StartActionTool, ToolSearchTool};',
    ],
    [
      `        self.register_tool_search(&mut registry);
        let action_schema_state = self.register_action_tool(&mut registry);`,
      `        registry.register(Box::new(SessionActionsTool));
        let action_schema_state = self.register_action_tool(&mut registry);
        self.register_tool_search(&mut registry, Arc::clone(&action_schema_state));`,
    ],
    [
      `    fn register_tool_search(&self, registry: &mut ToolRegistry) {
        let tool_defs_snapshot = registry.to_tool_defs_filtered(|tool| self.tool_policy.allows(tool.name()));
        registry.register(Box::new(ToolSearchTool::new(tool_defs_snapshot)));
    }`,
      `    fn register_tool_search(
        &self,
        registry: &mut ToolRegistry,
        action_schema_state: Arc<RwLock<ActionSchemaState>>,
    ) {
        let tool_defs_snapshot = registry.to_tool_defs_filtered(|tool| {
            self.tool_policy.allows(tool.name()) && tool.name() != "StartAction"
        });
        if let Ok(mut state) = action_schema_state.write() {
            state.refresh_catalog(tool_defs_snapshot.clone());
        }
        registry.register(Box::new(ToolSearchTool::with_action_state(
            tool_defs_snapshot,
            action_schema_state,
        )));
    }`,
    ],
    [
      `    fn register_action_tool(&self, registry: &mut ToolRegistry) -> Arc<RwLock<ActionSchemaState>> {
        let surface_only = self
            .config
            .system_prompt
            .as_deref()
            .is_some_and(|prompt| prompt.starts_with("[TomnyExactSurfacePrompt]"));
        let state = Arc::new(RwLock::new(ActionSchemaState::new(surface_only)));
        registry.register(Box::new(StartActionTool::new(Arc::clone(&state))));
        state
    }`,
      `    fn register_action_tool(&self, registry: &mut ToolRegistry) -> Arc<RwLock<ActionSchemaState>> {
        let prompt = self.config.system_prompt.as_deref().unwrap_or_default();
        let surface_only = prompt.starts_with("[TomnyExactSurfacePrompt]");
        let alias_tools = prompt.lines().any(|line| line.trim() == "[TomnyToolCatalog] super");
        let tool_patterns = prompt
            .lines()
            .find_map(|line| line.strip_prefix("[TomnyToolPatterns] "))
            .map(|patterns| {
                patterns
                    .split(',')
                    .map(str::trim)
                    .filter(|pattern| !pattern.is_empty())
                    .map(str::to_string)
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        let state = Arc::new(RwLock::new(ActionSchemaState::with_catalog(
            surface_only,
            tool_patterns,
            alias_tools,
        )));
        registry.register(Box::new(StartActionTool::new(Arc::clone(&state))));
        state
    }`,
    ],
  ]);

  replaceRequired(path.join(sourceDir, 'crates', 'aion-agent', 'src', 'bootstrap_test.rs'), [
    [
      `        bootstrap.register_tool_search(&mut registry);

        let tool_search = registry.get("ToolSearch").expect("ToolSearch should be registered");`,
      `        let action_state = bootstrap.register_action_tool(&mut registry);
        bootstrap.register_tool_search(&mut registry, action_state);
        registry
            .get("StartAction")
            .expect("StartAction should be registered")
            .execute(json!({"goal": "test deferred catalog"}))
            .await;

        let tool_search = registry.get("ToolSearch").expect("ToolSearch should be registered");`,
    ],
    [
      `        assert!(denied.content.starts_with("No deferred tools matching"));`,
      `        assert!(denied.content.starts_with("No surface tools matching"));`,
    ],
  ]);

  replaceRequired(path.join(sourceDir, 'crates', 'aion-tools', 'src', 'tool_search.rs'), [
    ['use std::collections::BTreeSet;', 'use std::collections::{BTreeMap, BTreeSet};'],
    [
      `    surface_only: bool,
    tool_defs: Vec<ToolDef>,
    loaded: BTreeSet<String>,
    working_memory: Value,`,
      `    surface_only: bool,
    tool_patterns: Vec<String>,
    alias_tools: bool,
    tool_defs: Vec<ToolDef>,
    routes: BTreeMap<String, String>,
    loaded: BTreeSet<String>,
    working_memory: Value,`,
    ],
    [
      `    pub fn new(surface_only: bool) -> Self {
        Self {
            started: false,
            map_initialized: false,
            surface_only,
            tool_defs: Vec::new(),
            loaded: BTreeSet::new(),
            working_memory: json!({}),
        }
    }`,
      `    pub fn new(surface_only: bool) -> Self {
        Self::with_catalog(surface_only, vec!["*".to_string()], false)
    }

    pub fn with_catalog(surface_only: bool, tool_patterns: Vec<String>, alias_tools: bool) -> Self {
        Self {
            started: false,
            map_initialized: false,
            surface_only,
            tool_patterns,
            alias_tools,
            tool_defs: Vec::new(),
            routes: BTreeMap::new(),
            loaded: BTreeSet::new(),
            working_memory: json!({}),
        }
    }

    pub fn is_started(&self) -> bool {
        self.started
    }

    pub fn loaded_tool_defs(&self) -> Vec<ToolDef> {
        self.tool_defs
            .iter()
            .filter(|tool| self.loaded.contains(&tool.name))
            .cloned()
            .map(|mut tool| {
                // Loaded definitions must reach the provider with their full
                // schema. Leaving this true makes the OpenAI projector replace
                // required parameters with an empty deferred stub.
                tool.deferred = false;
                tool
            })
            .collect()
    }

    pub fn resolve_direct(&self, name: &str) -> Result<String, String> {
        if !self.started {
            return Err("Open the action gate with StartAction before calling a surface tool.".to_string());
        }
        if !self.loaded.contains(name) {
            return Err(format!("Tool {name} is not loaded. Use ToolSearch to load its exact schema."));
        }
        Ok(self.routes.get(name).cloned().unwrap_or_else(|| name.to_string()))
    }`,
    ],
    [
      `    pub fn reset_for_action(&mut self) {
        self.started = false;
    }`,
      `    pub fn reset_for_action(&mut self) {
        self.started = false;
        self.map_initialized = false;
        // Loaded schemas are session-scoped; refresh_catalog prunes entries that are no longer available.
        self.working_memory = json!({});
    }

    pub fn finish_action(&mut self) {
        self.started = false;
    }`,
    ],
    [
      `    pub fn refresh_catalog(&mut self, tool_defs: Vec<ToolDef>) {
        self.tool_defs = tool_defs;
        let available = self
            .tool_defs
            .iter()
            .map(|tool| tool.name.as_str())
            .collect::<BTreeSet<_>>();
        self.loaded.retain(|name| available.contains(name.as_str()));
    }`,
      `    pub fn refresh_catalog(&mut self, tool_defs: Vec<ToolDef>) {
        let mut candidates = tool_defs
            .into_iter()
            .filter(|tool| {
                self.tool_patterns
                    .iter()
                    .any(|pattern| Self::matches_pattern(&tool.name, pattern))
            })
            .collect::<Vec<_>>();
        if self.alias_tools {
            candidates.sort_by_key(|tool| !tool.name.starts_with("tomny_"));
        }

        let mut routes = BTreeMap::new();
        let mut visible_defs = Vec::new();
        for mut tool in candidates {
            let real_name = tool.name.clone();
            let visible_name = if self.alias_tools {
                Self::tomny_name(&real_name)
            } else {
                real_name.clone()
            };
            if routes.contains_key(&visible_name) {
                continue;
            }
            tool.name = visible_name.clone();
            routes.insert(visible_name, real_name);
            visible_defs.push(tool);
        }

        self.routes = routes;
        self.tool_defs = visible_defs;
        let available = self
            .tool_defs
            .iter()
            .map(|tool| tool.name.as_str())
            .collect::<BTreeSet<_>>();
        self.loaded.retain(|name| available.contains(name.as_str()));
    }

    fn matches_pattern(name: &str, pattern: &str) -> bool {
        pattern == "*" || name == pattern || pattern.strip_suffix('*').is_some_and(|prefix| name.starts_with(prefix))
    }

    fn tomny_name(name: &str) -> String {
        if name.starts_with("tomny_") {
            name.to_string()
        } else {
            format!("tomny_{name}")
        }
    }`,
    ],
    [
      `        Ok((
            name.to_string(),
            input.get("arguments").cloned().unwrap_or_else(|| json!({})),
        ))`,
      `        Ok((
            self.resolve_direct(name)?,
            input.get("arguments").cloned().unwrap_or_else(|| json!({})),
        ))`,
    ],
    [
      `            json!({"type":"object","properties":{"operation":{"const":"history"},"query":{"type":"string"}},"required":["operation","query"],"additionalProperties":false}),
`,
      '',
    ],
    [
      `            Some("history") => ToolResult {
                content: input
                    .get("_history_results")
                    .and_then(Value::as_str)
                    .unwrap_or("No matching retained history was found.")
                    .to_string(),
                is_error: false,
            },
`,
      '',
    ],
    [
      `            None => {
                state.started = true;
                let map = state.map("");
                ToolResult {
                    content: format!(
                        "Action started. {}\\nToolMap: {}\\nUse StartAction again with operation=search before running a surface tool.",
                        state.capability_summary(),
                        serde_json::to_string(&map).unwrap_or_default()
                    ),
                    is_error: false,
                }
            }`,
      `            None => {
                if state.started {
                    return ToolResult {
                        content: "Action gate is already open. Continue with ToolSearch or a loaded surface tool.".into(),
                        is_error: false,
                    };
                }
                state.started = true;
                let map = state.map("");
                ToolResult {
                    content: format!(
                        "Action gate opened. {}\\nToolMap: {}\\nSchema cache unchanged. Use ToolSearch to load exact schemas; schemas loaded by earlier actions remain available. Do not call StartAction again for this action.",
                        state.capability_summary(),
                        serde_json::to_string(&map).unwrap_or_default()
                    ),
                    is_error: false,
                }
            }`,
    ],
    [
      `        "Core action gateway. Start each user action here, then map capabilities, search exact tool schemas, maintain bounded context, or run a loaded surface tool through its nested schema."`,
      `        "Open the action gate once for the current user action. After it opens, use ToolSearch to load exact schemas and call loaded surface tools directly."`,
    ],
    [
      `pub struct ToolSearchTool {
    /// Snapshot of all tool definitions (taken at construction time).
    tool_defs: Vec<ToolDef>,
}`,
      `pub struct ToolSearchTool {
    /// Snapshot used when the tool runs outside the action-gated Core.
    tool_defs: Vec<ToolDef>,
    /// Shared gate state used to hydrate schemas without reopening StartAction.
    action_state: Option<Arc<RwLock<ActionSchemaState>>>,
}`,
    ],
    [
      `    pub fn new(tool_defs: Vec<ToolDef>) -> Self {
        Self { tool_defs }
    }`,
      `    pub fn new(tool_defs: Vec<ToolDef>) -> Self {
        Self {
            tool_defs,
            action_state: None,
        }
    }

    pub fn with_action_state(
        tool_defs: Vec<ToolDef>,
        action_state: Arc<RwLock<ActionSchemaState>>,
    ) -> Self {
        Self {
            tool_defs,
            action_state: Some(action_state),
        }
    }`,
    ],
    [
      `        let query_lower = query.to_lowercase();`,
      `        if let Some(action_state) = &self.action_state {
            let Ok(mut state) = action_state.write() else {
                return ToolResult {
                    content: "Action schema state is unavailable.".to_string(),
                    is_error: true,
                };
            };
            if !state.is_started() {
                return ToolResult {
                    content: "Open the action gate with StartAction before using ToolSearch.".to_string(),
                    is_error: true,
                };
            }
            let matches = state.search(query);
            let schemas = state
                .tool_defs
                .iter()
                .filter(|tool| matches.contains(&tool.name))
                .map(|tool| {
                    json!({
                        "name": tool.name,
                        "description": tool.description,
                        "parameters": tool.input_schema
                    })
                })
                .collect::<Vec<_>>();
            return ToolResult {
                content: if schemas.is_empty() {
                    format!("No surface tools matching \\"{query}\\" found.")
                } else {
                    format!(
                        "Loaded exact schemas. Call these tools directly; do not reopen StartAction.\\n{}",
                        serde_json::to_string_pretty(&schemas).unwrap_or_default()
                    )
                },
                is_error: false,
            };
        }

        let query_lower = query.to_lowercase();`,
    ],
    [
      `}
/// Built-in tool that searches for deferred tools and loads their full schema.`,
      `}

/// Host-provided, session-scoped action journal. The JSON-stream host supplies
/// the result before this fallback implementation executes.
pub struct SessionActionsTool;

#[async_trait]
impl Tool for SessionActionsTool {
    fn name(&self) -> &str {
        "tomny_session_actions"
    }

    fn description(&self) -> &str {
        "Read or search the bounded operational action/tool journal for the current Core session. It never returns conversation messages. Session identity is host-bound and cannot be selected by the model."
    }

    fn input_schema(&self) -> JsonSchema {
        json!({
            "type": "object",
            "properties": {
                "limit": {"type":"integer","minimum":1,"maximum":100,"default":20},
                "after_sequence": {"type":"integer","minimum":0},
                "query": {"type":"string","minLength":1,"maxLength":500}
            },
            "additionalProperties": false
        })
    }

    fn is_concurrency_safe(&self, _input: &Value) -> bool {
        true
    }

    async fn execute(&self, _input: Value) -> ToolResult {
        ToolResult {
            content: "Session action history is available only through the Tomny host.".into(),
            is_error: true,
        }
    }

    fn category(&self) -> ToolCategory {
        ToolCategory::Info
    }
}

/// Built-in tool that searches for deferred tools and loads their full schema.`,
    ],
  ]);

  replaceRequired(path.join(sourceDir, 'crates', 'aion-agent', 'src', 'engine.rs'), [
    [
      `        } else if self.action_schema_state.is_some() {
            self.tools
                .to_tool_defs_filtered(|tool| self.tool_policy.allows(tool.name()) && tool.name() == "StartAction")
        } else if self.plan_state.is_active {`,
      `        } else if let Some(action_state) = &self.action_schema_state {
            match action_state.read() {
                Ok(state) if state.is_started() => {
                    let mut tools = self.tools.to_tool_defs_filtered(|tool| {
                        self.tool_policy.allows(tool.name()) && tool.name() == "ToolSearch"
                    });
                    tools.extend(state.loaded_tool_defs());
                    tools
                }
                _ => self.tools.to_tool_defs_filtered(|tool| {
                    self.tool_policy.allows(tool.name()) && tool.name() == "StartAction"
                }),
            }
        } else if self.plan_state.is_active {`,
    ],
    [
      `                if name != "StartAction" {
                    return call.clone();
                }`,
      `                if name != "StartAction" {
                    if name == "ToolSearch" {
                        return call.clone();
                    }
                    let resolved = self
                        .action_schema_state
                        .as_ref()
                        .and_then(|state| state.read().ok())
                        .map(|state| state.resolve_direct(name));
                    return match resolved {
                        Some(Ok(tool)) => ContentBlock::ToolUse {
                            id: id.clone(),
                            name: tool,
                            input: input.clone(),
                            extra: extra.clone(),
                        },
                        Some(Err(error)) => ContentBlock::ToolUse {
                            id: id.clone(),
                            name: "StartAction".to_string(),
                            input: serde_json::json!({"_action_error": error}),
                            extra: extra.clone(),
                        },
                        None => call.clone(),
                    };
                }`,
    ],
    [
      `        self.run_inner(user_input, msg_id).instrument(span).await
    }`,
      `        let result = self.run_inner(user_input, msg_id).instrument(span).await;
        if let Some(action_state) = &self.action_schema_state {
            if let Ok(mut state) = action_state.write() {
                state.finish_action();
            }
            // The host owns canonical per-session conversation conclusions.
            // Tool calls/results remain in the durable action journal and must
            // never leak into the next model request.
            self.messages.clear();
            self.save_session();
        }
        result
    }`,
    ],
    [
      `    fn search_retained_history(&self, query: &str) -> String {
        let query = query.trim().to_lowercase();
        if query.is_empty() {
            return "HistorySearch requires a query.".to_string();
        }
        let mut matches = self
            .messages
            .iter()
            .rev()
            .filter_map(|message| serde_json::to_string(message).ok())
            .filter(|message| message.to_lowercase().contains(&query))
            .take(6)
            .map(|message| message.chars().take(2_000).collect::<String>())
            .collect::<Vec<_>>();
        matches.reverse();
        if matches.is_empty() {
            "No matching retained history was found.".to_string()
        } else {
            matches.join("\\n")
        }
    }

`,
      '',
    ],
    [
      `                if operation == Some("history") {
                    let mut next = input.clone();
                    let history =
                        self.search_retained_history(input.get("query").and_then(Value::as_str).unwrap_or(""));
                    if let Some(object) = next.as_object_mut() {
                        object.insert("_history_results".to_string(), Value::String(history));
                    }
                    return ContentBlock::ToolUse {
                        id: id.clone(),
                        name: name.clone(),
                        input: next,
                        extra: extra.clone(),
                    };
                }
`,
      '',
    ],
  ]);

  replaceRequired(path.join(sourceDir, 'crates', 'aion-tools', 'src', 'tool_search_test.rs'), [
    [
      `        assert!(state.read().unwrap().tool_cache().is_empty());
    }
}`,
      `        assert!(state.read().unwrap().tool_cache().is_empty());
    }

    #[test]
    fn session_actions_schema_cannot_select_another_session() {
        let tool = SessionActionsTool;
        let schema = tool.input_schema().to_string();

        assert_eq!(tool.name(), "tomny_session_actions");
        assert!(schema.contains("after_sequence"));
        assert!(schema.contains("query"));
        assert!(!schema.to_lowercase().contains("sessionid"));
        assert!(!schema.to_lowercase().contains("session_id"));
    }

    #[test]
    fn natural_language_search_keeps_exact_tool_name_token() {
        let mut state = ActionSchemaState::with_catalog(false, vec!["tomny_*".into()], false);
        state.refresh_catalog(vec![ToolDef {
            name: "tomny_session_actions".into(),
            description: "Read prior actions in this session".into(),
            input_schema: json!({"type":"object"}),
            deferred: true,
        }]);

        let matches = state.search("tomny_session_actions inspect prior actions in this session");

        assert_eq!(matches, vec!["tomny_session_actions"]);
    }

    #[test]
    fn surface_catalog_keeps_only_matching_tool_patterns() {
        let mut state = ActionSchemaState::with_catalog(false, vec!["ide_*".into()], false);
        state.refresh_catalog(vec![
            ToolDef {
                name: "ide_read".into(),
                description: "Read project files".into(),
                input_schema: json!({"type":"object"}),
                deferred: true,
            },
            ToolDef {
                name: "browser_open".into(),
                description: "Open browser".into(),
                input_schema: json!({"type":"object"}),
                deferred: true,
            },
        ]);

        let map = state.map("");
        assert!(map.to_string().contains("ide_read"));
        assert!(!map.to_string().contains("browser_open"));
    }

    #[test]
    fn super_catalog_aliases_visible_tools_and_routes_to_real_names() {
        let mut state = ActionSchemaState::with_catalog(false, vec!["*".into()], true);
        state.refresh_catalog(vec![
            ToolDef {
                name: "tomny_read".into(),
                description: "Canonical read".into(),
                input_schema: json!({"type":"object"}),
                deferred: true,
            },
            ToolDef {
                name: "browser_open".into(),
                description: "Open browser".into(),
                input_schema: json!({"type":"object"}),
                deferred: true,
            },
        ]);
        state.started = true;
        state.search("browser");

        let map = state.map("").to_string();
        assert!(map.contains("tomny_read"));
        assert!(map.contains("tomny_browser_open"));
        assert!(!map.contains(r#""browser_open""#));
        let (real_name, _) = state
            .resolve_run(&json!({"tool":"tomny_browser_open","arguments":{}}))
            .unwrap();
        assert_eq!(real_name, "browser_open");
    }

    #[tokio::test]
    async fn action_gate_opens_once_and_tool_search_hydrates_direct_tools() {
        let state = Arc::new(RwLock::new(ActionSchemaState::with_catalog(
            false,
            vec!["*".into()],
            true,
        )));
        state.write().unwrap().refresh_catalog(vec![ToolDef {
            name: "browser_open".into(),
            description: "Open a browser page".into(),
            input_schema: json!({"type":"object","properties":{"url":{"type":"string"}},"required":["url"]}),
            deferred: true,
        }]);
        let start = StartActionTool::new(Arc::clone(&state));

        let opened = start.execute(json!({"goal":"prepare"})).await;
        let duplicate = start.execute(json!({"goal":"prepare again"})).await;

        assert!(!opened.is_error);
        assert!(opened.content.contains("Action gate opened"));
        assert!(!duplicate.is_error);
        assert!(duplicate.content.contains("already open"));

        assert!(state.read().unwrap().tool_cache().is_empty());
        let search = ToolSearchTool::with_action_state(Vec::new(), Arc::clone(&state));
        let missing = search.execute(json!({"query":"definitely-missing"})).await;
        assert!(!missing.is_error);
        assert!(missing.content.contains("No surface tools matching"));
        assert!(state.read().unwrap().tool_cache().is_empty());

        let loaded = search.execute(json!({"query":"browser"})).await;

        assert!(!loaded.is_error);
        assert!(loaded.content.contains("Call these tools directly"));
        let loaded_def = state.read().unwrap().loaded_tool_defs()[0].clone();
        assert_eq!(loaded_def.name, "tomny_browser_open");
        assert!(!loaded_def.deferred);
        assert_eq!(loaded_def.input_schema["required"], json!(["url"]));
        assert_eq!(
            state.read().unwrap().resolve_direct("tomny_browser_open").unwrap(),
            "browser_open"
        );

        state.write().unwrap().finish_action();
        assert!(!state.read().unwrap().is_started());
        assert_eq!(state.read().unwrap().loaded_tool_defs().len(), 1);

        state.write().unwrap().reset_for_action();
        assert_eq!(state.read().unwrap().tool_cache().len(), 1);

        let reopened = start.execute(json!({"goal":"reuse browser schema"})).await;
        assert!(!reopened.is_error);
        assert!(reopened.content.contains("Action gate opened"));
        assert_eq!(state.read().unwrap().loaded_tool_defs().len(), 1);
    }
}`,
    ],
  ]);
};

const ensureSource = ({ version, commit }) => {
  const cacheRoot = path.join(os.tmpdir(), 'tomny-cli-source');
  const cacheKey = `${version}-${commit.slice(0, 12)}-${SOURCE_PATCH_CACHE_KEY.slice(0, 12)}`;
  const sourceDir = process.env.TOMNY_CLI_SOURCE_DIR || path.join(cacheRoot, cacheKey);
  if (!fs.existsSync(sourceDir)) {
    fs.mkdirSync(cacheRoot, { recursive: true });
    execFileSync('git', ['clone', '--depth', '1', '--branch', version, UPSTREAM_REPOSITORY, sourceDir], {
      stdio: 'inherit',
    });
  } else if (!fs.existsSync(path.join(sourceDir, '.git'))) {
    throw new Error(`Tomny CLI source cache is not a Git checkout: ${sourceDir}`);
  }

  return {
    sourceDir,
    identity: validateReusableSource({
      sourceDir,
      repository: UPSTREAM_REPOSITORY,
      commit,
      recipeIdentity: RECIPE_IDENTITY,
    }),
  };
};

const canApplyPatch = (sourceDir, patchPath, args) => {
  try {
    execFileSync('git', ['-C', sourceDir, 'apply', ...args, patchPath], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};

const applyTomnyProtocolPatches = (sourceDir) => {
  for (const patch of SOURCE_PATCHES) {
    if (canApplyPatch(sourceDir, patch.path, ['--reverse', '--check'])) continue;
    if (!canApplyPatch(sourceDir, patch.path, ['--check'])) {
      throw new Error(`Tomny CLI protocol patch ${patch.version} is incompatible with the selected source.`);
    }
    execFileSync('git', ['-C', sourceDir, 'apply', patch.path], { stdio: 'inherit' });
  }
};

const copyLicense = (sourceDir, targetDir) => {
  const source = path.join(sourceDir, 'LICENSE');
  if (fs.existsSync(source)) {
    fs.copyFileSync(source, path.join(targetDir, 'THIRD_PARTY_LICENSE.tomny-cli.txt'));
  }
};

/**
 * Compile and stage a source-built Tomny CLI.
 *
 * @param {object} options
 * @param {string} options.projectRoot
 * @param {NodeJS.Platform} options.platform
 * @param {string} options.arch
 * @param {string} options.version
 * @param {string} options.commit
 */
const manifestMatches = (manifestPath, binaryPath, version, commit, triple) =>
  artifactManifestMatches({
    manifestPath,
    binaryPath,
    expected: {
      version,
      sourceCommit: commit,
      sourceRepository: UPSTREAM_REPOSITORY,
      sourceType: 'source-build',
      sourcePatchVersion: SOURCE_PATCH_VERSION,
      sourcePatchSha256: SOURCE_PATCH_SHA256,
      targetTriple: triple,
    },
  });

function prepareTomnyCli(options) {
  const { projectRoot, platform, arch, version, commit } = options;
  assertPinnedCommit(commit);
  const triple = targetTriple(platform, arch);
  if (!triple) throw new Error(`Unsupported Tomny CLI target: ${platform}-${arch}`);

  const runtimeKey = `${platform}-${arch}`;
  const stagedDir = path.join(projectRoot, 'resources', 'bundled-tomny-cli', runtimeKey);
  const stagedBinary = path.join(stagedDir, binaryName(platform));
  const stagedManifest = path.join(stagedDir, 'manifest.json');
  const extension = path.extname(stagedBinary);
  const pendingBinary = extension
    ? `${stagedBinary.slice(0, -extension.length)}.next${extension}`
    : `${stagedBinary}.next`;
  const pendingManifest = path.join(stagedDir, 'manifest.next.json');
  if (manifestMatches(pendingManifest, pendingBinary, version, commit, triple)) {
    console.log(
      `Tomny CLI update already staged: resources/bundled-tomny-cli/${runtimeKey}/${path.basename(pendingBinary)}`
    );
    return { prepared: true, cached: true, staged: true, dir: stagedDir, sourceCommit: commit };
  }

  if (manifestMatches(stagedManifest, stagedBinary, version, commit, triple)) {
    console.log(`Tomny CLI already prepared: resources/bundled-tomny-cli/${runtimeKey}/${binaryName(platform)}`);
    return { prepared: true, cached: true, dir: stagedDir, sourceCommit: commit };
  }

  const { sourceDir, identity } = ensureSource({ version, commit });
  const provenance = identity.sourceHash
    ? { sourceTree: identity.sourceTree, sourceHash: identity.sourceHash }
    : (() => {
        applyTomnyProtocolPatches(sourceDir);
        patchTomnySurfaceCatalog(sourceDir);
        patchTomnyBranding(sourceDir);
        return sealSourceCache({ sourceDir, identity, recipeIdentity: RECIPE_IDENTITY });
      })();
  const actualCommit = identity.actualCommit;

  execFileSync('rustup', ['target', 'add', '--toolchain', 'stable', triple], { cwd: sourceDir, stdio: 'inherit' });
  execFileSync(
    'rustup',
    [
      'run',
      'stable',
      'cargo',
      'build',
      '--locked',
      '--release',
      '--target',
      triple,
      '--package',
      'aion-cli',
      '--bin',
      'tomny',
    ],
    { cwd: sourceDir, stdio: 'inherit', env: process.env }
  );

  const sourceBinary = path.join(sourceDir, 'target', triple, 'release', binaryName(platform));
  if (!fs.existsSync(sourceBinary)) throw new Error(`Tomny CLI build output was not found: ${sourceBinary}`);

  const targetDir = stagedDir;
  fs.mkdirSync(targetDir, { recursive: true });
  const targetBinary = stagedBinary;
  let installedBinary = targetBinary;
  let installedManifest = stagedManifest;
  let updateStaged = false;

  try {
    fs.copyFileSync(sourceBinary, targetBinary);
  } catch (error) {
    if (error?.code !== 'EBUSY' && error?.code !== 'EPERM') throw error;
    fs.copyFileSync(sourceBinary, pendingBinary);
    installedBinary = pendingBinary;
    installedManifest = pendingManifest;
    updateStaged = true;
  }

  if (platform !== 'win32') fs.chmodSync(installedBinary, 0o755);
  copyLicense(sourceDir, targetDir);
  fs.writeFileSync(
    installedManifest,
    JSON.stringify(
      {
        name: 'Tomny CLI',
        version,
        sourceCommit: actualCommit,
        sourceRepository: UPSTREAM_REPOSITORY,
        sourceTree: provenance.sourceTree,
        sourceHash: provenance.sourceHash,
        sourceType: 'source-build',
        sourcePatchVersion: SOURCE_PATCH_VERSION,
        sourcePatchSha256: SOURCE_PATCH_SHA256,
        binarySha256: sha256File(installedBinary),
        targetTriple: triple,
        license: 'Apache-2.0',
        protocol: 'json-stream',
        builtAt: new Date().toISOString(),
      },
      null,
      2
    )
  );

  if (updateStaged) {
    console.log(`Tomny CLI update staged: resources/bundled-tomny-cli/${runtimeKey}/${path.basename(pendingBinary)}`);
  } else {
    console.log(`Tomny CLI prepared: resources/bundled-tomny-cli/${runtimeKey}/${binaryName(platform)}`);
  }
  return { prepared: true, staged: updateStaged, dir: targetDir, sourceCommit: actualCommit };
}

module.exports = { manifestMatches, patchTomnySurfaceCatalog, prepareTomnyCli };
