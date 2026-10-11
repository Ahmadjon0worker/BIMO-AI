// Optional sound effects in %APPDATA%\Coucou\sounds, matching SoundEngine's
// upstream filenames. The webview decodes the bytes and falls back to its
// built-in sound when a custom file is missing or cannot be decoded.

use crate::platform;
use std::collections::BTreeSet;
use std::fs::File;
use std::io::Read;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter};

const EXTENSIONS: [&str; 10] = ["wav", "mp3", "ogg", "oga", "m4a", "aac", "flac", "aiff", "aif", "caf"];
const MAX_BYTES: u64 = 8 * 1024 * 1024;
const MAX_NAMES: usize = 128;
const UNAVAILABLE: &str = "Custom sound is unavailable or exceeds 8 MiB.";

pub fn folder() -> PathBuf {
    platform::config_dir().join("sounds")
}

/// A bare sound identifier cannot introduce directories, extensions or ADS.
fn valid_name(name: &str) -> bool {
    !name.is_empty() && name.len() <= 32 && name.bytes().all(|b| b.is_ascii_lowercase())
}

fn custom_file(dir: &Path, name: &str) -> Option<PathBuf> {
    if !valid_name(name) {
        return None;
    }
    EXTENSIONS.iter().map(|ext| dir.join(format!("{name}.{ext}"))).find(|path| {
        // A replacement is a regular file, not a shortcut to another folder.
        std::fs::symlink_metadata(path)
            .is_ok_and(|m| m.is_file() && m.len() > 0 && m.len() <= MAX_BYTES)
    })
}

fn names_in(dir: &Path, names: Vec<String>) -> Vec<String> {
    let mut seen = BTreeSet::new();
    names.into_iter().take(MAX_NAMES)
        .filter(|name| valid_name(name) && seen.insert(name.clone()) && custom_file(dir, name).is_some())
        .collect()
}

fn bounded_bytes(reader: impl Read) -> Result<Vec<u8>, String> {
    let mut bytes = Vec::new();
    reader.take(MAX_BYTES + 1).read_to_end(&mut bytes).map_err(|_| UNAVAILABLE.to_string())?;
    if bytes.is_empty() || bytes.len() as u64 > MAX_BYTES {
        return Err(UNAVAILABLE.into());
    }
    Ok(bytes)
}

fn read_from(dir: &Path, name: &str) -> Result<Vec<u8>, String> {
    let path = custom_file(dir, name).ok_or_else(|| UNAVAILABLE.to_string())?;
    let file = File::open(path).map_err(|_| UNAVAILABLE.to_string())?;
    let metadata = file.metadata().map_err(|_| UNAVAILABLE.to_string())?;
    if !metadata.is_file() || metadata.len() == 0 || metadata.len() > MAX_BYTES {
        return Err(UNAVAILABLE.into());
    }
    // A changed file still cannot turn a sound request into an unbounded read.
    bounded_bytes(file)
}

#[tauri::command]
pub fn custom_sounds(names: Vec<String>) -> Vec<String> {
    names_in(&folder(), names)
}

#[tauri::command]
pub async fn custom_sound(name: String) -> Result<tauri::ipc::Response, String> {
    tauri::async_runtime::spawn_blocking(move || read_from(&folder(), &name))
        .await.map_err(|_| UNAVAILABLE.to_string())?
        .map(tauri::ipc::Response::new)
}

#[tauri::command]
pub fn reveal_sounds_folder() -> Result<(), String> {
    let dir = folder();
    platform::ensure_private_dir(&dir).map_err(|_| "Could not create the sounds folder.".to_string())?;
    platform::reveal_folder(&dir.to_string_lossy());
    Ok(())
}

#[tauri::command]
pub fn reload_sounds(app: AppHandle) {
    let _ = app.emit("sounds-changed", ());
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;
    use std::sync::atomic::{AtomicU64, Ordering};

    static NEXT: AtomicU64 = AtomicU64::new(0);
    struct Scratch(PathBuf);
    impl Scratch {
        fn new() -> Self {
            let root = std::env::temp_dir().join(format!("coucou-sounds-{}-{}-{}",
                std::process::id(),
                std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos(),
                NEXT.fetch_add(1, Ordering::Relaxed)));
            std::fs::create_dir(&root).unwrap();
            Self(root)
        }
    }
    impl Drop for Scratch {
        fn drop(&mut self) { let _ = std::fs::remove_dir_all(&self.0); }
    }

    #[test]
    fn priority_and_raw_bytes_match_upstream_sound_replacements() {
        let dir = Scratch::new();
        std::fs::write(dir.0.join("finish.mp3"), b"mp3").unwrap();
        std::fs::write(dir.0.join("finish.wav"), b"wav").unwrap();
        std::fs::write(dir.0.join("greet.m4a"), b"m4a").unwrap();
        assert_eq!(custom_file(&dir.0, "finish"), Some(dir.0.join("finish.wav")));
        assert_eq!(read_from(&dir.0, "finish").unwrap(), b"wav");
        assert_eq!(read_from(&dir.0, "greet").unwrap(), b"m4a");
        assert_eq!(custom_file(&dir.0, "approval"), None);
    }

    #[test]
    fn traversal_ads_invalid_names_empty_files_and_directories_are_not_sounds() {
        let dir = Scratch::new();
        std::fs::write(dir.0.join("empty.wav"), b"").unwrap();
        std::fs::create_dir(dir.0.join("folder.wav")).unwrap();
        std::fs::write(dir.0.join("notes.txt"), b"x").unwrap();
        for bad in ["../finish", "Finish", "fin ish", "", "a/b", "finish.wav", "finish:secret", "..\\finish", "parol\0"] {
            assert!(!valid_name(bad), "{bad:?}");
            assert!(read_from(&dir.0, bad).is_err());
        }
        for name in ["empty", "folder", "notes"] {
            assert_eq!(custom_file(&dir.0, name), None);
        }
        assert!(valid_name(&"a".repeat(32)));
        assert!(!valid_name(&"a".repeat(33)));
    }

    #[test]
    fn oversized_preferred_format_is_ignored_and_request_reads_stay_bounded() {
        let dir = Scratch::new();
        File::create(dir.0.join("finish.wav")).unwrap().set_len(MAX_BYTES + 1).unwrap();
        std::fs::write(dir.0.join("finish.mp3"), b"mp3").unwrap();
        assert_eq!(read_from(&dir.0, "finish").unwrap(), b"mp3");
        assert!(bounded_bytes(Cursor::new(vec![0; (MAX_BYTES + 2) as usize])).is_err());
        assert_eq!(bounded_bytes(Cursor::new(vec![0; MAX_BYTES as usize])).unwrap().len(), MAX_BYTES as usize);
        assert!(bounded_bytes(Cursor::new(Vec::<u8>::new())).is_err());
    }

    #[test]
    fn listing_is_deduplicated_and_has_a_fixed_request_budget() {
        let dir = Scratch::new();
        std::fs::write(dir.0.join("finish.wav"), b"wav").unwrap();
        assert_eq!(names_in(&dir.0, vec!["finish".into(), "missing".into(), "finish".into(), "../finish".into()]), ["finish"]);
        let mut names = vec!["missing".into(); MAX_NAMES];
        names.push("finish".into());
        assert!(names_in(&dir.0, names).is_empty());
    }

    #[cfg(unix)]
    #[test]
    fn a_sound_symlink_is_not_followed_outside_the_folder() {
        let dir = Scratch::new();
        let outside = Scratch::new();
        std::fs::write(outside.0.join("private.wav"), b"private").unwrap();
        std::os::unix::fs::symlink(outside.0.join("private.wav"), dir.0.join("finish.wav")).unwrap();
        assert_eq!(custom_file(&dir.0, "finish"), None);
    }
}
