use std::{env, path::PathBuf, process::ExitCode};

use tokio::io::{self, AsyncBufReadExt, AsyncWriteExt, BufReader};

use tomny_runtime::{
    protocol::{Request, Response},
    runtime::TomnyRuntime,
};

#[tokio::main]
async fn main() -> ExitCode {
    match run().await {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("tomny-runtime: {error}");
            ExitCode::FAILURE
        }
    }
}

async fn run() -> Result<(), Box<dyn std::error::Error>> {
    let config = match parse_args()? {
        Some(config) => config,
        None => return Ok(()),
    };
    let mut runtime = TomnyRuntime::new(config.data_dir, config.max_processes)?;
    let mut lines = BufReader::new(io::stdin()).lines();
    let mut stdout = io::BufWriter::new(io::stdout());

    while let Some(line) = lines.next_line().await? {
        if line.trim().is_empty() {
            continue;
        }
        let request = match serde_json::from_str::<Request>(&line) {
            Ok(request) => request,
            Err(error) => {
                write_response(
                    &mut stdout,
                    &Response::failure("invalid", "INVALID_REQUEST", error.to_string()),
                )
                .await?;
                continue;
            }
        };
        let result = runtime.dispatch(request).await;
        write_response(&mut stdout, &result.response).await?;
        if result.shutdown {
            return Ok(());
        }
    }

    runtime.shutdown().await;
    Ok(())
}

async fn write_response(
    stdout: &mut io::BufWriter<io::Stdout>,
    response: &Response,
) -> Result<(), Box<dyn std::error::Error>> {
    let mut encoded = serde_json::to_vec(response)?;
    encoded.push(b'\n');
    stdout.write_all(&encoded).await?;
    stdout.flush().await?;
    Ok(())
}

struct Config {
    data_dir: PathBuf,
    max_processes: usize,
}

fn parse_args() -> Result<Option<Config>, String> {
    let mut args = env::args().skip(1);
    let mut data_dir = env::var_os("TOMNY_RUNTIME_DATA_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(".tomny-runtime"));
    let mut max_processes = 4_usize;

    while let Some(argument) = args.next() {
        match argument.as_str() {
            "--version" | "-V" => {
                println!(
                    "tomny-runtime {} ({})",
                    env!("CARGO_PKG_VERSION"),
                    tomny_runtime::PROTOCOL_VERSION
                );
                return Ok(None);
            }
            "--data-dir" => {
                data_dir = PathBuf::from(
                    args.next()
                        .ok_or_else(|| "--data-dir requires a path".to_string())?,
                );
            }
            "--max-processes" => {
                max_processes = args
                    .next()
                    .ok_or_else(|| "--max-processes requires a number".to_string())?
                    .parse()
                    .map_err(|_| "--max-processes must be a positive integer".to_string())?;
                if max_processes == 0 {
                    return Err("--max-processes must be a positive integer".into());
                }
            }
            other => return Err(format!("unknown argument: {other}")),
        }
    }

    Ok(Some(Config {
        data_dir,
        max_processes,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    #[test]
    fn protocol_error_response_is_valid_json() {
        let response = Response::failure("invalid", "INVALID_REQUEST", "bad JSON");
        let encoded = serde_json::to_value(response).unwrap();
        assert_eq!(encoded["ok"], Value::Bool(false));
    }
}
