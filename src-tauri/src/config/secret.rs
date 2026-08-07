// ---------------------------------------------------------------------------
// At-rest protection for secrets persisted to disk (currently just the proxy
// password in prefs.json) via Windows DPAPI, scoped to the current user.
//
// This defends against the config file being read by something other than
// this user's own code running on this machine — another local account, or
// a plaintext credential leaking out through a cloud-synced AppData backup.
// It does *not* defend against another process already running as this
// user, since user-scoped DPAPI unprotects for any such process — that's an
// intrinsic limit of the mechanism, not a bug here. What it actually removes
// is a cleartext credential from a config file that outlives the process and
// may end up somewhere other than this machine.
// ---------------------------------------------------------------------------

#[cfg(windows)]
mod imp {
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::{LocalFree, HLOCAL};
    use windows::Win32::Security::Cryptography::{CryptProtectData, CryptUnprotectData, CRYPT_INTEGER_BLOB};

    /// Frees the LocalAlloc'd buffer both Crypt*Data calls hand back in
    /// `blob.pbData`, then returns its bytes copied out into a `Vec`.
    unsafe fn take_and_free(blob: CRYPT_INTEGER_BLOB) -> Vec<u8> {
        let bytes = std::slice::from_raw_parts(blob.pbData, blob.cbData as usize).to_vec();
        let _ = LocalFree(Some(HLOCAL(blob.pbData as _)));
        bytes
    }

    pub(crate) fn protect(plaintext: &str) -> Option<String> {
        if plaintext.is_empty() {
            return Some(String::new());
        }
        unsafe {
            let mut input_bytes = plaintext.as_bytes().to_vec();
            let input = CRYPT_INTEGER_BLOB {
                cbData: input_bytes.len() as u32,
                pbData: input_bytes.as_mut_ptr(),
            };
            let mut output = CRYPT_INTEGER_BLOB::default();
            CryptProtectData(&input, PCWSTR::null(), None, None, None, 0, &mut output).ok()?;
            Some(hex::encode(take_and_free(output)))
        }
    }

    pub(crate) fn unprotect(encoded: &str) -> Option<String> {
        if encoded.is_empty() {
            return Some(String::new());
        }
        let mut bytes = hex::decode(encoded).ok()?;
        unsafe {
            let input = CRYPT_INTEGER_BLOB {
                cbData: bytes.len() as u32,
                pbData: bytes.as_mut_ptr(),
            };
            let mut output = CRYPT_INTEGER_BLOB::default();
            CryptUnprotectData(&input, None, None, None, None, 0, &mut output).ok()?;
            String::from_utf8(take_and_free(output)).ok()
        }
    }
}

#[cfg(not(windows))]
mod imp {
    // No DPAPI equivalent is wired up for non-Windows builds — this app is
    // Windows-first (see `webview2-com`, and `harden_webview` in
    // `windows/mod.rs`), so this keeps a Linux/macOS build green rather than
    // blocking on a second secret-store backend (libsecret / Keychain)
    // nothing here uses yet. Secrets round-trip as plaintext on those
    // platforms until one is wired up.
    pub(crate) fn protect(plaintext: &str) -> Option<String> {
        Some(plaintext.to_string())
    }

    pub(crate) fn unprotect(encoded: &str) -> Option<String> {
        Some(encoded.to_string())
    }
}

pub(crate) use imp::{protect, unprotect};

#[cfg(all(test, windows))]
mod tests {
    use super::*;

    #[test]
    fn protect_then_unprotect_round_trips() {
        let secret = "hunter2 with spaces and 🔒 unicode";
        let encoded = protect(secret).expect("DPAPI protect should succeed for the current user");
        assert_ne!(encoded, secret, "encoded form must not be the plaintext");
        assert_eq!(unprotect(&encoded).as_deref(), Some(secret));
    }

    #[test]
    fn empty_string_round_trips_as_empty() {
        assert_eq!(protect("").as_deref(), Some(""));
        assert_eq!(unprotect("").as_deref(), Some(""));
    }

    #[test]
    fn unprotect_rejects_garbage_input() {
        assert!(unprotect("not valid hex or DPAPI blob").is_none());
    }
}
