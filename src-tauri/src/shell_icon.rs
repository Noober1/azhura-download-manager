// ---------------------------------------------------------------------------
// Windows shell file-association icons
// ---------------------------------------------------------------------------
//
// Looks up the icon Windows Explorer would show for a given file extension —
// no bundled icon set can keep up with every installed app's own file-type
// registration, but the shell already knows. `SHGFI_USEFILEATTRIBUTES` makes
// this a pure registry lookup keyed on the extension: no real file is read or
// even needs to exist, so it works equally for in-flight downloads and
// completed files that have since gone missing on disk. `src/fileIcons.tsx`
// falls back to a bundled SVG set when this returns `None` (non-Windows
// builds, or a lookup that fails for some other reason).

#[tauri::command]
#[specta::specta]
pub(crate) async fn shell_icon(ext: String) -> Result<Option<String>, String> {
    let ext = match normalize_ext(&ext) {
        Some(ext) => ext,
        None => return Ok(None),
    };
    tokio::task::spawn_blocking(move || platform::icon_for_ext(&ext))
        .await
        .map_err(|e| format!("shell icon task failed: {e}"))
}

/// Lowercases and validates an extension coming in over IPC. `None` for
/// anything that isn't a plausible file extension (including the empty
/// string, which just means "no extension" — callers of `shell_icon` treat
/// that as a lookup miss rather than an error) or that fails the boundary
/// check, so a stray path separator or overlong string can never reach the
/// Win32 call.
fn normalize_ext(ext: &str) -> Option<String> {
    if ext.is_empty() || ext.len() > 16 {
        return None;
    }
    if !ext.chars().all(|c| c.is_ascii_alphanumeric()) {
        return None;
    }
    Some(ext.to_ascii_lowercase())
}

#[cfg(windows)]
mod platform {
    use std::mem::size_of;
    use std::sync::Mutex;

    use windows::core::PCWSTR;
    use windows::Win32::Graphics::Gdi::{
        DeleteObject, GetDC, GetDIBits, GetObjectW, ReleaseDC, BITMAP, BITMAPINFO,
        BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, HBITMAP, HGDIOBJ,
    };
    use windows::Win32::Storage::FileSystem::FILE_ATTRIBUTE_NORMAL;
    use windows::Win32::System::Com::{
        CoInitializeEx, CoUninitialize, COINIT_APARTMENTTHREADED, COINIT_DISABLE_OLE1DDE,
    };
    use windows::Win32::UI::Shell::{
        SHGetFileInfoW, SHFILEINFOW, SHGFI_ICON, SHGFI_LARGEICON, SHGFI_USEFILEATTRIBUTES,
    };
    use windows::Win32::UI::WindowsAndMessaging::{DestroyIcon, GetIconInfo, HICON, ICONINFO};

    /// Ensures COM is initialized on the calling thread for the lifetime of
    /// the guard. `SHGetFileInfoW` can silently misbehave — returning success
    /// with a null/blank icon, or failing outright — on a thread that has
    /// never called `CoInitialize`/`CoInitializeEx`, per the Win32 docs' own
    /// remarks on the function. `tokio::task::spawn_blocking` (what runs this
    /// module in production) hands work to pool threads that are never
    /// COM-initialized by anything else, so without this, icon lookups would
    /// intermittently return `None` depending on which pool thread happened
    /// to pick up the call — exactly the failure mode this guard exists to
    /// close off.
    struct ComGuard(bool);
    impl Drop for ComGuard {
        fn drop(&mut self) {
            if self.0 {
                // SAFETY: only uninitializes when this guard's own
                // `CoInitializeEx` call is the one that incremented the
                // per-thread init count (see `init_com`'s doc comment).
                unsafe { CoUninitialize() };
            }
        }
    }

    /// `CoInitializeEx` returns `S_OK` when this call is the one that
    /// initializes the thread, `S_FALSE` when COM was already initialized
    /// here with a compatible apartment model (still needs a matching
    /// `CoUninitialize`), or the `RPC_E_CHANGED_MODE` error when it was
    /// already initialized with an *incompatible* model — in that last case
    /// COM is still usable, we just must not touch its refcount. `is_ok()`
    /// is true for the first two and false for the third, which is exactly
    /// the "do I owe a matching `CoUninitialize`" question `ComGuard` needs
    /// answered.
    fn init_com() -> ComGuard {
        // SAFETY: `None` (no reserved parameter) and a plain apartment-model
        // flag are the documented, always-safe arguments to this call.
        let hr = unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE) };
        ComGuard(hr.is_ok())
    }

    /// `SHGetFileInfoW(..., SHGFI_ICON, ...)` is not safe to call
    /// concurrently: under contention from another thread it has been
    /// observed to return its "success" code while leaving `hIcon` null,
    /// rather than blocking or failing loudly. With the table rendering many
    /// rows at once, each kicking off its own `spawn_blocking` lookup, two
    /// extensions resolving at the same instant is the common case, not an
    /// edge case — so every call is serialized through this process-wide
    /// lock rather than relying on the shell to do it internally.
    static ICON_LOOKUP_LOCK: Mutex<()> = Mutex::new(());

    /// `Some(data-uri)` on success, `None` for any failure along the way —
    /// every one of these calls can fail for reasons outside our control
    /// (missing shell extension, exhausted GDI handles, …), and the frontend
    /// already has a fallback for a `None`, so there's nothing a caller could
    /// usefully do with a more specific error here.
    pub(crate) fn icon_for_ext(ext: &str) -> Option<String> {
        let _lock = ICON_LOOKUP_LOCK.lock().unwrap();
        let _com = init_com();
        let name = format!("dummy.{ext}");
        let wide: Vec<u16> = name.encode_utf16().chain(std::iter::once(0)).collect();

        let mut info = SHFILEINFOW::default();
        // SAFETY: `wide` is a valid, nul-terminated UTF-16 buffer that outlives
        // the call. `SHGFI_USEFILEATTRIBUTES` tells the shell to use
        // `FILE_ATTRIBUTE_NORMAL` instead of touching the path on disk, so
        // `dummy.<ext>` never needs to exist.
        let ok = unsafe {
            SHGetFileInfoW(
                PCWSTR(wide.as_ptr()),
                FILE_ATTRIBUTE_NORMAL,
                Some(&mut info),
                size_of::<SHFILEINFOW>() as u32,
                SHGFI_ICON | SHGFI_LARGEICON | SHGFI_USEFILEATTRIBUTES,
            )
        };
        if ok == 0 || info.hIcon.is_invalid() {
            return None;
        }

        let png_bytes = hicon_to_png(info.hIcon);
        // SAFETY: `info.hIcon` is a valid icon handle returned by the call
        // above and is only destroyed once, here, after every use of it.
        unsafe {
            let _ = DestroyIcon(info.hIcon);
        }

        let png_bytes = png_bytes?;
        Some(format!(
            "data:image/png;base64,{}",
            base64::Engine::encode(&base64::engine::general_purpose::STANDARD, png_bytes)
        ))
    }

    /// Renders an `HICON` to RGBA and PNG-encodes it. `None` on any Win32
    /// call failure; GDI objects acquired before the failing point are always
    /// released before returning.
    fn hicon_to_png(hicon: HICON) -> Option<Vec<u8>> {
        let mut icon_info = ICONINFO::default();
        // SAFETY: `hicon` is a valid icon handle owned by the caller for the
        // duration of this call; `icon_info` is a valid, writable out-param.
        unsafe { GetIconInfo(hicon, &mut icon_info).ok()? };

        // `hbmMask` is only needed below to recover alpha for legacy 1bpp
        // icons; the color bitmap is required either way.
        let hbm_color = icon_info.hbmColor;
        let hbm_mask = icon_info.hbmMask;
        let result = read_color_bitmap(hbm_color).map(|(w, h, mut rgba)| {
            if rgba.chunks_exact(4).all(|px| px[3] == 0) {
                if let Some(mask_alpha) = read_mask_alpha(hbm_mask, w, h) {
                    for (px, opaque) in rgba.chunks_exact_mut(4).zip(mask_alpha) {
                        px[3] = if opaque { 255 } else { 0 };
                    }
                } else {
                    // No mask to recover alpha from — safer to show a fully
                    // opaque icon than an invisible one.
                    for px in rgba.chunks_exact_mut(4) {
                        px[3] = 255;
                    }
                }
            }
            (w, h, rgba)
        });

        // SAFETY: both bitmaps are owned by this function (via `GetIconInfo`,
        // which the caller must free per its docs) and are not used again
        // after this point.
        unsafe {
            let _ = DeleteObject(HGDIOBJ::from(hbm_color));
            let _ = DeleteObject(HGDIOBJ::from(hbm_mask));
        }

        let (width, height, rgba) = result?;
        encode_png(width, height, &rgba)
    }

    /// Reads `hbm`'s pixels as top-down 32bpp BGRA and returns them converted
    /// to RGBA, along with the bitmap's dimensions.
    fn read_color_bitmap(hbm: HBITMAP) -> Option<(u32, u32, Vec<u8>)> {
        let mut bmp = BITMAP::default();
        // SAFETY: `hbm` is a valid bitmap handle; `bmp` is a valid, writable
        // out-param sized for `BITMAP`.
        let written = unsafe {
            GetObjectW(
                HGDIOBJ::from(hbm),
                size_of::<BITMAP>() as i32,
                Some(&mut bmp as *mut _ as *mut _),
            )
        };
        if written == 0 {
            return None;
        }
        let width = bmp.bmWidth;
        let height = bmp.bmHeight;
        if width <= 0 || height <= 0 {
            return None;
        }

        let mut bmi = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: width,
                // Negative height requests a top-down DIB, matching the
                // row order PNG encoding expects.
                biHeight: -height,
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB.0,
                ..Default::default()
            },
            ..Default::default()
        };

        let mut buf = vec![0u8; (width as usize) * (height as usize) * 4];
        // SAFETY: `None` requests the desktop's screen DC, valid for the
        // duration of this call and released below regardless of the
        // outcome; `buf` is sized exactly for `height` rows of `GetDIBits`'
        // expected stride at 32bpp, and `bmi` describes that same layout.
        let dc = unsafe { GetDC(None) };
        let lines = unsafe {
            GetDIBits(
                dc,
                hbm,
                0,
                height as u32,
                Some(buf.as_mut_ptr() as *mut _),
                &mut bmi,
                DIB_RGB_COLORS,
            )
        };
        // SAFETY: `dc` was obtained from the matching `GetDC` call above.
        unsafe {
            ReleaseDC(None, dc);
        }
        if lines == 0 {
            return None;
        }

        for px in buf.chunks_exact_mut(4) {
            px.swap(0, 2); // BGRA -> RGBA
        }
        Some((width as u32, height as u32, buf))
    }

    /// Reads `hbm` (an icon's 1bpp mask bitmap) and returns, per pixel,
    /// whether it's opaque (mask bit clear) — used to recover alpha for
    /// legacy icons whose color bitmap carries no alpha channel at all.
    fn read_mask_alpha(hbm: HBITMAP, width: u32, height: u32) -> Option<Vec<bool>> {
        let mut bmi = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: width as i32,
                biHeight: -(height as i32),
                biPlanes: 1,
                biBitCount: 1,
                biCompression: BI_RGB.0,
                ..Default::default()
            },
            ..Default::default()
        };

        // 1bpp rows are padded to a 32-bit boundary.
        let stride = (width as usize).div_ceil(32) * 4;
        let mut buf = vec![0u8; stride * height as usize];
        // SAFETY: `None` requests the desktop's screen DC, released below
        // regardless of outcome; `buf` and `bmi` describe a matching 1bpp
        // top-down layout.
        let dc = unsafe { GetDC(None) };
        let lines = unsafe {
            GetDIBits(
                dc,
                hbm,
                0,
                height,
                Some(buf.as_mut_ptr() as *mut _),
                &mut bmi,
                DIB_RGB_COLORS,
            )
        };
        unsafe {
            ReleaseDC(None, dc);
        }
        if lines == 0 {
            return None;
        }

        let mut opaque = Vec::with_capacity((width * height) as usize);
        for row in 0..height as usize {
            let row_bytes = &buf[row * stride..row * stride + stride];
            for col in 0..width as usize {
                let byte = row_bytes[col / 8];
                let bit_set = (byte >> (7 - (col % 8))) & 1 == 1;
                // AND-mask convention: bit set == transparent.
                opaque.push(!bit_set);
            }
        }
        Some(opaque)
    }

    fn encode_png(width: u32, height: u32, rgba: &[u8]) -> Option<Vec<u8>> {
        let mut out = Vec::new();
        {
            let mut encoder = png::Encoder::new(&mut out, width, height);
            encoder.set_color(png::ColorType::Rgba);
            encoder.set_depth(png::BitDepth::Eight);
            let mut writer = encoder.write_header().ok()?;
            writer.write_image_data(rgba).ok()?;
        }
        Some(out)
    }
}

#[cfg(not(windows))]
mod platform {
    pub(crate) fn icon_for_ext(_ext: &str) -> Option<String> {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_and_lowercases() {
        assert_eq!(normalize_ext("PDF"), Some("pdf".to_string()));
        assert_eq!(normalize_ext("Zip"), Some("zip".to_string()));
        assert_eq!(normalize_ext("mp3"), Some("mp3".to_string()));
    }

    #[test]
    fn rejects_empty() {
        assert_eq!(normalize_ext(""), None);
    }

    #[test]
    fn rejects_overlong() {
        assert_eq!(normalize_ext(&"a".repeat(17)), None);
        assert_eq!(normalize_ext(&"a".repeat(16)), Some("a".repeat(16)));
    }

    #[test]
    fn rejects_path_traversal_and_separators() {
        assert_eq!(normalize_ext(".."), None);
        assert_eq!(normalize_ext("a/b"), None);
        assert_eq!(normalize_ext("a\\b"), None);
        assert_eq!(normalize_ext("a.b"), None);
    }

    #[test]
    fn rejects_non_ascii_and_whitespace() {
        assert_eq!(normalize_ext("pdf "), None);
        assert_eq!(normalize_ext(" pdf"), None);
        assert_eq!(normalize_ext("p d f"), None);
        assert_eq!(normalize_ext("pdfé"), None);
    }

    // Exercises the real Win32 pipeline end to end (SHGetFileInfoW through PNG
    // encoding) rather than just the boundary validator above — every step
    // from icon handle to pixel bytes has a failure path that unit tests on
    // `normalize_ext` alone can't catch.
    #[cfg(windows)]
    #[test]
    fn shell_icon_for_a_registered_extension_decodes_as_png() {
        let uri = platform::icon_for_ext("txt").expect("txt is registered on every Windows box");
        let b64 = uri
            .strip_prefix("data:image/png;base64,")
            .expect("must be a PNG data URI");
        let bytes = base64::Engine::decode(&base64::engine::general_purpose::STANDARD, b64)
            .expect("must be valid base64");
        assert_eq!(
            &bytes[..8],
            &[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]
        );

        let decoder = png::Decoder::new(bytes.as_slice());
        let reader = decoder.read_info().expect("must be a well-formed PNG");
        let info = reader.info();
        assert!(info.width > 0 && info.height > 0);
    }

    #[cfg(windows)]
    #[test]
    fn shell_icon_for_unregistered_extension_or_none_ext_is_handled() {
        // Both are legitimate outcomes the frontend already handles: `None`
        // falls back to the bundled SVG set. The point of this test is just
        // that neither input panics or hangs the Win32 call chain.
        let _ = platform::icon_for_ext("qqqqzzzz9");
        let _ = platform::icon_for_ext("");
    }
}
