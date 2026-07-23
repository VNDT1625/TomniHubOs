use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::PROTOCOL_VERSION;

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Request {
    pub protocol: String,
    pub id: String,
    pub method: String,
    #[serde(default)]
    pub params: Value,
}

#[derive(Debug, Serialize)]
pub struct Response {
    pub protocol: &'static str,
    pub id: String,
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<ProtocolError>,
}

#[derive(Debug, Serialize)]
pub struct ProtocolError {
    pub code: String,
    pub message: String,
}

impl Response {
    pub fn success(id: impl Into<String>, result: Value) -> Self {
        Self {
            protocol: PROTOCOL_VERSION,
            id: id.into(),
            ok: true,
            result: Some(result),
            error: None,
        }
    }

    pub fn failure(
        id: impl Into<String>,
        code: impl Into<String>,
        message: impl Into<String>,
    ) -> Self {
        Self {
            protocol: PROTOCOL_VERSION,
            id: id.into(),
            ok: false,
            result: None,
            error: Some(ProtocolError {
                code: code.into(),
                message: message.into(),
            }),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_unknown_request_fields() {
        let raw =
            r#"{"protocol":"tomny.runtime.v1","id":"1","method":"health.check","extra":true}"#;
        assert!(serde_json::from_str::<Request>(raw).is_err());
    }

    #[test]
    fn omits_empty_response_branches() {
        let encoded = serde_json::to_value(Response::success("1", Value::Null)).unwrap();
        assert!(encoded.get("error").is_none());
    }
}
