// ---------------------------------------------------------------------------
// Checksum verification
// ---------------------------------------------------------------------------

use std::path::PathBuf;

#[derive(Clone, Copy)]
pub(crate) enum Algo {
    Md5,
    Sha1,
    Sha256,
    Sha512,
}

/// Pick the algorithm from the hex length; `None` if it's not a known width.
pub(crate) fn detect_algo(hash: &str) -> Option<Algo> {
    match hash.len() {
        32 => Some(Algo::Md5),
        40 => Some(Algo::Sha1),
        64 => Some(Algo::Sha256),
        128 => Some(Algo::Sha512),
        _ => None,
    }
}

/// Stream the file through the hasher on a blocking thread (CPU-bound).
pub(crate) async fn compute_checksum(path: PathBuf, algo: Algo) -> Result<String, String> {
    tokio::task::spawn_blocking(move || -> Result<String, String> {
        use std::io::Read;
        let mut file =
            std::fs::File::open(&path).map_err(|e| format!("Could not open for checksum: {e}"))?;
        let mut hasher: Box<dyn digest::DynDigest> = match algo {
            Algo::Md5 => Box::new(md5::Md5::default()),
            Algo::Sha1 => Box::new(sha1::Sha1::default()),
            Algo::Sha256 => Box::new(sha2::Sha256::default()),
            Algo::Sha512 => Box::new(sha2::Sha512::default()),
        };
        let mut buf = vec![0u8; 1024 * 1024];
        loop {
            let n = file
                .read(&mut buf)
                .map_err(|e| format!("Read error during checksum: {e}"))?;
            if n == 0 {
                break;
            }
            hasher.update(&buf[..n]);
        }
        Ok(hex::encode(hasher.finalize()))
    })
    .await
    .map_err(|e| format!("Checksum task failed: {e}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detect_algo_picks_by_hex_length() {
        assert!(matches!(detect_algo(&"a".repeat(32)), Some(Algo::Md5)));
        assert!(matches!(detect_algo(&"a".repeat(40)), Some(Algo::Sha1)));
        assert!(matches!(detect_algo(&"a".repeat(64)), Some(Algo::Sha256)));
        assert!(matches!(detect_algo(&"a".repeat(128)), Some(Algo::Sha512)));
        assert!(detect_algo(&"a".repeat(10)).is_none());
    }

    #[tokio::test]
    async fn checksum_matches_known_sha256() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("data.bin");
        std::fs::write(&path, b"hello world").unwrap();
        let hash = compute_checksum(path, Algo::Sha256).await.unwrap();
        assert_eq!(
            hash,
            "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9"
        );
    }
}
