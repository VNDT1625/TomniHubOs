use std::path::Path;

fn summary_file(path: &str, summary: &str, symbols: &[&str]) -> serde_json::Value {
    serde_json::json!({
        "path": path,
        "label": path.rsplit('/').next().unwrap_or(path),
        "group": path.split('/').next().unwrap_or(path),
        "layer": "application",
        "summary": summary,
        "summarySource": "fallback",
        "tags": [],
        "symbols": symbols.iter().map(|name| serde_json::json!({ "name": name })).collect::<Vec<_>>(),
        "language": "typescript",
        "importedBy": 0,
        "fingerprint": null,
    })
}

fn write_flow_summary(root: &Path) {
    let files = vec![
        summary_file(
            "packages/desktop/src/process/services/agentChat/markdownMessageNormalizer.ts",
            "Normalizes attachments and markdown for unrelated provider chat requests.",
            &["normalizeChatMessagesForMarkdown"],
        ),
        summary_file(
            "packages/desktop/src/renderer/pages/conversation/platforms/tomnyagentic/TomnyAgenticSendBox.tsx",
            "React UI entry point for flow_anchor_9f.",
            &["TomnyAgenticSendBox", "executeCommand"],
        ),
        summary_file(
            "packages/desktop/src/renderer/pages/conversation/platforms/acp/AcpSendBox.tsx",
            "Alternative ACP composer for CLI-backed conversations.",
            &["AcpSendBox"],
        ),
        summary_file(
            "packages/desktop/src/common/adapter/ipcBridge.ts",
            "Typed boundary contract shared by two application layers.",
            &["ipcBridge", "conversation.sendMessage"],
        ),
        summary_file(
            "packages/desktop/src/renderer/pages/browser/BrowserChat.tsx",
            "Browser assistant chat surface.",
            &["BrowserChat"],
        ),
        summary_file(
            "packages/desktop/src/process/services/database/nativeConversation/bridge.ts",
            "Registers a provider and delegates work to its owning service.",
            &["registerNativeConversationBridge"],
        ),
        summary_file(
            "packages/desktop/src/process/services/database/nativeConversation/service.ts",
            "Owns durable orchestration for the native conversation subsystem.",
            &["NativeConversationService", "send", "runtime.start"],
        ),
        summary_file(
            "packages/desktop/src/renderer/pages/conversation/platforms/tomnyagentic/useTomnyAgenticMessage.ts",
            "Consumes completion events and updates local presentation state.",
            &["useTomnyAgenticMessage", "responseStream"],
        ),
    ];
    let edges = serde_json::json!([
        {
            "from": "packages/desktop/src/renderer/pages/conversation/platforms/tomnyagentic/TomnyAgenticSendBox.tsx",
            "to": "packages/desktop/src/common/adapter/ipcBridge.ts"
        },
        {
            "from": "packages/desktop/src/process/services/database/nativeConversation/bridge.ts",
            "to": "packages/desktop/src/common/adapter/ipcBridge.ts"
        },
        {
            "from": "packages/desktop/src/process/services/database/nativeConversation/bridge.ts",
            "to": "packages/desktop/src/process/services/database/nativeConversation/service.ts"
        },
        {
            "from": "packages/desktop/src/renderer/pages/conversation/platforms/tomnyagentic/useTomnyAgenticMessage.ts",
            "to": "packages/desktop/src/common/adapter/ipcBridge.ts"
        }
    ]);
    let dir = root.join(".tomni").join("understand");
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(
        dir.join("summary.json"),
        serde_json::json!({
            "version": 3,
            "rootPath": root,
            "graphVersion": 6,
            "builtAt": 200,
            "overview": null,
            "runbook": null,
            "modules": [],
            "files": files,
            "edges": edges,
        })
        .to_string(),
    )
    .unwrap();
}

fn materialize_sources(root: &Path) {
    let summary: serde_json::Value = serde_json::from_str(
        &std::fs::read_to_string(root.join(".tomni/understand/summary.json")).unwrap(),
    )
    .unwrap();
    for file in summary["files"].as_array().unwrap() {
        let relative = file["path"].as_str().unwrap();
        let absolute = root.join(relative);
        std::fs::create_dir_all(absolute.parent().unwrap()).unwrap();
        std::fs::write(
            absolute,
            format!("// {relative}\nexport const fixture = true;\n"),
        )
        .unwrap();
    }
}

fn write_realistic_flow_summary(root: &Path) {
    let files = vec![
        summary_file(
            "packages/desktop/src/renderer/pages/conversation/platforms/tomnyagentic/TomnyAgenticSendBox.tsx",
            "`TomnyAgenticSendBox.tsx` is a typescriptreact file that renders user interface.",
            &[],
        ),
        summary_file(
            "packages/desktop/src/common/index.ts",
            "Shared application exports.",
            &["ipcBridge"],
        ),
        summary_file(
            "packages/desktop/src/common/adapter/ipcBridge.ts",
            "Typed application boundary contract.",
            &["ipcBridge", "conversation.sendMessage", "IResponseMessage"],
        ),
        summary_file(
            "packages/desktop/src/process/services/database/nativeConversation/bridge.ts",
            "Registers the native conversation provider.",
            &["registerNativeConversationBridge"],
        ),
        summary_file(
            "packages/desktop/src/process/services/database/nativeConversation/service.ts",
            "Owns durable native conversation orchestration.",
            &[
                "NativeConversationService",
                "send",
                "repository.saveMessage",
                "runtime.start",
                "processCoreEvent",
            ],
        ),
        summary_file(
            "packages/desktop/src/renderer/pages/conversation/platforms/tomnyagentic/useTomnyAgenticMessage.ts",
            "Consumes native conversation completion events.",
            &["useTomnyAgenticMessage", "responseStream.on"],
        ),
        summary_file(
            "packages/desktop/src/process/services/agentChat/index.ts",
            "Agent chat message runtime entry point.",
            &["runAgentChatMessages"],
        ),
        summary_file(
            "packages/desktop/src/process/services/agentChat/cliAgentChat.ts",
            "Agent chat runtime service.",
            &["withCliAgent"],
        ),
        summary_file(
            "packages/desktop/src/process/services/agentChat/markdownMessageNormalizer.ts",
            "Normalizes agent chat messages.",
            &["normalizeChatMessagesForMarkdown"],
        ),
        summary_file(
            "packages/desktop/src/process/agentRuntime/agentMesh/service.ts",
            "Agent runtime message service.",
            &["AgentMeshService"],
        ),
        summary_file(
            "packages/desktop/src/process/agentRuntime/agentMesh/controller.ts",
            "Agent runtime message controller.",
            &["AgentControllerMessageInput"],
        ),
        summary_file(
            "packages/desktop/src/renderer/pages/browser/useAgentChat.ts",
            "React agent chat UI.",
            &["useAgentChat"],
        ),
        summary_file(
            "packages/desktop/src/renderer/pages/browser/agentChatStore.ts",
            "Stores agent chat messages and stream state.",
            &["AgentChatStore", "ChatMessage"],
        ),
    ];
    let edges = serde_json::json!([
        {
            "from": "packages/desktop/src/renderer/pages/conversation/platforms/tomnyagentic/TomnyAgenticSendBox.tsx",
            "to": "packages/desktop/src/common/index.ts"
        },
        {
            "from": "packages/desktop/src/common/index.ts",
            "to": "packages/desktop/src/common/adapter/ipcBridge.ts"
        },
        {
            "from": "packages/desktop/src/process/services/database/nativeConversation/service.ts",
            "to": "packages/desktop/src/common/adapter/ipcBridge.ts"
        },
        {
            "from": "packages/desktop/src/process/services/database/nativeConversation/bridge.ts",
            "to": "packages/desktop/src/process/services/database/nativeConversation/service.ts"
        },
        {
            "from": "packages/desktop/src/renderer/pages/conversation/platforms/tomnyagentic/useTomnyAgenticMessage.ts",
            "to": "packages/desktop/src/common/adapter/ipcBridge.ts"
        },
        {
            "from": "packages/desktop/src/process/services/agentChat/index.ts",
            "to": "packages/desktop/src/process/services/agentChat/cliAgentChat.ts"
        },
        {
            "from": "packages/desktop/src/process/services/agentChat/index.ts",
            "to": "packages/desktop/src/process/services/agentChat/markdownMessageNormalizer.ts"
        },
        {
            "from": "packages/desktop/src/process/agentRuntime/agentMesh/service.ts",
            "to": "packages/desktop/src/process/agentRuntime/agentMesh/controller.ts"
        },
        {
            "from": "packages/desktop/src/renderer/pages/browser/useAgentChat.ts",
            "to": "packages/desktop/src/renderer/pages/browser/agentChatStore.ts"
        }
    ]);
    let dir = root.join(".tomni").join("understand");
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(
        dir.join("summary.json"),
        serde_json::json!({
            "version": 3,
            "rootPath": root,
            "graphVersion": 6,
            "builtAt": 200,
            "overview": null,
            "runbook": null,
            "modules": [],
            "files": files,
            "edges": edges,
        })
        .to_string(),
    )
    .unwrap();
}

fn assert_flow_recall(root: &Path, query: &str) {
    let result = mtui::understand::query_context(root, query, 8).unwrap();
    let paths = result
        .candidates
        .iter()
        .map(|candidate| candidate.path.as_str())
        .collect::<Vec<_>>();
    let gold = [
        "packages/desktop/src/renderer/pages/conversation/platforms/tomnyagentic/TomnyAgenticSendBox.tsx",
        "packages/desktop/src/common/adapter/ipcBridge.ts",
        "packages/desktop/src/process/services/database/nativeConversation/bridge.ts",
        "packages/desktop/src/process/services/database/nativeConversation/service.ts",
        "packages/desktop/src/renderer/pages/conversation/platforms/tomnyagentic/useTomnyAgenticMessage.ts",
    ];
    let recalled = gold.iter().filter(|path| paths.contains(path)).count();
    assert_eq!(
        recalled,
        5,
        "connected stage coverage must preserve the complete five-file route; got {recalled}/5: {:#?}",
        result
            .candidates
            .iter()
            .map(|candidate| (&candidate.path, candidate.score, &candidate.reason))
            .collect::<Vec<_>>()
    );
}

#[test]
fn generic_english_flow_prefers_complete_route_over_dense_chat_clusters() {
    let repo = tempfile::tempdir().unwrap();
    write_realistic_flow_summary(repo.path());
    materialize_sources(repo.path());

    assert_flow_recall(
        repo.path(),
        "Trace the user sending a chat message from the React UI through IPC, persistence, agent runtime, and response stream",
    );
}

#[test]
fn generic_vietnamese_flow_prefers_the_same_complete_route() {
    let repo = tempfile::tempdir().unwrap();
    write_realistic_flow_summary(repo.path());
    materialize_sources(repo.path());

    assert_flow_recall(
        repo.path(),
        "Truy vết người dùng gửi tin nhắn chat từ giao diện React qua IPC, lưu trữ, runtime agent và luồng phản hồi",
    );
}

#[test]
fn context_expands_exact_flow_anchors_over_file_graph() {
    let repo = tempfile::tempdir().unwrap();
    write_flow_summary(repo.path());
    materialize_sources(repo.path());

    let result = mtui::understand::query_context(repo.path(), "flow_anchor_9f", 8).unwrap();
    let paths = result
        .candidates
        .iter()
        .map(|candidate| candidate.path.as_str())
        .collect::<Vec<_>>();
    let expected = [
        "packages/desktop/src/renderer/pages/conversation/platforms/tomnyagentic/TomnyAgenticSendBox.tsx",
        "packages/desktop/src/common/adapter/ipcBridge.ts",
        "packages/desktop/src/process/services/database/nativeConversation/bridge.ts",
        "packages/desktop/src/process/services/database/nativeConversation/service.ts",
        "packages/desktop/src/renderer/pages/conversation/platforms/tomnyagentic/useTomnyAgenticMessage.ts",
    ];

    assert!(
        expected.iter().all(|path| paths.contains(path)),
        "Recall@8 must be 100%; got {paths:#?}"
    );
    assert!(
        !paths.contains(
            &"packages/desktop/src/renderer/pages/conversation/platforms/acp/AcpSendBox.tsx"
        ),
        "the graph route must not be displaced by a similarly named but disconnected SendBox"
    );
}

#[test]
fn vietnamese_flow_intent_keeps_the_same_graph_route() {
    let repo = tempfile::tempdir().unwrap();
    write_flow_summary(repo.path());
    materialize_sources(repo.path());

    let result = mtui::understand::query_context(
        repo.path(),
        "Truy vết luồng người dùng gửi tin nhắn, lưu dữ liệu rồi nhận phản hồi",
        5,
    )
    .unwrap();
    let paths = result
        .candidates
        .iter()
        .map(|candidate| candidate.path.as_str())
        .collect::<Vec<_>>();
    let scored = result
        .candidates
        .iter()
        .map(|candidate| (&candidate.path, candidate.score, &candidate.reason))
        .collect::<Vec<_>>();

    for expected in [
        "packages/desktop/src/renderer/pages/conversation/platforms/tomnyagentic/TomnyAgenticSendBox.tsx",
        "packages/desktop/src/common/adapter/ipcBridge.ts",
        "packages/desktop/src/process/services/database/nativeConversation/bridge.ts",
        "packages/desktop/src/process/services/database/nativeConversation/service.ts",
        "packages/desktop/src/renderer/pages/conversation/platforms/tomnyagentic/useTomnyAgenticMessage.ts",
    ] {
        assert!(
            paths.contains(&expected),
            "Vietnamese Recall@8 lost {expected}; got {scored:#?}"
        );
    }
}

#[test]
fn intent_map_exposes_a_connected_reading_path_instead_of_repeating_candidates() {
    let repo = tempfile::tempdir().unwrap();
    write_flow_summary(repo.path());
    materialize_sources(repo.path());

    let result = mtui::understand::map_intent(repo.path(), "flow_anchor_9f", 8).unwrap();
    let mapped = result
        .recommended_path
        .iter()
        .flat_map(|step| step.files.iter().map(String::as_str))
        .collect::<Vec<_>>();

    assert_eq!(
        result.recommended_path[0].step,
        "Start at strongest intent anchor"
    );
    assert!(
        result
            .recommended_path
            .iter()
            .skip(1)
            .any(|step| step.step.starts_with("Follow dependency graph from ")),
        "the map should expose graph hops: {:#?}",
        result
            .recommended_path
            .iter()
            .map(|step| &step.step)
            .collect::<Vec<_>>()
    );
    assert!(mapped.contains(&"packages/desktop/src/common/adapter/ipcBridge.ts"));
    assert!(mapped
        .contains(&"packages/desktop/src/process/services/database/nativeConversation/bridge.ts"));
}
