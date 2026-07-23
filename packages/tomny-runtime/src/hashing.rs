use std::{fs::File, io::Read, path::Path};

use base64::{engine::general_purpose::STANDARD, Engine};
use sha2::{Digest, Sha256};
use thiserror::Error;

const BUFFER_SIZE: usize = 64 * 1024;

#[derive(Debug, Error)]
pub enum HashError {
    #[error("invalid base64 payload: {0}")]
    InvalidBase64(#[from] base64::DecodeError),
    #[error("unable to read file: {0}")]
    Io(#[from] std::io::Error),
}

pub fn sha256_base64(value: &str) -> Result<String, HashError> {
    let bytes = STANDARD.decode(value)?;
    Ok(hex::encode(Sha256::digest(bytes)))
}

pub fn sha256_file(path: &Path) -> Result<String, HashError> {
    let mut file = File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; BUFFER_SIZE];
    loop {
        let count = file.read(&mut buffer)?;
        if count == 0 {
            break;
        }
        hasher.update(&buffer[..count]);
    }
    Ok(hex::encode(hasher.finalize()))
}

#[cfg(test)]
mod tests {
    use std::io::Write;

    use super::*;

    #[test]
    fn hashes_base64_bytes() {
        assert_eq!(
            sha256_base64("YWJj").unwrap(),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }

    #[test]
    fn rejects_invalid_base64() {
        assert!(matches!(
            sha256_base64("***"),
            Err(HashError::InvalidBase64(_))
        ));
    }

    #[test]
    fn hashes_file_incrementally() {
        let mut file = tempfile::NamedTempFile::new().unwrap();
        file.write_all(b"abc").unwrap();
        assert_eq!(
            sha256_file(file.path()).unwrap(),
            sha256_base64("YWJj").unwrap()
        );
    }
}
